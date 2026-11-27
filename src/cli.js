#!/usr/bin/env node

import { resolve } from "node:path";
import { currentBranch } from "./git.js";
import { parsePrArgument, resolveReviewRoot } from "./checkout.js";
import { startReview } from "./core.js";
import { openInBrowser as open } from "./open-browser.js";
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

// A launcher that quotes by hand can lose a closing quote to a trailing
// backslash ("Z:\repo\" reads as Z:\repo\" --mode … as one argument). That is
// fixed at the launcher, but a damaged path must not become "folder does not
// exist" with a quote in the middle: cut it at the stray quote.
function cleanPath(value) {
  const text = typeof value === "string" ? value : P.EMPTY;
  const quote = text.indexOf('"');
  return (quote === -1 ? text : text.slice(P.ZERO, quote)).replace(/\\+$/, P.EMPTY) || text;
}

const pick = (flag, envKey, fallback) => flags.get(flag) ?? process.env[envKey] ?? fallback;
const repoPath = resolve(cleanPath(pick("repo", CLI.ENV.REPO, process.cwd())));
const port = Number(pick("port", CLI.ENV.PORT, String(SERVER.DEFAULT_PORT)));
const mode = pick("mode", CLI.ENV.MODE, CLI.DEFAULT_MODE);
const base = pick("base", CLI.ENV.BASE, undefined);
const head = pick("head", CLI.ENV.HEAD, undefined);
const prNumber = pick("pr", CLI.ENV.PR, undefined);
const title = pick("title", CLI.ENV.TITLE, undefined);
const jsonOnly = switches.has("json") || process.env[CLI.ENV.OPEN] === "0";
const shouldOpen = switches.has("open") || process.env[CLI.ENV.OPEN] === "1";

try {
  // A pull-request URL or owner/repo#N anywhere in the arguments switches the
  // bridge into PR mode, exactly like `pr <url>`: the review then works from
  // any folder, including ones without a Git checkout at all.
  const positional = process.argv.slice(P.TWO).filter((token) => !token.startsWith("--"));
  const prArgument = positional.map((token) => parsePrArgument(token)).find(Boolean) ?? null;
  const prFromFlag = prNumber !== undefined && prNumber !== null && String(prNumber).trim()
    ? { repo: null, number: Number(String(prNumber).trim()) }
    : null;
  const pr = prArgument ?? prFromFlag;

  const root = await resolveReviewRoot({
    checkout: repoPath,
    pr,
    allowScratch: !flags.has("repo"),
  }).then((r) => r.root);

  if (!root) {
    throw new Error(
      `"${repoPath}" is not a Git repository. Open a folder with a checkout of the repository, `
      + "or pass a full pull-request URL so a scratch checkout can be prepared.",
    );
  }

  const branch = pr ? undefined : await currentBranch(root);

  const result = await startReview({
    repoPath: root,
    mode: pr ? MODE.PR : mode,
    base,
    head,
    pr: pr ? pr.number : prNumber,
    prRepo: pr?.repo ?? undefined,
    remote: pr?.repo ? `https://github.com/${pr.repo}` : undefined,

    title: title ?? (pr ? undefined : branch),
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
    mode: pr ? MODE.PR : mode,
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
  // A missing opener must not crash the bridge: see src/open-browser.js.
  open(url);
}
