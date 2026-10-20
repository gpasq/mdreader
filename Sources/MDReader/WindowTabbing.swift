import SwiftUI
import AppKit

/// Puts every document window into one tabbed window and keeps the tab bar visible.
struct TabbedWindow: NSViewRepresentable {
    static let identifier = "MDReaderDocument"

    func makeNSView(context: Context) -> NSView { TabbingView() }
    func updateNSView(_ nsView: NSView, context: Context) {}

    private final class TabbingView: NSView {
        private var configured = false

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window, !configured else { return }
            configured = true
            window.tabbingMode = .preferred
            window.tabbingIdentifier = TabbedWindow.identifier

            // SwiftUI shows the window before we get here, so join an existing tab group by hand.
            DispatchQueue.main.async {
                let host = NSApp.orderedWindows.first {
                    $0 !== window && $0.isVisible && $0.tabbingIdentifier == TabbedWindow.identifier
                        && !($0.tabbedWindows?.contains(window) ?? false)
                }
                if let host {
                    (host.tabGroup?.selectedWindow ?? host).addTabbedWindow(window, ordered: .above)
                    window.makeKeyAndOrderFront(nil)
                }
                if let group = window.tabGroup, !group.isTabBarVisible {
                    window.toggleTabBar(nil)
                }
            }
        }
    }
}
