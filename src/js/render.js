// MDReader — renders one document (Markdown or an EPUB book) into a tab's scroller.
(function () {
  "use strict";

  const reader = document.getElementById("reader");

  marked.use({ gfm: true, breaks: false });

  // ---------- helpers ----------

  function slugify(text, used) {
    let slug = text.toLowerCase().trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-") || "section";
    let candidate = slug, n = 1;
    while (used.has(candidate)) candidate = `${slug}-${n++}`;
    used.add(candidate);
    return candidate;
  }

  function splitFrontMatter(md) {
    const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(md);
    if (!m) return { body: md, meta: null };
    const meta = [];
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (kv) meta.push([kv[1], kv[2].replace(/^["']|["']$/g, "")]);
    }
    return { body: md.slice(m[0].length), meta };
  }

  // Strip anything executable from the parsed markup before it touches the live DOM.
  function sanitize(root) {
    root.querySelectorAll("script, iframe, object, embed, frame, frameset, meta, link, base, form").forEach(el => el.remove());
    root.querySelectorAll("*").forEach(el => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith("on")) el.removeAttribute(attr.name);
        else if ((name === "href" || name === "src" || name === "xlink:href" || name === "action" || name === "formaction")
                 && value.startsWith("javascript:")) el.removeAttribute(attr.name);
      }
    });
  }

  const XLINK = "http://www.w3.org/1999/xlink";

  // Each tab lives in the same page, so a <base> can't serve them all: make every relative
  // reference absolute against the document's folder instead.
  function absolutize(root, base) {
    const resolve = value => { try { return new URL(value, base).href; } catch (_) { return null; } };
    root.querySelectorAll("[src], [poster]").forEach(el => {
      for (const name of ["src", "poster"]) {
        const v = el.getAttribute(name);
        if (v != null) { const abs = resolve(v); if (abs) el.setAttribute(name, abs); }
      }
    });
    root.querySelectorAll("[srcset]").forEach(el => {
      el.setAttribute("srcset", el.getAttribute("srcset").split(",").map(part => {
        const [url, ...rest] = part.trim().split(/\s+/);
        return [resolve(url) || url, ...rest].join(" ");
      }).join(", "));
    });
    root.querySelectorAll("a[href]").forEach(a => {
      const v = a.getAttribute("href");
      if (v.startsWith("#")) return;
      const abs = resolve(v);
      if (abs) a.setAttribute("href", abs);
    });
    root.querySelectorAll("image").forEach(el => {
      const v = el.getAttributeNS(XLINK, "href") || el.getAttribute("href");
      if (v != null) { const abs = resolve(v); if (abs) el.setAttributeNS(XLINK, "xlink:href", abs); }
    });
  }

  const ALERT_ICONS = {
    note: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
    tip: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>',
    important: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
    warning: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
    caution: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>'
  };

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
  }

  function decorate(root) {
    // Headings: stable ids + hover anchors.
    const used = new Set();
    const toc = [];
    root.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(h => {
      const text = h.textContent.trim();
      if (!h.id) h.id = slugify(text, used); else used.add(h.id);
      const a = document.createElement("a");
      a.className = "anchor"; a.href = "#" + h.id; a.textContent = "#";
      a.setAttribute("aria-hidden", "true");
      h.prepend(a);
      toc.push({ id: h.id, level: Number(h.tagName[1]), title: text });
    });

    // Mermaid blocks become diagram placeholders, drawn after the page is in the DOM.
    root.querySelectorAll("pre > code.language-mermaid").forEach(code => {
      const fig = document.createElement("figure");
      fig.className = "diagram";
      fig.dataset.source = code.textContent;
      code.parentElement.replaceWith(fig);
    });

    // Code blocks: highlight, language label, copy button.
    root.querySelectorAll("pre > code").forEach(code => {
      const pre = code.parentElement;
      const langClass = Array.from(code.classList).find(c => c.startsWith("language-"));
      let lang = langClass ? langClass.slice(9) : "";
      try {
        if (lang && hljs.getLanguage(lang)) hljs.highlightElement(code);
        else if (!lang) {
          const r = hljs.highlightAuto(code.textContent);
          if (r.relevance > 6) { code.innerHTML = r.value; code.classList.add("hljs"); lang = r.language || ""; }
        }
      } catch (_) {}
      const wrap = document.createElement("div");
      wrap.className = "code-block";
      const head = document.createElement("div");
      head.className = "code-head";
      const label = document.createElement("span");
      label.textContent = lang || "text";
      const btn = document.createElement("button");
      btn.className = "copy"; btn.textContent = "Copy";
      btn.addEventListener("click", () => {
        copyText(code.textContent);
        btn.textContent = "Copied"; btn.classList.add("ok");
        setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("ok"); }, 1400);
      });
      head.append(label, btn);
      pre.replaceWith(wrap);
      wrap.append(head, pre);
    });

    // Tables scroll horizontally inside a rounded frame.
    root.querySelectorAll("table").forEach(t => {
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      t.replaceWith(wrap); wrap.append(t);
    });

    // Task lists.
    root.querySelectorAll("li").forEach(li => {
      const first = li.firstElementChild;
      const box = first && first.matches('input[type="checkbox"]') ? first
        : (first && first.tagName === "P" && first.firstElementChild && first.firstElementChild.matches('input[type="checkbox"]')) ? first.firstElementChild : null;
      if (!box) return;
      if (box.parentElement !== li) li.prepend(box);
      li.classList.add("task");
      if (box.checked) li.classList.add("done");
      li.parentElement.classList.add("contains-task-list");
    });

    // GitHub-style alerts: > [!NOTE]
    root.querySelectorAll("blockquote").forEach(bq => {
      const p = bq.firstElementChild;
      if (!p || p.tagName !== "P") return;
      const m = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(p.innerHTML);
      if (!m) return;
      const kind = m[1].toLowerCase();
      p.innerHTML = p.innerHTML.slice(m[0].length).replace(/^<br>\s*/, "");
      if (!p.textContent.trim() && !p.querySelector("img")) p.remove();
      bq.classList.add("alert", kind);
      const title = document.createElement("p");
      title.className = "alert-title";
      title.innerHTML = ALERT_ICONS[kind] + `<span>${kind[0].toUpperCase() + kind.slice(1)}</span>`;
      bq.prepend(title);
    });

    return toc;
  }

  // ---------- diagrams ----------

  let mermaidLoaded = null;
  const diagramCache = new Map(); // theme + source → svg, so live reloads don't jump
  let diagramSeq = 0;

  function loadMermaid() {
    if (!mermaidLoaded) mermaidLoaded = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/mermaid.min.js";
      s.onload = () => resolve(window.mermaid);
      s.onerror = () => { mermaidLoaded = null; reject(new Error("Couldn't load the diagram renderer.")); };
      document.head.append(s);
    });
    return mermaidLoaded;
  }

  // Mermaid derives shades from its theme colors, so it needs plain hex — not var() or color-mix().
  const probe = document.createElement("span");
  const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

  function hex(cssVar, over) {
    probe.style.color = `var(${cssVar})`;
    reader.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    paint.clearRect(0, 0, 1, 1);
    if (over) { paint.fillStyle = over; paint.fillRect(0, 0, 1, 1); }
    paint.fillStyle = color; paint.fillRect(0, 0, 1, 1);
    const [r, g, b] = paint.getImageData(0, 0, 1, 1).data;
    return "#" + [r, g, b].map(n => n.toString(16).padStart(2, "0")).join("");
  }

  function diagramTheme() {
    const bg = hex("--bg");
    const [r, g, b] = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16));
    const fg = hex("--fg"), accent = hex("--accent"), rule = hex("--rule");
    const node = hex("--accent-soft", bg), panel = hex("--code-bg", bg);
    return {
      darkMode: (r * 299 + g * 587 + b * 114) / 1000 < 128,
      background: bg, fontFamily: getComputedStyle(reader).getPropertyValue("--body-font"),
      fontSize: "15px",
      primaryColor: node, primaryBorderColor: accent, primaryTextColor: fg,
      secondaryColor: panel, secondaryBorderColor: rule, secondaryTextColor: fg,
      tertiaryColor: panel, tertiaryBorderColor: rule, tertiaryTextColor: fg,
      mainBkg: node, nodeBorder: accent, textColor: fg, titleColor: fg,
      lineColor: hex("--muted"), edgeLabelBackground: bg,
      clusterBkg: panel, clusterBorder: rule, noteBkgColor: panel, noteBorderColor: rule, noteTextColor: fg
    };
  }

  // Diagrams render one at a time: mermaid keeps global state between renders.
  let diagramQueue = Promise.resolve();

  function drawDiagrams(root, force, after) {
    const figs = Array.from(root.querySelectorAll(force ? ".diagram" : ".diagram:not(.done)"));
    if (!figs.length) return;
    const vars = diagramTheme();
    const key = JSON.stringify(vars);
    const pending = [];
    for (const fig of figs) {
      const svg = diagramCache.get(key + fig.dataset.source);
      if (svg) { fig.innerHTML = svg; fig.className = "diagram done"; }
      else pending.push(fig);
    }
    if (!pending.length) return;

    diagramQueue = diagramQueue.then(() => loadMermaid()).then(async mermaid => {
      // Natural size keeps labels readable; wide diagrams scroll sideways instead of shrinking.
      const natural = { useMaxWidth: false };
      mermaid.initialize({
        startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: vars,
        flowchart: natural, sequence: natural, class: natural, state: natural, er: natural,
        gantt: natural, journey: natural, gitGraph: natural, mindmap: natural, timeline: natural
      });
      for (const fig of pending) {
        if (!fig.isConnected) continue;
        const id = "mdr-diagram-" + (++diagramSeq);
        try {
          const { svg } = await mermaid.render(id, fig.dataset.source);
          diagramCache.set(key + fig.dataset.source, svg);
          fig.innerHTML = svg;
          fig.className = "diagram done";
        } catch (err) {
          document.getElementById("d" + id)?.remove(); // mermaid's scratch element
          showDiagramError(fig, err);
        }
      }
      if (after) after();
    }).catch(err => pending.forEach(fig => showDiagramError(fig, err)));
  }

  function showDiagramError(fig, err) {
    fig.className = "diagram done error";
    const msg = document.createElement("p");
    msg.className = "diagram-error";
    msg.textContent = (err && err.message ? err.message : String(err)).split("\n")[0];
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = fig.dataset.source;
    pre.append(code);
    fig.replaceChildren(msg, pre);
  }

  // ---------- books ----------

  function parseChapter(src) {
    let doc = new DOMParser().parseFromString(src, "application/xhtml+xml");
    // Plenty of EPUBs aren't well-formed XML (stray &nbsp; and the like); the HTML parser copes.
    if (!doc.body || doc.querySelector("parsererror")) doc = new DOMParser().parseFromString(src, "text/html");
    return doc.body || doc.documentElement;
  }

  // Book styles are dropped; these inline properties would also fight the reader's theme and text size.
  const THEMED_PROPS = ["color", "background", "background-color", "background-image", "font-family", "font-size", "line-height"];

  // Makes one chapter's ids unique within the book and points every link and image at the right place.
  function rebaseChapter(section, chapterURL, n, localId) {
    section.querySelectorAll("a[name]:not([id])").forEach(a => { a.id = a.getAttribute("name"); });
    section.querySelectorAll("[id]").forEach(el => { el.id = `c${n}-${el.id}`; });

    const resolve = value => { try { return new URL(value, chapterURL).href; } catch (_) { return null; } };
    section.querySelectorAll("[src], [poster]").forEach(el => {
      for (const name of ["src", "poster"]) {
        const v = el.getAttribute(name);
        if (v != null) { const abs = resolve(v); if (abs) el.setAttribute(name, abs); }
      }
    });
    section.querySelectorAll("*").forEach(el => {
      const xl = el.getAttributeNS(XLINK, "href");
      if (xl != null && el.localName === "image") { const abs = resolve(xl); if (abs) el.setAttributeNS(XLINK, "xlink:href", abs); }
      if (el.hasAttribute("style")) {
        for (const prop of THEMED_PROPS) el.style.removeProperty(prop);
        if (!el.getAttribute("style").trim()) el.removeAttribute("style");
      }
      el.removeAttribute("bgcolor");
      if (el.localName === "font") { el.removeAttribute("color"); el.removeAttribute("face"); el.removeAttribute("size"); }
    });
    section.querySelectorAll("a[href]").forEach(a => {
      const abs = resolve(a.getAttribute("href"));
      if (!abs) return;
      const id = localId(abs);
      a.setAttribute("href", id ? "#" + encodeURIComponent(id) : abs);
    });
  }

  // ---------- one document ----------

  class DocView {
    /**
     * @param {object} host  onRendered({toc, words}), onActive(id), onProgress(ratio), onLink(href)
     */
    constructor(host) {
      this.host = host;
      this.el = document.createElement("div");
      this.el.className = "doc";
      this.el.tabIndex = -1;
      const page = document.createElement("main");
      page.className = "page";
      this.content = document.createElement("article");
      this.content.className = "markdown";
      page.append(this.content);
      this.el.append(page);
      reader.append(this.el);

      this.headings = [];
      this.lastActive = null;
      this.ticking = false;
      this.find = { query: "", ranges: [], index: -1 };

      this.el.addEventListener("scroll", () => this.onScroll(), { passive: true });
      this.el.addEventListener("click", e => {
        const a = e.target.closest("a[href]");
        if (!a) return;
        const raw = a.getAttribute("href");
        e.preventDefault();
        if (raw.startsWith("#")) { this.scrollToId(decodeURIComponent(raw.slice(1))); return; }
        this.host.onLink(a.href);
      });
    }

    destroy() { this.el.remove(); }

    get visible() { return !this.el.hidden; }

    // A hidden scroller has no layout, so its position is kept by hand.
    show() {
      this.el.hidden = false;
      if (this.savedScroll != null) { this.el.scrollTop = this.savedScroll; this.savedScroll = null; }
      this.onScroll(true);
    }
    hide() {
      if (!this.el.hidden) this.savedScroll = this.el.scrollTop;
      this.el.hidden = true;
    }

    onScroll(forceReport) {
      if (this.ticking || this.el.hidden) return;
      this.ticking = true;
      requestAnimationFrame(() => {
        this.ticking = false;
        const el = this.el;
        const max = el.scrollHeight - el.clientHeight;
        this.host.onProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
        const top = el.getBoundingClientRect().top;
        let active = this.headings.length ? this.headings[0].id : null;
        for (const h of this.headings) {
          if (h.getBoundingClientRect().top - top <= 70) active = h.id; else break;
        }
        if (max > 0 && el.scrollTop >= max - 2 && this.headings.length) active = this.headings[this.headings.length - 1].id;
        if (active !== this.lastActive || forceReport) { this.lastActive = active; this.host.onActive(active); }
      });
    }

    scrollToId(id, smooth = true) {
      const el = this.content.querySelector(`[id="${CSS.escape(id)}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }

    redrawDiagrams() { drawDiagrams(this.content, true, () => this.onScroll()); }

    // Swaps in new content, reports the outline, and restores (or resets) the scroll position.
    present(frag, toc, targets, keepScroll, isEmpty) {
      const el = this.el;
      if (el.hidden) {
        // A background tab reloading: keep its saved spot for when it's shown again.
        if (!keepScroll) this.savedScroll = 0;
        this.content.replaceChildren(frag);
        if (isEmpty) this.content.innerHTML = '<p class="empty">This document is empty.</p>';
        this.headings = targets ? targets() : Array.from(this.content.querySelectorAll("h1, h2, h3, h4, h5, h6"));
        this.lastActive = undefined;
        drawDiagrams(this.content, false);
        const words = ((this.content.textContent || "").match(/[\p{L}\p{N}’'-]+/gu) || []).length;
        this.host.onRendered({ toc, words });
        return;
      }
      const prevRatio = keepScroll ? el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) : 0;
      const prevY = el.scrollTop;

      this.content.replaceChildren(frag);
      drawDiagrams(this.content, false, () => this.onScroll());
      if (!keepScroll) { this.content.classList.remove("fade-in"); void this.content.offsetWidth; this.content.classList.add("fade-in"); }
      if (isEmpty) this.content.innerHTML = '<p class="empty">This document is empty.</p>';

      this.headings = targets ? targets() : Array.from(this.content.querySelectorAll("h1, h2, h3, h4, h5, h6"));
      this.lastActive = undefined;

      const text = this.content.textContent || "";
      const words = (text.match(/[\p{L}\p{N}’'-]+/gu) || []).length;
      this.host.onRendered({ toc, words });

      if (keepScroll) {
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = prevY <= max ? prevY : prevRatio * max;
      } else {
        el.scrollTop = 0;
      }
      if (this.find.query) this.search(this.find.query, true);
      this.onScroll();
    }

    renderMarkdown(markdown, base, keepScroll) {
      const { body, meta } = splitFrontMatter(markdown);
      const tpl = document.createElement("template");
      tpl.innerHTML = marked.parse(body);
      const frag = tpl.content;
      sanitize(frag);
      absolutize(frag, base);

      if (meta && meta.length) {
        const details = document.createElement("details");
        details.className = "frontmatter";
        const s = document.createElement("summary"); s.textContent = "Metadata";
        const dl = document.createElement("dl");
        for (const [k, v] of meta) {
          const dt = document.createElement("dt"); dt.textContent = k;
          const dd = document.createElement("dd"); dd.textContent = v;
          dl.append(dt, dd);
        }
        details.append(s, dl);
        frag.prepend(details);
      }

      this.present(frag, decorate(frag), null, keepScroll, !body.trim());
    }

    renderBook(book, keepScroll) {
      const norm = href => { try { const u = new URL(href); const hash = u.hash; u.hash = ""; return [u.href, hash]; } catch (_) { return [href, ""]; } };
      const chapterIndex = new Map(book.chapters.map((c, n) => [norm(c.url)[0], n]));
      // doc://…/ch3.xhtml#note-2 → "c3-note-2"; a bare chapter → its section.
      const localId = href => {
        const [page, hash] = norm(href);
        const n = chapterIndex.get(page);
        if (n === undefined) return null;
        if (hash.length < 2) return `ch-${n}`;
        let frag = hash.slice(1);
        try { frag = decodeURIComponent(frag); } catch (_) {}
        return `c${n}-${frag}`;
      };

      const frag = document.createDocumentFragment();
      book.chapters.forEach((c, n) => {
        const section = document.createElement("section");
        section.className = "chapter";
        for (const node of Array.from(parseChapter(c.html).childNodes)) section.append(document.importNode(node, true));
        rebaseChapter(section, c.url, n, localId);
        section.id = `ch-${n}`;
        frag.append(section);
      });
      frag.querySelectorAll("style").forEach(el => el.remove());
      sanitize(frag);
      const headingToc = decorate(frag);

      // Prefer the book's own table of contents; several entries can share a target, so each gets a marker.
      const byId = new Map();
      frag.querySelectorAll("[id]").forEach(el => { if (!byId.has(el.id)) byId.set(el.id, el); });
      const toc = [], marks = [];
      for (const entry of book.toc || []) {
        const id = localId(entry.href);
        const target = id && byId.get(id);
        if (!target) continue;
        const mark = document.createElement("span");
        mark.className = "toc-mark";
        mark.id = `toc-${toc.length}`;
        target.before(mark);
        marks.push(mark);
        toc.push({ id: mark.id, level: entry.level, title: entry.title });
      }

      const useBookToc = toc.length > 0;
      this.present(frag, useBookToc ? toc : headingToc,
        useBookToc ? () => marks.slice().sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1) : null,
        keepScroll, !book.chapters.length);
    }

    // ---------- find ----------

    /** Highlights every match of `query`; returns { count, index }. */
    search(query, keepIndex) {
      const previous = this.find.index;
      this.find = { query, ranges: [], index: -1 };
      if (query) {
        // One flat string over all text nodes, so matches can span inline markup.
        const nodes = [], starts = [];
        let flat = "";
        const walker = document.createTreeWalker(this.content, NodeFilter.SHOW_TEXT, {
          acceptNode: n => n.parentElement && n.parentElement.closest(".anchor, .copy, style, script") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        });
        for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push(n); starts.push(flat.length); flat += n.data; }
        const haystack = flat.toLowerCase(), needle = query.toLowerCase();
        const locate = offset => {
          let lo = 0, hi = starts.length - 1;
          while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
          return [nodes[lo], offset - starts[lo]];
        };
        if (haystack.length === flat.length) {
          for (let i = haystack.indexOf(needle); i !== -1 && this.find.ranges.length < 5000; i = haystack.indexOf(needle, i + needle.length)) {
            const r = new Range();
            r.setStart(...locate(i));
            const [endNode, endOffset] = locate(i + needle.length - 1);
            r.setEnd(endNode, endOffset + 1);
            this.find.ranges.push(r);
          }
        }
      }
      if (this.find.ranges.length) {
        this.find.index = keepIndex && previous >= 0 ? Math.min(previous, this.find.ranges.length - 1) : this.firstVisibleMatch();
      }
      this.paintFind(!keepIndex);
      return this.findState();
    }

    firstVisibleMatch() {
      const top = this.el.getBoundingClientRect().top;
      const i = this.find.ranges.findIndex(r => r.getBoundingClientRect().top >= top);
      return i === -1 ? 0 : i;
    }

    step(backwards) {
      const n = this.find.ranges.length;
      if (!n) return this.findState();
      this.find.index = (this.find.index + (backwards ? -1 : 1) + n) % n;
      this.paintFind(true);
      return this.findState();
    }

    clearFind() {
      this.find = { query: "", ranges: [], index: -1 };
      this.paintFind(false);
    }

    findState() { return { count: this.find.ranges.length, index: this.find.index }; }

    paintFind(reveal) {
      const { ranges, index } = this.find;
      const current = ranges[index];
      if (window.CSS && CSS.highlights) {
        CSS.highlights.set("mdr-find", new Highlight(...ranges));
        if (current) CSS.highlights.set("mdr-find-current", new Highlight(current));
        else CSS.highlights.delete("mdr-find-current");
      }
      if (current && reveal) {
        const box = current.getBoundingClientRect(), view = this.el.getBoundingClientRect();
        if (box.top < view.top + 40 || box.bottom > view.bottom - 40) {
          this.el.scrollTop += box.top - view.top - this.el.clientHeight / 3;
        }
      }
    }
  }

  window.DocView = DocView;
})();
