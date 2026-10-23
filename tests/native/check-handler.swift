import AppKit
import Foundation

let link = URL(string: "x2obsidian://save?url=https%3A%2F%2Fx.com%2Fexample%2Fstatus%2F123")!
print(NSWorkspace.shared.urlForApplication(toOpen: link)?.path ?? "unregistered")
