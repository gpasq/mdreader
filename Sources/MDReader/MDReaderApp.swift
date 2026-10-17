import SwiftUI
import UniformTypeIdentifiers

@main
struct MDReaderApp: App {
    @AppStorage(PrefKey.theme) private var theme: ReaderTheme = .auto
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
                Picker("Theme", selection: $theme) {
                    ForEach(ReaderTheme.allCases) { Text($0.title).tag($0) }
                }
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
