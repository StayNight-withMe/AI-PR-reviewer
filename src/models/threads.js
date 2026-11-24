
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactsRoot, repoSlug } from "../artifacts.js";
import { DIFF, P, RENDER, SERVER, THREADS } from "../config.js";

export function threadsKey(meta) {
  const number = meta?.pr?.number;
  if (number) return `pr-${number}`;
  const branch = String(meta?.branch ?? P.EMPTY).trim();
  return branch ? `branch-${branch}` : "worktree";
}

export function threadsPath(root, meta, env = process.env) {
  const key = threadsKey(meta);
  const safe = key.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(P.ZERO, SERVER.MAX_SLUG_LENGTH);
  const hash = createHash(RENDER.HASH_ALGORITHM).update(key).digest(RENDER.HASH_ENCODING).slice(P.ZERO, SERVER.SHORT_HASH_LENGTH);
  return join(artifactsRoot(env), repoSlug(root), THREADS.DIR_NAME, `${safe}${P.DASH}${hash}${THREADS.FILE_SUFFIX}`);
}

export async function readThreads(root, meta, env = process.env) {
  try {
    const raw = await readFile(threadsPath(root, meta, env), SERVER.FILE_ENCODING);
    const parsed = JSON.parse(raw);
    const comments = Array.isArray(parsed?.comments) ? parsed.comments : P.EMPTY_ARRAY;

    return { comments: comments.slice(P.ZERO, THREADS.MAX_COMMENTS), updatedAt: parsed?.updatedAt ?? null };
  } catch {
    return { comments: P.EMPTY_ARRAY, updatedAt: null };
  }
}

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

export function snippetOf(comment, lines) {
  if (!comment?.lineStart || !Array.isArray(lines)) return P.EMPTY;
  const from = Math.max(P.ZERO, comment.lineStart - P.ONE);
  const to = Math.min(lines.length, comment.lineEnd || comment.lineStart);
  if (to <= from) return P.EMPTY;
  return lines.slice(from, to).join(P.NEWLINE).slice(P.ZERO, THREADS.MAX_SNIPPET_CHARS);
}

export function isOldSide(comment) {
  return comment?.side === DIFF.SIDE.LEFT;
}

export async function withSnippets(comments, readLines) {
  const cache = new Map();
  const result = [];

  for (const comment of Array.isArray(comments) ? comments : P.EMPTY_ARRAY) {

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

export async function markOutdated(comments, readLines) {
  const cache = new Map();
  const result = [];

  for (const comment of Array.isArray(comments) ? comments : P.EMPTY_ARRAY) {


    if (!comment.lineStart || isOldSide(comment)) { result.push(withoutOutdated(comment)); continue; }

    const lines = await linesOf(readLines, comment.path, cache);
    const reason = outdatedReason(comment, lines);
    result.push(reason ? { ...comment, outdated: true, outdatedReason: reason } : withoutOutdated(comment));
  }
  return result;
}

function outdatedReason(comment, lines) {
  if (!lines) return THREADS.REASON_FILE_GONE;


  if (!comment.snippet) return null;
  return snippetOf(comment, lines) === comment.snippet ? null : THREADS.REASON_LINES_CHANGED;
}
function withoutOutdated(comment) {
  if (!comment.outdated && !comment.outdatedReason) return comment;
  const { outdated, outdatedReason, ...rest } = comment;
  return rest;
}

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
