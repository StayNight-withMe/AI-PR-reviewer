
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { P, SERVER } from "../config.js";
import { readThreads, writeThreads } from "./threads.js";
import { writeReviewFiles } from "../review-output.js";
import { buildMarkdown } from "../render.js";


async function readReviewPayload(outputDir) {
  try {
    return JSON.parse(await readFile(join(outputDir, "review.json"), SERVER.FILE_ENCODING));
  } catch {
    return null;
  }
}


function threadsMeta(entry) {
  if (entry.meta) return entry.meta;

  const number = entry.pr ?? null;
  const branch = String(entry.branch ?? P.EMPTY);
  return {
    repo: entry.repo ?? P.EMPTY,
    branch,
    pr: number ? { number } : null,
  };
}


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
