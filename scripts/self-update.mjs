/**
 * Self-update: fetches the newest published package and replaces the checkout.
 *
 *   node scripts/self-update.mjs [--check] [--force]
 *
 * --check   only report what is available, change nothing
 * --force   reinstall even when the version is the same
 *
 * The update path is npm: `npm pack` of the released version is downloaded
 * through the registry, so no git and no build step are needed on the target
 * machine.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const force = args.includes("--force");

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
/** `npm` is a .cmd on Windows: run it through cmd so spawn does not fail. */
const npm = async (args, cwd) => {
  const command = process.platform === "win32"
    ? `npm ${args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ")}`
    : `npm ${args.join(" ")}`;
  return exec(command, { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
};

const local = await readJson(join(REPO, "package.json"));
console.log(`Installed: pr-review-mcp ${local.version}`);

let latest;
try {
  const { stdout } = await npm(["view", local.name, "version"]);
  latest = stdout.trim();
} catch (error) {
  console.error(`Could not reach the npm registry: ${String(error.message).split("\n")[0]}`);
  process.exit(1);
}
console.log(`Latest:    pr-review-mcp ${latest}`);

// The registry can lag behind the checkout (a release that was not published
// yet), so a plain "not equal" would downgrade. Only a newer version counts.
if (!isNewer(latest, local.version)) {
  console.log("Up to date. Nothing to do.");
  process.exit(0);
}
if (checkOnly) {
  console.log(`An update is available: ${local.version} -> ${latest}. Run this command again without --check to install it.`);
  process.exit(0);
}

const stage = mkdtempSync(join(tmpdir(), "pr-review-update-"));
try {
  console.log(`Downloading pr-review-mcp@${latest}…`);
  await npm(["pack", `${local.name}@${latest}`, "--pack-destination", stage], stage);
  const tarball = join(stage, `${local.name.replace(/\//g, "-")}-${latest}.tgz`);
  if (!existsSync(tarball)) throw new Error(`the downloaded archive is missing: ${tarball}`);

  const unpacked = join(stage, "package");
  await exec(process.platform === "win32" ? "tar.exe" : "tar", ["-xzf", tarball, "-C", stage], { windowsHide: true });
  if (!existsSync(join(unpacked, "package.json"))) throw new Error("the archive has no package.json; refusing to touch the checkout");

  const incoming = await readJson(join(unpacked, "package.json"));
  if (incoming.version !== latest) throw new Error(`version mismatch: wanted ${latest}, archive has ${incoming.version}`);

  console.log("Copying files into the checkout…");
  const copied = copyTree(unpacked, REPO);
  console.log(`Updated ${copied} files. pr-review-mcp is now ${latest}.`);
  console.log("If Visual Studio is open, restart it so the extension picks up the new engine.");
} finally {
  rmSync(stage, { recursive: true, force: true });
}

/** True when `candidate` is a strictly newer semver than `current`. */
function isNewer(candidate, current) {
  const parse = (value) => String(value ?? "0.0.0").split("-")[0].split(".").map((part) => Number(part) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return true;
    if (a[index] < b[index]) return false;
  }
  return force;
}

/** Copies every file of `from` into `to`, keeping the package's layout. */
function copyTree(from, to) {
  let count = 0;
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true });
      count += copyTree(source, target);
      continue;
    }
    copyFileSync(source, target);
    count += 1;
  }
  return count;
}
