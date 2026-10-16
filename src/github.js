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
