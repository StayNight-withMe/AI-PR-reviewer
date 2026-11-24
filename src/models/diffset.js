import { diffStats, isBinaryPath, languageFor, parseDiff } from "../diff.js";
import { P } from "../config.js";
import { sortLikeTree } from "./order.js";

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

    gaps: [],
    totalLines: P.ZERO,
  }));

  return sortLikeTree(files);
}

export function toDiffSet(diffText) {
  const files = toFileModel(diffText);
  return { files, stats: diffStats(files) };
}
export { diffStats };
