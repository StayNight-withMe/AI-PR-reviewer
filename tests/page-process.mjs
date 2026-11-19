/**
 * The review page has to outlive the process that started it.
 *
 * The MCP server can be restarted at any time; the page in the browser must
 * keep working, otherwise a submit dies with the chat connection. This test
 * starts the page in a helper process, lets that helper exit and then checks
 * that the page still answers.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { fetchPageResult, findPageRegistry, findFreePort, stopPageProcess, waitForPageRegistry } from "../src/page-process.js";
import { GIT, MODE } from "../src/config.js";
const exec = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));
const HELPER = join(ROOT, "fixtures", "start-page-helper.mjs");
const failures = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`PASS ${name}`),
      (error) => {
        failures.push(`${name}: ${error.message}`);
        console.log(`FAIL ${name} — ${error.message}`);
      },
    );
}
const repo = await mkdtemp(join(tmpdir(), "pr-review-page-"));
const git = (...args) => exec(GIT.BIN, args, { cwd: repo });
try {
  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src/app.ts"), "export const value = 1;\n");
  await git("add", "-A");
  await git("commit", "-m", "init");
  await writeFile(join(repo, "src/app.ts"), "export const value = 2;\n");

  const port = await findFreePort();

  // The helper starts the page and exits right away: the page has to survive.
  await exec(process.execPath, [HELPER, repo, String(port)], { cwd: repo, timeout: 120_000 });

  let registry = null;
  for (let attempt = 0; attempt < 60 && !registry; attempt += 1) {
    registry = await findPageRegistry(repo);
    if (!registry) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await check("the page registers itself", () => {
    assert.ok(registry, "no page was registered");
    assert.equal(registry.port, port);
    assert.ok(registry.reviewId, "the registry has no review id");
    assert.ok(registry.url.includes(String(port)), `unexpected url ${registry.url}`);
  });

  await check("the page answers after the starter is gone", async () => {
    const response = await fetch(registry.url);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes("app.ts"), "the diff is not on the page");
  });

  await check("the submitted review is readable over http", async () => {
    const response = await fetch(new URL("/api/result", registry.url));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.review, null, "nothing was submitted yet");
  });

  await check("the helper that waits for a submit can reach the page", async () => {
    // The page URL ends with a slash and the route starts with one. Joining
    // them by hand produced `//api/result`, which the server does not serve, so
    // every detached review looked unsubmitted even after the page had saved it.
    const payload = await fetchPageResult(registry);
    assert.ok(payload, "the page state is unreadable through the helper");
    assert.equal(payload.ok, true);
    assert.ok("review" in payload, "the helper does not report the review");
  });

  await check("a page is found by its own id, not by whichever came first", async () => {
    // Two pages of one repository can run at once. Looking up "any page" made a
    // new scope open the older page.
    const mine = await findPageRegistry(repo, { match: (entry) => entry.pid === registry.pid });
    assert.ok(mine, "the page was not found by its process id");
    assert.equal(mine.reviewId, registry.reviewId);

    const other = await findPageRegistry(repo, { match: (entry) => entry.pid === registry.pid + 1 });
    assert.equal(other, null, "a page was returned for a process id it does not belong to");

    const missing = await waitForPageRegistry(repo, { pid: -1, timeoutMs: 600 });
    assert.equal(missing, null, "waiting for another process returned this page");
  });

  await check("the page process can be stopped", async () => {
    await stopPageProcess(registry);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    let alive = true;
    try {
      await fetch(registry.url);
    } catch {
      alive = false;
    }
    assert.equal(alive, false, "the page still answers after it was stopped");
  });
} finally {
  await rm(repo, { recursive: true, force: true });
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll page process checks passed");
}
void MODE;
