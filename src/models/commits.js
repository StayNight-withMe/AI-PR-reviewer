/** Commit lists for a review scope. */
import { listCommits, mergeBase, resolveCommit } from "../git.js";
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
