
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { P, SERVER } from "../config.js";

export const OWNER_FILE = "session.json";

export async function writeReviewOwner(outputDir, sessionId) {
  if (!outputDir || !sessionId) return;

  try {
    const entry = { sessionId, updatedAt: new Date().toISOString() };
    await writeFile(join(outputDir, OWNER_FILE), JSON.stringify(entry, null, SERVER.JSON_INDENT), SERVER.FILE_ENCODING);
  } catch {
  }
}

export async function readReviewOwner(outputDir) {
  if (!outputDir) return null;

  try {
    const raw = await readFile(join(outputDir, OWNER_FILE), SERVER.FILE_ENCODING);
    const entry = JSON.parse(raw);
    return typeof entry?.sessionId === "string" && entry.sessionId ? entry.sessionId : null;
  } catch {
    return null;
  }
}

export function normalizeSessionId(value) {
  return typeof value === "string" ? value.trim() || P.EMPTY : P.EMPTY;
}
