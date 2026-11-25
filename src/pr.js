#!/usr/bin/env node
/**
 * The `pr` command: open a review of a GitHub pull request from its URL.
 *
 *   pr https://github.com/owner/repo/pull/123
 *   pr owner/repo#123
 *   pr 123                       (uses the PR of the current branch)
 *
 * Prints the local review page address and opens it in the browser. The page
 * can publish the review back to GitHub, so this one command replaces the
 * whole loop: open, read, comment, post.
 *
 * Run: node src/pr.js <url|owner/repo#123|number> [--no-open] [--port N]
 */
import { resolve } from "node:path";
import { startReview } from "./core.js";
import { resolveRepo } from "./git.js";
import { repoFromUrl } from "./github.js";
import { noteUpdateIfAvailable } from "./update-check.js";
import { GH, MODE, P, SERVER } from "./config.js";

const USAGE = [
  "Usage: pr <pull-request> [options]",
  "",
  "  <pull-request>  a GitHub PR URL (https://github.com/owner/repo/pull/123),",
  "                  a short form (owner/repo#123), or a plain number",
  "                  (the PR of the current branch).",
  "",
  "Options:",
  "  --no-open       do not open the browser, just print the address",
  "  --port <n>      fixed port for the local review page",
  "  --repo <path>   checkout to fetch the PR into (default: current directory)",
].join(P.NEWLINE);

function parsePrArgument(argument) {
  const value = String(argument ?? P.EMPTY).trim();
  if (!value) return null;

  const url = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i.exec(value);
  if (url) return { repo: `${url[P.ONE]}/${url[P.TWO].replace(/\.git$/i, P.EMPTY)}`, number: Number(url[3]) };

  const short = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(value);
  if (short) return { repo: `${short[P.ONE]}/${short[P.TWO]}`, number: Number(short[3]) };

  if (/^\d+$/.test(value)) return { repo: null, number: Number(value) };

  return null;
}

const argv = process.argv.slice(P.TWO);
if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
  process.stdout.write(USAGE + P.NEWLINE);
  process.exit(argv.length ? P.ZERO : P.ONE);
}

const flags = { open: true };
let prArgument = null;
let checkout = process.cwd();
let port = SERVER.DEFAULT_PORT;

for (let index = 0; index < argv.length; index += 1) {
  const token = argv[index];
  if (token === "--no-open") flags.open = false;
  else if (token === "--port") { port = Number(argv[index + P.ONE]); index += P.ONE; }
  else if (token === "--repo") { checkout = argv[index + P.ONE]; flags.userRepo = true; index += P.ONE; }
  else if (!prArgument) prArgument = token;
}

const pr = parsePrArgument(prArgument);
if (!pr) {
  process.stderr.write(`Could not read a pull request from "${prArgument}".\n\n${USAGE}\n`);
  process.exit(P.ONE);
}

/**
 * A review needs a Git checkout to fetch the pull request into. When the
 * command runs outside any repository, make one in the cache: a bare-free
 * clone of the PR's repository, reused across runs so repeated reviews are
 * fast and stay up to date.
 */
async function prepareScratchCheckout(pr) {
  const { existsSync } = await import("node:fs");
  const { mkdir, rm } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);

  if (!pr.repo) {
    throw new Error("a plain PR number needs a checkout; pass --repo <path> or use a full URL");
  }

  const base = join(tmpdir(), "pr-review-mcp");
  const scratch = join(base, pr.repo.replace(/[\\/]/g, "__"));
  const git = (...args) => exec("git", args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });

  if (existsSync(join(scratch, ".git"))) {
    // Reuse: fetch the new head instead of cloning every time.
    await git("-C", scratch, "fetch", "--prune", "origin").catch(() => {});
  } else {
    await mkdir(base, { recursive: true });
    const partial = join(base, `.partial-${Date.now()}`);
    try {
      await git("clone", "--filter=blob:none", `https://github.com/${pr.repo}.git`, partial);
      try { await rm(scratch, { recursive: true, force: true }); } catch { /* fresh reuse */ }
      await exec("cmd", ["/c", "move", partial.replace(/\//g, "\\"), scratch.replace(/\//g, "\\")], { windowsHide: true }).catch(async () => {
        await import("node:fs/promises").then((fs) => fs.rename(partial, scratch));
      });
    } catch (error) {
      await rm(partial, { recursive: true, force: true }).catch(() => {});
      throw new Error(`git clone of https://github.com/${pr.repo}.git failed: ${error.message}`);
    }
  }
  const { resolveRepo } = await import("./git.js");
  return resolveRepo(scratch);
}

let root = await resolveRepo(resolve(checkout)).catch(() => null);
if (!root && !flags.userRepo) {
  // No checkout here: prepare a scratch clone in the cache, so `pr <url>`
  // works from any folder — a desktop, a download dir, anywhere.
  root = await prepareScratchCheckout(pr).catch((error) => {
    process.stderr.write(`Could not prepare a scratch checkout: ${error.message}\n`);
    process.exit(P.ONE);
  });
}
if (!root) {
  process.stderr.write(
    `"${resolve(checkout)}" is not a Git repository. Run this command from a checkout of the repository\n`
    + `the pull request belongs to, or pass --repo <path> with a checkout.\n`,
  );
  process.exit(P.ONE);
}

try {
  const result = await startReview({
    repoPath: root,
    mode: MODE.PR,
    pr: pr.number,
    prRepo: pr.repo ?? undefined,
    // A PR may belong to another repository than the checkout. Fetching from
    // the repository's own URL (instead of the checkout's `origin`) makes
    // `pr <url>` work from any checkout, without adding a remote.
    remote: pr.repo ? `https://github.com/${pr.repo}` : undefined,
    host: SERVER.HOST,
    port: Number.isFinite(port) ? port : SERVER.DEFAULT_PORT,
  });

  const lines = [
    `Reviewing ${result.meta.pr.url ?? `PR #${pr.number}`}`,
    `Local page: ${result.url}`,
  ];
  if (flags.open) lines.push("Opening in the browser…");
  process.stdout.write(lines.join(P.NEWLINE) + P.NEWLINE + P.NEWLINE);

  if (flags.open) openInBrowser(result.url);

  // A one-line "newer version exists" note, at most once a day, never blocking.
  void noteUpdateIfAvailable(new URL("../package.json", import.meta.url));

  process.stdout.write("The page stays open until you stop this command with Ctrl+C.\n");
  setInterval(() => {}, SERVER.KEEPALIVE_MS);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      await result.page.close();
      process.exit(P.ZERO);
    });
  }
} catch (error) {
  const message = String(error?.message ?? error);
  const hint = /not logged|auth/i.test(message)
    ? "\nRun `gh auth login` first."
    : /No pull request/i.test(message)
      ? "\nCheck that the pull request exists and that `gh` can see this repository."
      : /executable not found|was not found/i.test(message)
        ? "\nInstall the GitHub CLI (https://cli.github.com)."
        : P.EMPTY;
  process.stderr.write(`Could not open the review: ${message}${hint}\n`);
  process.exit(P.ONE);
}

function openInBrowser(url) {
  const platform = process.platform;
  const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", P.EMPTY, url] : [url];
  import("node:child_process").then(({ spawn }) => spawn(command, args, { detached: true, stdio: "ignore" }).unref());
}
