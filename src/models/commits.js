/** Commit lists for a review scope. */
import { currentBranch, listCommits, mergeBase, resolveCommit } from "../git.js";
import { GIT, P } from "../config.js";
/** Commits between the merge base of `base`/`head` and `head`. */
export async function commitsSinceMergeBase(root, base, head, limit) {
  // No common ancestor means the base says nothing about what this branch
  // changed. Listing the whole history here is what filled the Commits tab with
  // 200 unrelated commits; an empty list is the honest answer.
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
/** Base branch for a scope that does not name one. */
export async function defaultBase(root) {
  for (const candidate of GIT.BASE_CANDIDATES) {
    if (await resolveCommit(root, candidate)) return candidate;
  }

  // No remote: a repository that was only ever local still has a trunk to
  // compare against. Skipping the checked-out branch matters — comparing a
  // branch with itself would report an empty review instead of its changes.
  const current = await currentBranch(root).catch(() => null);
  for (const candidate of GIT.LOCAL_BASE_CANDIDATES) {
    if (candidate === current) continue;
    if (await resolveCommit(root, candidate)) return candidate;
  }

  return GIT.DEFAULT_BASE;
}
/** Commits that belong to the reviewed scope. */
export async function loadScopeCommits(root, scope) {
  if (scope.commits.length) return scope.commits;

  const head = scope.head ?? GIT.DEFAULT_REF;
  // as a branch review sees them. Listing "everything not on a remote" dumped
  // 200 unrelated commits into the tab; the branch base is the correct anchor.
  if (!scope.base) {
    const base = await defaultBase(root).catch(() => null);
    if (base) {
      const own = await commitsSinceMergeBase(root, base, head, GIT.MAX_COMMITS).catch(() => P.EMPTY_ARRAY);
      // No commits of its own is a valid answer (the branch is at the base).
      return own;
    }
    return P.EMPTY_ARRAY;
  }

  return commitsSinceMergeBase(root, scope.base, head, GIT.MAX_COMMITS).catch(() => P.EMPTY_ARRAY);
}
