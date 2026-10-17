import SwiftUI
import WebKit

/// Hosts the bundled reader page and feeds it markdown + style preferences.
struct MarkdownWebView: NSViewRepresentable {
    let model: ReaderModel
    let prefs: ReaderPrefs

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(WeakMessageHandler(context.coordinator), name: "mdr")
        config.preferences.isElementFullscreenEnabled = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsMagnification = true
        webView.alphaValue = 0 // revealed after the first render, avoids a flash
        #if DEBUG
        webView.isInspectable = true
        #endif

        context.coordinator.webView = webView
        context.coordinator.prefs = prefs
        model.webView = webView

        if let page = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            webView.loadFileURL(page, allowingReadAccessTo: URL(fileURLWithPath: "/"))
        }
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let c = context.coordinator
        if c.prefs != prefs {
            c.prefs = prefs
            c.applyPrefs()
        }
        if c.renderedRevision != model.revision {
            c.render(keepScroll: true)
        }
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "mdr")
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let model: ReaderModel
        weak var webView: WKWebView?
        var prefs: ReaderPrefs?
        var ready = false
        var renderedRevision = -1

        init(model: ReaderModel) { self.model = model }

        func applyPrefs() {
            guard ready, let webView, let prefs else { return }
            webView.callAsyncJavaScript("mdr.setPrefs(p)", arguments: ["p": prefs.jsArguments], in: nil, in: .page)
        }

        func render(keepScroll: Bool) {
            guard ready, let webView else { return }
            renderedRevision = model.revision
            webView.callAsyncJavaScript(
                "mdr.render(md, base, keep)",
                arguments: ["md": model.text, "base": model.baseHref ?? "", "keep": keepScroll],
                in: nil, in: .page
            )
        }

        // MARK: Messages from the page

        nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            MainActor.assumeIsolated {
                guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
                handle(type: type, body: body)
            }
        }

        private func handle(type: String, body: [String: Any]) {
            switch type {
            case "ready":
                ready = true
                applyPrefs()
                render(keepScroll: false)

            case "rendered":
                let raw = body["toc"] as? [[String: Any]] ?? []
                model.toc = raw.compactMap { item in
                    guard let id = item["id"] as? String, let title = item["title"] as? String else { return nil }
                    return TOCItem(id: id, level: (item["level"] as? Int) ?? 1, title: title)
                }
                model.wordCount = body["words"] as? Int ?? 0
                if let webView, webView.alphaValue < 1 {
                    NSAnimationContext.runAnimationGroup { ctx in
                        ctx.duration = 0.18
                        webView.animator().alphaValue = 1
                    }
                }

            case "active":
                model.activeHeading = body["id"] as? String

            case "copy":
                if let text = body["text"] as? String {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(text, forType: .string)
                }

            case "link":
                if let href = body["href"] as? String, let url = URL(string: href) { open(url) }

            default:
                break
            }
        }

        private func open(_ url: URL) {
            if url.isFileURL {
                var clean = URLComponents(url: url, resolvingAgainstBaseURL: false)
                clean?.fragment = nil
                let target = clean?.url ?? url
                if Self.markdownExtensions.contains(target.pathExtension.lowercased()) {
                    NSDocumentController.shared.openDocument(withContentsOf: target, display: true) { _, _, _ in }
                    return
                }
            }
            NSWorkspace.shared.open(url)
        }

        static let markdownExtensions: Set<String> = ["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext", "text", "txt"]

        // MARK: Navigation — the page never navigates away from itself

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            if action.navigationType == .other, action.targetFrame?.isMainFrame == true,
               action.request.url?.lastPathComponent == "index.html" {
                decisionHandler(.allow)
                return
            }
            if action.targetFrame?.isMainFrame == false {
                decisionHandler(.allow) // sub-resources
                return
            }
            if let url = action.request.url, action.navigationType == .linkActivated { open(url) }
            decisionHandler(.cancel)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            ready = false
            renderedRevision = -1
            webView.reload()
        }
    }
}

/// Breaks the WKUserContentController → handler retain cycle.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
