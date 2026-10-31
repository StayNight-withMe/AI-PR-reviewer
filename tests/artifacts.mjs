/**
 * Review artifacts must not pollute the repository.
 *
 * Review artifacts live in the OS temp directory (or `PR_REVIEW_ARTIFACTS_DIR`),
 * never inside the checkout, so a review leaves the working tree clean.
 *
 * Run: node tests/artifacts.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { artifactsRoot, repoSlug, reviewDir } from "../src/artifacts.js";
import { MODE } from "../src/config.js";
const exec = promisify(execFile);
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}
async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), "artifacts-"));
  const git = (...a) => exec("git", a, { cwd: root });
  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "t@e.com");
  await git("config", "user.name", "T");
  await writeFile(join(root, "a.txt"), "one\n");
  await git("add", "-A");
  await git("commit", "-m", "init");
  await writeFile(join(root, "a.txt"), "two\n");
  return root;
}
const root = await makeRepo();
let started = null;
try {
  await check("the artifacts root is the temp directory by default", () => {
    const rootDir = artifactsRoot({});
    assert.ok(rootDir.toLowerCase().startsWith(tmpdir().toLowerCase()), `not under temp: ${rootDir}`);
  });

  await check("PR_REVIEW_ARTIFACTS_DIR overrides the root", () => {
    assert.equal(artifactsRoot({ PR_REVIEW_ARTIFACTS_DIR: "C:/cache/reviews" }), "C:/cache/reviews");
    assert.equal(artifactsRoot({ PR_REVIEW_ARTIFACTS_DIR: "   " }), artifactsRoot({}));
  });

  await check("the repository slug is stable and distinct per path", () => {
    const a = repoSlug("C:/work/app");
    const b = repoSlug("C:/other/app");
    assert.equal(a, repoSlug("C:/work/app"), "the slug is not stable");
    assert.notEqual(a, b, "two different repositories share a slug");
    assert.ok(a.includes("app"), "the slug lost the readable name");
    assert.match(a, /^[A-Za-z0-9._-]+$/, "the slug holds an unsafe character");
  });

  await check("a review writes nothing into the checkout", async () => {
    started = await startReview({ repoPath: root, mode: MODE.UNCOMMITTED, port: 0, symbols: false, dispatchEnabled: false });

    const entries = await readdir(root);
    assert.ok(!entries.includes(".pr-review"), `the checkout is dirty: ${entries.join(", ")}`);
    assert.ok(!started.outputDir.toLowerCase().startsWith(root.toLowerCase()), "the output dir is inside the repository");
    assert.ok(started.outputDir.toLowerCase().startsWith(tmpdir().toLowerCase()), "the output dir is not under temp");
  });

  await check("the review directory helper matches where the review was written", async () => {
    const expected = reviewDir(root, started.reviewId);
    assert.equal(expected, started.outputDir, "reviewDir() and startReview() disagree");
    assert.ok(expected.toLowerCase().startsWith(tmpdir().toLowerCase()), "the review dir is not under temp");
  });

  await check("an old in-repo .pr-review is removed on the next review", async () => {
    // Simulate a folder left by an older version, then start another review.
    await mkdir(join(root, ".pr-review", "aaaaaaaaaaaa"), { recursive: true });
    await writeFile(join(root, ".pr-review", "aaaaaaaaaaaa", "page.json"), "{}");

    const second = await startReview({ repoPath: root, mode: MODE.UNCOMMITTED, port: 0, symbols: false, dispatchEnabled: false });
    try {
      const entries = await readdir(root);
      assert.ok(!entries.includes(".pr-review"), "the legacy folder was not removed");
    } finally {
      await second.page.close();
    }
  });

  await check("a user's own .pr-review content is never deleted", async () => {
    // A folder with a non-review entry is not ours; it must stay.
    await mkdir(join(root, ".pr-review"), { recursive: true });
    await writeFile(join(root, ".pr-review", "notes.txt"), "keep me");

    const third = await startReview({ repoPath: root, mode: MODE.UNCOMMITTED, port: 0, symbols: false, dispatchEnabled: false });
    try {
      const entries = await readdir(join(root, ".pr-review"));
      assert.ok(entries.includes("notes.txt"), "user content was deleted");
    } finally {
      await third.page.close();
    }
  });

  await check("an explicit outputDir still wins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "explicit-out-"));
    const review = await startReview({ repoPath: root, mode: MODE.UNCOMMITTED, port: 0, symbols: false, dispatchEnabled: false, outputDir: dir });
    try {
      assert.equal(review.outputDir, dir);
      assert.ok((await readdir(dir)).length >= 0);
    } finally {
      await review.page.close();
    }
  });
} finally {
  if (started) await started.page.close();
  await rm(root, { recursive: true, force: true });
}
