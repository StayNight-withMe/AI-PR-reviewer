
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
    number: 42, title: "T", url: "https://github.com/o/r/pull/42", state: "OPEN", isDraft: true,
    baseRefName: "main", headRefName: "feat", baseRefOid: "b", headRefOid: "h",
    author: { login: "me" }, body: "B", additions: 1, deletions: 2, changedFiles: 3,
  });
  assert.deepEqual(pr, {
    number: 42, title: "T", url: "https://github.com/o/r/pull/42", repo: "o/r", state: "OPEN", draft: true,
    baseRefName: "main", headRefName: "feat", baseOid: "b", headOid: "h",
    author: "me", body: "B", additions: 1, deletions: 2, changedFiles: 3,
  });
});
test("the repository of a PR is read from its URL", () => {


  assert.equal(normalizePullRequest({ url: "https://github.com/acme/shop/pull/7" }).repo, "acme/shop");
  assert.equal(normalizePullRequest({ url: "https://github.com/acme/shop.git/pull/7" }).repo, "acme/shop");
  assert.equal(normalizePullRequest({ url: "U" }).repo, "");
  assert.equal(normalizePullRequest({}).repo, "");
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





  const { root, git } = await makeRepo();
  try {
    const absent = "deadbeef".repeat(5);  
    const pr = normalizePullRequest({ number: 2, headRefOid: absent, baseRefOid: await sha(git), baseRefName: "main" });

    await assert.rejects(ensurePullRequestCommits(root, pr), /fetch|Could not/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("reading a PR never moves the user's remote-tracking refs", async () => {



  const { root, git } = await makeRepo();
  try {

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
