import Foundation

func reject(_ link: String, incoming: Bool = false) {
    do {
        _ = incoming ? try CaptureLink.incoming(URL(string: link)!) : try CaptureLink.post(link)
        fatalError("Unexpected accepted link: \(link)")
    } catch { }
}

let canonical = "https://x.com/example/status/1234567890"
let normalized = try CaptureLink.post("https://twitter.com/example/status/1234567890/photo/1?s=20")
assert(normalized == canonical)
let encoded = canonical.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
let incoming = try CaptureLink.incoming(URL(string: "x2obsidian://save?url=\(encoded)")!)
assert(incoming == canonical)
reject("https://x.com/home")
reject("https://x.com.evil.test/example/status/123")
reject("https://other@x.com/example/status/123")
reject("file:///tmp/example/status/123")
reject("https://x.com:8080/example/status/123")
reject("x2obsidian://save?url=\(encoded)&vault=/tmp/other", incoming: true)
reject("x2obsidian://unknown?url=\(encoded)", incoming: true)
reject("x2obsidian://save?url=https%3A%2F%2Fx.com%2Fhome", incoming: true)
print("Native URL validation: 10 checks passed")
