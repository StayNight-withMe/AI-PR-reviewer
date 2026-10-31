/**
 * The MCP server over its own transport.
 *
 * The test starts the server as a program, asks it for a review and checks
 * that the page it opens is a real page of a real repository.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { findIndexedPage, findPageRegistry, stopPageProcess } from "../src/page-process.js";
import { GIT } from "../src/config.js";
const exec = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));
const SERVER = join(ROOT, "..", "src", "index.js");
const failures = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`PASS ${name}`),
      (error) => {
        failures.push(`${name}: ${error.message}`);
        console.log(`FAIL ${name} — ${error.message}`);
      },
    );
}
/** A minimal MCP client over the stdio transport. */
function createClient() {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const pending = new Map();
  let nextId = 1;

  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => {
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
      }, 60_000);
    });

  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };

  return { child, request, notify };
}
const repo = await mkdtemp(join(tmpdir(), "pr-review-mcp-"));
const git = (...args) => exec(GIT.BIN, args, { cwd: repo });
let client = null;
try {
  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src/app.ts"), "export const value = 1;\n");
  await git("add", "-A");
  await git("commit", "-m", "init");
  await writeFile(join(repo, "src/app.ts"), "export const value = 2;\n");

  client = createClient();

  await check("the server answers the initialize request", async () => {
    const response = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });
    assert.ok(response.result, "no result");
    assert.equal(response.result.serverInfo.name, "pr-review");
    client.notify("notifications/initialized", {});
  });

  let reviewId = null;

  await check("start_review opens a page", async () => {
    const response = await client.request("tools/call", {
      name: "start_review",
      arguments: { repoPath: repo, mode: "uncommitted" },
    });

    const text = response.result?.content?.[0]?.text ?? "";
    assert.ok(text.includes("Review ready:"), `unexpected answer: ${text.slice(0, 200)}`);
    reviewId = /Review ID: (\S+)/.exec(text)?.[1] ?? null;
    assert.ok(reviewId, "the answer has no review id");
  });

  await check("the page is a separate process that is registered", async () => {
    const registry = await findPageRegistry(repo);
    assert.ok(registry, "the page is not registered");
    assert.equal(registry.reviewId, reviewId);

    const response = await fetch(registry.url);
    assert.equal(response.status, 200);
  });

  await check("the review is findable from another process", async () => {
    // OpenCode runs one MCP process per session; a review opened in one must be
    // readable from another. The on-disk index is what makes that work.
    const indexed = await findIndexedPage(reviewId);
    assert.ok(indexed, "the review is not in the cross-process index");
    assert.equal(indexed.reviewId, reviewId);
    assert.ok(indexed.url, "the indexed entry has no url");
  });

  await check("list_review_scope lists the branches", async () => {
    const response = await client.request("tools/call", {
      name: "list_review_scope",
      arguments: { repoPath: repo, kind: "branches" },
    });
    const text = response.result?.content?.[0]?.text ?? JSON.stringify(response);
    assert.ok(text.includes("main"), `unexpected answer: ${text}`);
  });

  await check("close_review stops the page", async () => {
    const response = await client.request("tools/call", {
      name: "close_review",
      arguments: { reviewId },
    });
    assert.ok(response.result, "no result");

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const registry = await findPageRegistry(repo);
    assert.equal(registry, null, "the page is still registered");

    const indexed = await findIndexedPage(reviewId);
    assert.equal(indexed, null, "the review is still in the cross-process index");
  });
} finally {
  if (client) client.child.kill();
  await rm(repo, { recursive: true, force: true });
}
