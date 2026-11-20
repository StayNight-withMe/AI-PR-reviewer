/**
 * Checks the VS Code extension the way it ships.
 *
 * The editor itself is exercised by `npm run test:editors:vscode`, which loads
 * the extension inside a real VS Code through the official test runner. This
 * file covers what that run cannot: the package as a user receives it.
 *
 *   - it compiles and packs into a `.vsix`;
 *   - VS Code accepts that `.vsix`, installed into a throwaway profile so the
 *     machine's own editor keeps its extensions;
 *   - the installed copy carries the engine, and the engine starts from the
 *     installed folder and serves the review page;
 *   - closing the session releases the port.
 *
 * Nothing here opens a window: an earlier version launched one per run and left
 * the desktop full of review windows after a test.
 *
 * Run: node editors/vscode/test-in-editor.mjs
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const OUT = "Z:\\system\\temp\\pr-review-ide";
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, "..", "..");
const VSIX = "pr-review-0.1.0.vsix";
const CODE = process.env.PR_REVIEW_VSCODE_CMD ?? "Z:\\VSCode\\bin\\code.cmd";
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL ${name} — ${error.message}`);
  }
}

/** Runs the VS Code CLI through cmd.exe, which is how a `.cmd` shim starts. */
async function runCode(args) {
  if (process.platform !== "win32") return exec("code", args);
  return exec("cmd", ["/c", "code.cmd", ...args], {
    env: { ...process.env, PATH: `${dirname(CODE)};${process.env.PATH}` },
  });
}

await mkdir(OUT, { recursive: true });

/* ------------------------------ the project ------------------------------ */
const projectRoot = await mkdtemp(join(tmpdir(), "pr-review-editor-"));
/** A profile of its own: the machine's extensions stay untouched. */
const profileDir = await mkdtemp(join(tmpdir(), "pr-review-vscode-profile-"));
const extensionsDir = join(profileDir, "extensions");

const git = (...args) => exec("git", args, { cwd: projectRoot });
await git("init", "--initial-branch", "main");
await git("config", "user.email", "test@example.com");
await git("config", "user.name", "Test");
await git("config", "core.autocrlf", "false");
await writeFile(join(projectRoot, "app.ts"), "export const value = 1;\nexport const other = 2;\n");
await git("add", "-A");
await git("commit", "-m", "base");
await git("checkout", "-b", "feature/editor-test");
await writeFile(join(projectRoot, "app.ts"), "export const value = 1;\nexport const other = 22;\n");
await git("add", "-A");
await git("commit", "-m", "change other");

await check("the extension compiles", async () => {
  await exec("npx", ["tsc", "-p", "./"], { cwd: HERE, shell: true });
  const compiled = await readFile(join(HERE, "out", "extension.js"), "utf8");
  if (!compiled.includes("prReview.open")) throw new Error("the compiled extension lost its command");
});

await check("the engine is bundled next to the extension", async () => {
  await exec("npm", ["run", "bundle:server"], { cwd: PROJECT, shell: true });
  const cli = join(HERE, "server", "src", "cli.js");
  if (!existsSync(cli)) throw new Error(`missing ${cli}`);
});

await check("the package builds and VS Code accepts it", async () => {
  // VS Code installs a `.vsix`, not a folder. A relative output path keeps the
  // space in the project path out of the argument.
  await exec("npx", ["--yes", "@vscode/vsce", "package", "--no-dependencies",
    "--allow-missing-repository", "--out", VSIX], { cwd: HERE, shell: true });

  const { stdout } = await runCode([
    "--install-extension", join(HERE, VSIX),
    "--extensions-dir", extensionsDir,
    "--force",
  ]);
  if (!/successfully installed|already installed/i.test(stdout)) {
    throw new Error(`VS Code rejected the package: ${stdout.trim()}`);
  }
});

/** The installed copy, which is what actually runs inside the editor. */
async function installedExtension() {
  const folders = await readdir(extensionsDir).catch(() => []);
  const folder = folders.find((name) => name.toLowerCase().startsWith("pr-review.pr-review-"));
  return folder ? join(extensionsDir, folder) : null;
}

await check("the installed copy carries the engine", async () => {
  const installed = await installedExtension();
  if (!installed) throw new Error("the extension was not installed into the profile");

  const cli = join(installed, "server", "src", "cli.js");
  if (!existsSync(cli)) throw new Error(`the installed extension cannot start anything: ${cli} missing`);

  // Two engine files share a base name (`core.js`, both in `src` and `src/assets`);
  // a packer that matches them by name drops the server's copy.
  const serverCore = await readFile(join(installed, "server", "src", "core.js"), "utf8");
  if (!serverCore.includes("startReview")) throw new Error("the server's core.js was replaced by the page's");
});

await check("the installed engine serves a real review", async () => {
  const installed = await installedExtension();
  const { ReviewSession } = await import(pathToFileURL(join(HERE, "out", "session.js")).href);
  const session = new ReviewSession();

  const info = await session.start({
    nodePath: process.execPath,
    cliPath: join(installed, "server", "src", "cli.js"),
    cwd: projectRoot,
    mode: "branch",
    startTimeoutMs: 90_000,
  });

  try {
    if (!session.isOpen) throw new Error("the session does not report itself open");
    if (!info.url.startsWith("http://127.0.0.1:")) throw new Error(`unexpected url ${info.url}`);
    if (info.branch !== "feature/editor-test") throw new Error(`wrong branch: ${info.branch}`);
    if (info.files !== 1) throw new Error(`expected one changed file, got ${info.files}`);

    const response = await fetch(info.url);
    const html = await response.text();
    if (!html.includes("pr-review-data")) throw new Error("the page did not render");
    if (!html.includes("app.ts")) throw new Error("the review does not contain the changed file");

    // The tab is an iframe, so the page must allow being framed.
    if (/x-frame-options/i.test(JSON.stringify([...response.headers]))) {
      throw new Error("the page refuses to be embedded in the tab");
    }
    await writeFile(join(OUT, "page.html"), html, "utf8");
  } finally {
    await session.stop();
  }
});

await check("closing the session releases the port", async () => {
  const installed = await installedExtension();
  const { ReviewSession } = await import(pathToFileURL(join(HERE, "out", "session.js")).href);
  const session = new ReviewSession();
  const info = await session.start({
    nodePath: process.execPath,
    cliPath: join(installed, "server", "src", "cli.js"),
    cwd: projectRoot,
    mode: "branch",
    startTimeoutMs: 90_000,
  });
  await session.stop();

  let alive = true;
  try {
    await fetch(info.url, { signal: AbortSignal.timeout(2000) });
  } catch {
    alive = false;
  }
  if (alive) throw new Error("the page kept its port after the session was closed");
});

/* ------------------------------- clean-up -------------------------------- */
await rm(profileDir, { recursive: true, force: true }).catch(() => {});
await rm(projectRoot, { recursive: true, force: true }).catch(() => {});

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll VS Code package checks passed");
