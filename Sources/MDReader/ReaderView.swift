import SwiftUI

struct ReaderView: View {
    let document: MarkdownDocument
    @State private var model: ReaderModel

    @AppStorage(PrefKey.theme) private var themeID = ThemeLibrary.defaultID
    private var theme: ThemeDescriptor { ThemeLibrary.shared.resolve(themeID) }
    @AppStorage(PrefKey.typeface) private var typeface: ReaderTypeface = .sans
    @AppStorage(PrefKey.fontSize) private var fontSize: Double = FontSize.default
    @AppStorage(PrefKey.width) private var width: ReaderWidth = .medium
    @AppStorage(PrefKey.showTOC) private var showTOC = true

    @State private var columns: NavigationSplitViewVisibility = .all
    @FocusState private var searchFocused: Bool

    init(document: MarkdownDocument, fileURL: URL?) {
        self.document = document
        _model = State(initialValue: ReaderModel(text: document.text, fileURL: fileURL))
    }

    private var prefs: ReaderPrefs {
        ReaderPrefs(theme: theme, typeface: typeface, fontSize: fontSize, width: width)
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            OutlineSidebar(model: model)
                .navigationSplitViewColumnWidth(min: 200, ideal: 250, max: 380)
        } detail: {
            MarkdownWebView(model: model, prefs: prefs)
                .ignoresSafeArea(.container, edges: .bottom)
                .background(pageBackground)
        }
        .navigationSubtitle(subtitle)
        .searchable(text: $model.searchText, placement: .toolbar, prompt: "Find in Document")
        .searchFocused($searchFocused)
        .onSubmit(of: .search) { model.find() }
        .onChange(of: model.searchText) { model.find() }
        .onChange(of: model.searchFocused) { _, newValue in
            if newValue { searchFocused = true; model.searchFocused = false }
        }
        .toolbar { toolbarContent }
        .preferredColorScheme(theme.colorScheme)
        .focusedSceneValue(\.reader, model)
        .background(TabbedWindow())
        .onAppear {
            columns = showTOC ? .all : .detailOnly
            model.startWatching()
        }
        .onChange(of: columns) { _, newValue in showTOC = newValue != .detailOnly }
        .onChange(of: document.text) { _, newValue in model.update(text: newValue) }
        .frame(minWidth: 560, minHeight: 420)
    }

    private var subtitle: String {
        guard model.wordCount > 0 else { return "" }
        let words = model.wordCount.formatted()
        return "\(words) words · \(model.readingMinutes) min read"
    }

    /// Matches the page so window resizes never flash a different color.
    private var pageBackground: Color { Color(nsColor: theme.background) }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            ControlGroup {
                Button { fontSize = max(FontSize.range.lowerBound, fontSize - 1) } label: {
                    Label("Smaller", systemImage: "textformat.size.smaller")
                }
                .help("Decrease text size")
                Button { fontSize = min(FontSize.range.upperBound, fontSize + 1) } label: {
                    Label("Bigger", systemImage: "textformat.size.larger")
                }
                .help("Increase text size")
            } label: {
                Label("Text Size", systemImage: "textformat.size")
            }
        }

        ToolbarItem(placement: .primaryAction) {
            Menu {
                ThemeMenuItems(themeID: $themeID)
                Divider()
                Picker("Typeface", selection: $typeface) {
                    ForEach(ReaderTypeface.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.inline)
                Picker("Page Width", selection: $width) {
                    ForEach(ReaderWidth.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.inline)
                Divider()
                Button("Reset Text Size") { fontSize = FontSize.default }
            } label: {
                Label("Appearance", systemImage: theme.symbol)
            }
            .help("Appearance")
        }

        ToolbarItem(placement: .primaryAction) {
            Menu {
                Button("Open in Editor", systemImage: "square.and.pencil") { model.openInDefaultEditor() }
                Button("Show in Finder", systemImage: "folder") { model.revealInFinder() }
                Divider()
                Button("Print…", systemImage: "printer") { model.print() }
            } label: {
                Label("More", systemImage: "ellipsis.circle")
            }
            .disabled(model.fileURL == nil)
        }
    }
}

// MARK: - Outline sidebar

struct OutlineSidebar: View {
    let model: ReaderModel

    private var minLevel: Int { model.toc.map(\.level).min() ?? 1 }

    var body: some View {
        Group {
            if model.toc.isEmpty {
                ContentUnavailableView {
                    Label("No Outline", systemImage: "list.bullet.indent")
                } description: {
                    Text("Headings in this document will appear here.")
                }
            } else {
                ScrollViewReader { proxy in
                    List(selection: Binding(
                        get: { model.activeHeading },
                        set: { if let id = $0 { model.scroll(to: id) } }
                    )) {
                        Section("Contents") {
                            ForEach(model.toc) { item in
                                OutlineRow(item: item, depth: item.level - minLevel)
                                    .tag(item.id)
                                    .id(item.id)
                            }
                        }
                    }
                    .listStyle(.sidebar)
                    .onChange(of: model.activeHeading) { _, id in
                        guard let id else { return }
                        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(id) }
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let url = model.fileURL {
                HStack(spacing: 8) {
                    Image(systemName: "doc.richtext")
                        .foregroundStyle(.tint)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(url.lastPathComponent)
                            .font(.callout.weight(.medium))
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Text(url.deletingLastPathComponent().path(percentEncoded: false)
                            .replacingOccurrences(of: NSHomeDirectory(), with: "~"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.head)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.bar)
                .overlay(alignment: .top) { Divider() }
                .help(url.path(percentEncoded: false))
            }
        }
    }
}

private struct OutlineRow: View {
    let item: TOCItem
    let depth: Int

    var body: some View {
        Text(item.title)
            .font(depth == 0 ? .body.weight(.semibold) : (depth == 1 ? .body : .callout))
            .foregroundStyle(depth >= 2 ? .secondary : .primary)
            .lineLimit(2)
            .padding(.leading, CGFloat(min(depth, 4)) * 12)
            .padding(.vertical, 1)
            .help(item.title)
    }
}
