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
      OPENCODE_SESSION_ID: sessionId ?? process.env.OPENCODE_SESSION_ID ?? P.EMPTY,
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
/** Waits until the page process has registered itself. */
export async function waitForPageRegistry(root, { timeoutMs = SERVER.PAGE_START_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const entry = await findPageRegistry(root);
    if (entry) return entry;
    await delay(SERVER.PAGE_POLL_MS);
  }

  return null;
}
/** The registry entry of a running page of the repository, if there is one. */
export async function findPageRegistry(root) {
  // New reviews live outside the checkout; `.pr-review/` is the legacy folder
  // of an older version and is still scanned so an old page is found.
  const legacy = await findRegistryIn(join(root, GIT.LEGACY_ARTIFACT_DIR));
  if (legacy) return legacy;

  return findRegistryIn(join(artifactsRoot(), repoSlug(root)));
}
/** The newest live registry entry in one artifacts directory, or null. */
async function findRegistryIn(artifacts) {
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
      if (entry?.port && isAlive(entry.pid)) return { ...entry, registryPath: path };
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
