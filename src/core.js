import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { commitDiff, currentBranch, diffBetween, listCommits, pushedShas, remoteUrl, renameCommit, resolveCommit, resolveRepo, searchProject } from "./git.js";
import { loadScopeCommits } from "./models/commits.js";
import { diffStats } from "./diff.js";
import { buildFilePage, buildMarkdown, buildPage, loadAssets, reviewId } from "./render.js";
import { servePage, writeReviewFiles } from "./server.js";
import { buildSymbolIndex } from "./symbols.js";
import { readFileForViewer, readFilesForHighlight } from "./fileview.js";
import { MODE_LABELS, DIFF, GIT, MODE, P, SERVER } from "./config.js";
import { removeLegacyArtifacts, reviewDir } from "./artifacts.js";
import { repoLabel } from "./models/repo.js";
import { resolveScope } from "./models/scope.js";
import { buildProjectTree } from "./models/tree.js";
import { toDiffSet, toFileModel } from "./models/diffset.js";
import { attachGapMetadata } from "./models/gaps.js";
import { readReviewOwner, writeReviewOwner } from "./models/owner.js";
import { buildDispatchMessage, buildDispatchPrompt, currentSessionId, dispatchToSession, resolveSessionId, writeDispatchPrompt } from "./dispatch.js";
export { MODE_LABELS, repoLabel };
/** Reason returned when a submit carries no comments and no summary. */
const AGENT_REASON_EMPTY_REVIEW = "The review has no comments or summary, so there is nothing to fix.";
export async function buildReview(params) {
  const root = await resolveRepo(resolve(params.repoPath ?? process.cwd()));
  const scope = await resolveScope(root, params);
  const pr = scope.pr ?? null;
  // For a PR the checked-out branch is irrelevant: the review is about the PR's head branch, so…
  const branch = params.branch ?? (pr?.headRefName || (await currentBranch(root)));
  const repo = repoLabel(root, await remoteUrl(root));
  // toFileModel already applies the tree ordering, so the diff list and the sidebar share one…
  const files = toFileModel(scope.diffText);
  await attachGapMetadata(root, files, gapOptions(params.mode, scope));
  const stats = diffStats(files);
  const allFiles = await buildProjectTree(root, { mode: params.mode, base: scope.base, head: scope.head });
  // picker point at the wrong commits.
  const commits = await loadScopeCommits(root, scope);
  const [pushedList, headSha] = await Promise.all([loadPushedShas(root), resolveCommit(root, GIT.DEFAULT_REF)]);
  const pushedSet = new Set(pushedList);

  const meta = {
    // A PR is identified by its number, not just its commit range: two PRs that point at the same…
    id: reviewId({
      repo,
      branch,
      base: scope.base,
      head: scope.head,
      mode: params.mode,
      scope: scope.scopeKey ?? P.EMPTY,
      fingerprint: diffFingerprint(files),
    }),
    repo,
    branch,
    base: scope.base,
    head: scope.head,
    mode: params.mode,
    modeLabel: MODE_LABELS[params.mode] ?? params.mode,

    // must always go back to the conversation the user is actually in.
    sessionId: params.sessionId ?? currentSessionId(),
    commits: commits.map((commit) => toCommitSummary(commit, pushedSet, headSha)),
    title: params.title ?? scope.label ?? MODE_LABELS[params.mode] ?? params.mode,
    allFiles,
    // Pull request shown in the header (null for a local scope).
    pr,
  };

  return { root, meta, files, stats, allFiles, scope };
}
