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
async function handleDispatch({ request, response, onDispatch, session }) {
  const payload = JSON.parse(await readBody(request));
  session.lastDispatch = payload;
  const result = onDispatch ? await onDispatch(payload) : { ok: true };
  send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, ...result }));
  return true;
}
async function handleCommitDiff({ response, url, loadCommit }) {
  const sha = url.searchParams.get(QUERY.SHA) ?? P.EMPTY;
  if (!sha || !loadCommit) {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.MISSING_SHA }));
    return true;
  }
  try {
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, ...(await loadCommit(sha)) }));
  } catch (error) {
    send(response, SERVER.STATUS_ERROR, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: String(error.message) }));
  }
  return true;
}
async function handleRangeDiff({ response, url, loadRange }) {
  const from = url.searchParams.get(QUERY.FROM) ?? P.EMPTY;
  const to = url.searchParams.get(QUERY.TO) ?? P.EMPTY;
  if (!from || !to || !loadRange) {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.MISSING_RANGE }));
    return true;
  }
  try {
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, ...(await loadRange(from, to)) }));
  } catch (error) {
    send(response, SERVER.STATUS_ERROR, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: String(error.message) }));
  }
  return true;
}
async function handleUsages({ response, url, findUsages }) {
  const name = url.searchParams.get(QUERY.NAME) ?? P.EMPTY;
  if (!name || !findUsages) {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.MISSING_NAME }));
    return true;
  }
  try {
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, usages: await findUsages(name) }));
  } catch (error) {
    send(response, SERVER.STATUS_ERROR, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: String(error.message) }));
  }
  return true;
}
async function handleSearch({ response, url, searchProject }) {
  const query = url.searchParams.get(QUERY.Q) ?? P.EMPTY;
  if (!query || !searchProject) {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.MISSING_QUERY }));
    return true;
  }
  try {
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, hits: await searchProject(query) }));
  } catch (error) {
    send(response, SERVER.STATUS_ERROR, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: String(error.message) }));
  }
  return true;
}
async function handleCommitRename({ request, response, renameCommit }) {
  if (!renameCommit) {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.RENAME_UNAVAILABLE }));
    return true;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.INVALID_BODY }));
    return true;
  }

  const sha = String(payload?.sha ?? P.EMPTY);
  const message = String(payload?.message ?? P.EMPTY);
  if (!sha || !message.trim()) {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.MISSING_COMMIT_MESSAGE }));
    return true;
  }

  try {
    const result = await renameCommit(sha, message, { allowPushed: payload.allowPushed === true });
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, commit: result }));
  } catch (error) {
    send(response, SERVER.STATUS_ERROR, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: String(error.message) }));
  }
  return true;
}
/** --------------------------------- helpers -------------------------------- */
function send(response, status, contentType, body) {
  response.writeHead(status, {
    [HEADER_CONTENT_TYPE]: contentType,
    [HEADER_CACHE_CONTROL]: SERVER.CACHE_CONTROL_VALUE,
  });
  response.end(body);
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = P.ZERO;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > SERVER.MAX_BODY_BYTES) {
        reject(new Error(SERVER.BODY_TOO_LARGE));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks).toString(SERVER.CHARSET)));
    request.on("error", reject);
  });
}
function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
/** Images pasted into comments arrive as data URLs; store them as real files. */
async function persistImages(outputDir, review) {
  const saved = [];
  const imagesDir = join(outputDir, ARTIFACTS.IMAGES_DIR);

  for (const comment of review.comments ?? P.EMPTY_ARRAY) {
    if (!Array.isArray(comment.images) || comment.images.length === P.ZERO) continue;

    await mkdir(imagesDir, { recursive: true });

    for (const [index, image] of comment.images.entries()) {
      const match = SERVER.DATA_URL_PATTERN.exec(image.dataUrl ?? P.EMPTY);
      if (!match) continue;

      const extension = match[1].split(P.SLASH)[1].replace(SERVER.XML_SUFFIX, P.EMPTY).replace(SERVER.JPEG_SUFFIX, SERVER.JPG_EXTENSION);
      const fileName = `${comment.id}${P.DASH}${index}${P.DOT}${extension}`;
      await writeFile(join(imagesDir, fileName), Buffer.from(match[2], SERVER.BASE64));

      image.file = `${ARTIFACTS.IMAGES_DIR}${P.SLASH}${fileName}`;
      saved.push(image.file);
    }
  }

  return saved;
}
