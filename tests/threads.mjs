
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { GIT, MODE } from "../src/config.js";

const exec = promisify(execFile);
const failures = [];

function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

const root = await mkdtemp(join(tmpdir(), "pr-review-threads-"));

process.env[GIT.ARTIFACTS_DIR_ENV] = join(root, "artifacts");

const git = (...args) => exec(GIT.BIN, args, { cwd: join(root, "repo") });

const COMMENT = {
  id: "c1",
  path: "app.js",
  side: "right",
  lineStart: 2,
  lineEnd: 2,
  body: "This line needs a guard",
};


async function openReview() {
  const head = (await git("rev-parse", "HEAD")).stdout.trim();
  const base = (await git("rev-parse", "HEAD~1")).stdout.trim();
  return startReview({
    repoPath: join(root, "repo"),
    mode: MODE.RANGE,
    base,
    head,
    port: 0,
    symbols: false,
    dispatchEnabled: false,
    sessionId: "",
  });
}


async function commentsOnPage() {
  const review = await openReview();
  try {
    const html = await (await fetch(review.url)).text();
    const match = /<script id="pr-review-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    assert.ok(match, "the page did not carry its data block");
    return JSON.parse(match[1]).comments;
  } finally {
    await review.page.close();
  }
}

try {
  await mkdir(join(root, "repo"), { recursive: true });
  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");

  await writeFile(join(root, "repo", "app.js"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");
  await git("add", "-A");
  await git("commit", "-m", "init");

  await writeFile(join(root, "repo", "app.js"), "const a = 1;\nconst b = 20;\nconst c = 3;\n");
  await git("add", "-A");
  await git("commit", "-m", "change b");

  await check("a submitted comment comes back on the next review of the same scope", async () => {
    const review = await openReview();
    try {
      const response = await fetch(new URL("/api/review", review.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewState: "REQUEST_CHANGES",
          reviewBody: "",
          comments: [COMMENT],
          summary: { files: 1, additions: 1, deletions: 1, comments: 1 },
        }),
      });
      assert.equal(response.status, 200, "the review was not saved");
    } finally {
      await review.page.close();
    }

    const comments = await commentsOnPage();
    assert.equal(comments.length, 1, "the comment did not survive the reopen");
    assert.equal(comments[0].body, COMMENT.body);
    assert.ok(comments[0].snippet.includes("const b = 20;"), "the commented lines were not recorded");
    assert.notEqual(comments[0].outdated, true, "an untouched comment must not be outdated");
  });

  await check("a comment stays visible after the file is edited", async () => {


    await writeFile(join(root, "repo", "app.js"), "const a = 1;\nconst b = 20;\nconst c = 30;\n");
    const comments = await commentsOnPage();
    assert.equal(comments.length, 1, "the comment disappeared after an unrelated edit");
    assert.notEqual(comments[0].outdated, true, "an untouched line must not be outdated");
  });

  await check("editing the commented line marks the comment outdated", async () => {
    await writeFile(join(root, "repo", "app.js"), "const a = 1;\nconst b = 99;\nconst c = 30;\n");
    const comments = await commentsOnPage();
    assert.equal(comments.length, 1, "the comment disappeared");
    assert.equal(comments[0].outdated, true, "the comment should be outdated");
    assert.ok(comments[0].outdatedReason, "an outdated comment must say why");

    assert.ok(comments[0].snippet.includes("const b = 20;"), "the snippet was replaced by the edited line");
  });

  await check("a file comment is never outdated", async () => {
    const review = await openReview();
    try {
      const response = await fetch(new URL("/api/review", review.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewState: "REQUEST_CHANGES",
          reviewBody: "",
          comments: [{ id: "c2", path: "app.js", side: "right", lineStart: 0, lineEnd: 0, body: "whole file" }],
          summary: { files: 1, additions: 1, deletions: 1, comments: 1 },
        }),
      });
      assert.equal(response.status, 200);
    } finally {
      await review.page.close();
    }

    const comments = await commentsOnPage();
    const fileComment = comments.find((comment) => comment.id === "c2");
    assert.ok(fileComment, "the file comment was lost");
    assert.notEqual(fileComment.outdated, true, "a file comment has no lines to become outdated");
  });

  await check("a comment on a removed line is not declared outdated", async () => {




    await writeFile(join(root, "repo", "app.js"), "const a = 1;\nconst c = 3;\n");
    const review = await openReview();
    try {
      const response = await fetch(new URL("/api/review", review.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewState: "REQUEST_CHANGES",
          reviewBody: "",
          comments: [{ id: "c3", path: "app.js", side: "left", lineStart: 2, lineEnd: 2, body: "why remove this?" }],
          summary: { files: 1, additions: 0, deletions: 1, comments: 1 },
        }),
      });
      assert.equal(response.status, 200);
    } finally {
      await review.page.close();
    }

    const comments = await commentsOnPage();
    const removed = comments.find((comment) => comment.id === "c3");
    assert.ok(removed, "the comment on the removed line was lost");
    assert.notEqual(removed.outdated, true, "a comment on removed code was called outdated");
    assert.equal(removed.snippet ?? "", "", "a snippet was taken from the current file for a removed line");
  });

  await check("an older removed-side comment that carries a snippet is not outdated", async () => {


    const review = await openReview();
    try {
      await fetch(new URL("/api/threads", review.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          comments: [{
            id: "c4",
            path: "app.js",
            side: "left",
            lineStart: 2,
            lineEnd: 2,
            body: "legacy comment",
            snippet: "const b = 20;",
          }],
        }),
      });
    } finally {
      await review.page.close();
    }

    const comments = await commentsOnPage();
    const legacy = comments.find((comment) => comment.id === "c4");
    assert.ok(legacy, "the legacy comment was lost");
    assert.notEqual(legacy.outdated, true, "a removed-side comment was called outdated");
  });

  await check("the page can store and re-read comments through its API", async () => {
    const review = await openReview();
    try {
      const saved = await fetch(new URL("/api/threads", review.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comments: [COMMENT] }),
      }).then((response) => response.json());

      assert.equal(saved.ok, true, "the threads endpoint refused the comments");
      assert.equal(saved.saved, 1);
    } finally {
      await review.page.close();
    }

    const comments = await commentsOnPage();
    assert.equal(comments.length, 1, "the stored comment is not on the next page");
  });
} finally {
  await rm(root, { recursive: true, force: true });
  delete process.env[GIT.ARTIFACTS_DIR_ENV];
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll review-thread checks passed");
