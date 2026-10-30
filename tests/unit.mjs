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
