/** The review page as an own process. */
import { spawn } from "node:child_process";
import { readdir, readFile, unlink, writeFile, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GIT, P, ROUTES, SERVER } from "./config.js";
import { artifactsRoot, repoSlug } from "./artifacts.js";
/** The script that starts the page server. */
const PAGE_SCRIPT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "scripts", "serve-5454.js");
/** The registry file inside the artifacts directory of a review. */
export const PAGE_REGISTRY = "page.json";
/** Finds a free port. */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, SERVER.HOST, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}
/** Starts the page process. */
export function spawnPageProcess({ repoPath, mode, base, head, pr, prRepo, port, title, sessionId, commits, includeStaged, includeUntracked, symbols }) {
  const args = [PAGE_SCRIPT, repoPath, String(port), mode];
  if (base) args.push(base);
  if (head) args.push(head);

  const child = spawn(process.execPath, args, {
    cwd: join(fileURLToPath(new URL(".", import.meta.url)), ".."),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      // The page owns its review, and the owner is the session that asked for
      // it — never whatever session happened to launch this process.
      PR_REVIEW_SESSION: sessionId ?? P.EMPTY,
      OPENCODE_SESSION_ID: P.EMPTY,
      OPENCODE_SESSION: P.EMPTY,
      PR_REVIEW_TITLE: title ?? P.EMPTY,
      PR_REVIEW_PR: pr !== undefined && pr !== null && String(pr).trim() ? String(pr).trim() : P.EMPTY,
      PR_REVIEW_PR_REPO: prRepo ?? P.EMPTY,
      PR_REVIEW_COMMITS: commits?.length ? JSON.stringify(commits) : P.EMPTY,
      PR_REVIEW_INCLUDE_STAGED: flag(includeStaged),
      PR_REVIEW_INCLUDE_UNTRACKED: flag(includeUntracked),
      PR_REVIEW_SYMBOLS: flag(symbols),
    },
  });

  child.unref();

  return { child, port };
}
/** A flag as the text an environment variable can carry. */
function flag(value) {
  if (value === undefined) return P.EMPTY;
  return value ? "1" : "0";
}
/** Waits until the page process with this id has registered itself. */
export async function waitForPageRegistry(root, { timeoutMs = SERVER.PAGE_START_TIMEOUT_MS, pid } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const entry = await findPageRegistry(root, { match: (candidate) => candidate.pid === pid });
    // Another page of the same repository may already be running (a PR review
    // next to a working-tree review, say). Waiting for "any page" returned that
    // older one, so the new scope silently opened the wrong page.
    if (entry && (pid === undefined || entry.pid === pid)) return entry;
    await delay(SERVER.PAGE_POLL_MS);
  }

  return null;
}
/** The registry entry of a running page of the repository, if there is one. */
export async function findPageRegistry(root, { match } = {}) {
  // New reviews live outside the checkout; `.pr-review/` is the legacy folder
  // of an older version and is still scanned so an old page is found.
  const legacy = await findRegistryIn(join(root, GIT.LEGACY_ARTIFACT_DIR), match);
  if (legacy) return legacy;

  return findRegistryIn(join(artifactsRoot(), repoSlug(root)), match);
}
/** The first live registry entry in one artifacts directory that `match` accepts, or null. */
async function findRegistryIn(artifacts, match) {
  let folders = [];
  try {
    folders = await readdir(artifacts, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const folder of folders) {
    if (!folder.isDirectory()) continue;

    const path = join(artifacts, folder.name, PAGE_REGISTRY);
    try {
      const entry = JSON.parse(await readFile(path, "utf8"));
      // More than one page of one repository can run at the same time (say a
      // PR review next to a working-tree review), so the first live entry found
      // is not necessarily the page the caller means.
      if (entry?.port && isAlive(entry.pid) && (!match || match(entry))) {
        return { ...entry, registryPath: path };
      }
    } catch {
    // A half-written registry file is not an error: the page is starting.
    }
  }

  return null;
}
/** Writes the registry entry of the page process. */
export async function writePageRegistry(outputDir, entry) {
  await writeFile(join(outputDir, PAGE_REGISTRY), JSON.stringify(entry, null, SERVER.JSON_INDENT), SERVER.FILE_ENCODING);
  return entry;
}
/** Removes the registry entry of a page that was stopped. */
export async function removePageRegistry(path) {
  await unlink(path).catch(() => undefined);
}
/** True when the process with this id is still running. */
export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
/** Stops the page process and removes its registry entry. */
export async function stopPageProcess(entry) {
  if (!entry) return;

  if (entry.pid) {
    try {
      process.kill(entry.pid, "SIGTERM");
    } catch {
    // The process is already gone.
    }
  }

  if (entry.registryPath) await removePageRegistry(entry.registryPath);
}
/** Reads the state of the page: the last submitted review and the dispatch. */
export async function fetchPageResult(entry) {
  const response = await fetch(pageUrl(entry.url, ROUTES.API_RESULT));
  if (!response.ok) return null;

  const payload = await response.json();
  return payload?.ok ? payload : null;
}
/** A page route as an absolute URL, whether the page URL ends with a slash or not. */
export function pageUrl(base, route) {
  return new URL(route, base).toString();
}
/** ------------------------- cross-process page index ------------------------ */
/** The page index, shared by every MCP process of this user. */
export function pageIndexDir() {
  return join(homedir(), SERVER.PAGE_INDEX_DIR_NAME, SERVER.PAGE_INDEX_PAGES);
}
/** Remembers a page under its reviewId, so any MCP process can find it. */
export async function indexPage(entry) {
  if (!entry?.reviewId?.trim?.()) return;

  try {
    const dir = pageIndexDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${entry.reviewId}.json`), JSON.stringify(entry, null, SERVER.JSON_INDENT), SERVER.FILE_ENCODING);
  } catch {
  }
}
/** The indexed page of a reviewId, when a live page is behind it. */
export async function findIndexedPage(reviewId) {
  if (!reviewId?.trim?.()) return null;

  try {
    const entry = JSON.parse(await readFile(join(pageIndexDir(), `${reviewId}.json`), "utf8"));
    if (entry?.port && isAlive(entry.pid)) return entry;
  } catch {
  // No entry, or the process that wrote it is gone.
  }

  return null;
}
/** Forgets a reviewId in the index. */
export async function forgetIndexedPage(reviewId) {
  if (!reviewId?.trim?.()) return;
  await rm(join(pageIndexDir(), `${reviewId}.json`), { force: true }).catch(() => undefined);
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
