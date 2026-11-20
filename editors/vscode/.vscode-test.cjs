/**
 * What `vscode-test` runs: this extension, inside a throwaway VS Code window.
 *
 * The workspace has to exist before the editor starts, because the extension
 * reviews `vscode.workspace.workspaceFolders[0]`; a folder opened from a test
 * reloads the window and kills the test host. So the fixture repository is
 * created right here, while the config is being read.
 */
const { execFileSync } = require("node:child_process");
const { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

/** A small repository whose branch shows one changed line. */
function createFixture() {
  // Earlier runs of the editor tests left a folder each; keep only this one.
  for (const name of readdirSync(join(tmpdir()))) {
    if (name.startsWith("pr-review-vscode-workspace-")) {
      rmSync(join(tmpdir(), name), { recursive: true, force: true });
    }
  }

  const root = join(tmpdir(), `pr-review-vscode-workspace-${process.pid}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "--initial-branch", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(root, "app.ts"), "export const value = 1;\nexport const other = 2;\n");
  git("add", "-A");
  git("commit", "-m", "base");
  git("checkout", "-b", "feature/vscode-test");
  writeFileSync(join(root, "app.ts"), "export const value = 1;\nexport const other = 22;\n");
  git("add", "-A");
  git("commit", "-m", "change other");
  return root;
}

/** A VS Code to test in: the one on this machine when it can be found. */
function installedVSCode() {
  const candidates = [
    process.env.PR_REVIEW_VSCODE,
    "Z:\\VSCode",
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code"),
    "C:\\Program Files\\Microsoft VS Code",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const executable = process.platform === "win32" ? "Code.exe" : "code";
    const path = join(candidate, executable);
    if (existsSync(path)) return { fromPath: path };
  }
  // Nothing local: the runner downloads the version it is told to use.
  return undefined;
}

const workspaceFolder = createFixture();
const useInstallation = installedVSCode();
/** Reviews of every earlier run, so a stale comment cannot answer for this one. */
const artifactsDir = join(tmpdir(), "pr-review-vscode-artifacts");
rmSync(artifactsDir, { recursive: true, force: true });

module.exports = {
  files: ["./test/**/*.test.mjs"],
  version: "stable",
  extensionDevelopmentPath: __dirname,
  workspaceFolder,
  ...(useInstallation ? { useInstallation } : {}),
  env: {
    // Reviews must not pollute the machine's real artifact folder, and the test
    // needs to know where they went.
    PR_REVIEW_ARTIFACTS_DIR: artifactsDir,
    PR_REVIEW_OPEN: "0",
  },
  launchArgs: [
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--no-sandbox",
  ],
  mocha: {
    timeout: 180000,
    ui: "tdd",
  },
};
