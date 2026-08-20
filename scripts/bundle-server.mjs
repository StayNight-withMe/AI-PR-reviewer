/**
 * Copies the review engine into an editor integration's bundle folder.
 *
 * Every integration runs `src/cli.js` as a child process and reads one ready
 * line from it. The engine needs its whole `src/` tree (including `assets/`,
 * which the page inlines at startup) and its `package.json`, but NOT
 * `node_modules`: only the MCP layer (`src/index.js`) imports the MCP SDK and
 * zod, and the syntax highlighter is vendored in `assets/hljs-bundle.js`.
 * Shipping without node_modules keeps each VSIX/plugin small.
 *
 * Usage:
 *   node scripts/bundle-server.mjs                 # every host in the table
 *   node scripts/bundle-server.mjs vscode visualstudio
 *   node scripts/bundle-server.mjs --list
 *
 * The destination of each host is the path its host code looks in
 * (`<extension>/server/src/cli.js`), so nothing else has to be configured.
 */
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP } from "../src/config.js";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** host key -> bundle directory, relative to the repository root. */
const BUNDLES = {
  vscode: "editors/vscode/server",
  visualstudio: "editors/visualstudio/server",
  jetbrains: "editors/jetbrains/server",
};
/** What the engine needs at run time. `assets/` is inside `src`. */
const INCLUDE = ["src", "package.json", "README.md"];
async function copyInto(destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  for (const entry of INCLUDE) {
    await cp(join(ROOT, entry), join(destination, entry), { recursive: true });
  }

  // A stamp makes it obvious which engine version a bundle carries, so a stale
  // copy is caught instead of silently reviewing with an old page.
  await writeFile(
    join(destination, "BUNDLE.json"),
    JSON.stringify({ name: APP.NAME, version: APP.VERSION, source: ROOT }, null, 2) + "\n",
    "utf8",
  );

  const copied = await walk(join(destination, "src"));
  console.log(`  ${relative(ROOT, destination)} — ${copied} files, engine ${APP.VERSION}`);
}
async function walk(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += await walk(join(dir, entry.name));
    else total += 1;
  }
  return total;
}
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    for (const key of Object.keys(BUNDLES)) console.log(key);
    return;
  }

  const names = args.length ? args : Object.keys(BUNDLES);
  const unknown = names.filter((name) => !BUNDLES[name]);
  if (unknown.length) {
    console.error(`Unknown host(s): ${unknown.join(", ")}. Known: ${Object.keys(BUNDLES).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Bundling the ${APP.NAME} engine ${APP.VERSION} into editor integrations:`);
  for (const name of names) {
    await copyInto(join(ROOT, BUNDLES[name]));
  }
  console.log("Done. The integration now finds the server next to itself.");
}
await main();
