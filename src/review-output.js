/** Writes the two files a submitted review leaves behind. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACTS, SERVER } from "./config.js";

/**
 * Writes `review.json` and `review.md` in one step.
 *
 * Kept apart from the HTTP server because the comment state also has to be
 * written back from the MCP side, and importing the server there would create a
 * cycle through the review page.
 */
export async function writeReviewFiles(outputDir, meta, review, markdown) {
  await mkdir(outputDir, { recursive: true });

  const jsonPath = join(outputDir, ARTIFACTS.REVIEW_JSON);
  const markdownPath = join(outputDir, ARTIFACTS.REVIEW_MARKDOWN);

  await Promise.all([
    writeFile(jsonPath, JSON.stringify({ meta, review }, null, SERVER.JSON_INDENT), SERVER.FILE_ENCODING),
    writeFile(markdownPath, markdown, SERVER.FILE_ENCODING),
  ]);

  return { jsonPath, markdownPath, markdown };
}
