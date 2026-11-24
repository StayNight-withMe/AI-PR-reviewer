
(function () {
  "use strict";


  var MIN_LENGTH = 2;
  var MAX_LENGTH = 120;
  var MARK_CLASS = "occurrence-hl";

  var CODE_CELL = "td.diff-code, td.v-code";

  var FILE_SCOPE = ".diff-file, #file-viewer";

  var IGNORED = ".js-editor, input, textarea, [contenteditable='true']";

  var activeText = null;


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


  function isIgnored(element) {
    return Boolean(element.closest && element.closest(IGNORED));
  }


  function elementOf(node) {
    if (!node) return null;
    return node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  }


  function refresh() {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      clear();
      return;
    }

    var text = selection.toString();

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

    if (activeText === trimmed && scope.querySelector("mark." + MARK_CLASS)) return;

    clear();
    activeText = trimmed;
    markScope(scope, trimmed);
  }


  function markScope(scope, text) {
    var cells = scope.querySelectorAll(CODE_CELL);
    for (var index = 0; index < cells.length; index += 1) {
      markCell(cells[index], text);
    }
  }


  function markCell(cell, text) {
    var walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var node = walker.nextNode();

    while (node) {
      var value = node.nodeValue || "";

      if (value.indexOf(text) !== -1 && !(node.parentNode && node.parentNode.classList.contains(MARK_CLASS))) {
        nodes.push(node);
      }
      node = walker.nextNode();
    }

    for (var index = 0; index < nodes.length; index += 1) {
      wrapMatches(nodes[index], text);
    }
  }


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

  function schedule() {
    setTimeout(refresh, 0);
  }

  document.addEventListener("mouseup", schedule, true);
  document.addEventListener("keyup", function (event) {

    if (event.shiftKey || event.key === "Escape") schedule();
  }, true);
  document.addEventListener("mousedown", function () {

    clear();
  }, true);


  window.PR = window.PR || {};
  window.PR.Occurrences = {
    refresh: refresh,
    clear: clear,
  };
})();
