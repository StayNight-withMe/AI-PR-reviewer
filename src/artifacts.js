/** Where review artifacts live. */
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIT, P } from "./config.js";
/**
 * A per-user directory that does not depend on the ambient TEMP: TEMP changes
 * between launchers (VS, shells, schedulers), and the device-wide UI settings
 * written under it would silently "reset" for the user.
 */
export function stableUserRoot(env = process.env) {
  if (process.platform === GIT.PLATFORM_WIN32 && env.LOCALAPPDATA && env.LOCALAPPDATA.trim()) {
    return join(env.LOCALAPPDATA.trim(), GIT.SETTINGS_DIR_NAME);
  }
  // macOS/Linux: XDG state home is the conventional place for mutable state.
  const home = (env.HOME ?? env.USERPROFILE ?? P.EMPTY).trim();
  if (home) return join(home, ".local", "state", GIT.SETTINGS_DIR_NAME);
  return join(tmpdir(), GIT.SETTINGS_DIR_NAME);
}
/** The directory a repository's reviews are stored under. */
export function artifactsRoot(env = process.env) {
  const configured = env[GIT.ARTIFACTS_DIR_ENV];
  if (configured && configured.trim()) return configured.trim();
  // A subdirectory of the temp dir keeps unrelated tools' temp files apart.
  return join(tmpdir(), GIT.ARTIFACTS_DIR_NAME);
}
/** A stable, filesystem-safe folder name for a repository path. */
export function repoSlug(rootPath) {
  const resolved = String(rootPath ?? P.EMPTY).replace(/\\/g, "/").replace(/\/+$/, "");
  const name = resolved.split("/").filter(Boolean).pop() ?? "repo";
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(P.ZERO, 40) || "repo";
  const key = process.platform === GIT.PLATFORM_WIN32 ? resolved.toLowerCase() : resolved;
  const hash = createHash("sha1").update(key).digest("hex").slice(P.ZERO, 10);
  return `${safe}-${hash}`;
}
/** The directory of one review of `root`. */
export function reviewDir(root, reviewId, env = process.env) {
  return join(artifactsRoot(env), repoSlug(root), reviewId);
}
/** The legacy in-repo artifacts directory (read-only fallback). */
export function legacyReviewDir(root, reviewId) {
  return join(root, GIT.LEGACY_ARTIFACT_DIR, reviewId);
}
/** Removes the legacy in-repo `.pr-review/` directory. */
export async function removeLegacyArtifacts(root) {
  const dir = join(root, GIT.LEGACY_ARTIFACT_DIR);
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir, { withFileTypes: true });
    const ours = entries.length > P.ZERO && entries.every((entry) => entry.isDirectory() && /^[0-9a-f]{6,}$/i.test(entry.name));
    if (!ours) return false;
    await rm(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
