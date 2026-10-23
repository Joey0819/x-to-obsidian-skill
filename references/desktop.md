# Desktop Companion / 桌面辅助应用

The native AppKit app handles the browser bookmark's custom URL, calls the bundled Node importer with separate arguments, and opens the saved Obsidian note. It does not run a background HTTP server or require a browser extension.

## Build and Install / 构建与安装

From the skill root on macOS:

```bash
node scripts/build-macos.js --install
```

Output: `artifacts/X to Obsidian.app`. Installed copy: `~/Applications/X to Obsidian.app`. Rebuild and reinstall after changes to native code, the bookmark page, the importer, or the desktop bridge. The build verifies the ad-hoc code signature and runs a native view-layout smoke check. This is a local build, not an Apple-notarized distribution.

The app bundles its backend and bookmark page, so moving the skill source later does not break the installed copy. An installed Node.js 18+ runtime is still needed. Node locations are detected from common Homebrew/Node paths and the app's inherited `PATH`.

## Frontend / UI

- Paste an X post URL and click **Save**, or click **Current Chrome Post**.
- **Choose Vault** selects an existing Obsidian folder.
- **Add local AI summary** uses the named installed Ollama model. It defaults to off; source capture does not require Ollama.
- **Set Up Browser Button** opens the local setup page. Drag its button onto the browser's bookmarks bar once. Thereafter click it on a specific X post.
- The first browser handoff may ask permission to open the app. Current Chrome capture may request macOS automation permission. Pasted links and the bookmark do not need Chrome automation.

中文：日常操作为“打开具体帖子 → 点击书签 → Obsidian 打开笔记”。也可在应用中粘贴链接。浏览器书签需要一次拖放设置，之后不需要终端。

## Backend and Verification / 后台与验证

`scripts/desktop-capture.js` emits a final `X2OBSIDIAN_RESULT=` JSON record for the GUI. It automatically refreshes incomplete notes and generates a requested summary if one is absent. Capture failures preserve the existing full-text note. A failed local summary does not prevent saving source content.

Native input validation restricts URL events to one public X status URL. Vault/model/summary settings come from the app, not URL parameters. User settings live in the app's UserDefaults domain, `com.joey0819.x-to-obsidian`; they are not stored in the Git repository. The most recent result is local to `~/Library/Logs/X to Obsidian/last-result.json`.

```bash
node --test tests/*.test.js
bash tests/verify-macos.sh
node scripts/build-macos.js
```

The first checks cover source capture, duplicates, refresh/backup behavior, desktop result reporting, and bookmark URL handoff with synthetic responses. The native checks cover accepted/rejected URL events and type-check the app. The build checks the actual native window layout. For an end-to-end live check, launch the app with a temporary `X2OBSIDIAN_VAULT` environment override, deliver a save URI through Launch Services, and read the resulting note and last-result JSON. Such an override does not replace the user's saved vault preference.

Browser limitations: the bookmark requires the specific post's detail URL. It cannot choose a post from the X home feed. A native X app can use the copy-link-and-paste path. Media links remain remote; image/video text is not transcribed.

For an optional live article check after installation, close the companion app and run `node tests/live-desktop.js "PUBLIC_X_POST_URL"`. It verifies the registered handler, uses a temporary vault, suppresses opening that unregistered test vault in Obsidian, and restores the previous result log. It deliberately requires article-body text rather than accepting a successful metadata-only capture. It does not automate an actual browser click.

The build unregisters its temporary app copy after the layout check, then the installer registers the copy in `~/Applications`. This prevents Launch Services from routing bookmarks to a build artifact. URL event handling follows [Apple's NSApplicationDelegate application(_:open:) API](https://developer.apple.com/documentation/appkit/nsapplicationdelegate/application(_:open:)).
