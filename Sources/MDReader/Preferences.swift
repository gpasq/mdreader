import SwiftUI

enum ReaderTypeface: String, CaseIterable, Identifiable {
    case sans, serif
    var id: String { rawValue }
    var title: String { self == .sans ? "San Francisco" : "New York" }
}

enum ReaderWidth: String, CaseIterable, Identifiable {
    case narrow, medium, wide, full
    var id: String { rawValue }
    var title: String { self == .full ? "Fit Window" : rawValue.capitalized }
    /// CSS max-width for the page; `full` lets the text grow with the window.
    var measure: String {
        switch self {
        case .narrow: "38rem"
        case .medium: "46rem"
        case .wide: "62rem"
        case .full: "none"
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
        theme.jsArguments.merging(["typeface": typeface.rawValue, "fontSize": fontSize, "measure": width.measure]) { a, _ in a }
    }
}
