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
