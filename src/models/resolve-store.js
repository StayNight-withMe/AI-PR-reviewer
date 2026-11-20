/**
 * One place that changes the state of stored comments.
 *
 * Comments live in two files that must never disagree: `review.json` is what the
 * agent and the markdown read, and the thread store is what the page reads. A
 * comment resolved through the MCP tool used to change only the first one, so
 * the reviewer saw the agent report success and the page keep the comment open.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { P, SERVER } from "../config.js";
import { readThreads, writeThreads } from "./threads.js";
import { writeReviewFiles } from "../review-output.js";
import { buildMarkdown } from "../render.js";

/** The saved review payload of a page, or null when nothing was submitted yet. */
async function readReviewPayload(outputDir) {
  try {
    return JSON.parse(await readFile(join(outputDir, "review.json"), SERVER.FILE_ENCODING));
  } catch {
    return null;
  }
}

/** The identity the thread store is keyed by, from a live page or its registry entry. */
function threadsMeta(entry) {
  if (entry.meta) return entry.meta;
  // A page found through the registry only carries flat fields.
  const number = entry.pr ?? null;
  const branch = String(entry.branch ?? P.EMPTY);
  return {
    repo: entry.repo ?? P.EMPTY,
    branch,
    pr: number ? { number } : null,
  };
}

/**
 * Resolves or reopens comments of a review by id.
 *
 * A review that was never submitted has no review.json: its comments exist only
 * in the thread store, and those are changed there. When the review was
 * submitted, both records are updated so the page and the files agree.
 *
 * Returns the ids that changed.
 */
export async function setCommentsResolved(entry, ids, resolved) {
  const wanted = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
  const touched = [];

  const payload = await readReviewPayload(entry.outputDir);
  if (payload?.review) {
    const comments = Array.isArray(payload.review.comments) ? payload.review.comments : [];
    for (const comment of comments) {
      if (wanted && !wanted.has(String(comment.id))) continue;
      comment.resolved = resolved === true;
      touched.push(String(comment.id));
    }
    if (touched.length) {
      const markdown = buildMarkdown(payload.meta, payload.review);
      await writeReviewFiles(entry.outputDir, payload.meta, payload.review, markdown);
    }
  }

  // The thread store is the page's source of truth, so it is always visited:
  // a comment written after the submit still has to change state.
  if (entry.repoRoot || entry.repo) {
    const root = entry.repoRoot ?? entry.repo;
    const meta = threadsMeta(entry);
    const stored = await readThreads(root, meta);
    let changed = false;
    const comments = stored.comments.map((comment) => {
      if (wanted && !wanted.has(String(comment.id))) return comment;
      changed = true;
      if (!touched.includes(String(comment.id))) touched.push(String(comment.id));
      return { ...comment, resolved: resolved === true };
    });
    if (changed) await writeThreads(root, meta, comments);
  }

  return touched;
}
