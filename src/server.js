import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { APP, ARTIFACTS, P, QUERY, REVIEW_STATE, REVIEW_STATE_LABEL, ROUTES, SERVER } from "./config.js";
import { readSettings, writeSettings } from "./settings-store.js";
import { writeReviewFiles as writeReviewOutput } from "./review-output.js";
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
    listBranches,
    loadBranchCommits,
    saveThreads,
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
      const rejected = rejectForeignRequest(request, response);
      if (rejected) return;

      const url = new URL(request.url, `${SERVER.URL_PROTOCOL}${request.headers.host}`);
      const handled = await dispatch({
        request, response, url, html, outputDir, meta, session,
        buildFilePage, readFile, readFiles, loadCommit, loadRange, findUsages, symbols, onReview, onDispatch,
        searchProject, renameCommit, listCommits, listBranches, loadBranchCommits,
        saveThreads,
      });
      if (!handled) {
        send(response, SERVER.STATUS_NOT_FOUND, SERVER.MIME.TEXT, SERVER.DEFAULT_ERROR);
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      // A body the caller sent wrongly is the caller's error, not ours.
      const status = error?.message === SERVER.BODY_TOO_LARGE
        ? SERVER.STATUS_BAD_REQUEST
        : SERVER.STATUS_ERROR;
      send(response, status, SERVER.MIME.JSON, JSON.stringify({
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

  if (get && url.pathname === ROUTES.API_BRANCHES) {
    const branches = ctx.listBranches ? await ctx.listBranches() : P.EMPTY_ARRAY;
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, branches }));
    return true;
  }

  if (get && url.pathname === ROUTES.API_BRANCH_COMMITS) {
    return handleBranchCommits(ctx);
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

  if (post && url.pathname === ROUTES.API_THREADS) {
    return handleThreadsSave(ctx);
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
  const review = normalizeReview(await readBody(request));
  if (!review) {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.INVALID_BODY }));
    return true;
  }

  const savedImages = await persistImages(outputDir, review);
  const result = await onReview(review, meta);

  session.lastReview = { ...result, review };
  send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, ...result, images: savedImages }));
  session.resolveSubmitted({ ...result, review });
  return true;
}
/**
 * Answers a request that did not come from the review page itself.
 *
 * The page listens on the loopback address, but any page in the same browser
 * can reach it: a `Host` header of a name the browser is rebinding, or a
 * cross-site POST that a browser sends without a preflight. Since the routes
 * read files, write review state and run git, both are refused.
 *
 * Returns true when the request was answered.
 */
function rejectForeignRequest(request, response) {
  const host = String(request.headers.host ?? P.EMPTY);
  const hostname = host.replace(/:\d+$/, P.EMPTY).toLowerCase();

  if (!SERVER.ALLOWED_HOSTS.includes(hostname)) {
    send(response, SERVER.STATUS_FORBIDDEN, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.BAD_HOST }));
    return true;
  }

  // Only a POST can change state, and the page always sends JSON. A form from
  // another site can only send text/plain, so requiring JSON is the check.
  if (request.method === SERVER.METHOD_POST) {
    const type = String(request.headers[HEADER_CONTENT_TYPE] ?? P.EMPTY);
    if (!type.toLowerCase().startsWith(SERVER.JSON_CONTENT_TYPE_PREFIX)) {
      send(response, SERVER.STATUS_FORBIDDEN, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.BAD_CONTENT_TYPE }));
      return true;
    }
  }

  return false;
}
/**
 * The submitted review, with every field the server relies on in a known shape.
 * The body comes from the browser: a field of the wrong type used to crash the
 * submit with a 500, and a stored `null` comment broke the next page load.
 * Returns null when the body is not JSON at all.
 */
export function normalizeReview(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  const review = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};

  return {
    ...review,
    reviewState: Object.hasOwn(REVIEW_STATE_LABEL, review.reviewState ?? P.EMPTY)
      ? review.reviewState
      : REVIEW_STATE.COMMENT,
    reviewBody: clampText(review.reviewBody, SERVER.MAX_REVIEW_BODY_CHARS),
    comments: toComments(review.comments),
    noteImages: toImages(review.noteImages),
    viewedFiles: Array.isArray(review.viewedFiles)
      ? review.viewedFiles.filter((path) => typeof path === P.TYPE_STRING)
      : P.EMPTY_ARRAY,
    summary: review.summary && typeof review.summary === "object" ? review.summary : undefined,
  };
}
function clampText(value, max) {
  const text = typeof value === P.TYPE_STRING ? value : P.EMPTY;
  return text.length > max ? text.slice(P.ZERO, max) : text;
}
/** The comments of a submit: objects with a path that is a non-empty string. */
export function toComments(comments) {
  if (!Array.isArray(comments)) return P.EMPTY_ARRAY;

  return comments
    .filter((comment) => comment && typeof comment === "object" && typeof comment.path === P.TYPE_STRING && comment.path)
    .slice(P.ZERO, SERVER.MAX_COMMENTS_PER_REVIEW)
    .map((comment) => ({
      ...comment,
      body: typeof comment.body === P.TYPE_STRING ? comment.body : P.EMPTY,
      // A comment is open unless it says otherwise. Leaving the field absent
      // made every reader guess, and the saved review carried no answer at all.
      resolved: comment.resolved === true,
      images: toImages(comment.images),
    }));
}
/** Screenshots of a submit: only entries that actually carry data. */
export function toImages(images) {
  if (!Array.isArray(images)) return P.EMPTY_ARRAY;

  return images
    .filter((image) => image && typeof image === "object" && typeof image.dataUrl === P.TYPE_STRING)
    .slice(P.ZERO, SERVER.MAX_IMAGES_PER_REVIEW);
}
async function handleDispatch({ request, response, onDispatch, session }) {
  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.INVALID_BODY }));
    return true;
  }

  session.lastDispatch = payload;
  const result = onDispatch ? await onDispatch(payload) : { ok: true };
  send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, ...result }));
  return true;
}
async function handleBranchCommits({ response, url, loadBranchCommits }) {
  const branch = url.searchParams.get(QUERY.BRANCH) ?? P.EMPTY;
  if (!branch || !loadBranchCommits) {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.MISSING_BRANCH }));
    return true;
  }
  try {
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, ...(await loadBranchCommits(branch)) }));
  } catch (error) {
    send(response, SERVER.STATUS_ERROR, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: String(error.message) }));
  }
  return true;
}
async function handleCommitDiff({ response, url, loadCommit }) {
  const sha = url.searchParams.get(QUERY.SHA) ?? P.EMPTY;  if (!sha || !loadCommit) {
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
async function handleThreadsSave({ request, response, saveThreads }) {
  if (!saveThreads) {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.THREADS_UNAVAILABLE }));
    return true;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch {
    send(response, SERVER.STATUS_BAD_REQUEST, SERVER.MIME.JSON, JSON.stringify({ ok: false, error: SERVER.INVALID_BODY }));
    return true;
  }

  const comments = toComments(payload?.comments);
  try {
    const saved = await saveThreads(comments);
    send(response, SERVER.STATUS_OK, SERVER.MIME.JSON, JSON.stringify({ ok: true, saved }));
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
    let tooLarge = false;

    request.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      // Keep draining the request instead of cutting the socket: the answer can
      // still be a readable 400 rather than a reset connection.
      if (size > SERVER.MAX_BODY_BYTES) {
        tooLarge = true;
        reject(new Error(SERVER.BODY_TOO_LARGE));
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString(SERVER.CHARSET));
    });
    request.on("error", (error) => {
      if (!tooLarge) reject(error);
    });
  });
}
function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
/** Images pasted into comments arrive as data URLs; store them as real files. */
async function persistImages(outputDir, review) {
  const saved = [];
  const imagesDir = join(outputDir, ARTIFACTS.IMAGES_DIR);

  const collect = async (images, prefix) => {
    if (!Array.isArray(images) || images.length === P.ZERO) return;

    for (const [index, image] of images.entries()) {
      const match = SERVER.DATA_URL_PATTERN.exec(image.dataUrl ?? P.EMPTY);
      if (!match) continue;

      // Only the formats a screenshot really uses are stored, and the name is
      // built from the index rather than from the comment: a crafted comment id
      // could otherwise contain `../` and write outside the review folder.
      const extension = SERVER.IMAGE_TYPES[match[P.ONE].toLowerCase()];
      if (!extension) continue;

      await mkdir(imagesDir, { recursive: true });
      const fileName = `${prefix}${P.DASH}${index}${P.DOT}${extension}`;
      await writeFile(join(imagesDir, fileName), Buffer.from(match[P.TWO], SERVER.BASE64));

      image.file = `${ARTIFACTS.IMAGES_DIR}${P.SLASH}${fileName}`;
      saved.push(image.file);
    }
  };

  for (const [index, comment] of (review.comments ?? P.EMPTY_ARRAY).entries()) {
    await collect(comment.images, `comment-${index}`);
  }
  // A screenshot on the note itself belongs to the review, not to a line. It is
  // sent as `noteImages`, a field of the review rather than of a comment.
  await collect(review.noteImages, SERVER.NOTE_IMAGE_PREFIX);

  return saved;
}
export async function writeReviewFiles(outputDir, meta, review, markdown) {
  return writeReviewOutput(outputDir, meta, review, markdown);
}
