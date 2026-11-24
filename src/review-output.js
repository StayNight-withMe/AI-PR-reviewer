
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACTS, SERVER } from "./config.js";


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
