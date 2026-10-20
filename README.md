---
title: MDReader
version: 1.0
---
# MDReader

A quiet, native macOS reader for **Markdown** files. Open any `.md` file and it is typeset for reading — with an outline sidebar, live reload, syntax-highlighted code, and light, sepia and dark themes.

> [!TIP]
> Choose **MDReader › Make MDReader the Default Markdown App** once, and every `.md` file you double-click in Finder opens here.

## Features

- GitHub-flavored Markdown: tables, task lists, ~~strikethrough~~, autolinks, GitHub-style alerts
- **Tabs** — every file you open joins the same window as a tab (<kbd>⌘</kbd> <kbd>T</kbd> to open another)
- Outline sidebar that follows your scroll position
- **Live reload** — edit the file in any editor and the page updates in place, keeping your spot
- Syntax highlighting for 190+ languages, with a one-click *Copy* button
- Themes: Match System, Light, Sepia, Dark, plus VS Code themes — Dark+, Light+, Monokai, Dracula, One Dark Pro, GitHub Light/Dark, Solarized Light/Dark, Nord — and **Import VS Code Theme…** for any theme `.json`
- San Francisco or New York type; three page widths
- Find in document (<kbd>⌘</kbd> <kbd>F</kbd>), print (<kbd>⌘</kbd> <kbd>P</kbd>), text size (<kbd>⌘</kbd> <kbd>+</kbd> / <kbd>⌘</kbd> <kbd>−</kbd>)
- Relative images and links to other Markdown files just work

### Task list

- [x] Render Markdown beautifully
- [x] Follow the system appearance
- [ ] Write the next great README

## Building

Requires macOS 15 or later and the Xcode Command Line Tools.

```bash
./build.sh            # builds build/MDReader.app
./build.sh install    # installs to /Applications and makes it the default for Markdown
```

The app is a SwiftUI document app; rendering happens in a `WKWebView`:

```swift
DocumentGroup(viewing: MarkdownDocument.self) { file in
    ReaderView(document: file.document, fileURL: file.fileURL)
}
```

## Keyboard shortcuts

| Action            | Shortcut          |
| ----------------- | ----------------- |
| Open / Open in New Tab | ⌘ O / ⌘ T    |
| Find / Find Next  | ⌘ F / ⌘ G         |
| Zoom In / Out     | ⌘ + / ⌘ −         |
| Actual Size       | ⌘ 0               |
| Reload            | ⌘ R               |
| Toggle Sidebar    | ⌃ ⌘ S             |
| Print             | ⌘ P               |

## Project layout

```
Sources/MDReader/     SwiftUI app, web view bridge, file watcher
Resources/web/        Reader page: HTML, CSS, rendering script, marked, highlight.js
Resources/Info.plist  Bundle info and .md document type registration
scripts/              Icon renderer
```

> [!NOTE]
> Raw HTML in a document is shown, but scripts and event handlers are stripped, and the page cannot make network requests other than loading images.

---

Built with [marked](https://marked.js.org) and [highlight.js](https://highlightjs.org).
