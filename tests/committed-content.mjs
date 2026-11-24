
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { GIT, MODE } from "../src/config.js";

const exec = promisify(execFile);
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

const root = await mkdtemp(join(tmpdir(), "pr-review-committed-"));
const git = (...args) => exec(GIT.BIN, args, { cwd: root });


const COMMITTED = Array.from({ length: 40 }, (_, index) => `public const string Key${index} = "value${index}";`).join("\n") + "\n";

const WORKTREE = "public static partial class Keys\n{\n}\n";

let started = null;
try {
  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(root, "readme.md"), "base\n");
  await git("add", "-A");
  await git("commit", "-m", "init");
  await git("rev-parse", "HEAD").then(({ stdout }) => { started = stdout.trim(); });


  await writeFile(join(root, "Keys.cs"), COMMITTED);
  await git("add", "-A");
  await git("commit", "-m", "add keys");
  const head = (await git("rev-parse", "HEAD")).stdout.trim();
  const base = started;


  await writeFile(join(root, "Keys.cs"), WORKTREE);

  const review = await startReview({
    repoPath: root,
    mode: MODE.RANGE,
    base,
    head,
    port: 0,
    symbols: false,
    dispatchEnabled: false,
    sessionId: "",
  });

  try {
    await check("the diff still describes the reviewed commit", () => {
      const file = review.meta.allFiles.find((entry) => entry.path === "Keys.cs");
      assert.ok(file, "the reviewed file is missing from the tree");
    });

    await check("the served content is the reviewed commit, not the disk", async () => {
      const response = await fetch(new URL("/api/file?path=Keys.cs", review.url));
      const data = await response.json();
      assert.equal(data.lines.length, 40, `the server served ${data.lines.length} lines instead of 40`);
      assert.equal(data.lines[0], COMMITTED.split("\n")[0]);
      assert.equal(data.lines[39], COMMITTED.split("\n")[39]);
    });

    await check("the highlighted batch uses the reviewed commit too", async () => {
      const response = await fetch(new URL("/api/files", review.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths: ["Keys.cs"] }),
      });
      const data = await response.json();
      assert.equal(data.files["Keys.cs"].lines.length, 40, "the batch endpoint served the working tree");
    });

    await check("an uncommitted review still reads the disk", async () => {
      const dirty = await startReview({
        repoPath: root,
        mode: MODE.UNCOMMITTED,
        port: 0,
        symbols: false,
        dispatchEnabled: false,
        sessionId: "",
      });
      try {
        const response = await fetch(new URL("/api/file?path=Keys.cs", dirty.url));
        const data = await response.json();
        assert.equal(data.lines.length, 3, "an uncommitted review must show the working tree");
      } finally {
        await dirty.page.close();
      }
    });
  } finally {
    await review.page.close();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll committed-content checks passed");
