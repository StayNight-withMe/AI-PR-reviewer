/**
 * Runs inside a real VS Code, driven by @vscode/test-cli.
 *
 * This is the only honest way to test an extension: the editor loads it from its
 * own manifest, activates it, runs its commands and hosts its webview. The Mocha
 * hooks below are the editor's, not a mock. The workspace is the fixture
 * repository that `.vscode-test.cjs` prepared before the window started.
 *
 * The flow is the one a person and an agent share:
 *
 *   open the review → write a comment → the agent resolves it → close → reopen
 *   and see the resolved comment.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = "pr-review.pr-review";
const artifactsRoot = process.env.PR_REVIEW_ARTIFACTS_DIR ?? join(tmpdir(), "pr-review-artifacts");
const TAB_PREFIX = "Review: feature/vscode-test";

suite("PR Review inside a real VS Code window", () => {
  let extension;
  /** The review the extension currently has open, from its own command result. */
  let info;

  suiteSetup(async function () {
    this.timeout(120_000);
    extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, "VS Code did not load the extension package");
    await extension.activate();
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand("prReview.close").catch(() => undefined);
  });

  test("the editor registers both commands", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("prReview.open"), "prReview.open is not registered");
    assert.ok(commands.includes("prReview.close"), "prReview.close is not registered");
  });

  test("Open Review builds the branch diff and opens a webview tab", async function () {
    this.timeout(180_000);

    info = await vscode.commands.executeCommand("prReview.open");

    assert.ok(info, "the command returned no review; it reported a failure instead");
    assert.equal(info.branch, "feature/vscode-test");
    assert.equal(info.files, 1, "the bundled engine found no changed file in the fixture");
    assert.ok(info.url.startsWith("http://127.0.0.1:"), `unexpected url ${info.url}`);

    const response = await fetch(info.url);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /pr-review-data/, "the page did not render its review payload");
    assert.match(html, /app\.ts/, "the changed file is missing from the page");

    const tab = reviewTab();
    assert.ok(tab, "no review tab was opened in the editor");
    assert.ok(tab.input instanceof vscode.TabInputWebview, "the review tab is not a webview");
  });

  test("a comment written on the page lands in the shared thread store", async function () {
    this.timeout(60_000);
    assert.ok(info, "no review is open");

    const response = await fetch(new URL("/api/threads", info.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        comments: [{
          id: "editor-comment",
          path: "app.ts",
          side: "right",
          lineStart: 2,
          lineEnd: 2,
          body: "Why did this constant change?",
          resolved: false,
        }],
      }),
    });
    assert.equal(response.status, 200);

    const store = await findStore(artifactsRoot, "editor-comment");
    assert.ok(store, "the comment was not stored where the next review reads it");
    const saved = JSON.parse(await readFile(store, "utf8"));
    const comment = saved.comments.find((item) => item.id === "editor-comment");
    assert.ok(comment, "the stored comment is missing");
    assert.match(comment.snippet ?? "", /other = 22/, "the code the comment was written on was not recorded");
    assert.equal(comment.resolved, false, "a new comment must be open");
  });

  test("after the agent resolves it, the reopened review shows it resolved", async function () {
    this.timeout(180_000);
    assert.ok(info, "no review is open");

    // The agent's MCP tool writes through this module; nothing about it changes
    // between the editor and the MCP server.
    const { setCommentsResolved } = await import("../../../src/models/resolve-store.js");
    const touched = await setCommentsResolved(
      { outputDir: info.outputDir, repoRoot: info.repo, meta: { repo: info.repo, branch: info.branch, pr: null } },
      ["editor-comment"],
      true,
    );
    assert.deepEqual(touched, ["editor-comment"]);

    // Close and open again, which is what a reviewer does the next morning.
    await vscode.commands.executeCommand("prReview.close");
    await waitUntil(() => !reviewTab(), 10_000);

    info = await vscode.commands.executeCommand("prReview.open");
    assert.ok(info, "the review did not open again");

    const html = await (await fetch(info.url)).text();
    const match = /<script id="pr-review-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    assert.ok(match, "the reopened page lost its payload");
    const comments = JSON.parse(match[1]).comments ?? [];
    const comment = comments.find((item) => item.id === "editor-comment");
    assert.ok(comment, "the comment disappeared from the reopened review");
    assert.equal(comment.resolved, true, "the reopened page still shows the comment as open");
  });

  test("Close Review stops the page and removes the tab", async function () {
    this.timeout(30_000);
    assert.ok(info, "no review is open");

    await vscode.commands.executeCommand("prReview.close");

    let closed = false;
    try {
      await fetch(info.url, { signal: AbortSignal.timeout(2_000) });
    } catch {
      closed = true;
    }
    assert.ok(closed, "the review page still answers after Close Review");

    const gone = await waitUntil(() => !reviewTab(), 10_000);
    assert.ok(gone, "the review tab stayed open after the review was closed");
  });

  test("the package ships the engine, with both same-named modules intact", async () => {
    const root = extension.extensionPath;
    const cli = await readFile(join(root, "server", "src", "cli.js"), "utf8");
    assert.match(cli, /READY_PREFIX|PR_REVIEW_READY/, "the package lacks the launcher");

    // `src/core.js` (the engine) and `src/assets/core.js` (the page client) share
    // a name; a packer that matches by name silently drops one, and the engine
    // then fails to start.
    const serverCore = await readFile(join(root, "server", "src", "core.js"), "utf8");
    assert.match(serverCore, /export async function startReview/, "the server's core.js was overwritten by the page's");
    const clientCore = await readFile(join(root, "server", "src", "assets", "core.js"), "utf8");
    assert.ok(clientCore.length > 0, "the page's core.js is missing");
  });
});

/** The review tab this suite opened, if any. */
function reviewTab() {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .find((tab) => tab.label.startsWith(TAB_PREFIX));
}

/** Finds the thread file that mentions a comment id. */
async function findStore(root, commentId) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const found = await findStore(path, commentId);
      if (found) return found;
    } else if (entry.name.endsWith(".json")) {
      const text = await readFile(path, "utf8").catch(() => "");
      if (text.includes(commentId)) return path;
    }
  }
  return null;
}

async function waitUntil(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}
