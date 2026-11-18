import Foundation
import ImageIO
import Vision

struct OCRResult: Codable {
    let status: String
    let text: String
}

func recognize(_ filename: String) throws -> OCRResult {
    let url = URL(fileURLWithPath: filename)
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: 4096,
    ]
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
        return OCRResult(status: "unavailable", text: "")
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    let supported = try request.supportedRecognitionLanguages()
    let languages = ["zh-Hans", "zh-Hant", "en-US"].filter { supported.contains($0) }
    if !languages.isEmpty { request.recognitionLanguages = languages }
    if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image).perform([request])
    let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    return OCRResult(status: text.isEmpty ? "no_text" : "ok", text: text)
}

let results = CommandLine.arguments.dropFirst().map { filename in
    (try? recognize(filename)) ?? OCRResult(status: "unavailable", text: "")
}
FileHandle.standardOutput.write(try JSONEncoder().encode(results))
