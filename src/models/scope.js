/** Review scope resolution: one place that answers "which diff are we reviewing?". */
import {
  diffBetween,
  diffFromTo,
  diffUncommitted,
  listCommits,
  mergeBase,
  orderCommits,
  parentOrEmptyTree,
  resolveCommit,
} from "../git.js";
import { GH, GIT, MODE, P } from "../config.js";
import { commitsSinceMergeBase, defaultBase } from "./commits.js";
import { ensurePullRequestCommits, pullRequestScope, pullRequestTitle, viewPullRequest } from "../github.js";
export async function resolveScope(root, params) {
  switch (params.mode) {
    case MODE.UNCOMMITTED: return resolveUncommitted(root, params);
    case MODE.COMMITS: return resolveCommits(root, params);
    case MODE.BRANCH: return resolveBranch(root, params);
    case MODE.RANGE: return resolveRange(root, params);
    case MODE.ALL: return resolveAll(root, params);
    case MODE.PR: return resolvePullRequest(root, params);
    default: throw new Error(`${SCOPE_ERROR_UNKNOWN_MODE}${params.mode}`);
  }
}
async function resolveUncommitted(root, params) {
  const diffText = await diffUncommitted(root, {
    includeStaged: params.includeStaged !== false,
    includeUntracked: params.includeUntracked !== false,
  });
  return { diffText, commits: P.EMPTY_ARRAY, base: params.base ?? null, head: params.head ?? null };
}
async function resolveCommits(root, params) {
  const refs = params.commits ?? P.EMPTY_ARRAY;
  if (!refs.length) throw new Error(SCOPE_ERROR_COMMITS_REQUIRED);

  const resolved = [];
  for (const ref of refs) {
    const sha = await resolveCommit(root, ref);
    if (!sha) throw new Error(`${SCOPE_ERROR_COMMIT_NOT_FOUND}${ref}`);
    resolved.push(sha);
  }
  // same file is often touched by two selected commits, and concatenating the
  // patches listed it twice. The UI keys "viewed"/collapse by path, so two
  // sections of one path shared a single flag and the second click cleared it.
  const ordered = await orderCommits(root, resolved);
  const head = ordered[P.ZERO];
  const oldest = ordered[ordered.length - P.ONE];
  const base = await parentOrEmptyTree(root, oldest);

  return {
    diffText: await diffFromTo(root, base, head),
    commits: await describeCommits(root, ordered),
    base,
    head,
  };
}
async function describeCommits(root, ordered) {
  const log = await listCommits(root, { limit: GIT.MAX_HISTORY }).catch(() => P.EMPTY_ARRAY);

  return ordered.map((sha) => log.find((commit) => commit.sha === sha)
    ?? { sha, shortSha: sha.slice(P.ZERO, GIT.SHORT_SHA_LENGTH), subject: sha.slice(P.ZERO, GIT.SHORT_SHA_LENGTH), authorName: P.EMPTY, authorEmail: P.EMPTY, date: P.EMPTY });
}
/** Commits of the reviewed line of work. */
async function resolveBranch(root, params) {
  const base = params.base ?? (await defaultBase(root));
  const head = params.head ?? GIT.DEFAULT_REF;
  return {
    diffText: await diffBetween(root, base, head),
    commits: await commitsSinceMergeBase(root, base, head, params.limit ?? GIT.MAX_COMMITS),
    base,
    head,
  };
}
