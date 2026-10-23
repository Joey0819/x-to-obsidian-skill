import Foundation

enum CaptureLink {
    static func post(_ value: String) throws -> String {
        guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(), ["https", "http"].contains(scheme),
              let host = url.host?.lowercased(), ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].contains(host),
              url.user == nil, url.password == nil, url.port == nil else {
            throw invalid("Use an X post link / 请使用 X 帖子链接。")
        }
        let parts = url.path.split(separator: "/").map(String.init)
        guard parts.count >= 3, ["status", "statuses"].contains(parts[1]),
              parts[0].range(of: "^[A-Za-z0-9_]+$", options: .regularExpression) != nil,
              parts[2].range(of: "^[0-9]+$", options: .regularExpression) != nil else {
            throw invalid("Open a specific post, not the X home feed / 请打开具体帖子详情页。")
        }
        return "https://x.com/\(parts[0])/status/\(parts[2])"
    }

    static func incoming(_ url: URL) throws -> String {
        guard url.scheme?.lowercased() == "x2obsidian", url.host == "save",
              url.path.isEmpty || url.path == "/",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = components.queryItems,
              items.count == 1, items[0].name == "url", let value = items[0].value else {
            throw invalid("Invalid save link / 无效的保存链接。")
        }
        return try post(value)
    }

    private static func invalid(_ message: String) -> NSError {
        NSError(domain: "XToObsidian", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
