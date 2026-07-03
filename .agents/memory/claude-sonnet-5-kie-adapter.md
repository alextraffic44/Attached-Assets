---
name: Claude Sonnet 5 via KIE Messages API
description: How the site-generation "v1 agent" talks to Claude Sonnet 5 through KIE's Anthropic-style proxy, and what differs from the old GPT-5.5/Codex-style adapter.
---

The primary code-generation agent ("v1") calls `https://api.kie.ai/claude/v1/messages`
(Anthropic Messages API shape), not the old Codex-style `/codex/v1/responses`.

Confirmed by direct curl against the live endpoint (not just spec-reading):
- Auth is plain `Authorization: Bearer <KIE_API_KEY>` (the spec's "X-Api-Key /
  anthropic-version" note is boilerplate from Anthropic's own docs and does NOT
  apply to KIE's proxy — verified working with Bearer only).
- Request body: `{ model: "claude-sonnet-5", system, messages, max_tokens, thinkingFlag, stream }`.
  `system` is a top-level string, NOT a message with role "developer"/"system"
  (Claude's `messages` array only accepts role user/assistant).
- Non-stream response: `content` is an array of `{ type: "text", text }` blocks — concatenate all `type === "text"` items.
- Stream response SSE events: `message_start` → `content_block_start` → repeated
  `content_block_delta` (`delta.type === "text_delta"`, `delta.text` is the chunk)
  → `content_block_stop` → `message_delta` → `message_stop`. No `[DONE]` sentinel;
  end of stream is the `message_stop` event.
- `thinkingFlag` is a plain boolean (not Anthropic's real `thinking.budget_tokens`
  object) — this KIE adapter only exposes on/off extended thinking.

**Why:** the internal `KieMessage`/`KieContentItem` types (input_text/input_image/
input_image_inline) were kept unchanged across the whole codebase; only a
`toClaudeMessages()` converter + the two low-level `kieGenerateSync`/`kieGenerateStream`
functions were rewritten. This meant callers (vision analysis, prompt-enhance, audit,
main generate/edit flow) needed zero changes — swapping the underlying model provider
only touched ~2 functions.

**How to apply:** if KIE changes this adapter again or a future model swap happens,
keep the same pattern — translate into/out of the shared `KieMessage` shape at the
edge (inside `kieGenerateSync`/`kieGenerateStream`), don't leak provider-specific
formats into call sites.
