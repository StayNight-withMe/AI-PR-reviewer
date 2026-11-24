
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableUserRoot } from "./artifacts.js";
import { ARTIFACTS, GIT, P, SERVER } from "./config.js";

const SETTINGS_FILE = "ui-settings.json";

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

export function settingsPath(env = process.env) {
  const explicit = env[GIT.SETTINGS_DIR_ENV];
  if (explicit && explicit.trim()) return join(explicit.trim(), SETTINGS_FILE);


  const artifacts = env[GIT.ARTIFACTS_DIR_ENV];
  if (artifacts && artifacts.trim()) return join(artifacts.trim(), SETTINGS_FILE);
  return join(stableUserRoot(env), SETTINGS_FILE);
}


function legacySettingsPath(env = process.env) {
  return join(env[GIT.ARTIFACTS_DIR_ENV] ?? join(tmpdir(), GIT.ARTIFACTS_DIR_NAME), SETTINGS_FILE);
}


function parseSettings(raw) {
  return JSON.parse(String(raw).replace(/^\uFEFF/, P.EMPTY));
}


export async function migrateLegacySettings(env = process.env) {
  const target = settingsPath(env);
  try {
    await access(target);
    return target;
  } catch {

  }
  try {
    const raw = await readFile(legacySettingsPath(env), SERVER.FILE_ENCODING);
    const merged = sanitizeSettings(parseSettings(raw));
    if (Object.keys(merged).length) {
      await mkdir(join(target, ".."), { recursive: true }).catch(() => {});
      await writeFile(target, JSON.stringify(merged, null, SERVER.JSON_INDENT), SERVER.FILE_ENCODING);
    }
  } catch {

  }
  return target;
}

export async function readSettings(env = process.env) {
  const path = settingsPath(env);
  try {
    const raw = await readFile(path, SERVER.FILE_ENCODING);
    return sanitizeSettings(parseSettings(raw));
  } catch {

  }
  await migrateLegacySettings(env);
  try {
    const raw = await readFile(path, SERVER.FILE_ENCODING);
    return sanitizeSettings(parseSettings(raw));
  } catch {
    return {};
  }
}

export async function writeSettings(patch, env = process.env) {
  const current = await readSettings(env);


  const clean = sanitizeSettings(patch);
  const merged = { ...current, ...clean };

  const path = settingsPath(env);
  await mkdir(join(path, ".."), { recursive: true }).catch(() => {});
  await writeFile(path, JSON.stringify(merged, null, SERVER.JSON_INDENT), SERVER.FILE_ENCODING);
  return merged;
}

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
