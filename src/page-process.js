
import { spawn } from "node:child_process";
import { readdir, readFile, unlink, writeFile, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GIT, P, ROUTES, SERVER } from "./config.js";
import { artifactsRoot, repoSlug } from "./artifacts.js";

const PAGE_SCRIPT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "scripts", "serve-5454.js");

export const PAGE_REGISTRY = "page.json";

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

function flag(value) {
  if (value === undefined) return P.EMPTY;
  return value ? "1" : "0";
}

export async function waitForPageRegistry(root, { timeoutMs = SERVER.PAGE_START_TIMEOUT_MS, pid } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const entry = await findPageRegistry(root, { match: (candidate) => candidate.pid === pid });



    if (entry && (pid === undefined || entry.pid === pid)) return entry;
    await delay(SERVER.PAGE_POLL_MS);
  }

  return null;
}

export async function findPageRegistry(root, { match } = {}) {


  const legacy = await findRegistryIn(join(root, GIT.LEGACY_ARTIFACT_DIR), match);
  if (legacy) return legacy;

  return findRegistryIn(join(artifactsRoot(), repoSlug(root)), match);
}

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



      if (entry?.port && isAlive(entry.pid) && (!match || match(entry))) {
        return { ...entry, registryPath: path };
      }
    } catch {

    }
  }

  return null;
}

export async function writePageRegistry(outputDir, entry) {
  await writeFile(join(outputDir, PAGE_REGISTRY), JSON.stringify(entry, null, SERVER.JSON_INDENT), SERVER.FILE_ENCODING);
  return entry;
}

export async function removePageRegistry(path) {
  await unlink(path).catch(() => undefined);
}

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function stopPageProcess(entry) {
  if (!entry) return;

  if (entry.pid) {
    try {
      process.kill(entry.pid, "SIGTERM");
    } catch {

    }
  }

  if (entry.registryPath) await removePageRegistry(entry.registryPath);
}

export async function fetchPageResult(entry) {
  const response = await fetch(pageUrl(entry.url, ROUTES.API_RESULT));
  if (!response.ok) return null;

  const payload = await response.json();
  return payload?.ok ? payload : null;
}

export function pageUrl(base, route) {
  return new URL(route, base).toString();
}


export function pageIndexDir() {
  return join(homedir(), SERVER.PAGE_INDEX_DIR_NAME, SERVER.PAGE_INDEX_PAGES);
}

export async function indexPage(entry) {
  if (!entry?.reviewId?.trim?.()) return;

  try {
    const dir = pageIndexDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${entry.reviewId}.json`), JSON.stringify(entry, null, SERVER.JSON_INDENT), SERVER.FILE_ENCODING);
  } catch {
  }
}

export async function findIndexedPage(reviewId) {
  if (!reviewId?.trim?.()) return null;

  try {
    const entry = JSON.parse(await readFile(join(pageIndexDir(), `${reviewId}.json`), "utf8"));
    if (entry?.port && isAlive(entry.pid)) return entry;
  } catch {

  }

  return null;
}

export async function forgetIndexedPage(reviewId) {
  if (!reviewId?.trim?.()) return;
  await rm(join(pageIndexDir(), `${reviewId}.json`), { force: true }).catch(() => undefined);
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
