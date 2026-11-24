
import { currentBranch, listCommits, mergeBase, resolveCommit } from "../git.js";
import { GIT, P } from "../config.js";

export async function commitsSinceMergeBase(root, base, head, limit) {



  if (!base) return P.EMPTY_ARRAY;

  const fork = await mergeBase(root, base, head).catch(() => null);
  if (!fork) return P.EMPTY_ARRAY;

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

  return GIT.DEFAULT_BASE;
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
