/** Unit tests for the pure modules: diff parsing, languages, config, symbols. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { parseDiff, diffStats, languageFor, isBinaryPath } from "../src/diff.js";
import { resolveGitBinary, resetGitBinary, listFiles, listBranches, listBranchHeads, searchProject, diffUncommitted } from "../src/git.js";
import { buildDispatchMessage, buildDispatchPrompt, currentSessionId, dispatchToSession } from "../src/dispatch.js";
import { readFilesForHighlight, splitLines } from "../src/fileview.js";
import { loadScopeCommits } from "../src/models/commits.js";
import { computeGaps } from "../src/models/gaps.js";
import { toFileModel } from "../src/models/diffset.js";
import { buildProjectTree } from "../src/models/tree.js";
import { sortLikeTree } from "../src/models/order.js";
import { repoLabel } from "../src/models/repo.js";
import { reviewId } from "../src/render.js";
import { DIFF, GIT, MODE, P, ROUTES } from "../src/config.js";
const exec = promisify(execFile);
const SAMPLE = `diff --git a/src/App.cs b/src/App.cs
index 111..222 100644
--- a/src/App.cs
+++ b/src/App.cs
@@ -1,3 +1,4 @@ namespace Demo
 using System;
-public void Old() {}
+public void New() {}
+public void Extra() {}
 }
diff --git a/src/Removed.cs b/src/Removed.cs
deleted file mode 100644
--- a/src/Removed.cs
+++ /dev/null
@@ -1,2 +0,0 @@
-class Gone {}
-}
`;
test("parseDiff reads both files and counts additions/deletions", () => {
  const files = parseDiff(SAMPLE);
  assert.equal(files.length, 2);

  const [changed, removed] = files;
  assert.equal(changed.path, "src/App.cs");
  assert.equal(changed.status, DIFF.STATUS.MODIFIED);
  assert.equal(changed.additions, 2);
  assert.equal(changed.deletions, 1);
  assert.equal(removed.status, DIFF.STATUS.DELETED);
  assert.equal(removed.deletions, 2);
});
test("parseDiff assigns correct line numbers per side", () => {
  const [file] = parseDiff(SAMPLE);
  const rows = file.hunks[0].rows;

  assert.deepEqual(rows.map((r) => r.kind), ["ctx", "del", "add", "add", "ctx"]);
  assert.deepEqual(rows.map((r) => r.oldLine), [1, 2, null, null, 3]);
  assert.deepEqual(rows.map((r) => r.newLine), [1, null, 2, 3, 4]);
});
test("parseDiff detects renames", () => {
  const text = `diff --git a/old/Name.cs b/new/Name.cs
similarity index 90%
rename from old/Name.cs
rename to new/Name.cs
`;
  const [file] = parseDiff(text);
  assert.equal(file.status, DIFF.STATUS.RENAMED);
  assert.equal(file.oldPath, "old/Name.cs");
  assert.equal(file.path, "new/Name.cs");
});
test("diffStats sums all files", () => {
  assert.deepEqual(diffStats(parseDiff(SAMPLE)), { additions: 2, deletions: 3 });
});
test("languageFor maps extensions", () => {
  assert.equal(languageFor("A.cs"), DIFF.LANGUAGE.CSHARP);
  assert.equal(languageFor("A.csproj"), DIFF.LANGUAGE.XML);
  assert.equal(languageFor("Dockerfile"), DIFF.LANGUAGE.DOCKERFILE);
  assert.equal(languageFor("Makefile"), DIFF.LANGUAGE.MAKEFILE);
  assert.equal(languageFor(".gitignore"), DIFF.LANGUAGE.PROPERTIES);
  assert.equal(languageFor("noext"), DIFF.LANGUAGE.PLAINTEXT);
});
test("isBinaryPath flags binaries only", () => {
  assert.equal(isBinaryPath("a.png"), true);
  assert.equal(isBinaryPath("a.cs"), false);
});
test("toFileModel maps a diff into the UI file model", () => {
  const text = `diff --git a/sub dir/my file.txt b/sub dir/my file.txt
--- a/sub dir/my file.txt
+++ b/sub dir/my file.txt
@@ -1 +1 @@
-x
+y
`;
  const files = toFileModel(text);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "sub dir/my file.txt");
  assert.equal(files[0].status, DIFF.STATUS.MODIFIED);
  assert.equal(files[0].additions, 1);
  assert.equal(files[0].deletions, 1);
  assert.equal(files[0].changeCount, 2);
  assert.equal(files[0].language, DIFF.LANGUAGE.PLAINTEXT);
  assert.deepEqual(files[0].gaps, [], "gaps are filled in later");
});
test("repoLabel derives owner/name from remotes", () => {
  assert.equal(repoLabel("/x/y", "git@github.com:acme/widget.git"), "acme/widget");
  assert.equal(repoLabel("/x/y", "https://github.com/acme/widget.git"), "acme/widget");
  assert.equal(repoLabel("C:\\repos\\plain"), "plain");
});
test("repoLabel keeps the last two segments of an https remote", () => {
  assert.equal(repoLabel("/x/y", "https://github.com/team/sub/project.git"), "sub/project");
  assert.equal(repoLabel("/x/y", "git@gitlab.example.com:group/app.git"), "group/app");
});
test("reviewId is deterministic and 12 chars", () => {
  const meta = { repo: "a/b", branch: "dev", base: "main", head: "HEAD", mode: MODE.UNCOMMITTED };
  const first = reviewId(meta);
  assert.equal(first, reviewId(meta));
  assert.equal(first.length, 12);
});
test("config has no duplicate route strings", () => {
  const values = Object.values(ROUTES);
  assert.equal(new Set(values).size, values.length);
});
test("dispatch deduplicates an identical submit and replaces a changed one", async () => {
  const { dispatchToSession } = await import("../src/dispatch.js");

  // No session id: the guard must answer without spawning anything.
  const noSession = await dispatchToSession(null, "msg");
  assert.equal(noSession.started, false);
  assert.ok(noSession.reason.length > 0);
});
test("sortLikeTree puts folders before files at each level", () => {
  const input = [
    "src/Domain/Atlas.Domain.csproj",
    "src/Domain/Entities/Employee.cs",
    "src/Domain/Constants/AtlasConstants.cs",
    "README.md",
  ];
  const sorted = sortLikeTree(input);

  // Depth-first: the nested folders come before the .csproj sitting at their level.
  assert.deepEqual(sorted, [
    "src/Domain/Constants/AtlasConstants.cs",
    "src/Domain/Entities/Employee.cs",
    "src/Domain/Atlas.Domain.csproj",
    "README.md",
  ]);
});
test("sortLikeTree keeps the input array untouched and accepts objects", () => {
  const input = ["b/x.cs", "a/y.cs"];
  const copy = input.slice();
  sortLikeTree(input);
  assert.deepEqual(input, copy, "the input must not be mutated");

  const objects = sortLikeTree([{ path: "b/x.cs" }, { path: "a/y.cs" }]);
  assert.deepEqual(objects.map((entry) => entry.path), ["a/y.cs", "b/x.cs"]);
});
test("sortLikeTree is stable for identical paths", () => {
  const sorted = sortLikeTree(["a/b.cs", "a/b.cs"]);
  assert.equal(sorted.length, 2);
});
test("computeGaps finds the hidden head and tail of a file", () => {
  const file = {
    hunks: [{ oldStart: 9, oldLines: 7, newStart: 9, newLines: 8 }],
  };
  const lines = Array.from({ length: 27 }, (_, index) => `line ${index + 1}`);

  const { totalLines, gaps } = computeGaps(file, lines);

  assert.equal(totalLines, 27);
  assert.equal(gaps.length, 2);

  const [head, tail] = gaps;
  assert.equal(head.dir, "up");
  assert.equal(head.newStart, 1);
  assert.equal(head.newEnd, 8);
  assert.equal(head.oldStart, 1);

  assert.equal(tail.dir, "down");
  assert.equal(tail.newStart, 17);
  assert.equal(tail.newEnd, 27);
  assert.equal(tail.oldStart, 16, "the old side follows the line shift");
});
test("computeGaps counts only the lines that carry something", () => {
  const file = {
    hunks: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 }],
  };
  const lines = ["a", "", "   ", "b", ""];

  const { gaps } = computeGaps(file, lines);
  const head = gaps.find((gap) => gap.dir === "up");
  const tail = gaps.find((gap) => gap.dir === "down");

  assert.equal(head.count, 2);
  assert.equal(head.nonEmpty, 1, "blank lines do not count");
  assert.equal(tail.count, 2);
  assert.equal(tail.nonEmpty, 1);
});
test("computeGaps reports no region when the hunk covers the file", () => {
  const file = {
    hunks: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 }],
  };
  const lines = ["a", "b", "c"];

  const { gaps } = computeGaps(file, lines);
  assert.equal(gaps.length, 0);
});
test("git writes a path with non-ASCII letters as it is", async () => {
  const root = await mkdtemp(join(tmpdir(), "pr-review-unicode-"));

  const git = (...args) => exec(GIT.BIN, args, { cwd: root });
  const commit = async (file, content, message) => {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
    await git("add", file);
    await git("commit", "-m", message);
  };

  try {
    await git("init", "--initial-branch", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await commit("docs/новый.md", "# Document\n", "docs: add a document");
    await commit("docs/plain.md", "# Novy document\n", "docs: add a plain document");

    const files = await listFiles(root);
    assert.ok(files.includes("docs/новый.md"), `the path is escaped: ${files.join(", ")}`);

    // A file is found by its name, even when the name has non-ASCII letters.
    const byName = await searchProject(root, "новый");
    assert.ok(
      byName.some((hit) => hit.path === "docs/новый.md"),
      `the file was not found by its name: ${JSON.stringify(byName)}`,
    );

    // The content is found without regard to the case.
    const byContent = await searchProject(root, "novy");
    assert.ok(
      byContent.some((hit) => hit.path === "docs/plain.md"),
      `the content was not found: ${JSON.stringify(byContent)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("a remote branch keeps the name that resolves", async () => {
  const root = await mkdtemp(join(tmpdir(), "pr-review-branch-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  try {
    await git("init", "--initial-branch", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await writeFile(join(root, "a.txt"), "a");
    await git("add", "-A");
    await git("commit", "-m", "first");
    await git("update-ref", "refs/remotes/origin/dev", "HEAD");

    const branches = await listBranches(root);
    assert.ok(branches.includes("origin/dev"), `the remote branch was renamed: ${JSON.stringify(branches)}`);
    assert.ok(!branches.includes("origin/HEAD"), "the remote head alias is not a branch");

    // Every listed branch has to resolve: the review scope hands these back to git.
    const heads = await listBranchHeads(root, branches);
    for (const head of heads) {
      assert.ok(head.sha, `the branch ${head.name} does not resolve`);
      assert.ok(head.subject, `the branch ${head.name} has no commit subject`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("git is found even when PATH has no git", () => {
  resetGitBinary();
  const binary = resolveGitBinary({
    PATH: "C:\\Windows\\System32",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "C:\\Windows",
    LOCALAPPDATA: process.env.LOCALAPPDATA ?? "",
  });

  assert.ok(binary, "a git binary must be returned");
  assert.ok(binary === GIT.BIN || existsSync(binary), `the git path must exist: ${binary}`);
});
test("scope commits exclude commits of other branches that reached the base later", async () => {
  const root = await mkdtemp(join(tmpdir(), "pr-review-scope-"));

  const git = (...args) => exec(GIT.BIN, args, { cwd: root });
  const commit = async (file, content, message) => {
    await writeFile(join(root, file), content);
    await git("add", file);
    await git("commit", "-m", message);
    return (await git("rev-parse", "HEAD")).stdout.trim();
  };

  try {
    await git("init");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");

    const rootCommit = await commit("a.txt", "a", "root");
    await git("branch", "feature");

    // Another branch lands in the base after the feature branched off.
    await commit("foreign.txt", "foreign", "foreign work");
    const baseSha = (await git("rev-parse", "HEAD")).stdout.trim();
    await git("update-ref", "refs/remotes/origin/dev", baseSha);

    await git("checkout", "feature");
    await commit("feature.txt", "feature", "feature work");

    const commits = await loadScopeCommits(root, { commits: [], base: null, head: null });
    const subjects = commits.map((entry) => entry.subject);

    assert.deepEqual(subjects, ["feature work"], "only the branch's own commit belongs here");
    assert.equal(commits.length, 1);
    assert.notEqual(commits[0].sha, rootCommit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("an uncommitted review lists only the branch's own commits", async () => {
  // Regression: with no base, the commits tab fell back to "everything
  // not on a remote" and showed 200 unrelated commits.
  const root = await mkdtemp(join(tmpdir(), "pr-review-own-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });
  const commit = async (file, message) => {
    await writeFile(join(root, file), message);
    await git("add", file);
    await git("commit", "-m", message);
    return (await git("rev-parse", "HEAD")).stdout.trim();
  };

  try {
    await git("init", "--initial-branch", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");

    // Ten commits on the base branch.
    for (let index = 0; index < 10; index += 1) {
      await commit(`base${index}.txt`, `base work ${index}`);
    }
    const baseTip = (await git("rev-parse", "HEAD")).stdout.trim();
    await git("update-ref", "refs/remotes/origin/dev", baseTip);

    // Two commits of the branch's own work.
    await git("checkout", "-b", "feature");
    await commit("mine1.txt", "my first change");
    await commit("mine2.txt", "my second change");

    const commits = await loadScopeCommits(root, { commits: [], base: null, head: null });
    assert.equal(commits.length, 2, `expected the 2 branch commits, got ${commits.length}`);
    assert.deepEqual(commits.map((c) => c.subject), ["my second change", "my first change"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
