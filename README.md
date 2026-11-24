---
title: MDReader
version: 1.0
---
# MDReader

A quiet reader for **Markdown** files and **EPUB** books, for macOS and Windows (x64 and ARM64). Open any `.md` or `.epub` file and it is typeset for reading — with an outline sidebar, live reload, syntax-highlighted code, and light, sepia and dark themes.

> [!TIP]
> On macOS, choose **More (⋯) › Make MDReader the Default Markdown App…** in the toolbar once, and every `.md` file you double-click in Finder opens here. On Windows the installer registers `.md` and `.epub`; the same item takes you to the Settings page where you pick it.

## Features

- GitHub-flavored Markdown: tables, task lists, ~~strikethrough~~, autolinks, GitHub-style alerts
- **Tabs** — every file you open joins the same window as a tab (<kbd>⌘/Ctrl</kbd> <kbd>T</kbd> to open another); open tabs come back next launch
- Outline sidebar that follows your scroll position
- **Live reload** — edit the file in any editor and the page updates in place, keeping your spot
- Syntax highlighting for 190+ languages, with a one-click *Copy* button
- **Mermaid diagrams** — ```` ```mermaid ```` blocks are drawn as flowcharts, sequence diagrams and more, in the current theme
- Themes: Match System, Light, Sepia, Dark, plus VS Code themes — Dark+, Light+, Monokai, Dracula, One Dark Pro, GitHub Light/Dark, Solarized Light/Dark, Nord — and **Import VS Code Theme…** for any theme `.json`
- A reading pane that can stay white, sepia or dark whatever the app theme
- Sans or serif type; three page widths or fit-to-window
- Find in document, print, export as PDF, text size
- Relative images and links to other Markdown files just work; drop files on the window to open them
- **EPUB books** — `.epub` files (and unpacked EPUB folders, as Apple Books stores them) open as one continuous page in your theme, with the book's own table of contents in the sidebar and working cross-references

### Task list

- [x] Render Markdown beautifully
- [x] Follow the system appearance
- [x] Run on Windows too
- [ ] Write the next great README

## Building

MDReader is a [Tauri 2](https://tauri.app) app: a Rust backend with the reader drawn in the system webview (WKWebView on macOS, WebView2 on Windows).

Requires [Rust](https://rustup.rs) and Node.js 18+, plus the Xcode Command Line Tools on macOS or the Visual Studio C++ Build Tools on Windows.

```bash
npm install
npm run app               # build and run the app, no installer (`npm run app -- file.md` opens a file)
npm run dev               # run from source with live reload, for development

npm run build:mac         # universal .app and .dmg (Apple silicon + Intel)
npm run build:win-x64     # NSIS installer and .msi
npm run build:win-arm64   # NSIS installer for Windows on ARM
```

Cross-target builds need the Rust target first, e.g. `rustup target add aarch64-pc-windows-msvc` (and the MSVC ARM64 build tools), or `rustup target add x86_64-apple-darwin aarch64-apple-darwin` for the universal Mac build. Pushing a `v*` tag runs `.github/workflows/build.yml`, which builds all three.

Builds are unsigned. On macOS, right-click the app and choose **Open** the first time; Windows SmartScreen may ask you to confirm too.

## Keyboard shortcuts

| Action                 | macOS     | Windows              |
| ---------------------- | --------- | -------------------- |
| Open / Open in New Tab | ⌘ O / ⌘ T | Ctrl+O / Ctrl+T      |
| Close Tab              | ⌘ W       | Ctrl+W               |
| Next / Previous Tab    | ⌃ Tab / ⌃ ⇧ Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Find / Find Next       | ⌘ F / ⌘ G | Ctrl+F / Ctrl+G, F3  |
| Zoom In / Out          | ⌘ + / ⌘ − | Ctrl++ / Ctrl+−      |
| Actual Size            | ⌘ 0       | Ctrl+0               |
| Reload                 | ⌘ R       | Ctrl+R, F5           |
| Toggle Sidebar         | ⌃ ⌘ S     | Ctrl+Shift+S         |
| Print                  | ⌘ P       | Ctrl+P               |
| Export as PDF          | ⇧ ⌘ E     | Ctrl+Shift+E         |

## Project layout

```
src/                  The window: index.html, chrome (app.css), reading styles (reader.css)
src/js/               app.js (tabs, sidebar, toolbar, commands), render.js (Markdown and books), themes.js
src/vendor/           marked, highlight.js, mermaid
src-tauri/src/        Rust: commands, doc: URL scheme, EPUB unpacking, file watching, printing/PDF, the macOS menu bar
src-tauri/Info.plist  macOS document types (merged into the bundle)
assets/icon-glyph.svg App icon source, borderless and full size (`npm run icons` regenerates src-tauri/icons)
assets/icon.svg       The original tiled icon design, kept for reference
```

> [!NOTE]
> Raw HTML in a document is shown, but scripts and event handlers are stripped. The page loads the document's own files through a private `doc:` scheme and can't make network requests other than loading images.

---

Built with [Tauri](https://tauri.app), [marked](https://marked.js.org), [highlight.js](https://highlightjs.org) and [Mermaid](https://mermaid.js.org).
