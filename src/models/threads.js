/** Review threads: comments outlive one review page and follow the code they were written on. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactsRoot, repoSlug } from "../artifacts.js";
import { DIFF, P, RENDER, SERVER, THREADS } from "../config.js";
/** The stable identity of a review target: a pull request, or a branch of the checkout. */
export function threadsKey(meta) {
  const number = meta?.pr?.number;
  if (number) return `pr-${number}`;
  const branch = String(meta?.branch ?? P.EMPTY).trim();
  return branch ? `branch-${branch}` : "worktree";
}
/** The file that holds one target's comments. */
export function threadsPath(root, meta, env = process.env) {
  const key = threadsKey(meta);
  const safe = key.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(P.ZERO, SERVER.MAX_SLUG_LENGTH);
  const hash = createHash(RENDER.HASH_ALGORITHM).update(key).digest(RENDER.HASH_ENCODING).slice(P.ZERO, SERVER.SHORT_HASH_LENGTH);
  return join(artifactsRoot(env), repoSlug(root), THREADS.DIR_NAME, `${safe}${P.DASH}${hash}${THREADS.FILE_SUFFIX}`);
}
/** Reads the comments written for this target, or none when nothing was saved yet. */
export async function readThreads(root, meta, env = process.env) {
  try {
    const raw = await readFile(threadsPath(root, meta, env), SERVER.FILE_ENCODING);
    const parsed = JSON.parse(raw);
    const comments = Array.isArray(parsed?.comments) ? parsed.comments : P.EMPTY_ARRAY;
    // A corrupt or hostile file must not flood the page.
    return { comments: comments.slice(P.ZERO, THREADS.MAX_COMMENTS), updatedAt: parsed?.updatedAt ?? null };
  } catch {
    return { comments: P.EMPTY_ARRAY, updatedAt: null };
  }
}
/** Writes the target's comments, replacing whatever was stored. */
export async function writeThreads(root, meta, comments, env = process.env) {
  const list = (Array.isArray(comments) ? comments : P.EMPTY_ARRAY).slice(P.ZERO, THREADS.MAX_COMMENTS);
  const path = threadsPath(root, meta, env);
  await mkdir(join(path, ".."), { recursive: true }).catch(() => undefined);
  await writeFile(path, JSON.stringify({
    repo: meta?.repo ?? P.EMPTY,
    branch: meta?.branch ?? P.EMPTY,
    pr: meta?.pr?.number ?? null,
    updatedAt: new Date().toISOString(),
    comments: list,
  }, null, SERVER.JSON_INDENT), SERVER.FILE_ENCODING);
  return list.length;
}
/** The text of the lines a comment points at, so a later review can tell they changed. */
export function snippetOf(comment, lines) {
  if (!comment?.lineStart || !Array.isArray(lines)) return P.EMPTY;
  const from = Math.max(P.ZERO, comment.lineStart - P.ONE);
  const to = Math.min(lines.length, comment.lineEnd || comment.lineStart);
  if (to <= from) return P.EMPTY;
  return lines.slice(from, to).join(P.NEWLINE).slice(P.ZERO, THREADS.MAX_SNIPPET_CHARS);
}
/**
 * A comment on the removed side points at a line of the old file. Its number
 * means nothing in the current file, so comparing it there would flag the
 * comment as outdated as soon as a line above it was also removed — with a
 * snippet taken from an unrelated line.
 */
export function isOldSide(comment) {
  return comment?.side === DIFF.SIDE.LEFT;
}
/** Records the current lines on every comment that has no anchor yet. */
export async function withSnippets(comments, readLines) {
  const cache = new Map();
  const result = [];

  for (const comment of Array.isArray(comments) ? comments : P.EMPTY_ARRAY) {
    // Removed code is not in the current file at all: there is nothing to anchor.
    if (comment.snippet || !comment.lineStart || isOldSide(comment)) {
      result.push(withoutOutdated(comment));
      continue;
    }
    const lines = await linesOf(readLines, comment.path, cache);
    const snippet = snippetOf(comment, lines);
    result.push(snippet ? { ...comment, snippet } : withoutOutdated(comment));
  }
  return result;
}
/**
 * Marks the comments whose lines no longer read the way they did when written.
 * The check is per comment: a file that still exists can carry both fresh and
 * outdated comments, and an untouched line stays valid after unrelated edits.
 */
export async function markOutdated(comments, readLines) {
  const cache = new Map();
  const result = [];

  for (const comment of Array.isArray(comments) ? comments : P.EMPTY_ARRAY) {
    // A file comment is not about lines, so nothing can make it outdated. The
    // same holds for the removed side: those lines are gone by design.
    if (!comment.lineStart || isOldSide(comment)) { result.push(withoutOutdated(comment)); continue; }

    const lines = await linesOf(readLines, comment.path, cache);
    const reason = outdatedReason(comment, lines);
    result.push(reason ? { ...comment, outdated: true, outdatedReason: reason } : withoutOutdated(comment));
  }
  return result;
}
/** Why a comment no longer matches the code, or null when it still does. */
function outdatedReason(comment, lines) {
  if (!lines) return THREADS.REASON_FILE_GONE;
  // A comment from before anchors were recorded has nothing to compare against;
  // guessing would mark every old comment outdated on a working checkout.
  if (!comment.snippet) return null;
  return snippetOf(comment, lines) === comment.snippet ? null : THREADS.REASON_LINES_CHANGED;
}
function withoutOutdated(comment) {
  if (!comment.outdated && !comment.outdatedReason) return comment;
  const { outdated, outdatedReason, ...rest } = comment;
  return rest;
}
/** One read per file, however many comments it carries. */
async function linesOf(readLines, path, cache) {
  if (!path) return null;
  if (cache.has(path)) return cache.get(path);

  let lines = null;
  try {
    const file = await readLines(path);
    lines = Array.isArray(file?.lines) ? file.lines : null;
  } catch {
    lines = null;
  }
  cache.set(path, lines);
  return lines;
}
