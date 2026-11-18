import AppKit

let arguments = CommandLine.arguments.dropFirst()
let labels = arguments.count > 1 ? Array(arguments.dropFirst()) : ["Camera calibration checklist", "动物行为追踪实验"]
let image = NSImage(size: NSSize(width: 1200, height: 360), flipped: true) { rect in
    NSColor.white.setFill()
    rect.fill()
    for (index, text) in labels.enumerated() {
        (text as NSString).draw(at: NSPoint(x: 40, y: 60 + 115 * index), withAttributes: [
            .font: NSFont.systemFont(ofSize: 56),
            .foregroundColor: NSColor.black
        ])
    }
    return true
}
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
