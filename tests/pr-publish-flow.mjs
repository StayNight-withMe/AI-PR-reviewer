/**
 * The whole pull-request flow through the MCP tools.
 *
 * Every piece of this is covered somewhere on its own: PR scoping, the review
 * page, publishing, comment state. What no test did was run them in one
 * sequence, the way a person does — open a PR review, comment on it, read the
 * review back in the chat, resolve a comment, publish it to GitHub. That is
 * where the parts hand work to each other, so that is where this test looks.
 *
 * No network and no account: `gh` is a local mock and the repository is built
 * by the shared fixture.
 *
 * Run: node tests/pr-publish-flow.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrFixture, pullRequestPayload, PR_NUMBER } from "./fixtures/pr-fixture.mjs";
import { GIT, GH, ROUTES } from "../src/config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "src", "index.js");
const MOCK_GH = join(HERE, "fixtures", "mock-gh.mjs");

const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => {
      failures.push(`${name}: ${error.message}`);
      console.log(`FAIL ${name} — ${error.message}`);
    },
  );
}

/** A minimal MCP client over stdio, as a chat client would speak to the server. */
function createClient(env) {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env,
  });
  const pending = new Map();
  let nextId = 1;

  createInterface({ input: child.stdout }).on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    entry.resolve(message);
  });

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 120_000);
    });

  /** Calls a tool and returns its answer text, failing on an MCP-level error. */
  const call = async (name, args) => {
    const response = await request("tools/call", { name, arguments: args });
    const text = (response.result?.content ?? []).map((part) => part.text ?? "").join("\n");
    if (response.error) throw new Error(`${name}: ${response.error.message ?? JSON.stringify(response.error)}`);
    if (response.result?.isError) throw new Error(`${name}: ${text}`);
    return text;
  };

  return { child, request, call };
}

const fixture = await createPrFixture();
const work = await mkdtemp(join(tmpdir(), "pr-review-flow-"));
const ghDb = join(work, "gh.json");
await writeFile(ghDb, JSON.stringify({
  auth: true,
  default: String(PR_NUMBER),
  pullRequests: { [String(PR_NUMBER)]: pullRequestPayload(fixture, PR_NUMBER) },
}));

// The suite must never send a review into the chat that runs it, and its
// artifacts must stay in its own temporary directory.
const env = { ...process.env };
for (const name of ["OPENCODE_SESSION_ID", "OPENCODE_SESSION", "PR_REVIEW_SESSION"]) delete env[name];
env[GIT.ARTIFACTS_DIR_ENV] = join(work, "artifacts");
env[GH.ENV_BIN] = MOCK_GH;
env.MOCK_GH_DB = ghDb;

let client = null;
let reviewId = null;

try {
  client = createClient(env);

  await check("the MCP server starts and answers initialize", async () => {
    const response = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "flow-test", version: "1.0.0" },
    });
    assert.ok(response.result, "no result");
    client.request("notifications/initialized", {}).catch(() => {});
  });

  await check("a pull request opens as a review with its own scope", async () => {
    const text = await client.call("start_review", {
      repoPath: fixture.repo,
      mode: "pr",
      pr: PR_NUMBER,
      sessionId: "",
    });
    assert.match(text, /Review ready:/, `unexpected answer: ${text.slice(0, 300)}`);
    reviewId = /Review ID: (\S+)/.exec(text)?.[1] ?? null;
    assert.ok(reviewId, "the answer has no review id");
    assert.match(text, new RegExp(`#${PR_NUMBER}`), "the answer does not name the pull request");
  });

  const index = JSON.parse(await readFile(join(work, "artifacts", "index.json"), "utf8").catch(() => "null"));

  await check("the review page really serves the PR diff", async () => {
    const entry = await findArtifact(work, "page.json");
    assert.ok(entry, "the page did not register itself");
    const html = await (await fetch(entry.url)).text();
    assert.match(html, /class="pr-badge"/, "the page has no PR badge");
    assert.match(html, /src\/login\.ts/, "the page does not show the PR's added file");
    assert.doesNotMatch(html, /src\/removed\.ts" data-dir="false"/, "a deleted file is offered as a live file");
    void index;
  });

  let outputDir = null;

  await check("a review submitted on the page is stored with the PR", async () => {
    const entry = await findArtifact(work, "page.json");
    outputDir = entry.outputDir;

    const response = await fetch(new URL(ROUTES.API_REVIEW, entry.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewState: "REQUEST_CHANGES",
        reviewBody: "The login is too permissive.",
        comments: [
          { id: "c1", path: "src/login.ts", side: "right", lineStart: 2, lineEnd: 2, body: "This always returns true." },
          { id: "c2", path: "src/app.ts", side: "right", lineStart: 2, lineEnd: 3, body: "Two lines at once." },
        ],
        summary: { files: 6, additions: 10, deletions: 3, comments: 2 },
      }),
    });
    assert.equal(response.status, 200, "the page refused the review");

    const saved = JSON.parse(await readFile(join(outputDir, "review.json"), "utf8"));
    assert.equal(saved.review.reviewState, "REQUEST_CHANGES");
    assert.equal(saved.review.comments.length, 2);
    assert.equal(saved.meta.pr.number, PR_NUMBER, "the saved review lost its pull request");
    assert.equal(saved.meta.pr.repo, "acme/fixture", "the saved review lost the PR repository");
  });

  await check("await_review hands the finished review back to the chat", async () => {
    const text = await client.call("await_review", { reviewId, timeoutSeconds: 30 });
    assert.match(text, /Review submitted \(REQUEST_CHANGES\)/, `unexpected answer: ${text.slice(0, 300)}`);
    assert.match(text, /Inline comments: 2/, "the comment count is wrong");
    assert.match(text, /This always returns true\./, "the inline comment is missing from the answer");
    assert.match(text, /line 2-3/, "the multi-line comment lost its range");
    assert.match(text, /## Pull request|#7/, "the answer does not mention the pull request");
  });

  await check("get_review returns the same review from a saved file", async () => {
    const text = await client.call("get_review", { reviewId });
    assert.match(text, /The login is too permissive\./, "the note is missing");
    assert.match(text, /This always returns true\./, "the comment is missing");
  });

  await check("resolve_comments marks one comment and keeps the other open", async () => {
    const text = await client.call("resolve_comments", { reviewId, ids: ["c1"], resolved: true });
    assert.match(text, /Resolved 1 comment/, `unexpected answer: ${text}`);

    const saved = JSON.parse(await readFile(join(outputDir, "review.json"), "utf8"));
    const byId = Object.fromEntries(saved.review.comments.map((comment) => [comment.id, comment]));
    assert.equal(byId.c1.resolved, true, "the resolved comment is not marked");
    assert.notEqual(byId.c2.resolved, true, "an unrelated comment was resolved too");

    const markdown = await readFile(join(outputDir, "review.md"), "utf8");
    assert.match(markdown, /~~resolved~~/, "review.md does not show the resolved state");
  });

  await check("resolve_comments can reopen everything", async () => {
    await client.call("resolve_comments", { reviewId, resolved: false });
    const saved = JSON.parse(await readFile(join(outputDir, "review.json"), "utf8"));
    assert.ok(saved.review.comments.every((comment) => comment.resolved === false), "a comment stayed resolved");
  });

  await check("publishing posts a real PR review with its inline comments", async () => {
    const text = await client.call("publish_review", { reviewId });
    assert.match(text, /Published to GitHub as REQUEST_CHANGES/, `unexpected answer: ${text}`);
    assert.match(text, /Inline comments: 2/, "the publish answer lost the comments");

    const db = JSON.parse(await readFile(ghDb, "utf8"));
    const posted = db.publishedReviews?.at(-1);
    assert.ok(posted, "nothing was posted to GitHub");
    assert.equal(posted.repo, "acme/fixture", "the review went to the wrong repository");
    assert.equal(posted.number, String(PR_NUMBER), "the review went to the wrong pull request");
    assert.equal(posted.event, "REQUEST_CHANGES", "the verdict was lost");
    assert.match(posted.body, /too permissive/, "the note was lost");
    assert.equal(posted.comments.length, 2, "the inline comments were lost");
    assert.deepEqual(posted.comments[0], {
      path: "src/login.ts", body: "This always returns true.", side: "RIGHT", line: 2,
    });
    assert.equal(posted.comments[1].start_line, 2, "the multi-line comment lost its start");
    assert.equal(posted.comments[1].line, 3, "the multi-line comment lost its end");
  });

  await check("a second publish sends the review again, not a stale copy", async () => {
    // Editing the review on disk and publishing must reflect the edit: the tool
    // reads the saved review each time instead of a copy held in memory.
    await client.call("resolve_comments", { reviewId, resolved: true });
    const text = await client.call("publish_review", { reviewId, reviewState: "APPROVE", reviewBody: "Fixed, thanks." });
    assert.match(text, /Published to GitHub as APPROVE/, `unexpected answer: ${text}`);

    const posted = JSON.parse(await readFile(ghDb, "utf8")).publishedReviews.at(-1);
    assert.equal(posted.event, "APPROVE");
    assert.equal(posted.body, "Fixed, thanks.", "an explicit body did not win");
  });

  await check("a second review of the same repository opens its own page", async () => {
    // Two reviews of one repository (a PR and a working tree, a branch and a
    // range) must coexist. Reusing "whatever page is running" silently opened
    // the older review instead of the requested one.
    const local = await client.call("start_review", {
      repoPath: fixture.repo,
      mode: "uncommitted",
      sessionId: "",
    });
    const localId = /Review ID: (\S+)/.exec(local)?.[1];
    assert.ok(localId, "the second review did not open");
    assert.notEqual(localId, reviewId, "two different scopes got the same review id");

    const prEntry = await findArtifact(work, "page.json", reviewId);
    const localEntry = await findArtifact(work, "page.json", localId);
    assert.ok(localEntry, "the second page did not register itself");
    assert.notEqual(localEntry.url, prEntry.url, "the second review opened the first review's page");
    assert.equal(localEntry.requested.mode, "uncommitted", "the second page shows the wrong scope");

    // The first page must still be the PR review, untouched.
    const html = await (await fetch(prEntry.url)).text();
    assert.match(html, /class="pr-badge"/, "the PR review lost its identity");

    await client.call("close_review", { reviewId: localId }).catch(() => null);
  });

  await check("publishing a local review that is not about a PR is refused", async () => {
    const local = await client.call("start_review", {
      repoPath: fixture.repo,
      mode: "uncommitted",
      sessionId: "",
    });    const localId = /Review ID: (\S+)/.exec(local)?.[1];
    assert.ok(localId, "the local review did not open");

    const entry = await findArtifact(work, "page.json", localId);
    await fetch(new URL(ROUTES.API_REVIEW, entry.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewState: "COMMENT", reviewBody: "", comments: [] }),
    });

    await assert.rejects(
      () => client.call("publish_review", { reviewId: localId }),
      /not about a pull request/,
      "a local review was published as if it were a PR",
    );
    await client.call("close_review", { reviewId: localId }).catch(() => null);
  });

  await check("publishing an unknown review id fails with a clear message", async () => {
    await assert.rejects(
      () => client.call("publish_review", { reviewId: "nope" }),
      /Unknown reviewId/,
      "an unknown id was accepted",
    );
  });

  await check("closing the review stops the page", async () => {
    await client.call("close_review", { reviewId });
    const entry = await findArtifact(work, "page.json");
    if (entry && entry.reviewId === reviewId) {
      const response = await fetch(entry.url).catch(() => null);
      assert.equal(response, null, "the page still answers after close_review");
    }
  });
} finally {
  if (client) client.child.kill();
  await fixture.cleanup();
  await rm(work, { recursive: true, force: true }).catch(() => {});
}

/** Finds a review's artifacts on disk: the newest `page.json`, or the one of an id. */
async function findArtifact(root, name, reviewId) {
  const { readdir } = await import("node:fs/promises");
  const base = join(root, "artifacts");
  const repos = await readdir(base, { withFileTypes: true }).catch(() => []);
  for (const repo of repos) {
    if (!repo.isDirectory()) continue;
    const reviews = await readdir(join(base, repo.name), { withFileTypes: true }).catch(() => []);
    for (const review of reviews) {
      if (!review.isDirectory()) continue;
      if (reviewId && review.name !== reviewId) continue;
      try {
        return JSON.parse(await readFile(join(base, repo.name, review.name, name), "utf8"));
      } catch {
        // Not this folder.
      }
    }
  }
  return null;
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll pull-request flow checks passed");
