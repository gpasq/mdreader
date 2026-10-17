import SwiftUI

enum ReaderTheme: String, CaseIterable, Identifiable {
    case auto, light, sepia, dark
    var id: String { rawValue }

    var title: String {
        switch self {
        case .auto: "Match System"
        case .light: "Light"
        case .sepia: "Sepia"
        case .dark: "Dark"
        }
    }

    var symbol: String {
        switch self {
        case .auto: "circle.lefthalf.filled"
        case .light: "sun.max"
        case .sepia: "book"
        case .dark: "moon"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .auto: nil
        case .light, .sepia: .light
        case .dark: .dark
        }
    }
}

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
    var theme: ReaderTheme
    var typeface: ReaderTypeface
    var fontSize: Double
    var width: ReaderWidth

    var jsArguments: [String: Any] {
        ["theme": theme.rawValue, "typeface": typeface.rawValue, "fontSize": fontSize, "measure": width.rem]
    }
}
