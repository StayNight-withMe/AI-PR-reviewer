/**
 * The editor integrations are thin hosts over ONE contract: they run
 * `src/cli.js`, read the one `PR_REVIEW_READY` line and show its URL.
 *
 * This test guards that contract without needing any GUI editor installed:
 *
 *   1. Every shipped bundle actually exists and contains the engine.
 *   2. A bundled engine launches, serves a real page and stops on signal —
 *      i.e. the copy the editor runs is not stale or incomplete.
 *   3. The compiled VS Code `ReviewSession` starts and stops that same engine
 *      (it is plain CommonJS and imports no `vscode`, so Node can drive it).
 *   4. The Visual Studio and Zed receipts point at the same launcher contract.
 *
 * Run: node tests/editors.mjs
 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APP, CLI, GIT, ROUTES } from "../src/config.js";
const exec = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(ROOT, "..");
/** True when `artifact` is missing or older than `source`. */
function isStale(artifact, source) {
  if (!existsSync(artifact)) return true;
  if (!existsSync(source)) return false;
  return statSync(artifact).mtimeMs < statSync(source).mtimeMs;
}
/** host key -> the bundle directory its code looks in. */
const BUNDLES = {
  vscode: join(PROJECT, "editors", "vscode", "server"),
  visualstudio: join(PROJECT, "editors", "visualstudio", "server"),
  jetbrains: join(PROJECT, "editors", "jetbrains", "server"),
};
const failures = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`PASS ${name}`),
      (error) => {
        failures.push(`${name}: ${error.message}`);
        console.log(`FAIL ${name} — ${error.message}`);
      },
    );
}
/** Runs a launcher and resolves with its ready payload; rejects on failure. */
function runLauncher(cliPath, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      windowsHide: true,
      env: { ...process.env, PR_REVIEW_OPEN: "0" },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("the launcher did not answer in time"));
    }, 60_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((l) => l.startsWith(CLI.READY_PREFIX));
      if (!line) return;
      clearTimeout(timer);
      resolve({ child, info: JSON.parse(line.slice(CLI.READY_PREFIX.length)) });
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(stderr.trim() || `the launcher exited with code ${code}`));
    });
  });
}
/* A throwaway repository so the test never touches the working checkout. */
const repo = await mkdtemp(join(tmpdir(), "pr-review-editors-"));
const git = (...args) => exec(GIT.BIN, args, { cwd: repo });
try {
  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src/app.ts"), "export const value = 1;\n");
  await git("add", "-A");
  await git("commit", "-m", "init");

  /* 1. Every bundle is present and complete. */
  for (const [host, destination] of Object.entries(BUNDLES)) {
    await check(`${host}: the engine bundle exists`, async () => {
      const cli = join(destination, "src", "cli.js");
      assert.ok(existsSync(cli), `missing ${cli}`);

      const assets = join(destination, "src", "assets", "main.js");
      assert.ok(existsSync(assets), `missing ${assets}`);

      const pkg = JSON.parse(await readFile(join(destination, "package.json"), "utf8"));
      assert.equal(pkg.type, "module", "the bundled package.json is not the engine's");

      const stamp = JSON.parse(await readFile(join(destination, "BUNDLE.json"), "utf8"));
      assert.equal(stamp.version, APP.VERSION, "the bundle carries a stale engine version");
    });
  }

  /* 2. A bundled engine launches and serves a real page, then stops. */
  for (const [host, destination] of Object.entries(BUNDLES)) {
    await check(`${host}: the bundled engine serves the page and stops`, async () => {
      const cli = join(destination, "src", "cli.js");
      const { child, info } = await runLauncher(cli, ["--repo", repo, "--mode", "uncommitted", "--json"], { cwd: repo });
      try {
        assert.equal(info.ok, true);
        assert.ok(info.url.startsWith("http://127.0.0.1:"), `unexpected url ${info.url}`);

        const response = await fetch(new URL(ROUTES.API_VERSION, info.url));
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.protocol, APP.PROTOCOL_VERSION, "protocol mismatch");
      } finally {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await exited;
      }
    });
  }

  /* 3. The compiled VS Code session drives the real engine. */
  await check("vscode: ReviewSession starts and stops the engine", async () => {
    const sessionModule = join(PROJECT, "editors", "vscode", "out", "session.js");
    if (isStale(sessionModule, join(PROJECT, "editors", "vscode", "src", "session.ts"))) {
      // The TypeScript is not compiled, or is older than its source: build it
      // so the test never exercises a stale bundle.
      await exec("npx", ["tsc", "-p", "./"], { cwd: join(PROJECT, "editors", "vscode"), shell: true });
    }

    const { ReviewSession } = await import(pathToFileURL(sessionModule).href);
    const session = new ReviewSession();
    const cliPath = join(BUNDLES.vscode, "src", "cli.js");

    const info = await session.start({
      nodePath: process.execPath,
      cliPath,
      cwd: repo,
      mode: "uncommitted",
      startTimeoutMs: 60_000,
    });

    assert.ok(session.isOpen, "the session should report itself open");
    assert.equal(info.repo.replaceAll("\\", "/").toLowerCase(), repo.replaceAll("\\", "/").toLowerCase());
    assert.equal(info.mode, "uncommitted");

    const response = await fetch(new URL(ROUTES.API_VERSION, info.url));
    assert.equal(response.status, 200);

    await session.stop();
    assert.equal(session.isOpen, false, "the session should be closed after stop");
  });

  /* 4. A bad CLI path fails fast and leaves nothing running. */
  await check("vscode: a failed launch rejects and stops cleanly", async () => {
    const sessionModule = join(PROJECT, "editors", "vscode", "out", "session.js");
    const { ReviewSession } = await import(pathToFileURL(sessionModule).href);
    const session = new ReviewSession();

    await assert.rejects(
      session.start({
        nodePath: process.execPath,
        cliPath: join(repo, "does-not-exist.js"),
        cwd: repo,
        mode: "uncommitted",
        startTimeoutMs: 5_000,
      }),
    );
    assert.equal(session.isOpen, false, "a failed launch must not stay open");
  });

  /* 5. The other hosts point at the same contract. */
  await check("visualstudio: ServerRunner reads the same ready prefix", async () => {
    const text = await readFile(join(PROJECT, "editors", "visualstudio", "ServerRunner.cs"), "utf8");
    assert.ok(text.includes(`"${CLI.READY_PREFIX}"`), "the ready prefix is not the shared one");
    assert.ok(text.includes("--json"), "the runner must ask for the machine-readable line");
  });

  await check("zed: the task launches the shared cli with --open", async () => {
    const text = await readFile(join(PROJECT, "editors", "zed", "README.md"), "utf8");
    assert.ok(text.includes("cli.js"), "the Zed task must call the shared launcher");
    assert.ok(text.includes("--open"), "the Zed task should open the browser");
    assert.ok(text.includes("context_servers"), "the Zed MCP setup is missing");
  });

  await check("jetbrains: ReviewServer reads the shared ready line", async () => {
    const text = await readFile(
      join(PROJECT, "editors", "jetbrains", "src", "main", "kotlin", "com", "prreview", "jetbrains", "ReviewServer.kt"),
      "utf8",
    );
    assert.ok(text.includes(`"${CLI.READY_PREFIX}"`), "the ready prefix is not the shared one");
    assert.ok(text.includes("--json"), "the runner must ask for the machine-readable line");
    assert.ok(text.includes("server/src/cli.js"), "the bundled engine path is missing");
  });

  /* A plugin is loaded as a jar, so the engine inside it has to be unpacked
     before Node can run it. Shipping the files without that step installs a
     plugin that cannot start anything. */
  await check("jetbrains: the plugin unpacks its bundled engine", async () => {
    const text = await readFile(
      join(PROJECT, "editors", "jetbrains", "src", "main", "kotlin", "com", "prreview", "jetbrains", "ReviewServer.kt"),
      "utf8",
    );
    assert.ok(text.includes("JarFile"), "the plugin does not read its own jar");
    assert.ok(text.includes("entries"), "the plugin does not walk the jar's entries");

    const build = await readFile(join(PROJECT, "editors", "jetbrains", "build.gradle.kts"), "utf8");
    assert.ok(/from\("server"\)/.test(build), "the engine is not copied into the plugin resources");
  });

  await check("visualstudio: the package carries the engine and names its asset", async () => {
    const project = await readFile(join(PROJECT, "editors", "visualstudio", "PrReview.VisualStudio.csproj"), "utf8");
    assert.ok(project.includes('Include="server\\**\\*"'), "the engine is not part of the package");

    const manifest = await readFile(join(PROJECT, "editors", "visualstudio", "source.extension.vsixmanifest"), "utf8");
    assert.ok(!manifest.includes("PkgdefProjectOutputGroup"),
      "the manifest names a build-time placeholder instead of a file");
    assert.ok(manifest.includes("ProductArchitecture"),
      "VS 2022 rejects an installation target without an architecture");
  });

  await check("visualstudio: the packer keeps the engine's folders", async () => {
    const builder = await readFile(join(PROJECT, "editors", "visualstudio", "build-vsix.mjs"), "utf8");
    // Two files share a base name; matching them by name loses one of them.
    assert.ok(!builder.includes("byBaseName"), "files are matched by name, which overwrites a namesake");
    assert.ok(builder.includes("file.name"), "the staged paths are not used as archive names");
  });

  await check("visualstudio: the VSIX does not shadow assemblies from the host", async () => {
    const builder = await readFile(join(PROJECT, "editors", "visualstudio", "build-vsix.mjs"), "utf8");
    assert.ok(builder.includes("async function sharedWithEditor()"),
      "the build does not check which DLLs Visual Studio already provides");
    assert.ok(builder.includes("shared.has(entry)"),
      "the staging step does not omit host-provided assemblies");
    assert.ok(builder.includes("const shipped = files.map"),
      "the completed VSIX is not checked for accidental assembly shadowing");
    assert.ok(builder.includes("if (shipped.length)"),
      "the build can succeed while shipping conflicting Visual Studio DLLs");
  });

  await check("neovim: the Lua module uses the shared contract", async () => {
    const text = await readFile(join(PROJECT, "editors", "neovim", "lua", "pr-review.lua"), "utf8");
    assert.ok(text.includes(`"${CLI.READY_PREFIX}"`), "the ready prefix is not the shared one");
    assert.ok(text.includes("--json"), "the module must ask for the machine-readable line");
    assert.ok(text.includes("vim.system"), "the job API is missing");
  });

  await check("sublime and emacs use the shared ready prefix", async () => {
    const sublime = await readFile(join(PROJECT, "editors", "sublime", "pr_review.py"), "utf8");
    assert.ok(sublime.includes(`"${CLI.READY_PREFIX}"`), "sublime: ready prefix mismatch");
    const emacs = await readFile(join(PROJECT, "editors", "emacs", "pr-review.el"), "utf8");
    assert.ok(emacs.includes(`"${CLI.READY_PREFIX}"`), "emacs: ready prefix mismatch");
  });

  /* 6. Bundles are byte-for-byte the current engine source. */
  await check("bundles match the current engine source", async () => {
    for (const destination of Object.values(BUNDLES)) {
      const original = await readFile(join(PROJECT, "src", "cli.js"), "utf8");
      const copy = await readFile(join(destination, "src", "cli.js"), "utf8");
      assert.equal(copy, original, `stale bundle at ${destination}`);
    }
  });
} finally {
  // Windows keeps a handle on the temp directory for a moment after the page
  // process exits; a couple of retries avoids a spurious EBUSY failure.
  await rm(repo, { recursive: true, force: true }).catch(async () => {
    await new Promise((r) => setTimeout(r, 500));
    await rm(repo, { recursive: true, force: true }).catch(() => {});
  });
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll editor integration checks passed");
}
