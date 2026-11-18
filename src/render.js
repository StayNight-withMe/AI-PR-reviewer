import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSETS, DIFF, DIFF_MODE, FILES, MODE, MODE_LABELS, P, RENDER, REVIEW_STATE, SYMBOL_LINKS, TREE_OPEN, UI, VIEW_FILE_MODE } from "./config.js";
const here = dirname(fileURLToPath(import.meta.url));
const BOM = 0xfeff;
const JS_SEPARATOR = "\n;\n";
let cache = null;
const stripBom = (value) => (value.charCodeAt(P.ZERO) === BOM ? value.slice(P.ONE) : value);
export async function loadAssets() {
  if (cache) return cache;

  const read = async (file) => {
    try {
      return stripBom(await readFile(join(here, FILES.ASSETS_DIR, file), FILES.ENCODING));
    } catch {
      return P.EMPTY;
    }
  };

  const [styles, appParts, viewerParts, hljsScript] = await Promise.all([
    read(ASSETS.STYLES),
    Promise.all(ASSETS.JS.map((file) => read(file))),
    Promise.all(ASSETS.VIEWER_JS.map((file) => read(file))),
    read(ASSETS.BUNDLE),
  ]);

  cache = {
    styles,
    app: appParts.filter(Boolean).join(JS_SEPARATOR),
    viewer: viewerParts.filter(Boolean).join(JS_SEPARATOR),
    hljsScript,
  };
  return cache;
}
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, RENDER.HTML_AMP)
    .replace(/</g, RENDER.HTML_LT)
    .replace(/>/g, RENDER.HTML_GT)
    .replace(/"/g, RENDER.HTML_QUOTE);
}
/** The PR badge in the header: a link to the pull request, with its state. */
function prBadge(pr) {
  if (!pr) return P.EMPTY;
  const label = pr.number ? `#${pr.number}` : "PR";
  const state = pr.draft ? "draft" : String(pr.state ?? P.EMPTY).toLowerCase();
  const href = pr.url ? escapeHtml(pr.url) : null;
  const text = escapeHtml(state ? `${label} · ${state}` : label);
  const title = pr.title ? ` title="${escapeHtml(pr.title)}"` : P.EMPTY;

  return href
    ? `<a class="pr-badge" href="${href}" target="_blank" rel="noopener"${title}>${text}</a>`
    : `<span class="pr-badge"${title}>${text}</span>`;
}
export function reviewId(meta) {
  const seed = [meta.repo, meta.branch, meta.base, meta.head, meta.mode, meta.scope ?? P.EMPTY, meta.fingerprint ?? P.EMPTY].join(P.PIPE);
  return createHash(RENDER.HASH_ALGORITHM).update(seed).digest(RENDER.HASH_ENCODING).slice(P.ZERO, RENDER.ID_LENGTH);
}
const GITHUB_MARK =
  '<svg height="24" viewBox="0 0 16 16" width="24" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8Z"></path></svg>';
export async function buildPage(meta, files, stats, allFiles, comments, reviewState, options = {}) {
  const assets = await loadAssets();

  const data = {
    id: meta.id,
    repo: meta.repo,
    branch: meta.branch,
    base: meta.base,
    head: meta.head,
    mode: meta.mode,
    commits: meta.commits ?? P.EMPTY_ARRAY,
    files,
    allFiles,
    stats,
    comments: comments ?? P.EMPTY_ARRAY,
    collapsed: options.collapsed ?? P.EMPTY_ARRAY,
    reviewState: reviewState ?? REVIEW_STATE.COMMENT,
    diffMode: options.diffMode === DIFF_MODE.SPLIT ? DIFF_MODE.SPLIT : DIFF_MODE.UNIFIED,
    symbols: options.symbols ?? P.EMPTY_OBJECT,
    definitions: options.definitions ?? P.EMPTY_OBJECT,
    usages: options.usages ?? P.EMPTY_OBJECT,
    implementations: options.implementations ?? P.EMPTY_OBJECT,
    dispatchEnabled: options.dispatchEnabled !== false,
  };

  const safeJson = JSON.stringify(data).replace(/</g, RENDER.SAFE_JSON_LT);

  return `<!DOCTYPE html>
<html lang="${RENDER.LANG}" data-theme="${UI.DEFAULT_THEME}">
<head>
<meta charset="${RENDER.META_CHARSET}">
<meta name="viewport" content="${RENDER.META_VIEWPORT}">
<title>${escapeHtml(meta.title || `${meta.repo}${P.COLON}${P.SPACE}${meta.branch}`)}${RENDER.TITLE_SUFFIX}</title>
<style>${assets.styles}</style>
</head>
<body>

<header class="gh-header">
  ${GITHUB_MARK}
  <div class="header-info">
    <h1><span class="gh-muted">${escapeHtml(meta.repo)}</span>${escapeHtml(meta.title ? RENDER.DEFAULT_TITLE_SEPARATOR + meta.title : P.EMPTY)}</h1>
    <div class="gh-header-meta">
      <span class="mode-pill">${escapeHtml(meta.modeLabel || meta.mode)}</span>
      ${meta.pr ? prBadge(meta.pr) : P.EMPTY}
      <span>${escapeHtml(meta.branch)}</span>
      <span>${files.length} files</span>
      <span class="stat-add">+${stats.additions}</span>
      <span class="stat-del">${P.DASH}${stats.deletions}</span>
    </div>
  </div>
  <div class="spacer"></div>
  <div class="search-wrap">
    <button class="gh-btn gh-btn-sm" id="btn-search" title="Search the whole project">Search</button>
    <div class="search-panel" id="search-panel" hidden>
      <input class="gh-input search-input" id="search-input" placeholder="Search all files…" autocomplete="off">
      <div class="search-results" id="search-results"></div>
    </div>
  </div>
  <div class="header-summary" id="header-summary"></div>
  <button class="gh-btn gh-btn-sm" id="btn-sidebar" title="Show / hide the review sidebar">Sidebar</button>
  <button class="gh-btn gh-btn-sm" id="btn-theme" title="Toggle theme">◐</button>
  <button class="gh-btn gh-btn-sm" id="btn-settings" title="Settings">⚙</button>
</header>

<div class="settings-pop" id="settings-pop">
  <h3>Settings</h3>
  <label class="settings-row">
    <span>Tree opens files</span>
    <select class="gh-input" id="set-tree-open">
      <option value="${TREE_OPEN.CURRENT}">In current tab</option>
      <option value="${TREE_OPEN.NEW}">In new tab</option>
    </select>
  </label>
  <label class="settings-row">
    <span>Diff layout</span>
    <select class="gh-input" id="set-diff-mode">
      <option value="${DIFF_MODE.UNIFIED}">Unified</option>
      <option value="${DIFF_MODE.SPLIT}">Split</option>
    </select>
  </label>
  <label class="settings-row">
    <span>Hide viewed files</span>
    <input type="checkbox" id="set-hide-viewed">
  </label>
  <label class="settings-row">
    <span>Collapse reviewed file</span>
    <input type="checkbox" id="set-collapse-viewed">
  </label>
  <label class="settings-row">
    <span>Symbol links</span>
    <select class="gh-input" id="set-symlinks">
      <option value="${SYMBOL_LINKS.ON}">On</option>
      <option value="off">Off</option>
    </select>
  </label>
  <label class="settings-row">
    <span>Review sidebar</span>
    <input type="checkbox" id="set-sidebar">
  </label>
  <label class="settings-row">
    <span>Tree indent (px)</span>
    <input class="gh-input settings-number" type="number" id="set-tree-indent"
      min="4" max="48" step="1" list="tree-indent-presets" title="Pixels per nesting level (4-48)">
  </label>
  <datalist id="tree-indent-presets">
    <option value="6"></option>
    <option value="10"></option>
    <option value="12"></option>
    <option value="16"></option>
    <option value="20"></option>
    <option value="24"></option>
    <option value="32"></option>
  </datalist>
  <label class="settings-row">
    <span>Auto-scroll tree</span>
    <input type="checkbox" id="set-autoscroll-tree">
  </label>
  <label class="settings-row">
    <span>Open links in this page</span>
    <input type="checkbox" id="set-inline-links">
  </label>
  <label class="settings-row">
    <span>Collapse files over</span>
    <input class="gh-input settings-number" type="number" id="set-large-file-lines" min="0" max="20000" step="50">
  </label>
  <label class="settings-row">
    <span>Hide unchanged code over</span>
    <input class="gh-input settings-number" type="number" id="set-context-collapse-lines" min="0" max="2000" step="1"
      list="context-collapse-presets"
      title="Hide a block of unchanged code only when it holds more non-empty lines than this (0 = never hide)">
  </label>
  <datalist id="context-collapse-presets">
    <option value="0"></option>
    <option value="5"></option>
    <option value="10"></option>
    <option value="20"></option>
    <option value="50"></option>
  </datalist>
  <label class="settings-row">
    <span>View file opens</span>
    <select class="gh-input" id="set-view-file-mode">
      <option value="${VIEW_FILE_MODE.TAB}">In a new tab</option>
      <option value="${VIEW_FILE_MODE.SAME}">In this page</option>
      <option value="${VIEW_FILE_MODE.PANEL}">In an embedded panel</option>
    </select>
  </label>
  <div class="settings-foot">
    <button class="gh-btn gh-btn-sm js-close-settings">Done</button>
  </div>
</div>

<nav class="gh-tabs">
  <button class="gh-tab active" data-tab="files">
    <span>Files changed</span>
    <span class="tab-count" id="tab-files-count">${files.length}</span>
  </button>
  <button class="gh-tab" data-tab="commits">
    <span>Commits</span>
    <span class="tab-count" id="tab-commits-count">${meta.commits?.length ?? 0}</span>
  </button>
</nav>

<div class="gh-layout">
  <aside class="gh-tree" id="file-tree"></aside>
  <div class="tree-resizer" id="tree-resizer" role="separator" aria-orientation="vertical" aria-label="Resize the file tree" tabindex="0"></div>
  <button class="tree-reveal js-tree-reveal" id="tree-reveal" title="Show the file tree" aria-label="Show the file tree" hidden>
    <span class="tree-reveal-chevron">›</span>
  </button>

  <main class="gh-main" id="main-panel">
    <div id="files-tab">
      <div class="gh-sticky-toolbar">
        <div class="toolbar">
          <input class="gh-input" id="filter-input" placeholder="Filter changed files…" autocomplete="off">
          <button class="gh-btn gh-btn-sm is-toggle" id="toggle-viewed" aria-pressed="false">Hide viewed</button>
          <span class="btn-group" role="group" aria-label="Diff layout">
            <button class="gh-btn gh-btn-sm js-mode-opt" data-mode="unified">Unified</button>
            <button class="gh-btn gh-btn-sm js-mode-opt" data-mode="split">Split</button>
          </span>
          <button class="gh-btn gh-btn-sm" id="back-to-last" title="Return to last viewed changed file">↩ Last file</button>
        </div>
        <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
      </div>
      <div id="diff-files"></div>
      <div id="inline-file-host" class="inline-file-host hidden"></div>
    </div>

    <div id="commits-tab" class="hidden">
      <div class="scope-bar">
        <div class="scope-group">
          <label class="scope-label" for="branch-select">Branch</label>
          <select class="gh-input" id="branch-select">
            <option value="">Loading branches…</option>
          </select>
          <span class="small muted" id="branch-hint"></span>
        </div>
      </div>
      <div class="scope-bar">
        <div class="scope-group">
          <label class="scope-label" for="scope-mode">Add review</label>
          <select class="gh-input" id="scope-mode">
            <option value="${MODE.UNCOMMITTED}">Uncommitted changes</option>
            <option value="${MODE.RANGE}">Commit range</option>
            <option value="${MODE.ALL}">All commits on branch</option>
          </select>
          <button class="gh-btn gh-btn-primary gh-btn-sm" id="btn-open-scope">Review</button>
        </div>
        <div class="scope-hint small muted" id="scope-hint"></div>
      </div>
      <div id="commits-list"></div>
    </div>
  </main>

  <aside class="gh-sidebar" id="sidebar">
    <div class="gh-card sidebar-section">
      <h2>Review</h2>
      <div class="review-state">
        <span class="dot dot-comment" id="review-state"></span>
        <span id="review-state-text">Commented</span>
      </div>
      <div class="small muted"><span id="comment-count">0</span> comments</div>
      <div class="small muted" style="margin-top:6px"><span id="viewed-progress-2"></span></div>
    </div>

    <div class="gh-card sidebar-section">
      <h2>Comments</h2>
      <div id="comment-list"></div>
    </div>
  </aside>
</div>

<div class="action-bar">
  <span class="status" id="action-status-bar">Click the + gutter, then drag, to comment</span>
  <div class="spacer"></div>
  <button class="gh-btn" id="btn-copy-path">Copy review path</button>
  <button class="gh-btn gh-btn-primary" id="btn-submit">Submit review</button>
</div>

<div class="modal-backdrop" id="commit-picker">
  <div class="modal commit-picker-modal">
    <div class="modal-header">
      <span>Select commits to view</span>
      <button class="gh-btn gh-btn-sm js-close-picker" id="commit-picker-close">×</button>
    </div>
    <div class="modal-body commit-picker-body">
      <div class="commit-picker-hint small muted" id="commit-picker-count"></div>
      <div class="commit-picker-list" id="commit-picker-list"></div>
    </div>
    <div class="modal-footer">
      <button class="gh-btn" id="commit-picker-cancel">Cancel</button>
      <button class="gh-btn gh-btn-primary" id="commit-picker-save">Save</button>
    </div>
  </div>
</div>

<div class="modal-backdrop" id="dispatch-modal">
  <div class="modal">
    <div class="modal-header">
      Submit review
      <button class="gh-btn gh-btn-sm js-close-modal">Close</button>
    </div>
    <div class="modal-body">
      <p class="small muted" style="margin-top:0">
        The review is written to disk. Pick a verdict and add a note.
      </p>
      <label class="radio-card selected">
        <input type="radio" name="review-verdict" value="${REVIEW_STATE.REQUEST_CHANGES}" checked>
        <span>
          <span class="title">Request changes</span><br>
          <span class="desc">The AI fixes what the notes say.</span>
        </span>
      </label>
      <label class="radio-card">
        <input type="radio" name="review-verdict" value="${REVIEW_STATE.APPROVE}">
        <span>
          <span class="title">Approve</span><br>
          <span class="desc">The work is good. The AI only reads the note and stays hands-off.</span>
        </span>
      </label>
      <p class="small muted" style="margin:14px 0 6px">Note (optional)</p>
      <textarea class="gh-textarea" id="review-body" placeholder="Anything the AI should know about this review…"></textarea>
      <div class="dispatch-mode" style="margin-top:14px">
        <label class="radio-line">
          <input type="checkbox" id="dispatch-send" checked>
          <span>Send to the AI</span>
        </label>
        <span class="small muted">Uncheck to only save review.json / review.md.</span>
      </div>
    </div>
    <div class="modal-footer">
      <button class="gh-btn js-close-modal">Cancel</button>
      <button class="gh-btn gh-btn-primary" id="btn-dispatch-submit">Submit</button>
    </div>
  </div>
</div>

<div class="lightbox" id="lightbox"><img alt="Preview"><button class="lightbox-close">×</button></div>
<div class="toast" id="toast"></div>

<script id="pr-review-data" type="application/json">${safeJson}</script>
<script>
  window.addEventListener("error", function (event) {
    var host = document.getElementById("diff-files");
    if (!host || host.dataset.failed === "1") return;
    host.dataset.failed = "1";
    host.innerHTML = '<div class="empty-state" style="padding:24px;color:var(--danger)">' +
      "Runtime error: " + (event.message || "unknown") + "</div>";
  });
</script>
${assets.hljsScript ? `<script>${assets.hljsScript}</script>` : ""}
<script>${assets.app}</script>
</body>
</html>`;
}
export async function buildFilePage(repoName, file, reviewId) {
  const assets = await loadAssets();

  const data = {
    repo: repoName,
    reviewId: reviewId || P.EMPTY,
    path: file.path,
    language: file.language,
    isNew: file.isNew,
    lines: file.lines,
    changed: file.changed,
    tooLarge: !!file.tooLarge,
  };

  const safeJson = JSON.stringify(data).replace(/</g, RENDER.SAFE_JSON_LT);

  return `<!DOCTYPE html>
<html lang="${RENDER.LANG}" data-theme="${UI.DEFAULT_THEME}">
<head>
<meta charset="${RENDER.META_CHARSET}">
<meta name="viewport" content="${RENDER.META_VIEWPORT}">
<title>${escapeHtml(file.path)}${RENDER.DEFAULT_TITLE_SEPARATOR}${escapeHtml(repoName)}</title>
<style>${assets.styles}</style>
</head>
<body>
<header class="gh-header">
  ${GITHUB_MARK}
  <h1><span class="gh-muted">${escapeHtml(repoName)}</span>${P.SPACE}${P.SLASH}${P.SPACE}<strong>${escapeHtml(file.path)}</strong></h1>
  <div class="spacer"></div>
  <div class="gh-header-meta">
    <span class="small muted" id="line-count"></span>
    <button class="gh-btn gh-btn-sm" id="btn-add-file-comment" title="Add a comment to this file">Add file comment</button>
    <button class="gh-btn gh-btn-sm" id="btn-theme">◐</button>
  </div>
</header>

<div class="viewer-wrap">
  <div class="viewer-toolbar">
    <span class="small muted" id="changed-count"></span>
    <div class="spacer"></div>
    <span class="small muted">Click the + gutter (or a line number) and drag to comment</span>
  </div>
  <div id="file-viewer"></div>
</div>

<div class="toast" id="toast"></div>
<script id="file-data" type="${RENDER.SCRIPT_TYPE_JSON}">${safeJson}</script>
${assets.hljsScript ? `<script>${assets.hljsScript}</script>` : P.EMPTY}
<script>${assets.viewer}</script>
</body>
</html>`;
}
export function buildMarkdown(meta, review) {
  const lines = [];
  // A submit may omit the summary (an API client, an older page, a test): the
  // Markdown must still be produced instead of failing the whole request.
  const summary = review.summary ?? P.EMPTY_OBJECT;
  const pending = summary.files === undefined;

  lines.push(`# Review: ${meta.repo}${RENDER.DEFAULT_TITLE_SEPARATOR}${meta.branch}`);
  lines.push(P.EMPTY);
  lines.push(`- **Mode**: ${meta.modeLabel || meta.mode}`);
  lines.push(`- **State**: ${review.reviewState}`);
  if (!pending) {
    lines.push(`- **Files**: ${summary.files} (+${summary.additions} / ${P.DASH}${summary.deletions})`);
    lines.push(`- **Comments**: ${summary.comments}`);
  } else {
    lines.push(`- **Comments**: ${(review.comments ?? P.EMPTY_ARRAY).length}`);
  }
  if (meta.base) lines.push(`- **Base**: \`${meta.base}\``);
  if (meta.head) lines.push(`- **Head**: \`${meta.head}\``);

  if (meta.commits?.length) {
    lines.push(P.EMPTY);
    lines.push("## Commits");
    for (const commit of meta.commits) {
      lines.push(`- \`${commit.shortSha}\` ${commit.subject}${commit.authorName ? ` — ${commit.authorName}` : P.EMPTY}`);
    }
  }

  if (meta.pr) {
    lines.push(P.EMPTY);
    lines.push("## Pull request");
    lines.push(P.EMPTY);
    const label = meta.pr.number ? `#${meta.pr.number}` : "pull request";
    lines.push(`- **Pull request**: ${label}${meta.pr.title ? ` — ${meta.pr.title}` : P.EMPTY}`);
    if (meta.pr.url) lines.push(`- **URL**: ${meta.pr.url}`);
    if (meta.pr.state) lines.push(`- **State**: ${meta.pr.state}${meta.pr.draft ? " (draft)" : P.EMPTY}`);
    if (meta.pr.headRefName) lines.push(`- **Head branch**: \`${meta.pr.headRefName}\``);
  }

  const comments = review.comments ?? P.EMPTY_ARRAY;

  if (review.reviewBody) {
    lines.push(P.EMPTY);
    lines.push("## Summary");
    lines.push(P.EMPTY);
    lines.push(review.reviewBody);
  }

  lines.push(P.EMPTY);
  lines.push("## Inline comments");
  lines.push(P.EMPTY);

  if (!comments.length) {
    lines.push("_No inline comments._");
  } else {
    for (const [path, grouped] of groupByPath(comments)) {
      lines.push(`### \`${path}\``);
      lines.push(P.EMPTY);
      grouped
        .sort((a, b) => a.lineStart - b.lineStart)
        .forEach((comment) => {
          const side = comment.side === DIFF.SIDE.LEFT ? "old" : "new";
          const range = comment.lineEnd && comment.lineEnd !== comment.lineStart
            ? `${comment.lineStart}${P.DASH}${comment.lineEnd}`
            : `${comment.lineStart}`;
          const resolved = comment.resolved === true ? " ~~resolved~~" : P.EMPTY;
          lines.push(`- **line ${range}** (${side}): ${comment.body}${resolved}`);
          for (const image of comment.images ?? P.EMPTY_ARRAY) {
            if (image.file) lines.push(`  ![attachment](${image.file})`);
          }
        });
      lines.push(P.EMPTY);
    }
  }

  if (review.files?.length) {
    lines.push("## Changed files");
    lines.push(P.EMPTY);
    for (const file of review.files) {
      lines.push(`- \`${file.path}\` (${file.status}, +${file.additions}/${P.DASH}${file.deletions})`);
    }
    lines.push(P.EMPTY);
  }

  return lines.join(P.NEWLINE);
}
function groupByPath(comments) {
  const grouped = new Map();
  for (const comment of comments) {
    const list = grouped.get(comment.path) ?? [];
    list.push(comment);
    grouped.set(comment.path, list);
  }
  return grouped;
}
