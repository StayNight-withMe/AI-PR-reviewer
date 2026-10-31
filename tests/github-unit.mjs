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
