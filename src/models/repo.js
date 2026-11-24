
import { P, RENDER } from "../config.js";

export function repoLabel(repoPath, remote) {
  if (!remote) {
    return repoPath.split(/[\\/]/).filter(Boolean).pop() ?? RENDER.REPO_FALLBACK;
  }

  const cleaned = remote
    .replace(/\.git$/, P.EMPTY)
    .replace(/^git@([^:]+):/, `${RENDER.REMOTE_HTTPS_PREFIX}$1/`);

  return cleaned.split(P.SLASH).filter(Boolean).slice(-P.TWO).join(P.SLASH);
}
