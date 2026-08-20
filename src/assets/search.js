/** Project-wide search: one input, results as links into the file viewer. */
(function () {
  "use strict";

  var PR = window.PR;

  var state = {
    query: "",
    hits: [],
    open: false,
    timer: null,
  };

  PR.searchState = state;

  function panel() { return document.getElementById(PR.IDS.SEARCH_PANEL); }
  function input() { return document.getElementById(PR.IDS.SEARCH_INPUT); }
  function results() { return document.getElementById(PR.IDS.SEARCH_RESULTS); }

  PR.openSearch = function () {
    var box = panel();
    if (!box) return;

    box.hidden = false;
    state.open = true;
    var field = input();
    if (field) {
      field.focus();
      field.select();
    }
    render();
  };

  PR.closeSearch = function () {
    var box = panel();
    if (!box) return;
    box.hidden = true;
    state.open = false;
  };

  PR.toggleSearch = function () {
    if (state.open) PR.closeSearch();
    else PR.openSearch();
  };

  /** Debounced so typing does not fire one `git grep` per keystroke. */
  PR.scheduleSearch = function (query) {
    state.query = String(query || "");

    if (state.timer) clearTimeout(state.timer);
    if (state.query.trim().length < PR.SEARCH.MIN_LENGTH) {
      state.hits = [];
      render();
      return;
    }

    state.timer = setTimeout(runSearch, PR.SEARCH.DEBOUNCE_MS);
  };

  function runSearch() {
    var query = state.query;
    results().innerHTML = '<div class="search-empty muted small">Searching…</div>';

    fetch(PR.API.SEARCH + "?q=" + encodeURIComponent(query))
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (state.query !== query) return;
        // a newer query won the race
        state.hits = result && result.ok ? result.hits || [] : [];
        render();
      })
      .catch(function () {
        state.hits = [];
        render();
      });
  }

  function render() {
    var box = results();
    if (!box) return;

    if (state.query.trim().length < PR.SEARCH.MIN_LENGTH) {
      box.innerHTML = '<div class="search-empty muted small">' + PR.escapeHtml(PR.MESSAGES.SEARCH_EMPTY) + "</div>";
      return;
    }
    if (!state.hits.length) {
      box.innerHTML = '<div class="search-empty muted small">' + PR.escapeHtml(PR.MESSAGES.SEARCH_NONE) + "</div>";
      return;
    }

    box.innerHTML = state.hits.map(function (hit, index) {
      return '<a class="search-hit" href="' + PR.fileUrl(hit.path, hit.line) + '" data-index="' + index + '">' +
        '<span class="search-hit-path">' + PR.pathHtml(hit.path) + "</span>" +
        '<span class="search-hit-line">' + hit.line + "</span>" +
        '<span class="search-hit-text">' + highlight(hit.text, state.query) + "</span>" +
      "</a>";
    }).join("");
  }

  /** Marks the matched text inside the preview line, and trims long indentation. */
  function highlight(text, query) {
    var trimmed = String(text).replace(/^\s+/, "");
    var needle = String(query).trim();
    if (!needle) return PR.escapeHtml(trimmed);

    var index = trimmed.toLowerCase().indexOf(needle.toLowerCase());
    if (index < 0) return PR.escapeHtml(trimmed);

    return PR.escapeHtml(trimmed.slice(0, index)) +
      "<mark>" + PR.escapeHtml(trimmed.slice(index, index + needle.length)) + "</mark>" +
      PR.escapeHtml(trimmed.slice(index + needle.length));
  }

  /** Closes the panel on outside clicks and on Escape. */
  PR.bindSearch = function () {
    var button = document.getElementById(PR.IDS.BTN_SEARCH);
    if (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        PR.toggleSearch();
      });
    }

    var field = input();
    if (field) {
      field.addEventListener("input", function () { PR.scheduleSearch(field.value); });
      field.addEventListener("keydown", function (event) {
        if (event.key === "Escape") { event.preventDefault(); PR.closeSearch(); }
      });
    }

    var box = panel();
    if (box) {
      box.addEventListener("click", function (event) {
        var hit = event.target.closest(".search-hit");
        if (!hit) return;

        var index = Number(hit.dataset.index);
        var data = state.hits[index];
        if (!data) return;

        event.preventDefault();
        PR.closeSearch();
        PR.openSearchHit(data);
      });
    }

    document.addEventListener("click", function (event) {
      if (event.target.closest("#" + PR.IDS.SEARCH_PANEL) || event.target.closest("#" + PR.IDS.BTN_SEARCH)) return;
      if (state.open) PR.closeSearch();
    });
  };

  /** A hit inside the current diff scrolls there in this tab, like the file tree; anything else… */
  PR.openSearchHit = function (hit) {
    if (PR.state.changedPaths.has(hit.path) && PR.revealFile(hit.path)) return;
    window.location.href = PR.fileUrl(hit.path, hit.line);
  };
})();
