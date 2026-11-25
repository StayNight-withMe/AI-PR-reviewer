import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { commitDiff, currentBranch, diffBetween, listBranches, listCommits, pushedShas, remoteUrl, renameCommit, resolveCommit, resolveRepo, searchProject } from "./git.js";
import { commitsSinceMergeBase, defaultBase, loadScopeCommits } from "./models/commits.js";
import { diffStats } from "./diff.js";
import { buildFilePage, buildMarkdown, buildPage, loadAssets, reviewId } from "./render.js";
import { servePage, writeReviewFiles } from "./server.js";
import { buildSymbolIndex } from "./symbols.js";
import { readFileForViewer, readFilesForHighlight } from "./fileview.js";
import { MODE_LABELS, DIFF, GH, GIT, MODE, P, REVIEW_STATE, SERVER } from "./config.js";
import { removeLegacyArtifacts, reviewDir } from "./artifacts.js";
import { repoLabel } from "./models/repo.js";
import { resolveScope } from "./models/scope.js";
import { buildProjectTree } from "./models/tree.js";
import { toDiffSet, toFileModel } from "./models/diffset.js";
import { attachGapMetadata } from "./models/gaps.js";
import { readReviewOwner, writeReviewOwner } from "./models/owner.js";
import { markOutdated, readThreads, withSnippets, writeThreads } from "./models/threads.js";
import { buildDispatchMessage, buildDispatchPrompt, currentSessionId, dispatchToSession, resolveSessionId, writeDispatchPrompt } from "./dispatch.js";
import { publishReview, pullRequestViewedFiles, setPullRequestFileViewed } from "./github.js";
export { MODE_LABELS, repoLabel };

const AGENT_REASON_EMPTY_REVIEW = "The review has no comments or summary, so there is nothing to fix.";

const AGENT_REASON_DISPATCH_DISABLED = "Auto-send is turned off for this review, so no agent turn was started.";
export async function buildReview(params) {
  const root = await resolveRepo(resolve(params.repoPath ?? process.cwd()));
  const scope = await resolveScope(root, params);
  const pr = scope.pr ?? null;

  const branch = params.branch ?? (pr?.headRefName || (await currentBranch(root)));
  const repo = repoLabel(root, await remoteUrl(root));

  const files = toFileModel(scope.diffText);
  await attachGapMetadata(root, files, gapOptions(params.mode, scope));
  const stats = diffStats(files);
  const allFiles = await buildProjectTree(root, { mode: params.mode, base: scope.base, head: scope.head });

  const commits = await loadScopeCommits(root, scope);
  const [pushedList, headSha] = await Promise.all([loadPushedShas(root), resolveCommit(root, GIT.DEFAULT_REF)]);
  const pushedSet = new Set(pushedList);

  const meta = {

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


    sessionId: params.sessionId ?? currentSessionId(),
    commits: commits.map((commit) => toCommitSummary(commit, pushedSet, headSha)),
    title: params.title ?? scope.label ?? MODE_LABELS[params.mode] ?? params.mode,
    allFiles,

    pr,
  };

  return { root, meta, files, stats, allFiles, scope };
}

function gapOptions(mode, scope) {
  if (mode === MODE.UNCOMMITTED) {
    return {
      useWorkingTree: true,
      refs: [GIT.DEFAULT_REF, scope.base].filter(Boolean),
    };
  }
  return { ref: scope.head };
}

function diffFingerprint(files) {
  return files
    .map((file) => `${file.path}:${file.additions}+${file.deletions}-${file.hunks.length}h`)
    .join(P.PIPE);
}

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


  const outputDir = params.outputDir || reviewDir(root, meta.id, params.env);
  await mkdir(outputDir, { recursive: true });

  await removeLegacyArtifacts(root);

  await writeReviewOwner(outputDir, meta.sessionId);

  await loadAssets();

  const symbolIndex = params.symbols === false
    ? { symbols: {}, definitions: {}, usages: {}, implementations: {} }
    : await buildSymbolIndex(root);
  const symbols = symbolIndex.symbols;
  const usages = symbolIndex.usages;
  const implementations = symbolIndex.implementations;

  const collapsed = files.filter((f) => f.status === DIFF.STATUS.DELETED).map((f) => f.path);


  const fallbackRefs = [GIT.DEFAULT_REF, meta.base].filter(Boolean);






  const pinnedHead = params.mode === MODE.UNCOMMITTED ? null : scope.head ?? null;
  const reviewRange = pinnedHead ? { base: scope.base, head: pinnedHead } : null;
  const contentOptions = reviewRange
    ? { refs: fallbackRefs, range: reviewRange }
    : { refs: fallbackRefs };




  const reviewedLines = (filePath) => readFileForViewer(root, filePath, contentOptions);

  const currentLines = (filePath) => readFileForViewer(root, filePath, { refs: fallbackRefs });
  const stored = params.comments
    ? { comments: params.comments }
    : await readThreads(root, meta);
  const comments = stored.comments.length
    ? await markOutdated(await withSnippets(stored.comments, reviewedLines), currentLines)
    : P.EMPTY_ARRAY;

  const onReview = async (review, reviewMeta) => {


    const withAnchors = await withSnippets(review.comments ?? P.EMPTY_ARRAY, reviewedLines);
    const saved = { ...review, comments: withAnchors };
    await writeThreads(root, reviewMeta ?? meta, withAnchors);
    return writeReviewFiles(outputDir, reviewMeta, saved, buildMarkdown(reviewMeta, saved));
  };


  function hasReviewContent(review) {


    if (review?.reviewState === REVIEW_STATE.APPROVE) return true;

    const comments = Array.isArray(review?.comments) ? review.comments : P.EMPTY_ARRAY;
    const body = String(review?.reviewBody ?? P.EMPTY).trim();
    return comments.length > P.ZERO || body.length > P.ZERO;
  }

  let dispatched = null;
  const onDispatch = async (payload) => {
    dispatched = payload;
    const review = payload.review ?? payload;




    if (params.dispatchEnabled === false) {
      return {
        dispatched: false,
        reason: AGENT_REASON_DISPATCH_DISABLED,
        jsonPath: payload.jsonPath,
      };
    }


    if (!hasReviewContent(review)) {
      return {
        dispatched: false,
        reason: AGENT_REASON_EMPTY_REVIEW,
        jsonPath: payload.jsonPath,
      };
    }

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

  const html = await buildPage(meta, files, stats, allFiles, comments, params.reviewState ?? "COMMENT", {
    symbols,
    definitions: symbolIndex.definitions,
    usages,
    implementations,
    collapsed,
    diffMode: params.diffMode,
    dispatchEnabled: params.dispatchEnabled !== false,
  });


  const onPublish = meta.pr
    ? (review) => publishReview(root, { review, pr: meta.pr, repo: meta.pr.repo })
    : null;

  // GitHub owns "viewed": the same person sees the same checked files on the
  // page as on github.com, and the state survives new commits and a new port.
  // The node id is cached for the life of the page, since it never changes.
  let viewedPullRequestId = null;
  const getViewed = !meta.pr
    ? null
    : async () => {
      const snapshot = await pullRequestViewedFiles(root, meta.pr.repo, meta.pr.number);
      viewedPullRequestId = snapshot.id ?? viewedPullRequestId;
      return { available: Boolean(snapshot.id), ...snapshot };
    };
  const setViewed = !meta.pr
    ? null
    : async ({ path, viewed }) => {
      // Only a file that is part of this pull request can be marked viewed;
      // GitHub would reject anything else, so refuse it before the call.
      const known = new Set(files.map((file) => file.path));
      if (!known.has(path)) throw new Error(`Not a file of this pull request: ${path}`);

      if (!viewedPullRequestId) {
        const snapshot = await pullRequestViewedFiles(root, meta.pr.repo, meta.pr.number);
        viewedPullRequestId = snapshot.id;
      }
      if (!viewedPullRequestId) {
        throw new Error(`${GH.ERROR_VIEWED_FAILED}cannot resolve the pull request id.`);
      }
      return setPullRequestFileViewed(root, {
        pullRequestId: viewedPullRequestId,
        path,
        viewed,
      });
    };

  const page = await servePage({
    html,
    outputDir,
    meta,
    onReview,
    onDispatch,
    onPublish,
    symbols,
    buildFilePage: async (filePath) => {
      const file = await readFileForViewer(root, filePath, contentOptions);
      return buildFilePage(meta.repo, file, meta.id);
    },
    readFile: (filePath) => readFileForViewer(root, filePath, contentOptions),
    readFiles: (paths) => readFilesForHighlight(root, paths, reviewRange
      ? { refs: fallbackRefs, preferRef: reviewRange.head }
      : { refs: fallbackRefs }),







    saveThreads: async (list) => {
      const anchored = await withSnippets(list, reviewedLines);
      return writeThreads(root, meta, anchored);
    },
    getViewed,
    setViewed,
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

async function loadLiveCommits(root, scope) {
  const [commits, pushedList, headSha] = await Promise.all([
    loadScopeCommits(root, scope),
    loadPushedShas(root),
    resolveCommit(root, GIT.DEFAULT_REF),
  ]);

  const pushedSet = new Set(pushedList);
  return commits.map((commit) => toCommitSummary(commit, pushedSet, headSha));
}

async function loadBranchCommits(root, branch, scope) {
  const resolved = await resolveCommit(root, branch);
  if (!resolved) throw new Error(`Branch not found: ${branch}`);

  const base = await defaultBase(root).catch(() => null);
  const own = base
    ? await commitsSinceMergeBase(root, base, branch, GIT.MAX_COMMITS).catch(() => P.EMPTY_ARRAY)
    : P.EMPTY_ARRAY;




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


    ownCommits: own.length > P.ZERO,
    current: branch === (scope?.head ?? GIT.DEFAULT_REF),
  };
}

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
