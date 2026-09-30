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
