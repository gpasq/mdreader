// MDReader — rendering bridge between Swift and the page.
(function () {
  "use strict";

  const content = document.getElementById("content");
  const progress = document.getElementById("progress");
  const base = document.getElementById("doc-base");
  const shellURL = location.href;

  function post(type, payload) {
    try { window.webkit.messageHandlers.mdr.postMessage(Object.assign({ type }, payload || {})); }
    catch (_) { /* running outside the app */ }
  }

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

  // Strip anything executable from the parsed markdown before it touches the live DOM.
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

  const ALERT_ICONS = {
    note: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
    tip: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>',
    important: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
    warning: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
    caution: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>'
  };

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
        post("copy", { text: code.textContent });
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

  // ---------- scroll tracking ----------

  let headings = [];
  let lastActive = null;
  let ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      progress.style.width = (max > 0 ? Math.min(100, (scrollY / max) * 100) : 0) + "%";
      let active = headings.length ? headings[0].id : null;
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= 90) active = h.id; else break;
      }
      if (max > 0 && scrollY >= max - 2 && headings.length) active = headings[headings.length - 1].id;
      if (active !== lastActive) { lastActive = active; post("active", { id: active }); }
    });
  }
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });

  // ---------- links ----------

  document.addEventListener("click", e => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const raw = a.getAttribute("href");
    e.preventDefault();
    if (raw.startsWith("#")) { scrollToId(decodeURIComponent(raw.slice(1))); return; }
    post("link", { href: a.href });
  });

  function scrollToId(id, smooth = true) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  }

  // ---------- public API (called from Swift) ----------

  let appliedVars = [];

  window.mdr = {
    render(markdown, baseHref, keepScroll) {
      const prevRatio = keepScroll ? scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight) : 0;
      const prevY = scrollY;
      base.href = baseHref || shellURL;

      const { body, meta } = splitFrontMatter(markdown);
      const tpl = document.createElement("template");
      tpl.innerHTML = marked.parse(body);
      const frag = tpl.content;
      sanitize(frag);

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

      const toc = decorate(frag);
      content.replaceChildren(frag);
      if (!keepScroll) { content.classList.remove("fade-in"); void content.offsetWidth; content.classList.add("fade-in"); }
      if (!body.trim()) content.innerHTML = '<p class="empty">This document is empty.</p>';

      headings = Array.from(content.querySelectorAll("h1, h2, h3, h4, h5, h6"));
      lastActive = undefined;

      const text = content.innerText || "";
      const words = (text.match(/[\p{L}\p{N}’'-]+/gu) || []).length;
      post("rendered", { toc, words });

      if (keepScroll) {
        const max = document.documentElement.scrollHeight - innerHeight;
        scrollTo(0, prevY <= max ? prevY : prevRatio * max);
      } else {
        scrollTo(0, 0);
      }
      onScroll();
    },

    setPrefs(p) {
      const root = document.documentElement;
      if (p.theme) root.dataset.theme = p.theme;
      // Palette themes set their base colors inline; clear them for the reader's own themes.
      for (const name of appliedVars) root.style.removeProperty(name);
      appliedVars = [];
      if (p.vars) {
        for (const [name, value] of Object.entries(p.vars)) { root.style.setProperty(name, value); appliedVars.push(name); }
      }
      root.toggleAttribute("data-dark", !!p.dark);
      if (p.typeface) root.dataset.typeface = p.typeface;
      if (p.fontSize) root.style.setProperty("--font-size", p.fontSize + "px");
      if (p.measure) root.style.setProperty("--measure", p.measure + "rem");
      onScroll();
    },

    scrollToId
  };

  post("ready");
})();
