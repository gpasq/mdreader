// MDReader — themes: the reader's own, built-in VS Code palettes, and imported VS Code themes.
(function () {
  "use strict";

  // Colors for a theme modeled on a VS Code color theme. The page derives every other shade
  // from these with CSS color-mix().
  function palette(isDark, background, foreground, accent, keyword, string, number, comment, fn, type, attribute, tag, meta) {
    return { isDark, background, foreground, accent, keyword, string, number, comment, function: fn, type, attribute, tag, meta };
  }

  function cssVars(p) {
    return {
      "--bg": p.background, "--fg": p.foreground, "--accent": p.accent,
      "--hl-keyword": p.keyword, "--hl-string": p.string, "--hl-number": p.number,
      "--hl-comment": p.comment, "--hl-title": p.function, "--hl-type": p.type,
      "--hl-attr": p.attribute, "--hl-variable": p.attribute, "--hl-tag": p.tag, "--hl-meta": p.meta
    };
  }

  const READER = [
    { id: "reader.auto", name: "Match System", source: "reader", css: "auto" },
    { id: "reader.light", name: "Light", source: "reader", css: "light" },
    { id: "reader.sepia", name: "Sepia", source: "reader", css: "sepia" },
    { id: "reader.dark", name: "Dark", source: "reader", css: "dark" }
  ];

  const darkPlus = palette(true, "#1e1e1e", "#d4d4d4", "#3794ff", "#569cd6", "#ce9178", "#b5cea8", "#6a9955", "#dcdcaa", "#4ec9b0", "#9cdcfe", "#569cd6", "#c586c0");
  const lightPlus = palette(false, "#ffffff", "#1f1f1f", "#006ab1", "#0000ff", "#a31515", "#098658", "#008000", "#795e26", "#267f99", "#001080", "#800000", "#af00db");

  const vs = (id, name, p) => ({ id: "vscode." + id, name, source: "vscode", palette: p });
  const VSCODE = [
    vs("dark-plus", "Dark+", darkPlus),
    vs("light-plus", "Light+", lightPlus),
    vs("monokai", "Monokai", palette(true, "#272822", "#f8f8f2", "#66d9ef", "#f92672", "#e6db74", "#ae81ff", "#88846f", "#a6e22e", "#66d9ef", "#fd971f", "#f92672", "#f92672")),
    vs("dracula", "Dracula", palette(true, "#282a36", "#f8f8f2", "#bd93f9", "#ff79c6", "#f1fa8c", "#bd93f9", "#6272a4", "#50fa7b", "#8be9fd", "#50fa7b", "#ff79c6", "#ff79c6")),
    vs("one-dark-pro", "One Dark Pro", palette(true, "#282c34", "#abb2bf", "#61afef", "#c678dd", "#98c379", "#d19a66", "#7f848e", "#61afef", "#e5c07b", "#e06c75", "#e06c75", "#56b6c2")),
    vs("github-light", "GitHub Light", palette(false, "#ffffff", "#1f2328", "#0969da", "#cf222e", "#0a3069", "#0550ae", "#6e7781", "#8250df", "#953800", "#0550ae", "#116329", "#cf222e")),
    vs("github-dark", "GitHub Dark", palette(true, "#0d1117", "#e6edf3", "#4493f8", "#ff7b72", "#a5d6ff", "#79c0ff", "#8b949e", "#d2a8ff", "#ffa657", "#79c0ff", "#7ee787", "#ff7b72")),
    vs("solarized-light", "Solarized Light", palette(false, "#fdf6e3", "#586e75", "#268bd2", "#859900", "#2aa198", "#d33682", "#93a1a1", "#268bd2", "#b58900", "#cb4b16", "#268bd2", "#cb4b16")),
    vs("solarized-dark", "Solarized Dark", palette(true, "#002b36", "#93a1a1", "#268bd2", "#859900", "#2aa198", "#d33682", "#586e75", "#268bd2", "#b58900", "#cb4b16", "#268bd2", "#cb4b16")),
    vs("nord", "Nord", palette(true, "#2e3440", "#d8dee9", "#88c0d0", "#81a1c1", "#a3be8c", "#b48ead", "#616e88", "#88c0d0", "#8fbcbb", "#ebcb8b", "#81a1c1", "#5e81ac"))
  ];

  const DEFAULT_ID = "reader.auto";
  const STORE = "mdreader.importedThemes";

  // The reading pane: the app theme's colors, or a fixed page independent of it.
  const PANES = [
    { id: "theme", name: "Match Theme" },
    { id: "white", name: "White", theme: "reader.light" },
    { id: "sepia", name: "Sepia", theme: "reader.sepia" },
    { id: "dark", name: "Dark", theme: "reader.dark" }
  ];

  function loadImported() {
    try {
      const list = JSON.parse(localStorage.getItem(STORE) || "[]");
      return list.filter(t => t && t.id && t.palette).map(t => ({ id: t.id, name: t.name, source: "imported", palette: t.palette }));
    } catch (_) { return []; }
  }

  let imported = loadImported();

  function saveImported() {
    localStorage.setItem(STORE, JSON.stringify(imported.map(t => ({ id: t.id, name: t.name, palette: t.palette }))));
  }

  const all = () => READER.concat(VSCODE, imported);

  function theme(id) {
    // Very old settings stored bare names ("dark").
    if (id && !id.includes(".")) id = "reader." + id;
    return all().find(t => t.id === id) || READER[0];
  }

  function pageTheme(paneId, appTheme) {
    const pane = PANES.find(p => p.id === paneId);
    return pane && pane.theme ? theme(pane.theme) : appTheme;
  }

  /** true / false, or null when the theme follows the system. */
  function isDark(t) {
    if (t.palette) return !!t.palette.isDark;
    if (t.css === "dark") return true;
    if (t.css === "light" || t.css === "sepia") return false;
    return null;
  }

  /** What the page needs to draw itself in this theme. */
  function pageArgs(t) {
    return t.palette ? { theme: "custom", dark: t.palette.isDark, vars: cssVars(t.palette) } : { theme: t.css || "auto" };
  }

  // ---------- importing VS Code theme files ----------

  // Removes // and /* */ comments and trailing commas, leaving strings intact.
  function stripJSONC(s) {
    let out = "", i = 0, inString = false;
    while (i < s.length) {
      const c = s[i];
      if (inString) {
        out += c;
        if (c === "\\" && i + 1 < s.length) { out += s[i + 1]; i += 2; continue; }
        if (c === '"') inString = false;
        i++; continue;
      }
      if (c === '"') { inString = true; out += c; i++; continue; }
      if (c === "/" && s[i + 1] === "/") { while (i < s.length && s[i] !== "\n") i++; continue; }
      if (c === "/" && s[i + 1] === "*") {
        i += 2;
        while (i + 1 < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
        i += 2; continue;
      }
      if (c === ",") {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] === "}" || s[j] === "]") { i++; continue; }
      }
      out += c; i++;
    }
    return out;
  }

  /** [r, g, b, a] in 0…1 for #rgb, #rgba, #rrggbb or #rrggbbaa. */
  function parseHex(hex) {
    let h = String(hex || "").trim();
    if (!h.startsWith("#")) return null;
    h = h.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split("").map(c => c + c).join("");
    if ((h.length !== 6 && h.length !== 8) || /[^0-9a-f]/i.test(h)) return null;
    const n = i => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }

  const dirname = p => p.replace(/[\\/][^\\/]*$/, "");
  const basename = p => p.replace(/^.*[\\/]/, "");

  class ImportError extends Error {}

  async function collect(path, readText, depth) {
    let obj;
    try { obj = JSON.parse(stripJSONC(await readText(path))); } catch (_) { obj = null; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new ImportError("This file doesn't look like a VS Code color theme.");

    let colors = {}, tokens = [], type = typeof obj.type === "string" ? obj.type : null;

    // `include` points at a base theme; its values come first and are overridden here.
    if (depth < 5 && typeof obj.include === "string") {
      try {
        const base = await collect(dirname(path) + "/" + obj.include, readText, depth + 1);
        colors = base.colors; tokens = base.tokens; type = type || base.type;
      } catch (_) {}
    }
    for (const [k, v] of Object.entries(obj.colors || {})) if (typeof v === "string") colors[k] = v;
    for (const rule of Array.isArray(obj.tokenColors) ? obj.tokenColors : []) {
      const fg = rule && rule.settings && rule.settings.foreground;
      if (typeof fg !== "string") continue;
      const scopes = typeof rule.scope === "string" ? rule.scope.split(",").map(s => s.trim())
        : Array.isArray(rule.scope) ? rule.scope.filter(s => typeof s === "string") : [];
      tokens.push({ scopes, color: fg });
    }
    return { colors, tokens, type, name: depth === 0 && typeof obj.name === "string" ? obj.name : null };
  }

  /** Loads a VS Code *-color-theme.json file (JSON with comments), following `include`. */
  async function parseThemeFile(path, readText) {
    const { colors, tokens, type, name } = await collect(path, readText, 0);
    if (!Object.keys(colors).length && !tokens.length) throw new ImportError("This file doesn't look like a VS Code color theme.");

    let dark = true;
    if (type) dark = type !== "light" && type !== "hcLight";
    else if (parseHex(colors["editor.background"])) dark = Math.max(...parseHex(colors["editor.background"]).slice(0, 3)) < 0.5;
    const base = dark ? darkPlus : lightPlus;

    // Base colors are used opaque: a translucent background or link color reads badly on a page.
    const opaque = hex => hex.length === 9 ? hex.slice(0, 7) : hex;
    const color = (...keys) => { const k = keys.find(k => parseHex(colors[k])); return k ? opaque(colors[k]) : null; };
    const token = (...scopes) => {
      for (const scope of scopes) {
        // Exact scope match first (last rule wins, as in VS Code), then a more specific one.
        const exact = tokens.filter(t => t.scopes.includes(scope)).pop();
        if (exact) return exact.color;
        const sub = tokens.filter(t => t.scopes.some(s => s.startsWith(scope + "."))).pop();
        if (sub) return sub.color;
      }
      return null;
    };

    const bare = tokens.find(t => !t.scopes.length);
    const p = palette(
      dark,
      color("editor.background") || base.background,
      color("editor.foreground", "foreground") || (bare && bare.color) || base.foreground,
      color("textLink.foreground", "focusBorder", "button.background", "activityBarBadge.background") || base.accent,
      token("keyword", "storage.type", "storage") || base.keyword,
      token("string") || base.string,
      token("constant.numeric", "constant") || base.number,
      token("comment") || base.comment,
      token("entity.name.function", "support.function") || base.function,
      token("entity.name.type", "support.type", "entity.name.class", "support.class") || base.type,
      token("variable.other.property", "support.type.property-name", "entity.other.attribute-name", "variable") || base.attribute,
      token("entity.name.tag") || base.tag,
      token("keyword.control", "meta.preprocessor") || base.meta
    );
    const fallback = basename(path).replace(/\.[^.]*$/, "").replace(/-color-theme/g, "").replace(/-/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase());
    return { name: name || fallback, palette: p };
  }

  function slug(s) {
    return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  }

  /** Imports a theme file; re-importing a theme with the same name replaces it. */
  async function importTheme(path, readText) {
    const parsed = await parseThemeFile(path, readText);
    const t = { id: "imported." + slug(parsed.name), name: parsed.name, source: "imported", palette: parsed.palette };
    imported = imported.filter(x => x.id !== t.id).concat(t).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    saveImported();
    return t;
  }

  function removeImported(id) {
    imported = imported.filter(t => t.id !== id);
    saveImported();
  }

  window.Themes = {
    DEFAULT_ID, PANES,
    reader: () => READER.slice(),
    vscode: () => VSCODE.slice(),
    imported: () => imported.slice(),
    theme, pageTheme, isDark, pageArgs,
    importTheme, removeImported,
    _test: { stripJSONC, parseThemeFile, parseHex }
  };
})();
