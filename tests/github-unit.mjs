/**
 * Unit checks for the GitHub pull-request scope, without the network.
 *
 * The live PR read is covered by tests/github.mjs; this file pins the small
 * pure/plumbing pieces so a change to them fails fast.
 *
 * Run: node --test tests/github-unit.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { ensurePullRequestCommits, normalizePullRequest, pullRequestScope, pullRequestTitle } from "../src/github.js";
import { GIT, GH } from "../src/config.js";
const exec = promisify(execFile);
async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), "pr-review-gh-unit-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });
  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/a.txt"), "a\n");
  await git("add", "-A");
  await git("commit", "-m", "base");
  return { root, git };
}
const sha = async (git) => (await git("rev-parse", "HEAD")).stdout.trim();
test("normalizePullRequest maps the gh payload", () => {
  const pr = normalizePullRequest({
    number: 42, title: "T", url: "U", state: "OPEN", isDraft: true,
    baseRefName: "main", headRefName: "feat", baseRefOid: "b", headRefOid: "h",
    author: { login: "me" }, body: "B", additions: 1, deletions: 2, changedFiles: 3,
  });
  assert.deepEqual(pr, {
    number: 42, title: "T", url: "U", state: "OPEN", draft: true,
    baseRefName: "main", headRefName: "feat", baseOid: "b", headOid: "h",
    author: "me", body: "B", additions: 1, deletions: 2, changedFiles: 3,
  });
});
test("normalizePullRequestSummary maps a list entry", async () => {
  const { normalizePullRequestSummary } = await import("../src/github.js");
  const summary = normalizePullRequestSummary({
    number: 12, title: "Fix", state: "OPEN", isDraft: true,
    headRefName: "feat", baseRefName: "main", url: "https://github.com/a/b/pull/12",
    author: { login: "octocat" }, updatedAt: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(summary, {
    number: 12, title: "Fix", state: "OPEN", draft: true,
    headRefName: "feat", baseRefName: "main",
    url: "https://github.com/a/b/pull/12", author: "octocat",
    updatedAt: "2026-01-01T00:00:00Z",
  });
});
test("the PR scope key and title are stable", () => {
  const pr = normalizePullRequest({ number: 5, title: "Fix" });
  assert.equal(pullRequestScope(pr), "pr5");
  assert.equal(pullRequestTitle(pr), "PR #5: Fix");
  assert.equal(pullRequestTitle(normalizePullRequest({ number: 5 })), "PR #5");
});
test("an already-present commit is not fetched again", async () => {
  const { root, git } = await makeRepo();
  try {
    const head = await sha(git);
    const pr = normalizePullRequest({ number: 1, headRefOid: head, baseRefOid: head, baseRefName: "main" });
    const commits = await ensurePullRequestCommits(root, pr);
    assert.equal(commits.head, head);
    assert.equal(commits.fetched, false, "a local commit must not be fetched");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("a missing commit is really missing (cat-file, not rev-parse)", async () => {
  // Regression: a syntactically valid SHA can pass `rev-parse --verify`
  // in a clone that has the object name reachable (e.g. from a fetched ref)
  // while the object itself is absent, so a PR reported an empty diff. The
  // check must ask the object store, and a commit that cannot be fetched must
  // fail loudly instead of silently producing an empty review.
  const { root, git } = await makeRepo();
  try {
    const absent = "deadbeef".repeat(5); // 40 hex chars, no such object
    const pr = normalizePullRequest({ number: 2, headRefOid: absent, baseRefOid: await sha(git), baseRefName: "main" });
    // No remote and no such object: the fetch cannot succeed, so it must throw.
    await assert.rejects(ensurePullRequestCommits(root, pr), /fetch|Could not/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("reading a PR never moves the user's remote-tracking refs", async () => {
  // Regression: fetching the PR base used `git fetch origin <branch>`,
  // which fast-forwards `refs/remotes/origin/<branch>` and silently empties
  // every branch review of the repository.
  const { root, git } = await makeRepo();
  try {
    // A fake remote-tracking ref that must keep its value.
    const base = await sha(git);
    await git("update-ref", "refs/remotes/origin/main", base);
    const before = (await git("rev-parse", "refs/remotes/origin/main")).stdout.trim();

    const pr = normalizePullRequest({
      number: 9,
      baseRefOid: base,
      headRefOid: base,
      baseRefName: "main",
    });
    await ensurePullRequestCommits(root, pr).catch(() => null);

    const after = (await git("rev-parse", "refs/remotes/origin/main")).stdout.trim();
    assert.equal(after, before, "origin/main moved while reading a PR");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
void GH;
