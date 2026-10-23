# X to Obsidian Skill / X 内容入库技能

Save public X/Twitter posts and X Articles as readable Obsidian Markdown for local AI summaries and follow-up writing.

将公开 X 帖子和长文章保存为可阅读的 Obsidian 笔记，供本地模型总结并辅助后续写作。

## Install / 安装

Clone this repository into your personal skills directory:

```bash
git clone https://github.com/Joey0819/x-to-obsidian-skill.git ~/.codex/skills/x-to-obsidian
```

The repository is private; access is required. If the folder already exists, update the existing checkout instead of overwriting it. Reopen your Codex session if the skill list does not refresh.

仓库为私有，需要访问权限。若目录已存在，请更新已有仓库。技能列表未刷新时，重新打开 Codex 会话。

Invoke `$x-to-obsidian`, or run the helper directly with Node.js 18+:

```bash
node scripts/sync-x-to-obsidian.js --vault "/path/to/Obsidian Vault" --url "https://x.com/author/status/1234567890" --open
```

## Frontend and UI / 前端与界面

Open a specific X post in Chrome, then run `bash scripts/x2obsidian`. With no arguments this reads the current Chrome post and opens the note in Obsidian on macOS. Clipboard capture uses `--clipboard`; batch capture uses `--file urls.txt`. When the X app is not exposed through Chrome automation, pass the shared post URL explicitly.

在 Chrome 中打开具体帖子，再运行 `bash scripts/x2obsidian`。macOS 下无参数运行会读取当前帖子并在 Obsidian 打开笔记。X 独立应用无法通过 Chrome 读取时，使用 `--url` 指定分享链接。

## Backend / 后台

- `scripts/sync-x-to-obsidian.js`: importer; no npm dependencies or user X API key.
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
node --test tests/sync.test.js
```

The tests use synthetic responses and a temporary vault, including article-body capture, duplicate prevention, safe refresh, URL-only failure reporting, and local-summary input. No personal vault or network access is needed for tests. This project is a skill with a CLI; it has no packaged desktop app to rebuild.

测试使用合成响应和临时仓库，不读取个人笔记，不需要网络。该项目是技能和命令行工具，不含需要重新构建的桌面应用。
