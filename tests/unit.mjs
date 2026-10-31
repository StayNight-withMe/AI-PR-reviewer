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
