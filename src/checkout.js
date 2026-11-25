/**
 * Shared pull-request argument parsing and scratch checkouts.
 *
 * Both entry points use this: `pr` / `review` (src/pr.js) and the editor
 * bridge (src/cli.js). A pull-request URL must work from any folder, so a
 * checkout that does not exist is prepared in the cache instead of failing
 * with "this folder is not a Git repository".
 */
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveRepo } from "./git.js";
import { GIT, P } from "./config.js";

const exec = promisify(execFile);

export function parsePrArgument(argument) {
  const value = String(argument ?? P.EMPTY).trim();
  if (!value) return null;

  const url = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i.exec(value);
  if (url) return { repo: `${url[P.ONE]}/${url[P.TWO].replace(/\.git$/i, P.EMPTY)}`, number: Number(url[3]) };

  const short = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(value);
  if (short) return { repo: `${short[P.ONE]}/${short[P.TWO]}`, number: Number(short[3]) };

  if (/^\d+$/.test(value)) return { repo: null, number: Number(value) };

  return null;
}

/**
 * A review needs a Git checkout to fetch the pull request into. When the
 * command runs outside any repository, make one in the cache: a bare-free
 * clone of the PR's repository, reused across runs so repeated reviews are
 * fast and stay up to date. Returns the resolved repository root.
 */
export async function prepareScratchCheckout(pr) {
  if (!pr?.repo) {
    throw new Error("a plain PR number needs a checkout; pass --repo <path> or use a full URL");
  }

  const base = join(tmpdir(), "pr-review-mcp");
  const scratch = join(base, pr.repo.replace(/[\\/]/g, "__"));
  const git = (...args) => exec(GIT.BIN, args, { windowsHide: true, maxBuffer: GIT.MAX_BUFFER });

  if (existsSync(join(scratch, ".git"))) {
    // Reuse: fetch the new head instead of cloning every time.
    await git("-C", scratch, "fetch", "--prune", "origin").catch(() => {});
  } else {
    await mkdir(base, { recursive: true });
    const partial = join(base, `.partial-${Date.now()}`);
    try {
      await git("clone", "--filter=blob:none", `https://github.com/${pr.repo}.git`, partial);
      try { await rm(scratch, { recursive: true, force: true }); } catch { /* fresh reuse */ }
      await rename(partial, scratch).catch(async (error) => {
        if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY" || error?.code === "EPERM") {
          await rm(scratch, { recursive: true, force: true }).catch(() => {});
          await rename(partial, scratch);
          return;
        }
        throw error;
      });
    } catch (error) {
      await rm(partial, { recursive: true, force: true }).catch(() => {});
      throw new Error(`git clone of https://github.com/${pr.repo}.git failed: ${error.message}`);
    }
  }

  return resolveRepo(scratch);
}

/**
 * Resolves a repository root for a review. When the requested folder is not a
 * checkout and the review is about a pull request, a scratch clone is used so
 * a PR URL works from anywhere. Returns null when no checkout can be made.
 */
export async function resolveReviewRoot({ checkout = process.cwd(), pr = null, allowScratch = true } = {}) {
  const direct = await resolveRepo(checkout).catch(() => null);
  if (direct) return { root: direct, scratch: false };

  if (allowScratch && pr?.repo) {
    const root = await prepareScratchCheckout(pr);
    return { root, scratch: true };
  }

  return { root: null, scratch: false };
}
