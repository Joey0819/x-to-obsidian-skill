import AppKit
import Foundation

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private let linkField = NSTextField()
    private let vaultField = NSTextField()
    private let modelField = NSTextField()
    private let statusLabel = NSTextField(wrappingLabelWithString: "粘贴帖子链接，或使用浏览器书签一键保存。\nPaste a post link, or use the browser bookmark.")
    private let detailLabel = NSTextField(wrappingLabelWithString: "")
    private let summaryCheck = NSButton(checkboxWithTitle: "添加本地 AI 摘要 / Add local AI summary", target: nil, action: nil)
    private let refreshCheck = NSButton(checkboxWithTitle: "重新抓取已保存内容 / Refresh existing content", target: nil, action: nil)
    private let spinner = NSProgressIndicator()
    private var saveButton: NSButton!
    private var currentButton: NSButton!
    private let settings = UserDefaults.standard
    private var pending: [Request] = []
    private var running = false

    private struct Request {
        let link: String?
        let vault: String
        let model: String
        let summarize: Bool
        let refresh: Bool
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow()
        if CommandLine.arguments.contains("--check-ui") {
            window.contentView!.layoutSubtreeIfNeeded()
            let frame = detailLabel.convert(detailLabel.bounds, to: window.contentView!)
            let fits = frame.minY >= 12 && frame.maxX <= window.contentView!.bounds.width - 12
            print("UI layout check: \(fits ? "passed" : "failed") (detail frame: \(frame))")
            exit(fits ? 0 : 1)
        }
        if pending.isEmpty { showWindow() }
        processNext()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        if window == nil { buildWindow() }
        for url in urls {
            do {
                let link = try CaptureLink.incoming(url)
                linkField.stringValue = link
                enqueue(link: link)
            } catch { showError(error.localizedDescription) }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    private func buildWindow() {
        if window != nil { return }
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 660, height: 700),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "X to Obsidian · 一键保存"
        window.isReleasedWhenClosed = false
        window.center()
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24),
        ])

        let heading = NSTextField(labelWithString: "把 X 的内容留在你的知识库")
        heading.font = .systemFont(ofSize: 23, weight: .semibold)
        stack.addArrangedSubview(heading)
        let subtitle = NSTextField(labelWithString: "Save X posts to Obsidian. No Terminal required.")
        subtitle.textColor = .secondaryLabelColor
        stack.addArrangedSubview(subtitle)

        linkField.placeholderString = "https://x.com/author/status/..."
        linkField.target = self
        linkField.action = #selector(saveLink)
        addField(label: "帖子链接 / X post URL", field: linkField, to: stack)

        saveButton = NSButton(title: "保存到 Obsidian / Save", target: self, action: #selector(saveLink))
        saveButton.bezelStyle = .rounded
        saveButton.keyEquivalent = "\r"
        currentButton = NSButton(title: "当前 Chrome 帖子 / Current Chrome Post", target: self, action: #selector(saveCurrent))
        currentButton.bezelStyle = .rounded
        let actions = NSStackView(views: [saveButton, currentButton])
        actions.spacing = 10
        stack.addArrangedSubview(actions)

        vaultField.isEditable = false
        vaultField.stringValue = ProcessInfo.processInfo.environment["X2OBSIDIAN_VAULT"]
            ?? settings.string(forKey: "vault")
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents/Obsidian Vault").path
        let choose = NSButton(title: "选择仓库 / Choose Vault", target: self, action: #selector(chooseVault))
        choose.bezelStyle = .rounded
        addField(label: "保存位置 / Obsidian vault", field: vaultField, to: stack)
        stack.addArrangedSubview(choose)

        summaryCheck.state = settings.bool(forKey: "summarize") ? .on : .off
        stack.addArrangedSubview(summaryCheck)
        modelField.placeholderString = "Local Ollama model"
        modelField.stringValue = settings.string(forKey: "model") ?? ProcessInfo.processInfo.environment["X2OBSIDIAN_MODEL"] ?? "gemma4:26b"
        addField(label: "摘要模型 / Summary model", field: modelField, to: stack)
        stack.addArrangedSubview(refreshCheck)

        let bookmark = NSButton(title: "设置浏览器一键书签 / Set Up Browser Button", target: self, action: #selector(openSetup))
        bookmark.bezelStyle = .rounded
        stack.addArrangedSubview(bookmark)
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        let progress = NSStackView(views: [spinner, statusLabel])
        progress.spacing = 8
        stack.addArrangedSubview(progress)
        detailLabel.font = .systemFont(ofSize: 11)
        detailLabel.textColor = .secondaryLabelColor
        stack.addArrangedSubview(detailLabel)
        for view in [linkField, vaultField, modelField, detailLabel] {
            view.widthAnchor.constraint(equalToConstant: 604).isActive = true
        }
        statusLabel.widthAnchor.constraint(equalToConstant: 580).isActive = true
        let appMenu = NSMenu()
        let appItem = NSMenuItem()
        let submenu = NSMenu()
        submenu.addItem(withTitle: "Quit X to Obsidian / 退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = submenu
        appMenu.addItem(appItem)
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Paste / 粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Copy / 复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Select All / 全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        appMenu.addItem(editItem)
        NSApp.mainMenu = appMenu
    }

    private func addField(label: String, field: NSTextField, to stack: NSStackView) {
        let group = NSStackView(views: [NSTextField(labelWithString: label), field])
        group.orientation = .vertical
        group.alignment = .leading
        group.spacing = 5
        stack.addArrangedSubview(group)
    }

    private func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func chooseVault() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "选择 / Choose"
        if panel.runModal() == .OK, let url = panel.url {
            vaultField.stringValue = url.path
            settings.set(url.path, forKey: "vault")
        }
    }

    @objc private func openSetup() {
        if let url = Bundle.main.url(forResource: "bookmark", withExtension: "html") { NSWorkspace.shared.open(url) }
    }

    @objc private func saveLink() {
        do { enqueue(link: try CaptureLink.post(linkField.stringValue)) }
        catch { showError(error.localizedDescription) }
    }

    @objc private func saveCurrent() { enqueue(link: nil) }

    private func enqueue(link: String?) {
        if ProcessInfo.processInfo.environment["X2OBSIDIAN_VAULT"] == nil {
            settings.set(vaultField.stringValue, forKey: "vault")
        }
        settings.set(modelField.stringValue, forKey: "model")
        settings.set(summaryCheck.state == .on, forKey: "summarize")
        pending.append(Request(link: link, vault: vaultField.stringValue, model: modelField.stringValue,
                               summarize: summaryCheck.state == .on, refresh: refreshCheck.state == .on))
        showWindow()
        processNext()
    }

    private func processNext() {
        guard !running, window != nil, !pending.isEmpty else { return }
        let request = pending.removeFirst()
        guard let node = findNode(), let script = Bundle.main.url(forResource: "desktop-capture", withExtension: "js") else {
            showError("Node.js is unavailable / 未找到 Node.js。")
            return
        }
        running = true
        saveButton.isEnabled = false
        currentButton.isEnabled = false
        spinner.startAnimation(nil)
        statusLabel.stringValue = "正在保存正文… / Saving post content…"
        statusLabel.textColor = .labelColor
        detailLabel.stringValue = ""
        var arguments = [script.path, "--vault", request.vault, "--model", request.model]
        if ProcessInfo.processInfo.environment["X2OBSIDIAN_OPEN_NOTE"] != "0" { arguments.append("--open") }
        if let link = request.link { arguments += ["--url", link] } else { arguments.append("--current") }
        if request.summarize { arguments.append("--summarize") }
        if request.refresh { arguments.append("--refresh") }
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: node)
            process.arguments = arguments
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe
            var result: [String: Any]
            do {
                try process.run()
                let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                process.waitUntilExit()
                let marker = "X2OBSIDIAN_RESULT="
                let json = output.components(separatedBy: "\n").last(where: { $0.hasPrefix(marker) })?.dropFirst(marker.count)
                if let json = json, let parsed = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] {
                    result = parsed
                } else {
                    result = ["status": "error", "message": String(output.suffix(1500))]
                }
            } catch { result = ["status": "error", "message": error.localizedDescription] }
            self.writeResult(result)
            DispatchQueue.main.async { self.complete(result, requestedSummary: request.summarize) }
        }
    }

    private func complete(_ result: [String: Any], requestedSummary: Bool) {
        running = false
        spinner.stopAnimation(nil)
        saveButton.isEnabled = true
        currentButton.isEnabled = true
        switch result["status"] as? String {
        case "saved":
            statusLabel.textColor = .systemGreen
            statusLabel.stringValue = requestedSummary && result["hasSummary"] as? Bool != true
                ? "正文已保存；摘要未生成 / Saved; summary unavailable"
                : (result["opened"] as? Bool == true ? "已保存并打开 Obsidian / Saved and opened in Obsidian" : "已保存 / Saved")
            detailLabel.stringValue = result["note"] as? String ?? ""
        case "incomplete":
            statusLabel.textColor = .systemOrange
            statusLabel.stringValue = "仅获取链接或预览，未获取正文 / Content incomplete"
            detailLabel.stringValue = "来源可能受限，请稍后重试 / The public source may be restricted; retry later."
        default:
            showError(result["message"] as? String ?? "Unable to save / 保存失败。")
        }
        processNext()
    }

    private func showError(_ message: String) {
        showWindow()
        statusLabel.textColor = .systemRed
        statusLabel.stringValue = "保存失败 / Unable to save"
        detailLabel.stringValue = message
    }

    private func findNode() -> String? {
        let paths = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map { "\($0)/node" }
        return (["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] + paths)
            .first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    private func writeResult(_ result: [String: Any]) {
        let logDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/X to Obsidian")
        do {
            try FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: logDir.appendingPathComponent("last-result.json"), options: .atomic)
        } catch { NSLog("Could not write capture status: %@", error.localizedDescription) }
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.setActivationPolicy(.regular)
application.delegate = delegate
application.run()
