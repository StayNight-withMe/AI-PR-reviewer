
import { spawnPageProcess } from "../../src/page-process.js";
import { MODE } from "../../src/config.js";
const [repo, port] = process.argv.slice(2);
spawnPageProcess({
  repoPath: repo,
  mode: MODE.UNCOMMITTED,
  port: Number(port),
});
