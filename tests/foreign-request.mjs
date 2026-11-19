/**
 * Only the review page itself may drive the local server.
 *
 * The page listens on the loopback address, so any other page in the same
 * browser can reach it. Two ways were open: a `Host` header naming another site
 * (what DNS rebinding sends) was served as usual, and a cross-site POST was
 * accepted, because a browser sends `text/plain` without asking permission
 * first. Since the routes read files, write review state and run git, both are
 * refused now.
 *
 * Run: node tests/foreign-request.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { request } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { GIT, MODE, ROUTES, SERVER } from "../src/config.js";

const exec = promisify(execFile);
const failures = [];

function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

const root = await mkdtemp(join(tmpdir(), "pr-review-foreign-"));
const repo = join(root, "repo");
const git = (...args) => exec(GIT.BIN, args, { cwd: repo });

try {
  await exec(GIT.BIN, ["init", "--initial-branch", "main", repo]);
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(repo, "a.ts"), "export const a = 1;\n");
  await git("add", "-A");
  await git("commit", "-m", "init");
  await writeFile(join(repo, "a.ts"), "export const a = 1;\nexport const b = 2;\n");

  for (const name of ["OPENCODE_SESSION_ID", "OPENCODE_SESSION"]) delete process.env[name];
  process.env[GIT.ARTIFACTS_DIR_ENV] = join(root, "artifacts");

  const review = await startReview({
    repoPath: repo, mode: MODE.UNCOMMITTED, port: 0, symbols: false,
    dispatchEnabled: false, sessionId: "",
  });
  const port = new URL(review.url).port;

  /** A raw request, so the Host header can be anything. */
  const raw = (path, { host, method = "GET", type, body } = {}) => new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers: { host, ...(type ? { "content-type": type } : {}) } },
      (res) => {
        let text = "";
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: text }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });

  await check("a request with a foreign Host header is refused", async () => {
    for (const host of ["evil.example.com", "evil.example.com:1234", "pr-review.attacker.test"]) {
      const answer = await raw(`${ROUTES.API_FILE}?path=a.ts`, { host });
      assert.equal(answer.status, SERVER.STATUS_FORBIDDEN, `${host} was served with ${answer.status}`);
      assert.match(answer.body, /Unknown host/);
      assert.doesNotMatch(answer.body, /export const a/, `${host} leaked file content`);
    }
  });

  await check("the page still answers on its own addresses", async () => {
    for (const host of ["127.0.0.1", `127.0.0.1:${port}`, "localhost", "[::1]"]) {
      const answer = await raw(`${ROUTES.API_FILE}?path=a.ts`, { host });
      assert.equal(answer.status, SERVER.STATUS_OK, `${host} was refused`);
      assert.match(answer.body, /export const a/, `${host} did not get the file`);
    }
  });

  await check("a cross-site POST is refused", async () => {
    // A form on another site can only send text/plain, and sends it without a
    // preflight, so this is the request that must not be trusted.
    const answer = await raw(ROUTES.API_SETTINGS, {
      host: `127.0.0.1:${port}`,
      method: "POST",
      type: "text/plain",
      body: JSON.stringify({ theme: "light" }),
    });
    assert.equal(answer.status, SERVER.STATUS_FORBIDDEN, `a form POST was accepted: ${answer.status}`);
    assert.match(answer.body, /Expected a JSON body/);
  });

  await check("the page's own POST still works", async () => {
    const response = await fetch(new URL(ROUTES.API_SETTINGS, review.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: "light" }),
    });
    assert.equal(response.status, SERVER.STATUS_OK, "the page can no longer save settings");
    const payload = await response.json();
    assert.equal(payload.settings.theme, "light");
  });

  await check("the page loads and a review can still be submitted", async () => {
    const html = await fetch(review.url).then((response) => response.text());
    assert.match(html, /^<!DOCTYPE html>/, "the page stopped being served");

    const submit = await fetch(new URL(ROUTES.API_REVIEW, review.url), {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ reviewState: "APPROVE", reviewBody: "fine", comments: [] }),
    });
    assert.equal(submit.status, SERVER.STATUS_OK, "a normal submit was refused");
  });

  await review.page.close();
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {});
  delete process.env[GIT.ARTIFACTS_DIR_ENV];
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll foreign-request checks passed");
