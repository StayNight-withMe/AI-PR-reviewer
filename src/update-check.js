/**
 * A quiet "a newer version exists" note, printed once a day.
 *
 * It never blocks a review: the check runs in the background, has a short
 * timeout, and any failure is ignored. Disable with PR_REVIEW_NO_UPDATE_CHECK=1.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const STATE_DIR = join(tmpdir(), "pr-review-mcp");
const STATE_FILE = join(STATE_DIR, "update-check.json");
const DAY_MS = 24 * 60 * 60 * 1000;

/** The installed version, from the package next to the running code. */
async function installedVersion(packagePath) {
  try {
    return JSON.parse(await readFile(packagePath, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

function isNewer(candidate, current) {
  const parse = (value) => String(value ?? "0.0.0").split("-")[0].split(".").map((part) => Number(part) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return true;
    if (a[index] < b[index]) return false;
  }
  return false;
}

async function recentlyChecked() {
  try {
    const state = JSON.parse(await readFile(STATE_FILE, "utf8"));
    return Date.now() - Number(state.checkedAt ?? 0) < DAY_MS;
  } catch {
    return false;
  }
}

async function remember() {
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify({ checkedAt: Date.now() }), "utf8");
  } catch {
    /* a read-only temp folder only means the check runs again next time */
  }
}

/**
 * Prints one line when a newer version is published. Never throws, never waits
 * longer than two seconds, and stays silent for a day after each check.
 */
export async function noteUpdateIfAvailable(packagePath) {
  if (process.env.PR_REVIEW_NO_UPDATE_CHECK === "1") return;
  if (await recentlyChecked()) return;

  const current = await installedVersion(packagePath);
  if (!current) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const response = await fetch("https://registry.npmjs.org/pr-review-mcp/latest", { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return;
    const latest = (await response.json())?.version;
    if (!latest || !isNewer(latest, current)) return;
    process.stderr.write(
      `\nA newer pr-review-mcp is available: ${current} -> ${latest}.\n`
      + "Update with: node scripts/self-update.mjs\n",
    );
  } catch {
    /* offline, blocked, or too slow: a review must not care */
  } finally {
    await remember();
  }
}

export { isNewer, installedVersion };
