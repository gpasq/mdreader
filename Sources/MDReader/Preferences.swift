import SwiftUI

enum ReaderTypeface: String, CaseIterable, Identifiable {
    case sans, serif
    var id: String { rawValue }
    var title: String { self == .sans ? "San Francisco" : "New York" }
}

enum ReaderWidth: String, CaseIterable, Identifiable {
    case narrow, medium, wide
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var rem: Double {
        switch self {
        case .narrow: 38
        case .medium: 46
        case .wide: 62
        }
    }
}

enum PrefKey {
    static let theme = "theme"
    static let typeface = "typeface"
    static let fontSize = "fontSize"
    static let width = "width"
    static let showTOC = "showTOC"
}

enum FontSize {
    static let `default`: Double = 17
    static let range: ClosedRange<Double> = 12...30
}

/// Everything the web view needs to style a page.
struct ReaderPrefs: Equatable {
    var theme: ThemeDescriptor
    var typeface: ReaderTypeface
    var fontSize: Double
    var width: ReaderWidth

    var jsArguments: [String: Any] {
        theme.jsArguments.merging(["typeface": typeface.rawValue, "fontSize": fontSize, "measure": width.rem]) { a, _ in a }
    }
}
