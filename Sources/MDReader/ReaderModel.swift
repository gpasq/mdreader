import SwiftUI
import WebKit

struct TOCItem: Identifiable, Hashable {
    let id: String
    let level: Int
    let title: String
}

/// Per-window state: the document text, its outline, and a handle on the web view.
@Observable
@MainActor
final class ReaderModel {
    private(set) var text: String
    /// Bumped whenever `text` changes so the web view knows to re-render.
    private(set) var revision = 0
    let fileURL: URL?

    var toc: [TOCItem] = []
    var activeHeading: String?
    var wordCount = 0
    var searchText = ""
    var searchFocused = false

    @ObservationIgnored weak var webView: WKWebView?
    @ObservationIgnored private var watcher: FileWatcher?

    init(text: String, fileURL: URL?) {
        self.text = text
        self.fileURL = fileURL
    }

    var readingMinutes: Int { max(1, Int((Double(wordCount) / 230).rounded())) }

    var baseHref: String? {
        fileURL?.deletingLastPathComponent().absoluteString
    }

    func startWatching() {
        guard watcher == nil, let fileURL else { return }
        watcher = FileWatcher(url: fileURL) { [weak self] in
            Task { @MainActor in self?.reloadFromDisk() }
        }
    }

    func update(text newText: String) {
        guard newText != text else { return }
        text = newText
        revision += 1
    }

    func reloadFromDisk() {
        guard let fileURL, let data = try? Data(contentsOf: fileURL) else { return }
        update(text: MarkdownDocument.decode(data))
    }

    // MARK: Actions

    func scroll(to id: String) {
        activeHeading = id
        webView?.callAsyncJavaScript("mdr.scrollToId(id)", arguments: ["id": id], in: nil, in: .page)
    }

    func find(backwards: Bool = false) {
        guard let webView, !searchText.isEmpty else { return }
        let config = WKFindConfiguration()
        config.backwards = backwards
        config.caseSensitive = false
        config.wraps = true
        webView.find(searchText, configuration: config) { _ in }
    }

    func print() {
        runPrintOperation(with: makePrintInfo())
    }

    /// Asks where to save, then prints the page straight to a paginated PDF.
    func exportPDF() {
        guard let webView, let window = webView.window else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = (fileURL?.deletingPathExtension().lastPathComponent ?? "Untitled") + ".pdf"
        if let dir = fileURL?.deletingLastPathComponent() { panel.directoryURL = dir }
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url, let self else { return }
            let info = self.makePrintInfo()
            info.jobDisposition = .save
            info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = url
            // Let the save sheet finish closing before the print sheet machinery runs.
            DispatchQueue.main.async {
                self.runPrintOperation(with: info, showPanels: false)
            }
        }
    }

    private func makePrintInfo() -> NSPrintInfo {
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.topMargin = 48; info.bottomMargin = 48
        info.leftMargin = 54; info.rightMargin = 54
        return info
    }

    private func runPrintOperation(with info: NSPrintInfo, showPanels: Bool = true) {
        guard let webView, let window = webView.window else { return }
        let op = webView.printOperation(with: info)
        op.view?.frame = webView.bounds
        op.showsPrintPanel = showPanels
        op.showsProgressPanel = showPanels
        op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }

    func revealInFinder() {
        guard let fileURL else { return }
        NSWorkspace.shared.activateFileViewerSelecting([fileURL])
    }

    func openInDefaultEditor() {
        guard let fileURL else { return }
        let textEdit = URL(fileURLWithPath: "/System/Applications/TextEdit.app")
        let editor = NSWorkspace.shared.urlsForApplications(toOpen: fileURL)
            .first { $0 != Bundle.main.bundleURL } ?? textEdit
        NSWorkspace.shared.open([fileURL], withApplicationAt: editor, configuration: NSWorkspace.OpenConfiguration())
    }
}

// MARK: - Focused value so menu commands can reach the frontmost reader

struct ReaderModelKey: FocusedValueKey {
    typealias Value = ReaderModel
}

extension FocusedValues {
    var reader: ReaderModel? {
        get { self[ReaderModelKey.self] }
        set { self[ReaderModelKey.self] = newValue }
    }
}
