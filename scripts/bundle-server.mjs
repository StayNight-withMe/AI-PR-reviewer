
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP } from "../src/config.js";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BUNDLES = {
  vscode: "editors/vscode/server",
  visualstudio: "editors/visualstudio/server",
  jetbrains: "editors/jetbrains/server",
};

const INCLUDE = ["src", "package.json", "README.md"];
async function copyInto(destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  for (const entry of INCLUDE) {
    await cp(join(ROOT, entry), join(destination, entry), { recursive: true });
  }



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
