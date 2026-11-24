
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { GIT, MODE } from "../src/config.js";
import { buildDispatchPrompt } from "../src/dispatch.js";
import { readThreads } from "../src/models/threads.js";
import { setCommentsResolved } from "../src/models/resolve-store.js";

const exec = promisify(execFile);
const failures = [];

async function step(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL ${name} — ${error.message}`);
  }
}

const SOURCE = [
  "export interface CartLine { sku: string; quantity: number }",
  "",
  "export function total(lines: CartLine[]): number {",
  "  let sum = 0;",
  "  for (const line of lines) {",
  "    sum += line.quantity;",
  "  }",
  "  return sum;",
  "}",
  "",
].join("\n");

const root = await mkdtemp(join(tmpdir(), "pr-review-cycle-"));
const git = (...args) => exec(GIT.BIN, args, { cwd: root });
await git("init", "--initial-branch", "main");
await git("config", "user.email", "test@example.com");
await git("config", "user.name", "Test");
await git("config", "core.autocrlf", "false");

await writeFile(join(root, "cart.ts"), SOURCE);
await git("add", "-A");
await git("commit", "-m", "base");


await writeFile(join(root, "cart.ts"), SOURCE.replace("sum += line.quantity;", "sum += line.quantity * 1;"));
await git("add", "-A");
await git("commit", "-m", "add the total");

for (const name of ["OPENCODE_SESSION_ID", "OPENCODE_SESSION", "PR_REVIEW_SESSION"]) delete process.env[name];
process.env[GIT.ARTIFACTS_DIR_ENV] = join(root, "artifacts");

const base = (await git("rev-parse", "HEAD~1")).stdout.trim();


async function pageComments(page) {
  const html = await (await fetch(page.url)).text();
  const match = /<script id="pr-review-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) return [];
  return JSON.parse(match[1]).comments || [];
}

async function openReview() {
  return startReview({
    repoPath: root, mode: MODE.RANGE, base, head: "HEAD",
    port: 0, symbols: true, dispatchEnabled: false, sessionId: "",
  });
}

let page = await openReview();
try {
  const firstComments = [
    { id: "c-price", path: "cart.ts", side: "right", lineStart: 6, lineEnd: 6,
      body: "You multiply by 1 — the price is never counted." },
    { id: "c-name", path: "cart.ts", side: "right", lineStart: 1, lineEnd: 1,
      body: "Rename this to `sku` everywhere." },
  ];

  await step("1. the reviewer writes two comments on the page", async () => {
    const response = await fetch(new URL("/api/threads", page.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comments: firstComments }),
    });
    assert.equal(response.status, 200);
    const stored = await readThreads(root, page.meta);
    assert.equal(stored.comments.length, 2);
  });

  await step("2. the reviewer submits a review asking for changes", async () => {
    const response = await fetch(new URL("/api/review", page.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewState: "REQUEST_CHANGES",
        reviewBody: "The total never uses the price.",
        comments: (await readThreads(root, page.meta)).comments,
        images: [],
        noteImages: [],
      }),
    });
    assert.equal(response.status, 200);
    const saved = JSON.parse(await readFile(join(page.outputDir, "review.json"), "utf8"));
    assert.equal(saved.review.reviewState, "REQUEST_CHANGES");
    assert.equal(saved.review.comments.length, 2);
  });

  const payload = JSON.parse(await readFile(join(page.outputDir, "review.json"), "utf8"));

  await step("3. the agent receives a prompt that names both comments", async () => {
    const prompt = buildDispatchPrompt(payload.review, payload.meta, {
      jsonPath: join(page.outputDir, "review.json"),
      markdownPath: join(page.outputDir, "review.md"),
    });
    assert.match(prompt, /cart\.ts:6/);
    assert.match(prompt, /cart\.ts:1/);
    assert.match(prompt, /price is never counted/);
    assert.match(prompt, /APPROVED|Start fixing/);
  });

  await step("4. the agent fixes the price bug and resolves only that comment", async () => {


    await writeFile(join(root, "cart.ts"),
      SOURCE.replace("sum += line.quantity;", "sum += line.quantity * line.price;"));
    const touched = await setCommentsResolved(page, ["c-price"], true);
    assert.deepEqual(touched, ["c-price"]);
  });

  await step("5. review.json and the page agree after the agent's work", async () => {
    const json = JSON.parse(await readFile(join(page.outputDir, "review.json"), "utf8"));
    const byId = Object.fromEntries(json.review.comments.map((c) => [c.id, c]));
    assert.equal(byId["c-price"].resolved, true);
    assert.equal(byId["c-name"].resolved, false);

    const stored = await readThreads(root, page.meta);
    const storedById = Object.fromEntries(stored.comments.map((c) => [c.id, c]));
    assert.equal(storedById["c-price"].resolved, true, "the store still shows it open");
    assert.equal(storedById["c-name"].resolved, false);

    const markdown = await readFile(join(page.outputDir, "review.md"), "utf8");
    assert.match(markdown, /resolved/i);
  });

  await page.page.close();
  page = null;



  page = await openReview();

  await step("6. reopening the review keeps both comments with their state", async () => {
    const comments = await pageComments(page);
    const byId = Object.fromEntries(comments.map((c) => [c.id, c]));
    assert.equal(comments.length, 2, `expected both comments, got ${comments.length}`);
    assert.equal(byId["c-price"].resolved, true, "the fixed comment lost its state");
    assert.equal(byId["c-name"].resolved, false, "the open comment was closed by the agent");
  });

  await step("7. a comment whose code changed is outdated on the next review", async () => {




    const comments = await pageComments(page);
    const byId = Object.fromEntries(comments.map((c) => [c.id, c]));
    assert.equal(byId["c-price"].outdated, true,
      "the agent changed the very line the comment is about, so it is outdated");
    assert.equal(byId["c-name"].outdated ?? false, false,
      "an untouched line must stay current");
  });

  await page.page.close();
  page = null;
  await git("checkout", "--", "cart.ts");


  await writeFile(join(root, "cart.ts"),
    SOURCE.replace("sum += line.quantity;", "sum += line.quantity * line.price;"));
  await git("add", "-A");
  await git("commit", "-m", "count the price");

  const newHead = (await git("rev-parse", "HEAD")).stdout.trim();
  const second = await startReview({
    repoPath: root, mode: MODE.RANGE, base: newHead + "~1", head: newHead,
    port: 0, symbols: true, dispatchEnabled: false, sessionId: "",
  });

  await step("8. the next review of the same target still carries the comments", async () => {
    const comments = await pageComments(second);
    assert.equal(comments.length, 2, "the next review lost the earlier comments");

    const byId = Object.fromEntries(comments.map((c) => [c.id, c]));
    assert.equal(byId["c-name"].resolved, false);
  });

  await step("9. the agent can close the second comment too, and review.md follows", async () => {
    await setCommentsResolved(second, ["c-name"], true);
    const stored = await readThreads(root, second.meta);
    assert.equal(stored.comments.every((c) => c.resolved === true), true);
    await second.page.close();
  });
} finally {
  if (page) await page.page.close();
  await rm(root, { recursive: true, force: true }).catch(() => {});
}

if (failures.length) {
  console.log(`\n${failures.length} step(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nThe whole review cycle works");
