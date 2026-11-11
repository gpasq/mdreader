import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    static let markdown = UTType(importedAs: "net.daringfireball.markdown", conformingTo: .plainText)
    /// An unpacked EPUB folder, as Apple Books keeps them.
    static let epubFolder = UTType("org.idpf.epub-folder") ?? .epub
}

/// What a reader window shows.
enum DocumentContent: Equatable {
    case markdown(String)
    case book(EPUBBook)

    var isBook: Bool {
        if case .book = self { return true }
        return false
    }
}

/// A read-only markdown file or EPUB.
struct ReaderDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.markdown, .plainText, .epub, .epubFolder] }

    var content: DocumentContent

    init(text: String = "") {
        content = .markdown(text)
    }

    init(configuration: ReadConfiguration) throws {
        content = try Self.read(configuration.file, type: configuration.contentType)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        guard case .markdown(let text) = content else { throw CocoaError(.featureUnsupported) }
        return FileWrapper(regularFileWithContents: Data(text.utf8))
    }

    static func read(_ wrapper: FileWrapper, type: UTType) throws -> DocumentContent {
        if wrapper.isDirectory || type.conforms(to: .epub) || type.conforms(to: .epubFolder) {
            return .book(try EPUBBook(wrapper: wrapper))
        }
        guard let data = wrapper.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return .markdown(decode(data))
    }

    static func decode(_ data: Data) -> String {
        if let s = String(data: data, encoding: .utf8) { return s }
        if let s = String(data: data, encoding: .utf16) { return s }
        return String(decoding: data, as: UTF8.self)
    }
}
