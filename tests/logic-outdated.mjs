
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { GIT, MODE } from "../src/config.js";
import { readThreads } from "../src/models/threads.js";

const exec = promisify(execFile);
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL ${name} — ${error.message}`);
  }
}

const SOURCE = [
  "export const alpha = 1;",
  "export const beta = 2;",
  "export const gamma = 3;",
  "export const delta = 4;",
  "export const epsilon = 5;",
  "",
].join("\n");

const fixture = await mkdtemp(join(tmpdir(), "pr-review-outdated-"));
const git = (...args) => exec(GIT.BIN, args, { cwd: fixture });
await git("init", "--initial-branch", "main");
await git("config", "user.email", "test@example.com");
await git("config", "user.name", "Test");
await git("config", "core.autocrlf", "false");

await writeFile(join(fixture, "a.ts"), SOURCE);
await git("add", "-A");
await git("commit", "-m", "base");


await writeFile(join(fixture, "a.ts"), SOURCE.replace("beta = 2", "beta = 22"));
await git("add", "-A");
await git("commit", "-m", "change beta");

for (const name of ["OPENCODE_SESSION_ID", "OPENCODE_SESSION", "PR_REVIEW_SESSION"]) delete process.env[name];
process.env[GIT.ARTIFACTS_DIR_ENV] = join(fixture, "artifacts");

const base = (await git("rev-parse", "HEAD~1")).stdout.trim();


async function openReview() {
  return startReview({
    repoPath: fixture, mode: MODE.RANGE, base, head: "HEAD",
    port: 0, symbols: true, dispatchEnabled: false, sessionId: "",
  });
}


async function verdicts(page) {
  const response = await fetch(page.url);
  const html = await response.text();
  const match = /<script id="pr-review-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, "the page did not carry its data");
  const data = JSON.parse(match[1]);
  return (data.comments || []).map((comment) => ({
    id: comment.id,
    outdated: comment.outdated === true,
    reason: comment.outdatedReason ?? null,
    snippet: comment.snippet ?? null,
  }));
}

async function writeComment(page, comment) {
  const response = await fetch(new URL("/api/threads", page.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ comments: [comment] }),
  });
  assert.equal(response.status, 200);
}

const COMMENT = {
  id: "comment-beta",
  path: "a.ts",
  side: "right",
  lineStart: 2,
  lineEnd: 2,
  body: "This value is wrong.",
  resolved: false,
};

let page = await openReview();
try {
  await writeComment(page, COMMENT);


  const opened = await openReview();
  await page.page.close();
  page = opened;

  await check("a fresh comment records the code it was written on", async () => {
    const now = await verdicts(page);
    assert.match(now[0].snippet, /beta = 22/);
  });

  await check("a comment whose lines still read the same is not outdated", async () => {
    const now = await verdicts(page);
    assert.equal(now[0].outdated, false);
  });

  await page.page.close();
  page = null;


  await writeFile(join(fixture, "a.ts"), SOURCE.replace("beta = 2", "beta = 999"));
  page = await openReview();
  await check("an uncommitted edit on the commented line makes it outdated", async () => {
    const now = await verdicts(page);
    assert.equal(now[0].outdated, true, "the comment did not notice its line changed");
  });

  await page.page.close();
  page = null;


  await git("checkout", "--", "a.ts");
  page = await openReview();
  await check("restoring the line makes the comment current again", async () => {
    const now = await verdicts(page);
    assert.equal(now[0].outdated, false, "the comment stayed outdated after its code came back");
  });

  await page.page.close();
  page = null;


  await writeFile(join(fixture, "a.ts"),
    SOURCE.replace("beta = 2", "beta = 22").replace("delta = 4", "delta = 44"));
  page = await openReview();
  await check("an edit on another line leaves the comment current", async () => {
    const now = await verdicts(page);
    assert.equal(now[0].outdated, false, "an unrelated edit marked the comment outdated");
  });

  await page.page.close();
  page = null;
  await git("checkout", "--", "a.ts");


  page = await openReview();
  await writeComment(page, { ...COMMENT, id: "comment-gone", path: "gone.ts", lineStart: 1 });
  await page.page.close();
  page = await openReview();
  await check("a comment on a deleted file is outdated with a reason", async () => {
    const now = await verdicts(page);
    const gone = now.find((item) => item.id === "comment-gone");
    assert.equal(gone.outdated, true, "the comment survived its file");
    assert.ok(gone.reason, "there is no reason to show the reviewer");
  });

  await page.page.close();
  page = null;


  page = await openReview();
  await writeComment(page, {
    id: "comment-left",
    path: "a.ts",
    side: "left",
    lineStart: 2,
    lineEnd: 2,
    body: "Removed code.",
    resolved: false,
  });
  await page.page.close();
  page = await openReview();
  await check("a comment on removed code is never outdated", async () => {
    const now = await verdicts(page);
    const left = now.find((item) => item.id === "comment-left");
    assert.equal(left.outdated, false);
  });

  await page.page.close();
  page = null;


  page = await openReview();
  await writeComment(page, {
    id: "comment-file",
    path: "a.ts",
    side: "right",
    lineStart: 0,
    lineEnd: 0,
    body: "The whole file.",
    resolved: false,
  });
  await page.page.close();
  page = await openReview();
  await check("a file comment is never outdated", async () => {
    const now = await verdicts(page);
    const whole = now.find((item) => item.id === "comment-file");
    assert.equal(whole.outdated, false);
  });
} finally {
  if (page) await page.page.close();
  await rm(fixture, { recursive: true, force: true }).catch(() => {});
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll outdated checks passed");
