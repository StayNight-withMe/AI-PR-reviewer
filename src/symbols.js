import { git } from "./git.js";
import { readFilesForHighlight } from "./fileview.js";
import { GIT, P, SYMBOL_INDEX, SYMBOL_KIND } from "./config.js";
/** Go-to-definition / find-usages index for C# (plus a few other languages). */
const SKIP_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svg",
  "pdf", "zip", "gz", "tar", "7z", "rar", "dll", "exe", "so", "pdb",
  "woff", "woff2", "ttf", "otf", "mp3", "mp4", "mov", "wav", "nupkg", "lock",
]);
/** Language keywords and ubiquitous BCL names: never turned into links. */
const NEVER_LINK = new Set([
  "using", "namespace", "class", "struct", "interface", "enum", "record", "delegate", "event",
  "public", "private", "protected", "internal", "static", "readonly", "const", "sealed",
  "abstract", "virtual", "override", "partial", "async", "await", "extern", "unsafe", "fixed",
  "new", "return", "if", "else", "for", "foreach", "while", "do", "switch", "case", "default",
  "break", "continue", "goto", "try", "catch", "finally", "throw", "is", "as", "in", "out",
  "ref", "params", "this", "base", "null", "true", "false", "var", "dynamic", "object",
  "string", "int", "long", "short", "byte", "sbyte", "uint", "ulong", "ushort", "float",
  "double", "decimal", "bool", "char", "void", "get", "set", "init", "value", "where",
  "select", "from", "let", "orderby", "group", "into", "join", "on", "equals", "by",
  "when", "and", "or", "not", "with", "global", "nameof", "typeof", "sizeof",
  "checked", "unchecked", "lock", "yield", "stackalloc", "implicit", "explicit", "operator",
  "required", "file", "scoped",
  "System", "Task", "String", "Object", "Math", "Console", "Exception", "List", "Dictionary",
  "IEnumerable", "ICollection", "IList", "Guid", "DateTime", "TimeSpan", "CancellationToken",
  "ConfigureAwait", "ToString", "Equals", "GetHashCode", "GetType", "Add", "Remove", "Count",
]);
const MODIFIERS = "(?:public|internal|private|protected|sealed|abstract|static|partial|readonly|virtual|override|async|extern|new|required|\\s)";
const PATTERNS = [
  { kind: SYMBOL_KIND.CLASS, re: new RegExp(`^\\s*${MODIFIERS}*\\bclass\\s+([A-Za-z_]\\w*)`, "gm") },
  { kind: SYMBOL_KIND.INTERFACE, re: new RegExp(`^\\s*${MODIFIERS}*\\binterface\\s+([A-Za-z_]\\w*)`, "gm") },
  { kind: SYMBOL_KIND.ENUM, re: new RegExp(`^\\s*${MODIFIERS}*\\benum\\s+([A-Za-z_]\\w*)`, "gm") },
  { kind: SYMBOL_KIND.RECORD, re: new RegExp(`^\\s*${MODIFIERS}*\\brecord\\s+([A-Za-z_]\\w*)`, "gm") },
  { kind: SYMBOL_KIND.STRUCT, re: new RegExp(`^\\s*${MODIFIERS}*\\bstruct\\s+([A-Za-z_]\\w*)`, "gm") },
  { kind: SYMBOL_KIND.CONST, re: new RegExp(`^\\s*${MODIFIERS}*\\bconst\\s+\\w[\\w<>?\\[\\],\\s.]*?\\s+([A-Za-z_]\\w*)\\s*=`, "gm") },
  { kind: SYMBOL_KIND.PROPERTY, re: new RegExp(`^\\s*${MODIFIERS}+[\\w<>?\\[\\],.]+\\s+([A-Za-z_]\\w*)\\s*(?:\\{\\s*get|=>)`, "gm") },
  { kind: SYMBOL_KIND.METHOD, re: new RegExp(`^\\s*${MODIFIERS}+[\\w<>?\\[\\],.]+\\s+([A-Za-z_]\\w*)\\s*\\(`, "gm") },
];

const INHERITS_RE = new RegExp(
  `^\\s*${MODIFIERS}*\\b(class|struct|interface|record)\\s+([A-Za-z_]\\w*)[^;{(\\n]*?(?::\\s*([^{;\\n]+))?(?=[\\n{])`,
  "gm",
);

export async function buildSymbolIndex(repoRoot) {
  const paths = await listScannableFiles(repoRoot);
  // tree: new files are not in HEAD, and edited files have moved declarations.
  const files = await readFilesForHighlight(repoRoot, paths);
  const declarations = new Map();
  const implementations = new Map();

  for (const path of paths) {
    const text = files[path]?.lines?.join(P.NEWLINE);
    if (!text || text.length > SYMBOL_INDEX.MAX_FILE_BYTES) continue;
    scanFile(declarations, implementations, path, text);
  }

  const symbols = buildSymbols(declarations);

  return {
    symbols: symbols.symbols,
    definitions: symbols.definitions,
    implementations: buildImplementations(implementations),
    // Usage counts come from the same scan, so they include untracked files and
    // are already on disk — no per-symbol `git grep` on click.
    usages: buildUsages(paths, files, symbols.symbols),
  };
}

/** Counts every occurrence of each known symbol, grouped by file. */
function buildUsages(paths, files, symbols) {
  const names = new Set(Object.keys(symbols));
  const usages = {};

  for (const path of paths) {
    const lines = files[path]?.lines;
    if (!lines) continue;

    for (let index = P.ZERO; index < lines.length; index += P.ONE) {
      const lineNo = index + P.ONE;
      for (const match of lines[index].matchAll(SYMBOL_INDEX.WORD)) {
        const name = match[P.ZERO];
        if (!names.has(name)) continue;

        const byFile = usages[name] ?? (usages[name] = []);
        let entry = byFile[byFile.length - P.ONE];
        if (!entry || entry.path !== path) {
          entry = { path, count: P.ZERO, firstLine: lineNo, lines: [] };
          byFile.push(entry);
        }

        entry.count += P.ONE;
        if (entry.lines.length < SYMBOL_INDEX.MAX_USAGE_LINES) entry.lines.push(lineNo);
      }
    }
  }

  return usages;
}

async function listScannableFiles(repoRoot) {
  const [tracked, untracked] = await Promise.all([
    git(repoRoot, GIT.ARGS.LS_FILES),
    git(repoRoot, GIT.ARGS.LS_FILES_UNTRACKED),
  ]);
  const lines = [tracked, untracked]
    .filter((result) => result.ok)
    .flatMap((result) => result.stdout.split(P.NEWLINE));

  return Array.from(new Set(lines))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => !path.startsWith(`${GIT.ARTIFACT_DIR}${P.SLASH}`))
    .filter((path) => !path.startsWith(SYMBOL_INDEX.IGNORED_DIR))
    .filter((path) => !SKIP_EXTENSIONS.has(extensionOf(path)))
    .slice(P.ZERO, SYMBOL_INDEX.MAX_FILES);
}

function buildSymbols(declarations) {
  const symbols = {};
  const definitions = {};

  for (const [name, entries] of declarations) {
    if (NEVER_LINK.has(name)) continue;
    if (entries[P.ZERO].kind === SYMBOL_KIND.METHOD && SYMBOL_INDEX.LOWER_START.test(name)) continue;
    // Duplicated names (the same class in several services) are still real
    // symbols: keep every definition so the client can pick the nearest one.
    definitions[name] = entries.map((entry) => ({ path: entry.path, line: entry.line, kind: entry.kind }));
    symbols[name] = definitions[name][P.ZERO];
  }

  return { symbols, definitions };
}

function buildImplementations(implementations) {
  const result = {};
  for (const [name, entries] of implementations) {
    if (NEVER_LINK.has(name) || !entries.length) continue;
    result[name] = entries;
  }
  return result;
}

function scanFile(declarations, implementations, path, text) {
  const lines = text.split(P.NEWLINE);

  for (const { kind, re } of PATTERNS) {
    re.lastIndex = P.ZERO;
    let match;

    while ((match = re.exec(text)) !== null) {
      const name = match[P.ONE];
      if (!name || name.length < SYMBOL_INDEX.MIN_NAME_LENGTH) continue;
      if (NEVER_LINK.has(name)) continue;

      const line = lineNumberAt(text, match.index);
      if (isCommentOrString(lines[line - P.ONE] ?? P.EMPTY)) continue;

      addUnique(declarations, name, { path, line, kind });
    }
  }

  INHERITS_RE.lastIndex = P.ZERO;
  let inherit;

  while ((inherit = INHERITS_RE.exec(text)) !== null) {
    const declKind = inherit[P.ONE];
    const declName = inherit[P.TWO];
    const bases = splitBaseList(inherit[P.THREE]);
    if (!bases.length) continue;

    const line = lineNumberAt(text, inherit.index);
    for (const base of bases) {
      addUnique(implementations, base, { path, line, name: declName, kind: declKind });
    }
  }
}

function addUnique(map, key, entry) {
  const list = map.get(key) ?? [];
  if (list.some((item) => item.path === entry.path && item.line === entry.line)) return;
  list.push(entry);
  map.set(key, list);
}

function lineNumberAt(text, index) {
  let line = P.ONE;
  for (let i = P.ZERO; i < index; i += P.ONE) {
    if (text.charCodeAt(i) === SYMBOL_INDEX.NEWLINE_CODE) line += P.ONE;
  }
  return line;
}

function splitBaseList(raw) {
  return String(raw || P.EMPTY)
    .split(P.COMMA)
    .map((part) => part.trim().replace(SYMBOL_INDEX.GENERIC_SUFFIX, P.EMPTY).replace(SYMBOL_INDEX.WHERE_SUFFIX, P.EMPTY).trim())
    .map((part) => part.split(/\s+/).pop())
    .filter((part) => SYMBOL_INDEX.IDENTIFIER.test(part) && !NEVER_LINK.has(part));
}

function extensionOf(path) {
  return path.split(P.DOT).pop()?.toLowerCase() ?? P.EMPTY;
}

function isCommentOrString(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith(SYMBOL_INDEX.COMMENT_LINE) || trimmed.startsWith(SYMBOL_INDEX.COMMENT_STAR) || trimmed.startsWith(SYMBOL_INDEX.COMMENT_BLOCK)) {
    return true;
  }
  const quotes = (line.match(/"/g) || []).length;
  return quotes % P.TWO === P.ONE;
}

/** Fast usage counter: one `git grep` over the working tree, grouped by file. */
export async function findSymbolUsages(repoRoot, name) {
  if (!name || !SYMBOL_INDEX.IDENTIFIER_SIMPLE.test(name)) return [];

  const { ok, stdout } = await git(repoRoot, [
    ...GIT.ARGS.GREP, SYMBOL_INDEX.GREP_NAME_FLAG, name, SYMBOL_INDEX.GREP_PATH_FLAG, GIT.FLAGS.DOT, ...GIT.EXCLUDE_PATHSPEC,
  ]);
  if (!ok || !stdout) return [];

  const byFile = new Map();

  for (const line of stdout.split(P.NEWLINE)) {
    if (!line) continue;

    const first = line.indexOf(P.COLON);
    if (first === P.NEG_ONE) continue;
    const second = line.indexOf(P.COLON, first + P.ONE);
    if (second === P.NEG_ONE) continue;

    const path = line.slice(P.ZERO, first);
    const lineNo = Number(line.slice(first + P.ONE, second));
    if (!Number.isFinite(lineNo)) continue;

    const entry = byFile.get(path) ?? { path, count: P.ZERO, firstLine: lineNo };
    entry.count += P.ONE;
    byFile.set(path, entry);
  }

  return Array.from(byFile.values())
    .sort((a, b) => b.count - a.count)
    .slice(P.ZERO, SYMBOL_INDEX.MAX_USAGE_FILES);
}
