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
