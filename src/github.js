
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { git } from "./git.js";
import { GH, GIT, P } from "./config.js";
const exec = promisify(execFile);

export function ghBinary(env = process.env) {
  const configured = env[GH.ENV_BIN];
  if (configured && configured.trim()) return configured.trim();
  return GH.BIN;
}

const NODE_SCRIPT = /\.(?:mjs|cjs|js)$/i;

export function ghCommand(env = process.env) {
  const binary = ghBinary(env);
  return NODE_SCRIPT.test(binary)
    ? { file: process.execPath, prefix: [binary] }
    : { file: binary, prefix: [] };
}

export function hasGh(env = process.env) {
  const binary = ghBinary(env);
  if (binary !== GH.BIN) return existsSync(binary);
  return true;

}

async function gh(repoPath, args, { allowFailure = true, input } = {}) {
  const { file, prefix } = ghCommand();
  try {
    const stdout = input === undefined
      ? (await exec(file, [...prefix, ...args], EXEC_OPTIONS(repoPath))).stdout


      : await runWithInput(file, [...prefix, ...args], input, repoPath);
    return { ok: true, stdout };
  } catch (error) {
    if (error.code === GIT.ENOENT) {
      const failure = new Error(GH.ERROR_NO_BIN);
      if (allowFailure) return { ok: false, error: failure, missingBinary: true };
      throw failure;
    }

    const stderr = String(error.stderr ?? error.message ?? P.EMPTY).trim();



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

function EXEC_OPTIONS(repoPath) {
  return {
    cwd: repoPath,
    maxBuffer: GIT.MAX_BUFFER,
    windowsHide: true,
    encoding: "utf8",
    env: { ...process.env, GH_PAGER: P.EMPTY, GH_PROMPT_DISABLED: "1" },
  };
}

function runWithInput(file, args, input, repoPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: repoPath,
      windowsHide: true,
      env: { ...process.env, GH_PAGER: P.EMPTY, GH_PROMPT_DISABLED: "1" },
    });

    const out = [];
    const err = [];
    let size = P.ZERO;

    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > GIT.MAX_BUFFER) {
        child.kill();
        reject(new Error(GH.ERROR_PUBLISH_FAILED + "the response was too large."));
        return;
      }
      out.push(chunk);
    });
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      if (code === P.ZERO) {
        resolve(stdout);
        return;
      }
      const failure = new Error(Buffer.concat(err).toString("utf8").trim() || `gh exited with ${code}`);
      failure.stdout = stdout;
      reject(failure);
    });

    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

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
  const pr = normalizePullRequest(parsed);


  if (selector.repo) pr.repo = selector.repo;
  return pr;
}

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

async function assertAuthenticated(repoPath) {
  const result = await gh(repoPath, GH.ARGS_AUTH_STATUS, { allowFailure: true });
  if (result.ok) return;

  if (result.missingBinary) throw result.error;
  throw new Error(GH.ERROR_NOT_AUTHED);
}

export function repoFromUrl(url) {
  const match = /github\.com[:/]+([^/]+)\/([^/?#]+)/i.exec(String(url ?? P.EMPTY));
  return match ? `${match[P.ONE]}/${match[P.TWO].replace(/\.git$/i, P.EMPTY)}` : P.EMPTY;
}

export function normalizePullRequest(raw) {
  const number = Number(raw?.number);
  const url = String(raw?.url ?? P.EMPTY);
  return {
    number: Number.isFinite(number) ? number : null,
    title: String(raw?.title ?? P.EMPTY),
    url,


    repo: repoFromUrl(url),
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

export async function ensurePullRequestCommits(repoPath, pr, { remote = GH.DEFAULT_REMOTE } = {}) {
  const base = await ensureBase(repoPath, pr, remote);
  if (!base) throw new Error(`${GH.ERROR_FETCH_FAILED}cannot resolve base ${pr.baseRefName}.`);

  if (pr.headOid && (await commitExists(repoPath, pr.headOid))) {
    return { base, head: pr.headOid, fetched: false };
  }

  const localRef = `${GH.HEAD_REF_PREFIX}${pr.number ?? "head"}`;


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


        if (pr.headOid && (await commitExists(repoPath, pr.headOid))) {
          return { base, head: pr.headOid, fetched: true };
        }
        return { base, head: sha, fetched: true };
      }
    }
  }

  throw new Error(`${GH.ERROR_FETCH_FAILED}${pr.headRefName || pr.number || "the head"}.`);
}

async function ensureBase(repoPath, pr, remote) {
  if (pr.baseOid && (await commitExists(repoPath, pr.baseOid))) return pr.baseOid;

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

  if (pr.baseRefName) {
    for (const ref of [`${remote}/${pr.baseRefName}`, pr.baseRefName]) {
      const sha = await revParse(repoPath, ref);
      if (sha) return sha;
    }
  }

  return null;
}
async function commitExists(repoPath, sha) {


  const { ok } = await git(repoPath, [...GIT.ARGS.CAT_FILE_EXISTS, sha]);
  return ok;
}
async function revParse(repoPath, ref) {
  const { ok, stdout } = await git(repoPath, [...GIT.ARGS.REV_PARSE_COMMIT, `${ref}${GIT.COMMIT_SUFFIX}`]);
  return ok ? stdout.trim() : null;
}

export function pullRequestScope(pr) {
  return `${GH.SCOPE_PREFIX}${pr.number ?? P.EMPTY}`;
}

export function pullRequestTitle(pr) {
  const number = pr.number ? `${GH.TITLE_PREFIX}${pr.number}` : GH.TITLE_PREFIX.trim();
  return pr.title ? `${number}: ${pr.title}` : number;
}

const REVIEW_FLAGS = {
  APPROVE: GH.FLAG_APPROVE,
  REQUEST_CHANGES: GH.FLAG_REQUEST_CHANGES,
  COMMENT: GH.FLAG_COMMENT,
};

export function toGitHubComment(comment) {
  const start = Number(comment?.lineStart);
  const end = Number(comment?.lineEnd ?? comment?.lineStart);
  const side = comment?.side === "left" ? "LEFT" : "RIGHT";
  const body = String(comment?.body ?? P.EMPTY).trim();
  const path = String(comment?.path ?? P.EMPTY);



  if (!path || !Number.isFinite(start) || start <= P.ZERO || !body) return null;


  if (comment?.outdated === true) return null;

  const last = Number.isFinite(end) && end >= start ? end : start;
  const payload = { path, body, side, line: last };
  if (last > start) {
    payload.start_line = start;
    payload.start_side = side;
  }
  return payload;
}

export function toGitHubReview(review) {
  const state = REVIEW_FLAGS[review?.reviewState] ? review.reviewState : "COMMENT";
  const inline = [];
  const loose = [];

  for (const comment of Array.isArray(review?.comments) ? review.comments : []) {
    const mapped = toGitHubComment(comment);
    if (mapped) inline.push(mapped);
    else if (String(comment?.body ?? P.EMPTY).trim()) loose.push(comment);
  }

  const parts = [];
  const body = String(review?.reviewBody ?? P.EMPTY).trim();
  if (body) parts.push(body);


  if (loose.length) {
    parts.push("**Comments that do not belong to a line**");
    for (const comment of loose) {
      parts.push(`- \`${comment.path}\`: ${String(comment.body).trim()}`);
    }
  }



  const kept = inline.slice(P.ZERO, GH.MAX_INLINE_COMMENTS);
  const overflow = inline.slice(GH.MAX_INLINE_COMMENTS);
  if (overflow.length) {
    parts.push("**Comments over GitHub's limit of " + GH.MAX_INLINE_COMMENTS + " inline comments**");
    for (const comment of overflow) {
      parts.push(`- \`${comment.path}\` line ${comment.line}: ${comment.body}`);
    }
  }

  const reviewBody = parts.join("\n\n");
  if (reviewBody.length > GH.MAX_BODY_CHARS) {
    throw new Error(`The review body exceeds GitHub's limit of ${GH.MAX_BODY_CHARS} characters. Shorten it before publishing.`);
  }

  return {
    state,
    event: state,
    body: reviewBody,
    comments: kept,
    bodyComments: loose.length + overflow.length,
    overflowComments: overflow.length,
  };
}

export async function publishReview(repoPath, { review, pr, repo }) {
  if (!pr?.number) throw new Error(GH.ERROR_NOT_A_PR);
  await assertAuthenticated(repoPath);

  const payload = toGitHubReview(review);
  const target = repo || pr.repo || null;




  if (!payload.comments.length) return publishSimpleReview(repoPath, payload, pr, target);

  const resolved = target || (await repositoryOf(repoPath));
  if (!resolved) throw new Error(`${GH.ERROR_PUBLISH_FAILED}cannot tell which repository this is.`);

  const denormalized = {
    body: payload.body,
    event: payload.event,
    comments: payload.comments,
  };



  if (pr.headOid) denormalized.commit_id = pr.headOid;
  const result = await gh(repoPath, [
    ...GH.ARGS_API,
    GH.FLAG_METHOD, GH.HTTP_POST,
    GH.PR_REVIEWS_ENDPOINT.replace(GH.PLACEHOLDER_REPO, resolved).replace(GH.PLACEHOLDER_NUMBER, String(pr.number)),
    GH.FLAG_INPUT, GH.STDIN,
  ], { allowFailure: true, input: JSON.stringify(denormalized) });

  if (!result.ok) throw new Error(`${GH.ERROR_PUBLISH_FAILED}${result.error?.message ?? P.EMPTY}`);

  let url = P.EMPTY;
  try {
    url = JSON.parse(result.stdout)?.html_url ?? P.EMPTY;
  } catch {

  }

  return {
    published: true,
    state: payload.state,
    inlineComments: payload.comments.length,
    bodyComments: payload.bodyComments,
    overflowComments: payload.overflowComments,
    url,
  };
}

async function publishSimpleReview(repoPath, payload, pr, repo) {
  const args = [...GH.ARGS_REVIEW, String(pr.number), REVIEW_FLAGS[payload.state]];
  if (payload.body) args.push(...GH.ARGS_REVIEW_BODY, payload.body);
  if (repo) args.push(...GH.ARGS_REPO, repo);

  const result = await gh(repoPath, args, { allowFailure: true });
  if (!result.ok) throw new Error(`${GH.ERROR_PUBLISH_FAILED}${result.error?.message ?? P.EMPTY}`);

  return {
    published: true,
    state: payload.state,
    inlineComments: P.ZERO,
    bodyComments: payload.bodyComments,
    overflowComments: payload.overflowComments,
    url: pr.url ?? P.EMPTY,
  };
}

async function repositoryOf(repoPath) {
  const { ok, stdout } = await git(repoPath, GIT.ARGS.REMOTE);
  if (!ok) return null;

  const value = stdout.trim();

  const match = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(value);
  return match ? `${match[P.ONE]}/${match[P.TWO]}` : null;
}
