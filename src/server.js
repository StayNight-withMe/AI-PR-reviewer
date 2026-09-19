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
async function dispatch(ctx) {
  const { request, response, url } = ctx;
  const get = request.method === SERVER.METHOD_GET;
  const post = request.method === SERVER.METHOD_POST;

  if (get && (url.pathname === ROUTES.INDEX || url.pathname === ROUTES.INDEX_ALT)) {
    send(response, SERVER.STATUS_OK, SERVER.MIME.HTML, ctx.html);
    return true;
  }

  if (get && url.pathname === ROUTES.FILE) {
    return handleFileView(ctx);
  }

  if (get && url.pathname === ROUTES.API_FILE) {
    return handleFileJson(ctx);
  }

  if (post && url.pathname === ROUTES.API_FILES) {
    return handleFilesBatch(ctx);
  }

  if (get && url.pathname === ROUTES.API_SYMBOLS) {
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify(ctx.symbols));
    return true;
  }

  if (get && url.pathname === ROUTES.API_PATHS) {
    return handlePaths(ctx);
  }

  if (post && url.pathname === ROUTES.API_REVIEW) {
    return handleReviewSubmit(ctx);
  }
  if (post && url.pathname === ROUTES.API_DISPATCH) {
    return handleDispatch(ctx);
  }

  if (get && url.pathname === ROUTES.API_VERSION) {
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({
      ok: true,
      name: APP.NAME,
      version: APP.VERSION,
      protocol: APP.PROTOCOL_VERSION,
      reviewId: ctx.meta.id,
    }));
    return true;
  }

  if (get && url.pathname === ROUTES.API_RESULT) {
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({
      ok: true,
      review: ctx.session.lastReview,
      dispatch: ctx.session.lastDispatch,
    }));
    return true;
  }
  // Device-wide UI settings: one small file shared by every review page of

  if (get && url.pathname === ROUTES.API_SETTINGS) {
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, settings: await readSettings() }));
    return true;
  }

  if (post && url.pathname === ROUTES.API_SETTINGS) {
    let patch;
    try {
      patch = JSON.parse(await readBody(request));
    } catch {
      send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.INVALID_BODY }));
      return true;
    }
    const settings = await writeSettings(patch);
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, settings }));
    return true;
  }

  if (get && url.pathname === ROUTES.API_COMMITS) {
    const commits = ctx.listCommits
      ? await ctx.listCommits()
      : ctx.meta.commits ?? P.EMPTY_ARRAY;
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, commits }));
    return true;
  }

  if (get && url.pathname === ROUTES.API_COMMIT) {
    return handleCommitDiff(ctx);
  }

  if (post && url.pathname === ROUTES.API_COMMIT_RENAME) {
    return handleCommitRename(ctx);
  }

  if (get && url.pathname === ROUTES.API_RANGE) {
    return handleRangeDiff(ctx);
  }

  if (get && url.pathname === ROUTES.API_SEARCH) {
    return handleSearch(ctx);
  }

  if (get && url.pathname === ROUTES.API_USAGES) {
    return handleUsages(ctx);
  }

  if (get && url.pathname === ROUTES.FAVICON) {
    send(response, SERVER.STATUS_NO_CONTENT, SERVER.MIME.TEXT, P.EMPTY);
    return true;
  }

  return false;
}
/** --------------------------------- handlers -------------------------------- */
async function handleFileView({ response, url, buildFilePage }) {
  const filePath = url.searchParams.get(QUERY.PATH) ?? P.EMPTY;
  if (!filePath) {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.TEXT, SERVER.MISSING_PATH);
    return true;
  }
  send(response, SERVER.STATUS_OK, SERVER.MIME.HTML, await buildFilePage(filePath));
  return true;
}
async function handleFileJson({ response, url, readFile }) {
  const filePath = url.searchParams.get(QUERY.PATH) ?? P.EMPTY;
  try {
    const data = await readFile(filePath);
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify(data));
  } catch (error) {
    send(response, SERVER.STATUS_NOT_FOUND, SERVER.MIME.JSON, JSON.stringify({ error: String(error.message) }));
  }
  return true;
}
/** Batch variant of /api/file: one request for many files. */
async function handleFilesBatch({ request, response, readFiles }) {
  const payload = JSON.parse(await readBody(request));
  const paths = Array.isArray(payload.paths) ? payload.paths.slice(P.ZERO, SERVER.MAX_BATCH_FILES) : P.EMPTY_ARRAY;

  if (!readFiles) {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.MISSING_FILES }));
    return true;
  }

  const files = await readFiles(paths);
  send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, files }));
  return true;
}
function handlePaths({ response, outputDir }) {
  send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({
    outputDir,
    jsonPath: join(outputDir, ARTIFACTS.REVIEW_JSON),
    markdownPath: join(outputDir, ARTIFACTS.REVIEW_MARKDOWN),
    imagesDir: join(outputDir, ARTIFACTS.IMAGES_DIR),
  }));
  return true;
}
async function handleReviewSubmit({ request, response, outputDir, meta, onReview, session }) {
  const review = JSON.parse(await readBody(request));
  const savedImages = await persistImages(outputDir, review);
  const result = await onReview(review, meta);

  session.lastReview = { ...result, review };
  send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, ...result, images: savedImages }));
  session.resolveSubmitted({ ...result, review });
  return true;
}
