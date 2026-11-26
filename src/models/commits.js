
import { currentBranch, listCommits, mergeBase, parentOrEmptyTree, resolveCommit } from "../git.js";
import { GIT, P } from "../config.js";

export async function commitsSinceMergeBase(root, base, head, limit) {



  if (!base) return P.EMPTY_ARRAY;

  const fork = await mergeBase(root, base, head).catch(() => null);
  if (!fork) {
    // No common ancestor (an empty-tree sentinel base): every commit on the
    // head side is part of this review.
    return listCommits(root, { range: head, limit });
  }

  const commits = await listCommits(root, {
    range: `${fork}${GIT.RANGE_SEPARATOR_TWO_DOT}${head}`,
    limit,
  });
  if (commits.length) return commits;

  return listCommits(root, { range: `${base}${GIT.RANGE_SEPARATOR_TWO_DOT}${head}`, limit });
}

export async function defaultBase(root) {
  for (const candidate of GIT.BASE_CANDIDATES) {
    if (await resolveCommit(root, candidate)) return candidate;
  }




  const current = await currentBranch(root).catch(() => null);
  for (const candidate of GIT.LOCAL_BASE_CANDIDATES) {
    if (candidate === current) continue;
    if (await resolveCommit(root, candidate)) return candidate;
  }

  // No remote and no other branch: a local single-branch checkout still has a
  // history to review. Comparing against the first commit's parent (the empty
  // tree) shows the whole branch instead of an empty page.
  const first = await firstCommit(root).catch(() => null);
  if (first) return await parentOrEmptyTree(root, first).catch(() => null);

  return null;
}

async function firstCommit(root) {
  const commits = await listCommits(root, { limit: GIT.MAX_HISTORY }).catch(() => []);
  return commits.length ? commits[commits.length - P.ONE].sha : null;
}

export async function loadScopeCommits(root, scope) {
  if (scope.commits.length) return scope.commits;

  const head = scope.head ?? GIT.DEFAULT_REF;


  if (!scope.base) {
    const base = await defaultBase(root).catch(() => null);
    if (base) {
      const own = await commitsSinceMergeBase(root, base, head, GIT.MAX_COMMITS).catch(() => P.EMPTY_ARRAY);

      return own;
    }
    return P.EMPTY_ARRAY;
  }

  return commitsSinceMergeBase(root, scope.base, head, GIT.MAX_COMMITS).catch(() => P.EMPTY_ARRAY);
}
