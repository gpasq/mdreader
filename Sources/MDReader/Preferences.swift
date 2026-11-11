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

/// The reading pane's colors: the app theme's, or a fixed page independent of it.
enum ReaderPane: String, CaseIterable, Identifiable {
    case theme, white, sepia, dark
    var id: String { rawValue }
    var title: String { self == .theme ? "Match Theme" : rawValue.capitalized }
    var symbol: String {
        switch self {
        case .theme: "paintpalette"
        case .white: "sun.max"
        case .sepia: "book"
        case .dark: "moon"
        }
    }

    /// The theme the page is drawn in when the app theme is `appTheme`.
    @MainActor
    func pageTheme(for appTheme: ThemeDescriptor) -> ThemeDescriptor {
        switch self {
        case .theme: appTheme
        case .white: ThemeLibrary.shared.theme(id: "reader.light")
        case .sepia: ThemeLibrary.shared.theme(id: "reader.sepia")
        case .dark: ThemeLibrary.shared.theme(id: "reader.dark")
        }
    }
}

enum PrefKey {
    static let theme = "theme"
    static let pane = "readingPane"
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
    /// The page's theme, after any reading-pane override.
    var theme: ThemeDescriptor
    var typeface: ReaderTypeface
    var fontSize: Double
    var width: ReaderWidth

    var jsArguments: [String: Any] {
        theme.jsArguments.merging(["typeface": typeface.rawValue, "fontSize": fontSize, "measure": width.measure]) { a, _ in a }
    }
}
