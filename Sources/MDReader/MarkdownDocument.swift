import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    static let markdown = UTType(importedAs: "net.daringfireball.markdown", conformingTo: .plainText)
}

/// A read-only markdown file.
struct MarkdownDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.markdown, .plainText] }

    var text: String

    init(text: String = "") {
        self.text = text
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        text = MarkdownDocument.decode(data)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }

    static func decode(_ data: Data) -> String {
        if let s = String(data: data, encoding: .utf8) { return s }
        if let s = String(data: data, encoding: .utf16) { return s }
        return String(decoding: data, as: UTF8.self)
    }
}
