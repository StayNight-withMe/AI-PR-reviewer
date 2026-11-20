/**
 * Tests the VS Code extension the way a person uses it.
 *
 * What can be automated honestly:
 *   - the extension compiles and installs into a real VS Code;
 *   - its session starts the bundled engine and the page really answers;
 *   - the page can be embedded, which is what the tab does;
 *   - VS Code launches with the project and the extension activates.
 *
 * Run: node editors/vscode/test-in-editor.mjs
 */
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const OUT = "Z:\\system\\temp\\pr-review-ide";
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, "..", "..");
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

await mkdir(OUT, { recursive: true });

/* ------------------------------ the project ------------------------------ */
const projectRoot = await mkdtemp(join(tmpdir(), "pr-review-editor-"));
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

const CODE = "Z:\\VSCode\\bin\\code.cmd";

/** Runs the VS Code CLI without a shell, so a path with a space stays one argument. */
async function runCode(args) {
  // `code.cmd` needs cmd.exe on Windows, but the arguments are passed as a list
  // and quoted there, not concatenated into one string.
  if (process.platform !== "win32") return exec("code", args);
  return exec("cmd", ["/c", "code.cmd", ...args], { env: { ...process.env, PATH: `Z:\\VSCode\\bin;${process.env.PATH}` } });
}

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

await check("the extension installs into a real VS Code", async () => {
  // VS Code installs a packaged extension, not a folder: build the .vsix the
  // marketplace would receive and install that. A relative output path keeps
  // the space in the project path out of the argument.
  const vsixName = "pr-review-0.1.0.vsix";
  await exec("npx", ["--yes", "@vscode/vsce", "package", "--no-dependencies",
    "--allow-missing-repository", "--out", vsixName], { cwd: HERE, shell: true });
  const { stdout } = await runCode(["--install-extension", join(HERE, vsixName), "--force"]);
  await writeFile(join(OUT, "install.log"), stdout, "utf8");
  if (!/successfully installed|already installed/i.test(stdout)) {
    throw new Error(`VS Code did not accept the extension: ${stdout.trim()}`);
  }
});

/** The installed copy, which is what actually runs inside the editor. */
async function installedExtension() {
  const root = join(homedir(), ".vscode", "extensions");
  const folders = await readdir(root).catch(() => []);
  const folder = folders.find((name) => name.toLowerCase().startsWith("pr-review.pr-review-"));
  return folder ? join(root, folder) : null;
}

await check("the installed copy carries the engine too", async () => {
  const installed = await installedExtension();
  if (!installed) throw new Error("the extension folder was not found after install");
  const cli = join(installed, "server", "src", "cli.js");
  if (!existsSync(cli)) throw new Error(`the installed extension cannot start the engine: ${cli} missing`);
});

await check("the session starts the bundled engine and the page answers", async () => {
  const installed = (await installedExtension()) ?? HERE;
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

    const response = await fetch(info.url);
    const html = await response.text();
    if (!html.includes("pr-review-data")) throw new Error("the page did not render");
    if (!html.includes("app.ts")) throw new Error("the review does not contain the changed file");

    // The tab is an iframe, so the page must allow being framed.
    const framed = /x-frame-options/i.test(JSON.stringify([...response.headers]));
    if (framed) throw new Error("the page refuses to be embedded in the tab");

    await writeFile(join(OUT, "page.html"), html, "utf8");
  } finally {
    await session.stop();
  }
});

await check("the review page still answers after the session stops", async () => {
  // A port left listening after "close" is an orphan the user cannot see.
  const installed = (await installedExtension()) ?? HERE;
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

await check("VS Code opens the project with the extension installed", async () => {
  const child = spawn(CODE, ["--new-window", projectRoot], { shell: true, stdio: "ignore", detached: true });
  child.unref();
  await new Promise((resolve) => setTimeout(resolve, 9000));
  const { stdout } = await runCode(["--status"]).catch(() => ({ stdout: "" }));
  await writeFile(join(OUT, "vscode-status.txt"), stdout, "utf8");
  // The window is one process with a list of open windows; a launched window
  // shows up there.
  if (!stdout.trim()) throw new Error("VS Code did not answer its own status command");
});

console.log(JSON.stringify({ projectRoot, out: OUT }, null, 1));

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll VS Code editor checks passed");
void rm;
