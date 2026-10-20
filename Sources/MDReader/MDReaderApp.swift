import SwiftUI
import UniformTypeIdentifiers

@main
struct MDReaderApp: App {
    @NSApplicationDelegateAdaptor private var appDelegate: AppDelegate
    @AppStorage(PrefKey.theme) private var themeID = ThemeLibrary.defaultID
    @AppStorage(PrefKey.fontSize) private var fontSize: Double = FontSize.default
    @FocusedValue(\.reader) private var reader

    var body: some Scene {
        DocumentGroup(viewing: MarkdownDocument.self) { file in
            ReaderView(document: file.document, fileURL: file.fileURL)
        }
        .defaultSize(width: 1080, height: 780)
        .commands {
            CommandGroup(after: .appSettings) {
                Button("Make MDReader the Default Markdown App") { makeDefault() }
            }

            CommandGroup(replacing: .printItem) {
                Button("Print…") { reader?.print() }
                    .keyboardShortcut("p")
                    .disabled(reader == nil)
            }

            CommandGroup(after: .newItem) {
                Button("Open in New Tab…") { NSDocumentController.shared.openDocument(nil) }
                    .keyboardShortcut("t")
            }

            CommandGroup(after: .textEditing) {
                Button("Find…") { reader?.searchFocused = true }
                    .keyboardShortcut("f")
                    .disabled(reader == nil)
                Button("Find Next") { reader?.find() }
                    .keyboardShortcut("g")
                    .disabled(reader == nil)
                Button("Find Previous") { reader?.find(backwards: true) }
                    .keyboardShortcut("g", modifiers: [.command, .shift])
                    .disabled(reader == nil)
            }

            CommandGroup(before: .toolbar) {
                Button("Actual Size") { fontSize = FontSize.default }
                    .keyboardShortcut("0")
                Button("Zoom In") { fontSize = min(FontSize.range.upperBound, fontSize + 1) }
                    .keyboardShortcut("+")
                Button("Zoom Out") { fontSize = max(FontSize.range.lowerBound, fontSize - 1) }
                    .keyboardShortcut("-")
                Divider()
                Menu("Theme") { ThemeMenuItems(themeID: $themeID) }
                Divider()
            }

            CommandGroup(after: .sidebar) {
                Button("Reload") { reader?.reloadFromDisk() }
                    .keyboardShortcut("r")
                    .disabled(reader == nil)
            }
        }
    }

    private func makeDefault() {
        Task { @MainActor in
            let alert = NSAlert()
            do {
                try await NSWorkspace.shared.setDefaultApplication(at: Bundle.main.bundleURL, toOpen: .markdown)
                alert.messageText = "MDReader is now your Markdown app"
                alert.informativeText = "Double-clicking a .md file in Finder will open it here."
            } catch {
                alert.alertStyle = .warning
                alert.messageText = "Couldn't change the default app"
                alert.informativeText = error.localizedDescription
            }
            alert.runModal()
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        NSWindow.allowsAutomaticWindowTabbing = true
        // Theme ids used to be bare names ("dark"); they now carry a source prefix.
        if let old = UserDefaults.standard.string(forKey: PrefKey.theme), !old.contains(".") {
            UserDefaults.standard.set("reader." + old, forKey: PrefKey.theme)
        }
    }
}
