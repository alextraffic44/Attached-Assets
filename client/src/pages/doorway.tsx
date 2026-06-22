import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, CheckSquare, Square, Play, ChevronDown, ChevronUp, RotateCcw, ExternalLink } from "lucide-react";

const DEFAULT_AI_TOOLS = [
  "ChatGPT", "Claude", "Gemini", "Grok", "Perplexity", "Mistral", "LLaMA",
  "Midjourney", "DALL-E 3", "Stable Diffusion", "Flux", "Ideogram", "Leonardo AI",
  "Adobe Firefly", "Playground AI", "NightCafe", "Bing Image Creator",
  "Sora", "Veo", "Kling", "Runway ML", "Pika", "HeyGen", "Synthesia",
  "ElevenLabs", "Suno", "Udio", "Mubert", "AIVA",
  "GitHub Copilot", "Cursor AI", "Replit AI", "Tabnine", "Codeium",
  "Nano Banana", "Nano Banana 2",
  "Jasper AI", "Copy.ai", "Writesonic", "Rytr", "Notion AI",
  "Canva AI", "Adobe AI", "Figma AI",
  "Whisper", "DeepL", "Google Translate AI",
  "Luma AI", "Stability AI", "Cohere", "Anthropic Claude Opus",
  "GPT-4o", "GPT-4 Vision", "Gemini Ultra", "Gemini Flash",
  "Runway Gen-3", "Pika 2.0", "Kling 1.5",
  "Character AI", "Replika", "Pi AI", "Inflection AI",
  "You.com", "Phind", "Kagi AI", "Brave Leo",
  "Tome AI", "Gamma AI", "Beautiful AI", "Pitch AI",
  "Descript", "Adobe Podcast", "Podcastle",
  "Remove.bg", "Clipdrop", "Photoroom",
  "D-ID", "Colossyan", "InVideo AI",
  "AgentGPT", "AutoGPT", "LangChain", "CrewAI",
  "Hugging Face", "Replicate", "Together AI",
  "Coze", "Botpress", "ManyChat AI",
  "Speechify", "Murf AI", "Lovo AI",
  "Topaz AI", "Luminar AI", "ON1 AI",
  "AlphaCode", "StarCoder", "CodeLlama",
  "Wolfram Alpha AI", "Elicit", "Consensus AI",
  "Otter AI", "Fireflies AI", "Sembly AI",
  "Motion AI", "Reclaim AI", "Clockwise AI",
  "Jasper Art", "Canva Magic Studio",
];

const DEFAULT_TEMPLATE = `Создай профессиональный SEO-лендинг на русском языке про нейросеть {NAME}.

СТРУКТУРА СТРАНИЦЫ:

1. HERO-СЕКЦИЯ
- H1: "{NAME} — [точная суть за 5-7 слов]"
- Подзаголовок: 3 предложения о главном преимуществе
- Кнопка "Попробовать {NAME} бесплатно" (крупная, яркая, ведёт на {MARKETPLACE_URL})
- Кнопка "Узнать больше" (скролл вниз)

2. ЧТО ТАКОЕ {NAME} (300–400 слов)
- Подробное объяснение что это за нейросеть
- Кем создана, когда появилась, для чего предназначена
- Ключевые технологии в основе

3. ВОЗМОЖНОСТИ И ФУНКЦИИ (6–8 карточек)
- Каждая карточка: иконка SVG + заголовок H3 + 3 предложения описания
- Конкретные примеры того, что умеет {NAME}

4. КАК РАБОТАЕТ {NAME}
- Пошаговая инструкция (4–5 шагов), каждый шаг 2–3 предложения
- Кнопка "Начать работу с {NAME}" → {MARKETPLACE_URL}

5. ДЛЯ КОГО ПОДХОДИТ
- 5–6 ниш/профессий с подробным объяснением (копирайтер, дизайнер, маркетолог, разработчик и т.д.)
- Для каждой ниши: конкретный сценарий использования

6. ТАРИФЫ И ЦЕНЫ
- Бесплатный план (если есть) — выдели особо
- Платные планы с описанием возможностей
- CTA: "Попробовать бесплатно" → {MARKETPLACE_URL}

7. {NAME} VS АЛЬТЕРНАТИВЫ (таблица сравнения)
- 4–5 конкурентов, 5–6 критериев сравнения
- {NAME} должен выглядеть предпочтительно

8. FAQ (8–10 вопросов)
- Реальные вопросы: "Как работает {NAME}?", "Есть ли {NAME} на русском?", "Безопасно ли использовать {NAME}?", "Как начать использовать {NAME} бесплатно?" и т.д.
- Каждый ответ 3–5 предложений с реальной информацией

9. ФИНАЛЬНЫЙ CTA
- Заголовок H2: "Начните использовать {NAME} прямо сейчас"
- Убедительный текст 4–5 предложений о ценности
- Большая кнопка "Попробовать {NAME}" → {MARKETPLACE_URL}

SEO-ТРЕБОВАНИЯ:
- title: "{NAME} — что это, как работает, попробовать бесплатно"
- description: 155 символов с главными ключевыми словами
- keywords: {NAME}, нейросеть {NAME}, {NAME} онлайн, {NAME} бесплатно, {NAME} что это, как использовать {NAME}
- JSON-LD разметка SoftwareApplication
- Alt-тексты у всех изображений содержат "{NAME}"
- H2 заголовки разделов содержат ключевые слова

ДИЗАЙН: Современный тёмный/градиентный, tech-стиль, анимации появления при скролле, glassmorphism-карточки.`;

type ToolStatus = "pending" | "creating" | "done" | "error";

interface ToolEntry {
  name: string;
  status: ToolStatus;
  projectId?: number;
  error?: string;
}

export default function DoorwayPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [tools, setTools] = useState<ToolEntry[]>(
    DEFAULT_AI_TOOLS.map(name => ({ name, status: "pending" }))
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [marketplaceUrl, setMarketplaceUrl] = useState("https://nanno.site");
  const [isRunning, setIsRunning] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [newTool, setNewTool] = useState("");
  const [delayMs, setDelayMs] = useState(1500);
  const abortRef = useRef(false);

  const doneCount = tools.filter(t => t.status === "done").length;
  const errorCount = tools.filter(t => t.status === "error").length;
  const selectedList = [...selected];
  const pendingSelected = selectedList.filter(i => tools[i]?.status === "pending");

  function toggleSelect(i: number) {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(i) ? s.delete(i) : s.add(i);
      return s;
    });
  }

  function selectAll() {
    setSelected(new Set(tools.map((_, i) => i)));
  }

  function selectPending() {
    setSelected(new Set(tools.map((t, i) => t.status === "pending" ? i : -1).filter(i => i >= 0)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function addTool() {
    const name = newTool.trim();
    if (!name) return;
    setTools(prev => [...prev, { name, status: "pending" }]);
    setNewTool("");
  }

  function removeTool(i: number) {
    setTools(prev => prev.filter((_, idx) => idx !== i));
    setSelected(prev => {
      const s = new Set<number>();
      prev.forEach(idx => { if (idx < i) s.add(idx); else if (idx > i) s.add(idx - 1); });
      return s;
    });
  }

  function resetErrors() {
    setTools(prev => prev.map(t => t.status === "error" ? { ...t, status: "pending" as ToolStatus, error: undefined } : t));
  }

  async function runGeneration() {
    if (!user) { setLocation("/auth"); return; }
    const indices = pendingSelected.length > 0 ? pendingSelected : tools.map((t, i) => t.status === "pending" ? i : -1).filter(i => i >= 0);
    if (indices.length === 0) {
      toast({ title: "Нет задач", description: "Выберите нейросети со статусом «Ожидание»", variant: "destructive" });
      return;
    }

    abortRef.current = false;
    setIsRunning(true);

    for (const idx of indices) {
      if (abortRef.current) break;
      const tool = tools[idx];
      if (!tool || tool.status !== "pending") continue;

      setTools(prev => prev.map((t, i) => i === idx ? { ...t, status: "creating" } : t));

      try {
        const prompt = template
          .replace(/\{NAME\}/g, tool.name)
          .replace(/\{MARKETPLACE_URL\}/g, marketplaceUrl || "https://craft-ai.ru");

        const res = await apiRequest("POST", "/api/projects", {
          title: `${tool.name} — нейросеть`,
          description: prompt,
        });
        const project = await res.json();
        if (!res.ok) throw new Error(project.message || "Ошибка создания");

        setTools(prev => prev.map((t, i) => i === idx ? { ...t, status: "done", projectId: project.id } : t));
      } catch (err: any) {
        setTools(prev => prev.map((t, i) => i === idx ? { ...t, status: "error", error: err.message || "Ошибка" } : t));
      }

      if (!abortRef.current && idx !== indices[indices.length - 1]) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    setIsRunning(false);
    abortRef.current = false;
  }

  function stopGeneration() {
    abortRef.current = true;
  }

  const statusColor: Record<ToolStatus, string> = {
    pending: "#86868B",
    creating: "#0071e3",
    done: "#1D8348",
    error: "#dc2626",
  };

  const statusLabel: Record<ToolStatus, string> = {
    pending: "Ожидание",
    creating: "Создаётся...",
    done: "Готово ✓",
    error: "Ошибка",
  };

  const progress = tools.length > 0 ? Math.round(((doneCount + errorCount) / tools.length) * 100) : 0;
  const runningIdx = tools.findIndex(t => t.status === "creating");

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f7", fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif" }}>
      {/* Header */}
      <div style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(0,0,0,0.06)", padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setLocation("/dashboard")} style={{ background: "none", border: "none", cursor: "pointer", color: "#86868B", fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
            ← Назад
          </button>
          <div style={{ width: 1, height: 16, background: "rgba(0,0,0,0.1)" }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: "#1D1D1F" }}>🤖 AI Дорвей Генератор</span>
        </div>
        <div style={{ fontSize: 12, color: "#86868B" }}>
          Создано: <b style={{ color: "#1D8348" }}>{doneCount}</b> / {tools.length}
          {errorCount > 0 && <> · Ошибок: <b style={{ color: "#dc2626" }}>{errorCount}</b></>}
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 80px" }}>
        {/* Top controls */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, marginBottom: 20 }}>

          {/* Settings card */}
          <div style={{ background: "#fff", borderRadius: 16, padding: 20, border: "1px solid rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1D1D1F", marginBottom: 12 }}>Настройки генерации</div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#86868B", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>
                URL маркетплейса AI (подставляется в {"{MARKETPLACE_URL}"})
              </label>
              <input
                value={marketplaceUrl}
                onChange={e => setMarketplaceUrl(e.target.value)}
                placeholder="https://nanno.site"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#86868B", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>
                Пауза между созданием (мс)
              </label>
              <input
                type="number"
                value={delayMs}
                onChange={e => setDelayMs(Math.max(0, Number(e.target.value)))}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>

            <button
              onClick={() => setShowTemplate(v => !v)}
              style={{ background: "none", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "#555", display: "flex", alignItems: "center", gap: 4, width: "100%" }}
            >
              {showTemplate ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showTemplate ? "Скрыть" : "Редактировать"} шаблон промпта
            </button>

            {showTemplate && (
              <textarea
                value={template}
                onChange={e => setTemplate(e.target.value)}
                rows={20}
                style={{ width: "100%", marginTop: 8, padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", fontSize: 12, lineHeight: 1.5, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "monospace" }}
              />
            )}
          </div>

          {/* Action card */}
          <div style={{ background: "#fff", borderRadius: 16, padding: 20, border: "1px solid rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1D1D1F" }}>Управление</div>

            {/* Progress bar */}
            {(doneCount > 0 || errorCount > 0 || isRunning) && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#86868B", marginBottom: 4 }}>
                  <span>Прогресс</span><span>{progress}%</span>
                </div>
                <div style={{ height: 6, background: "#f0f0f0", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg,#0071e3,#34c759)", borderRadius: 4, transition: "width 0.3s" }} />
                </div>
                <div style={{ fontSize: 11, color: "#86868B", marginTop: 4 }}>
                  Готово: {doneCount} · Ошибки: {errorCount} · Осталось: {tools.filter(t => t.status === "pending").length}
                </div>
              </div>
            )}

            {/* Selection controls */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button onClick={selectAll} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(0,0,0,0.1)", background: "none", fontSize: 11, cursor: "pointer", color: "#555" }}>
                Выбрать все
              </button>
              <button onClick={selectPending} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(0,0,0,0.1)", background: "none", fontSize: 11, cursor: "pointer", color: "#555" }}>
                Только ожидание
              </button>
              <button onClick={clearSelection} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(0,0,0,0.1)", background: "none", fontSize: 11, cursor: "pointer", color: "#555" }}>
                Снять всё
              </button>
            </div>

            {selected.size > 0 && (
              <div style={{ fontSize: 12, color: "#0071e3" }}>Выбрано: {selected.size} нейросетей</div>
            )}

            {errorCount > 0 && (
              <button onClick={resetErrors}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.05)", fontSize: 12, cursor: "pointer", color: "#dc2626" }}>
                <RotateCcw size={12} />
                Сбросить ошибки ({errorCount})
              </button>
            )}

            <div style={{ flex: 1 }} />

            {isRunning ? (
              <button onClick={stopGeneration}
                style={{ padding: "12px 16px", borderRadius: 12, background: "#dc2626", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Loader2 size={16} className="animate-spin" />
                Остановить
              </button>
            ) : (
              <button onClick={runGeneration}
                style={{ padding: "12px 16px", borderRadius: 12, background: "linear-gradient(135deg,#1D1D1F,#3a3a3c)", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.15)" }}>
                <Play size={16} />
                {selected.size > 0 ? `Создать выбранные (${pendingSelected.length})` : `Создать все ожидающие (${tools.filter(t => t.status === "pending").length})`}
              </button>
            )}

            <div style={{ fontSize: 10, color: "#aaa", textAlign: "center", lineHeight: 1.4 }}>
              Создаются проекты без токенов.<br />Генерация HTML запускается вручную в редакторе.
            </div>
          </div>
        </div>

        {/* Add tool */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            value={newTool}
            onChange={e => setNewTool(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addTool()}
            placeholder="Название нейросети..."
            style={{ flex: 1, padding: "8px 14px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.1)", background: "#fff", fontSize: 13, outline: "none" }}
          />
          <button onClick={addTool}
            style={{ padding: "8px 16px", borderRadius: 10, background: "#0071e3", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={14} />
            Добавить
          </button>
        </div>

        {/* Tools grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8 }}>
          {tools.map((tool, i) => {
            const isSel = selected.has(i);
            const isCreating = tool.status === "creating";
            return (
              <div
                key={i}
                onClick={() => !isRunning && toggleSelect(i)}
                style={{
                  background: tool.status === "done" ? "rgba(52,199,89,0.04)" : tool.status === "error" ? "rgba(220,38,38,0.04)" : isCreating ? "rgba(0,113,227,0.04)" : "#fff",
                  borderRadius: 10,
                  padding: "10px 12px",
                  border: isSel ? "1.5px solid #0071e3" : "1px solid rgba(0,0,0,0.07)",
                  cursor: isRunning ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  transition: "all 0.15s",
                  opacity: tool.status === "done" ? 0.7 : 1,
                }}
              >
                <div style={{ flexShrink: 0 }}>
                  {isCreating ? (
                    <Loader2 size={14} style={{ color: "#0071e3", animation: "spin 1s linear infinite" }} />
                  ) : isSel ? (
                    <CheckSquare size={14} style={{ color: "#0071e3" }} />
                  ) : (
                    <Square size={14} style={{ color: "#d0d0d0" }} />
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#1D1D1F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {tool.name}
                  </div>
                  <div style={{ fontSize: 10, color: statusColor[tool.status], marginTop: 1 }}>
                    {tool.status === "error" ? (tool.error || "Ошибка") : statusLabel[tool.status]}
                  </div>
                </div>

                {tool.status === "done" && tool.projectId && (
                  <a
                    href={`/editor/${tool.projectId}`}
                    onClick={e => { e.stopPropagation(); }}
                    style={{ flexShrink: 0, color: "#0071e3", display: "flex" }}
                    title="Открыть редактор"
                  >
                    <ExternalLink size={12} />
                  </a>
                )}

                {!isRunning && tool.status !== "creating" && (
                  <button
                    onClick={e => { e.stopPropagation(); removeTool(i); }}
                    style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "#ccc", padding: 0, display: "flex" }}
                    title="Удалить"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {tools.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#aaa" }}>
            Список пуст — добавьте нейросети выше
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
