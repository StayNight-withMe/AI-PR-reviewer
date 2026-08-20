/** Device-wide UI settings, stored on the server. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactsRoot } from "./artifacts.js";
import { ARTIFACTS, P, SERVER } from "./config.js";
/** The settings file name inside the artifacts root. */
const SETTINGS_FILE = "ui-settings.json";
/** The known setting keys, so an unknown or hostile key is never stored. */
export const SETTING_KEYS = [
  "treeOpen",
  "hideViewed",
  "collapseViewed",
  "symbolLinks",
  "showSidebar",
  "treeWidth",
  "treeHidden",
  "treeIndent",
  "autoScrollTree",
  "largeFileLines",
  "openLinksInline",
  "contextCollapseLines",
  "viewFileMode",
  "theme",
  "diffMode",
];
const NUMERIC_KEYS = new Set(["treeWidth", "treeIndent", "largeFileLines", "contextCollapseLines"]);
const BOOLEAN_KEYS = new Set(["hideViewed", "collapseViewed", "showSidebar", "treeHidden", "autoScrollTree", "openLinksInline"]);
/** The settings file path. */
export function settingsPath(env = process.env) {
  return join(artifactsRoot(env), SETTINGS_FILE);
}
/** Reads the stored settings, or an empty object when none were saved. */
export async function readSettings(env = process.env) {
  try {
    const raw = await readFile(settingsPath(env), SERVER.FILE_ENCODING);
    const parsed = JSON.parse(raw);
    return sanitizeSettings(parsed);
  } catch {
    return {};
  }
}
/** Writes the settings, keeping only the known keys with a correct type. */
export async function writeSettings(patch, env = process.env) {
  const current = await readSettings(env);
  // Sanitize the patch BEFORE merging: a rejected value must not overwrite the
  // good stored one (a typo in a number field would otherwise erase it).
  const clean = sanitizeSettings(patch);
  const merged = { ...current, ...clean };

  const path = settingsPath(env);
  await mkdir(join(path, ".."), { recursive: true }).catch(() => {});
  await writeFile(path, JSON.stringify(merged, null, SERVER.JSON_INDENT), SERVER.FILE_ENCODING);
  return merged;
}
/** Drops unknown keys and coerces known ones to their type. */
export function sanitizeSettings(raw) {
  const result = {};
  if (!raw || typeof raw !== "object") return result;

  for (const key of SETTING_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;

    if (NUMERIC_KEYS.has(key)) {
      const number = Number(value);
      if (Number.isFinite(number)) result[key] = number;
    } else if (BOOLEAN_KEYS.has(key)) {
      if (typeof value === "boolean") result[key] = value;
    } else if (typeof value === P.TYPE_STRING && value.length <= P.MAX_SETTING_LENGTH) {
      result[key] = value;
    }
  }

  return result;
}
void ARTIFACTS;
