import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { SeoConfig, SeoKeyword } from "@shared/schema";
import {
  ChevronRight, ChevronDown, Globe, Zap, RefreshCw,
  CheckCircle2, XCircle, Clock, Loader2, ArrowLeft,
  BarChart2, FileText, Layers, PlusCircle, Settings2, X,
} from "lucide-react";

type Phase = "setup" | "structure" | "generating" | "done";

/* ─── tiny helpers ─── */
function StatusIcon({ status }: { status: SeoKeyword["status"] | "pending" }) {
  if (status === "done")      return <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />;
  if (status === "failed")    return <XCircle      className="w-3 h-3 text-red-400   shrink-0" />;
  if (status === "generating") return <Loader2     className="w-3 h-3 text-indigo-400 shrink-0 animate-spin" />;
  return                              <Clock       className="w-3 h-3 text-zinc-600   shrink-0" />;
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-2xl font-black tabular-nums" style={{ color }}>{value}</span>
      <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">{label}</span>
    </div>
  );
}

/* ─── main component ─── */
export default function SeoEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [phase, setPhase]           = useState<Phase>("setup");
  const [keywordsText, setKeywordsText] = useState("");
  const [niche, setNiche]           = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [openClusters, setOpenClusters] = useState<Set<string>>(new Set());
  const [genLog, setGenLog]         = useState<string[]>([]);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzing, setIsAnalyzing]   = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [analyzeElapsed, setAnalyzeElapsed] = useState(0);
  const analyzeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [addKwOpen, setAddKwOpen]     = useState(false);
  const [addKwText, setAddKwText]     = useState("");
  const [isAddingKw, setIsAddingKw]   = useState(false);
  const [adOpen, setAdOpen]           = useState(false);
  const [adHeadCode, setAdHeadCode]   = useState("");
  const [adUnitCode, setAdUnitCode]   = useState("");

  /* ── single query, no polling — SSE provides live updates ── */
  const { data, isLoading, refetch } = useQuery<{
    project: any;
    files: { id: number; filename: string }[];
  }>({
    queryKey: ["/api/seo", id],
    queryFn: () => fetch(`/api/seo/${id}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const project = data?.project;
  const files   = data?.files || [];
  const cfg: SeoConfig | null = project?.seoConfig || null;

  useEffect(() => {
    if (!cfg) return;
    if (cfg.status === "done" || cfg.pagesGenerated > 0) setPhase("done");
    else if (cfg.clusters?.length > 0) setPhase("structure");
    else setPhase("setup");
    if (cfg.niche) setNiche(cfg.niche);
    if (cfg.rawKeywords?.length) setKeywordsText(cfg.rawKeywords.join("\n"));
    if (cfg.clusters?.length > 0) setOpenClusters(new Set(cfg.clusters.slice(0, 2).map((c: any) => c.id)));
    setGenProgress({ done: cfg.pagesGenerated || 0, total: cfg.pagesTotal || 0 });
  }, [cfg?.status, cfg?.pagesGenerated, cfg?.clusters?.length]);

  // Auto-load homepage preview when project is done
  useEffect(() => {
    if (phase === "done" && !previewHtml && files.length > 0) {
      const home = files.find(f => f.filename === "index.html") || files[0];
      if (home) loadPreview(home.filename);
    }
  }, [phase, files.length]);

  /* ── analyze ── */
  async function handleAnalyze() {
    const keywords = keywordsText.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);
    if (!keywords.length) { toast({ title: "Введите ключевые слова", variant: "destructive" }); return; }
    if (keywords.length > 1000) { toast({ title: "Максимум 1000 ключей", variant: "destructive" }); return; }
    setIsAnalyzing(true);
    setAnalyzeElapsed(0);
    analyzeTimerRef.current = setInterval(() => setAnalyzeElapsed(s => s + 1), 1000);
    try {
      const res = await fetch(`/api/seo/${id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ keywords, niche }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      await refetch();
      setPhase("structure");
      toast({ title: "Структура построена ✓" });
    } catch (e: any) {
      toast({ title: "Ошибка анализа", description: e.message, variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
      if (analyzeTimerRef.current) clearInterval(analyzeTimerRef.current);
    }
  }

  /* ── generate (SSE) ── */
  function startGeneration() {
    if (isGenerating) return;
    setIsGenerating(true);
    setPhase("generating");
    setGenLog([]);
    setGenProgress({ done: 0, total: cfg?.pagesTotal || 0 });

    fetch(`/api/seo/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    }).then(async res => {
      if (!res.ok || !res.body) throw new Error("Generation failed");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "start")     setGenProgress(p => ({ ...p, total: evt.total }));
            if (evt.type === "progress")  setGenLog(l => [...l.slice(-99), `⏳ ${evt.keyword}`]);
            if (evt.type === "page_done") {
              setGenLog(l => [...l.slice(-99), `${evt.status === "done" ? "✅" : "❌"} ${evt.keyword}`]);
              setGenProgress({ done: evt.generated, total: evt.total });
            }
            if (evt.type === "done") {
              setPhase("done");
              refetch();
              if (evt.partial) toast({ title: "Токены закончились", description: "Пополните баланс и нажмите «Продолжить»", variant: "destructive" });
            }
            if (evt.type === "error") toast({ title: evt.message, variant: "destructive" });
          } catch {}
        }
      }
    }).catch(e => {
      if (e.name !== "AbortError") toast({ title: "Ошибка генерации", description: e.message, variant: "destructive" });
    }).finally(() => {
      setIsGenerating(false);
      refetch();
    });
  }

  /* ── publish ── */
  async function handlePublish() {
    setIsPublishing(true);
    try {
      const res = await fetch(`/api/seo/${id}/publish`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message);
      toast({ title: "Сайт опубликован!", description: d.url });
      refetch();
    } catch (e: any) {
      toast({ title: "Ошибка публикации", description: e.message, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  }

  /* ── add keywords ── */
  async function handleAddKeywords() {
    const keywords = addKwText.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);
    if (!keywords.length) { toast({ title: "Введите ключевые слова", variant: "destructive" }); return; }
    setIsAddingKw(true);
    try {
      const res = await fetch(`/api/seo/${id}/add-keywords`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      const d = await res.json();
      setAddKwOpen(false);
      setAddKwText("");
      await refetch();
      setPhase("structure");
      toast({ title: `Добавлено ${d.added} ключей ✓`, description: "Нажмите «Генерировать» для создания новых статей" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setIsAddingKw(false);
    }
  }

  /* ── save ad settings ── */
  async function handleSaveAds() {
    try {
      const updatedCfg = { ...cfg, adHeadCode, adUnitCode };
      const res = await fetch(`/api/seo/${id}/update-config`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seoConfig: updatedCfg }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      setAdOpen(false);
      await refetch();
      toast({ title: "Настройки рекламы сохранены ✓", description: "Перегенерируйте статьи или переопубликуйте сайт для применения" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  }

  /* ── preview ── */
  async function loadPreview(filename: string) {
    setSelectedFile(filename);
    try {
      const [pageRes, cssRes] = await Promise.all([
        fetch(`/api/seo/${id}/file?filename=${encodeURIComponent(filename)}`, { credentials: "include" }),
        fetch(`/api/seo/${id}/file?filename=assets%2Fstyle.css`, { credentials: "include" }),
      ]);
      if (!pageRes.ok) return;
      let html = await pageRes.text();
      if (cssRes.ok) {
        const css = await cssRes.text();
        html = html.replace(
          /<link[^>]+href=["'][^"']*assets\/style\.css["'][^>]*>/gi,
          `<style>${css}</style>`
        );
      }
      setPreviewHtml(html);
    } catch {}
  }

  function toggleCluster(cid: string) {
    setOpenClusters(prev => { const n = new Set(prev); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });
  }

  const pct = genProgress.total > 0 ? Math.round((genProgress.done / genProgress.total) * 100) : 0;
  const keywordCount = keywordsText.split(/[\n,]+/).filter(k => k.trim()).length;
  const publishUrl = cfg?.publishUrl || project?.publishedUrl;

  /* ── loading screen ── */
  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0f0f13" }}>
      <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
    </div>
  );

  /* ════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen flex flex-col text-white" style={{ background: "#0f0f13", fontFamily: "'Inter', -apple-system, sans-serif" }}>

      {/* ── HEADER ── */}
      <header style={{ background: "#111118", borderBottom: "1px solid rgba(255,255,255,0.06)", height: 52, display: "flex", alignItems: "center", padding: "0 16px", gap: 12, flexShrink: 0 }}>
        <button
          onClick={() => setLocation("/dashboard")}
          style={{ background: "none", border: "none", color: "#666", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 13, padding: "4px 8px", borderRadius: 6, transition: "color 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#aaa")}
          onMouseLeave={e => (e.currentTarget.style.color = "#666")}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Назад
        </button>

        <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.08)" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.01em" }}>SEO-машина</span>
          {project?.seoConfig?.niche && (
            <span style={{ fontSize: 12, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
              / {project.seoConfig.niche}
            </span>
          )}
        </div>

        {/* add keywords + ad settings — only after structure built */}
        {phase !== "setup" && (
          <>
            <button
              onClick={() => setAddKwOpen(true)}
              title="Добавить новый пак ключей"
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#818cf8", padding: "5px 10px", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
            >
              <PlusCircle className="w-3.5 h-3.5" /> Ключи
            </button>
            <button
              onClick={() => { setAdHeadCode(cfg?.adHeadCode || ""); setAdUnitCode(cfg?.adUnitCode || ""); setAdOpen(true); }}
              title="Настройки рекламных блоков"
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#9ca3af", padding: "5px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
            >
              <Settings2 className="w-3.5 h-3.5" /> Реклама
            </button>
          </>
        )}

        {/* publish button — only after structure built */}
        {phase !== "setup" && (
          publishUrl ? (
            <a
              href={publishUrl} target="_blank" rel="noopener"
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#34d399", textDecoration: "none", padding: "5px 12px", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 8, fontWeight: 600 }}
            >
              <Globe className="w-3.5 h-3.5" />
              {publishUrl.replace("https://", "").split("/")[0]}
            </a>
          ) : (
            <button
              onClick={handlePublish}
              disabled={isPublishing || files.length < 2}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
                background: isPublishing || files.length < 2 ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #2563eb, #4f46e5)",
                border: "none", borderRadius: 8, color: isPublishing || files.length < 2 ? "#555" : "#fff",
                fontSize: 13, fontWeight: 600, cursor: isPublishing || files.length < 2 ? "not-allowed" : "pointer",
                boxShadow: files.length >= 2 && !isPublishing ? "0 2px 12px rgba(79,70,229,0.35)" : "none",
                transition: "all 0.2s",
              }}
            >
              {isPublishing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Публикация...</> : <><Globe className="w-3.5 h-3.5" /> Опубликовать</>}
            </button>
          )
        )}
      </header>

      {/* ── BODY ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", height: "calc(100vh - 52px)" }}>

        {/* ════ LEFT PANEL ════ */}
        <aside style={{ width: 300, minWidth: 260, maxWidth: 340, background: "#111118", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* SETUP PHASE */}
          {phase === "setup" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px 24px" }}>
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 6, letterSpacing: "-0.01em" }}>
                  🚀 SEO-машина
                </h2>
                <p style={{ fontSize: 12, color: "#555", lineHeight: 1.65 }}>
                  Вставьте ключевые слова — через запятую или каждое на новой строке. ИИ кластеризует их и построит структуру сайта.
                </p>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
                  Ниша / тема сайта
                </label>
                <input
                  value={niche}
                  onChange={e => setNiche(e.target.value)}
                  placeholder="напр. нейросети для бизнеса"
                  style={{ width: "100%", padding: "8px 11px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#e2e8f0", fontSize: 13, outline: "none", transition: "border-color 0.15s", boxSizing: "border-box" }}
                  onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
                  onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
                />
              </div>

              <div style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Ключевые слова
                  </label>
                  <span style={{ fontSize: 11, color: keywordCount > 0 ? "#818cf8" : "#555", fontWeight: 600 }}>
                    {keywordCount} / 1000
                  </span>
                </div>
                <textarea
                  value={keywordsText}
                  onChange={e => setKeywordsText(e.target.value)}
                  placeholder={"midjourney бесплатно, chatgpt для бизнеса, ..."}
                  rows={16}
                  style={{ width: "100%", padding: "10px 11px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#e2e8f0", fontSize: 12.5, resize: "none", outline: "none", lineHeight: 1.65, transition: "border-color 0.15s", boxSizing: "border-box" }}
                  onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
                  onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
                />
              </div>

              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || !keywordsText.trim()}
                style={{
                  marginTop: 12, width: "100%", padding: "11px",
                  background: isAnalyzing || !keywordsText.trim()
                    ? "rgba(255,255,255,0.04)"
                    : "linear-gradient(135deg, #4f46e5, #7c3aed)",
                  border: isAnalyzing || !keywordsText.trim() ? "1px solid rgba(255,255,255,0.06)" : "none",
                  borderRadius: 10, color: isAnalyzing || !keywordsText.trim() ? "#555" : "#fff",
                  fontWeight: 700, fontSize: 13.5, cursor: isAnalyzing || !keywordsText.trim() ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  boxShadow: !isAnalyzing && keywordsText.trim() ? "0 4px 16px rgba(99,102,241,0.4)" : "none",
                  transition: "all 0.2s",
                }}
              >
                {isAnalyzing
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Анализирую... {analyzeElapsed > 0 ? `${analyzeElapsed}с` : ""}</>
                  : <><Zap className="w-4 h-4" /> Построить структуру</>}
              </button>

              {isAnalyzing && (
                <p style={{ marginTop: 10, fontSize: 11, color: "#555", textAlign: "center", lineHeight: 1.6 }}>
                  ИИ кластеризует ключевые слова — это занимает до 2–3 минут
                </p>
              )}
            </div>
          )}

          {/* STRUCTURE / GENERATING / DONE */}
          {(phase === "structure" || phase === "generating" || phase === "done") && cfg && (
            <>
              {/* Stats */}
              <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-around" }}>
                  <Stat value={cfg.pagesGenerated} label="готово"    color="#34d399" />
                  <div style={{ width: 1, background: "rgba(255,255,255,0.06)" }} />
                  <Stat value={cfg.pagesTotal}     label="страниц"   color="#e2e8f0" />
                  <div style={{ width: 1, background: "rgba(255,255,255,0.06)" }} />
                  <Stat value={cfg.clusters.length} label="разделов" color="#818cf8" />
                </div>
              </div>

              {/* Progress bar */}
              {(phase === "generating" || cfg.pagesGenerated > 0) && (
                <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 11, color: "#555" }}>
                    <span>Прогресс</span>
                    <span style={{ color: pct === 100 ? "#34d399" : "#818cf8", fontWeight: 700 }}>
                      {genProgress.done} / {genProgress.total} ({pct}%)
                    </span>
                  </div>
                  <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#34d399" : "linear-gradient(90deg, #4f46e5, #818cf8)", borderRadius: 99, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 8 }}>
                {phase === "generating" ? (
                  <div style={{ flex: 1, padding: "8px 12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, color: "#555", fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    <span>Генерирую статьи...</span>
                  </div>
                ) : (
                  <button
                    onClick={startGeneration}
                    disabled={isGenerating}
                    style={{
                      flex: 1, padding: "8px 12px",
                      background: cfg.pagesGenerated > 0
                        ? "rgba(99,102,241,0.08)"
                        : "linear-gradient(135deg, #4f46e5, #7c3aed)",
                      border: cfg.pagesGenerated > 0 ? "1px solid rgba(99,102,241,0.3)" : "none",
                      borderRadius: 8, color: "#fff", fontWeight: 600, fontSize: 13,
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      boxShadow: cfg.pagesGenerated === 0 ? "0 2px 12px rgba(99,102,241,0.3)" : "none",
                      transition: "all 0.2s",
                    }}
                  >
                    {cfg.pagesGenerated > 0
                      ? <><RefreshCw className="w-3.5 h-3.5" /> Продолжить</>
                      : <><Zap className="w-3.5 h-3.5" /> Генерировать</>}
                  </button>
                )}
                <button
                  title="Изменить ключевые слова"
                  onClick={() => { setPhase("setup"); setKeywordsText(cfg.rawKeywords.join("\n")); setNiche(cfg.niche); }}
                  style={{ padding: "8px 10px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, color: "#555", cursor: "pointer", display: "flex", alignItems: "center", transition: "color 0.15s" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#aaa")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#555")}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Site tree */}
              <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
                {/* Home */}
                <TreeRow
                  icon={<Globe className="w-3 h-3 text-indigo-400 shrink-0" />}
                  label="Главная"
                  bold
                  active={selectedFile === "index.html"}
                  done={!!files.find(f => f.filename === "index.html")}
                  indent={0}
                  onClick={() => loadPreview("index.html")}
                />

                {cfg.clusters.map(cluster => {
                  const open = openClusters.has(cluster.id);
                  const doneCount = cluster.keywords.filter((k: any) => k.status === "done").length;
                  return (
                    <div key={cluster.id}>
                      <TreeRow
                        icon={open
                          ? <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
                          : <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />}
                        label={cluster.name}
                        badge={`${doneCount}/${cluster.keywords.length}`}
                        bold
                        active={selectedFile === `${cluster.slug}/index.html`}
                        indent={0}
                        onClick={() => { toggleCluster(cluster.id); loadPreview(`${cluster.slug}/index.html`); }}
                      />
                      {open && cluster.keywords.map((kw: any) => (
                        <TreeRow
                          key={kw.id}
                          icon={<StatusIcon status={kw.status} />}
                          label={kw.title || kw.keyword}
                          active={selectedFile === kw.filename}
                          indent={1}
                          faded={kw.status !== "done"}
                          onClick={() => kw.filename && loadPreview(kw.filename)}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* Gen log */}
              {phase === "generating" && genLog.length > 0 && (
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "8px 12px", maxHeight: 110, overflowY: "auto", background: "#0a0a0f" }}>
                  {genLog.slice(-7).map((line, i) => (
                    <div key={i} style={{ fontSize: 10.5, color: "#555", lineHeight: 1.65, fontFamily: "monospace" }}>{line}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </aside>

        {/* ════ RIGHT PANEL — Preview ════ */}
        <main style={{ flex: 1, background: "#0a0a0f", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {previewHtml ? (
            <iframe
              srcDoc={previewHtml}
              style={{ flex: 1, border: "none", background: "#fff" }}
              title="preview"
              sandbox="allow-scripts allow-same-origin"
            />
          ) : isAnalyzing ? (
            <AnalyzingScreen elapsed={analyzeElapsed} keywordCount={keywordCount} />
          ) : (
            <EmptyScreen phase={phase} />
          )}
        </main>
      </div>

      {/* ═══ MODAL: Add Keywords ═══ */}
      {addKwOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#111118", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, width: "100%", maxWidth: 480, padding: 24, boxShadow: "0 24px 64px rgba(0,0,0,.7)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.01em" }}>➕ Добавить ключи</div>
                <div style={{ fontSize: 12, color: "#555", marginTop: 3 }}>ИИ встроит новые ключи в существующую структуру сайта</div>
              </div>
              <button onClick={() => setAddKwOpen(false)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", padding: 4 }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <textarea
              value={addKwText}
              onChange={e => setAddKwText(e.target.value)}
              placeholder={"новый запрос 1, новый запрос 2\n..."}
              rows={12}
              style={{ width: "100%", padding: "10px 11px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#e2e8f0", fontSize: 12.5, resize: "none", outline: "none", lineHeight: 1.65, boxSizing: "border-box", fontFamily: "inherit" }}
              onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
              onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
            />
            <div style={{ fontSize: 11, color: "#444", marginTop: 6 }}>
              {addKwText.split(/[\n,]+/).filter(k => k.trim()).length} ключей
            </div>
            <button
              onClick={handleAddKeywords}
              disabled={isAddingKw || !addKwText.trim()}
              style={{ marginTop: 14, width: "100%", padding: "11px", background: isAddingKw || !addKwText.trim() ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg,#4f46e5,#7c3aed)", border: "none", borderRadius: 10, color: isAddingKw || !addKwText.trim() ? "#555" : "#fff", fontWeight: 700, fontSize: 13.5, cursor: isAddingKw || !addKwText.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              {isAddingKw ? <><Loader2 className="w-4 h-4 animate-spin" /> Анализирую...</> : <><Zap className="w-4 h-4" /> Добавить в структуру</>}
            </button>
          </div>
        </div>
      )}

      {/* ═══ MODAL: Ad Settings ═══ */}
      {adOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#111118", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, width: "100%", maxWidth: 560, padding: 24, boxShadow: "0 24px 64px rgba(0,0,0,.7)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.01em" }}>📢 Рекламные блоки</div>
                <div style={{ fontSize: 12, color: "#555", marginTop: 3 }}>AdSense, Яндекс РСЯ, партнёрские баннеры</div>
              </div>
              <button onClick={() => setAdOpen(false)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", padding: 4 }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
                Код в &lt;head&gt; (скрипт AdSense / Яндекс init)
              </label>
              <textarea
                value={adHeadCode}
                onChange={e => setAdHeadCode(e.target.value)}
                placeholder={'<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXX" crossorigin="anonymous"></script>'}
                rows={4}
                style={{ width: "100%", padding: "9px 11px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#e2e8f0", fontSize: 11.5, resize: "none", outline: "none", lineHeight: 1.6, boxSizing: "border-box", fontFamily: "monospace" }}
                onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
              />
              <div style={{ fontSize: 10.5, color: "#444", marginTop: 4 }}>Вставляется в &lt;head&gt; каждой страницы сайта</div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
                Рекламный блок (ins / div / iframe)
              </label>
              <textarea
                value={adUnitCode}
                onChange={e => setAdUnitCode(e.target.value)}
                placeholder={'<ins class="adsbygoogle"\n  style="display:block"\n  data-ad-client="ca-pub-XXXXX"\n  data-ad-slot="XXXXXXXX"\n  data-ad-format="auto"></ins>\n<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>'}
                rows={6}
                style={{ width: "100%", padding: "9px 11px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#e2e8f0", fontSize: 11.5, resize: "none", outline: "none", lineHeight: 1.6, boxSizing: "border-box", fontFamily: "monospace" }}
                onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
              />
              <div style={{ fontSize: 10.5, color: "#444", marginTop: 4 }}>Размещается в 4 местах: под hero, в боковой панели (×2), в категориях. Подходит для AdSense, Яндекс РСЯ, любого iframe/баннера.</div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setAdOpen(false)} style={{ flex: 1, padding: "10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#666", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                Отмена
              </button>
              <button onClick={handleSaveAds} style={{ flex: 2, padding: "10px", background: "linear-gradient(135deg,#4f46e5,#7c3aed)", border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Settings2 className="w-4 h-4" /> Сохранить настройки
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Tree row ─── */
function TreeRow({ icon, label, bold = false, active, done, badge, faded, indent, onClick }: {
  icon: any; label: string; bold?: boolean; active?: boolean; done?: boolean;
  badge?: string; faded?: boolean; indent?: number; onClick?: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: "100%", border: "none", textAlign: "left", cursor: onClick ? "pointer" : "default",
        display: "flex", alignItems: "center", gap: 7,
        padding: `5px 14px 5px ${14 + (indent || 0) * 16}px`,
        background: active ? "rgba(99,102,241,0.1)" : hov ? "rgba(255,255,255,0.02)" : "transparent",
        borderLeft: active ? "2px solid rgba(99,102,241,0.6)" : "2px solid transparent",
        transition: "background 0.1s",
      }}
    >
      {icon}
      <span style={{
        fontSize: indent ? 12 : 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        fontWeight: bold ? 600 : 400,
        color: active ? "#e2e8f0" : faded ? "#555" : "#a0a0b0",
        letterSpacing: bold ? "-0.01em" : undefined,
      }}>{label}</span>
      {done && !badge && <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 opacity-70" />}
      {badge && <span style={{ fontSize: 10, color: "#555", fontWeight: 600, flexShrink: 0 }}>{badge}</span>}
    </button>
  );
}

/* ─── Analyzing screen (shown in right panel while AI clusters) ─── */
function AnalyzingScreen({ elapsed, keywordCount }: { elapsed: number; keywordCount: number }) {
  const phases = [
    { at: 0,  label: "Отправляю ключевые слова в ИИ..." },
    { at: 5,  label: "Анализирую семантику ключей..." },
    { at: 20, label: "Кластеризую по темам..." },
    { at: 60, label: "Формирую структуру сайта..." },
    { at: 100, label: "Генерирую заголовки статей..." },
    { at: 150, label: "Финализирую структуру..." },
  ];
  const currentPhase = [...phases].reverse().find(p => elapsed >= p.at) || phases[0];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: 40 }}>
      {/* animated rings */}
      <div style={{ position: "relative", width: 80, height: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(99,102,241,0.15)", animation: "spin 3s linear infinite" }} />
        <div style={{ position: "absolute", inset: 6, borderRadius: "50%", border: "2px solid rgba(124,58,237,0.25)", animation: "spin 2s linear infinite reverse" }} />
        <Layers className="w-7 h-7 text-indigo-400" />
      </div>

      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginBottom: 8, letterSpacing: "-0.02em" }}>
          Анализирую {keywordCount} ключей
        </div>
        <div style={{ fontSize: 13.5, color: "#818cf8", marginBottom: 6, minHeight: 20 }}>
          {currentPhase.label}
        </div>
        <div style={{ fontSize: 12, color: "#444" }}>
          Прошло: {elapsed < 60 ? `${elapsed}с` : `${Math.floor(elapsed / 60)}м ${elapsed % 60}с`}
          {" · "}обычно занимает 1–3 мин
        </div>
      </div>

      {/* progress dots */}
      <div style={{ display: "flex", gap: 6 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: "50%",
            background: i <= Math.min(4, Math.floor(elapsed / 30)) ? "#4f46e5" : "rgba(255,255,255,0.08)",
            transition: "background 0.5s",
          }} />
        ))}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ─── Empty state ─── */
function EmptyScreen({ phase }: { phase: Phase }) {
  if (phase === "setup") return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 40 }}>
      <div style={{ width: 64, height: 64, borderRadius: 20, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <BarChart2 className="w-7 h-7 text-indigo-400" />
      </div>
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#555", marginBottom: 10, letterSpacing: "-0.02em" }}>
          SEO-машина
        </div>
        <div style={{ fontSize: 13.5, color: "#444", lineHeight: 1.7, marginBottom: 20 }}>
          Вставьте ключевые слова слева. ИИ кластеризует их по темам, создаст структуру и сгенерирует статьи с изображениями.
        </div>
        <div style={{ display: "inline-flex", flexDirection: "column", gap: 8, textAlign: "left" }}>
          {[
            ["⚡", "70 токенов / статья (вкл. 3 фото)"],
            ["📊", "До 1000 ключевых слов"],
            ["🌐", "Публикация на Netlify одной кнопкой"],
          ].map(([icon, text]) => (
            <div key={text} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "#444" }}>
              <span>{icon}</span><span>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 40 }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <FileText className="w-6 h-6 text-zinc-600" />
      </div>
      <div style={{ fontSize: 13.5, color: "#555", textAlign: "center" }}>
        Нажмите на страницу в структуре для предпросмотра
      </div>
    </div>
  );
}
