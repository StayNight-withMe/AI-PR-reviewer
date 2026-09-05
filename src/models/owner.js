/** The OpenCode session that owns a review. */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { P, SERVER } from "../config.js";
/** The registry file name inside a review's artifact directory. */
export const OWNER_FILE = "session.json";
/** Records the session that owns a review. */
export async function writeReviewOwner(outputDir, sessionId) {
  if (!outputDir || !sessionId) return;

  try {
    const entry = { sessionId, updatedAt: new Date().toISOString() };
    await writeFile(join(outputDir, OWNER_FILE), JSON.stringify(entry, null, SERVER.JSON_INDENT), SERVER.FILE_ENCODING);
  } catch {
  }
}
