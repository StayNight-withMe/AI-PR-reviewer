import { diffStats, isBinaryPath, languageFor, parseDiff } from "../diff.js";
import { P } from "../config.js";
import { sortLikeTree } from "./order.js";
/** Turns a raw git diff into the file model the UI consumes. */
export function toFileModel(diffText) {
  const files = parseDiff(diffText).map((file) => ({
    path: file.path,
    oldPath: file.oldPath,
    newPath: file.newPath,
    status: file.status,
    binary: file.binary || isBinaryPath(file.path),
    additions: file.additions,
    deletions: file.deletions,
    changeCount: file.additions + file.deletions,
    language: languageFor(file.path),
    hunks: file.hunks,
    // Filled in by attachGapMetadata(): the hidden regions of unchanged lines.
    gaps: [],
    totalLines: P.ZERO,
  }));

  return sortLikeTree(files);
}
/** File + stats bundle used by the commit / range endpoints. */
export function toDiffSet(diffText) {
  const files = toFileModel(diffText);
  return { files, stats: diffStats(files) };
}
export { diffStats };
