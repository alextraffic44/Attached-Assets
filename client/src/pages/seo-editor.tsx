import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SeoConfig, SeoCluster, SeoKeyword } from "@shared/schema";
import { ChevronRight, ChevronDown, Globe, Zap, RefreshCw, CheckCircle2, XCircle, Clock, Loader2, ArrowLeft, Plus, Trash2 } from "lucide-react";

type Phase = "setup" | "structure" | "generating" | "done";

function StatusIcon({ status }: { status: SeoKeyword["status"] | "pending" }) {
  if (status === "done") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  if (status === "failed") return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  if (status === "generating") return <Loader2 className="w-3.5 h-3.5 text-blue-400 shrink-0 animate-spin" />;
  return <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />;
}

export default function SeoEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [phase, setPhase] = useState<Phase>("setup");
  const [keywordsText, setKeywordsText] = useState("");
  const [niche, setNiche] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [openClusters, setOpenClusters] = useState<Set<string>>(new Set());
  const [genLog, setGenLog] = useState<string[]>([]);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const { data, isLoading, refetch } = useQuery<{ project: any; files: { id: number; filename: string }[] }>({
    queryKey: ["/api/seo", id],
    queryFn: () => fetch(`/api/seo/${id}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: isGenerating ? 5000 : false,
  });

  const project = data?.project;
  const files = data?.files || [];
  const cfg: SeoConfig | null = project?.seoConfig || null;

  useEffect(() => {
    if (!cfg) return;
    if (cfg.status === "done" || cfg.pagesGenerated > 0) setPhase("done");
    else if (cfg.clusters.length > 0) setPhase("structure");
    else setPhase("setup");
    if (cfg.niche) setNiche(cfg.niche);
    if (cfg.clusters.length > 0) {
      setOpenClusters(new Set(cfg.clusters.slice(0, 3).map(c => c.id)));
    }
    setGenProgress({ done: cfg.pagesGenerated, total: cfg.pagesTotal });
  }, [cfg?.status, cfg?.clusters.length]);

  async function handleAnalyze() {
    const keywords = keywordsText.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);
    if (keywords.length === 0) { toast({ title: "Введите ключевые слова", variant: "destructive" }); return; }
    if (keywords.length > 1000) { toast({ title: "Максимум 1000 ключей", variant: "destructive" }); return; }
    setIsAnalyzing(true);
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
      toast({ title: `Структура построена` });
    } catch (e: any) {
      toast({ title: "Ошибка анализа", description: e.message, variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  }

  function startGeneration() {
    if (isGenerating) return;
    setIsGenerating(true);
    setPhase("generating");
    setGenLog([]);
    setGenProgress({ done: 0, total: cfg?.pagesTotal || 0 });

    // Use fetch SSE
    const ctrl = new AbortController();
    fetch(`/api/seo/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
      signal: ctrl.signal,
    }).then(async (res) => {
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
            if (evt.type === "start") setGenProgress(p => ({ ...p, total: evt.total }));
            if (evt.type === "progress") setGenLog(l => [...l.slice(-99), `⏳ ${evt.keyword}`]);
            if (evt.type === "page_done") {
              const icon = evt.status === "done" ? "✅" : "❌";
              setGenLog(l => [...l.slice(-99), `${icon} ${evt.keyword}`]);
              setGenProgress({ done: evt.generated, total: evt.total });
            }
            if (evt.type === "done") {
              setPhase("done");
              refetch();
            }
            if (evt.type === "error") {
              toast({ title: evt.message, variant: "destructive" });
            }
          } catch {}
        }
      }
    }).catch((e) => {
      if (e.name !== "AbortError") toast({ title: "Ошибка генерации", description: e.message, variant: "destructive" });
    }).finally(() => {
      setIsGenerating(false);
      refetch();
    });
  }

  async function handlePublish() {
    setIsPublishing(true);
    try {
      const res = await fetch(`/api/seo/${id}/publish`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      toast({ title: "Сайт опубликован!", description: data.url });
      refetch();
    } catch (e: any) {
      toast({ title: "Ошибка публикации", description: e.message, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  }

  async function loadPreview(filename: string) {
    setSelectedFile(filename);
    try {
      const res = await fetch(`/api/seo/${id}/file?filename=${encodeURIComponent(filename)}`, { credentials: "include" });
      if (res.ok) setPreviewHtml(await res.text());
    } catch {}
  }

  function toggleCluster(cid: string) {
    setOpenClusters(prev => { const next = new Set(prev); next.has(cid) ? next.delete(cid) : next.add(cid); return next; });
  }

  const pct = genProgress.total > 0 ? Math.round((genProgress.done / genProgress.total) * 100) : 0;
  const donePagesCount = files.filter(f => f.filename.endsWith("/index.html") && f.filename !== "index.html" && !f.filename.match(/^[^/]+\/index\.html$/)).length + files.filter(f => f.filename !== "index.html" && f.filename !== "robots.txt" && f.filename !== "sitemap.xml" && f.filename !== "assets/style.css" && f.filename.endsWith("index.html")).length;

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f0f13]">
      <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f0f13] text-white flex flex-col" style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#161620", borderBottom: "1px solid #2a2a3a", padding: "0 1.5rem", height: 56, display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => setLocation("/dashboard")} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          <ArrowLeft className="w-4 h-4" /> Назад
        </button>
        <div style={{ width: 1, height: 20, background: "#2a2a3a" }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>SEO-машина</span>
        <span style={{ fontSize: 13, color: "#666", flex: 1 }}>{project?.title}</span>

        {phase !== "setup" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {cfg?.publishUrl ? (
              <a href={cfg.publishUrl} target="_blank" rel="noopener" style={{ fontSize: 13, color: "#6ee7b7", textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
                <Globe className="w-4 h-4" /> {cfg.publishUrl.replace("https://", "")}
              </a>
            ) : (
              <button onClick={handlePublish} disabled={isPublishing || files.length < 2} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
                background: isPublishing ? "#2a2a3a" : "#4f46e5", color: "#fff", border: "none",
                borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: isPublishing ? "not-allowed" : "pointer",
              }}>
                {isPublishing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Публикация...</> : <><Globe className="w-3.5 h-3.5" /> Опубликовать</>}
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", height: "calc(100vh - 56px)" }}>
        {/* LEFT PANEL */}
        <div style={{ width: 320, minWidth: 280, maxWidth: 380, background: "#161620", borderRight: "1px solid #2a2a3a", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {phase === "setup" && (
            <div style={{ padding: "1.5rem", overflowY: "auto", flex: 1 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>🚀 Запуск SEO-машины</h2>
              <p style={{ fontSize: 13, color: "#888", marginBottom: 20, lineHeight: 1.6 }}>
                Вставьте ключевые слова — через запятую или каждое на новой строке. ИИ кластеризует их и построит структуру сайта.
              </p>

              <label style={{ fontSize: 12, fontWeight: 600, color: "#aaa", display: "block", marginBottom: 6 }}>Ниша / тема сайта</label>
              <input
                value={niche}
                onChange={e => setNiche(e.target.value)}
                placeholder="напр. нейросети для бизнеса"
                style={{ width: "100%", padding: "8px 12px", background: "#1e1e2e", border: "1px solid #2a2a3a", borderRadius: 8, color: "#e2e8f0", fontSize: 13, marginBottom: 14, outline: "none" }}
              />

              <label style={{ fontSize: 12, fontWeight: 600, color: "#aaa", display: "block", marginBottom: 6 }}>
                Ключевые слова (до 1000 — через запятую или по строкам)
              </label>
              <textarea
                value={keywordsText}
                onChange={e => setKeywordsText(e.target.value)}
                placeholder={"как пользоваться midjourney, midjourney бесплатно, chatgpt для бизнеса, ..."}
                rows={14}
                style={{ width: "100%", padding: "10px 12px", background: "#1e1e2e", border: "1px solid #2a2a3a", borderRadius: 8, color: "#e2e8f0", fontSize: 13, resize: "none", outline: "none", lineHeight: 1.6 }}
              />
              <div style={{ fontSize: 12, color: "#666", marginBottom: 16, marginTop: 6 }}>
                {keywordsText.split(/[\n,]+/).filter(k => k.trim()).length} ключей
              </div>

              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || !keywordsText.trim()}
                style={{
                  width: "100%", padding: "11px", background: isAnalyzing ? "#2a2a3a" : "linear-gradient(135deg,#4f46e5,#7c3aed)",
                  border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 14,
                  cursor: isAnalyzing ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {isAnalyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Анализирую...</> : <><Zap className="w-4 h-4" /> Построить структуру</>}
              </button>
            </div>
          )}

          {(phase === "structure" || phase === "generating" || phase === "done") && cfg && (
            <>
              {/* Stats */}
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #2a2a3a", display: "flex", gap: 16 }}>
                <div style={{ textAlign: "center", flex: 1 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#6ee7b7" }}>{cfg.pagesGenerated}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>готово</div>
                </div>
                <div style={{ textAlign: "center", flex: 1 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#e2e8f0" }}>{cfg.pagesTotal}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>всего</div>
                </div>
                <div style={{ textAlign: "center", flex: 1 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#818cf8" }}>{cfg.clusters.length}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>категорий</div>
                </div>
              </div>

              {/* Progress bar */}
              {(phase === "generating" || cfg.pagesGenerated > 0) && (
                <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a2a3a" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12, color: "#888" }}>
                    <span>Прогресс генерации</span><span>{genProgress.done}/{genProgress.total} ({pct}%)</span>
                  </div>
                  <div style={{ height: 6, background: "#2a2a3a", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#4f46e5,#6ee7b7)", borderRadius: 99, transition: "width 0.5s" }} />
                  </div>
                </div>
              )}

              {/* Buttons */}
              <div style={{ padding: "10px 14px", borderBottom: "1px solid #2a2a3a", display: "flex", gap: 8 }}>
                {phase !== "generating" && (
                  <button onClick={startGeneration} disabled={isGenerating} style={{
                    flex: 1, padding: "8px 12px", background: cfg.pagesGenerated > 0 ? "#1e1e2e" : "linear-gradient(135deg,#4f46e5,#7c3aed)",
                    border: cfg.pagesGenerated > 0 ? "1px solid #4f46e5" : "none",
                    borderRadius: 8, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}>
                    {cfg.pagesGenerated > 0 ? <><RefreshCw className="w-3.5 h-3.5" /> Продолжить</> : <><Zap className="w-3.5 h-3.5" /> Генерировать</>}
                  </button>
                )}
                {phase === "generating" && (
                  <div style={{ flex: 1, padding: "8px 12px", background: "#1e1e2e", border: "1px solid #2a2a3a", borderRadius: 8, color: "#888", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" /> Генерирую...
                  </div>
                )}
                <button onClick={() => { setPhase("setup"); setKeywordsText(cfg.rawKeywords.join("\n")); setNiche(cfg.niche); }} title="Изменить ключи" style={{ padding: "8px 10px", background: "#1e1e2e", border: "1px solid #2a2a3a", borderRadius: 8, color: "#888", cursor: "pointer", display: "flex", alignItems: "center" }}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Structure tree */}
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                {/* Homepage */}
                <button onClick={() => loadPreview("index.html")} style={{
                  width: "100%", padding: "6px 16px", background: selectedFile === "index.html" ? "#1e1e2e" : "none",
                  border: "none", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#e2e8f0",
                }}>
                  <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Главная</span>
                  {files.find(f => f.filename === "index.html") && <CheckCircle2 className="w-3 h-3 text-emerald-500 ml-auto" />}
                </button>

                {cfg.clusters.map(cluster => (
                  <div key={cluster.id}>
                    <button
                      onClick={() => { toggleCluster(cluster.id); loadPreview(`${cluster.slug}/index.html`); }}
                      style={{
                        width: "100%", padding: "6px 16px", background: selectedFile === `${cluster.slug}/index.html` ? "#1e1e2e" : "none",
                        border: "none", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#e2e8f0",
                      }}
                    >
                      {openClusters.has(cluster.id) ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{cluster.name}</span>
                      <span style={{ fontSize: 11, color: "#666" }}>{cluster.keywords.filter(k => k.status === "done").length}/{cluster.keywords.length}</span>
                    </button>

                    {openClusters.has(cluster.id) && cluster.keywords.map(kw => (
                      <button
                        key={kw.id}
                        onClick={() => kw.filename && loadPreview(kw.filename)}
                        style={{
                          width: "100%", padding: "4px 16px 4px 32px",
                          background: selectedFile === kw.filename ? "#1e1e2e" : "none",
                          border: "none", textAlign: "left", cursor: kw.filename ? "pointer" : "default",
                          display: "flex", alignItems: "center", gap: 6, color: kw.status === "done" ? "#c4c4d4" : "#666",
                        }}
                      >
                        <StatusIcon status={kw.status} />
                        <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kw.title || kw.keyword}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              {/* Generation log */}
              {phase === "generating" && genLog.length > 0 && (
                <div style={{ borderTop: "1px solid #2a2a3a", padding: "8px", maxHeight: 120, overflowY: "auto", background: "#0f0f13" }}>
                  {genLog.slice(-8).map((line, i) => (
                    <div key={i} style={{ fontSize: 11, color: "#888", lineHeight: 1.6 }}>{line}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* RIGHT PANEL — Preview */}
        <div style={{ flex: 1, background: "#0f0f13", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {previewHtml ? (
            <iframe
              srcDoc={previewHtml}
              style={{ flex: 1, border: "none", background: "#fff" }}
              title="preview"
              sandbox="allow-scripts allow-same-origin"
            />
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, color: "#444" }}>
              {phase === "setup" ? (
                <>
                  <div style={{ fontSize: 48 }}>🔍</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#666" }}>SEO-машина</div>
                  <div style={{ fontSize: 14, color: "#555", textAlign: "center", maxWidth: 380, lineHeight: 1.6 }}>
                    Вставьте ключевые слова слева. ИИ кластеризует их по темам, создаст структуру сайта и сгенерирует статьи с изображениями — готово к публикации.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8, fontSize: 13, color: "#555" }}>
                    {["⚡ 70 токенов / статья (включая 3 фото)", "📊 До 1000 ключевых слов", "🌐 Публикация на Netlify одной кнопкой"].map(s => (
                      <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>{s}</div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 40 }}>👈</div>
                  <div style={{ fontSize: 15, color: "#555" }}>Нажмите на страницу в структуре для предпросмотра</div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
