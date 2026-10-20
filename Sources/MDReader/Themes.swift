import SwiftUI
import AppKit

/// Colors for a theme imported from (or modeled on) a VS Code color theme.
/// The page derives every other shade from these with CSS `color-mix`.
struct Palette: Codable, Hashable {
    var isDark: Bool
    var background: String
    var foreground: String
    var accent: String
    var keyword: String
    var string: String
    var number: String
    var comment: String
    var function: String
    var type: String
    var attribute: String
    var tag: String
    var meta: String

    var cssVars: [String: String] {
        [
            "--bg": background, "--fg": foreground, "--accent": accent,
            "--hl-keyword": keyword, "--hl-string": string, "--hl-number": number,
            "--hl-comment": comment, "--hl-title": function, "--hl-type": type,
            "--hl-attr": attribute, "--hl-variable": attribute, "--hl-tag": tag, "--hl-meta": meta,
        ]
    }
}

/// A selectable theme: one of the reader's own CSS themes, or a palette.
struct ThemeDescriptor: Identifiable, Hashable {
    enum Source: Hashable { case reader, vscode, imported }

    let id: String
    let name: String
    let source: Source
    /// For reader themes, the page's `data-theme` value.
    var cssName: String?
    var palette: Palette?

    var colorScheme: ColorScheme? {
        if let palette { return palette.isDark ? .dark : .light }
        switch cssName {
        case "dark": return .dark
        case "light", "sepia": return .light
        default: return nil
        }
    }

    var symbol: String {
        switch cssName {
        case "auto": "circle.lefthalf.filled"
        case "light": "sun.max"
        case "sepia": "book"
        case "dark": "moon"
        default: "paintpalette"
        }
    }

    /// Background behind the page.
    var background: NSColor {
        if let palette, let c = NSColor(hex: palette.background) { return c }
        switch cssName {
        case "sepia": return NSColor(srgbRed: 0.973, green: 0.945, blue: 0.890, alpha: 1)
        case "light": return .white
        case "dark": return NSColor(srgbRed: 0.11, green: 0.11, blue: 0.118, alpha: 1)
        default: return .textBackgroundColor
        }
    }

    var jsArguments: [String: Any] {
        if let palette {
            return ["theme": "custom", "dark": palette.isDark, "vars": palette.cssVars]
        }
        return ["theme": cssName ?? "auto"]
    }
}

// MARK: - Library

@Observable
@MainActor
final class ThemeLibrary {
    static let shared = ThemeLibrary()

    static let defaultID = "reader.auto"

    let readerThemes: [ThemeDescriptor] = [
        .init(id: "reader.auto", name: "Match System", source: .reader, cssName: "auto"),
        .init(id: "reader.light", name: "Light", source: .reader, cssName: "light"),
        .init(id: "reader.sepia", name: "Sepia", source: .reader, cssName: "sepia"),
        .init(id: "reader.dark", name: "Dark", source: .reader, cssName: "dark"),
    ]

    let vscodeThemes: [ThemeDescriptor] = VSCodeDefaults.all

    private(set) var importedThemes: [ThemeDescriptor] = []

    private init() {
        importedThemes = Self.loadImported()
    }

    var all: [ThemeDescriptor] { readerThemes + vscodeThemes + importedThemes }

    func theme(id: String) -> ThemeDescriptor {
        all.first { $0.id == id } ?? readerThemes[0]
    }

    /// Migrates the original theme setting values ("auto", "dark", …).
    func resolve(_ stored: String) -> ThemeDescriptor {
        stored.contains(".") ? theme(id: stored) : theme(id: "reader." + stored)
    }

    // MARK: Import

    func importTheme(from url: URL) throws -> ThemeDescriptor {
        let parsed = try VSCodeThemeImporter.load(url)
        // Re-importing a theme with the same name replaces it.
        let id = "imported." + slug(parsed.name)
        let theme = ThemeDescriptor(id: id, name: parsed.name, source: .imported, palette: parsed.palette)
        importedThemes.removeAll { $0.id == id }
        importedThemes.append(theme)
        importedThemes.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        saveImported()
        return theme
    }

    func remove(_ theme: ThemeDescriptor) {
        importedThemes.removeAll { $0.id == theme.id }
        saveImported()
    }

    private func slug(_ s: String) -> String {
        let cleaned = s.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "-" }
        return String(cleaned).split(separator: "-").joined(separator: "-")
    }

    // MARK: Persistence

    private struct Stored: Codable { var id: String; var name: String; var palette: Palette }

    private static var storeURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MDReader", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("themes.json")
    }

    private static func loadImported() -> [ThemeDescriptor] {
        guard let data = try? Data(contentsOf: storeURL),
              let stored = try? JSONDecoder().decode([Stored].self, from: data) else { return [] }
        return stored.map { ThemeDescriptor(id: $0.id, name: $0.name, source: .imported, palette: $0.palette) }
    }

    private func saveImported() {
        let stored = importedThemes.compactMap { t in t.palette.map { Stored(id: t.id, name: t.name, palette: $0) } }
        if let data = try? JSONEncoder().encode(stored) {
            try? data.write(to: Self.storeURL, options: .atomic)
        }
    }
}

// MARK: - Built-in VS Code palettes

enum VSCodeDefaults {
    private static func t(_ id: String, _ name: String, _ p: Palette) -> ThemeDescriptor {
        ThemeDescriptor(id: "vscode." + id, name: name, source: .vscode, palette: p)
    }

    static let darkPlus = Palette(isDark: true, background: "#1e1e1e", foreground: "#d4d4d4", accent: "#3794ff",
        keyword: "#569cd6", string: "#ce9178", number: "#b5cea8", comment: "#6a9955", function: "#dcdcaa",
        type: "#4ec9b0", attribute: "#9cdcfe", tag: "#569cd6", meta: "#c586c0")

    static let lightPlus = Palette(isDark: false, background: "#ffffff", foreground: "#1f1f1f", accent: "#006ab1",
        keyword: "#0000ff", string: "#a31515", number: "#098658", comment: "#008000", function: "#795e26",
        type: "#267f99", attribute: "#001080", tag: "#800000", meta: "#af00db")

    static let all: [ThemeDescriptor] = [
        t("dark-plus", "Dark+", darkPlus),
        t("light-plus", "Light+", lightPlus),
        t("monokai", "Monokai", Palette(isDark: true, background: "#272822", foreground: "#f8f8f2", accent: "#66d9ef",
            keyword: "#f92672", string: "#e6db74", number: "#ae81ff", comment: "#88846f", function: "#a6e22e",
            type: "#66d9ef", attribute: "#fd971f", tag: "#f92672", meta: "#f92672")),
        t("dracula", "Dracula", Palette(isDark: true, background: "#282a36", foreground: "#f8f8f2", accent: "#bd93f9",
            keyword: "#ff79c6", string: "#f1fa8c", number: "#bd93f9", comment: "#6272a4", function: "#50fa7b",
            type: "#8be9fd", attribute: "#50fa7b", tag: "#ff79c6", meta: "#ff79c6")),
        t("one-dark-pro", "One Dark Pro", Palette(isDark: true, background: "#282c34", foreground: "#abb2bf", accent: "#61afef",
            keyword: "#c678dd", string: "#98c379", number: "#d19a66", comment: "#7f848e", function: "#61afef",
            type: "#e5c07b", attribute: "#e06c75", tag: "#e06c75", meta: "#56b6c2")),
        t("github-light", "GitHub Light", Palette(isDark: false, background: "#ffffff", foreground: "#1f2328", accent: "#0969da",
            keyword: "#cf222e", string: "#0a3069", number: "#0550ae", comment: "#6e7781", function: "#8250df",
            type: "#953800", attribute: "#0550ae", tag: "#116329", meta: "#cf222e")),
        t("github-dark", "GitHub Dark", Palette(isDark: true, background: "#0d1117", foreground: "#e6edf3", accent: "#4493f8",
            keyword: "#ff7b72", string: "#a5d6ff", number: "#79c0ff", comment: "#8b949e", function: "#d2a8ff",
            type: "#ffa657", attribute: "#79c0ff", tag: "#7ee787", meta: "#ff7b72")),
        t("solarized-light", "Solarized Light", Palette(isDark: false, background: "#fdf6e3", foreground: "#586e75", accent: "#268bd2",
            keyword: "#859900", string: "#2aa198", number: "#d33682", comment: "#93a1a1", function: "#268bd2",
            type: "#b58900", attribute: "#cb4b16", tag: "#268bd2", meta: "#cb4b16")),
        t("solarized-dark", "Solarized Dark", Palette(isDark: true, background: "#002b36", foreground: "#93a1a1", accent: "#268bd2",
            keyword: "#859900", string: "#2aa198", number: "#d33682", comment: "#586e75", function: "#268bd2",
            type: "#b58900", attribute: "#cb4b16", tag: "#268bd2", meta: "#cb4b16")),
        t("nord", "Nord", Palette(isDark: true, background: "#2e3440", foreground: "#d8dee9", accent: "#88c0d0",
            keyword: "#81a1c1", string: "#a3be8c", number: "#b48ead", comment: "#616e88", function: "#88c0d0",
            type: "#8fbcbb", attribute: "#ebcb8b", tag: "#81a1c1", meta: "#5e81ac")),
    ]
}

// MARK: - Importing VS Code theme files

enum VSCodeThemeImporter {
    struct Result { var name: String; var palette: Palette }

    enum ImportError: LocalizedError {
        case notATheme
        var errorDescription: String? { "This file doesn't look like a VS Code color theme." }
    }

    /// Loads a VS Code `*-color-theme.json` file (JSON with comments), following `include`.
    static func load(_ url: URL) throws -> Result {
        let (colors, tokens, type, name) = try collect(url, depth: 0)
        guard !colors.isEmpty || !tokens.isEmpty else { throw ImportError.notATheme }

        let isDark: Bool = {
            if let type { return type != "light" && type != "hcLight" }
            if let bg = colors["editor.background"], let c = NSColor(hex: bg) {
                return (c.usingColorSpace(.sRGB)?.brightnessComponent ?? 0) < 0.5
            }
            return true
        }()
        let base = isDark ? VSCodeDefaults.darkPlus : VSCodeDefaults.lightPlus

        // Base colors are used opaque: a translucent background or link color reads badly on a page.
        func color(_ keys: String...) -> String? {
            keys.lazy.compactMap { colors[$0] }.first { NSColor(hex: $0) != nil }.map(opaque)
        }
        func opaque(_ hex: String) -> String { hex.count == 9 ? String(hex.prefix(7)) : hex }
        func token(_ scopes: String...) -> String? {
            for scope in scopes {
                // Exact scope match first (last rule wins, as in VS Code), then a more specific one.
                if let hit = tokens.last(where: { $0.scopes.contains(scope) }) { return hit.color }
                if let hit = tokens.last(where: { $0.scopes.contains { $0.hasPrefix(scope + ".") } }) { return hit.color }
            }
            return nil
        }

        let foreground = color("editor.foreground", "foreground") ?? tokens.first(where: { $0.scopes.isEmpty })?.color ?? base.foreground
        let palette = Palette(
            isDark: isDark,
            background: color("editor.background") ?? base.background,
            foreground: foreground,
            accent: color("textLink.foreground", "focusBorder", "button.background", "activityBarBadge.background") ?? base.accent,
            keyword: token("keyword", "storage.type", "storage") ?? base.keyword,
            string: token("string") ?? base.string,
            number: token("constant.numeric", "constant") ?? base.number,
            comment: token("comment") ?? base.comment,
            function: token("entity.name.function", "support.function") ?? base.function,
            type: token("entity.name.type", "support.type", "entity.name.class", "support.class") ?? base.type,
            attribute: token("variable.other.property", "support.type.property-name", "entity.other.attribute-name", "variable") ?? base.attribute,
            tag: token("entity.name.tag") ?? base.tag,
            meta: token("keyword.control", "meta.preprocessor") ?? base.meta
        )
        let fallbackName = url.deletingPathExtension().lastPathComponent
            .replacingOccurrences(of: "-color-theme", with: "")
            .replacingOccurrences(of: "-", with: " ").capitalized
        return Result(name: name ?? fallbackName, palette: palette)
    }

    private struct TokenRule { var scopes: [String]; var color: String }

    private static func collect(_ url: URL, depth: Int) throws
        -> (colors: [String: String], tokens: [TokenRule], type: String?, name: String?) {
        let data = try Data(contentsOf: url)
        let clean = stripJSONC(String(decoding: data, as: UTF8.self))
        guard let obj = try JSONSerialization.jsonObject(with: Data(clean.utf8)) as? [String: Any] else {
            throw ImportError.notATheme
        }

        var colors: [String: String] = [:]
        var tokens: [TokenRule] = []
        var type = obj["type"] as? String

        // `include` points at a base theme; its values come first and are overridden here.
        if depth < 5, let include = obj["include"] as? String {
            let baseURL = url.deletingLastPathComponent().appendingPathComponent(include)
            if let base = try? collect(baseURL, depth: depth + 1) {
                colors = base.colors
                tokens = base.tokens
                type = type ?? base.type
            }
        }

        for (k, v) in obj["colors"] as? [String: Any] ?? [:] {
            if let s = v as? String { colors[k] = s }
        }
        for rule in obj["tokenColors"] as? [[String: Any]] ?? [] {
            guard let settings = rule["settings"] as? [String: Any], let fg = settings["foreground"] as? String else { continue }
            let scopes: [String]
            switch rule["scope"] {
            case let s as String: scopes = s.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            case let a as [String]: scopes = a
            default: scopes = []
            }
            tokens.append(TokenRule(scopes: scopes, color: fg))
        }
        return (colors, tokens, type, depth == 0 ? obj["name"] as? String : nil)
    }

    /// Removes `//` and `/* */` comments and trailing commas, leaving strings intact.
    static func stripJSONC(_ s: String) -> String {
        var out = ""
        out.reserveCapacity(s.count)
        let chars = Array(s.unicodeScalars)
        var i = 0
        var inString = false
        while i < chars.count {
            let c = chars[i]
            if inString {
                out.unicodeScalars.append(c)
                if c == "\\", i + 1 < chars.count { out.unicodeScalars.append(chars[i + 1]); i += 2; continue }
                if c == "\"" { inString = false }
                i += 1
                continue
            }
            if c == "\"" { inString = true; out.unicodeScalars.append(c); i += 1; continue }
            if c == "/", i + 1 < chars.count, chars[i + 1] == "/" {
                while i < chars.count, chars[i] != "\n" { i += 1 }
                continue
            }
            if c == "/", i + 1 < chars.count, chars[i + 1] == "*" {
                i += 2
                while i + 1 < chars.count, !(chars[i] == "*" && chars[i + 1] == "/") { i += 1 }
                i += 2
                continue
            }
            if c == "," {
                var j = i + 1
                while j < chars.count, CharacterSet.whitespacesAndNewlines.contains(chars[j]) { j += 1 }
                if j < chars.count, chars[j] == "}" || chars[j] == "]" { i += 1; continue }
            }
            out.unicodeScalars.append(c)
            i += 1
        }
        return out
    }
}

// MARK: - Hex colors

extension NSColor {
    /// Parses `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.
    convenience init?(hex: String) {
        var h = hex.trimmingCharacters(in: .whitespaces)
        guard h.hasPrefix("#") else { return nil }
        h.removeFirst()
        if h.count == 3 || h.count == 4 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6 || h.count == 8, let v = UInt64(h, radix: 16) else { return nil }
        let hasAlpha = h.count == 8
        let r = CGFloat((v >> (hasAlpha ? 24 : 16)) & 0xff) / 255
        let g = CGFloat((v >> (hasAlpha ? 16 : 8)) & 0xff) / 255
        let b = CGFloat((v >> (hasAlpha ? 8 : 0)) & 0xff) / 255
        let a = hasAlpha ? CGFloat(v & 0xff) / 255 : 1
        self.init(srgbRed: r, green: g, blue: b, alpha: a)
    }
}
