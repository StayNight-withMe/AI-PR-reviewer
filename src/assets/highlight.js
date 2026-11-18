/** Syntax highlighting + safe symbol linkification. */
(function () {
  "use strict";

  var PR = window.PR;

  /** Examines with an unknown name may answer with an inherited member; callers need an array. */
  function listOf(value) {
    return Array.isArray(value) ? value : [];
  }

  /** hljs classes whose text must never become a link (keywords, strings, comments...). */
  var SKIP_HLJS = /hljs-(keyword|string|comment|number|literal|meta|attr|built_in|symbol|bullet|link)/;

  /** Qualification lines never contain symbol references. */
  var USING_OR_NAMESPACE = /^\s*(using|namespace)\b/;

  /** Identifier + context rules used to colour non-symbol code. */
  var IDENTIFIER = /\b[A-Za-z_]\w*\b/g;
  var CALL_SUFFIX = /^\s*\(/;

  PR.highlightLines = function (text, language) {
    var raw;
    if (window.hljs && language && language !== "plaintext") {
      try {
        raw = window.hljs.getLanguage(language)
          ? window.hljs.highlight(text, { language: language, ignoreIllegals: true }).value
          : window.hljs.highlightAuto(text).value;
      } catch (e) {
        try { raw = window.hljs.highlightAuto(text).value; } catch (e2) { raw = PR.escapeHtml(text); }
      }
    } else {
      raw = PR.escapeHtml(text);
    }
    return splitSpans(raw);
  };

  /** Splits highlighted HTML into lines, re-opening spans so each line is valid HTML. */
  function splitSpans(html) {
    var out = [], open = [], buf = "", i = 0;

    while (i < html.length) {
      if (html.startsWith("<span", i)) {
        var end = html.indexOf(">", i);
        if (end === -1) { buf += PR.escapeHtml(html.slice(i)); break; }
        var tag = html.slice(i, end + 1);
        open.push(tag);
        buf += tag;
        i = end + 1;
      } else if (html.startsWith("</span>", i)) {
        open.pop();
        buf += "</span>";
        i += 7;
      } else if (html[i] === "\n") {
        out.push(buf + "</span>".repeat(open.length));
        buf = open.join("");
        i += 1;
      } else {
        buf += html[i];
        i += 1;
      }
    }
    out.push(buf + "</span>".repeat(open.length));
    return out;
  }

  /** Fetches + caches file text and its highlighted lines. */
  PR.getFileData = function (path) {
    var state = PR.state;
    if (state.cache[path]) return Promise.resolve(state.cache[path]);

    return fetch(PR.API.FILE + "?path=" + encodeURIComponent(path))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.lines) {
          state.cache[path] = data;
          state.highlightCache[path] = PR.highlightLines(data.lines.join("\n"), data.language);
        }
        return data;
      })
      .catch(function () { return null; });
  };

  PR.highlightedLine = function (path, lineNo, fallbackText, language) {
    var cache = PR.state.highlightCache[path];
    if (cache && cache[lineNo - 1] !== undefined) return cache[lineNo - 1];
    return PR.escapeHtml(fallbackText) || " ";
  };

  /** Applies highlighting to every code cell inside a container. */
  PR.highlightIn = function (root, path, language) {
    var cells = root.querySelectorAll("td.diff-code");
    for (var i = 0; i < cells.length; i += 1) {
      var cell = cells[i];
      if (cell.dataset.highlighted !== "1") {
        var kind = cell.dataset.kind;
        var isLeft = kind === "del" || kind === "left";
        var lineNo = parseInt(isLeft ? cell.dataset.old : cell.dataset.new, 10);
        if (!lineNo) continue;

        var text = cell.textContent;
        cell.innerHTML = isLeft
          ? (PR.highlightLines(text, language)[0] || " ")
          : PR.highlightedLine(path, lineNo, text, language);
        cell.dataset.highlighted = "1";
      }
      PR.linkifyCell(cell);
      PR.colorizeCell(cell, language);
      PR.applyWordMark(cell);
    }
  };

  /** Wraps the changed character range of a modified line in a stronger background, like GitHub's… */
  PR.applyWordMark = function (cell) {
    var start = parseInt(cell.dataset.wmStart, 10);
    var end = parseInt(cell.dataset.wmEnd, 10);
    if (isNaN(start) || isNaN(end) || end <= start) return;
    if (cell.dataset.wmDone === "1") return;
    cell.dataset.wmDone = "1";

    var walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var node;
    var total = 0;
    while ((node = walker.nextNode())) {
      nodes.push({ node: node, start: total, end: total + node.nodeValue.length });
      total += node.nodeValue.length;
    }
    if (end > total) end = total;

    nodes.forEach(function (entry) {
      var from = Math.max(start, entry.start);
      var to = Math.min(end, entry.end);
      if (to <= from) return;

      var value = entry.node.nodeValue;
      var localFrom = from - entry.start;
      var localTo = to - entry.start;

      var marked = document.createElement("span");
      marked.className = "wm";
      marked.textContent = value.slice(localFrom, localTo);

      var fragment = document.createDocumentFragment();
      if (localFrom > 0) fragment.appendChild(document.createTextNode(value.slice(0, localFrom)));
      fragment.appendChild(marked);
      if (localTo < value.length) fragment.appendChild(document.createTextNode(value.slice(localTo)));

      entry.node.parentNode.replaceChild(fragment, entry.node);
    });
  };

  /** Wraps known identifiers in links, walking only real text nodes so markup never breaks. */
  PR.linkifyCell = function (cell) {
    if (cell.dataset.linked === "1") return;
    cell.dataset.linked = "1";
    // `using`/`namespace` lines are qualified namespace paths, not symbol references; linking their…
    if (USING_OR_NAMESPACE.test(cell.textContent)) return;

    var walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, null);
    var textNodes = [];
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentNode;
      if (parent && SKIP_HLJS.test(parent.className || "")) continue;
      textNodes.push(node);
    }

    textNodes.forEach(replaceIdentifiers);
  };

  function replaceIdentifiers(textNode) {
    var value = textNode.nodeValue;
    if (!value || value.length < 3) return;

    var re = /\b([A-Za-z_]\w{2,})\b/g;
    var fragment = null;
    var last = 0;
    var match;

    while ((match = re.exec(value)) !== null) {
      var name = match[1];
      var target = PR.SYMBOLS[name] || (PR.IMPLS[name] && PR.IMPLS[name][0]);
      if (!target) continue;
      // Only symbols that are actually referenced somewhere become links; a name that only exists at…
      if (!isUsed(name)) continue;

      if (!fragment) fragment = document.createDocumentFragment();
      if (match.index > last) fragment.appendChild(document.createTextNode(value.slice(last, match.index)));

      var colour = identifierClass(value, match.index, name);
      fragment.appendChild(buildSymbolLink(name, target, colour));
      last = match.index + name.length;
    }

    if (!fragment) return;
    if (last < value.length) fragment.appendChild(document.createTextNode(value.slice(last)));
    textNode.parentNode.replaceChild(fragment, textNode);
  }

  /** Used = appears at least once outside its own declaration line. */
  function isUsed(name) {
    var usages = PR.USAGES[name];
    if (!Array.isArray(usages) || !usages.length) return true;
    // unknown: keep the old behaviour
    var total = usages.reduce(function (sum, usage) { return sum + usage.count; }, 0);
    return total > 1 || usages.length > 1;
  }

  /** GitHub's C# colouring: keywords/strings/comments/literals come from hljs, method declarations… */
  PR.colorizeCell = function (cell, language) {
    if (language !== PR.COLORIZED_LANGUAGE.CSHARP) return;
    if (cell.dataset.colored === "1") return;
    cell.dataset.colored = "1";

    neutraliseTypeTitles(cell);

    var walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentNode;
      if (!parent) continue;
      if (SKIP_HLJS.test(parent.className || "")) continue;
      if (parent.closest && parent.closest(PR.SELECTORS.SYM_LINK)) continue;
      nodes.push(node);
    }

    nodes.forEach(colorizeNode);
  };

  /** Class/struct/enum names must not be purple or salmon in a C# diff. */
  function neutraliseTypeTitles(cell) {
    var titles = cell.querySelectorAll(".hljs-title, .hljs-subst");
    for (var i = 0; i < titles.length; i += 1) titles[i].classList.add("hljs-plain");
  }

  function colorizeNode(textNode) {
    var value = textNode.nodeValue;
    if (!value) return;

    var fragment = null;
    var last = 0;
    var match;
    IDENTIFIER.lastIndex = 0;

    while ((match = IDENTIFIER.exec(value)) !== null) {
      var className = identifierClass(value, match.index, match[0]);
      if (!className) continue;

      if (!fragment) fragment = document.createDocumentFragment();
      if (match.index > last) fragment.appendChild(document.createTextNode(value.slice(last, match.index)));

      var span = document.createElement("span");
      span.className = className;
      span.textContent = match[0];
      fragment.appendChild(span);
      last = match.index + match[0].length;
    }

    if (!fragment) return;
    if (last < value.length) fragment.appendChild(document.createTextNode(value.slice(last)));
    textNode.parentNode.replaceChild(fragment, textNode);
  }

  /** Only a call gets a colour. */
  function identifierClass(value, index, word) {
    var after = value.slice(index + word.length);
    if (CALL_SUFFIX.test(after)) return PR.SYM_CLASS.CALL;
    return null;
  }

  function buildSymbolLink(name, target, colourClass) {
    var a = document.createElement("a");
    // Links must keep the token's own colour; GitHub underlines code links instead of recolouring…
    a.className = "sym-link" + (colourClass ? " " + colourClass : "");
    a.dataset.name = name;
    a.setAttribute("href", PR.fileUrl(target.path, target.line));

    var usages = PR.USAGES[name];
    var list = Array.isArray(usages) ? usages : [];
    var total = list.reduce(function (sum, usage) { return sum + usage.count; }, 0);
    a.setAttribute("title", total
      ? name + " — used " + total + " time(s) in " + list.length + " file(s)"
      : name + " — " + (target.kind || "symbol") + " " + target.path + ":" + target.line);
    a.textContent = name;
    return a;
  }

  /** ---------------------------- usage popover ----------------------------- */
  PR.showSymbolPopover = function (anchor, name) {
    PR.hideSymbolPopover();

    var def = PR.SYMBOLS[name];
    var impls = listOf(PR.IMPLS[name]);
    var target = PR.state.settings.treeOpen === PR.TREE_OPEN.NEW ? PR.UI.TARGET_NEW : PR.UI.TARGET_SELF;

    var pop = document.createElement("div");
    pop.className = "sym-pop";
    pop.id = PR.IDS.SYM_POP;
    pop.dataset.currentPath = PR.state.currentPath || PR.P_EMPTY;
    pop.innerHTML =
      '<div class="sym-pop-head"><b>' + PR.escapeHtml(name) + "</b>" +
        (def ? '<span class="sym-kind">' + PR.escapeHtml(def.kind) + "</span>" : "") +
        '<span class="spacer"></span><button class="gh-btn gh-btn-sm ghost js-close-sym">×</button>' +
      "</div>" +
      '<div class="sym-pop-body">' +
        (def ? '<a class="sym-def" href="' + PR.fileUrl(def.path, def.line) + '" target="' + target + '">' +
          '<span class="sym-path">' + PR.pathHtml(def.path) + ":" + def.line + "</span>" +
          '<span class="sym-kind">definition</span></a>' : "") +
        (impls.length ? '<div class="sym-sub">Used / implemented in ' + impls.length + " place(s)</div>" +
          impls.map(function (usage) {
            return '<a class="sym-use" href="' + PR.fileUrl(usage.path, usage.line) + '" target="' + target + '">' +
              '<span class="sym-path">' + PR.pathHtml(usage.path) + ":" + usage.line + "</span>" +
              '<span class="sym-kind">' + PR.escapeHtml(usage.kind || "") + "</span></a>";
          }).join("") : "") +
        '<div class="sym-usage js-usage muted small">Counting usages…</div>' +
      "</div>";

    document.body.appendChild(pop);
    positionPopover(pop, anchor);

    pop.querySelector(".js-close-sym").addEventListener("click", PR.hideSymbolPopover);
    loadUsages(pop, name);
  };

  function positionPopover(pop, anchor) {
    pop.style.position = "fixed";

    var rect = anchor.getBoundingClientRect();
    var margin = PR.UI.POPOVER_MARGIN;
    var offset = PR.UI.POPOVER_OFFSET;
    var width = Math.min(PR.UI.POPOVER_WIDTH, window.innerWidth - margin * 2);
    // Prefer below the anchor; flip above when there is no room, so the popover never sits on top of…
    var spaceBelow = window.innerHeight - rect.bottom;
    var height = Math.min(pop.offsetHeight || PR.UI.POPOVER_MAX_HEIGHT, PR.UI.POPOVER_MAX_HEIGHT);
    var top = spaceBelow > height + offset ? rect.bottom + offset : Math.max(margin, rect.top - height - offset);

    var left = Math.min(rect.left, window.innerWidth - width - margin);

    pop.style.width = width + "px";
    pop.style.top = Math.round(top) + "px";
    pop.style.left = Math.round(Math.max(margin, left)) + "px";
  }

  /** Usage list from the precomputed index: current file first, others after. */
  function loadUsages(pop, name) {
    var el = pop.querySelector(".js-usage");
    if (!el) return;

    var usages = listOf(PR.USAGES[name]);
    var current = pop.dataset.currentPath || PR.P_EMPTY;

    if (!usages.length) {
      el.textContent = "No usages found.";
      return;
    }

    var others = usages.filter(function (usage) { return usage.path !== current; });
    var total = others.reduce(function (sum, usage) { return sum + usage.count; }, 0);

    if (!others.length) {
      el.textContent = "Used only in this file.";
      return;
    }

    var target = PR.state.settings.treeOpen === PR.TREE_OPEN.NEW ? PR.UI.TARGET_NEW : PR.UI.TARGET_SELF;
    el.innerHTML = "<b>" + total + "</b> usage(s) in " + others.length + " other file(s):" +
      others.slice(0, PR.UI.MAX_POPOVER_USAGES).map(function (usage) {
        return '<a class="sym-use" href="' + PR.fileUrl(usage.path, usage.firstLine) + '" target="' + target + '">' +
          '<span class="sym-path">' + PR.pathHtml(usage.path) + (usage.firstLine ? ":" + usage.firstLine : "") + "</span>" +
          '<span class="sym-kind">' + usage.count + "×</span></a>";
      }).join("");
  }

  PR.hideSymbolPopover = function () {
    var pop = document.getElementById(PR.IDS.SYM_POP);
    if (pop) pop.remove();
  };
})();
