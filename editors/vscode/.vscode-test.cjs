
const { execFileSync } = require("node:child_process");
const { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");


function createFixture() {

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

  return undefined;
}

const workspaceFolder = createFixture();
const useInstallation = installedVSCode();

const artifactsDir = join(tmpdir(), "pr-review-vscode-artifacts");
rmSync(artifactsDir, { recursive: true, force: true });

module.exports = {
  files: ["./test/**/*.test.mjs"],
  version: "stable",
  extensionDevelopmentPath: __dirname,
  workspaceFolder,
  ...(useInstallation ? { useInstallation } : {}),
  env: {


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
