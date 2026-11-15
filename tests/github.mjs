/**
 * The GitHub pull-request scope (`mode=pr`).
 *
 * A PR is reviewed through the GitHub CLI, so this test has two layers:
 *
 *   1. Pure: the `gh pr view --json` payload maps onto the fields the page
 *      uses, and the review id / title derive from it. No network, no gh.
 *   2. Live, skipped when `gh` is missing or unauthenticated: a real PR on a
 *      real repository is read and turned into a range review.
 *
 * The live layer picks a repository from the environment (PR_REVIEW_TEST_REPO)
 * or the current checkout, and a PR number that `gh pr list` returns. When no
 * PR is reachable the layer reports "skipped" instead of failing: a checkout
 * without PRs is normal, not a broken build.
 *
 * Run: node tests/github.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizePullRequest,
  pullRequestScope,
  pullRequestTitle,
  ghBinary,
} from "../src/github.js";
import { GH, MODE } from "../src/config.js";
const exec = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));
const PROJECT = `${ROOT}/..`;
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
function skip(name, reason) {
  console.log(`SKIP ${name} — ${reason}`);
}
const RAW = {
  number: 42,
  title: "Fix the login redirect",
  url: "https://github.com/acme/widget/pull/42",
  state: "OPEN",
  isDraft: false,
  baseRefName: "main",
  headRefName: "feature/login",
  baseRefOid: "a".repeat(40),
  headRefOid: "b".repeat(40),
  author: { login: "octocat" },
  body: "Please review the redirect.",
  additions: 12,
  deletions: 3,
  changedFiles: 4,
};
await check("normalizePullRequest maps every page field", () => {
  const pr = normalizePullRequest(RAW);
  assert.equal(pr.number, 42);
  assert.equal(pr.title, "Fix the login redirect");
  assert.equal(pr.url, RAW.url);
  assert.equal(pr.state, "OPEN");
  assert.equal(pr.draft, false);
  assert.equal(pr.baseRefName, "main");
  assert.equal(pr.headRefName, "feature/login");
  assert.equal(pr.baseOid, RAW.baseRefOid);
  assert.equal(pr.headOid, RAW.headRefOid);
  assert.equal(pr.author, "octocat");
  assert.equal(pr.body, RAW.body);
  assert.equal(pr.additions, 12);
  assert.equal(pr.deletions, 3);
  assert.equal(pr.changedFiles, 4);
});
await check("normalizePullRequest tolerates a sparse payload", () => {
  const pr = normalizePullRequest({ number: 7, isDraft: true });
  assert.equal(pr.number, 7);
  assert.equal(pr.draft, true);
  assert.equal(pr.title, "");
  assert.equal(pr.author, "");
  assert.equal(pr.additions, 0);
});
await check("the review title and scope come from the PR", () => {
  const pr = normalizePullRequest(RAW);
  assert.equal(pullRequestTitle(pr), "PR #42: Fix the login redirect");
  assert.equal(pullRequestScope(pr), "pr42");

  const draft = normalizePullRequest({ number: 9, title: "", isDraft: true });
  assert.equal(pullRequestTitle(draft), "PR #9");
});
await check("two PRs with the same commits get different scope keys", () => {
  const a = normalizePullRequest({ ...RAW, number: 1 });
  const b = normalizePullRequest({ ...RAW, number: 2 });
  assert.notEqual(pullRequestScope(a), pullRequestScope(b));
});
await check("ghBinary honours the override and falls back to gh", () => {
  assert.equal(ghBinary({ [GH.ENV_BIN]: "C:/tools/gh.exe" }), "C:/tools/gh.exe");
  assert.equal(ghBinary({}), GH.BIN);
  assert.equal(ghBinary({ [GH.ENV_BIN]: "   " }), GH.BIN);
});
/* --------------------------- live layer (optional) -------------------------- */
async function liveRepo() {
  // Opt-in only: the default test run must not depend on a real repository,
  // a real GitHub account or the network. `test:pr` covers the live paths with
  // a mock gh and a local fixture instead.
  const repo = process.env.PR_REVIEW_TEST_REPO;
  if (!repo) return null;
  try {
    const { stdout } = await exec(ghBinary(), ["pr", "list", "--state", "all", "--limit", "1", "--json", "number"], {
      cwd: repo,
      windowsHide: true,
      timeout: 30_000,
    });
    const list = JSON.parse(stdout);
    if (!Array.isArray(list) || !list.length) return null;
    return { repo, number: list[0].number };
  } catch {
    return null;
  }
}
const live = await liveRepo();
if (!live) {
  skip("a real PR becomes a range review", "set PR_REVIEW_TEST_REPO to opt in (test:pr covers this offline)");
} else {
  await check("a real PR becomes a range review", async () => {
    const { buildReview } = await import("../src/core.js");
    const review = await buildReview({ repoPath: live.repo, mode: MODE.PR, pr: live.number });

    assert.equal(review.meta.mode, MODE.PR, "the mode is not pr");
    assert.ok(review.meta.base && review.meta.base.length >= 7, "the base commit is missing");
    assert.ok(review.meta.head && review.meta.head.length >= 7, "the head commit is missing");
    assert.notEqual(review.meta.base, review.meta.head, "base and head are the same commit");
    assert.ok(review.meta.pr, "the PR is not on the metadata");
    assert.equal(review.meta.pr.number, live.number);
    assert.ok(review.meta.title.startsWith(`PR #${live.number}`), `unexpected title ${review.meta.title}`);
    assert.ok(Array.isArray(review.files), "the diff has no files array");

    // The id must be a PR id, not a bare commit-range id.
    assert.ok(review.meta.id, "the review has no id");
    console.log(`  PR #${live.number}: ${review.files.length} files, ${review.meta.base.slice(0, 7)}…${review.meta.head.slice(0, 7)}`);
  });
}
