/** Where review artifacts live. */
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIT, P } from "./config.js";
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
