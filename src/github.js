/** GitHub pull-request scope, read through the GitHub CLI. */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { git } from "./git.js";
import { GH, GIT, P } from "./config.js";
const exec = promisify(execFile);
/** The GitHub CLI executable, or the plain name when it is on PATH. */
export function ghBinary(env = process.env) {
  const configured = env[GH.ENV_BIN];
  if (configured && configured.trim()) return configured.trim();
  return GH.BIN;
}
/** File extensions of a script that must be run with the Node binary. */
const NODE_SCRIPT = /\.(?:mjs|cjs|js)$/i;
/** The command and leading arguments that run `gh`. */
export function ghCommand(env = process.env) {
  const binary = ghBinary(env);
  return NODE_SCRIPT.test(binary)
    ? { file: process.execPath, prefix: [binary] }
    : { file: binary, prefix: [] };
}
/** True when the configured `gh` exists or is resolvable on PATH. */
export function hasGh(env = process.env) {
  const binary = ghBinary(env);
  if (binary !== GH.BIN) return existsSync(binary);
  return true;
// resolved by the shell; a missing binary fails at spawn with a clear error
}
/** Runs `gh` and returns its stdout. */
async function gh(repoPath, args, { allowFailure = true } = {}) {
  const { file, prefix } = ghCommand();
  try {
    const { stdout } = await exec(file, [...prefix, ...args], {
      cwd: repoPath,
      maxBuffer: GIT.MAX_BUFFER,
      windowsHide: true,
      encoding: "utf8",
      env: { ...process.env, GH_PAGER: P.EMPTY, GH_PROMPT_DISABLED: "1" },
    });
    return { ok: true, stdout };
  } catch (error) {
    if (error.code === GIT.ENOENT) {
      const failure = new Error(GH.ERROR_NO_BIN);
      if (allowFailure) return { ok: false, error: failure, missingBinary: true };
      throw failure;
    }

    const stderr = String(error.stderr ?? error.message ?? P.EMPTY).trim();
    // A configured wrapper script that does not exist: node starts, cannot load

    // logged-out user.
    if (/cannot find module|no such file|ENOENT/i.test(stderr)) {
      const failure = new Error(GH.ERROR_NO_BIN);
      if (allowFailure) return { ok: false, error: failure, missingBinary: true, stderr };
      throw failure;
    }

    const failure = /auth|login|authentication/i.test(stderr)
      ? new Error(`${GH.ERROR_NOT_AUTHED} (${stderr})`)
      : new Error(stderr || GH.ERROR_NO_PR);
    if (allowFailure) return { ok: false, error: failure, stderr };
    throw failure;
  }
}
/** Reads one pull request. */
export async function viewPullRequest(repoPath, selector = {}) {
  await assertAuthenticated(repoPath);

  const args = [...GH.ARGS_VIEW];
  if (selector.number !== undefined && selector.number !== null && String(selector.number).trim()) {
    args.push(String(selector.number).trim());
  }
  args.push(...GH.ARGS_JSON, GH.FIELDS.join(P.COMMA));
  if (selector.repo) args.push(...GH.ARGS_REPO, selector.repo);

  const result = await gh(repoPath, args, { allowFailure: false });

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(GH.ERROR_BAD_JSON);
  }
  return normalizePullRequest(parsed);
}
/** Lists the pull requests of a repository, newest first. */
export async function listPullRequests(repoPath, options = {}) {
  await assertAuthenticated(repoPath);

  const state = GH.LIST_STATES.includes(options.state) ? options.state : GH.LIST_STATES[P.ZERO];
  const limit = clampLimit(options.limit);

  const args = [...GH.ARGS_LIST, "--state", state, "--limit", String(limit), ...GH.ARGS_JSON, GH.LIST_FIELDS.join(P.COMMA)];
  if (options.repo) args.push(...GH.ARGS_REPO, options.repo);

  const result = await gh(repoPath, args, { allowFailure: false });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(GH.ERROR_BAD_JSON);
  }

  return Array.isArray(parsed) ? parsed.map(normalizePullRequestSummary) : [];
}
/** Maps one `gh pr list` entry onto the fields the agent shows. */
export function normalizePullRequestSummary(raw) {
  const number = Number(raw?.number);
  return {
    number: Number.isFinite(number) ? number : null,
    title: String(raw?.title ?? P.EMPTY),
    state: String(raw?.state ?? P.EMPTY),
    draft: raw?.isDraft === true,
    headRefName: String(raw?.headRefName ?? P.EMPTY),
    baseRefName: String(raw?.baseRefName ?? P.EMPTY),
    url: String(raw?.url ?? P.EMPTY),
    author: String(raw?.author?.login ?? P.EMPTY),
    updatedAt: String(raw?.updatedAt ?? P.EMPTY),
  };
}
function clampLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= P.ZERO) return GH.LIST_DEFAULT_LIMIT;
  return Math.min(Math.floor(number), GH.LIST_MAX_LIMIT);
}
/** Verifies that `gh` is logged in, and turns a failure into the actionable message the page shows. */
async function assertAuthenticated(repoPath) {
  const result = await gh(repoPath, GH.ARGS_AUTH_STATUS, { allowFailure: true });
  if (result.ok) return;
  // A missing binary is a different problem than a logged-out user.
  if (result.missingBinary) throw result.error;
  throw new Error(GH.ERROR_NOT_AUTHED);
}
/** Maps the `gh pr view --json` payload onto the fields the page uses. */
export function normalizePullRequest(raw) {
  const number = Number(raw?.number);
  return {
    number: Number.isFinite(number) ? number : null,
    title: String(raw?.title ?? P.EMPTY),
    url: String(raw?.url ?? P.EMPTY),
    state: String(raw?.state ?? P.EMPTY),
    draft: raw?.isDraft === true,
    baseRefName: String(raw?.baseRefName ?? P.EMPTY),
    headRefName: String(raw?.headRefName ?? P.EMPTY),
    baseOid: String(raw?.baseRefOid ?? P.EMPTY),
    headOid: String(raw?.headRefOid ?? P.EMPTY),
    author: String(raw?.author?.login ?? P.EMPTY),
    body: String(raw?.body ?? P.EMPTY),
    additions: Number(raw?.additions ?? P.ZERO),
    deletions: Number(raw?.deletions ?? P.ZERO),
    changedFiles: Number(raw?.changedFiles ?? P.ZERO),
  };
}
/** Makes sure both commits of the PR exist locally, then returns their SHAs. */
export async function ensurePullRequestCommits(repoPath, pr, { remote = GH.DEFAULT_REMOTE } = {}) {
  const base = await ensureBase(repoPath, pr, remote);
  if (!base) throw new Error(`${GH.ERROR_FETCH_FAILED}cannot resolve base ${pr.baseRefName}.`);

  if (pr.headOid && (await commitExists(repoPath, pr.headOid))) {
    return { base, head: pr.headOid, fetched: false };
  }

  const localRef = `${GH.HEAD_REF_PREFIX}${pr.number ?? "head"}`;
  // Prefer the canonical pull ref: it works even when the source branch lives
  // on a fork, where `remote/branch` does not exist.
  const pullRef = GH.HEAD_REF_TEMPLATE.replace("{number}", String(pr.number ?? P.EMPTY));
  const attempts = [
    [remote, pullRef],
    [remote, `${pr.headRefName}`],
  ];

  for (const [from, ref] of attempts) {
    if (!ref) continue;
    const fetched = await git(repoPath, [...GH.ARGS_FETCH, from, `${ref}:${localRef}`]);
    if (fetched.ok) {
      const sha = await revParse(repoPath, localRef);
      if (sha) {
        // A fetched ref may disagree with the SHA gh reported (the PR moved
        // between the two calls). The reported head is the one to review.
        if (pr.headOid && (await commitExists(repoPath, pr.headOid))) {
          return { base, head: pr.headOid, fetched: true };
        }
        return { base, head: sha, fetched: true };
      }
    }
  }

  throw new Error(`${GH.ERROR_FETCH_FAILED}${pr.headRefName || pr.number || "the head"}.`);
}
/** The base commit, fetched into a PRIVATE ref when it is not present locally. */
async function ensureBase(repoPath, pr, remote) {
  if (pr.baseOid && (await commitExists(repoPath, pr.baseOid))) return pr.baseOid;
  // A fetch into a private ref: no remote-tracking branch is touched.
  const localRef = `${GH.BASE_REF_PREFIX}${pr.number ?? "base"}`;
  const targets = [];
  if (pr.baseOid) targets.push(pr.baseOid);
  if (pr.baseRefName) targets.push(pr.baseRefName);

  for (const ref of targets) {
    if (!ref) continue;
    const fetched = await git(repoPath, [...GH.ARGS_FETCH, remote, `${ref}:${localRef}`]);
    if (!fetched.ok) continue;
    const sha = await revParse(repoPath, localRef);
    if (sha) return sha;
  }
  // Last resort: an already-present remote-tracking branch or local branch.
  if (pr.baseRefName) {
    for (const ref of [`${remote}/${pr.baseRefName}`, pr.baseRefName]) {
      const sha = await revParse(repoPath, ref);
      if (sha) return sha;
    }
  }

  return null;
}
async function commitExists(repoPath, sha) {
// `rev-parse --verify` only checks that the string looks like an object name;
  // really looks the object up, which is what "already fetched" means here.
  const { ok } = await git(repoPath, [...GIT.ARGS.CAT_FILE_EXISTS, sha]);
  return ok;
}
async function revParse(repoPath, ref) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.REV_PARSE_COMMIT, `${ref}${GIT.COMMIT_SUFFIX}`]);
  return ok ? stdout.trim() : null;
}
