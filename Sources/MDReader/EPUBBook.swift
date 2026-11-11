import Foundation

/// An unpacked EPUB: its chapters in reading order and its table of contents.
struct EPUBBook: Equatable, Sendable {
    struct Chapter: Sendable {
        let url: URL
        let html: String
    }

    struct TOCEntry: Sendable {
        let title: String
        let level: Int
        let url: URL
    }

    enum Failure: LocalizedError {
        case missingPackage, noChapters
        var errorDescription: String? {
            switch self {
            case .missingPackage: "This EPUB has no package file (META-INF/container.xml is missing or invalid)."
            case .noChapters: "This EPUB has no readable chapters."
            }
        }
    }

    let id = UUID()
    let title: String?
    let author: String?
    let chapters: [Chapter]
    let toc: [TOCEntry]
    /// Where the book's files are unpacked.
    let root: URL
    /// Keeps the unpacked files alive; they're removed when the last copy of the book goes away.
    let folder: UnpackedFolder

    static func == (a: EPUBBook, b: EPUBBook) -> Bool { a.id == b.id }

    /// Reads a zipped `.epub` or an unpacked EPUB folder (as Apple Books stores them).
    init(wrapper: FileWrapper) throws {
        let folder = try UnpackedFolder()
        let root = folder.url.appending(path: "book", directoryHint: .isDirectory)
        if wrapper.isDirectory {
            try wrapper.write(to: root, options: [], originalContentsURL: nil)
        } else if let data = wrapper.regularFileContents {
            try ZipArchive.extract(data, to: root)
        } else {
            throw CocoaError(.fileReadCorruptFile)
        }
        try self.init(folder: folder, root: root)
    }

    private init(folder: UnpackedFolder, root: URL) throws {
        self.folder = folder
        self.root = root

        let container = try? XMLNode.parse(contentsOf: root.appending(path: "META-INF/container.xml"))
        guard let fullPath = container?.first("rootfile")?.attributes["full-path"],
              let opfURL = URL(string: fullPath, relativeTo: root)?.absoluteURL,
              let opf = try? XMLNode.parse(contentsOf: opfURL) else {
            throw Failure.missingPackage
        }

        title = opf.first("metadata")?.first("title")?.text.trimmed.nonEmpty
        author = opf.first("metadata")?.first("creator")?.text.trimmed.nonEmpty

        struct Item { let href: URL; let type: String; let properties: [Substring] }
        var manifest: [String: Item] = [:]
        for node in opf.first("manifest")?.all("item") ?? [] {
            guard let id = node.attributes["id"], let href = node.attributes["href"],
                  let url = URL(string: href, relativeTo: opfURL)?.absoluteURL else { continue }
            manifest[id] = Item(href: url.standardized, type: node.attributes["media-type"] ?? "",
                                properties: (node.attributes["properties"] ?? "").split(separator: " "))
        }

        let spine = opf.first("spine")
        let isPage: (Item) -> Bool = { $0.type.contains("html") }
        chapters = (spine?.all("itemref") ?? []).compactMap { ref in
            guard let item = ref.attributes["idref"].flatMap({ manifest[$0] }), isPage(item),
                  let data = try? Data(contentsOf: item.href) else { return nil }
            return Chapter(url: item.href, html: ReaderDocument.decode(data))
        }
        guard !chapters.isEmpty else { throw Failure.noChapters }

        // EPUB 3 navigation document first, then the EPUB 2 NCX.
        var toc: [TOCEntry] = []
        if let nav = manifest.values.first(where: { $0.properties.contains("nav") }) {
            toc = Self.navTOC(at: nav.href)
        }
        if toc.isEmpty, let ncx = spine?.attributes["toc"].flatMap({ manifest[$0] })
            ?? manifest.values.first(where: { $0.type == "application/x-dtbncx+xml" }) {
            toc = Self.ncxTOC(at: ncx.href)
        }
        self.toc = toc
    }

    private static func navTOC(at url: URL) -> [TOCEntry] {
        guard let doc = try? XMLNode.parse(contentsOf: url) else { return [] }
        let navs = doc.all("nav")
        guard let nav = navs.first(where: { ($0.attributes["type"] ?? "").split(separator: " ").contains("toc") })
                ?? navs.first,
              let list = nav.first("ol") else { return [] }
        var entries: [TOCEntry] = []
        func walk(_ ol: XMLNode, level: Int) {
            for li in ol.children where li.name == "li" {
                if let a = li.children.first(where: { $0.name == "a" }), let href = a.attributes["href"],
                   let target = URL(string: href, relativeTo: url)?.absoluteURL, let title = a.text.trimmed.nonEmpty {
                    entries.append(TOCEntry(title: title, level: level, url: target.standardized))
                }
                if let sub = li.children.first(where: { $0.name == "ol" }) { walk(sub, level: level + 1) }
            }
        }
        walk(list, level: 1)
        return entries
    }

    private static func ncxTOC(at url: URL) -> [TOCEntry] {
        guard let doc = try? XMLNode.parse(contentsOf: url), let map = doc.first("navMap") else { return [] }
        var entries: [TOCEntry] = []
        func walk(_ node: XMLNode, level: Int) {
            for point in node.children where point.name == "navPoint" {
                if let src = point.first("content")?.attributes["src"],
                   let target = URL(string: src, relativeTo: url)?.absoluteURL,
                   let title = point.first("navLabel")?.text.trimmed.nonEmpty {
                    entries.append(TOCEntry(title: title, level: level, url: target.standardized))
                }
                walk(point, level: level + 1)
            }
        }
        walk(map, level: 1)
        return entries
    }

    /// Arguments for `mdr.renderBook` in the page.
    var jsArguments: [String: Any] {
        [
            "base": root.absoluteString,
            "chapters": chapters.map { ["url": $0.url.absoluteString, "html": $0.html] },
            "toc": toc.map { ["title": $0.title, "level": $0.level, "href": $0.url.absoluteString] },
        ]
    }
}

// MARK: - Unpacked files

/// A private temporary folder that deletes itself when released.
final class UnpackedFolder: Sendable {
    static let parent = FileManager.default.temporaryDirectory.appending(path: "MDReader-Books", directoryHint: .isDirectory)

    let url: URL

    init() throws {
        url = Self.parent.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    deinit { try? FileManager.default.removeItem(at: url) }

    /// Clears folders left behind by a previous run that didn't quit cleanly.
    static func removeLeftovers() {
        try? FileManager.default.removeItem(at: parent)
    }
}

// MARK: - Minimal XML tree

/// A namespace-stripped element tree, enough for container.xml, the OPF, the NCX and the nav document.
final class XMLNode {
    let name: String
    let attributes: [String: String]
    fileprivate(set) var children: [XMLNode] = []
    fileprivate var ownText = ""

    init(name: String, attributes: [String: String]) {
        self.name = name
        self.attributes = attributes
    }

    var text: String { ownText + children.map(\.text).joined() }

    /// First descendant (depth-first) with this local name.
    func first(_ name: String) -> XMLNode? {
        for child in children {
            if child.name == name { return child }
            if let hit = child.first(name) { return hit }
        }
        return nil
    }

    /// Every descendant with this local name, in document order.
    func all(_ name: String) -> [XMLNode] {
        children.flatMap { ($0.name == name ? [$0] : []) + $0.all(name) }
    }

    static func parse(contentsOf url: URL) throws -> XMLNode {
        let data = try Data(contentsOf: url)
        let builder = Builder()
        let parser = XMLParser(data: data)
        parser.shouldProcessNamespaces = true
        parser.delegate = builder
        guard parser.parse() else { throw parser.parserError ?? CocoaError(.fileReadCorruptFile) }
        return builder.root
    }

    private final class Builder: NSObject, XMLParserDelegate {
        let root = XMLNode(name: "", attributes: [:])
        private lazy var stack = [root]

        func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
                    qualifiedName: String?, attributes: [String: String]) {
            var attrs: [String: String] = [:]
            for (key, value) in attributes {
                attrs[String(key.split(separator: ":").last ?? Substring(key))] = value
            }
            let node = XMLNode(name: name, attributes: attrs)
            stack.last?.children.append(node)
            stack.append(node)
        }

        func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
            stack.removeLast()
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            guard let node = stack.last else { return }
            if node.children.isEmpty {
                node.ownText += string
            } else {
                // Text after a child element goes on a text node so `text` keeps document order.
                let tail = XMLNode(name: "#text", attributes: [:])
                tail.ownText = string
                node.children.append(tail)
            }
        }
    }
}

private extension String {
    var trimmed: String {
        split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
    var nonEmpty: String? { isEmpty ? nil : self }
}
