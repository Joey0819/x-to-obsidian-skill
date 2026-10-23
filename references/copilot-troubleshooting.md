# Copilot Context Troubleshooting / Copilot 上下文排查

Use this when Obsidian displays real article text but Copilot answers that only a URL exists.

1. Read the saved Markdown. Confirm body text beyond the preview, and check that the current file is the same note attached to chat. If only a URL exists, refresh the capture first. If an article source exposes only a preview, report that limitation rather than summarize an invented body.
2. Check the note attached beside the chat input. Remove and reattach it, or toggle automatic active-note context if necessary. Copilot may retain the attachment from the old file state. A visible note in the editor does not by itself prove that its latest content was sent.
3. Start a new **Copilot conversation** if the existing one repeatedly says the note has no content. Keep the saved old chat; do not delete the conversation files. This is an Obsidian action, not permission to create a separate Codex task.
4. Ask a fresh, verifiable question: "Summarize the current note's X Article section. Give its title, main ideas, and practical next steps. Reply in Chinese with a short English summary." Confirm the response includes facts from the note, rather than accepting any generic Obsidian advice as proof.
5. If using vault/RAG search or Relevant Notes, run Copilot's available **Build Index** or reindex command and check completion with the configured embedding model. A rebuild is not necessary merely to chat with explicitly attached text. Do not delete the index or enter an unrelated cloud API key as a generic fix.
6. If fresh attachment and conversation still fail, inspect actual provider/model settings, request errors, and context truncation where available. Large conversation history, cached attachments, index contents, and model behavior are separate hypotheses. `maxTokens` may control output length, so increasing it is not evidence that more input text was sent.

Optional diagnostic: send the relevant article body directly to the installed local Ollama model. If that works, investigate Copilot's note context. If it fails, check the model/service separately. Do not paste the user's private note into a cloud provider just to test it.

中文提示：已有正文时，优先重新附加当前笔记并新建 Copilot 对话；仅在使用知识库检索时重建索引。保留旧聊天记录，并用文章里的具体内容验证模型确实读到了笔记。
