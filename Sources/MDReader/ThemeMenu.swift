import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// Theme choices grouped by source, plus importing and removing VS Code themes.
struct ThemeMenuItems: View {
    @Binding var themeID: String
    private let library = ThemeLibrary.shared

    var body: some View {
        Picker("Reader", selection: $themeID) {
            ForEach(library.readerThemes) { Label($0.name, systemImage: $0.symbol).tag($0.id) }
        }
        .pickerStyle(.inline)

        Picker("VS Code", selection: $themeID) {
            ForEach(library.vscodeThemes) { Text($0.name).tag($0.id) }
        }
        .pickerStyle(.inline)

        if !library.importedThemes.isEmpty {
            Picker("Imported", selection: $themeID) {
                ForEach(library.importedThemes) { Text($0.name).tag($0.id) }
            }
            .pickerStyle(.inline)
        }

        Divider()
        Button("Import VS Code Theme…") { importTheme() }
        if !library.importedThemes.isEmpty {
            Menu("Remove Imported Theme") {
                ForEach(library.importedThemes) { theme in
                    Button(theme.name) {
                        library.remove(theme)
                        if themeID == theme.id { themeID = ThemeLibrary.defaultID }
                    }
                }
            }
        }
    }

    private func importTheme() {
        let panel = NSOpenPanel()
        panel.title = "Import VS Code Theme"
        panel.message = "Choose a VS Code color theme file, such as “my-theme-color-theme.json”."
        panel.prompt = "Import"
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = true
        guard panel.runModal() == .OK else { return }

        var last: ThemeDescriptor?
        var failures: [String] = []
        for url in panel.urls {
            do { last = try library.importTheme(from: url) }
            catch { failures.append("\(url.lastPathComponent): \(error.localizedDescription)") }
        }
        if let last { themeID = last.id }
        if !failures.isEmpty {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = failures.count == 1 ? "Couldn't import that theme" : "Couldn't import some themes"
            alert.informativeText = failures.joined(separator: "\n")
            alert.runModal()
        }
    }
}
