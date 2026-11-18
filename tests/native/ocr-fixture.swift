import AppKit

let image = NSImage(size: NSSize(width: 1200, height: 360), flipped: true) { rect in
    NSColor.white.setFill()
    rect.fill()
    for (text, y) in [("Camera calibration checklist", 60.0), ("动物行为追踪实验", 175.0)] {
        (text as NSString).draw(at: NSPoint(x: 40, y: y), withAttributes: [
            .font: NSFont.systemFont(ofSize: 56),
            .foregroundColor: NSColor.black
        ])
    }
    return true
}
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
