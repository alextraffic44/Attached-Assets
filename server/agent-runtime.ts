/**
 * Multipage site agent runtime (Replit-style).
 *
 * - Per-project craft.md — short agent memory (site brief + change log)
 * - Claude function calling via KIE Anthropic Messages API (tools)
 * - Multipage text protocol fallback (Gemini + when tools unavailable)
 *
 * Agents can list/read/patch any page, not only the editor's active tab.
 */

import { storage } from "./storage";

export const CRAFT_MD_FILENAME = "craft.md";

const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_LLM_URL = "https://api.kie.ai/claude/v1/messages";
const KIE_LLM_MODEL = "claude-sonnet-5";
const KIE_LLM_MAX_TOKENS = 64000;

export type SitePage = { filename: string; code: string };

export type AgentStatusWriter = (status: string) => void;
export type AgentContentWriter = (chunk: string) => void;

export function isHtmlPage(filename: string): boolean {
  return filename.toLowerCase().endsWith(".html");
}

export function stripBase64Images(code: string): { stripped: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  let counter = 0;
  const stripped = code.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g, (match) => {
    const placeholder = `__B64_${counter++}__`;
    map.set(placeholder, match);
    return placeholder;
  });
  return { stripped, map };
}

export function restoreBase64Images(code: string, map: Map<string, string>): string {
  let result = code;
  for (const [placeholder, original] of map) {
    result = result.split(placeholder).join(original);
  }
  return result;
}

function extractPageTitle(code: string): string {
  const title = code.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  if (title) return title.slice(0, 80);
  const h1 = code.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (h1) return h1.slice(0, 80);
  return "";
}

function extractSections(code: string): string[] {
  const sections: string[] = [];
  const re = /<(section|header|footer|main|nav)[^>]*(?:id=["']([^"']+)["'])?[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null && sections.length < 12) {
    const tag = m[1].toLowerCase();
    const id = m[2] || "";
    sections.push(id ? `${tag}#${id}` : tag);
  }
  return sections;
}

export function buildInitialCraftMd(opts: {
  title: string;
  description?: string | null;
  userPrompt?: string;
  pages: SitePage[];
}): string {
  const htmlPages = opts.pages.filter((p) => isHtmlPage(p.filename));
  const pageLines = htmlPages.map((p) => {
    const t = extractPageTitle(p.code);
    const secs = extractSections(p.code);
    return `- \`${p.filename}\`${t ? ` — ${t}` : ""}${secs.length ? ` [${secs.join(", ")}]` : ""}`;
  });

  const brief = (opts.description || opts.userPrompt || opts.title || "Сайт").trim().slice(0, 500);
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  return `# craft.md — память агента сайта

> Этот файл читают Claude/Gemini при каждом редактировании. Держи его коротким и точным.

## Сайт
- **Название:** ${opts.title || "Без названия"}
- **Кратко:** ${brief}
- **Создан:** ${now} UTC

## Страницы
${pageLines.length ? pageLines.join("\n") : "- `index.html`"}

## Дизайн и договорённости
- Стек: чистый HTML/CSS/JS без внешних CSS/JS CDN-фреймворков (Google Fonts можно)
- Навбар и футер общие — при правках одной страницы сохраняй навигацию согласованной
- Плейсхолдеры \`__B64_N__\` — встроенные изображения, не трогать

## Журнал изменений
- ${now} — первичная генерация сайта
`;
}

export async function ensureCraftMd(
  projectId: number,
  opts: { title: string; description?: string | null; userPrompt?: string; pages: SitePage[] },
): Promise<string> {
  const existing = await storage.getProjectFile(projectId, CRAFT_MD_FILENAME);
  if (existing?.code?.trim()) return existing.code;

  const md = buildInitialCraftMd(opts);
  await storage.upsertProjectFile({ projectId, filename: CRAFT_MD_FILENAME, code: md });
  return md;
}

export async function refreshCraftMdPages(
  projectId: number,
  pages: SitePage[],
  changeNote?: { userRequest: string; summary: string; changedFiles: string[] },
): Promise<string> {
  const existing = await storage.getProjectFile(projectId, CRAFT_MD_FILENAME);
  let md = existing?.code || "";

  const htmlPages = pages.filter((p) => isHtmlPage(p.filename));
  const pageLines = htmlPages.map((p) => {
    const t = extractPageTitle(p.code);
    const secs = extractSections(p.code);
    return `- \`${p.filename}\`${t ? ` — ${t}` : ""}${secs.length ? ` [${secs.join(", ")}]` : ""}`;
  });

  const pagesBlock = `## Страницы\n${pageLines.length ? pageLines.join("\n") : "- `index.html`"}`;

  if (!md.trim()) {
    md = buildInitialCraftMd({
      title: "Сайт",
      pages,
      userPrompt: changeNote?.userRequest,
    });
  } else if (/## Страницы[\s\S]*?(?=\n## |\n# |$)/.test(md)) {
    md = md.replace(/## Страницы[\s\S]*?(?=\n## |\n# |$)/, pagesBlock + "\n");
  } else {
    md = md.trimEnd() + "\n\n" + pagesBlock + "\n";
  }

  if (changeNote) {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const files = changeNote.changedFiles.length
      ? changeNote.changedFiles.map((f) => `\`${f}\``).join(", ")
      : "—";
    const req = changeNote.userRequest.replace(/\s+/g, " ").trim().slice(0, 160);
    const sum = changeNote.summary.replace(/\s+/g, " ").trim().slice(0, 220);
    const entry = `- ${now} — ${sum || "правка"} | файлы: ${files}${req ? ` | запрос: «${req}»` : ""}`;

    if (/## Журнал изменений/.test(md)) {
      md = md.replace(/(## Журнал изменений\n)/, `$1${entry}\n`);
      // Keep journal from exploding — max ~40 entries
      const journalMatch = md.match(/## Журнал изменений\n([\s\S]*?)(?=\n## |\n# |$)/);
      if (journalMatch) {
        const lines = journalMatch[1].split("\n").filter((l) => l.startsWith("- "));
        if (lines.length > 40) {
          const kept = lines.slice(0, 40).join("\n");
          md = md.replace(/## Журнал изменений\n[\s\S]*?(?=\n## |\n# |$)/, `## Журнал изменений\n${kept}\n`);
        }
      }
    } else {
      md = md.trimEnd() + `\n\n## Журнал изменений\n${entry}\n`;
    }
  }

  await storage.upsertProjectFile({ projectId, filename: CRAFT_MD_FILENAME, code: md });
  return md;
}

export function buildSiteManifest(pages: SitePage[], craftMd: string): string {
  const htmlPages = pages.filter((p) => isHtmlPage(p.filename));
  const lines = htmlPages.map((p) => {
    const t = extractPageTitle(p.code);
    const secs = extractSections(p.code);
    return `• ${p.filename} — ${p.code.length} символов${t ? ` — «${t}»` : ""}${secs.length ? ` — секции: ${secs.join(", ")}` : ""}`;
  });

  return `═══ КАРТА САЙТА (все страницы доступны для редактирования) ═══
${lines.join("\n") || "• index.html"}

═══ craft.md (память агента) ═══
${craftMd.slice(0, 6000)}
${craftMd.length > 6000 ? "\n...[craft.md обрезан]" : ""}
`;
}

/** Include full page sources for the agent (with size budget). */
export function buildPagesContext(
  pages: SitePage[],
  activeFile: string,
  maxTotalChars = 110_000,
): { context: string; base64Maps: Map<string, Map<string, string>> } {
  const base64Maps = new Map<string, Map<string, string>>();
  const htmlPages = pages.filter((p) => isHtmlPage(p.filename));

  // Prioritize active file, then index, then others by size ascending (fit more small pages)
  const ordered = [...htmlPages].sort((a, b) => {
    if (a.filename === activeFile) return -1;
    if (b.filename === activeFile) return 1;
    if (a.filename === "index.html") return -1;
    if (b.filename === "index.html") return 1;
    return a.code.length - b.code.length;
  });

  let used = 0;
  const parts: string[] = [];

  for (const page of ordered) {
    const { stripped, map } = stripBase64Images(page.code || "");
    base64Maps.set(page.filename, map);

    const header = `\n─── FILE: ${page.filename} ───\n`;
    const remaining = maxTotalChars - used;
    if (remaining < 800) {
      parts.push(`${header}[код не включён — слишком большой контекст; используй инструмент read_page]\n`);
      continue;
    }

    if (stripped.length + 200 <= remaining || page.filename === activeFile) {
      const budget = page.filename === activeFile ? Math.min(stripped.length, Math.max(remaining - 200, 20_000)) : Math.min(stripped.length, remaining - 200);
      if (budget >= stripped.length) {
        parts.push(`${header}\`\`\`html\n${stripped}\n\`\`\`\n`);
        used += stripped.length + 200;
      } else {
        parts.push(`${header}\`\`\`html\n${stripped.slice(0, budget)}\n\`\`\`\n...[обрезано ${stripped.length - budget} символов — для полного кода вызови read_page("${page.filename}")]\n`);
        used += budget + 200;
      }
    } else {
      const excerpt = stripped.slice(0, Math.min(1800, remaining - 200));
      parts.push(`${header}(превью ${excerpt.length}/${stripped.length} символов)\n\`\`\`html\n${excerpt}\n\`\`\`\n...[используй read_page для полного файла]\n`);
      used += excerpt.length + 200;
    }
  }

  return { context: parts.join("\n"), base64Maps };
}

export const SITE_AGENT_TOOLS = [
  {
    name: "list_pages",
    description: "Список всех HTML-страниц сайта с размерами, title и секциями.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_page",
    description: "Прочитать полный код страницы (с плейсхолдерами __B64_N__ вместо base64).",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Имя файла, например about.html или index.html" },
      },
      required: ["filename"],
      additionalProperties: false,
    },
  },
  {
    name: "apply_patch",
    description:
      "Применить SEARCH/REPLACE патч к любой странице. SEARCH должен точно совпадать с фрагментом кода. Можно вызывать многократно для разных файлов.",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        search: { type: "string", description: "Точный фрагмент существующего кода" },
        replace: { type: "string", description: "Новый код (пустая строка = удалить фрагмент)" },
      },
      required: ["filename", "search", "replace"],
      additionalProperties: false,
    },
  },
  {
    name: "write_page",
    description: "Полностью перезаписать страницу (только если правка затрагивает >50% файла или создаётся новая страница).",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        code: { type: "string", description: "Полный HTML документа" },
      },
      required: ["filename", "code"],
      additionalProperties: false,
    },
  },
  {
    name: "read_craft_md",
    description: "Прочитать craft.md — память агента по этому сайту.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "update_craft_md",
    description: "Обновить раздел «Дизайн и договорённости» или добавить заметку в журнал craft.md.",
    input_schema: {
      type: "object",
      properties: {
        design_notes: { type: "string", description: "Новый текст секции «Дизайн и договорённости» (опционально)" },
        journal_entry: { type: "string", description: "Короткая запись в журнал изменений" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description: "Завершить работу. Вызови когда все нужные правки применены.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "1-3 предложения для пользователя о том, что изменено" },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
] as const;

export function applySinglePatch(originalCode: string, searchBlock: string, replaceBlock: string): { code: string; ok: boolean } {
  if (!searchBlock.trim()) return { code: originalCode, ok: false };

  const exactIdx = originalCode.indexOf(searchBlock);
  if (exactIdx !== -1) {
    return {
      code: originalCode.slice(0, exactIdx) + replaceBlock + originalCode.slice(exactIdx + searchBlock.length),
      ok: true,
    };
  }

  const pattern = searchBlock
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  try {
    const re = new RegExp(pattern);
    const m = re.exec(originalCode);
    if (m) {
      return {
        code: originalCode.slice(0, m.index) + replaceBlock + originalCode.slice(m.index + m[0].length),
        ok: true,
      };
    }
  } catch { /* ignore */ }

  return { code: originalCode, ok: false };
}

/** Apply all ```diff SEARCH/REPLACE blocks in a response fragment to one file. */
export function applyDiffPatchesToCode(originalCode: string, responseFragment: string): { code: string; applied: number; total: number } {
  const diffRegex = /```diff\s*\n([\s\S]*?)```/g;
  let patchedCode = originalCode;
  let applied = 0;
  let total = 0;
  let dm: RegExpExecArray | null;
  while ((dm = diffRegex.exec(responseFragment)) !== null) {
    const diffContent = dm[1];
    const searchReplaceRegex = /<{5,}[ \t]*SEARCH[ \t]*\r?\n([\s\S]*?)\r?\n={5,}[ \t]*\r?\n([\s\S]*?)\r?\n>{5,}[ \t]*REPLACE/g;
    let sr: RegExpExecArray | null;
    while ((sr = searchReplaceRegex.exec(diffContent)) !== null) {
      total++;
      const result = applySinglePatch(patchedCode, sr[1], sr[2]);
      if (result.ok) {
        patchedCode = result.code;
        applied++;
      } else {
        console.warn("[AGENT] SEARCH not found. First 80 chars:", sr[1].substring(0, 80));
      }
    }
  }
  // Also accept bare SEARCH/REPLACE without ```diff fence
  if (total === 0 && responseFragment.includes("<<<<<<< SEARCH")) {
    const searchReplaceRegex = /<{5,}[ \t]*SEARCH[ \t]*\r?\n([\s\S]*?)\r?\n={5,}[ \t]*\r?\n([\s\S]*?)\r?\n>{5,}[ \t]*REPLACE/g;
    let sr: RegExpExecArray | null;
    while ((sr = searchReplaceRegex.exec(responseFragment)) !== null) {
      total++;
      const result = applySinglePatch(patchedCode, sr[1], sr[2]);
      if (result.ok) {
        patchedCode = result.code;
        applied++;
      }
    }
  }
  return { code: patchedCode, applied, total };
}

/**
 * Parse multipage edit response:
 * --- FILE: name.html ---
 * ```diff ... ```  and/or ```html ... ```
 */
export function parseMultipageEditResponse(
  fullResponse: string,
  filesMap: Map<string, string>,
  fallbackFile: string,
): { changed: Map<string, string>; applied: number; total: number; aiTextReply: string } {
  const changed = new Map<string, string>();
  let applied = 0;
  let total = 0;

  const firstMarker = fullResponse.search(/---\s*FILE:\s*[^\s\-]+\.html\s*---/i);
  const firstDiff = fullResponse.indexOf("```diff");
  const firstHtml = fullResponse.indexOf("```html");
  const firstCode = [firstDiff, firstHtml].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  let aiTextReply = "";
  if (firstMarker > 0) {
    aiTextReply = fullResponse.substring(0, firstMarker).trim();
  } else if (firstCode > 0) {
    aiTextReply = fullResponse.substring(0, firstCode).trim();
  }

  const fileSectionRegex = /---\s*FILE:\s*([^\s\-]+\.html)\s*---\s*\n?([\s\S]*?)(?=\n---\s*FILE:\s*[^\s\-]+\.html\s*---|$)/gi;
  const sections: { filename: string; body: string }[] = [];
  let fm: RegExpExecArray | null;
  while ((fm = fileSectionRegex.exec(fullResponse)) !== null) {
    sections.push({ filename: fm[1].trim().toLowerCase(), body: fm[2] });
  }

  if (sections.length > 0) {
    for (const sec of sections) {
      const original = filesMap.get(sec.filename) ?? (sec.filename === "index.html" ? filesMap.get("index.html") : undefined) ?? "";
      if (sec.body.includes("<<<<<<< SEARCH") || sec.body.includes("```diff")) {
        const { stripped, map } = stripBase64Images(original);
        const patch = applyDiffPatchesToCode(stripped, sec.body);
        total += patch.total;
        applied += patch.applied;
        if (patch.applied > 0) {
          changed.set(sec.filename, restoreBase64Images(patch.code, map));
        }
      } else {
        const htmlMatch = sec.body.match(/```html\s*\n?([\s\S]*?)```/i);
        let code = htmlMatch?.[1]?.trim() || "";
        if (!code && /<!DOCTYPE\s+html|<html[\s>]/i.test(sec.body)) {
          code = sec.body.replace(/^[\s\S]*?(<!DOCTYPE\s+html|<html[\s>])/i, "$1").trim();
        }
        if (code && code.includes("<") && code.length > 50) {
          total++;
          applied++;
          changed.set(sec.filename, code);
        }
      }
    }
  } else if (fullResponse.includes("<<<<<<< SEARCH") || fullResponse.includes("```diff")) {
    // Legacy: diffs target active/fallback file only
    const original = filesMap.get(fallbackFile) || filesMap.get("index.html") || "";
    const { stripped, map } = stripBase64Images(original);
    const patch = applyDiffPatchesToCode(stripped, fullResponse);
    total = patch.total;
    applied = patch.applied;
    if (patch.applied > 0) {
      changed.set(fallbackFile, restoreBase64Images(patch.code, map));
    }
  }

  return { changed, applied, total, aiTextReply };
}

export function buildMultipageEditSystemPrompt(opts: {
  baseSystem: string;
  activeFile: string;
  craftMd: string;
  pages: SitePage[];
  useToolsHint: boolean;
}): string {
  const manifest = buildSiteManifest(opts.pages, opts.craftMd);
  const { context } = buildPagesContext(opts.pages, opts.activeFile);

  let prompt = opts.baseSystem;
  prompt += `\n\n${"═".repeat(43)}
РЕЖИМ РЕДАКТИРОВАНИЯ САЙТА — MULTIPAGE AGENT
${"═".repeat(43)}
Пользователь сейчас смотрит файл «${opts.activeFile}», но ты видишь ВЕСЬ сайт и можешь менять ЛЮБУЮ страницу (и несколько сразу), если запрос этого требует.

⚠️ ПРАВИЛА:
1. Меняй только то, что просит пользователь; сохраняй nav/footer и ссылки между страницами
2. Плейсхолдеры __B64_N__ — изображения. НЕ удаляй и НЕ меняй их
3. Если правка затрагивает общий стиль/навигацию — обнови все затронутые страницы
4. После существенных правок обнови craft.md (дизайн-заметки / журнал)

${manifest}

═══ ИСХОДНЫЙ КОД СТРАНИЦ ═══
${context}
`;

  if (opts.useToolsHint) {
    prompt += `
🔧 ИНСТРУМЕНТЫ (function calling):
У тебя есть tools: list_pages, read_page, apply_patch, write_page, read_craft_md, update_craft_md, finish.
Рабочий цикл: при необходимости read_page → apply_patch (можно много раз, на разных файлах) → update_craft_md → finish(summary).
Не выводи огромный HTML в чат — используй tools.
`;
  } else {
    prompt += `
🔧 ФОРМАТ ОТВЕТА — MULTIPAGE DIFF (не полный сайт целиком!):
1) 1-3 предложения о изменениях
2) Для КАЖДОГО изменяемого файла блок:

--- FILE: имя.html ---
\`\`\`diff
<<<<<<< SEARCH
точный фрагмент существующего кода
=======
новый код
>>>>>>> REPLACE
\`\`\`

Можно несколько SEARCH/REPLACE внутри одного файла и несколько --- FILE: --- блоков.
Полный \`\`\`html используй только если переписываешь >50% файла или создаёшь новую страницу.
`;
  }

  return prompt;
}

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

async function kieClaudeToolsRound(
  messages: any[],
  systemPrompt: string,
  tools: readonly any[],
): Promise<{ content: ClaudeContentBlock[]; stop_reason: string; toolsSupported: boolean }> {
  if (!KIE_API_KEY) throw new Error("KIE_API_KEY missing");

  const resp = await fetch(KIE_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_API_KEY}` },
    body: JSON.stringify({
      model: KIE_LLM_MODEL,
      stream: false,
      system: systemPrompt,
      messages,
      max_tokens: KIE_LLM_MAX_TOKENS,
      thinkingFlag: false,
      tools,
      tool_choice: { type: "auto" },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    // Tools not supported / bad request → signal fallback
    if (resp.status === 400 || resp.status === 422 || /tool/i.test(err)) {
      console.warn("[AGENT] Tools call rejected by KIE:", resp.status, err.slice(0, 300));
      return { content: [], stop_reason: "tools_unsupported", toolsSupported: false };
    }
    throw new Error(`KIE API error ${resp.status}: ${err}`);
  }

  const data = (await resp.json()) as any;
  const content: ClaudeContentBlock[] = [];
  for (const c of data.content || []) {
    if (c.type === "text" && c.text) content.push({ type: "text", text: c.text });
    if (c.type === "tool_use") {
      let input: Record<string, unknown> = {};
      if (c.input && typeof c.input === "object") input = c.input as Record<string, unknown>;
      else if (typeof c.input === "string") {
        try { input = JSON.parse(c.input); } catch { input = {}; }
      }
      content.push({ type: "tool_use", id: c.id, name: c.name, input });
    }
  }
  return {
    content,
    stop_reason: data.stop_reason || "end_turn",
    toolsSupported: true,
  };
}

class SiteWorkspace {
  files: Map<string, string>;
  craftMd: string;
  changedFiles = new Set<string>();
  private base64Maps = new Map<string, Map<string, string>>();

  constructor(pages: SitePage[], craftMd: string) {
    this.files = new Map();
    for (const p of pages) {
      if (!isHtmlPage(p.filename) && p.filename !== CRAFT_MD_FILENAME) continue;
      if (isHtmlPage(p.filename)) {
        const { stripped, map } = stripBase64Images(p.code || "");
        this.files.set(p.filename, stripped);
        this.base64Maps.set(p.filename, map);
      }
    }
    this.craftMd = craftMd;
  }

  getRestoredFiles(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [fn, code] of this.files) {
      out.set(fn, restoreBase64Images(code, this.base64Maps.get(fn) || new Map()));
    }
    return out;
  }

  execute(name: string, input: Record<string, unknown>): { result: unknown; finished?: string } {
    switch (name) {
      case "list_pages": {
        const list = [...this.files.entries()].map(([filename, code]) => ({
          filename,
          chars: code.length,
          title: extractPageTitle(code),
          sections: extractSections(code),
        }));
        return { result: { pages: list } };
      }
      case "read_page": {
        const filename = String(input.filename || "").trim().toLowerCase();
        const code = this.files.get(filename);
        if (code === undefined) return { result: { error: `Файл не найден: ${filename}`, available: [...this.files.keys()] } };
        return { result: { filename, code, chars: code.length } };
      }
      case "apply_patch": {
        const filename = String(input.filename || "").trim().toLowerCase();
        const search = String(input.search ?? "");
        const replace = String(input.replace ?? "");
        if (!this.files.has(filename)) {
          // Allow creating via patch only if file exists; use write_page for new
          return { result: { ok: false, error: `Файл не найден: ${filename}` } };
        }
        const current = this.files.get(filename)!;
        const { code, ok } = applySinglePatch(current, search, replace);
        if (!ok) return { result: { ok: false, error: "SEARCH не найден в файле. Перечитай read_page и уточни фрагмент." } };
        this.files.set(filename, code);
        this.changedFiles.add(filename);
        return { result: { ok: true, filename, newChars: code.length } };
      }
      case "write_page": {
        const filename = String(input.filename || "").trim().toLowerCase();
        let code = String(input.code ?? "");
        if (!filename.endsWith(".html")) return { result: { ok: false, error: "Можно писать только .html" } };
        if (!code.includes("<") || code.length < 50) return { result: { ok: false, error: "code слишком короткий или не HTML" } };
        // Preserve existing base64 map if rewriting known file
        if (!this.base64Maps.has(filename)) this.base64Maps.set(filename, new Map());
        const { stripped, map } = stripBase64Images(code);
        // Merge maps
        const existing = this.base64Maps.get(filename)!;
        for (const [k, v] of map) existing.set(k, v);
        this.files.set(filename, stripped);
        this.changedFiles.add(filename);
        return { result: { ok: true, filename, chars: stripped.length } };
      }
      case "read_craft_md":
        return { result: { craft_md: this.craftMd } };
      case "update_craft_md": {
        const design = typeof input.design_notes === "string" ? input.design_notes.trim() : "";
        const journal = typeof input.journal_entry === "string" ? input.journal_entry.trim() : "";
        if (design) {
          const block = `## Дизайн и договорённости\n${design}\n`;
          if (/## Дизайн и договорённости[\s\S]*?(?=\n## |\n# |$)/.test(this.craftMd)) {
            this.craftMd = this.craftMd.replace(/## Дизайн и договорённости[\s\S]*?(?=\n## |\n# |$)/, block);
          } else {
            this.craftMd = this.craftMd.trimEnd() + "\n\n" + block;
          }
        }
        if (journal) {
          const now = new Date().toISOString().slice(0, 19).replace("T", " ");
          const entry = `- ${now} — ${journal.slice(0, 240)}`;
          if (/## Журнал изменений/.test(this.craftMd)) {
            this.craftMd = this.craftMd.replace(/(## Журнал изменений\n)/, `$1${entry}\n`);
          } else {
            this.craftMd = this.craftMd.trimEnd() + `\n\n## Журнал изменений\n${entry}\n`;
          }
        }
        this.changedFiles.add(CRAFT_MD_FILENAME);
        return { result: { ok: true } };
      }
      case "finish": {
        const summary = String(input.summary || "Готово").trim();
        return { result: { ok: true }, finished: summary };
      }
      default:
        return { result: { error: `Неизвестный инструмент: ${name}` } };
    }
  }
}

export type ToolAgentResult = {
  ok: boolean;
  usedTools: boolean;
  toolsSupported: boolean;
  summary: string;
  changedFiles: Map<string, string>;
  craftMd: string;
  streamedText: string;
};

/**
 * Claude function-calling agent loop. Returns toolsSupported:false when KIE rejects tools
 * so the caller can fall back to streaming multipage text protocol.
 */
export async function runToolCallingAgent(opts: {
  systemPrompt: string;
  userPrompt: string;
  pages: SitePage[];
  craftMd: string;
  history?: { role: "user" | "assistant"; text: string }[];
  onStatus?: AgentStatusWriter;
  onContent?: AgentContentWriter;
  maxRounds?: number;
}): Promise<ToolAgentResult> {
  const workspace = new SiteWorkspace(opts.pages, opts.craftMd);
  const messages: any[] = [];

  for (const h of opts.history || []) {
    messages.push({ role: h.role, content: [{ type: "text", text: h.text }] });
  }
  messages.push({ role: "user", content: [{ type: "text", text: opts.userPrompt }] });

  let summary = "";
  let streamedText = "";
  const maxRounds = opts.maxRounds ?? 8;

  for (let round = 0; round < maxRounds; round++) {
    opts.onStatus?.(`Агент думает… (шаг ${round + 1}/${maxRounds})`);
    const roundResult = await kieClaudeToolsRound(messages, opts.systemPrompt, SITE_AGENT_TOOLS);

    if (!roundResult.toolsSupported) {
      return {
        ok: false,
        usedTools: false,
        toolsSupported: false,
        summary: "",
        changedFiles: new Map(),
        craftMd: workspace.craftMd,
        streamedText: "",
      };
    }

    messages.push({ role: "assistant", content: roundResult.content });

    const toolUses = roundResult.content.filter((c): c is Extract<ClaudeContentBlock, { type: "tool_use" }> => c.type === "tool_use");
    for (const block of roundResult.content) {
      if (block.type === "text" && block.text) {
        streamedText += block.text;
        opts.onContent?.(block.text);
      }
    }

    if (toolUses.length === 0) {
      summary = streamedText.trim().slice(0, 500) || (workspace.changedFiles.size ? "Сайт обновлён" : "");
      break;
    }

    const toolResults: any[] = [];
    let finishedSummary: string | undefined;

    for (const tu of toolUses) {
      const label =
        tu.name === "read_page" ? `Читаю ${tu.input.filename || "страницу"}…`
        : tu.name === "apply_patch" ? `Патчу ${tu.input.filename || "файл"}…`
        : tu.name === "write_page" ? `Записываю ${tu.input.filename || "файл"}…`
        : tu.name === "list_pages" ? "Смотрю все страницы…"
        : tu.name === "update_craft_md" ? "Обновляю craft.md…"
        : tu.name === "finish" ? "Завершаю…"
        : `Инструмент ${tu.name}…`;
      opts.onStatus?.(label);

      const { result, finished } = workspace.execute(tu.name, tu.input || {});
      if (finished) finishedSummary = finished;

      // Don't echo huge page bodies back into status — but tool_result needs full code for model
      let resultPayload = result;
      if (tu.name === "read_page" && result && typeof result === "object" && "code" in (result as any)) {
        // keep full code in tool result for the model
        resultPayload = result;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(resultPayload),
      });
    }

    messages.push({ role: "user", content: toolResults });

    if (finishedSummary !== undefined) {
      summary = finishedSummary;
      opts.onContent?.(finishedSummary.startsWith(streamedText) ? "" : (streamedText ? `\n\n${finishedSummary}` : finishedSummary));
      if (!streamedText.includes(finishedSummary)) streamedText = (streamedText ? streamedText + "\n\n" : "") + finishedSummary;
      break;
    }
  }

  const restored = workspace.getRestoredFiles();
  const changed = new Map<string, string>();
  for (const fn of workspace.changedFiles) {
    if (fn === CRAFT_MD_FILENAME) continue;
    const code = restored.get(fn);
    if (code !== undefined) changed.set(fn, code);
  }

  return {
    ok: changed.size > 0 || !!summary,
    usedTools: true,
    toolsSupported: true,
    summary: summary || streamedText.trim().slice(0, 400) || "Готово",
    changedFiles: changed,
    craftMd: workspace.craftMd,
    streamedText,
  };
}
