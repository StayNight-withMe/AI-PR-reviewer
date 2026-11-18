/**
 * Rebuilds `src/assets/hljs-bundle.js` from the installed highlight.js.
 *
 * The page ships one hand-assembled bundle instead of a loader: the review opens
 * from `file://`-free localhost, but must still work with no network and no
 * bundler. Every language listed here is registered up front, so a diff of a Go,
 * Java or Rust file is coloured too — a language missing from the bundle was
 * rendering as plain white text.
 *
 * Run: node scripts/build-hljs-bundle.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSETS, FILES } from "../src/config.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const HLJS_LIB = dirname(require.resolve("highlight.js/lib/core"));
const LANGUAGES_DIR = join(HLJS_LIB, "languages");
const OUTPUT = join(ROOT, "..", "src", FILES.ASSETS_DIR, ASSETS.BUNDLE);

/** Languages registered into the bundle, in the order they are defined. */
const LANGUAGES = [
  "csharp",
  "javascript",
  "typescript",
  "json",
  "xml",
  "yaml",
  "bash",
  "sql",
  "python",
  "css",
  "markdown",
  "powershell",
  "ini",
  "dos",
  "go",
  "java",
  "kotlin",
  "ruby",
  "rust",
  "php",
  "dockerfile",
  "less",
  "scss",
  "properties",
];

async function readModule(file) {
  return readFile(join(LANGUAGES_DIR, `${file}.js`), FILES.ENCODING);
}

const core = await readFile(join(HLJS_LIB, "core.js"), FILES.ENCODING);
const plaintext = await readModule("plaintext");
const modules = [];
for (const language of LANGUAGES) {
  modules.push(`__define("${language}", function(module, exports){\n${await readModule(language)}\n});`);
}

const registrations = LANGUAGES
  .map((language) => `try { hljs.registerLanguage("${language}", __require("${language}")); } catch (e) {}`)
  .join("\n");

const bundle = `(function(){
var __modules = {};
var module = { exports: {} };
var exports = module.exports;
function __define(name, factory){ __modules[name] = factory; }
function __require(name){ var m = { exports: {} }; __modules[name](m, m.exports); return m.exports; }
__define("core", function(module, exports){
${core}
});
__define("plaintext", function(module, exports){
${plaintext}
});
${modules.join("\n")}
var hljs = __require("core");
${registrations}
window.hljs = hljs;
})();
`;

await writeFile(OUTPUT, bundle, FILES.ENCODING);
console.log(`wrote ${OUTPUT} (${LANGUAGES.length} languages, ${bundle.length} bytes)`);
