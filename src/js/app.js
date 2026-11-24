// MDReader — the window: tabs, outline sidebar, toolbar, find, preferences and commands.
(function () {
  "use strict";

  const T = window.__TAURI__;
  const invoke = T ? T.core.invoke : () => Promise.reject(new Error("Not running inside MDReader."));
  const appWindow = T ? T.window.getCurrentWindow() : null;
  const isMac = /Mac/.test(navigator.platform || navigator.userAgent);

  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const reader = $("reader"), progress = $("progress"), welcome = $("welcome");
  const outline = $("outline"), outlineEmpty = $("outline-empty");
  const tabList = $("tab-list"), tabsBar = $("tabs");
  const findBox = $("find"), findInput = $("find-input"), findCount = $("find-count");
  const menuLayer = $("menu-layer");

  let info = { platform: isMac ? "macos" : "windows", home: "" };

  // ---------- preferences ----------

  const FONT = { def: 17, min: 12, max: 30 };
  const WIDTHS = [
    { id: "narrow", name: "Narrow", measure: "38rem" },
    { id: "medium", name: "Medium", measure: "46rem" },
    { id: "wide", name: "Wide", measure: "62rem" },
    { id: "full", name: "Fit Window", measure: "none" }
  ];
  const TYPEFACES = [
    { id: "sans", name: isMac ? "San Francisco" : "Sans Serif" },
    { id: "serif", name: isMac ? "New York" : "Serif" }
  ];
  const DEFAULTS = { theme: Themes.DEFAULT_ID, pane: "theme", typeface: "sans", fontSize: FONT.def, width: "medium", showTOC: true, sidebarWidth: 250 };

  let prefs = Object.assign({}, DEFAULTS, (() => { try { return JSON.parse(localStorage.getItem("mdreader.prefs")) || {}; } catch (_) { return {}; } })());

  function setPref(key, value) {
    prefs[key] = value;
    localStorage.setItem("mdreader.prefs", JSON.stringify(prefs));
    applyPrefs(key);
  }

  let appliedVars = [];

  function applyPrefs(changed) {
    const appTheme = Themes.theme(prefs.theme);
    const page = Themes.pageArgs(Themes.pageTheme(prefs.pane, appTheme));

    // The reading pane.
    reader.dataset.theme = page.theme;
    for (const name of appliedVars) reader.style.removeProperty(name);
    appliedVars = [];
    for (const [name, value] of Object.entries(page.vars || {})) { reader.style.setProperty(name, value); appliedVars.push(name); }
    reader.toggleAttribute("data-dark", !!page.dark);
    reader.dataset.typeface = prefs.typeface;
    reader.style.setProperty("--font-size", prefs.fontSize + "px");
    reader.style.setProperty("--measure", (WIDTHS.find(w => w.id === prefs.width) || WIDTHS[1]).measure);

    // The window chrome follows the app theme.
    const p = appTheme.palette;
    root.dataset.chrome = p ? "custom" : appTheme.css;
    for (const [name, value] of [["--ui-base", p && p.background], ["--ui-text", p && p.foreground], ["--ui-accent", p && p.accent]]) {
      if (value) root.style.setProperty(name, value); else root.style.removeProperty(name);
    }
    root.toggleAttribute("data-chrome-dark", !!(p && p.isDark));
    const dark = Themes.isDark(appTheme);
    if (appWindow) appWindow.setTheme(dark === null ? null : dark ? "dark" : "light").catch(() => {});

    document.body.classList.toggle("no-sidebar", !prefs.showTOC);
    root.style.setProperty("--sidebar-w", prefs.sidebarWidth + "px");

    if (!changed || ["theme", "pane", "typeface"].includes(changed)) tabs.forEach(t => t.view.redrawDiagrams());
    if (active) active.view.onScroll();
  }

  // "Match System" follows the OS appearance.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => tabs.forEach(t => t.view.redrawDiagrams()));

  // ---------- tabs ----------

  const tabs = [];
  let active = null;

  const basename = p => p.replace(/[\\/]+$/, "").replace(/^.*[\\/]/, "");
  const dirname = p => p.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "");
  // macOS and Windows file systems are case-insensitive by default.
  const samePath = (a, b) => a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
  const tabFor = path => tabs.find(t => samePath(t.path, path));

  function createTab(path) {
    const tab = { path, name: basename(path), dir: dirname(path), kind: null, text: null, bookId: null, toc: [], words: 0, activeId: null };
    tab.view = new DocView({
      onRendered: ({ toc, words }) => {
        tab.toc = toc; tab.words = words;
        if (tab === active) { renderOutline(); updateTitle(); }
      },
      onActive: id => { tab.activeId = id; if (tab === active) highlightOutline(true); },
      onProgress: ratio => { if (tab === active) progress.style.width = ratio * 100 + "%"; },
      onLink: href => followLink(href)
    });
    tab.view.hide();

    const el = document.createElement("div");
    el.className = "tab";
    el.setAttribute("role", "tab");
    el.innerHTML = '<button class="close" title="Close Tab" aria-label="Close Tab"><svg viewBox="0 0 20 20"><path d="m5.5 5.5 9 9m0-9-9 9"/></svg></button><span class="label"></span>';
    el.addEventListener("click", e => { if (!e.target.closest(".close")) activateTab(tab); });
    el.addEventListener("mousedown", e => { if (e.button === 1) { e.preventDefault(); closeTab(tab); } });
    el.querySelector(".close").addEventListener("click", e => { e.stopPropagation(); closeTab(tab); });
    tab.el = el;
    tabList.append(el);
    tabs.push(tab);
    labelTab(tab);
    tabsBar.hidden = false;
    return tab;
  }

  function labelTab(tab) {
    tab.el.querySelector(".label").textContent = tab.name;
    tab.el.title = tab.path;
  }

  /** Reads the file and renders it. `keepScroll` for reloads; `force` re-renders unchanged text. */
  async function loadTab(tab, keepScroll, force) {
    const doc = await invoke("open_document", { path: tab.path });
    if (!tabs.includes(tab)) { if (doc.bookId) invoke("close_book", { bookId: doc.bookId }); return; }
    Object.assign(tab, { path: doc.path, name: doc.name, dir: doc.dir, kind: doc.kind });
    if (doc.kind === "markdown") {
      if (keepScroll && !force && doc.text === tab.text) return;
      tab.text = doc.text;
      tab.view.renderMarkdown(doc.text, doc.base, keepScroll);
    } else {
      const old = tab.bookId;
      tab.bookId = doc.bookId;
      tab.title = doc.title;
      tab.view.renderBook(doc, keepScroll);
      if (old) invoke("close_book", { bookId: old });
    }
    labelTab(tab);
    if (tab === active) { updateTitle(); updateFileInfo(); }
    if (!tab.watching) { tab.watching = true; invoke("watch_file", { path: tab.path }).catch(() => {}); }
  }

  async function openPaths(paths, { quiet = false, activate = true } = {}) {
    let last = null;
    for (const path of paths) {
      let tab = tabFor(path);
      if (!tab) {
        tab = createTab(path);
        if (activate) activateTab(tab);
        try { await loadTab(tab, false); }
        catch (err) {
          closeTab(tab);
          tab = null;
          if (!quiet) alertBox(`Couldn't open “${basename(path)}”`, err);
        }
      }
      if (tab) last = tab;
    }
    if (last && activate) activateTab(last);
    saveSession();
    return last;
  }

  function activateTab(tab) {
    if (active === tab) return;
    if (active) { active.view.clearFind(); active.view.hide(); active.el.classList.remove("active"); }
    active = tab;
    welcome.hidden = true;
    tab.view.show();
    tab.el.classList.add("active");
    tab.el.scrollIntoView({ block: "nearest", inline: "nearest" });
    renderOutline();
    updateTitle();
    updateFileInfo();
    if (findInput.value) runFind(); else showFindState(null);
    tab.view.el.focus({ preventScroll: true });
    saveSession();
  }

  function closeTab(tab) {
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    tabs.splice(i, 1);
    tab.view.destroy();
    tab.el.remove();
    if (tab.watching) invoke("unwatch_file", { path: tab.path }).catch(() => {});
    if (tab.bookId) invoke("close_book", { bookId: tab.bookId }).catch(() => {});
    if (active === tab) {
      active = null;
      const next = tabs[i] || tabs[i - 1];
      if (next) activateTab(next);
      else showEmpty();
    }
    tabsBar.hidden = !tabs.length;
    saveSession();
  }

  function showEmpty() {
    welcome.hidden = false;
    progress.style.width = "0";
    renderOutline();
    updateTitle();
    updateFileInfo();
    showFindState(null);
  }

  function saveSession() {
    localStorage.setItem("mdreader.session", JSON.stringify({ paths: tabs.map(t => t.path), active: active && active.path }));
  }

  // ---------- title, outline, file info ----------

  function updateTitle() {
    $("doc-title").textContent = active ? active.name : "MDReader";
    const words = active ? active.words : 0;
    $("doc-subtitle").textContent = words
      ? `${words.toLocaleString()} words · ${Math.max(1, Math.round(words / 230))} min read`
      : "";
    document.title = active ? `${active.name} — MDReader` : "MDReader";
    if (appWindow) appWindow.setTitle(document.title).catch(() => {});
  }

  function renderOutline() {
    const toc = active ? active.toc : [];
    outline.replaceChildren();
    outlineEmpty.hidden = toc.length > 0;
    $("outline-empty-text").textContent = !active ? "Open a document to see its outline."
      : active.kind === "book" ? "This book has no table of contents." : "Headings in this document will appear here.";
    if (!toc.length) return;
    const min = Math.min(...toc.map(i => i.level));
    const frag = document.createDocumentFragment();
    for (const item of toc) {
      const depth = Math.min(item.level - min, 4);
      const b = document.createElement("button");
      b.className = `toc-item d${depth}`;
      b.style.paddingLeft = 8 + depth * 12 + "px";
      b.textContent = item.title;
      b.title = item.title;
      b.dataset.id = item.id;
      b.setAttribute("role", "treeitem");
      frag.append(b);
    }
    outline.append(frag);
    highlightOutline(false);
  }

  outline.addEventListener("click", e => {
    const b = e.target.closest(".toc-item");
    if (!b || !active) return;
    active.activeId = b.dataset.id;
    highlightOutline(false);
    active.view.scrollToId(b.dataset.id);
  });

  function highlightOutline(reveal) {
    const id = active && active.activeId;
    let hit = null;
    for (const b of outline.children) {
      const on = b.dataset.id === id;
      b.classList.toggle("active", on);
      if (on) hit = b;
    }
    if (hit && reveal) hit.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function updateFileInfo() {
    const box = $("file-info");
    box.hidden = !active;
    if (!active) return;
    $("file-name").textContent = active.name;
    let dir = active.dir;
    if (info.home && samePath(dir.slice(0, info.home.length), info.home)) dir = "~" + dir.slice(info.home.length);
    $("file-dir-text").textContent = dir;
    box.title = active.path;
    $("file-icon").innerHTML = active.kind === "book"
      ? '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16v12H5.5A1.5 1.5 0 0 0 4 16.5z"/><path d="M4 16.5A1.5 1.5 0 0 0 5.5 18H16v-3"/>'
      : '<path d="M5 2.5h6.5L15 6v11.5H5z"/><path d="M11.5 2.5V6H15M7.5 10h5M7.5 13h5"/>';
  }

  // Sidebar width.
  $("sidebar-resizer").addEventListener("pointerdown", e => {
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX, startW = $("sidebar").offsetWidth;
    let width = startW;
    const move = ev => {
      width = Math.max(200, Math.min(380, startW + ev.clientX - startX));
      root.style.setProperty("--sidebar-w", width + "px");
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      setPref("sidebarWidth", width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });

  // ---------- find ----------

  function showFindState(state) {
    const q = findInput.value;
    findBox.classList.toggle("active", !!q && !!active);
    findCount.textContent = !q || !active || !state ? "" : state.count ? `${state.index + 1} of ${state.count}` : "Not found";
  }

  function runFind() {
    if (!active) return showFindState(null);
    const q = findInput.value;
    if (!q) { active.view.clearFind(); return showFindState(null); }
    showFindState(active.view.search(q));
  }

  function stepFind(backwards) {
    if (!findInput.value) return focusFind();
    if (active) showFindState(active.view.step(backwards));
  }

  function focusFind() { findInput.focus(); findInput.select(); }

  findInput.addEventListener("input", runFind);
  findInput.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); stepFind(e.shiftKey); }
    else if (e.key === "Escape") {
      e.preventDefault();
      findInput.value = "";
      runFind();
      if (active) active.view.el.focus({ preventScroll: true });
    }
  });
  $("find-prev").addEventListener("click", () => stepFind(true));
  $("find-next").addEventListener("click", () => stepFind(false));

  // ---------- menus ----------

  let menuAnchor = null;

  /**
   * items: { header } | { sep: true } | { label, action, check, swatch, key, disabled, remove }
   */
  function openMenu(anchor, items) {
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "menu");
    for (const item of items) {
      if (item.header) {
        const h = document.createElement("div"); h.className = "menu-header"; h.textContent = item.header; menu.append(h);
      } else if (item.sep) {
        const s = document.createElement("div"); s.className = "menu-sep"; menu.append(s);
      } else {
        const b = document.createElement("button");
        b.className = "menu-item";
        b.setAttribute("role", item.check === undefined ? "menuitem" : "menuitemradio");
        b.disabled = !!item.disabled;
        const check = document.createElement("span"); check.className = "check"; check.textContent = item.check ? "✓" : "";
        b.append(check);
        if (item.swatch) { const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = item.swatch; b.append(sw); }
        const label = document.createElement("span"); label.className = "label"; label.textContent = item.label; b.append(label);
        if (item.key) { const k = document.createElement("span"); k.className = "key"; k.textContent = item.key; b.append(k); }
        if (item.remove) {
          const r = document.createElement("span"); r.className = "remove"; r.textContent = "✕"; r.title = "Remove";
          r.addEventListener("click", e => { e.stopPropagation(); closeMenu(); item.remove(); });
          b.append(r);
        }
        b.addEventListener("click", () => { closeMenu(); item.action(); });
        menu.append(b);
      }
    }
    menuLayer.replaceChildren(menu);
    menuLayer.hidden = false;
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    menu.style.top = Math.min(a.bottom + 4, innerHeight - m.height - 8) + "px";
    menu.style.left = Math.max(8, Math.min(a.right - m.width, innerWidth - m.width - 8)) + "px";
    anchor.classList.add("open");
    menuAnchor = anchor;
    const first = menu.querySelector(".menu-item:not(:disabled)");
    if (first) first.focus({ preventScroll: true });
  }

  function closeMenu() {
    if (menuLayer.hidden) return false;
    menuLayer.hidden = true;
    menuLayer.replaceChildren();
    if (menuAnchor) menuAnchor.classList.remove("open");
    menuAnchor = null;
    return true;
  }

  menuLayer.addEventListener("mousedown", e => { if (e.target === menuLayer) closeMenu(); });
  menuLayer.addEventListener("keydown", e => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(menuLayer.querySelectorAll(".menu-item:not(:disabled)"));
    const i = items.indexOf(document.activeElement);
    const next = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    if (next) next.focus();
  });

  function appearanceItems() {
    const theme = t => ({ label: t.name, check: prefs.theme === t.id, swatch: t.palette && t.palette.background, action: () => setPref("theme", t.id) });
    const items = [{ header: "Theme" }, ...Themes.reader().map(theme), { header: "VS Code" }, ...Themes.vscode().map(theme)];
    const imported = Themes.imported();
    if (imported.length) {
      items.push({ header: "Imported" });
      for (const t of imported) {
        items.push(Object.assign(theme(t), {
          remove: () => {
            Themes.removeImported(t.id);
            if (prefs.theme === t.id) setPref("theme", Themes.DEFAULT_ID);
          }
        }));
      }
    }
    items.push({ label: "Import VS Code Theme…", action: importThemes });
    items.push({ sep: true }, { header: "Reading Pane" });
    for (const p of Themes.PANES) items.push({ label: p.name, check: prefs.pane === p.id, action: () => setPref("pane", p.id) });
    items.push({ header: "Typeface" });
    for (const t of TYPEFACES) items.push({ label: t.name, check: prefs.typeface === t.id, action: () => setPref("typeface", t.id) });
    items.push({ header: "Page Width" });
    for (const w of WIDTHS) items.push({ label: w.name, check: prefs.width === w.id, action: () => setPref("width", w.id) });
    items.push({ sep: true }, { label: "Reset Text Size", key: shortcut("0"), action: () => setPref("fontSize", FONT.def), disabled: prefs.fontSize === FONT.def });
    return items;
  }

  function moreItems() {
    const none = !active;
    return [
      { label: "Open in Editor", action: () => invoke("open_in_editor", { path: active.path }).catch(e => alertBox("Couldn't open an editor", e)), disabled: none || active.kind !== "markdown" },
      { label: isMac ? "Show in Finder" : "Show in Explorer", action: () => invoke("reveal", { path: active.path }).catch(e => alertBox("Couldn't show the file", e)), disabled: none },
      { sep: true },
      { label: "Export as PDF…", key: shortcut("E", true), action: exportPDF, disabled: none },
      { label: "Print…", key: shortcut("P"), action: print, disabled: none }
    ];
  }

  function shortcut(key, shift) {
    return isMac ? (shift ? "⇧⌘" : "⌘") + key : "Ctrl+" + (shift ? "Shift+" : "") + key;
  }

  async function importThemes() {
    const paths = await invoke("pick_themes");
    let last = null;
    const failures = [];
    for (const path of paths) {
      try { last = await Themes.importTheme(path, p => invoke("read_text", { path: p })); }
      catch (err) { failures.push(`${basename(path)}: ${err.message || err}`); }
    }
    if (last) setPref("theme", last.id);
    if (failures.length) alertBox(failures.length === 1 ? "Couldn't import that theme" : "Couldn't import some themes", failures.join("\n"));
  }

  // ---------- commands ----------

  async function openDialog() {
    const paths = await invoke("pick_documents");
    if (paths.length) openPaths(paths);
  }

  async function print() {
    if (!active) return;
    if (isMac) invoke("print_page").catch(e => alertBox("Couldn't print", e));
    else window.print();
  }

  async function exportPDF() {
    if (!active) return;
    const name = active.name.replace(/\.[^.]+$/, "") + ".pdf";
    try { await invoke("export_pdf", { name, dir: active.dir }); }
    catch (err) { alertBox("Couldn't export as PDF", err); }
  }

  async function followLink(href) {
    try {
      const path = await invoke("follow_link", { href });
      if (!path) return;
      const tab = await openPaths([path]);
      let hash = "";
      try { hash = decodeURIComponent(new URL(href).hash.slice(1)); } catch (_) {}
      if (tab && hash) tab.view.scrollToId(hash);
    } catch (err) {
      alertBox("Couldn't open the link", err);
    }
  }

  function alertBox(title, err) {
    const message = err && err.message ? err.message : String(err);
    invoke("alert", { title, message }).catch(() => console.error(title, message));
  }

  function selectTab(offset) {
    if (!tabs.length) return;
    const i = active ? tabs.indexOf(active) : 0;
    activateTab(tabs[(i + offset + tabs.length) % tabs.length]);
  }

  const actions = {
    "open": openDialog,
    "open-tab": openDialog,
    "close-tab": () => { if (active) closeTab(active); else if (appWindow) appWindow.close(); },
    "export-pdf": exportPDF,
    "print": print,
    "find": focusFind,
    "find-next": () => stepFind(false),
    "find-prev": () => stepFind(true),
    "toggle-sidebar": () => setPref("showTOC", !prefs.showTOC),
    "reload": () => { if (active) loadTab(active, true, true).catch(e => alertBox(`Couldn't reload “${active.name}”`, e)); },
    "zoom-reset": () => setPref("fontSize", FONT.def),
    "zoom-in": () => setPref("fontSize", Math.min(FONT.max, prefs.fontSize + 1)),
    "zoom-out": () => setPref("fontSize", Math.max(FONT.min, prefs.fontSize - 1)),
    "appearance": () => openMenu($("btn-appearance"), appearanceItems()),
    "next-tab": () => selectTab(1),
    "prev-tab": () => selectTab(-1),
    "make-default": () => invoke("make_default_app")
  };

  // The same shortcut can arrive both from the menu bar and as a key press; run it once.
  const lastRun = {};
  function trigger(action, source) {
    const now = performance.now(), prev = lastRun[action];
    if (prev && prev.source !== source && now - prev.time < 300) return;
    lastRun[action] = { source, time: now };
    closeMenu();
    if (actions[action]) actions[action]();
  }

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && closeMenu()) { e.preventDefault(); return; }
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let action = null;
    if (e.ctrlKey && e.key === "Tab") action = e.shiftKey ? "prev-tab" : "next-tab";
    else if (e.key === "F3") action = e.shiftKey ? "find-prev" : "find-next";
    else if (e.key === "F5") action = "reload";
    else if (mod && !e.altKey) {
      if (k === "s" && (isMac ? e.ctrlKey : e.shiftKey)) action = "toggle-sidebar";
      else if (k === "o") action = "open";
      else if (k === "t") action = "open-tab";
      else if (k === "w") action = "close-tab";
      else if (k === "e" && e.shiftKey) action = "export-pdf";
      else if (k === "p" && !e.shiftKey) action = "print";
      else if (k === "f") action = "find";
      else if (k === "g") action = e.shiftKey ? "find-prev" : "find-next";
      else if (k === "r") action = "reload";
      else if (k === "0") action = "zoom-reset";
      else if (k === "=" || k === "+") action = "zoom-in";
      else if (k === "-" || k === "_") action = "zoom-out";
      else if (/^[1-9]$/.test(k) && tabs.length) {
        e.preventDefault();
        activateTab(k === "9" ? tabs[tabs.length - 1] : tabs[Math.min(+k, tabs.length) - 1]);
        return;
      }
    }
    if (action) { e.preventDefault(); e.stopPropagation(); trigger(action, "key"); }
  }, true);

  // ---------- toolbar ----------

  $("btn-sidebar").addEventListener("click", () => trigger("toggle-sidebar", "ui"));
  $("btn-smaller").addEventListener("click", () => trigger("zoom-out", "ui"));
  $("btn-bigger").addEventListener("click", () => trigger("zoom-in", "ui"));
  $("btn-appearance").addEventListener("click", e => { if (menuAnchor !== e.currentTarget) openMenu(e.currentTarget, appearanceItems()); });
  $("btn-more").addEventListener("click", e => { if (menuAnchor !== e.currentTarget) openMenu(e.currentTarget, moreItems()); });
  $("tab-add").addEventListener("click", openDialog);
  $("welcome-open").addEventListener("click", openDialog);

  if (isMac) {
    root.classList.add("mac");
    // The toolbar doubles as the title bar.
    document.querySelectorAll(".drag").forEach(el => el.setAttribute("data-tauri-drag-region", ""));
  }

  // Keep the browser from navigating to files dropped on it; the app opens them instead.
  addEventListener("dragover", e => e.preventDefault());
  addEventListener("drop", e => e.preventDefault());

  // ---------- startup ----------

  async function start() {
    applyPrefs();
    showEmpty();
    if (!T) return;

    info = await invoke("app_info").catch(() => info);
    T.event.listen("menu", e => trigger(e.payload, "menu"));
    T.event.listen("open-files", e => openPaths(e.payload));
    T.event.listen("doc-changed", e => {
      for (const t of tabs) if (samePath(t.path, e.payload)) loadTab(t, true).catch(() => {});
    });
    if (appWindow && appWindow.onDragDropEvent) {
      appWindow.onDragDropEvent(e => {
        const type = e.payload.type;
        document.body.classList.toggle("dragging", type === "enter" || type === "over");
      });
    }

    // Reopen last session's tabs, then whatever the OS asked us to open.
    let session = {};
    try { session = JSON.parse(localStorage.getItem("mdreader.session")) || {}; } catch (_) {}
    const restore = Array.isArray(session.paths) ? session.paths : [];
    if (restore.length) {
      await openPaths(restore, { quiet: true, activate: false });
      const tab = (session.active && tabFor(session.active)) || tabs[0];
      if (tab) activateTab(tab);
    }
    const files = await invoke("take_launch_files");
    if (files.length) await openPaths(files);
  }

  start();
})();
