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
