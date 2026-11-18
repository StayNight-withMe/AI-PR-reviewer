import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { commitDiff, currentBranch, diffBetween, listBranches, listCommits, pushedShas, remoteUrl, renameCommit, resolveCommit, resolveRepo, searchProject } from "./git.js";
import { commitsSinceMergeBase, defaultBase, loadScopeCommits } from "./models/commits.js";
import { diffStats } from "./diff.js";
import { buildFilePage, buildMarkdown, buildPage, loadAssets, reviewId } from "./render.js";
import { servePage, writeReviewFiles } from "./server.js";
import { buildSymbolIndex } from "./symbols.js";
import { readFileForViewer, readFilesForHighlight } from "./fileview.js";
import { MODE_LABELS, DIFF, GIT, MODE, P, REVIEW_STATE, SERVER } from "./config.js";
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
/** Reason returned when the review was opened with auto-send turned off. */
const AGENT_REASON_DISPATCH_DISABLED = "Auto-send is turned off for this review, so no agent turn was started.";
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
/** Where the gap metadata has to be read from. */
function gapOptions(mode, scope) {
  if (mode === MODE.UNCOMMITTED) {
    return {
      useWorkingTree: true,
      refs: [GIT.DEFAULT_REF, scope.base].filter(Boolean),
    };
  }
  return { ref: scope.head };
}
/** A short fingerprint of the reviewed change set. */
function diffFingerprint(files) {
  return files
    .map((file) => `${file.path}:${file.additions}+${file.deletions}-${file.hunks.length}h`)
    .join(P.PIPE);
}
/** Commits already on a remote can only be rewritten with explicit consent. */
async function loadPushedShas(root) {
  const shas = await pushedShas(root).catch(() => new Set());
  return Array.from(shas);
}
function toCommitSummary(commit, pushedSet, headSha) {
  return {
    sha: commit.sha,
    shortSha: commit.shortSha,
    subject: commit.subject,
    authorName: commit.authorName,
    date: commit.date,
    pushed: pushedSet.has(commit.sha),
    isHead: commit.sha === headSha,
  };
}
export async function startReview(params) {
  const { root, meta, files, stats, allFiles, scope } = await buildReview(params);
  // Artifacts are scratch data, not project data: by default they live outside

  const outputDir = params.outputDir || reviewDir(root, meta.id, params.env);
  await mkdir(outputDir, { recursive: true });
  // A `.pr-review/` left by an older version is removed once, so the checkout does not keep a…
  await removeLegacyArtifacts(root);
  // Record who owns the review so a submit goes back to the right session even when the inherited…
  await writeReviewOwner(outputDir, meta.sessionId);

  await loadAssets();

  const symbolIndex = params.symbols === false
    ? { symbols: {}, definitions: {}, usages: {}, implementations: {} }
    : await buildSymbolIndex(root);
  const symbols = symbolIndex.symbols;
  const usages = symbolIndex.usages;
  const implementations = symbolIndex.implementations;

  const collapsed = files.filter((f) => f.status === DIFF.STATUS.DELETED).map((f) => f.path);

  const onReview = async (review, reviewMeta) =>
    writeReviewFiles(outputDir, reviewMeta, review, buildMarkdown(reviewMeta, review));
  // Deleted files may be absent from the working tree AND from HEAD (deleted inside a range), so…
  const fallbackRefs = [GIT.DEFAULT_REF, meta.base].filter(Boolean);
  // A PR is reviewed at a commit that is usually not checked out: content, highlighting and…
  const reviewRange = params.mode === MODE.PR
    ? { base: scope.base, head: scope.head }
    : null;
  const contentOptions = reviewRange
    ? { refs: fallbackRefs, range: reviewRange }
    : { refs: fallbackRefs };

  /** A review with no comments and no summary has nothing for the agent to do. */
  function hasReviewContent(review) {
    // An approval carries its own message: the agent needs to know the work is
    // accepted, even when the reviewer wrote no notes at all.
    if (review?.reviewState === REVIEW_STATE.APPROVE) return true;

    const comments = Array.isArray(review?.comments) ? review.comments : P.EMPTY_ARRAY;
    const body = String(review?.reviewBody ?? P.EMPTY).trim();
    return comments.length > P.ZERO || body.length > P.ZERO;
  }

  let dispatched = null;
  const onDispatch = async (payload) => {
    dispatched = payload;
    const review = payload.review ?? payload;

    // The page hides the option, but a request can still arrive (a stale tab, a
    // test, another client). A review with auto-send turned off must never start
    // an agent turn, so the check lives here and not only in the browser.
    if (params.dispatchEnabled === false) {
      return {
        dispatched: false,
        reason: AGENT_REASON_DISPATCH_DISABLED,
        jsonPath: payload.jsonPath,
      };
    }

    // An empty review has nothing to fix.
    if (!hasReviewContent(review)) {
      return {
        dispatched: false,
        reason: AGENT_REASON_EMPTY_REVIEW,
        jsonPath: payload.jsonPath,
      };
    }
    // A submit with "send to the AI" must start the fix turn by itself: the review page and the…
    const prompt = buildDispatchPrompt(review, meta, payload);
    const promptPath = await writeDispatchPrompt(outputDir, prompt);

    const owner = await readReviewOwner(outputDir);
    const targetSessionId = owner ?? meta.sessionId ?? currentSessionId();

    const handoff = await dispatchToSession(
      targetSessionId,
      buildDispatchMessage(promptPath, root),

      { cwd: root, promptKey: prompt },
    );

    return {
      dispatched: true,
      jsonPath: payload.jsonPath,
      promptPath,
      targetSessionId,
      agent: handoff,
    };
  };

  const html = await buildPage(meta, files, stats, allFiles, params.comments ?? [], params.reviewState ?? "COMMENT", {
    symbols,
    definitions: symbolIndex.definitions,
    usages,
    implementations,
    collapsed,
    diffMode: params.diffMode,
    dispatchEnabled: params.dispatchEnabled !== false,
  });

  const page = await servePage({
    html,
    outputDir,
    meta,
    onReview,
    onDispatch,
    symbols,
    buildFilePage: async (filePath) => {
      const file = await readFileForViewer(root, filePath, contentOptions);
      return buildFilePage(meta.repo, file, meta.id);
    },
    readFile: (filePath) => readFileForViewer(root, filePath, contentOptions),
    readFiles: (paths) => readFilesForHighlight(root, paths, reviewRange
      ? { refs: fallbackRefs, preferRef: reviewRange.head }
      : { refs: fallbackRefs }),
    findUsages: (name) => usages[name] ?? [],
    renameCommit: (sha, message, options) => renameCommitMessage(root, sha, message, options),
    listCommits: () => loadLiveCommits(root, scope),
    listBranches: () => listBranches(root),
    loadBranchCommits: (branch) => loadBranchCommits(root, branch, scope),
    searchProject: (query) => searchProject(root, query),
    loadCommit: (sha) => loadCommitDiff(root, sha),
    loadRange: (from, to) => loadRangeDiff(root, from, to),
    port: params.port ?? 0,
    host: params.host ?? SERVER.HOST,
  });

  return {
    reviewId: meta.id,
    url: page.url,
    page,
    outputDir,
    repoRoot: root,
    tree: allFiles,
    files: files.length,
    additions: stats.additions,
    deletions: stats.deletions,
    symbols: Object.keys(symbols).length,
    meta,
    getDispatch: () => dispatched,
  };
}
async function loadCommitDiff(root, sha) {
  const resolved = await resolveCommit(root, sha);
  if (!resolved) throw new Error(`Commit not found: ${sha}`);
  const { files, stats } = toDiffSet(await commitDiff(root, resolved));
  await attachGapMetadata(root, files, { ref: resolved });
  return { files, stats, sha: resolved };
}
async function loadRangeDiff(root, from, to) {
  const { files, stats } = toDiffSet(await diffBetween(root, from, to));
  await attachGapMetadata(root, files, { ref: to });
  return { files, stats, from, to };
}
/** Live commit list, re-read after a rewrite so the UI sees the new shas. */
async function loadLiveCommits(root, scope) {
  const [commits, pushedList, headSha] = await Promise.all([
    loadScopeCommits(root, scope),
    loadPushedShas(root),
    resolveCommit(root, GIT.DEFAULT_REF),
  ]);

  const pushedSet = new Set(pushedList);
  return commits.map((commit) => toCommitSummary(commit, pushedSet, headSha));
}
/** Commits of one branch against its base, for the branch selector in the Commits tab. */
async function loadBranchCommits(root, branch, scope) {
  const resolved = await resolveCommit(root, branch);
  if (!resolved) throw new Error(`Branch not found: ${branch}`);

  const base = await defaultBase(root).catch(() => null);
  const own = base
    ? await commitsSinceMergeBase(root, base, branch, GIT.MAX_COMMITS).catch(() => P.EMPTY_ARRAY)
    : P.EMPTY_ARRAY;

  // A branch that sits at its base (usually the base itself) has no commits of
  // its own. Showing an empty tab looks broken, so fall back to its recent
  // history and say plainly that this is what the list is.
  const commits = own.length
    ? own
    : await listCommits(root, { range: branch, limit: GIT.MAX_COMMITS }).catch(() => P.EMPTY_ARRAY);

  const [pushedList, headSha] = await Promise.all([
    loadPushedShas(root),
    resolveCommit(root, GIT.DEFAULT_REF),
  ]);
  const pushedSet = new Set(pushedList);

  return {
    branch,
    base: base ?? null,
    commits: commits.map((commit) => toCommitSummary(commit, pushedSet, headSha)),
    // true when the list is the branch's own line of work, false when it is a
    // fallback history of a branch with nothing of its own.
    ownCommits: own.length > P.ZERO,
    current: branch === (scope?.head ?? GIT.DEFAULT_REF),
  };
}
/** Renames the message of the newest local commit; refuses rewritten history by default. */
async function renameCommitMessage(root, sha, message, { allowPushed = false } = {}) {
  const trimmed = String(message ?? P.EMPTY).trim();
  if (!trimmed) throw new Error("Commit message cannot be empty.");

  const newSha = await renameCommit(root, sha, trimmed, { allowPushed });
  const commit = await listCommits(root, { limit: GIT.MAX_COMMITS }).then(
    (commits) => commits.find((item) => item.sha === newSha) ?? null,
  );

  return {
    sha: newSha,
    shortSha: newSha.slice(P.ZERO, GIT.SHORT_SHA_LENGTH),
    subject: commit?.subject ?? trimmed,
  };
}
