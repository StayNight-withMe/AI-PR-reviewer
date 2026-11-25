#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { currentBranch, resolveRepo } from "./git.js";
import { startReview } from "./core.js";
import { CLI, MODE, P, SERVER } from "./config.js";


function parseArgs(argv) {
  const flags = new Map();
  const switches = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const name = token.slice(P.TWO);
    const next = argv[index + P.ONE];
    if (next === undefined || next.startsWith("--")) switches.add(name);
    else {
      flags.set(name, next);
      index += P.ONE;
    }
  }

  return { flags, switches };
}
const { flags, switches } = parseArgs(process.argv.slice(P.TWO));
const pick = (flag, envKey, fallback) => flags.get(flag) ?? process.env[envKey] ?? fallback;
const repoPath = resolve(pick("repo", CLI.ENV.REPO, process.cwd()));
const port = Number(pick("port", CLI.ENV.PORT, String(SERVER.DEFAULT_PORT)));
const mode = pick("mode", CLI.ENV.MODE, CLI.DEFAULT_MODE);
const base = pick("base", CLI.ENV.BASE, undefined);
const head = pick("head", CLI.ENV.HEAD, undefined);
const prNumber = pick("pr", CLI.ENV.PR, undefined);
const title = pick("title", CLI.ENV.TITLE, undefined);
const jsonOnly = switches.has("json") || process.env[CLI.ENV.OPEN] === "0";
const shouldOpen = switches.has("open") || process.env[CLI.ENV.OPEN] === "1";

try {
  const root = await resolveRepo(repoPath).catch(() => repoPath);
  const branch = await currentBranch(root);

  const result = await startReview({
    repoPath: root,
    mode,
    base,
    head,
    pr: prNumber,

    title: title ?? (mode === MODE.PR ? undefined : branch),
    host: SERVER.HOST,
    port: Number.isFinite(port) ? port : SERVER.DEFAULT_PORT,
  });

  const payload = {
    ok: true,
    url: result.url,
    reviewId: result.reviewId,
    port: result.page.port,
    repo: root,
    branch: result.meta.branch ?? branch,
    mode,
    base: result.meta.base,
    head: result.meta.head,
    pr: result.meta.pr ? result.meta.pr.number : null,
    prUrl: result.meta.pr ? result.meta.pr.url : null,
    files: result.files,
    additions: result.additions,
    deletions: result.deletions,
    outputDir: result.outputDir,
  };

  process.stdout.write(CLI.READY_PREFIX + JSON.stringify(payload) + P.NEWLINE);

  if (shouldOpen) openInBrowser(result.url);

  setInterval(() => {}, SERVER.KEEPALIVE_MS);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      await result.page.close();
      process.exit(P.ZERO);
    });
  }
} catch (error) {
  process.stderr.write(`PR_REVIEW_ERROR ${error?.message ?? error}\n`);
  process.exit(P.ONE);
}

function openInBrowser(url) {
  const platform = process.platform;
  const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", P.EMPTY, url] : [url];

  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  } catch {

  }
}
