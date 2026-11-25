// MDReader — shows a PDF in a tab's scroller, drawn with pdf.js (vendor/pdfjs: the legacy build
// of pdfjs-dist 6.5.438). Pages are drawn as they come near the view and let go once they're
// well out of it; each drawn page gets a selectable text layer, which Find searches, and its
// links. The PDF's bookmarks become the outline. Same interface as DocView in render.js.
(function () {
  "use strict";

  const reader = document.getElementById("reader");
  const LIB = new URL("vendor/pdfjs/", document.baseURI).href;
  const GUTTER = 24;                    // px around the pages, matching .pdf-pages in reader.css
  const MAX_PIXELS = 16 * 1024 * 1024;  // per canvas; bigger pages draw at a lower resolution
  // Links in a PDF may only open the documents the reader itself opens; other files are ignored.
  const DOC_LINK = /\.(md|markdown|mdown|mkd|mkdn|mdwn|mdtxt|mdtext|txt|text|epub|pdf)$/i;

  // pdf.js is an ES module; load it (and its worker) the first time a PDF is opened.
  let loading = null;
  function loadPdfjs() {
    if (!loading) loading = import(LIB + "pdf.min.mjs").then(lib => {
      lib.GlobalWorkerOptions.workerSrc = LIB + "pdf.worker.min.mjs";
      return lib;
    }, () => { loading = null; throw new Error("Couldn't load the PDF renderer."); });
    return loading;
  }

  // A text item as the text layer lays it out: a span with its text, then a <br> at a line end,
  // which Find counts as a space so words either side of it don't run together.
  const lineText = item => item.str === undefined ? "" : item.str + (item.hasEOL ? " " : "");

  // "46rem" → px. The page-width preference sets --measure in rem.
  function toPx(length) {
    const n = parseFloat(length);
    if (/rem$/.test(length)) return n * parseFloat(getComputedStyle(document.documentElement).fontSize);
    return n || 0;
  }

  class PdfView {
    /**
     * @param {object} host  onRendered({toc, words, pages}), onActive(id), onProgress(ratio), onLink(href), onFind(state)
     */
    constructor(host) {
      this.host = host;
      this.el = document.createElement("div");
      this.el.className = "doc pdf";
      this.el.tabIndex = -1;
      this.content = document.createElement("div");
      this.content.className = "pdf-pages";
      this.el.append(this.content);
      reader.append(this.el);

      this.lib = null;
      this.pdf = null;
      this.base = "";
      this.seq = 0;            // bumped per load, so stale async work can tell
      this.slots = [];         // one per page: { el, n, w, h, near, drawn, canvas, text, links, ... }
      this.scale = 0;          // CSS px per PDF point
      this.marks = [];         // outline entries, with page positions once resolved
      this.sorted = [];        // the resolved ones in reading order
      this.texts = null;       // each page's text, for Find
      this.find = { query: "", matches: [], index: -1, pending: false };
      this.lastActive = null;
      this.ticking = false;

      this.el.addEventListener("scroll", () => this.onScroll(), { passive: true });
      this.el.addEventListener("click", e => this.onClick(e));
      // Pages within a screen of the view are drawn; the rest are released.
      this.observer = new IntersectionObserver(entries => this.onIntersect(entries), { root: this.el, rootMargin: "100% 0px" });
      this.resizer = new ResizeObserver(() => this.relayout());
      this.resizer.observe(this.el);
    }

    destroy() {
      this.seq++;
      this.observer.disconnect();
      this.resizer.disconnect();
      clearTimeout(this.redrawTimer);
      if (this.pdf) this.pdf.destroy();
      this.pdf = null;
      this.el.remove();
    }

    get visible() { return !this.el.hidden; }

    // A hidden scroller has no layout, so its position is kept by hand.
    show() {
      this.el.hidden = false;
      if (this.savedScroll != null) { this.el.scrollTop = this.savedScroll; this.savedScroll = null; }
      if (this.needsLayout) this.relayout();
      this.onScroll(true);
    }
    hide() {
      if (!this.el.hidden) this.savedScroll = this.el.scrollTop;
      this.el.hidden = true;
    }

    redrawDiagrams() {}

    // ---------- loading ----------

    /** Shows the PDF in `data` (its bytes). Rejects if it can't be read; a failed reload keeps the old one. */
    async renderPdf(data, base, keepScroll) {
      const seq = ++this.seq;
      const lib = this.lib = await loadPdfjs();
      const task = lib.getDocument({
        data, docBaseUrl: base,
        cMapUrl: LIB + "cmaps/", standardFontDataUrl: LIB + "standard_fonts/", wasmUrl: LIB + "wasm/", iccUrl: LIB + "iccs/",
        enableXfa: false, disableWorkerRendering: true
      });
      const locked = new Promise((_, reject) => {
        task.onPassword = () => { reject(new Error("This PDF is protected with a password, which MDReader can't open yet.")); task.destroy(); };
      });
      const pdf = await Promise.race([task.promise, locked]);
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
      if (seq !== this.seq) { pdf.destroy(); return; }

      const anchor = keepScroll && this.scale ? this.position() : null;
      const old = this.pdf;
      const reuse = !!old && old.numPages === pdf.numPages;
      Object.assign(this, { pdf, base, texts: null, textsLoading: null, marks: [], sorted: [], lastActive: undefined });
      this.buildSlots(pdf.numPages, first, reuse);
      if (old) old.destroy();

      // Bookmarks: reported now, placed once their destinations are resolved.
      const toc = this.readOutline(await pdf.getOutline().catch(() => null));
      if (seq !== this.seq) return;
      this.host.onRendered({ toc, words: 0, pages: pdf.numPages });

      this.scale = 0; // forces a fresh layout and redraw
      if (this.el.hidden) {
        // A background tab: lay out when it's shown.
        if (!keepScroll) this.savedScroll = 0;
        this.needsLayout = true;
      } else {
        this.relayout();
        if (anchor) this.scrollToPos(anchor);
        else { this.el.scrollTop = 0; this.el.scrollLeft = 0; }
      }
      if (this.find.query) this.search(this.find.query, true);
      this.placeMarks(seq);
      this.measurePages(seq);
      this.onScroll(true);
    }

    buildSlots(count, size, reuse) {
      if (reuse) {
        // Live reload with the same page count: keep the old pictures until the new ones are drawn.
        for (const s of this.slots) {
          if (s.task) s.task.cancel();
          this.dropLayers(s);
          s.drawn = 0;
        }
        return;
      }
      this.observer.disconnect();
      this.content.replaceChildren();
      this.slots = [];
      for (let n = 0; n < count; n++) {
        const el = document.createElement("div");
        el.className = "pdf-page";
        el.dataset.page = n + 1;
        this.content.append(el);
        // Until a page is measured it's assumed to be the size of the first.
        this.slots.push({ el, n, w: size.width, h: size.height, near: false, drawn: 0 });
        this.observer.observe(el);
      }
    }

    // Pages can differ in size; measure them all in the background, keeping the reader's place.
    async measurePages(seq) {
      const pdf = this.pdf;
      for (let start = 1; start < this.slots.length; start += 50) {
        const views = await Promise.all(this.slots.slice(start, start + 50).map(s =>
          pdf.getPage(s.n + 1).then(p => p.getViewport({ scale: 1 }), () => null)));
        if (seq !== this.seq) return;
        let changed = false;
        views.forEach((v, i) => {
          const s = this.slots[start + i];
          if (v && (Math.abs(v.width - s.w) > 0.5 || Math.abs(v.height - s.h) > 0.5)) { s.w = v.width; s.h = v.height; changed = true; }
        });
        if (!changed) continue;
        if (this.scale && !this.el.hidden) {
          const at = this.position();
          this.applySizes();
          this.scrollToPos(at);
        } else {
          this.scale = 0;
          this.needsLayout = true;
        }
      }
    }

    // ---------- layout ----------

    /** Fits the first page to the page-width preference, times the zoom. */
    fitScale() {
      const style = getComputedStyle(reader);
      const zoom = parseFloat(style.getPropertyValue("--pdf-zoom")) || 1;
      const measure = style.getPropertyValue("--measure").trim();
      const room = Math.max(200, this.el.clientWidth - 2 * GUTTER);
      const width = measure === "none" ? room : Math.min(room, toPx(measure));
      return width * zoom / this.slots[0].w;
    }

    /** Re-fits the pages after a zoom, page-width or window change. */
    relayout() {
      if (!this.pdf || !this.slots.length) return;
      if (this.el.hidden || !this.el.clientWidth) { this.needsLayout = true; return; }
      this.needsLayout = false;
      const scale = this.fitScale();
      if (Math.abs(scale - this.scale) < 1e-3) return;
      const at = this.scale ? this.position() : null;
      this.scale = scale;
      this.applySizes();
      if (at) this.scrollToPos(at);
      // The old pictures stretch meanwhile; redraw once resizing settles.
      clearTimeout(this.redrawTimer);
      this.redrawTimer = setTimeout(() => { for (const s of this.slots) if (s.near) this.draw(s); }, this.drawnOnce ? 150 : 0);
      this.drawnOnce = true;
      this.onScroll();
    }

    applySizes() {
      // The text layer sizes its runs from these.
      this.content.style.setProperty("--total-scale-factor", this.scale);
      for (const s of this.slots) {
        s.el.style.width = Math.floor(s.w * this.scale) + "px";
        s.el.style.height = Math.floor(s.h * this.scale) + "px";
      }
    }

    /** Where the view is: which page is at the top, and how far down it. */
    position() {
      const y = this.el.scrollTop;
      let lo = 0, hi = this.slots.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.slots[mid].el.offsetTop <= y) lo = mid; else hi = mid - 1; }
      const s = this.slots[lo];
      return { page: lo, frac: (y - s.el.offsetTop) / Math.max(1, s.el.offsetHeight) };
    }

    scrollToPos({ page, frac }, smooth, margin = 0) {
      const s = this.slots[page];
      if (!s) return;
      const top = s.el.offsetTop + frac * s.el.offsetHeight - margin;
      this.el.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    }

    // ---------- drawing ----------

    onIntersect(entries) {
      if (this.el.hidden) return; // hiding the tab isn't scrolling away
      for (const e of entries) {
        const s = this.slots[Number(e.target.dataset.page) - 1];
        if (!s || s.el !== e.target) continue;
        s.near = e.isIntersecting;
        if (s.near) { if (this.scale) this.draw(s); }
        else this.release(s);
      }
    }

    async draw(s) {
      const { seq, scale, pdf } = this;
      if (!pdf || s.drawn === scale || s.drawing === scale) return;
      s.drawing = scale;
      if (s.task) s.task.cancel();
      let task = null;
      try {
        const page = await pdf.getPage(s.n + 1);
        if (seq !== this.seq || scale !== this.scale || !s.near) return;
        const viewport = page.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)));
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        task = s.task = page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
        await task.promise;
        if (seq !== this.seq || scale !== this.scale || !s.near) { canvas.width = 0; return; }
        if (s.canvas) { s.canvas.width = 0; s.canvas.remove(); }
        s.canvas = canvas;
        s.el.prepend(canvas);
        s.drawn = scale;
        if (!s.text) this.addText(s, page);
        if (!s.links) this.addLinks(s, page);
      } catch (err) {
        if (!err || err.name !== "RenderingCancelledException") console.warn(`PDF page ${s.n + 1}:`, err);
      } finally {
        if (s.drawing === scale) s.drawing = 0;
        if (task && s.task === task) s.task = null;
      }
    }

    // Frees a page that's far from view: its picture, text and links come back when it nears again.
    release(s) {
      if (s.task) { s.task.cancel(); s.task = null; }
      s.drawing = 0;
      if (s.canvas) { s.canvas.width = 0; s.canvas.remove(); s.canvas = null; }
      s.drawn = 0;
      this.dropLayers(s);
    }

    dropLayers(s) {
      if (s.text) { s.text.remove(); s.text = null; }
      if (s.links) { s.links.remove(); s.links = null; }
      s.map = null;
      s.textReady = false;
    }

    // Transparent text over the picture, positioned to match it, for selection and Find.
    async addText(s, page) {
      const div = document.createElement("div");
      div.className = "textLayer";
      s.text = div;
      s.el.append(div);
      const layer = new this.lib.TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true }),
        container: div,
        viewport: page.getViewport({ scale: this.scale })
      });
      try { await layer.render(); } catch (_) { return; }
      if (s.text !== div) return;
      s.textReady = true;
      this.onTextReady(s);
    }

    async addLinks(s, page) {
      const box = document.createElement("div");
      box.className = "pdf-links";
      s.links = box;
      s.el.append(box);
      const annotations = await page.getAnnotations({ intent: "display" }).catch(() => []);
      if (s.links !== box) return;
      const view = page.getViewport({ scale: 1 });
      for (const a of annotations) {
        if (a.subtype !== "Link" || !a.rect) continue;
        const href = this.linkTarget(a.url || a.unsafeUrl);
        if (!href && a.dest == null && !a.action) continue;
        const [x1, y1] = view.convertToViewportPoint(a.rect[0], a.rect[1]);
        const [x2, y2] = view.convertToViewportPoint(a.rect[2], a.rect[3]);
        const link = document.createElement("a");
        const pct = (v, of) => (100 * v / of).toFixed(3) + "%";
        Object.assign(link.style, {
          left: pct(Math.min(x1, x2), view.width), top: pct(Math.min(y1, y2), view.height),
          width: pct(Math.abs(x2 - x1), view.width), height: pct(Math.abs(y2 - y1), view.height)
        });
        if (href) { link.href = href; link.title = href; }
        else { link.href = "#"; link.dest = a.dest; link.action = a.action; }
        box.append(link);
      }
    }

    /** A link's URL if it's one the reader may follow: the web, mail, or another readable document. */
    linkTarget(raw) {
      if (!raw) return null;
      try {
        const url = new URL(raw, this.base), doc = new URL(this.base);
        if (url.protocol === doc.protocol && url.host === doc.host) return DOC_LINK.test(url.pathname) ? url.href : null;
        return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
      } catch (_) { return null; }
    }

    onClick(e) {
      const a = e.target.closest(".pdf-links a");
      if (!a) return;
      e.preventDefault();
      if (a.dest != null) this.resolveDest(a.dest).then(at => { if (at) this.scrollToPos(at, true, 12); });
      else if (a.action) this.namedAction(a.action);
      else this.host.onLink(a.href);
    }

    namedAction(action) {
      const { page } = this.position();
      const to = { NextPage: page + 1, PrevPage: page - 1, FirstPage: 0, LastPage: this.slots.length - 1 }[action];
      if (to !== undefined) this.scrollToPos({ page: Math.max(0, Math.min(this.slots.length - 1, to)), frac: 0 }, true, 12);
    }

    // ---------- outline ----------

    readOutline(outline) {
      const toc = [];
      const walk = (items, level) => {
        for (const item of items || []) {
          const id = `pdf-o-${toc.length}`;
          toc.push({ id, level, title: (item.title || "").trim() || "Untitled" });
          this.marks.push({ id, dest: item.dest, url: item.url || item.unsafeUrl, page: null, frac: 0 });
          walk(item.items, level + 1);
        }
      };
      walk(outline, 1);
      return toc;
    }

    async placeMarks(seq) {
      await Promise.all(this.marks.map(async m => {
        const at = m.dest != null ? await this.resolveDest(m.dest) : null;
        if (at) Object.assign(m, at);
      }));
      if (seq !== this.seq) return;
      this.sorted = this.marks.filter(m => m.page !== null).sort((a, b) => a.page - b.page || a.frac - b.frac);
      this.lastActive = undefined;
      this.onScroll(true);
    }

    /** A named or explicit destination → { page, frac }, frac being how far down the page it points. */
    async resolveDest(dest) {
      const pdf = this.pdf;
      try {
        const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
        if (!Array.isArray(explicit)) return null;
        const ref = explicit[0];
        const page = ref && typeof ref === "object" ? await pdf.getPageIndex(ref) : Number.isInteger(ref) ? ref : -1;
        if (!(page >= 0 && page < pdf.numPages)) return null;
        const kind = explicit[1] && explicit[1].name;
        const top = kind === "XYZ" ? explicit[3] : kind === "FitH" || kind === "FitBH" ? explicit[2] : kind === "FitR" ? explicit[5] : null;
        let frac = 0;
        if (typeof top === "number") {
          const view = (await pdf.getPage(page + 1)).getViewport({ scale: 1 });
          frac = Math.min(1, Math.max(0, view.convertToViewportPoint(0, top)[1] / view.height));
        }
        return { page, frac };
      } catch (_) {
        return null;
      }
    }

    markY(m) { const s = this.slots[m.page]; return s.el.offsetTop + m.frac * s.el.offsetHeight; }

    onScroll(forceReport) {
      if (this.ticking || this.el.hidden) return;
      this.ticking = true;
      requestAnimationFrame(() => {
        this.ticking = false;
        const el = this.el;
        const max = el.scrollHeight - el.clientHeight;
        this.host.onProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
        const marks = this.sorted;
        let active = marks.length ? marks[0].id : null;
        for (const m of marks) { if (this.markY(m) - el.scrollTop <= 70) active = m.id; else break; }
        if (max > 0 && el.scrollTop >= max - 2 && marks.length) active = marks[marks.length - 1].id;
        if (active !== this.lastActive || forceReport) { this.lastActive = active; this.host.onActive(active); }
      });
    }

    /** An outline entry, or a link's fragment: #page=3, #nameddest=intro or #intro. */
    scrollToId(id, smooth = true) {
      if (!this.pdf) return;
      const mark = this.marks.find(m => m.id === id);
      if (mark) {
        if (mark.page !== null) this.scrollToPos(mark, smooth, 12);
        else { const href = this.linkTarget(mark.url); if (href) this.host.onLink(href); }
        return;
      }
      const params = new URLSearchParams(id.includes("=") ? id : "");
      const page = parseInt(params.get("page"), 10);
      if (page > 0) return this.scrollToPos({ page: Math.min(page, this.slots.length) - 1, frac: 0 }, smooth, 12);
      const name = id.includes("=") ? params.get("nameddest") : id;
      if (name) this.resolveDest(name).then(at => { if (at) this.scrollToPos(at, smooth, 12); });
    }

    // ---------- find ----------

    /** Every page's text, as the text layer lays it out, so matches map onto its spans. */
    loadTexts() {
      if (this.textsLoading) return;
      const { seq, pdf } = this;
      this.textsLoading = (async () => {
        const texts = [];
        for (let start = 0; start < pdf.numPages; start += 16) {
          const batch = [];
          for (let n = start; n < Math.min(start + 16, pdf.numPages); n++) {
            batch.push(pdf.getPage(n + 1)
              .then(p => p.getTextContent({ includeMarkedContent: true }))
              .then(tc => tc.items.map(lineText).join(""), () => ""));
          }
          texts.push(...await Promise.all(batch));
          if (seq !== this.seq) return;
        }
        this.texts = texts;
        if (!this.find.query) return;
        // Finish the search that was waiting, as it was asked for.
        const { keep, previous } = this.find.resume || {};
        this.find.index = previous == null ? -1 : previous;
        const state = this.search(this.find.query, !!keep);
        if (this.host.onFind) this.host.onFind(state);
      })();
    }

    /** Finds every match of `query`; returns { count, index, pending } (pending while the text loads). */
    search(query, keepIndex) {
      const previous = this.find.index;
      this.find = { query, matches: [], index: -1, pending: false };
      if (query && this.pdf) {
        if (!this.texts) {
          this.find.pending = true;
          this.find.resume = { keep: keepIndex, previous };
          this.loadTexts();
        }
        else {
          const needle = query.toLowerCase(), matches = this.find.matches;
          this.texts.forEach((text, page) => {
            const hay = text.toLowerCase();
            if (hay.length !== text.length) return; // case folding changed the length; offsets wouldn't map
            for (let i = hay.indexOf(needle); i !== -1 && matches.length < 5000; i = hay.indexOf(needle, i + needle.length)) {
              matches.push({ page, start: i, end: i + needle.length });
            }
          });
          if (matches.length) {
            if (keepIndex && previous >= 0) this.find.index = Math.min(previous, matches.length - 1);
            else {
              const here = this.scale ? this.position().page : 0;
              const i = matches.findIndex(m => m.page >= here);
              this.find.index = i === -1 ? 0 : i;
            }
          }
        }
      }
      this.paintFind(!keepIndex);
      return this.findState();
    }

    step(backwards) {
      const n = this.find.matches.length;
      if (!n) return this.findState();
      this.find.index = (this.find.index + (backwards ? -1 : 1) + n) % n;
      this.paintFind(true);
      return this.findState();
    }

    clearFind() {
      this.find = { query: "", matches: [], index: -1, pending: false };
      this.paintFind(false);
    }

    findState() { return { count: this.find.matches.length, index: this.find.index, pending: this.find.pending }; }

    onTextReady(s) {
      const current = this.find.matches[this.find.index];
      const reveal = this.pendingReveal === s.n && current && current.page === s.n;
      if (reveal) this.pendingReveal = null;
      if (this.find.matches.some(m => m.page === s.n)) this.paintFind(reveal);
    }

    /** A match as a Range over the page's text layer, if that page's text is on screen. */
    rangeFor(m) {
      const s = this.slots[m.page];
      if (!s || !s.textReady) return null;
      if (!s.map) {
        // Text nodes, and <br>s standing for one space each (see lineText).
        const nodes = [], starts = [];
        let length = 0;
        const walker = document.createTreeWalker(s.text, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
          acceptNode: n => n.nodeType === Node.TEXT_NODE || n.localName === "br" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
        });
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          nodes.push(n); starts.push(length); length += n.nodeType === Node.TEXT_NODE ? n.data.length : 1;
        }
        s.map = { nodes, starts, length };
      }
      const { nodes, starts, length } = s.map;
      if (!nodes.length || m.end > length) return null;
      const locate = offset => {
        let lo = 0, hi = starts.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
        return [nodes[lo], offset - starts[lo]];
      };
      const r = new Range();
      const [startNode, startOffset] = locate(m.start);
      if (startNode.nodeType === Node.TEXT_NODE) r.setStart(startNode, startOffset); else r.setStartBefore(startNode);
      const [endNode, endOffset] = locate(m.end - 1);
      if (endNode.nodeType === Node.TEXT_NODE) r.setEnd(endNode, endOffset + 1); else r.setEndAfter(endNode);
      return r;
    }

    paintFind(reveal) {
      const { matches, index } = this.find;
      const ranges = [];
      let current = null;
      matches.forEach((m, i) => {
        const r = this.rangeFor(m);
        if (r) ranges.push(r);
        if (i === index) current = r;
      });
      if (window.CSS && CSS.highlights) {
        CSS.highlights.set("mdr-find", new Highlight(...ranges));
        if (current) CSS.highlights.set("mdr-find-current", new Highlight(current));
        else CSS.highlights.delete("mdr-find-current");
      }
      if (!reveal || !matches[index]) return;
      if (current) {
        const box = current.getBoundingClientRect(), view = this.el.getBoundingClientRect();
        if (box.top < view.top + 40 || box.bottom > view.bottom - 40) this.el.scrollTop += box.top - view.top - this.el.clientHeight / 3;
      } else {
        // Its page isn't drawn yet: go there, and finish the job when its text arrives.
        this.pendingReveal = matches[index].page;
        this.scrollToPos({ page: matches[index].page, frac: 0 }, false, 12);
      }
    }
  }

  window.PdfView = PdfView;
})();
