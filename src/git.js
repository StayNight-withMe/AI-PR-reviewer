import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { GIT, P } from "./config.js";
const exec = promisify(execFile);
/** Absolute path of the git executable, or the plain name when it is on PATH. */
let gitBinary = null;
export function resolveGitBinary(env = process.env) {
  if (gitBinary) return gitBinary;

  for (const candidate of GIT.INSTALL_CANDIDATES) {
    const path = candidate.replace(/%([A-Z_]+)%/g, (match, name) => env[name] ?? match);
    if (path.includes("%")) continue;
    if (existsSync(path)) {
      gitBinary = path;
      return gitBinary;
    }
  }
  // Fall back to the PATH lookup: git may live in a custom location.
  gitBinary = GIT.BIN;
  return gitBinary;
}
/** Clears the cached git path (used by tests that change the environment). */
export function resetGitBinary() {
  gitBinary = null;
}
/** Runs git with safe arguments. */
export async function git(repoPath, args, { allowFailure = true, input } = {}) {
  const binary = resolveGitBinary();
  // Without this, git writes a path with non-ASCII letters as an octal
  // escape ("docs/\320\275.md"), and the review would show the escape
  // instead of the real name of the file.
  const safeArgs = [...GIT.ARGS.QUOTE_PATH_OFF, ...args];
  try {
    const { stdout } = await exec(binary, safeArgs, {
      cwd: repoPath,
      maxBuffer: GIT.MAX_BUFFER,
      windowsHide: true,
      encoding: "utf8",
      input,
    });
    return { ok: true, code: P.ZERO, stdout };
  } catch (error) {
    const stdout = error.stdout ?? P.EMPTY;
    const stderr = error.stderr ?? P.EMPTY;

    if (error.code === GIT.ENOENT) {
      throw new Error(GIT.ERROR_NOT_INSTALLED);
    }
    if (!allowFailure) {
      throw new Error(`${binary} ${safeArgs.join(P.SPACE)} failed: ${stderr || error.message}`);
    }
    return { ok: false, code: error.code ?? P.ONE, stdout, stderr };
  }
}
export async function resolveRepo(repoPath) {
  const { ok, stdout, stderr } = await git(repoPath, GIT.ARGS.REV_PARSE_TOPLEVEL);
  if (!ok) {
    throw new Error(`${GIT.ERROR_NOT_A_REPO}${repoPath}${stderr ? ` (${stderr.trim()})` : P.EMPTY}`);
  }
  return stdout.trim();
}
export async function currentBranch(repoPath) {
  const { ok, stdout } = await git(repoPath, GIT.ARGS.BRANCH_SHOW);
  return ok ? stdout.trim() || GIT.DEFAULT_REF : GIT.DEFAULT_REF;
}
export async function remoteUrl(repoPath) {
  const { ok, stdout } = await git(repoPath, GIT.ARGS.REMOTE);
  return ok ? stdout.trim() : null;
}
/** The branches of the repository, remote ones included. */
export async function listBranches(repoPath) {
  const { ok, stdout } = await git(repoPath, GIT.ARGS.BRANCHES);
  if (!ok) return [];

  return [...new Set(
    stdout
      .split(P.NEWLINE)
      .map((line) => line.trim())
      .filter((name) => name && name !== GIT.HEAD_ALIAS),
  )].sort();
}
export async function resolveCommit(repoPath, ref) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.REV_PARSE_COMMIT, GIT.FLAGS.VERIFY, `${ref}${GIT.COMMIT_SUFFIX}`]);
  return ok ? stdout.trim() : null;
}
export async function mergeBase(repoPath, base, head) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.MERGE_BASE, base, head]);
  return ok ? stdout.trim() : null;
}
/** The commit itself, or the empty tree when it has no parent (a root commit). */
export async function parentOrEmptyTree(repoPath, sha) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.REV_PARSE_COMMIT, `${sha}${GIT.TILDE}`]);
  return ok && stdout.trim() ? stdout.trim() : GIT.EMPTY_TREE_OBJECT;
}
/** Patch between two revisions (a tree or a commit), straight from `from` to `to`. */
export async function diffFromTo(repoPath, from, to) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.DIFF, from, to]);
  return ok ? stdout : P.EMPTY;
}
/** The commits in newest-first order, without walking their ancestors. */
export async function orderCommits(repoPath, shas) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.REV_LIST_NO_WALK, ...shas]);
  if (!ok || !stdout.trim()) return shas;

  const ordered = stdout.split(P.NEWLINE).map((line) => line.trim()).filter(Boolean);
  return ordered.length ? ordered : shas;
}
/** Commits of a range, newest first. */
export async function listCommits(repoPath, { range, head, excludeRemotes = false, limit = GIT.MAX_COMMITS } = {}) {
  const args = [...GIT.ARGS.LOG, `${GIT.FLAG_MAX_COUNT}${limit}`];
  if (range) args.push(range);
  if (excludeRemotes) args.push(head ?? GIT.DEFAULT_REF, ...GIT.ARGS.LOG_NOT_REMOTES);

  const { ok, stdout } = await git(repoPath, args);
  if (!ok) return [];

  return stdout
    .split(P.NEWLINE)
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, subject, authorName, authorEmail, date] = line.split(GIT.LOG_FIELD_SEPARATOR);
      return { sha, shortSha, subject, authorName, authorEmail, date };
    });
}
