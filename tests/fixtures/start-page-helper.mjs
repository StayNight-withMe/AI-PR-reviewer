/**
 * Starts the review page and exits at once.
 *
 * The page must not die with the process that started it, so this helper does
 * nothing but spawn the page.
 */
import { spawnPageProcess } from "../../src/page-process.js";
import { MODE } from "../../src/config.js";
const [repo, port] = process.argv.slice(2);
spawnPageProcess({
  repoPath: repo,
  mode: MODE.UNCOMMITTED,
  port: Number(port),
});
