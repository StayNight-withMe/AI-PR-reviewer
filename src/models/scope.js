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
