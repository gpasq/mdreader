// Renders the MDReader app icon (assets/icon.svg) to a 1024×1024 PNG with a transparent background.
// Usage: swift scripts/make-icon.swift <input.svg> <output.png>
import AppKit
import WebKit

let args = CommandLine.arguments
let svgURL = URL(fileURLWithPath: args.count > 1 ? args[1] : "assets/icon.svg")
let outURL = URL(fileURLWithPath: args.count > 2 ? args[2] : "icon_1024.png")
let size = 1024

final class Renderer: NSObject, WKNavigationDelegate {
    let web = WKWebView(frame: NSRect(x: 0, y: 0, width: size, height: size))

    func start() throws {
        let svg = try String(contentsOf: svgURL, encoding: .utf8)
        let html = """
        <html><head><style>html,body{margin:0;background:transparent;overflow:hidden}
        svg{display:block;width:\(size)px;height:\(size)px}</style></head><body>\(svg)</body></html>
        """
        web.setValue(false, forKey: "drawsBackground")
        web.navigationDelegate = self
        web.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let config = WKSnapshotConfiguration()
        config.rect = NSRect(x: 0, y: 0, width: size, height: size)
        config.snapshotWidth = NSNumber(value: size)
        webView.takeSnapshot(with: config) { image, error in
            guard let image, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
                fputs("snapshot failed: \(String(describing: error))\n", stderr); exit(1)
            }
            // Redraw at exactly 1024 px regardless of the display's backing scale.
            let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
                                       bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                       colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
            let ctx = NSGraphicsContext.current!.cgContext
            ctx.interpolationQuality = .high
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: size, height: size))
            NSGraphicsContext.restoreGraphicsState()
            do {
                try rep.representation(using: .png, properties: [:])!.write(to: outURL)
                print(outURL.path)
                exit(0)
            } catch {
                fputs("write failed: \(error)\n", stderr); exit(1)
            }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let renderer = Renderer()
do { try renderer.start() } catch { fputs("\(error)\n", stderr); exit(1) }
app.run()
