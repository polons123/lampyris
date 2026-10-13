// Рисует иконку приложения (тёмный «квадрат» macOS с белым треугольником воспроизведения) и сохраняет .iconset.
// Использование: swift scripts/make-icon.swift <каталог.iconset>
import AppKit

func render(_ size: Int) -> Data {
    let s = CGFloat(size)
    let image = NSImage(size: NSSize(width: s, height: s))
    image.lockFocus()
    let rect = NSRect(x: s * 0.06, y: s * 0.06, width: s * 0.88, height: s * 0.88)
    let radius = s * 0.88 * 0.2237
    let bg = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    NSGradient(colors: [NSColor(red: 0.16, green: 0.20, blue: 0.30, alpha: 1), NSColor(red: 0.05, green: 0.06, blue: 0.10, alpha: 1)])!
        .draw(in: bg, angle: -90)
    // мягкий свет сверху
    NSGradient(colors: [NSColor(white: 1, alpha: 0.14), NSColor(white: 1, alpha: 0)])!.draw(in: bg, angle: -90)
    // треугольник воспроизведения
    let cx = s * 0.52, cy = s * 0.5, h = s * 0.36, w = s * 0.31
    let tri = NSBezierPath()
    tri.move(to: NSPoint(x: cx - w / 2, y: cy + h / 2))
    tri.line(to: NSPoint(x: cx - w / 2, y: cy - h / 2))
    tri.line(to: NSPoint(x: cx + w * 0.62, y: cy))
    tri.close()
    tri.lineJoinStyle = .round
    tri.lineWidth = s * 0.03
    NSGraphicsContext.current?.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor(white: 1, alpha: 0.35)
    shadow.shadowBlurRadius = s * 0.05
    shadow.set()
    NSColor.white.setFill(); NSColor.white.setStroke()
    tri.fill(); tri.stroke()
    NSGraphicsContext.current?.restoreGraphicsState()
    image.unlockFocus()
    let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
    return rep.representation(using: .png, properties: [:])!
}

guard CommandLine.arguments.count > 1 else { print("Использование: make-icon.swift <каталог.iconset>"); exit(2) }
let dir = CommandLine.arguments[1]
try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
let names: [(String, Int)] = [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128), ("128x128@2x", 256),
                              ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)]
for (name, px) in names { try! render(px).write(to: URL(fileURLWithPath: "\(dir)/icon_\(name).png")) }
