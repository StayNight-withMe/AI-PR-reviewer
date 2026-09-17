import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { APP, ARTIFACTS, P, QUERY, ROUTES, SERVER } from "./config.js";
import { readSettings, writeSettings } from "./settings-store.js";
const HEADER_CONTENT_TYPE = SERVER.HEADER_CONTENT_TYPE;
const HEADER_CACHE_CONTROL = SERVER.HEADER_CACHE_CONTROL;
export async function servePage(options) {
  const {
    html,
    outputDir,
    meta,
    onReview,
    onDispatch,
    buildFilePage,
    readFile,
    readFiles,
    loadCommit,
    loadRange,
    findUsages,
    searchProject,
    renameCommit,
    listCommits,
    port = SERVER.DEFAULT_PORT,
    host = SERVER.HOST,
    symbols = P.EMPTY_OBJECT,
  } = options;

  const session = {
    lastReview: null,
    lastDispatch: null,
    submitted: null,
    resolveSubmitted: null,
  };
  session.submitted = new Promise((resolve) => { session.resolveSubmitted = resolve; });

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `${SERVER.URL_PROTOCOL}${request.headers.host}`);
      const handled = await dispatch({
        request, response, url, html, outputDir, meta, session,
        buildFilePage, readFile, readFiles, loadCommit, loadRange, findUsages, symbols, onReview, onDispatch,
        searchProject, renameCommit, listCommits,
      });
      if (!handled) {
        send(response, SERVER.STATUS_NOT_FOUND, SERVER.MIME.TEXT, SERVER.DEFAULT_ERROR);
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      send(response, SERVER.STATUS_ERROR, SERVER.MIME.JSON, JSON.stringify({
        ok: false,
        error: String(error?.message ?? error),
      }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();

  return {
    url: `${SERVER.URL_PROTOCOL}${host}:${address.port}${ROUTES.INDEX}`,
    port: address.port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    waitForReview: (timeoutMs = P.ZERO) => (timeoutMs > P.ZERO
      ? Promise.race([session.submitted, delay(timeoutMs, null)])
      : session.submitted),
    getLastReview: () => session.lastReview,
    getLastDispatch: () => session.lastDispatch,
  };
}
