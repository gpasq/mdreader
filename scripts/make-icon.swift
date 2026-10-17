// Renders the MDReader app icon to a 1024×1024 PNG.
// Usage: swift scripts/make-icon.swift <output.png>
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon_1024.png"

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext

func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: a)
}

// Squircle tile (macOS icon grid: 824pt body inside 1024 canvas).
let inset: CGFloat = 100
let tile = CGRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
let tilePath = CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil)

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 34, color: rgb(20, 10, 60, 0.35))
ctx.addPath(tilePath); ctx.setFillColor(rgb(80, 70, 200)); ctx.fillPath()
ctx.restoreGState()

ctx.saveGState()
ctx.addPath(tilePath); ctx.clip()
let bg = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                    colors: [rgb(124, 108, 255), rgb(88, 72, 226), rgb(56, 44, 168)] as CFArray,
                    locations: [0, 0.55, 1])!
ctx.drawLinearGradient(bg, start: CGPoint(x: tile.minX, y: tile.maxY), end: CGPoint(x: tile.maxX, y: tile.minY), options: [])
// soft top glow
let glow = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                      colors: [rgb(255, 255, 255, 0.28), rgb(255, 255, 255, 0)] as CFArray, locations: [0, 1])!
ctx.drawRadialGradient(glow, startCenter: CGPoint(x: size * 0.32, y: size * 0.86), startRadius: 0,
                       endCenter: CGPoint(x: size * 0.32, y: size * 0.86), endRadius: size * 0.62, options: [])
ctx.restoreGState()

// Paper page with folded corner.
let page = CGRect(x: 290, y: 205, width: 444, height: 590)
let fold: CGFloat = 112
let pagePath = CGMutablePath()
pagePath.move(to: CGPoint(x: page.minX + 34, y: page.minY))
pagePath.addLine(to: CGPoint(x: page.maxX - 34, y: page.minY))
pagePath.addQuadCurve(to: CGPoint(x: page.maxX, y: page.minY + 34), control: CGPoint(x: page.maxX, y: page.minY))
pagePath.addLine(to: CGPoint(x: page.maxX, y: page.maxY - fold))
pagePath.addLine(to: CGPoint(x: page.maxX - fold, y: page.maxY))
pagePath.addLine(to: CGPoint(x: page.minX + 34, y: page.maxY))
pagePath.addQuadCurve(to: CGPoint(x: page.minX, y: page.maxY - 34), control: CGPoint(x: page.minX, y: page.maxY))
pagePath.addLine(to: CGPoint(x: page.minX, y: page.minY + 34))
pagePath.addQuadCurve(to: CGPoint(x: page.minX + 34, y: page.minY), control: CGPoint(x: page.minX, y: page.minY))
pagePath.closeSubpath()

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -18), blur: 40, color: rgb(10, 0, 60, 0.45))
ctx.addPath(pagePath); ctx.setFillColor(rgb(255, 255, 255)); ctx.fillPath()
ctx.restoreGState()

ctx.saveGState()
ctx.addPath(pagePath); ctx.clip()
let paper = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                       colors: [rgb(255, 255, 255), rgb(240, 238, 252)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(paper, start: CGPoint(x: 0, y: page.maxY), end: CGPoint(x: 0, y: page.minY), options: [])
ctx.restoreGState()

// Folded corner flap.
let flap = CGMutablePath()
flap.move(to: CGPoint(x: page.maxX - fold, y: page.maxY))
flap.addLine(to: CGPoint(x: page.maxX - fold, y: page.maxY - fold + 22))
flap.addQuadCurve(to: CGPoint(x: page.maxX - fold + 22, y: page.maxY - fold), control: CGPoint(x: page.maxX - fold, y: page.maxY - fold))
flap.addLine(to: CGPoint(x: page.maxX, y: page.maxY - fold))
flap.closeSubpath()
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: -4, height: -6), blur: 14, color: rgb(30, 20, 90, 0.25))
ctx.addPath(flap); ctx.setFillColor(rgb(214, 210, 246)); ctx.fillPath()
ctx.restoreGState()

// Heading bar + text lines.
func bar(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ c: CGColor) {
    ctx.addPath(CGPath(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerWidth: h / 2, cornerHeight: h / 2, transform: nil))
    ctx.setFillColor(c); ctx.fillPath()
}
let accent = rgb(98, 82, 236)
bar(page.minX + 56, page.maxY - 118, 210, 34, accent)
let line = rgb(196, 192, 226)
bar(page.minX + 56, page.maxY - 186, 330, 18, line)
bar(page.minX + 56, page.maxY - 224, 300, 18, line)
bar(page.minX + 56, page.maxY - 262, 318, 18, line)

// "M↓" mark.
let markRect = CGRect(x: page.minX + 56, y: page.minY + 62, width: page.width - 112, height: 210)
ctx.addPath(CGPath(roundedRect: markRect, cornerWidth: 36, cornerHeight: 36, transform: nil))
ctx.setFillColor(rgb(98, 82, 236, 0.10)); ctx.fillPath()

let font = NSFont.systemFont(ofSize: 150, weight: .heavy)
let para = NSMutableParagraphStyle(); para.alignment = .center
let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor(cgColor: accent)!, .paragraphStyle: para, .kern: -4]
let mark = NSAttributedString(string: "M↓", attributes: attrs)
let textSize = mark.size()
mark.draw(in: CGRect(x: markRect.minX, y: markRect.midY - textSize.height / 2 + 4, width: markRect.width, height: textSize.height))

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
