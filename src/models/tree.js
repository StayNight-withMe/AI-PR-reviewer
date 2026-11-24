
import { fileStatus, listFiles, workingTreeStatus } from "../git.js";
import { GIT, MODE, TREE } from "../config.js";
const STATUS_UNCHANGED = TREE.STATUS_UNCHANGED;

export async function buildProjectTree(root, { mode, base, head }) {
  const rangeStatus = await fileStatus(root, { base, head }).catch(() => ({}));
  const workingStatus = mode === MODE.UNCOMMITTED
    ? await workingTreeStatus(root).catch(() => ({}))
    : {};

  const paths = await listFiles(root, { ref: head || GIT.DEFAULT_REF });
  const known = new Set(paths);



  for (const path of Object.keys(rangeStatus)) {
    if (!known.has(path)) { known.add(path); paths.push(path); }
  }
  for (const path of Object.keys(workingStatus)) {
    if (!known.has(path)) { known.add(path); paths.push(path); }
  }

  return paths.map((path) => ({
    path,
    status: workingStatus[path] || rangeStatus[path] || STATUS_UNCHANGED,
  }));
}
