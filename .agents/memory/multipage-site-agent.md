---
name: Multipage site agent + craft.md
description: Replit-style edit architecture — agents see all pages, function calling via KIE Claude tools, per-project craft.md memory.
---

## Why
Previously edit mode scoped the model to `activeFile` only ("НЕ редактируй" other pages). Multipage sites could not be edited coherently.

## What shipped
- `server/agent-runtime.ts` — craft.md helpers, multipage prompts, SEARCH/REPLACE helpers, Claude + Gemini tool loops (`runToolCallingAgent({ provider })`), multipage response parser.
- Edit path in `POST /api/projects/:id/generate` (`server/routes.ts`):
  1. Build site page list + ensure `craft.md`
  2. Claude (v1) **or** Gemini (v2/interactive): try function calling tools; on reject/empty → stream multipage DIFF protocol
  3. Persist any changed HTML files; refresh `craft.md` journal
- `craft.md` stored in `project_files`, filtered from editor tabs and publish bucket.
- Hosting daily cost: **35** tokens/site (`DAILY_PUBLISH_COST`), UI + `replit.md` aligned.

## Tools (Claude / Gemini via KIE)
`list_pages`, `read_page`, `apply_patch`, `write_page`, `read_craft_md`, `update_craft_md`, `finish`

- Claude: Anthropic Messages `tools` / `tool_use` / `tool_result`
- Gemini: `tools: [{ functionDeclarations }]` on `:generateContent`; replies via `functionCall` → we return `functionResponse`

## Text protocol (fallback)
```
--- FILE: about.html ---
```diff
<<<<<<< SEARCH
...
=======
...
>>>>>>> REPLACE
```
```
