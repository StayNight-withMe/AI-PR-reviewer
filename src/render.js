import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSETS, DIFF, DIFF_MODE, FILES, MODE, MODE_LABELS, P, RENDER, REVIEW_STATE, SYMBOL_LINKS, TREE_OPEN, UI, VIEW_FILE_MODE } from "./config.js";
const here = dirname(fileURLToPath(import.meta.url));
const BOM = 0xfeff;
const JS_SEPARATOR = "\n;\n";
let cache = null;
const stripBom = (value) => (value.charCodeAt(P.ZERO) === BOM ? value.slice(P.ONE) : value);
export async function loadAssets() {
  if (cache) return cache;

  const read = async (file) => {
    try {
      return stripBom(await readFile(join(here, FILES.ASSETS_DIR, file), FILES.ENCODING));
    } catch {
      return P.EMPTY;
    }
  };

  const [styles, appParts, viewerParts, hljsScript] = await Promise.all([
    read(ASSETS.STYLES),
    Promise.all(ASSETS.JS.map((file) => read(file))),
    Promise.all(ASSETS.VIEWER_JS.map((file) => read(file))),
    read(ASSETS.BUNDLE),
  ]);

  cache = {
    styles,
    app: appParts.filter(Boolean).join(JS_SEPARATOR),
    viewer: viewerParts.filter(Boolean).join(JS_SEPARATOR),
    hljsScript,
  };
  return cache;
}
