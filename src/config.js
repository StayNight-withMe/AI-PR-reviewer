/** Single source of truth for every literal used by the review server and UI. */
/** ------------------------------- primitives ------------------------------ */
export const P = {
  EMPTY: "",
  NEWLINE: "\n",
  SPACE: " ",
  TAB: "\t",
  SLASH: "/",
  BACKSLASH: "\\",
  /** `typeof` result for strings, avoids a magic literal in comparisons. */
  TYPE_STRING: "string",
  DOT: ".",
  COMMA: ",",
  COLON: ":",
  SEMICOLON: ";",
  PIPE: "|",
  DASH: "-",
  UNDERSCORE: "_",
  QUESTION: "?",
  EQUALS: "=",
  QUOTE: '"',
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  NEG_ONE: -1,
  EMPTY_OBJECT: {},
  EMPTY_ARRAY: [],
  EMPTY_MAP: new Map(),
  /** Upper bound for a stored UI setting value, in characters. */
  MAX_SETTING_LENGTH: 64,
};
/** ---------------------------------- app ---------------------------------- */
export const APP = {
  NAME: "pr-review",
  VERSION: "1.1.2",
  /** The version of the HTTP contract the editor extensions rely on. */
  PROTOCOL_VERSION: "1",
};
/** ----------------------------------- cli --------------------------------- */
export const CLI = {
  /** Printed on stdout before the JSON line the extensions parse. */
  READY_PREFIX: "PR_REVIEW_READY ",
  /** Environment variables the extensions set to steer the launch. */
  ENV: {
    REPO: "PR_REVIEW_REPO",
    PORT: "PR_REVIEW_PORT",
    MODE: "PR_REVIEW_MODE",
    BASE: "PR_REVIEW_BASE",
    HEAD: "PR_REVIEW_HEAD",
    OPEN: "PR_REVIEW_OPEN",
    TITLE: "PR_REVIEW_TITLE",
    PR: "PR_REVIEW_PR",
    PR_REPO: "PR_REVIEW_PR_REPO",
  },
  /** Default scope: the current branch against its base, not the whole project. */
  DEFAULT_MODE: "branch",
};
/** ----------------------------------- gh ---------------------------------- */
/** The GitHub CLI integration: `mode=pr` reads a pull request through `gh` and reviews exactly… */
export const GH = {
  BIN: "gh",
  /** Env var that overrides the binary (a portable install, a wrapper). */
  ENV_BIN: "PR_REVIEW_GH",
  /** Default remote name the PR branch is fetched from. */
  DEFAULT_REMOTE: "origin",
  /** `gh pr view <ref> --json <fields>`: everything the page header needs. */
  ARGS_VIEW: ["pr", "view"],
  /** `gh pr list --json ...`: what the agent sees before picking one. */
  ARGS_LIST: ["pr", "list"],
  /** The light fields `gh pr list` returns. */
  LIST_FIELDS: ["number", "title", "state", "isDraft", "headRefName", "baseRefName", "url", "author", "updatedAt"],
  /** `gh pr list --state <x>`: the states the tool accepts. */
  LIST_STATES: ["open", "closed", "merged", "all"],
  LIST_DEFAULT_LIMIT: 20,
  LIST_MAX_LIMIT: 100,
  /** A cheap check that `gh` is logged in before a PR is read. */
  ARGS_AUTH_STATUS: ["auth", "status"],
  ARGS_JSON: ["--json"],
  ARGS_REPO: ["--repo"],
  /** The fields requested from `gh pr view`; keep in sync with `parsePullRequest`. */
  FIELDS: [
    "number",
    "title",
    "url",
    "state",
    "isDraft",
    "baseRefName",
    "headRefName",
    "baseRefOid",
    "headRefOid",
    "author",
    "body",
    "additions",
    "deletions",
    "changedFiles",
    "mergeable",
  ],
  /** Fetch a PR head into a local ref without checking it out. */
  ARGS_FETCH: ["fetch", "--no-tags"],
  /** A local ref that pins the fetched PR head; never the moving remote branch. */
  HEAD_REF_PREFIX: "refs/pr-review/pr-",
  /** A local ref that pins the fetched PR base; never `origin/<branch>`. */
  BASE_REF_PREFIX: "refs/pr-review/base-",
  /** Where the PR head is fetched from, when the source branch is on the base repo. */
  HEAD_REF_TEMPLATE: "refs/pull/{number}/head",
  TITLE_PREFIX: "PR #",
  /** Identity of a PR in the review id, so two PRs of a repo never collide. */
  SCOPE_PREFIX: "pr",
  ERROR_NO_BIN:
    "The GitHub CLI (gh) was not found. Install it from https://cli.github.com and run `gh auth login`.",
  ERROR_NOT_AUTHED: "The GitHub CLI is not authenticated. Run `gh auth login` and try again.",
  ERROR_NO_PR: "No pull request found for this repository.",
  ERROR_BAD_JSON: "The GitHub CLI returned an unreadable pull request.",
  ERROR_FETCH_FAILED: "Could not fetch the pull request head: ",
  /** Publishing a locally written review back to GitHub as a real PR review. */
  ARGS_REVIEW: ["pr", "review"],
  ARGS_REVIEW_BODY: ["--body"],
  ARGS_API: ["api"],
  FLAG_METHOD: "--method",
  FLAG_INPUT: "--input",
  STDIN: "-",
  HTTP_POST: "POST",
  /** `gh api` endpoint; `{repo}` and `{number}` are filled in by the caller. */
  PR_REVIEWS_ENDPOINT: "repos/{repo}/pulls/{number}/reviews",
  PLACEHOLDER_REPO: "{repo}",
  PLACEHOLDER_NUMBER: "{number}",
  /** `--comment` / `--approve` / `--request-changes`: the verdict flags. */
  FLAG_COMMENT: "--comment",
  FLAG_APPROVE: "--approve",
  FLAG_REQUEST_CHANGES: "--request-changes",
  /** GitHub's own limits; exceeding them makes the API reject the whole review. */
  MAX_BODY_CHARS: 65536,
  MAX_INLINE_COMMENTS: 100,
  ERROR_PUBLISH_FAILED: "GitHub rejected the review: ",
  ERROR_NOT_A_PR: "This review is not about a pull request, so there is nothing to publish to GitHub.",
  ERROR_PUBLISH_NEEDS_GH: "Publishing a review needs the GitHub CLI (gh) to be installed and logged in.",
};
/** --------------------------------- server -------------------------------- */
export const SERVER = {
  HOST: "127.0.0.1",
  DEFAULT_PORT: P.ZERO,
  MAX_BODY_BYTES: 32 * 1024 * 1024,
  CHARSET: "utf-8",
  METHOD_GET: "GET",
  METHOD_POST: "POST",
  URL_PROTOCOL: "http://",
  HEADER_CONTENT_TYPE: "content-type",
  HEADER_CACHE_CONTROL: "cache-control",
  CACHE_CONTROL_VALUE: "no-store",
  STATUS_OK: 200,
  STATUS_NO_CONTENT: 204,
  STATUS_BAD_REQUEST: 400,
  STATUS_NOT_FOUND: 404,
  STATUS_ERROR: 500,
  FILE_ENCODING: "utf8",
  JSON_INDENT: 2,
  MAX_BATCH_FILES: 500,
  BASE64: "base64",
  BODY_TOO_LARGE: "Request body too large",
  DATA_URL_PATTERN: /^data:(image\/[a-zA-Z+]+);base64,(.+)$/,
  XML_SUFFIX: "+xml",
  JPEG_SUFFIX: "jpeg",
  JPG_EXTENSION: "jpg",
  DEFAULT_ERROR: "Not found",
  MISSING_PATH: "Missing ?path=",
  MISSING_SHA: "Missing sha",
  MISSING_RANGE: "Missing from/to",
  MISSING_BRANCH: "Missing branch",
  MISSING_NAME: "Missing name",
  MISSING_QUERY: "Missing ?q=",
  MISSING_COMMIT_MESSAGE: "Missing sha or message",
  RENAME_UNAVAILABLE: "Commit renaming is not available",
  INVALID_BODY: "Invalid JSON body",
  MISSING_FILES: "Missing paths",
  PORT_MIN: 0,
  PORT_MAX: 65535,
  KEEPALIVE_MS: 60_000,
  /** How long the MCP waits for the page process to register itself. */
  PAGE_START_TIMEOUT_MS: 60_000,
  /** How often the MCP checks whether the page process is up. */
  PAGE_POLL_MS: 250,
  /** How often the MCP checks whether the review was submitted. */
  PAGE_RESULT_POLL_MS: 500,
  /** Per-user directory that indexes review pages across MCP processes. */
  PAGE_INDEX_DIR_NAME: ".pr-review-mcp",
  /** The subdirectory of that directory: one file per reviewId, no write race. */
  PAGE_INDEX_PAGES: "pages",
  MIME: {
    HTML: "text/html; charset=utf-8",
    TEXT: "text/plain; charset=utf-8",
    JSON: "application/json; charset=utf-8",
    SVG: "image/svg+xml",
    PNG: "image/png",
  },
};
export const ROUTES = {
  INDEX: "/",
  INDEX_ALT: "/index.html",
  FILE: "/file",
  API_FILE: "/api/file",
  API_FILES: "/api/files",
  API_SYMBOLS: "/api/symbols",
  API_PATHS: "/api/paths",
  API_REVIEW: "/api/review",
  API_DISPATCH: "/api/dispatch",
  API_RESULT: "/api/result",
  API_COMMITS: "/api/commits",
  API_BRANCHES: "/api/branches",
  API_BRANCH_COMMITS: "/api/branch-commits",
  API_COMMIT: "/api/commit",
  API_COMMIT_RENAME: "/api/commit/rename",
  API_RANGE: "/api/range",
  API_USAGES: "/api/usages",
  API_SEARCH: "/api/search",
  API_VERSION: "/api/version",
  API_SETTINGS: "/api/settings",
  FAVICON: "/favicon.ico",
};
export const QUERY = {
  PATH: "path",
  SHA: "sha",
  FROM: "from",
  TO: "to",
  NAME: "name",
  Q: "q",
  BRANCH: "branch",
};
/** ---------------------------------- git ---------------------------------- */
export const GIT = {
  BIN: "git",
  /** Well-known git locations, tried when git is not on the PATH. */
  INSTALL_CANDIDATES: [
    "%SYSTEMROOT%\\Program Files\\Git\\cmd\\git.exe",
    "%SYSTEMROOT%\\Program Files (x86)\\Git\\cmd\\git.exe",
    "%LOCALAPPDATA%\\Programs\\Git\\cmd\\git.exe",
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "/usr/bin/git",
    "/usr/local/bin/git",
    "/opt/homebrew/bin/git",
  ],
  ARTIFACT_DIR: ".pr-review",
  /** Where review artifacts are written when no directory is configured. */
  ARTIFACTS_DIR_ENV: "PR_REVIEW_ARTIFACTS_DIR",
  ARTIFACTS_DIR_NAME: "pr-review-mcp",
  /** Old in-repo directory, still cleaned/migrated from. */
  LEGACY_ARTIFACT_DIR: ".pr-review",
  /** `process.platform` value for Windows, used to compare path case. */
  PLATFORM_WIN32: "win32",
  MAX_BUFFER: 256 * 1024 * 1024,
  MAX_COMMITS: 200,
  MAX_HISTORY: 500,
  DEFAULT_REF: "HEAD",
  DEFAULT_BASE: "origin/HEAD",
  /** Base branches tried in order when the scope does not name one. */
  BASE_CANDIDATES: ["origin/dev", "origin/main", "origin/master", "origin/HEAD"],
  /** Tracking branch of the checked-out branch, used when no base branch exists. */
  UPSTREAM_REF: "@{upstream}",
  SHORT_SHA_LENGTH: 7,
  EMPTY_TREE: "/dev/null",
  MAX_REVIEW_FILE_BYTES: 2_000_000,
  MAX_SEARCH_HITS: 200,
  MIN_SEARCH_LENGTH: 2,
  EXCLUDE_PATHSPEC: [":(exclude).pr-review/**", ":(exclude).pr-review"],
  ARGS: {
    /** Writes a path with non-ASCII letters as it is, not as an octal escape. */
    QUOTE_PATH_OFF: ["-c", "core.quotepath=false"],
    REV_PARSE_TOPLEVEL: ["rev-parse", "--show-toplevel"],
    BRANCH_SHOW: ["branch", "--show-current"],
    REMOTE: ["remote", "get-url", "origin"],
    BRANCHES: ["branch", "-a", "--format=%(refname:short)"],
    REV_PARSE_COMMIT: ["rev-parse", "--verify"],
    MERGE_BASE: ["merge-base"],
    LOG: ["log", "--no-color", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI", "--date=iso-strict"],
    LOG_NOT_REMOTES: ["--not", "--remotes"],
    SHOW_STAT: ["show", "--no-color", "--patch", "--no-renames", "--format="],
    LS_FILES: ["ls-files"],
    LS_FILES_UNTRACKED: ["ls-files", "--others", "--exclude-standard"],
    LS_TREE: ["ls-tree", "-r", "--name-only"],
    DIFF: ["diff", "--no-color", "--no-renames", "--patch"],
    DIFF_CACHED: ["diff", "--cached", "--no-color", "--no-renames", "--patch"],
    DIFF_NAME_STATUS: ["diff", "--name-status", "--no-renames"],
    DIFF_NO_INDEX: ["diff", "--no-index", "--no-color", "--no-renames", "--patch"],
    CAT_FILE_BATCH: ["cat-file", "--batch"],
    /** `cat-file -e <rev>`: fails unless the object really exists locally. */
    CAT_FILE_EXISTS: ["cat-file", "-e"],
    GREP: ["grep", "-n", "-I", "-w", "--no-color"],
    GREP_LINES: ["grep", "-n", "-I", "--no-color", "-F", "--untracked"],
    REV_LIST_HEAD: ["rev-list", "HEAD"],
    REV_LIST_UNPUSHED: ["rev-list", "HEAD", "--not", "--remotes"],
    /** Orders the given commits newest-first without walking their ancestors. */
    REV_LIST_NO_WALK: ["rev-list", "--no-walk=sorted"],
    COMMIT_AMEND_MESSAGE: ["commit", "--amend", "--only", "--no-verify", "-m"],
    COMMIT_MESSAGE: ["-m"],
    COMMIT_TREE: "commit-tree",
    REBASE_ONTO: ["rebase", "--onto"],
    REBASE_ROOT: ["rebase", "--root", "--onto"],
    REBASE_ABORT: ["rebase", "--abort"],
    REBASE_CONTINUE: ["rebase", "--continue"],
    RESET: ["reset", "--hard"],
    TAG: ["tag"],
    UPDATE_REF: ["update-ref"],
  },
  FLAGS: {
    VERIFY: "--verify",
    HEAD: "--",
    DOT: ".",
    NO_EDIT: "--no-edit",
    ONLY: "--only",
    AMEND: "--amend",
    FORCE: "--force",
    PARENT: "-p",
    PARENTS: "--parents",
    MAX_COUNT_ONE: "--max-count=1",
  },
  FLAG_UNIFIED_ZERO: "-U0",
  /** Searches the content without regard to the case. */
  FLAG_IGNORE_CASE: "-i",
  FLAG_MAX_COUNT: "--max-count=",
  FLAG_PATH_SPEC: "--",
  COMMIT_SUFFIX: "^{commit}",
  TREE_SUFFIX: "^{tree}",
  /** Suffix that names the first parent of a commit: `<sha>~`. */
  TILDE: "~",
  REV_LIST: "rev-list",
  /** The empty tree object: the "before" side of a repository's first commit. */
  EMPTY_TREE_OBJECT: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  BACKUP_REF_PREFIX: "refs/pr-review-backup/",
  LOG_FIELD_SEPARATOR: "\u001f",
  RANGE_SEPARATOR: "...",
  RANGE_SEPARATOR_TWO_DOT: "..",
  /** The symbolic name git lists for the remote head; not a real branch. */
  HEAD_ALIAS: "origin/HEAD",
  SHOW: "show",
  NEWLINE_BYTE: 0x0a,
  NEWLINE_NOT_FOUND: -1,
  BATCH_HEADER_PARTS: 3,
  MISSING_OBJECT: "missing",
  STATUS_RENAME: "R",
  STATUS_ADDED: "A",
  STATUS_DELETED: "D",
  /** The same statuses as names, which the UI colours by. */
  STATUS_ADDED_NAME: "added",
  STATUS_DELETED_NAME: "deleted",
  STATUS_RENAMED: "renamed",
  STATUS_MODIFIED: "modified",
  ENOENT: "ENOENT",
  ERROR_NOT_INSTALLED: "git executable not found. Install Git and make sure it is on PATH.",
  ERROR_NOT_A_REPO: "Not a git repository: ",
};
/** -------------------------------- artifacts ------------------------------ */
export const ARTIFACTS = {
  REVIEW_JSON: "review.json",
  REVIEW_MARKDOWN: "review.md",
  IMAGES_DIR: "images",
  DISPATCH_PROMPT: "dispatch-prompt.md",
};
/** ------------------------------ mcp tool limits --------------------------- */
/** Defaults of the MCP tool schemas, so the defaults and the text agree. */
export const TOOLS = {
  AWAIT_DEFAULT_SECONDS: 120,
  AWAIT_MAX_SECONDS: 3600,
  SCOPE_LIST_DEFAULT: 50,
  SCOPE_LIST_MAX: 500,
};
/** ------------------------------- agent handoff --------------------------- */
/** Connection back to the OpenCode session that opened the review, so a submit can start the fix… */
export const AGENT = {
  BIN: "opencode",
  ARGS: { RUN: ["run"], API: ["api", "session.prompt"], API_GET: ["api", "session.get"] },
  FLAG_SESSION: "--session",
  /** `--param sessionID=<id>` addresses one exact session. */
  FLAG_PARAM: "--param",
  PARAM_SESSION: "sessionID={id}",
  /** OpenCode puts the id of the session that made the MCP call into the call metadata under this… */
  META_SESSION_KEY: "ai.opencode/sessionID",
  /** The API expects the prompt as a plain text body. */
  BODY_FIELD: "text",
  SHELL_PLATFORMS: { WIN32: "win32" },
  /** Grace window before assuming the child started successfully. */
  SPAWN_GRACE_MS: 1200,
  ERROR_NO_SESSION:
    "No OpenCode session found. Open the review from a session (start_review) to enable auto-dispatch.",
  ERROR_NO_BINARY: "OpenCode CLI not found, so the fix turn could not be started.",
  ERROR_API_FAILED: "The OpenCode API rejected the fix turn.",
  ERROR_SESSION_MISSING:
    "The OpenCode session that opened this review is gone, so the fix turn could not be delivered.",
  /** Native CLI locations, tried before falling back to the `.cmd` shim. */
  BINARY_CANDIDATES: [
    "%APPDATA%/npm/node_modules/@opencode/cli-windows-x64/bin/opencode.exe",
    "%LOCALAPPDATA%/npm/node_modules/@opencode/cli-windows-x64/bin/opencode.exe",
    "%PROGRAMFILES%/opencode/opencode.exe",
    "/usr/local/bin/opencode",
    "/opt/homebrew/bin/opencode",
  ],
  ENV_PLACEHOLDER: {
    APP_DATA: "%APPDATA%",
    LOCAL_APP_DATA: "%LOCALAPPDATA%",
    PROGRAM_FILES: "%PROGRAMFILES%",
  },
};
/** ------------------------------ symbol index ----------------------------- */
export const SYMBOL_INDEX = {
  MAX_FILES: 4000,
  MAX_FILE_BYTES: 400_000,
  MAX_USAGE_FILES: 60,
  MIN_NAME_LENGTH: 2,
  MAX_POPOVER_USAGES: 12,
  IGNORED_DIR: "node_modules/",
  NEWLINE_CODE: 0x0a,
  GENERIC_SUFFIX: /<.*$/,
  /** Bare identifier matcher for usage counting and cell lookups. */
  WORD: /\b[A-Za-z_]\w*\b/g,
  /** Usage lines kept per file, enough for the popover's line links. */
  MAX_USAGE_LINES: 12,
  WHERE_SUFFIX: /\s+where\b.*$/,
  IDENTIFIER: /^[A-Za-z_]\w*$/,
  IDENTIFIER_SIMPLE: /^[A-Za-z_]\w*$/,
  LOWER_START: /^[a-z]/,
  COMMENT_LINE: "//",
  COMMENT_STAR: "*",
  COMMENT_BLOCK: "/*",
  GREP_NAME_FLAG: "-e",
  GREP_PATH_FLAG: "--",
};
export const SYMBOL_KIND = {
  CLASS: "class",
  INTERFACE: "interface",
  ENUM: "enum",
  RECORD: "record",
  STRUCT: "struct",
  CONST: "const",
  PROPERTY: "property",
  METHOD: "method",
  SYMBOL: "symbol",
  DEFINITION: "definition",
};
/** ------------------------------- diff model ------------------------------ */
export const DIFF = {
  STATUS: {
    MODIFIED: "modified",
    ADDED: "added",
    DELETED: "deleted",
    RENAMED: "renamed",
  },
  LINE_KIND: {
    ADD: "add",
    DEL: "del",
    CTX: "ctx",
    META: "meta",
  },
  SIDE: {
    LEFT: "left",
    RIGHT: "right",
  },
  PREFIX: {
    A: "a/",
    B: "b/",
    DIFF_GIT: "diff --git ",
    NEW_FILE_MODE: "new file mode",
    DELETED_FILE_MODE: "deleted file mode",
    RENAME_FROM: "rename from ",
    RENAME_TO: "rename to ",
    OLD_MODE: "old mode ",
    NEW_MODE: "new mode ",
    BINARY_FILES: "Binary files",
    HUNK: "@@",
    ADDED_LINE: "+",
    DELETED_LINE: "-",
    CONTEXT_LINE: " ",
  },
  /** Grammar of the unified-diff text git emits. */
  PATTERN: {
    /** `diff --git a/<old> b/<new>`, each side optionally quoted. */
    HEADER: /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/,
    /** `@@ -oldStart,oldLines +newStart,newLines @@ section`. */
    HUNK: /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/,
    /** The octal branch of a path escape, used to decode a git-quoted name. */
    OCTAL: /^[0-7]{3}$/,
  },
  LANGUAGE: {
    PLAINTEXT: "plaintext",
    CSHARP: "csharp",
    XML: "xml",
    TYPESCRIPT: "typescript",
    JAVASCRIPT: "javascript",
    JSON: "json",
    YAML: "yaml",
    INI: "ini",
    MARKDOWN: "markdown",
    CSS: "css",
    SCSS: "scss",
    LESS: "less",
    BASH: "bash",
    POWERSHELL: "powershell",
    DOS: "dos",
    SQL: "sql",
    PYTHON: "python",
    RUBY: "ruby",
    GO: "go",
    RUST: "rust",
    JAVA: "java",
    KOTLIN: "kotlin",
    PHP: "php",
    DOCKERFILE: "dockerfile",
    PROPERTIES: "properties",
    MAKEFILE: "makefile",
  },
  BINARY_EXTENSIONS: [
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff",
    "pdf", "zip", "gz", "tar", "7z", "rar",
    "dll", "exe", "so", "dylib", "pdb", "nupkg",
    "woff", "woff2", "ttf", "otf", "eot",
    "mp3", "mp4", "mov", "avi", "webm", "wav",
  ],
  LANGUAGE_BY_EXTENSION: {
    cs: "csharp", csproj: "xml", props: "xml", targets: "xml", sln: "plaintext", slnx: "xml",
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    json: "json", jsonc: "json", yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini",
    md: "markdown", xml: "xml", html: "xml", css: "css", scss: "scss", less: "less",
    // A .vue file is markup with script and style blocks; XML colours the markup
    // instead of leaving the whole file as plain white text.
    vue: "xml", svelte: "xml",
    sh: "bash", bash: "bash", ps1: "powershell", bat: "dos", cmd: "dos",
    sql: "sql", py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin",
    php: "php", dockerfile: "dockerfile", env: "properties", gitignore: "properties",
  },
};
/** --------------------------------- render -------------------------------- */
export const RENDER = {
  ID_LENGTH: 12,
  DEFAULT_TITLE_SEPARATOR: " · ",
  TITLE_SUFFIX: " · PR Review",
  LANG: "en",
  META_CHARSET: "utf-8",
  META_VIEWPORT: "width=device-width, initial-scale=1",
  SCRIPT_TYPE_JSON: "application/json",
  SAFE_JSON_LT: "\\u003c",
  REPO_FALLBACK: "repository",
  REMOTE_HTTPS_PREFIX: "https://",
  HASH_ALGORITHM: "sha1",
  HASH_ENCODING: "hex",
  HTML_AMP: "&amp;",
  HTML_LT: "&lt;",
  HTML_GT: "&gt;",
  HTML_QUOTE: "&quot;",
};
/** ---------------------------------- gaps ---------------------------------- */
/** Side of a hunk a hidden region of unchanged lines belongs to. */
export const GAP = {
  UP: "up",
  DOWN: "down",
};
/** Folding policy for the unchanged lines around a diff hunk. */
export const CONTEXT = {
  /** A region is hidden only when it holds MORE non-empty lines than this. */
  DEFAULT_COLLAPSE_LINES: 10,
  /** This value disables folding: every region is shown expanded. */
  NEVER_COLLAPSE: 0,
};
/** ---------------------------------- ui ----------------------------------- */
export const UI = {
  CONTEXT_STEP: 20,
  DIFF_BLOCK_CELLS: 5,
  TOAST_MS: 2600,
  FLASH_MS: 900,
  MAX_COMMENT_PREVIEW_LINES: 2,
  MAX_POPOVER_USAGES: 12,
  POPOVER_WIDTH: 560,
  POPOVER_MAX_HEIGHT: 360,
  POPOVER_MARGIN: 8,
  POPOVER_OFFSET: 6,
  HYDRATION_CHUNK: 4,
  HYDRATION_DELAY_MS: 0,
  /** Viewed collapse fade, mirrors `viewedFade` in styles.css. */
  VIEWED_ANIM_MS: 160,
  /** localStorage key of the device-wide settings (mirrors client constants). */
  SETTINGS_KEY: "pr-review:settings:v1",
  SUPPRESS_CLICK_MS: 300,
  /** Delay before re-focusing a freshly opened tab. */
  FOCUS_RETRY_MS: 60,
  /** Delay before a scroll is checked and corrected. */
  SCROLL_SETTLE_MS: 450,
  /** How far a file may drift from the top before the scroll is repeated. */
  SCROLL_SETTLE_TOLERANCE: 40,
  OBSERVER_MARGIN: "300px",
  STORAGE_PREFIX: "pr-review:v3:",
  THEME_STORAGE_KEY: "pr-review-theme",
  DEFAULT_THEME: "dark",
  TARGET_NEW: "pr-file",
  TARGET_SELF: "_self",
  TARGET_BLANK: "_blank",
  NOOPENER: "noopener",
};
export const MODE = {
  UNCOMMITTED: "uncommitted",
  COMMITS: "commits",
  BRANCH: "branch",
  RANGE: "range",
  ALL: "all",
  PR: "pr",
};
export const MODE_LABELS = {
  uncommitted: "Uncommitted changes",
  branch: "Branch commits",
  commits: "Selected commits",
  range: "Commit range",
  all: "All commits on branch",
  pr: "Pull request",
};
export const REVIEW_STATE = {
  APPROVE: "APPROVE",
  REQUEST_CHANGES: "REQUEST_CHANGES",
  COMMENT: "COMMENT",
};
export const REVIEW_STATE_LABEL = {
  APPROVE: "Approved",
  REQUEST_CHANGES: "Changes requested",
  COMMENT: "Commented",
};
export const REVIEW_STATE_DOT = {
  APPROVE: "dot-approve",
  REQUEST_CHANGES: "dot-request",
  COMMENT: "dot-comment",
};
export const DIFF_MODE = {
  UNIFIED: "unified",
  SPLIT: "split",
};
export const TREE_OPEN = {
  CURRENT: "current",
  NEW: "new",
};
/** Where the "View file" button opens the file. */
export const VIEW_FILE_MODE = {
  /** A separate browser tab (the default). */
  TAB: "tab",
  /** The same page: the review scrolls to the file. */
  SAME: "same",
  /** An embedded panel inside the review, like a tab of its own. */
  PANEL: "panel",
};
export const SYMBOL_LINKS = {
  ON: "on",
  OFF: "off",
};
export const THEME = {
  DARK: "dark",
  LIGHT: "light",
};
export const DISPATCH_MODE = {
  DISPATCH: "dispatch",
  PATH: "path",
};
export const TREE = {
  STATUS_UNCHANGED: "unchanged",
};
export const FILEVIEW = {
  ENCODING: "utf8",
  ERROR_CANNOT_READ: "Cannot read ",
  HUNK_NEW_LINE: /\+(\d+)(?:,\d+)?/,
  DIFF_HEADER_OLD: "---",
  DIFF_HEADER_NEW: "+++",
};
export const ASSETS = {
  JS: ["constants.js", "core.js", "highlight.js", "tree.js", "tree-resize.js", "diff.js", "comments.js", "search.js", "commits.js", "settings.js", "occurrences.js", "pathtip.js", "main.js"],
  BUNDLE: "hljs-bundle.js",
  STYLES: "styles.css",
  /** The standalone file viewer: its own script plus the shared occurrences. */
  VIEWER_JS: ["occurrences.js", "viewer.js"],
};
export const FILES = {
  ASSETS_DIR: "assets",
  ENCODING: "utf8",
};
