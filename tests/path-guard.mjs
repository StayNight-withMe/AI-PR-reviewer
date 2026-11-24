
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { repoPathOf } from "../src/fileview.js";
import { GIT, MODE, ROUTES } from "../src/config.js";

const exec = promisify(execFile);
const failures = [];

function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

const SECRET = "TOPSECRET-VALUE";
const root = await mkdtemp(join(tmpdir(), "pr-review-path-"));
const repo = join(root, "repo");
const git = (...args) => exec(GIT.BIN, args, { cwd: repo });

try {
  await exec(GIT.BIN, ["init", "--initial-branch", "main", repo]);
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");
  await mkdir(join(repo, "src", "deep"), { recursive: true });
  await writeFile(join(repo, "src", "a.ts"), "export const inside = 1;\n");
  await writeFile(join(repo, "src", "deep", "b.ts"), "export const deep = 2;\n");
  await writeFile(join(root, "secret.txt"), `${SECRET}\n`);
  await git("add", "-A");
  await git("commit", "-m", "init");
  await writeFile(join(repo, "src", "a.ts"), "export const inside = 1;\nexport const more = 3;\n");

  for (const name of ["OPENCODE_SESSION_ID", "OPENCODE_SESSION"]) delete process.env[name];
  process.env[GIT.ARTIFACTS_DIR_ENV] = join(root, "artifacts");

  await check("a path inside the repository is accepted", () => {
    assert.equal(repoPathOf(repo, "src/a.ts"), "src/a.ts");
    assert.equal(repoPathOf(repo, "src/deep/b.ts"), "src/deep/b.ts");

    assert.equal(repoPathOf(repo, "src\\deep\\b.ts"), "src/deep/b.ts");
  });

  await check("a path that climbs above the repository is refused", () => {
    for (const bad of ["../secret.txt", "..\\secret.txt", "src/../../secret.txt", "src\\..\\..\\secret.txt", "..", "../"]) {
      assert.equal(repoPathOf(repo, bad), null, `${bad} was accepted`);
    }
  });

  await check("an absolute path or an empty one is refused", () => {
    assert.equal(repoPathOf(repo, join(root, "secret.txt")), null);
    assert.equal(repoPathOf(repo, "/etc/passwd"), null);
    assert.equal(repoPathOf(repo, "C:\\Windows\\win.ini"), null);
    assert.equal(repoPathOf(repo, ""), null);
  });

  const review = await startReview({
    repoPath: repo, mode: MODE.UNCOMMITTED, port: 0, symbols: false,
    dispatchEnabled: false, sessionId: "",
  });

  const apiFile = async (probe) => {
    const url = new URL(ROUTES.API_FILE, review.url);
    url.searchParams.set("path", probe);
    const response = await fetch(url);
    return { status: response.status, body: await response.text() };
  };

  const filePage = async (probe) => {
    const url = new URL(ROUTES.FILE, review.url);
    url.searchParams.set("path", probe);
    return (await fetch(url)).text();
  };

  await check("the file API serves a real file and no secret", async () => {
    const good = await apiFile("src/a.ts");
    assert.equal(good.status, 200);
    assert.match(good.body, /export const inside/);

    for (const bad of ["../secret.txt", "..\\secret.txt", "src/../../secret.txt", join(root, "secret.txt")]) {
      const answer = await apiFile(bad);
      assert.ok(answer.status >= 400, `${bad} was served with ${answer.status}`);
      assert.ok(!answer.body.includes(SECRET), `${bad} leaked the file`);
    }
  });

  await check("the file page does not render a file above the repository", async () => {
    for (const bad of ["../secret.txt", "src/../../secret.txt"]) {
      const html = await filePage(bad);
      assert.ok(!html.includes(SECRET), `${bad} leaked into the page`);
    }

    const good = await filePage("src/a.ts");
    assert.match(good, /export const inside/, "a real file stopped working");
  });

  await check("the batch reader refuses only the offending path", async () => {
    const response = await fetch(new URL(ROUTES.API_FILES, review.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: ["../secret.txt", "src/a.ts"] }),
    });
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.files["../secret.txt"], null, "a path above the repository was read");
    assert.ok(!JSON.stringify(payload).includes(SECRET), "the batch leaked the file");
    assert.ok(payload.files["src/a.ts"], "one bad path spoiled a valid one");
    assert.match(payload.files["src/a.ts"].lines.join("\n"), /export const inside/);
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
console.log("\nAll path-guard checks passed");
