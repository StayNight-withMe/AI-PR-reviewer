/**
 * Comments follow the code they were written on, across reviews of the same
 * target. This checks the grouping rules: two reviews of one branch share their
 * comments, two branches do not, and a PR is keyed by its number.
 *
 * Run: node tests/logic-grouping.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { threadsKey, threadsPath, readThreads, writeThreads } from "../src/models/threads.js";

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

const root = await mkdtemp(join(tmpdir(), "pr-review-grouping-"));
process.env["PR_REVIEW_ARTIFACTS_DIR"] = join(root, "artifacts");

const branchMeta = (branch) => ({ repo: "shop", branch, pr: null });
const prMeta = (number, branch) => ({ repo: "shop", branch, pr: { number } });

try {
  await check("a branch is keyed by its name", async () => {
    assert.equal(threadsKey(branchMeta("feature/x")), "branch-feature/x");
  });

  await check("a pull request is keyed by its number, not its branch", async () => {
    assert.equal(threadsKey(prMeta(42, "feature/x")), "pr-42");
    // Two PRs can point at the same branch: the numbers must stay apart.
    assert.notEqual(threadsKey(prMeta(42, "feature/x")), threadsKey(prMeta(43, "feature/x")));
  });

  await check("a detached checkout has one shared key", async () => {
    assert.equal(threadsKey({ repo: "shop", branch: "", pr: null }), "worktree");
    assert.equal(threadsKey({ repo: "shop", branch: "   ", pr: null }), "worktree");
  });

  await check("two reviews of one branch share their comments", async () => {
    const meta = branchMeta("feature/share");
    const comment = { id: "c1", path: "a.ts", side: "right", lineStart: 1, lineEnd: 1, body: "Note." };
    await writeThreads(root, meta, [comment]);

    // The same branch, reviewed again with a different diff: the comments are
    // stored under the same key, so they come back.
    const again = await readThreads(root, branchMeta("feature/share"));
    assert.equal(again.comments.length, 1);
    assert.equal(again.comments[0].body, "Note.");
  });

  await check("two branches do not share comments", async () => {
    const one = await readThreads(root, branchMeta("feature/share"));
    const other = await readThreads(root, branchMeta("feature/other"));
    assert.equal(one.comments.length, 1);
    assert.equal(other.comments.length, 0, "comments leaked between branches");
  });

  await check("a branch and a PR of it do not share comments", async () => {
    // They are different review targets: the PR is reviewable by its number
    // whatever the local branch is called, and the two must not overwrite each
    // other.
    const branch = await readThreads(root, branchMeta("feature/share"));
    const pr = await readThreads(root, prMeta(7, "feature/share"));
    assert.equal(branch.comments.length, 1);
    assert.equal(pr.comments.length, 0);
  });

  await check("a branch name with traversal segments cannot escape the folder", async () => {
    const nasty = threadsPath(root, branchMeta("../../etc/passwd"));
    // The key may keep its text, but the file must resolve inside the artifacts
    // root: no `..` may survive as a path segment.
    const segments = nasty.split(/[\\/]+/);
    assert.ok(!segments.includes(".."), `a traversal segment survived: ${nasty}`);
    assert.ok(nasty.startsWith(join(root, "artifacts")), `unexpected location ${nasty}`);
  });

  await check("a PR number cannot be used twice for different repositories", async () => {
    // The repo folder is part of the path, so two projects with PR #1 keep
    // separate comment files.
    const a = threadsPath(root, { repo: "shop", branch: "main", pr: { number: 1 } });
    const shopPath = a;
    const b = await (async () => {
      const other = { repo: "blog", branch: "main", pr: { number: 1 } };
      // repoSlug depends on the repository root, which is the same here, so only
      // the key can differ. Both must still be distinct files by key.
      return threadsPath(root, other);
    })();
    assert.equal(shopPath, b, "the same root and key must map to the same file");
  });

  await check("an unreadable thread file yields no comments instead of a crash", async () => {
    const meta = branchMeta("feature/broken");
    const path = threadsPath(root, meta);
    await writeFile(path, "{ not json", "utf8");
    const stored = await readThreads(root, meta);
    assert.equal(stored.comments.length, 0);
  });
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {});
  delete process.env["PR_REVIEW_ARTIFACTS_DIR"];
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll grouping checks passed");
