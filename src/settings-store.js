/** Device-wide UI settings, stored on the server. */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableUserRoot } from "./artifacts.js";
import { ARTIFACTS, GIT, P, SERVER } from "./config.js";
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
  const explicit = env[GIT.SETTINGS_DIR_ENV];
  if (explicit && explicit.trim()) return join(explicit.trim(), SETTINGS_FILE);
  // An explicitly configured artifacts root owns its settings too: portable
  // installs and test sandboxes expect everything to stay together.
  const artifacts = env[GIT.ARTIFACTS_DIR_ENV];
  if (artifacts && artifacts.trim()) return join(artifacts.trim(), SETTINGS_FILE);
  return join(stableUserRoot(env), SETTINGS_FILE);
}

/** The pre-fix location inside the temp artifacts root. */
function legacySettingsPath(env = process.env) {
  return join(env[GIT.ARTIFACTS_DIR_ENV] ?? join(tmpdir(), GIT.ARTIFACTS_DIR_NAME), SETTINGS_FILE);
}

/** Parses a settings file, tolerating a UTF-8 BOM from a hand-edited copy. */
function parseSettings(raw) {
  return JSON.parse(String(raw).replace(/^\uFEFF/, P.EMPTY));
}

/**
 * Copies the pre-fix settings file to the stable location once. TEMP used to
 * be the storage root, so settings silently reset when TEMP differed between
 * launches; the first write to the stable path would otherwise discard them.
 */
export async function migrateLegacySettings(env = process.env) {
  const target = settingsPath(env);
  try {
    await access(target);
    return target;
  } catch {
    // No stable file yet: fall through to the migration.
  }
  try {
    const raw = await readFile(legacySettingsPath(env), SERVER.FILE_ENCODING);
    const merged = sanitizeSettings(parseSettings(raw));
    if (Object.keys(merged).length) {
      await mkdir(join(target, ".."), { recursive: true }).catch(() => {});
      await writeFile(target, JSON.stringify(merged, null, SERVER.JSON_INDENT), SERVER.FILE_ENCODING);
    }
  } catch {
    // Nothing to migrate: the stable file simply starts empty.
  }
  return target;
}
/** Reads the stored settings, or an empty object when none were saved. */
export async function readSettings(env = process.env) {
  const path = settingsPath(env);
  try {
    const raw = await readFile(path, SERVER.FILE_ENCODING);
    return sanitizeSettings(parseSettings(raw));
  } catch {
    // No stable file yet: the old temp copy may still hold the user's values.
  }
  await migrateLegacySettings(env);
  try {
    const raw = await readFile(path, SERVER.FILE_ENCODING);
    return sanitizeSettings(parseSettings(raw));
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
