/** Highlight every occurrence of the selected text inside the same file. */
(function () {
  "use strict";

  /** Only sensible selections are highlighted. */
  var MIN_LENGTH = 2;
  var MAX_LENGTH = 120;
  var MARK_CLASS = "occurrence-hl";
  /** A code cell of the diff, or of the standalone viewer. */
  var CODE_CELL = "td.diff-code, td.v-code";
  /** The container a selection is scoped to: one file section, or the viewer. */
  var FILE_SCOPE = ".diff-file, #file-viewer";
  /** Places where a text selection must not trigger the highlight. */
  var IGNORED = ".js-editor, input, textarea, [contenteditable='true']";

  var activeText = null;

  /** Removes every occurrence mark and restores the original text nodes. */
  function clear() {
    activeText = null;

    var marks = document.querySelectorAll("mark." + MARK_CLASS);
    for (var index = 0; index < marks.length; index += 1) {
      var mark = marks[index];
      var parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
      parent.normalize();
    }
  }

  /** True when the node sits in something that must not be highlighted. */
  function isIgnored(element) {
    return Boolean(element.closest && element.closest(IGNORED));
  }

  /** The element an anchor/selection node belongs to. */
  function elementOf(node) {
    if (!node) return null;
    return node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  }

  /** Reads the current selection and highlights its occurrences. */
  function refresh() {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      clear();
      return;
    }

    var text = selection.toString();
    // A multi-line selection is not "a word"; highlighting it is guesswork.
    if (!text || text.indexOf("\n") !== -1) {
      clear();
      return;
    }

    var trimmed = text.trim();
    if (trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH) {
      clear();
      return;
    }

    var element = elementOf(selection.anchorNode);
    if (!element || isIgnored(element)) {
      clear();
      return;
    }

    var cell = element.closest(CODE_CELL);
    var scope = cell && cell.closest(FILE_SCOPE);
    if (!scope || !scope.contains(cell)) {
      clear();
      return;
    }
    // Re-selecting the same word must not rebuild its marks needlessly.
    if (activeText === trimmed && scope.querySelector("mark." + MARK_CLASS)) return;

    clear();
    activeText = trimmed;
    markScope(scope, trimmed);
  }

  /** Marks every match of `text` inside one file scope. */
  function markScope(scope, text) {
    var cells = scope.querySelectorAll(CODE_CELL);
    for (var index = 0; index < cells.length; index += 1) {
      markCell(cells[index], text);
    }
  }

  /** Marks the matches inside one code cell, leaving its spans untouched. */
  function markCell(cell, text) {
    var walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var node = walker.nextNode();

    while (node) {
      var value = node.nodeValue || "";
      // A mark that is already there is skipped: its text was just inserted.
      if (value.indexOf(text) !== -1 && !(node.parentNode && node.parentNode.classList.contains(MARK_CLASS))) {
        nodes.push(node);
      }
      node = walker.nextNode();
    }

    for (var index = 0; index < nodes.length; index += 1) {
      wrapMatches(nodes[index], text);
    }
  }

  /** Splits a text node and wraps each match in a mark element. */
  function wrapMatches(textNode, text) {
    var value = textNode.nodeValue || "";
    var at = value.indexOf(text);
    if (at === -1) return;

    var fragment = document.createDocumentFragment();
    var last = 0;

    while (at !== -1) {
      if (at > last) fragment.appendChild(document.createTextNode(value.slice(last, at)));

      var mark = document.createElement("mark");
      mark.className = MARK_CLASS;
      mark.textContent = text;
      fragment.appendChild(mark);

      last = at + text.length;
      at = value.indexOf(text, last);
    }

    if (last < value.length) fragment.appendChild(document.createTextNode(value.slice(last)));
    if (textNode.parentNode) textNode.parentNode.replaceChild(fragment, textNode);
  }
  // A new gesture ends the old selection; re-evaluate once it has settled.
  function schedule() {
    setTimeout(refresh, 0);
  }

  document.addEventListener("mouseup", schedule, true);
  document.addEventListener("keyup", function (event) {
    // Only selection-moving keys; typing in the filter must not clear a view.
    if (event.shiftKey || event.key === "Escape") schedule();
  }, true);
  document.addEventListener("mousedown", function () {
    // Start each gesture from a clean slate: marks left in the DOM would be dragged over and…
    clear();
  }, true);

  /** Exposed for tests and for callers that re-render a file section. */
  window.PR = window.PR || {};
  window.PR.Occurrences = {
    refresh: refresh,
    clear: clear,
  };
})();
