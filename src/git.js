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
/** The head commit of every branch. */
export async function listBranchHeads(repoPath, branches) {
  return Promise.all(branches.map(async (name) => {
    const { ok, stdout } = await git(repoPath, [...GIT.ARGS.LOG, `${GIT.FLAG_MAX_COUNT}1`, name]);
    const line = ok ? stdout.split(P.NEWLINE)[0] : P.EMPTY;
    const [sha, shortSha, subject, authorName, , date] = line.split(GIT.LOG_FIELD_SEPARATOR);

    return { name, sha: sha ?? P.EMPTY, shortSha: shortSha ?? P.EMPTY, subject: subject ?? P.EMPTY, authorName: authorName ?? P.EMPTY, date: date ?? P.EMPTY };
  }));
}
/** Full-text project search: one `git grep` over the working tree. */
export async function searchProject(repoPath, query, { limit = GIT.MAX_SEARCH_HITS } = {}) {
  const trimmed = String(query ?? P.EMPTY).trim();
  if (trimmed.length < GIT.MIN_SEARCH_LENGTH) return [];
  // files are searched as well: a query of a file name has to find that file.
  const [content, paths] = await Promise.all([
    git(repoPath, [
      ...GIT.ARGS.GREP_LINES,
      GIT.FLAG_IGNORE_CASE,
      trimmed,
      GIT.FLAGS.HEAD,
      GIT.FLAGS.DOT,
      ...GIT.EXCLUDE_PATHSPEC,
    ]),
    git(repoPath, GIT.ARGS.LS_FILES),
  ]);

  const hits = [];
  if (content.ok && content.stdout) {
    for (const line of content.stdout.split(P.NEWLINE)) {
      if (!line) continue;
      const hit = parseGrepLine(line);
      if (hit) hits.push(hit);
    }
  }

  if (paths.ok && paths.stdout) {
    const needle = trimmed.toLowerCase();
    for (const path of paths.stdout.split(P.NEWLINE)) {
      if (!path || !path.toLowerCase().includes(needle)) continue;
      hits.push({ path, line: P.ONE, text: path });
    }
  }

  const seen = new Set();
  return hits
    .filter((hit) => {
      const key = `${hit.path}:${hit.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(P.ZERO, limit);
}
/** Parses one line of `git grep`: path, line number and the text of the line. */
function parseGrepLine(line) {
  const first = line.indexOf(P.COLON);
  const second = line.indexOf(P.COLON, first + P.ONE);
  if (first === P.NEG_ONE || second === P.NEG_ONE) return null;

  const lineNumber = Number(line.slice(first + P.ONE, second));
  if (!Number.isFinite(lineNumber)) return null;

  return {
    path: line.slice(P.ZERO, first),
    line: lineNumber,
    text: line.slice(second + P.ONE),
  };
}
export async function commitDiff(repoPath, sha) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.SHOW_STAT, sha]);
  return ok ? stdout : P.EMPTY;
}
/** SHAs already reachable from any remote ref: these must never be rewritten. */
export async function pushedShas(repoPath) {
  const { ok, stdout } = await git(repoPath, GIT.ARGS.REV_LIST_UNPUSHED);
  if (!ok) return new Set();
  // Everything reachable from HEAD minus everything not on a remote.
  const unpushed = new Set(stdout.split(P.NEWLINE).filter(Boolean));
  const { ok: headOk, stdout: headOut } = await git(repoPath, GIT.ARGS.REV_LIST_HEAD);
  if (!headOk) return new Set();

  const pushed = new Set();
  for (const sha of headOut.split(P.NEWLINE).filter(Boolean)) {
    if (!unpushed.has(sha)) pushed.add(sha);
  }
  return pushed;
}
/** Rewrites the message of a commit. */
export async function renameCommit(repoPath, sha, message, { allowPushed = false } = {}) {
  const resolved = await resolveCommit(repoPath, sha);
  if (!resolved) throw new Error(`Commit not found: ${sha}`);

  if (!allowPushed) {
    const pushed = await pushedShas(repoPath);
    if (pushed.has(resolved)) throw new Error("This commit is already pushed; allow rewriting it explicitly.");
  }

  const head = await resolveCommit(repoPath, GIT.DEFAULT_REF);
  if (!head) throw new Error("No commits to rewrite.");
  if (resolved === head) {
    await amendMessage(repoPath, message);
    return resolveCommit(repoPath, GIT.DEFAULT_REF);
  }

  return replayWithNewMessage(repoPath, resolved, head, message);
}
async function amendMessage(repoPath, message) {
  const { ok, stderr } = await git(repoPath, [...GIT.ARGS.COMMIT_AMEND_MESSAGE, message]);
  if (!ok) throw new Error(stderr?.trim() || "git commit --amend failed.");
}
/** Rewrites an older commit and replays everything above it. */
async function replayWithNewMessage(repoPath, sha, head, message) {
  const parent = await firstParent(repoPath, sha);
  const tree = await revParse(repoPath, `${sha}${GIT.TREE_SUFFIX}`);
  if (!tree) throw new Error("Cannot read the commit tree.");

  const backup = `${GIT.BACKUP_REF_PREFIX}${sha.slice(0, GIT.SHORT_SHA_LENGTH)}`;
  await git(repoPath, [...GIT.ARGS.UPDATE_REF, backup, head]);

  const created = await git(repoPath, [
    GIT.ARGS.COMMIT_TREE,
    tree,
    ...(parent ? [GIT.FLAGS.PARENT, parent] : []),
    ...GIT.ARGS.COMMIT_MESSAGE, message,
  ]);

  const newSha = created.ok ? created.stdout.trim() : null;
  if (!newSha) throw new Error(created.stderr?.trim() || "git commit-tree failed.");

  const rebaseArgs = parent
    ? [...GIT.ARGS.REBASE_ONTO, newSha, parent, GIT.DEFAULT_REF]
    : [...GIT.ARGS.REBASE_ROOT, newSha, GIT.DEFAULT_REF];

  const rebased = await git(repoPath, rebaseArgs);
  if (!rebased.ok) {
    await git(repoPath, GIT.ARGS.REBASE_ABORT);
    await git(repoPath, [GIT.ARGS.RESET[0], GIT.ARGS.RESET[1], head]);
    throw new Error(rebased.stderr?.trim() || `Rewrite failed; restored ${backup}.`);
  }

  return resolveCommit(repoPath, GIT.DEFAULT_REF);
}
async function firstParent(repoPath, sha) {
  const { ok, stdout } = await git(repoPath, [GIT.REV_LIST, GIT.FLAGS.PARENTS, GIT.FLAGS.MAX_COUNT_ONE, sha]);
  if (!ok) return null;
  // Output is "<sha> <parent>..." — the commit itself is the first field.
  const parts = stdout.trim().split(P.SPACE).filter(Boolean);
  return parts.length > P.ONE ? parts[P.ONE] : null;
}
async function revParse(repoPath, ref) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.REV_PARSE_COMMIT, GIT.FLAGS.VERIFY, ref]);
  return ok ? stdout.trim() : null;
}
export async function diffUncommitted(repoPath, { includeStaged = true, includeUntracked = true } = {}) {
  const parts = [];
  const pathspec = [GIT.FLAGS.HEAD, GIT.FLAGS.DOT, ...GIT.EXCLUDE_PATHSPEC];

  if (includeStaged) {
    const staged = await git(repoPath, [...GIT.ARGS.DIFF_CACHED, GIT.DEFAULT_REF, ...pathspec]);
    if (staged.ok) parts.push(staged.stdout);
  }

  const unstaged = await git(repoPath, [...GIT.ARGS.DIFF, ...pathspec]);
  if (unstaged.ok) parts.push(unstaged.stdout);

  if (includeUntracked) {
    const untracked = await git(repoPath, GIT.ARGS.LS_FILES_UNTRACKED);
    if (untracked.ok) {
      for (const file of untracked.stdout.split(P.NEWLINE).filter(Boolean)) {
        if (file.startsWith(`${GIT.LEGACY_ARTIFACT_DIR}${P.SLASH}`)) continue;
        const content = await git(repoPath, [...GIT.ARGS.DIFF_NO_INDEX, GIT.EMPTY_TREE, file]);
        if (content.ok || content.stdout) parts.push(content.stdout);
      }
    }
  }
  // Each `git diff` already ends with a newline, and `git diff --no-index`
  // exits with code 1 but still writes a full patch. Joining the parts with
  // another newline left a blank line between hunks, which the diff parser
  // turned into a phantom empty "meta" row at the end of the file.
  return parts
    .filter(Boolean)
    .map((part) => part.replace(/\n+$/, P.NEWLINE))
    .join(P.EMPTY);
}
export async function diffBetween(repoPath, base, head) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.DIFF, `${base}${GIT.RANGE_SEPARATOR}${head ?? GIT.DEFAULT_REF}`]);
  return ok ? stdout : P.EMPTY;
}
export async function fileContent(repoPath, ref, filePath) {
  const { ok, stdout } = await git(repoPath, [GIT.SHOW, `${ref}:${filePath}`]);
  return ok ? stdout : null;
}
/** Returns every tracked file path in the repository. */
export async function listFiles(repoPath, { ref = GIT.DEFAULT_REF } = {}) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.LS_TREE, ref]);
  if (!ok) return [];
  return stdout.split(P.NEWLINE).map((line) => line.trim()).filter(Boolean);
}
/** Tracked file -> change status map. */
export async function fileStatus(repoPath, { base, head } = {}) {
  const range = base && head
    ? `${base}${GIT.RANGE_SEPARATOR}${head}`
    : head || GIT.DEFAULT_REF;

  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.DIFF_NAME_STATUS, range]);
  if (!ok) return {};

  const map = {};
  for (const line of stdout.split(P.NEWLINE)) {
    const [raw, ...rest] = line.trim().split(P.TAB);
    if (!raw) continue;

    const code = raw.trim().toUpperCase();
    let path = rest.join(P.TAB).trim();
    if (code.startsWith(GIT.STATUS_RENAME)) path = rest[rest.length - P.ONE] || rest[P.ZERO];
    if (!path) continue;

    map[path] = toStatus(code);
  }
  return map;
}
