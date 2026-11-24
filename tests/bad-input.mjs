
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { GIT, MODE, ROUTES, SERVER } from "../src/config.js";

const exec = promisify(execFile);
const failures = [];

function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

const root = await mkdtemp(join(tmpdir(), "pr-review-bad-input-"));
const repo = join(root, "repo");
const git = (...args) => exec(GIT.BIN, args, { cwd: repo });

try {
  await exec(GIT.BIN, ["init", "--initial-branch", "main", repo]);
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(repo, "a.ts"), "export const a = 1;\n");
  await git("add", "-A");
  await git("commit", "-m", "init");
  await writeFile(join(repo, "a.ts"), "export const a = 1;\nexport const b = 2;\n");

  for (const name of ["OPENCODE_SESSION_ID", "OPENCODE_SESSION"]) delete process.env[name];
  process.env[GIT.ARTIFACTS_DIR_ENV] = join(root, "artifacts");

  const review = await startReview({
    repoPath: repo, mode: MODE.UNCOMMITTED, port: 0, symbols: false,
    dispatchEnabled: false, sessionId: "",
  });

  const post = async (route, body) => {
    const response = await fetch(new URL(route, review.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: response.status, payload: await response.json().catch(() => null) };
  };

  await check("a submit whose comments are not a list still succeeds", async () => {
    const answer = await post(ROUTES.API_REVIEW, { reviewState: "COMMENT", comments: "not a list", reviewBody: "note" });
    assert.equal(answer.status, 200, `the submit was refused: ${JSON.stringify(answer.payload)}`);

    const saved = JSON.parse(await readFile(join(review.outputDir, "review.json"), "utf8"));
    assert.deepEqual(saved.review.comments, []);
    assert.equal(saved.review.reviewBody, "note");
    assert.equal(saved.review.reviewState, "COMMENT");
  });

  await check("null and malformed comments are dropped, not stored", async () => {
    const answer = await post(ROUTES.API_REVIEW, {
      comments: [null, 42, "text", { body: 7 }, { path: "a.ts", side: "right", lineStart: 2, lineEnd: 2, body: "real" }],
    });
    assert.equal(answer.status, 200, `the submit was refused: ${JSON.stringify(answer.payload)}`);

    const saved = JSON.parse(await readFile(join(review.outputDir, "review.json"), "utf8"));
    assert.equal(saved.review.comments.length, 1, `unexpected comments: ${JSON.stringify(saved.review.comments)}`);
    assert.equal(saved.review.comments[0].body, "real");
  });

  await check("an unknown verdict becomes a plain comment", async () => {
    const answer = await post(ROUTES.API_REVIEW, { reviewState: "DELETE EVERYTHING", comments: [] });
    assert.equal(answer.status, 200, "the submit was refused");

    const saved = JSON.parse(await readFile(join(review.outputDir, "review.json"), "utf8"));
    assert.equal(saved.review.reviewState, "COMMENT", "an unknown verdict was stored");
  });

  await check("a body that is not JSON is a plain 400", async () => {
    const answer = await post(ROUTES.API_REVIEW, "{not json");
    assert.equal(answer.status, 400, `unexpected status ${answer.status}`);
    assert.equal(answer.payload.error, SERVER.INVALID_BODY, "the answer does not explain the problem");
  });

  await check("an oversized body is a 400, not a dropped connection", async () => {
    const huge = JSON.stringify({ reviewBody: "x".repeat(SERVER.MAX_BODY_BYTES + 1024) });
    const answer = await post(ROUTES.API_REVIEW, huge);
    assert.equal(answer.status, 400, `unexpected status ${answer.status}`);
    assert.equal(answer.payload.error, SERVER.BODY_TOO_LARGE);
  });

  await check("a long note is kept within the limit", async () => {
    const long = "y".repeat(SERVER.MAX_REVIEW_BODY_CHARS + 500);
    const answer = await post(ROUTES.API_REVIEW, { reviewBody: long, comments: [] });
    assert.equal(answer.status, 200, "the submit was refused");

    const saved = JSON.parse(await readFile(join(review.outputDir, "review.json"), "utf8"));
    assert.equal(saved.review.reviewBody.length, SERVER.MAX_REVIEW_BODY_CHARS, "the note was not clamped");
  });

  await check("a submit with too many comments keeps a bounded number", async () => {
    const many = Array.from({ length: SERVER.MAX_COMMENTS_PER_REVIEW + 25 }, (_, index) => ({
      id: `c${index}`, path: "a.ts", side: "right", lineStart: 2, lineEnd: 2, body: `comment ${index}`,
    }));
    const answer = await post(ROUTES.API_REVIEW, { comments: many });
    assert.equal(answer.status, 200, "the submit was refused");

    const saved = JSON.parse(await readFile(join(review.outputDir, "review.json"), "utf8"));
    assert.equal(saved.review.comments.length, SERVER.MAX_COMMENTS_PER_REVIEW, "the comment list was not bounded");
  });

  await check("a threads save with junk stores nothing", async () => {
    const answer = await post(ROUTES.API_THREADS, { comments: [null, { body: {} }, "x", 7] });
    assert.equal(answer.status, 200, "the save was refused");
    assert.equal(answer.payload.saved, 0, `junk was stored: ${JSON.stringify(answer.payload)}`);
  });

  await check("junk settings are dropped and the page still reads them", async () => {
    const answer = await post(ROUTES.API_SETTINGS, { diffMode: { $ne: null }, treeWidth: "wide", theme: "x".repeat(500) });
    assert.equal(answer.status, 200, "the save was refused");
    assert.deepEqual(answer.payload.settings, {}, `junk was stored: ${JSON.stringify(answer.payload.settings)}`);

    const read = await fetch(new URL(ROUTES.API_SETTINGS, review.url)).then((response) => response.json());
    assert.deepEqual(read.settings, {});
  });

  await check("the page still works after all of that", async () => {
    const html = await fetch(review.url).then((response) => response.text());
    assert.match(html, /^<!DOCTYPE html>/, "the page stopped being served");
    assert.match(html, /pr-review-data/, "the page lost its data block");
  });

  await review.page.close();
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {});
  delete process.env[GIT.ARTIFACTS_DIR_ENV];
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll bad-input checks passed");
