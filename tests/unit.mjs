
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import { parseDiff, diffStats, languageFor, isBinaryPath } from "../src/diff.js";
import { resolveGitBinary, resetGitBinary, listFiles, listBranches, listBranchHeads, searchProject, diffUncommitted, currentBranch } from "../src/git.js";
import { buildDispatchMessage, buildDispatchPrompt, currentSessionId, dispatchToSession } from "../src/dispatch.js";
import { readFilesForHighlight, splitLines } from "../src/fileview.js";
import { defaultBase, loadScopeCommits } from "../src/models/commits.js";
import { resolveScope } from "../src/models/scope.js";
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
test("a repository without a remote still reviews its branch", async () => {
  const root = await mkdtemp(join(tmpdir(), "pr-review-noremote-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  try {
    await git("init", "--initial-branch", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await writeFile(join(root, "a.ts"), "export const a = 1;\n");
    await git("add", "-A");
    await git("commit", "-m", "base");
    await git("checkout", "-b", "feature/work");
    await writeFile(join(root, "a.ts"), "export const a = 2;\n");
    await git("add", "-A");
    await git("commit", "-m", "change");



    const base = await defaultBase(root);
    assert.equal(base, "main", `a local trunk is the base, got ${base}`);

    const scope = await resolveScope(root, { mode: MODE.BRANCH });
    assert.equal(scope.base, "main");
    assert.match(scope.diffText, /-export const a = 1;/);
    assert.match(scope.diffText, /\+export const a = 2;/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("a head branch is never used as its own base", async () => {
  const root = await mkdtemp(join(tmpdir(), "pr-review-selfbase-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  try {


    await git("init", "--initial-branch", "master");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await writeFile(join(root, "a.ts"), "export const a = 1;\n");
    await git("add", "-A");
    await git("commit", "-m", "base");
    await git("checkout", "-b", "feature/work");
    await writeFile(join(root, "a.ts"), "export const a = 3;\n");
    await git("add", "-A");
    await git("commit", "-m", "change");

    const base = await defaultBase(root);
    assert.equal(base, "master");
    assert.notEqual(base, await currentBranch(root), "the base is the branch itself");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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


    const byName = await searchProject(root, "новый");
    assert.ok(
      byName.some((hit) => hit.path === "docs/новый.md"),
      `the file was not found by its name: ${JSON.stringify(byName)}`,
    );


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


    for (let index = 0; index < 10; index += 1) {
      await commit(`base${index}.txt`, `base work ${index}`);
    }
    const baseTip = (await git("rev-parse", "HEAD")).stdout.trim();
    await git("update-ref", "refs/remotes/origin/dev", baseTip);


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
test("a branch at its base lists no commits instead of the whole history", async () => {
  const root = await mkdtemp(join(tmpdir(), "pr-review-atbase-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  try {
    await git("init", "--initial-branch", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    for (let index = 0; index < 5; index += 1) {
      await writeFile(join(root, `f${index}.txt`), String(index));
      await git("add", "-A");
      await git("commit", "-m", `c${index}`);
    }
    await git("update-ref", "refs/remotes/origin/dev", "HEAD");

    const commits = await loadScopeCommits(root, { commits: [], base: null, head: null });
    assert.equal(commits.length, 0, `expected no commits, got ${commits.length}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("without any base branch the commits tab stays empty, never the whole history", async () => {


  const root = await mkdtemp(join(tmpdir(), "pr-review-nobase-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  try {
    await git("init", "--initial-branch", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");


    for (let index = 0; index < 30; index += 1) {
      await writeFile(join(root, `f${index}.txt`), String(index));
      await git("add", "-A");
      await git("commit", "-m", `commit ${index}`);
    }

    const commits = await loadScopeCommits(root, { commits: [], base: null, head: null });
    assert.equal(commits.length, 0, `expected no commits without a base, got ${commits.length}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("dispatch prompt names the review payload", () => {
  const prompt = buildDispatchPrompt(
    {
      reviewState: "REQUEST_CHANGES",
      reviewBody: "please fix",
      comments: [{ path: "src/App.cs", lineStart: 3, lineEnd: 5, body: "why?" }],
    },
    { repo: "acme/app", branch: "feature", mode: "range", base: "origin/dev", head: "HEAD" },
    { jsonPath: "C:/tmp/review.json", markdownPath: "C:/tmp/review.md" },
  );

  assert.match(prompt, /src\/App\.cs:3-5/);
  assert.match(prompt, /please fix/);
  assert.match(prompt, /origin\/dev\.\.\.HEAD/);
});
test("dispatch message points at the prompt file relative to the repo", () => {
  const message = buildDispatchMessage("C:\\repo\\.pr-review\\abc\\dispatch-prompt.md", "C:\\repo");
  assert.equal(message, "Read .pr-review/abc/dispatch-prompt.md and start fixing the code review described there.");
});
test("current session id comes from the OpenCode environment", () => {
  assert.equal(currentSessionId({ OPENCODE_SESSION_ID: "ses_1" }), "ses_1");
  assert.equal(currentSessionId({ OPENCODE_SESSION: "ses_2" }), "ses_2");
  assert.equal(currentSessionId({}), null);
});
test("dispatch to an unknown session fails instead of creating one", async () => {
  const result = await dispatchToSession("ses_does_not_exist_for_test", "probe", { cwd: process.cwd() });

  assert.equal(result.started, false);
  assert.ok(result.reason, "a failed dispatch must explain itself");
  assert.equal(result.sessionMissing, true);
});
test("dispatch without a session is refused", async () => {
  const result = await dispatchToSession("", "probe", { cwd: process.cwd() });
  assert.equal(result.started, false);
  assert.ok(result.reason);
});
test("highlight reads working-tree content, not HEAD", async () => {
  const root = await mkdtemp(join(tmpdir(), "pr-review-hl-"));
  const file = "src/App.csproj";
  const committed = [
    "<Project>",
    "  <ItemGroup>",
    '    <PackageReference Include="Removed.Package" Version="1.0.0" />',
    "  </ItemGroup>",
    "  <ItemGroup>",
    "    <ProjectReference Include=\"Shared.csproj\" />",
    "  </ItemGroup>",
    "</Project>",
  ];
  const working = [
    "<Project>",
    "  <ItemGroup>",
    "    <ProjectReference Include=\"Shared.csproj\" />",
    "  </ItemGroup>",
    "</Project>",
  ];

  try {
    await exec(GIT.BIN, ["init"], { cwd: root });
    await exec(GIT.BIN, ["config", "user.email", "test@example.com"], { cwd: root });
    await exec(GIT.BIN, ["config", "user.name", "Test"], { cwd: root });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, file), committed.join("\n"));
    await exec(GIT.BIN, ["add", file], { cwd: root });
    await exec(GIT.BIN, ["commit", "-m", "init"], { cwd: root });

    await writeFile(join(root, file), working.join("\n"));

    const result = await readFilesForHighlight(root, [file, "src/Deleted.cs"]);
    assert.deepEqual(result[file].lines, working);
    assert.equal(result["src/Deleted.cs"], null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("an uncommitted diff joins staged+unstaged+untracked without a blank line", async () => {




  const root = await mkdtemp(join(tmpdir(), "pr-review-join-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  try {
    await git("init", "--initial-branch", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await writeFile(join(root, "tracked.txt"), "one\n");
    await git("add", "-A");
    await git("commit", "-m", "init");


    await writeFile(join(root, "tracked.txt"), "one\ntwo\n");
    await git("add", "tracked.txt");
    await writeFile(join(root, "second.txt"), "alpha\n");
    await git("add", "second.txt");
    await writeFile(join(root, "second.txt"), "alpha\nbeta\n");
    await writeFile(join(root, "brand-new.txt"), ["a", "b", "c", ""].join("\n"));

    const text = await diffUncommitted(root, { includeStaged: true, includeUntracked: true });
    const files = parseDiff(text);

    const added = files.find((file) => file.path === "brand-new.txt");
    assert.ok(added, "the untracked file is missing from the diff");
    assert.equal(added.additions, 3, `unexpected additions ${added.additions}`);
    assert.deepEqual(
      added.hunks[0].rows.map((row) => row.kind),
      ["add", "add", "add"],
      "a phantom row was added to the new file",
    );
    assert.deepEqual(added.hunks[0].rows.map((row) => row.content), ["a", "b", "c"]);


    for (const file of files) {
      for (const hunk of file.hunks) {
        const phantom = hunk.rows.filter((row) => row.kind === "meta" && row.content === "");
        assert.equal(phantom.length, 0, `${file.path} has a phantom empty meta row`);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("the tree colours untracked files as added, not unchanged", async () => {


  const root = await mkdtemp(join(tmpdir(), "pr-review-tree-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  try {
    await git("init", "--initial-branch", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await writeFile(join(root, "tracked.txt"), "one\n");
    await git("add", "-A");
    await git("commit", "-m", "init");


    await writeFile(join(root, "tracked.txt"), "one\ntwo\n");
    await writeFile(join(root, "brand-new.txt"), "new\n");

    const tree = await buildProjectTree(root, { mode: MODE.UNCOMMITTED, base: null, head: null });
    const byPath = new Map(tree.map((entry) => [entry.path, entry.status]));

    assert.equal(byPath.get("brand-new.txt"), GIT.STATUS_ADDED_NAME, "the untracked file is not coloured as added");
    assert.equal(byPath.get("tracked.txt"), GIT.STATUS_MODIFIED, "the modified file lost its status");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("a staged new file is added and a staged deletion is deleted", async () => {
  const root = await mkdtemp(join(tmpdir(), "pr-review-tree2-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  try {
    await git("init", "--initial-branch", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await writeFile(join(root, "keep.txt"), "keep\n");
    await writeFile(join(root, "gone.txt"), "gone\n");
    await git("add", "-A");
    await git("commit", "-m", "init");

    await git("rm", "gone.txt");                        
    await writeFile(join(root, "staged-new.txt"), "n\n");
    await git("add", "staged-new.txt");                 

    const tree = await buildProjectTree(root, { mode: MODE.UNCOMMITTED, base: null, head: null });
    const byPath = new Map(tree.map((entry) => [entry.path, entry.status]));

    assert.equal(byPath.get("staged-new.txt"), GIT.STATUS_ADDED_NAME, "a staged new file is not added");
    assert.equal(byPath.get("gone.txt"), GIT.STATUS_DELETED_NAME, "a staged deletion is not deleted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parseDiff keeps a path that contains spaces", () => {
  const text = `diff --git a/sub dir/my file.txt b/sub dir/my file.txt
index 111..222 100644
--- a/sub dir/my file.txt
+++ b/sub dir/my file.txt
@@ -1 +1 @@
-x
+y
`;
  const [file] = parseDiff(text);
  assert.equal(file.path, "sub dir/my file.txt");
  assert.equal(file.oldPath, "sub dir/my file.txt");
  assert.equal(file.newPath, "sub dir/my file.txt");
});
test("parseDiff decodes a fully quoted path", () => {
  const text = `diff --git "a/spaces and such.cs" "b/spaces and such.cs"
--- "a/spaces and such.cs"
+++ "b/spaces and such.cs"
@@ -1 +1 @@
-a
+b
`;
  const [file] = parseDiff(text);
  assert.equal(file.path, "spaces and such.cs");
});
test("parseDiff decodes a git-quoted path with an escaped quote and an octal byte", () => {
  const text = `diff --git "a/quo\\"te.cs" "b/quo\\"te.cs"
--- "a/quo\\"te.cs"
+++ "b/quo\\"te.cs"
@@ -1 +1 @@
-a
+b
`;
  const [file] = parseDiff(text);
  assert.equal(file.path, 'quo"te.cs');

  const octal = `diff --git "a/\\320\\275.md" "b/\\320\\275.md"
--- "a/\\320\\275.md"
+++ "b/\\320\\275.md"
@@ -1 +1 @@
-a
+b
`;
  const [escaped] = parseDiff(octal);
  assert.equal(escaped.path, "\u043d.md", "an octal escape decodes to its byte");
});
test("parseDiff does not add a phantom row for the trailing newline git always writes", () => {
  const text = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-x
+y
`;
  assert.ok(text.endsWith("\n"), "git terminates its output with a newline");
  const [file] = parseDiff(text);
  assert.deepEqual(
    file.hunks[0].rows.map((row) => row.kind),
    ["del", "add"],
    "the trailing newline must not become a meta row",
  );
});
test("splitLines drops the phantom last line of a trailing newline", () => {
  assert.deepEqual(splitLines("a\nb\n"), ["a", "b"]);
  assert.deepEqual(splitLines("a\nb"), ["a", "b"]);
  assert.deepEqual(splitLines(""), []);
  assert.deepEqual(splitLines("only"), ["only"]);

  assert.deepEqual(splitLines("a\n\n"), ["a", ""]);
});
test("a real git diff keeps a file whose path contains a space", async () => {
  const root = await mkdtemp(join(tmpdir(), "pr-review-space-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  try {
    await git("init", "--initial-branch", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await git("config", "core.quotepath", "false");

    await mkdir(join(root, "sub dir"), { recursive: true });
    await writeFile(join(root, "sub dir", "my file.txt"), "x\n");
    await git("add", "-A");
    await git("commit", "-m", "init");
    await writeFile(join(root, "sub dir", "my file.txt"), "y\n");

    const { stdout } = await git("diff", "--no-color", "--no-renames", "--patch", "--", ".");
    const [file] = parseDiff(stdout);
    assert.equal(file.path, "sub dir/my file.txt", "the path must not be split at its space");
    assert.equal(file.additions, 1);
    assert.equal(file.deletions, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("the tail gap never reaches past the last real line", async () => {
  const root = await mkdtemp(join(tmpdir(), "pr-review-tail-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  try {
    await git("init", "--initial-branch", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");

    const before = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
    await writeFile(join(root, "f.txt"), before);
    await git("add", "-A");
    await git("commit", "-m", "init");


    const after = "1\n2\n3\n4\n7\n8\n9\n10\n";
    await writeFile(join(root, "f.txt"), after);

    const { stdout } = await git("-c", "core.quotepath=false", "diff", "-U0", "--no-color", "--no-renames", "--patch", "--", ".");
    const [file] = parseDiff(stdout);
    const lines = splitLines(after);
    assert.equal(lines.length, 8, "the trailing newline is not a line");

    const { totalLines, gaps } = computeGaps(file, lines);
    assert.equal(totalLines, 8);
    const tail = gaps.find((gap) => gap.dir === "down");
    assert.equal(tail.newEnd, 8, "the tail gap must stop at the last real line");
    assert.equal(tail.count, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a file staged as new and edited again appears once in the uncommitted diff", async () => {





  const root = await mkdtemp(join(tmpdir(), "pr-review-staged-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  try {
    await git("init", "--initial-branch", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await git("config", "core.autocrlf", "false");
    await writeFile(join(root, "base.txt"), "base\n");
    await git("add", "-A");
    await git("commit", "-m", "init");


    const content = ["class ApiRoutes", "{", "}"].join("\n");
    await writeFile(join(root, "ApiRoutes.cs"), `${content}\n`);
    await git("add", "ApiRoutes.cs");
    await writeFile(join(root, "ApiRoutes.cs"), `${content}\n// added later\n`);

    const text = await diffUncommitted(root, { includeStaged: true, includeUntracked: true });
    const files = parseDiff(text).filter((file) => file.path === "ApiRoutes.cs");

    assert.equal(files.length, 1, `the file must appear once, got ${files.length}`);
    assert.equal(files[0].status, "added");

    assert.equal(files[0].hunks.length, 1);
    const rows = files[0].hunks[0].rows.map((row) => row.content);
    assert.equal(rows.filter((row) => row === "}").length, 1, "the closing brace must not be duplicated");
    assert.ok(rows.includes("// added later"), "the unstaged edit must be part of the same patch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every mapped language is registered in the client bundle", async () => {



  const { DIFF } = await import("../src/config.js");
  const bundlePath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "hljs-bundle.js");
  const bundle = await readFile(bundlePath, "utf8");

  const registered = new Set(
    [...bundle.matchAll(/hljs\.registerLanguage\("([^"]+)"/g)].map((match) => match[1]),
  );
  const mapped = new Set(Object.values(DIFF.LANGUAGE_BY_EXTENSION));
  mapped.delete(DIFF.LANGUAGE.PLAINTEXT);

  const missing = [...mapped].filter((language) => !registered.has(language));
  assert.deepEqual(missing, [], `these languages render as plain text: ${missing.join(", ")}`);
  assert.ok(registered.size >= 20, `the bundle registers only ${registered.size} languages`);
});

