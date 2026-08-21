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
  VERSION: "1.1.0",
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
  API_COMMIT: "/api/commit",
  API_COMMIT_RENAME: "/api/commit/rename",
  API_RANGE: "/api/range",
  API_USAGES: "/api/usages",
  API_SEARCH: "/api/search",
  API_VERSION: "/api/version",
  API_SETTINGS: "/api/settings",
  FAVICON: "/favicon.ico",
};
