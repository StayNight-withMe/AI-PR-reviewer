import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { GIT, P } from "./config.js";
const exec = promisify(execFile);

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

  gitBinary = GIT.BIN;
  return gitBinary;
}

export function resetGitBinary() {
  gitBinary = null;
}

export async function git(repoPath, args, { allowFailure = true, input } = {}) {
  const binary = resolveGitBinary();

  const safeArgs = [...GIT.ARGS.QUOTE_PATH_OFF, ...args];
  // Node reports a missing working directory and a missing binary with the same
  // ENOENT, and blaming Git for a folder that does not exist sends the user to
  // reinstall software that is already installed. Check what is actually wrong.
  if (!existsSync(repoPath)) {
    throw new Error(`${GIT.ERROR_FOLDER_MISSING}${repoPath}`);
  }
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
    throw new Error(
      `${GIT.ERROR_NOT_A_REPO}${repoPath}${stderr ? ` (${stderr.trim()})` : P.EMPTY}. ${GIT.ERROR_GIT_GUIDE}`,
    );
  }
  const root = stdout.trim();

  // A checkout with no commits is a working repository, but there is nothing
  // to compare: say so instead of opening an empty review page with 0 files.
  const { ok: hasHead } = await git(root, [...GIT.ARGS.REV_PARSE_VERIFY, GIT.DEFAULT_REF]);
  if (!hasHead) throw new Error(GIT.ERROR_EMPTY_REPO);

  const { ok: onBranch, stdout: branch } = await git(root, GIT.ARGS.BRANCH_SHOW);
  if (!onBranch || !branch.trim() || branch.trim() === GIT.HEAD_ALIAS) {
    throw new Error(GIT.ERROR_NO_BRANCH);
  }

  return root;
}
export async function currentBranch(repoPath) {
  const { ok, stdout } = await git(repoPath, GIT.ARGS.BRANCH_SHOW);
  return ok ? stdout.trim() || GIT.DEFAULT_REF : GIT.DEFAULT_REF;
}
export async function remoteUrl(repoPath) {
  const { ok, stdout } = await git(repoPath, GIT.ARGS.REMOTE);
  return ok ? stdout.trim() : null;
}

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

export function safeRef(ref) {
  const value = String(ref ?? P.EMPTY).trim();
  if (!value || !GIT.REF_PATTERN.test(value)) throw new Error(`${GIT.ERROR_BAD_REF}${ref}`);
  return value;
}
export async function resolveCommit(repoPath, ref) {
  const { ok, stdout } = await git(repoPath, [
    ...GIT.ARGS.REV_PARSE_COMMIT, GIT.FLAGS.VERIFY, GIT.END_OF_OPTIONS, `${safeRef(ref)}${GIT.COMMIT_SUFFIX}`,
  ]);
  return ok ? stdout.trim() : null;
}
export async function mergeBase(repoPath, base, head) {
  const { ok, stdout } = await git(repoPath, [
    ...GIT.ARGS.MERGE_BASE, GIT.END_OF_OPTIONS, safeRef(base), safeRef(head),
  ]);
  return ok ? stdout.trim() : null;
}

export async function parentOrEmptyTree(repoPath, sha) {
  const { ok, stdout } = await git(repoPath, [
    ...GIT.ARGS.REV_PARSE_COMMIT, GIT.END_OF_OPTIONS, `${safeRef(sha)}${GIT.TILDE}`,
  ]);
  return ok && stdout.trim() ? stdout.trim() : GIT.EMPTY_TREE_OBJECT;
}

export async function diffFromTo(repoPath, from, to) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.DIFF, GIT.END_OF_OPTIONS, safeRef(from), safeRef(to)]);
  return ok ? stdout : P.EMPTY;
}

export async function orderCommits(repoPath, shas) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.REV_LIST_NO_WALK, ...shas]);
  if (!ok || !stdout.trim()) return shas;

  const ordered = stdout.split(P.NEWLINE).map((line) => line.trim()).filter(Boolean);
  return ordered.length ? ordered : shas;
}

export async function listCommits(repoPath, { range, head, excludeRemotes = false, limit = GIT.MAX_COMMITS } = {}) {
  const args = [...GIT.ARGS.LOG, `${GIT.FLAG_MAX_COUNT}${limit}`];


  if (range) args.push(safeRef(range));
  if (excludeRemotes) args.push(...GIT.ARGS.LOG_NOT_REMOTES, safeRef(head ?? GIT.DEFAULT_REF));

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

export async function listBranchHeads(repoPath, branches) {
  return Promise.all(branches.map(async (name) => {
    const { ok, stdout } = await git(repoPath, [...GIT.ARGS.LOG, `${GIT.FLAG_MAX_COUNT}1`, name]);
    const line = ok ? stdout.split(P.NEWLINE)[0] : P.EMPTY;
    const [sha, shortSha, subject, authorName, , date] = line.split(GIT.LOG_FIELD_SEPARATOR);

    return { name, sha: sha ?? P.EMPTY, shortSha: shortSha ?? P.EMPTY, subject: subject ?? P.EMPTY, authorName: authorName ?? P.EMPTY, date: date ?? P.EMPTY };
  }));
}

export async function searchProject(repoPath, query, { limit = GIT.MAX_SEARCH_HITS } = {}) {
  const trimmed = String(query ?? P.EMPTY).trim();
  if (trimmed.length < GIT.MIN_SEARCH_LENGTH) return [];

  const [content, paths] = await Promise.all([
    git(repoPath, [
      ...GIT.ARGS.GREP_LINES,
      GIT.FLAG_IGNORE_CASE,



      GIT.FLAG_PATTERN,
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
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.SHOW_STAT, GIT.END_OF_OPTIONS, safeRef(sha)]);
  return ok ? stdout : P.EMPTY;
}

export async function pushedShas(repoPath) {
  const { ok, stdout } = await git(repoPath, GIT.ARGS.REV_LIST_UNPUSHED);
  if (!ok) return new Set();

  const unpushed = new Set(stdout.split(P.NEWLINE).filter(Boolean));
  const { ok: headOk, stdout: headOut } = await git(repoPath, GIT.ARGS.REV_LIST_HEAD);
  if (!headOk) return new Set();

  const pushed = new Set();
  for (const sha of headOut.split(P.NEWLINE).filter(Boolean)) {
    if (!unpushed.has(sha)) pushed.add(sha);
  }
  return pushed;
}

export async function renameCommit(repoPath, sha, message, { allowPushed = false } = {}) {
  const resolved = await resolveCommit(repoPath, sha);
  if (!resolved) throw new Error(`${GIT.ERROR_COMMIT_NOT_FOUND}${sha}`);

  if (!allowPushed) {
    const pushed = await pushedShas(repoPath);
    if (pushed.has(resolved)) throw new Error(GIT.ERROR_COMMIT_PUSHED);
  }

  const head = await resolveCommit(repoPath, GIT.DEFAULT_REF);
  if (!head) throw new Error(GIT.ERROR_NOTHING_TO_REWRITE);



  if (!(await isAncestor(repoPath, resolved, head))) {
    throw new Error(`${GIT.ERROR_COMMIT_NOT_ON_BRANCH}${resolved.slice(P.ZERO, GIT.SHORT_SHA_LENGTH)}`);
  }

  if (resolved === head) {
    await amendMessage(repoPath, message);
    return resolveCommit(repoPath, GIT.DEFAULT_REF);
  }

  return replayWithNewMessage(repoPath, resolved, head, message);
}

async function isAncestor(repoPath, sha, ref) {
  const { ok } = await git(repoPath, [...GIT.ARGS.MERGE_BASE, GIT.ARGS.IS_ANCESTOR, GIT.END_OF_OPTIONS, sha, ref]);
  return ok;
}
async function amendMessage(repoPath, message) {
  const { ok, stderr } = await git(repoPath, [...GIT.ARGS.COMMIT_AMEND_MESSAGE, message]);
  if (!ok) throw new Error(stderr?.trim() || "git commit --amend failed.");
}

async function replayWithNewMessage(repoPath, sha, head, message) {
  const parent = await firstParent(repoPath, sha);
  const tree = await revParse(repoPath, `${sha}${GIT.TREE_SUFFIX}`);
  if (!tree) throw new Error(GIT.ERROR_NO_TREE);

  const backup = `${GIT.BACKUP_REF_PREFIX}${sha.slice(P.ZERO, GIT.SHORT_SHA_LENGTH)}`;
  await git(repoPath, [...GIT.ARGS.UPDATE_REF, backup, head]);

  const created = await git(repoPath, [
    GIT.ARGS.COMMIT_TREE,
    tree,
    ...(parent ? [GIT.FLAGS.PARENT, parent] : []),
    ...GIT.ARGS.COMMIT_MESSAGE, message,
  ]);

  const newSha = created.ok ? created.stdout.trim() : null;
  if (!newSha) throw new Error(created.stderr?.trim() || GIT.ERROR_COMMIT_TREE_FAILED);




  const branch = await currentBranch(repoPath);
  const rebaseArgs = parent
    ? [...GIT.ARGS.REBASE_ONTO, newSha, parent, branch]
    : [...GIT.ARGS.REBASE_ROOT, newSha, branch];

  const rebased = await git(repoPath, rebaseArgs);
  if (!rebased.ok) {
    await git(repoPath, GIT.ARGS.REBASE_ABORT);
    await git(repoPath, [...GIT.ARGS.RESET, head]);
    throw new Error(rebased.stderr?.trim() || `${GIT.ERROR_REWRITE_FAILED}${backup}.`);
  }

  return resolveCommit(repoPath, GIT.DEFAULT_REF);
}
async function firstParent(repoPath, sha) {
  const { ok, stdout } = await git(repoPath, [GIT.REV_LIST, GIT.FLAGS.PARENTS, GIT.FLAGS.MAX_COUNT_ONE, sha]);
  if (!ok) return null;

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








  const trackedArgs = includeStaged
    ? [...GIT.ARGS.DIFF, GIT.DEFAULT_REF, ...pathspec]
    : [...GIT.ARGS.DIFF, ...pathspec];
  const tracked = await git(repoPath, trackedArgs);
  if (tracked.ok) parts.push(tracked.stdout);

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




  return parts
    .filter(Boolean)
    .map((part) => part.replace(/\n+$/, P.NEWLINE))
    .join(P.EMPTY);
}
export async function diffBetween(repoPath, base, head) {
  const { ok, stdout } = await git(repoPath, [
    ...GIT.ARGS.DIFF, GIT.END_OF_OPTIONS, `${safeRef(base)}${GIT.RANGE_SEPARATOR}${safeRef(head ?? GIT.DEFAULT_REF)}`,
  ]);
  return ok ? stdout : P.EMPTY;
}
export async function fileContent(repoPath, ref, filePath) {
  const { ok, stdout } = await git(repoPath, [GIT.SHOW, GIT.END_OF_OPTIONS, `${ref}:${filePath}`]);
  return ok ? stdout : null;
}

export async function listFiles(repoPath, { ref = GIT.DEFAULT_REF } = {}) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.LS_TREE, ref]);
  if (!ok) return [];
  return stdout.split(P.NEWLINE).map((line) => line.trim()).filter(Boolean);
}

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

export async function workingTreeStatus(repoPath) {
  const [changed, untracked] = await Promise.all([
    git(repoPath, [...GIT.ARGS.DIFF_NAME_STATUS, GIT.DEFAULT_REF]),
    git(repoPath, GIT.ARGS.LS_FILES_UNTRACKED),
  ]);

  const map = {};

  if (changed.ok && changed.stdout) {
    for (const line of changed.stdout.split(P.NEWLINE)) {
      const [raw, ...rest] = line.trim().split(P.TAB);
      if (!raw) continue;
      const code = raw.trim().toUpperCase();
      let path = rest.join(P.TAB).trim();
      if (code.startsWith(GIT.STATUS_RENAME)) path = rest[rest.length - P.ONE] || rest[P.ZERO];
      if (!path) continue;
      map[path] = toStatus(code);
    }
  }

  if (untracked.ok && untracked.stdout) {
    for (const path of untracked.stdout.split(P.NEWLINE).map((line) => line.trim()).filter(Boolean)) {

      if (path.startsWith(`${GIT.LEGACY_ARTIFACT_DIR}${P.SLASH}`)) continue;
      if (!map[path]) map[path] = GIT.STATUS_ADDED_NAME;
    }
  }

  return map;
}
function toStatus(code) {

  if (code.startsWith(GIT.STATUS_RENAME)) return GIT.STATUS_RENAMED;
  if (code === GIT.STATUS_ADDED) return GIT.STATUS_ADDED_NAME;
  if (code === GIT.STATUS_DELETED) return GIT.STATUS_DELETED_NAME;
  return GIT.STATUS_MODIFIED;
}

export async function readBlobs(repoPath, paths, { ref = GIT.DEFAULT_REF } = {}) {
  const unique = Array.from(new Set(paths)).filter(Boolean);
  const result = new Map();
  if (!unique.length) return result;

  const input = unique.map((path) => `${ref}:${path}`).join(P.NEWLINE) + P.NEWLINE;

  return new Promise((resolve) => {
    const child = spawn(resolveGitBinary(), GIT.ARGS.CAT_FILE_BATCH, { cwd: repoPath, windowsHide: true });
    const chunks = [];

    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", () => resolve(result));
    child.on("close", () => {
      resolve(parseBatchOutput(Buffer.concat(chunks), unique));
    });

    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
function parseBatchOutput(buffer, paths) {
  const result = new Map();
  let offset = P.ZERO;
  let index = P.ZERO;

  while (offset < buffer.length && index < paths.length) {
    const newline = buffer.indexOf(GIT.NEWLINE_BYTE, offset);
    if (newline === GIT.NEWLINE_NOT_FOUND) break;

    const header = buffer.toString("utf8", offset, newline);
    offset = newline + P.ONE;

    const parts = header.split(P.SPACE);
    const path = paths[index];
    index += P.ONE;

    if (parts.length < GIT.BATCH_HEADER_PARTS || parts[P.ONE] === GIT.MISSING_OBJECT) continue;

    const size = Number(parts[P.TWO]);
    if (!Number.isFinite(size) || size < P.ZERO) continue;

    result.set(path, buffer.toString("utf8", offset, offset + size));
    offset += size + P.ONE;
  }

  return result;
}
