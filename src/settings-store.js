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
