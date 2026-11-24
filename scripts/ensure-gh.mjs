
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { GH } from "../src/config.js";
const exec = promisify(execFile);
const PACKAGE_MANAGERS = {
  win32: [
    { bin: "winget", args: ["install", "--id", "GitHub.cli", "-e", "--source", "winget", "--accept-source-agreements", "--accept-package-agreements"] },
    { bin: "choco", args: ["install", "gh", "-y"] },
    { bin: "scoop", args: ["install", "gh"] },
  ],
  darwin: [
    { bin: "brew", args: ["install", "gh"] },
  ],
  linux: [
    { bin: "apt-get", args: ["install", "-y", "gh"], sudo: true },
    { bin: "dnf", args: ["install", "-y", "gh"], sudo: true },
    { bin: "pacman", args: ["-S", "--noconfirm", "gh"], sudo: true },
    { bin: "apk", args: ["add", "gh"], sudo: true },
  ],
};
const DOCS_URL = "https://cli.github.com";

async function ghPresent(binary) {
  try {
    await exec(binary, ["--version"], { windowsHide: true, timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

async function findPackageManager() {
  const platform = process.platform === "win32"
    ? "win32"
    : process.platform === "darwin" ? "darwin" : "linux";
  const candidates = PACKAGE_MANAGERS[platform] ?? [];

  for (const candidate of candidates) {
    if (await commandExists(candidate.bin)) return candidate;
  }
  return null;
}
async function commandExists(bin) {
  try {
    const probe = process.platform === "win32" ? "where" : "which";
    await exec(probe, [bin], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function install(packageManager) {
  const command = packageManager.sudo ? "sudo" : packageManager.bin;
  const args = packageManager.sudo ? [packageManager.bin, ...packageManager.args] : packageManager.args;

  try {
    await exec(command, args, {
      windowsHide: true,
      timeout: 10 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { installed: true, via: packageManager.bin };
  } catch (error) {
    return {
      installed: false,
      via: packageManager.bin,
      error: String(error.stderr ?? error.message ?? error).trim().slice(0, 400),
    };
  }
}
async function main() {
  const argv = new Set(process.argv.slice(2));
  const json = argv.has("--json");
  const checkOnly = argv.has("--check");
  const forceInstall = argv.has("--install");
  const neverFail = argv.has("--never-fail");
  const binary = process.env[GH.ENV_BIN]?.trim() || GH.BIN;

  const present = await ghPresent(binary);
  const result = {
    gh: binary,
    present,
    authenticated: false,
    installed: false,
    via: null,
    suggestion: null,
  };

  if (present) {
    result.authenticated = await ghAuthenticated(binary);
  } else if (!checkOnly) {

    const manager = await findPackageManager();
    if (manager) {
      const outcome = await install(manager);
      result.installed = outcome.installed;
      result.via = outcome.via ?? null;
      if (outcome.error) result.error = outcome.error;
      if (outcome.installed) {
        result.present = await ghPresent(binary);
        if (result.present) result.authenticated = await ghAuthenticated(binary);
      }
    } else {
      result.suggestion = suggestionForPlatform();
    }
  } else if (checkOnly && !present) {
    result.suggestion = suggestionForPlatform();
  }

  if (!present && forceInstall && !result.installed) {
    result.suggestion = result.suggestion ?? suggestionForPlatform();
  }

  report(result, { json });
  process.exitCode = result.present || neverFail ? 0 : 1;
}
async function ghAuthenticated(binary) {
  try {
    await exec(binary, ["auth", "status"], { windowsHide: true, timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}
function suggestionForPlatform() {
  const platform = process.platform;
  if (platform === "win32") return "winget install --id GitHub.cli -e";
  if (platform === "darwin") return "brew install gh";
  return "sudo apt-get install gh";
}
function report(result, { json }) {
  if (json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }

  if (result.present) {
    console.log(`GitHub CLI: ${result.gh} is installed${result.installed ? ` (installed via ${result.via})` : ""}.`);
    if (!result.authenticated) {
      console.log("Not logged in. Run: gh auth login");
      console.log("(mode=pr needs an authenticated gh; branch/commits reviews do not.)");
    }
    return;
  }

  console.log(`GitHub CLI: not found${result.installed ? " (install did not succeed)" : ""}.`);
  console.log(`Pull requests (mode=pr) need it. Install from ${DOCS_URL}`);
  if (result.suggestion) console.log(`  ${result.suggestion}`);
  if (result.error) console.log(`  last error: ${result.error}`);
  console.log("Local reviews (uncommitted, branch, commits, range, all) work without it.");
}
main().catch((error) => {
  console.error("ensure-gh failed:", error.message);
  process.exitCode = 1;
});
