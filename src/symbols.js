import { git } from "./git.js";
import { readFilesForHighlight } from "./fileview.js";
import { GIT, P, SYMBOL_INDEX, SYMBOL_KIND } from "./config.js";
/** Go-to-definition / find-usages index for C# (plus a few other languages). */
const SKIP_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svg",
  "pdf", "zip", "gz", "tar", "7z", "rar", "dll", "exe", "so", "pdb",
  "woff", "woff2", "ttf", "otf", "mp3", "mp4", "mov", "wav", "nupkg", "lock",
]);
/** Language keywords and ubiquitous BCL names: never turned into links. */
