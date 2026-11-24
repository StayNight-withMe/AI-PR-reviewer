
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { GIT, MODE } from "../src/config.js";
import { readThreads } from "../src/models/threads.js";
import { setCommentsResolved } from "../src/models/resolve-store.js";

const exec = promisify(execFile);
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL ${name} — ${error.message}`);
  }
}

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "pr-review-logic-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });
  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(root, "a.ts"), "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n");
  await git("add", "-A");
  await git("commit", "-m", "init");
  await writeFile(join(root, "a.ts"), "export const a = 1;\nexport const b = 22;\nexport const c = 3;\n");
  await git("add", "-A");
  await git("commit", "-m", "change b");
  return { root, git };
}

const fixture = await createRepository();
for (const name of ["OPENCODE_SESSION_ID", "OPENCODE_SESSION", "PR_REVIEW_SESSION"]) delete process.env[name];
process.env[GIT.ARTIFACTS_DIR_ENV] = join(fixture.root, "artifacts");

const base = (await fixture.git("rev-parse", "HEAD~1")).stdout.trim();
const page = await startReview({
  repoPath: fixture.root, mode: MODE.RANGE, base, head: "HEAD",
  port: 0, symbols: true, dispatchEnabled: false, sessionId: "",
});

const comment = {
  id: "comment-1",
  path: "a.ts",
  side: "right",
  lineStart: 2,
  lineEnd: 2,
  body: "This line looks wrong.",
  resolved: false,
};

try {
  await check("a comment written on the page is stored for the next review", async () => {
    const response = await fetch(new URL("/api/threads", page.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comments: [comment] }),
    });
    assert.equal(response.status, 200);
    const stored = await readThreads(fixture.root, page.meta);
    assert.equal(stored.comments.length, 1);
    assert.equal(stored.comments[0].id, "comment-1");
  });

  await check("the stored comment carries the code it was written on", async () => {
    const stored = await readThreads(fixture.root, page.meta);
    assert.ok(stored.comments[0].snippet, "no snippet was recorded");
    assert.match(stored.comments[0].snippet, /b = 22/);
  });

  await check("resolving reaches the thread store the page reads", async () => {
    const touched = await setCommentsResolved(page, ["comment-1"], true);
    assert.deepEqual(touched, ["comment-1"]);
    const stored = await readThreads(fixture.root, page.meta);
    assert.equal(stored.comments[0].resolved, true,
      "the page would still show the comment as open after the agent resolved it");
  });

  await check("reopening reaches it too", async () => {
    await setCommentsResolved(page, ["comment-1"], false);
    const stored = await readThreads(fixture.root, page.meta);
    assert.equal(stored.comments[0].resolved, false);
  });

  await check("resolving every comment works without ids", async () => {
    await setCommentsResolved(page, null, true);
    const stored = await readThreads(fixture.root, page.meta);
    assert.equal(stored.comments[0].resolved, true);
  });

  await check("an unknown id changes nothing and reports nothing", async () => {
    const touched = await setCommentsResolved(page, ["no-such-comment"], false);
    assert.deepEqual(touched, []);
    const stored = await readThreads(fixture.root, page.meta);
    assert.equal(stored.comments[0].resolved, true, "an unrelated id must not flip a comment");
  });

  await check("a submitted review keeps review.json and the store in step", async () => {


    const response = await fetch(new URL("/api/review", page.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewState: "REQUEST_CHANGES",
        reviewBody: "One note.",
        comments: [{ ...comment, resolved: false }],
        images: [],
        noteImages: [],
      }),
    });
    assert.equal(response.status, 200);

    const jsonPath = join(page.outputDir, "review.json");
    const saved = JSON.parse(await readFile(jsonPath, "utf8"));
    assert.equal(saved.review.comments.length, 1);

    await setCommentsResolved(page, ["comment-1"], true);

    const afterJson = JSON.parse(await readFile(jsonPath, "utf8"));
    assert.equal(afterJson.review.comments[0].resolved, true, "review.json was not updated");

    const markdown = await readFile(join(page.outputDir, "review.md"), "utf8");
    assert.match(markdown, /resolved/i, "review.md does not show the resolved state");

    const stored = await readThreads(fixture.root, page.meta);
    assert.equal(stored.comments[0].resolved, true, "the thread store was not updated");
  });

  await check("a review that was never submitted still resolves through the store", async () => {
    const other = await startReview({
      repoPath: fixture.root, mode: MODE.RANGE, base, head: "HEAD",
      port: 0, symbols: true, dispatchEnabled: false, sessionId: "",
    });
    try {
      const fresh = { ...comment, id: "comment-2", resolved: false };
      await fetch(new URL("/api/threads", other.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comments: [fresh] }),
      });
      const touched = await setCommentsResolved(other, ["comment-2"], true);
      assert.deepEqual(touched, ["comment-2"]);
      const stored = await readThreads(fixture.root, other.meta);
      const found = stored.comments.find((item) => item.id === "comment-2");
      assert.equal(found.resolved, true);
    } finally {
      await other.page.close();
    }
  });
} finally {
  await page.page.close();
  await rm(fixture.root, { recursive: true, force: true }).catch(() => {});
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll resolve-logic checks passed");
