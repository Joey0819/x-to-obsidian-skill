# X to Obsidian Skill / X 内容入库技能

Save public X/Twitter posts and X Articles as readable Obsidian Markdown for local AI summaries and follow-up writing.

将公开 X 帖子和长文章保存为可阅读的 Obsidian 笔记，供本地模型总结并辅助后续写作。

## Daily Use Without Terminal / 日常使用无需终端

1. Open **X to Obsidian** from your Applications folder. The app is installed at `~/Applications/X to Obsidian.app` on the configured Mac.
2. Click **Set Up Browser Button** and drag **Save to Obsidian** into the browser bookmarks bar once.
3. Open a specific X post and click that bookmark. Its actual content is saved and the note opens in Obsidian. Allow the browser to open the app on the first handoff.

打开应用 → 设置一次浏览器书签 → 在 X 帖子页点击“保存到 Obsidian”。之后无需在终端输入命令。也可在应用中直接粘贴帖子链接，或选择“当前 Chrome 帖子”。

The app lets you choose an existing vault, enable a local Ollama summary, and refresh saved content. Incomplete saved notes are retried automatically. The bookmark sends only the current post URL; it does not read account cookies or synchronize every X bookmark.

应用可以选择仓库、开启本地摘要、刷新已有内容；已有不完整笔记会自动重试。浏览器书签只发送当前帖子链接，不读取账号 Cookie，也不自动同步全部收藏。

## Install / 安装

Clone this repository into your personal skills directory:

```bash
git clone https://github.com/Joey0819/x-to-obsidian-skill.git ~/.codex/skills/x-to-obsidian
```

The repository is private; access is required. If the folder already exists, update the existing checkout instead of overwriting it. Reopen your Codex session if the skill list does not refresh.

仓库为私有，需要访问权限。若目录已存在，请更新已有仓库。技能列表未刷新时，重新打开 Codex 会话。

Ask Codex to use `$x-to-obsidian` and set up the desktop app. It can build/install the app for you on macOS. For developer setup, see [desktop build instructions](references/desktop.md).

请让 Codex 使用 `$x-to-obsidian` 并完成桌面应用安装。日常操作使用书签或应用按钮即可。

The CLI remains available for automation with Node.js 18+:

```bash
node scripts/sync-x-to-obsidian.js --vault "/path/to/Obsidian Vault" --url "https://x.com/author/status/1234567890" --open
```

## Frontend and UI / 前端与界面

The primary UI is a native macOS app plus a browser bookmark. It supports direct link capture, current Chrome post capture, a vault picker, local summary settings, and clear saved/incomplete/error states. A native X app can use the copy-link-and-paste path.

前端为 macOS 原生应用和浏览器书签，包含粘贴链接、当前 Chrome 帖子、仓库选择、本地摘要及状态反馈。独立 X 应用可复制帖子链接后粘贴保存。

## Backend / 后台

- `scripts/sync-x-to-obsidian.js`: importer; no npm dependencies or user X API key.
- `scripts/desktop-capture.js`: structured result bridge used by the app.
- `desktop/`: native application source and browser bookmark setup page.
- Source chain: official X oEmbed, third-party FxTwitter, then best-effort public X web fallback for missing content.
- `X2OBSIDIAN_VAULT` or `--vault`: existing destination vault; default `~/Documents/Obsidian Vault`.
- `--refresh`: refresh a captured note with a backup and preserved `My Notes`.
- `--refresh-incomplete`: retry saved URL-only or preview-only notes.
- `--summarize --model NAME`: use installed local Ollama at `localhost:11434`. The default is `X2OBSIDIAN_MODEL` or `gemma4:26b`.

不需要 npm 依赖或个人 X API key。数据源依次为官方 oEmbed、第三方 FxTwitter 和尽力而为的 X 公开网页接口。刷新前保留备份和 `My Notes`；总结使用已安装的本地 Ollama 模型。

## Output and Limits / 输出与边界

Notes go to `X/Tweets/`; the inbox is `X/Inbox/X Inbox.md`; duplicate tracking is `X/.x-sync-index.json`. A local summary appears above the full article. Remote media links are preserved, but images are not downloaded and video/image text is not transcribed. The tool reports incomplete content instead of treating a URL as the body, and refuses to downgrade a full-text note during refresh.

笔记保存到 `X/Tweets/`，入口列表和去重索引同步更新。摘要置于正文前。媒体保留远程链接，不自动下载、OCR 或转写。内容不完整会明确提示，刷新不会用不完整内容覆盖已有全文。

Public sources can fail or change. Private, deleted, restricted, paid, or login-gated content may be unavailable. This is on-demand URL capture, not automatic bookmark synchronization or a scheduled task. The tool never builds Copilot's index itself. See [Copilot troubleshooting](references/copilot-troubleshooting.md) for stale chat/context issues.

仅支持按需抓取公开 URL；并非自动书签同步或定时任务。受限内容可能不可用。Copilot 索引需要在 Obsidian 中单独操作。

## Verify and Package / 验证与打包

```bash
node --check scripts/sync-x-to-obsidian.js
node --test tests/*.test.js
bash tests/verify-macos.sh
node scripts/build-macos.js --install
```

The tests use synthetic responses and a temporary vault, including article-body capture, duplicate prevention, safe refresh, URL-only failure reporting, local-summary input, and browser-to-app handoff. Native checks validate URL events and app code. Rebuild and reinstall the actual packaged app after source changes; the build also checks its window layout. Generated binaries and local user data are excluded from Git.

测试使用合成响应和临时仓库，不读取个人笔记，不需要网络。更新源码后需重新构建并安装实际应用；构建过程也验证窗口布局。生成的二进制文件和个人数据不会提交到 Git。
