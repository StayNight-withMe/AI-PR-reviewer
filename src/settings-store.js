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
