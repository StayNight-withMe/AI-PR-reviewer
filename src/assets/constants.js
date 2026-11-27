
(function () {
  "use strict";

  window.PR = window.PR || {};

  window.PR.API = {
    FILE: "/api/file",
    FILES: "/api/files",
    USAGES: "/api/usages",
    COMMIT: "/api/commit",
    COMMIT_RENAME: "/api/commit/rename",
    COMMITS: "/api/commits",
    BRANCHES: "/api/branches",
    BRANCH_COMMITS: "/api/branch-commits",
    RANGE: "/api/range",
    REVIEW: "/api/review",
    PUBLISH: "/api/publish",
    DISPATCH: "/api/dispatch",
    PATHS: "/api/paths",
    SYMBOLS: "/api/symbols",
    SEARCH: "/api/search",
    RESULT: "/api/result",
    VERSION: "/api/version",
    SETTINGS: "/api/settings",
    THREADS: "/api/threads",
    VIEWED: "/api/viewed",
  };

  window.PR.REVIEW_STATE = {
    APPROVE: "APPROVE",
    REQUEST_CHANGES: "REQUEST_CHANGES",
    COMMENT: "COMMENT",
  };

  window.PR.STATE_LABEL = {
    APPROVE: "Approved",
    REQUEST_CHANGES: "Changes requested",
    COMMENT: "Commented",
  };

  window.PR.STATE_DOT = {
    APPROVE: "dot-approve",
    REQUEST_CHANGES: "dot-request",
    COMMENT: "dot-comment",
  };

  window.PR.MODE = {
    UNCOMMITTED: "uncommitted",
    COMMITS: "commits",
    BRANCH: "branch",
    RANGE: "range",
    ALL: "all",
  };


  window.PR.TAB = {
    FILES: "files",
    COMMITS: "commits",
  };


  window.PR.VIEW_KIND = {
    REVIEW: "review",
    COMMIT: "commit",
    RANGE: "range",
  };

  window.PR.DIFF_MODE = {
    UNIFIED: "unified",
    SPLIT: "split",
  };

  window.PR.TREE_OPEN = {
    CURRENT: "current",
    NEW: "new",
  };

  window.PR.SIDE = {
    LEFT: "left",
    RIGHT: "right",
  };

  window.PR.DIRECTION = {
    UP: "up",
    DOWN: "down",
  };


  window.PR.GAP = {
    UP: "up",
    DOWN: "down",
  };


  window.PR.VIEW_FILE_MODE = {

    TAB: "tab",

    SAME: "same",

    PANEL: "panel",
  };


  window.PR.CONTEXT = {

    DEFAULT_COLLAPSE_LINES: 10,

    NEVER_COLLAPSE: 0,
  };

  window.PR.MESSAGES = {
    NO_CONTENT: "No file content available",
    TOP: "Already at the top of this block",
    BOTTOM: "Already at the end of this block",
    NO_VIEWED_FILE: "No viewed file yet — mark a file as Viewed first",
    START_OF_REVIEW: "No viewed files left — jumped to the first file",
    COMMITS_NEED_TWO: "Select two commits to review a range",
    COMMIT_LABEL_SAVED: "Commit title updated",
    COMMIT_LABEL_EMPTY: "Commit title cannot be empty",
    COMMIT_PUSHED_LOCKED: "Pushed commit — tick “Allow rewrite” to rename it",
    COMMIT_RENAME_FAILED: "Rename failed: ",
    COMMIT_NOT_HEAD: "Only the newest commit can be renamed",
    SEARCH_EMPTY: "Type at least 2 characters",
    SEARCH_NONE: "Nothing found",
    POPUP_BLOCKED: "The browser blocked the new tab — allow pop-ups for this page",
  };


  window.PR.TOGGLE = {
    HIDE_VIEWED: "Hide viewed",
    SHOW_ALL: "Show all",
    SIDEBAR_SHOW: "Show sidebar",
    SIDEBAR_HIDE: "Hide sidebar",
  };


  window.PR.STORAGE_FIELD = {
    COMMIT_LABELS: "commitLabels",
    COMMIT_SELECTION: "commitSelection",
  };


  window.PR.PICKER = {
    CHECK: "check",
    LABELS: "labels",
    SHORT_SHA_LENGTH: 7,
    HOUR_MS: 36e5,
    MINUTE_MS: 6e4,
    DAY_MS: 864e5,
    RELATIVE_NOW: "just now",
    RELATIVE_HOURS: " hours ago",
    RELATIVE_MINUTES: " minutes ago",
    RELATIVE_DAYS: " days ago",
  };


  window.PR.SEARCH = {
    MIN_LENGTH: 2,
    DEBOUNCE_MS: 220,
  };


  window.PR.UI_SCROLL_SPY_OFFSET = 220;


  window.PR.UI_PIN_MS = 900;


  window.PR.TREE_SIZE = {
    DEFAULT_WIDTH: 320,
    MIN_WIDTH: 160,
    MAX_WIDTH: 640,
    SNAP_WIDTH: 110,
    KEYBOARD_STEP: 16,

    DEFAULT_INDENT: 5,

    MIN_INDENT: 4,
    MAX_INDENT: 48,
  };

  window.PR.LARGE_FILE_LINES = 400;

  window.PR.FILE_MENU = {
    EDGE_MARGIN: 8,
    RIGHT_AUTO: "auto",
    LEFT_ZERO: "0",
  };

  window.PR.DISPATCH_MODE = {
    DISPATCH: "dispatch",
    PATH: "path",
  };


  window.PR.VERDICT_FIELD = "review-verdict";

  window.PR.HTTP = {
    POST: "POST",
  };


  window.PR.QUERY_BRANCH = "branch";


  window.PR.STATUS_LETTER = {
    added: "A",
    deleted: "D",
    renamed: "R",
    modified: "M",
  };


  window.PR.P_EMPTY = "";

  window.PR.SYMBOL_LINKS = {
    ON: "on",
    OFF: "off",
  };


  window.PR.SYM_CLASS = {
    TYPE: "sym-type",
    VALUE: "sym-value",
    CALL: "sym-call",
  };


  window.PR.SYMBOL_CLASS = {
    class: "sym-type",
    interface: "sym-type",
    enum: "sym-type",
    record: "sym-type",
    struct: "sym-type",
    const: "sym-value",
    property: "sym-value",
    method: "sym-call",
  };


  window.PR.SYMBOL_CLASS_DEFAULT = "sym-call";


  window.PR.COLORIZED_LANGUAGE = {
    CSHARP: "csharp",
  };


  window.PR.UI = {
    CONTEXT_STEP: 20,
    DIFF_BLOCK_CELLS: 5,
    TOAST_MS: 2600,
    FLASH_MS: 900,
    POPOVER_WIDTH: 560,
    POPOVER_MAX_HEIGHT: 360,
    POPOVER_MARGIN: 8,
    POPOVER_OFFSET: 6,
    MAX_POPOVER_USAGES: 12,
    SIDEBAR_PREVIEW_LINES: 2,
    STORAGE_PREFIX: "pr-review:v3:",

    SETTINGS_KEY: "pr-review:settings:v1",
    OBSERVER_MARGIN: "300px",
    HYDRATION_CHUNK: 4,
    HYDRATION_DELAY_MS: 0,

    VIEWED_ANIM_MS: 160,
    SUPPRESS_CLICK_MS: 300,
    HASH_LINE_PREFIX: "L",
    THEME_STORAGE_KEY: "pr-review-theme",
    TARGET_NEW: "pr-file",
    TARGET_SELF: "_self",
    TARGET_BLANK: "_blank",
    NOOPENER: "noopener",
    DEBOUNCE_MS: 80,

    FOCUS_RETRY_MS: 60,

    SCROLL_SETTLE_MS: 450,

    SCROLL_SETTLE_TOLERANCE: 40,
  };
  window.PR.THEME = {
    DARK: "dark",
    LIGHT: "light",
  };


  window.PR.IDS = {
    FILTER_INPUT: "filter-input",
    TREE_FILTER_INPUT: "tree-filter-input",
    TOGGLE_SCOPE: "toggle-scope",
    REVIEW_BODY: "review-body",
    REVIEW_NOTE_WRAP: "review-note-wrap",
    REVIEW_NOTE_CHIPS: "review-note-chips",
    DISPATCH_SEND: "dispatch-send",
    VIEW_BAR: "diff-view-bar",
    SYM_POP: "sym-pop",
    BTN_SETTINGS: "btn-settings",
    BTN_THEME: "btn-theme",
    SETTINGS_POP: "settings-pop",
    REVIEW_STATE_TEXT: "review-state-text",
    REVIEW_STATE_DOT: "review-state",
    TAB_FILES_COUNT: "tab-files-count",
    TREE_OPEN: "set-tree-open",
    DIFF_MODE: "set-diff-mode",
    HIDE_VIEWED: "set-hide-viewed",
    COLLAPSE_VIEWED: "set-collapse-viewed",
    SYMLINKS: "set-symlinks",
    SCOPE_MODE: "scope-mode",
    SCOPE_FROM: "scope-from",
    SCOPE_TO: "scope-to",
    BRANCH_SELECT: "branch-select",
    BRANCH_HINT: "branch-hint",
    BTN_OPEN_SCOPE: "btn-open-scope",
    SCOPE_HINT: "scope-hint",
    SEARCH_INPUT: "search-input",
    SEARCH_RESULTS: "search-results",
    SEARCH_PANEL: "search-panel",
    BTN_SEARCH: "btn-search",
    BTN_SIDEBAR: "btn-sidebar",
    TREE_RESIZER: "tree-resizer",
    TREE_REVEAL: "tree-reveal",
    INLINE_HOST: "inline-file-host",
    COMMIT_PICKER: "commit-picker",
    COMMIT_PICKER_LIST: "commit-picker-list",
    COMMIT_PICKER_SAVE: "commit-picker-save",
    COMMIT_PICKER_CANCEL: "commit-picker-cancel",
    COMMIT_PICKER_CLOSE: "commit-picker-close",
    COMMIT_PICKER_COUNT: "commit-picker-count",
  };


  window.PR.SELECTORS = {
    DIFF_FILE: ".diff-file",
    DIFF_BODY: ".diff-body",
    DIFF_HEADER: ".diff-file-header",
    CODE_CELL: "td.diff-code",
    DIFF_NUM_CELL: "td.diff-num",
    GUTTER_CELL: "td.diff-gutter",
    LINE_PLUS: ".line-plus",
    TREE_ROW: ".tree-row",
    TREE_CHEVRON: ".tree-chevron",
    TREE_CHILDREN: ".tree-children",
    COMMENT_ROW: ".comment-row",
    FILE_COMMENT_BANNER: ".file-comment-banner",
    EDITOR: ".js-editor",
    VIEWED_WRAP: ".viewed-wrap",
    VIEWED_BOX: ".viewed-box",
    SELECTED_ROW: ".row-selected",
    SYM_LINK: ".sym-link",
    FLASH: "flash",
    COLLAPSED: "collapsed",
    HIDDEN: "hidden",
  };

  window.PR.HTTP = {
    POST: "POST",
    JSON: "application/json",
  };

  window.PR.KEY = {
    ESCAPE: "Escape",
  };

  window.PR.EVENT = {
    KEYDOWN: "keydown",
    MOUSEDOWN: "mousedown",
    MOUSEUP: "mouseup",
  };
})();
