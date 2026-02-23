import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/lib/auth";
import { useLocation, useParams } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Project, ProjectMessage } from "@shared/schema";
import JSZip from "jszip";
import {
  ArrowLeft,
  Send,
  Download,
  Sparkles,
  Loader2,
  Code2,
  Eye,
  ExternalLink,
  Monitor,
  Smartphone,
  Tablet,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Wand2,
  CheckCircle2,
  XCircle,
  Replace,
  PlusCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SkeuoPanel = ({ children, className = "" }) => (
  <div className={`bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl border border-white/20 dark:border-white/5 shadow-skeuo-lg rounded-[2rem] overflow-hidden flex flex-col ${className}`}>
    {children}
  </div>
);

export default function EditorPage() {
  const params = useParams<{ id: string }>();
  const projectId = parseInt(params.id || "0");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedCode, setStreamedCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [imgGenOpen, setImgGenOpen] = useState(false);
  const [imgPrompt, setImgPrompt] = useState("");
  const [imgSize, setImgSize] = useState("16:9");
  const [imgGenerating, setImgGenerating] = useState(false);
  const [imgTaskId, setImgTaskId] = useState<string | null>(null);
  const [imgStatus, setImgStatus] = useState<"idle" | "creating" | "waiting" | "success" | "fail">("idle");
  const [imgResultUrls, setImgResultUrls] = useState<string[]>([]);
  const [imgError, setImgError] = useState("");
  const [imgSections, setImgSections] = useState<Array<{ id: string; label: string; type: string; hasImage: boolean }>>([]);
  const [imgTargetSection, setImgTargetSection] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
  });

  const { data: messages = [] } = useQuery<ProjectMessage[]>({
    queryKey: ["/api/projects", projectId, "messages"],
  });

  const currentCode = streamedCode || project?.generatedCode || "";

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const initialPrompt = urlParams.get("prompt");
    if (initialPrompt && !project?.generatedCode && messages.length === 0) {
      setPrompt(initialPrompt);
      setTimeout(() => handleGenerate(initialPrompt), 500);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [project, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleGenerate = useCallback(async (customPrompt?: string) => {
    const text = customPrompt || prompt;
    if (!text.trim() && !imageBase64) return;

    setIsGenerating(true);
    setStreamedCode("");
    setPrompt("");

    try {
      const response = await fetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, imageBase64 }),
        credentials: "include",
      });

      if (!response.ok) throw new Error("Ошибка генерации");

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));
            if (data.content) {
              fullText += data.content;
              const htmlMatch = fullText.match(/```html\n?([\s\S]*?)```/);
              setStreamedCode(htmlMatch ? htmlMatch[1].trim() : (fullText.includes("<html") ? fullText.trim() : ""));
            }
            if (data.done && data.code) setStreamedCode(data.code);
          }
        }
      }

      setImageBase64(null);
      setImagePreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, projectId, imageBase64, toast]);

  const handleDownloadZip = async () => {
    if (!currentCode) return;
    const zip = new JSZip();
    zip.file("index.html", currentCode);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.title || "site"}.zip`;
    a.click();
    toast({ title: "Архив готов" });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(reader.result as string);
      setImageBase64((reader.result as string).split(",")[1]);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateImage = useCallback(async () => {
    if (!imgPrompt.trim()) return;
    setImgGenerating(true);
    setImgStatus("creating");
    setImgResultUrls([]);
    setImgError("");

    try {
      const resp = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: imgPrompt, imageSize: imgSize }),
        credentials: "include",
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message);

      const taskId = data.taskId;
      setImgTaskId(taskId);
      setImgStatus("waiting");

      const pollInterval = setInterval(async () => {
        try {
          const statusResp = await fetch(`/api/images/status/${taskId}`, { credentials: "include" });
          const statusData = await statusResp.json();

          if (statusData.state === "success") {
            clearInterval(pollInterval);
            setImgResultUrls(statusData.urls || []);
            setImgStatus("success");
            setImgGenerating(false);
          } else if (statusData.state === "fail") {
            clearInterval(pollInterval);
            setImgError(statusData.error || "Ошибка генерации");
            setImgStatus("fail");
            setImgGenerating(false);
          }
        } catch {
          clearInterval(pollInterval);
          setImgError("Ошибка соединения");
          setImgStatus("fail");
          setImgGenerating(false);
        }
      }, 3000);

      setTimeout(() => {
        clearInterval(pollInterval);
        if (imgStatus === "waiting") {
          setImgError("Таймаут генерации");
          setImgStatus("fail");
          setImgGenerating(false);
        }
      }, 180000);
    } catch (err: any) {
      setImgError(err.message);
      setImgStatus("fail");
      setImgGenerating(false);
    }
  }, [imgPrompt, imgSize, imgStatus]);

  const loadSections = useCallback(async () => {
    try {
      const resp = await fetch(`/api/projects/${projectId}/analyze-sections`, { credentials: "include" });
      if (resp.ok) {
        const data = await resp.json();
        setImgSections(data.targets || []);
        if (data.targets?.length > 0) setImgTargetSection(data.targets[0].id);
      }
    } catch {}
  }, [projectId]);

  useEffect(() => {
    if (imgGenOpen && currentCode) loadSections();
  }, [imgGenOpen, currentCode, loadSections]);

  const handleInsertImage = useCallback(async (url: string, mode: string, target?: string) => {
    try {
      const resp = await fetch(`/api/projects/${projectId}/insert-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: url,
          altText: imgPrompt || "AI изображение",
          insertMode: mode,
          targetSection: target || imgTargetSection,
        }),
        credentials: "include",
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.message || "Ошибка вставки");
      }
      const updated = await resp.json();
      setStreamedCode(updated.generatedCode);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({ title: "Изображение вставлено" });
      setImgGenOpen(false);
      setImgStatus("idle");
      setImgResultUrls([]);
      setImgPrompt("");
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
  }, [projectId, imgPrompt, imgTargetSection, toast]);

  const deviceWidths = { desktop: "100%", tablet: "768px", mobile: "375px" };

  if (projectLoading) return <div className="h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-[#0F172A]"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  return (
    <div className="h-screen bg-[#F8FAFC] dark:bg-[#0F172A] flex flex-col p-4 gap-4 overflow-hidden">
      <header className="h-16 flex items-center justify-between gap-4 px-2">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="rounded-xl shadow-skeuo-sm bg-white dark:bg-slate-900" onClick={() => setLocation("/dashboard")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex flex-col">
            <span className="text-sm font-black uppercase tracking-widest text-primary leading-none mb-1">PRO-PROJECT</span>
            <h1 className="text-xl font-black tracking-tighter leading-none">{project?.title}</h1>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-white/40 dark:bg-black/20 backdrop-blur-xl border border-white/20 dark:border-white/5 rounded-2xl p-1.5 shadow-glass">
          <div className="flex items-center border rounded-xl p-0.5 gap-0.5 bg-slate-100/50 dark:bg-slate-800/50 shadow-skeuo-inner">
            {[
              { d: "desktop" as const, i: Monitor },
              { d: "tablet" as const, i: Tablet },
              { d: "mobile" as const, i: Smartphone },
            ].map(({ d, i: Icon }) => (
              <Button key={d} variant={previewDevice === d ? "secondary" : "ghost"} size="icon" className="h-8 w-8 rounded-lg" onClick={() => setPreviewDevice(d)}>
                <Icon className="w-3.5 h-3.5" />
              </Button>
            ))}
          </div>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

          <Button variant={showCode ? "secondary" : "ghost"} size="sm" className="rounded-xl font-bold px-4" onClick={() => setShowCode(!showCode)}>
            {showCode ? <Eye className="w-4 h-4 mr-2" /> : <Code2 className="w-4 h-4 mr-2" />}
            {showCode ? "Сайт" : "Код"}
          </Button>

          <Button variant="outline" size="sm" className="rounded-xl font-bold px-4" onClick={handleDownloadZip} disabled={!currentCode}>
            <Download className="w-4 h-4 mr-2" />
            ZIP
          </Button>

          <Button variant="outline" size="sm" className="rounded-xl font-bold px-4 bg-gradient-to-r from-violet-500/10 to-pink-500/10 border-violet-500/20 text-violet-700 dark:text-violet-300 hover:from-violet-500/20 hover:to-pink-500/20" onClick={() => setImgGenOpen(true)} disabled={!currentCode} data-testid="button-open-image-gen">
            <Wand2 className="w-4 h-4 mr-2" />
            AI Фото
          </Button>

          <Button size="sm" className="rounded-xl font-black px-6 shadow-lg shadow-primary/20 hover-elevate" onClick={() => toast({ title: "Публикация", description: "Скоро!" })}>
            <ExternalLink className="w-4 h-4 mr-2" />
            Live
          </Button>
        </div>
      </header>

      <div className="flex-1 flex gap-4 overflow-hidden relative">
        <SkeuoPanel className={`transition-all duration-500 ease-in-out ${sidebarOpen ? 'w-full sm:w-[400px]' : 'w-0 opacity-0 -translate-x-full'}`}>
          <div className="p-6 border-b flex items-center justify-between">
            <h2 className="text-lg font-black tracking-tight">AI Конструктор</h2>
            <Badge className="bg-primary/10 text-primary border-primary/20 rounded-lg">Gemini 3.1</Badge>
          </div>
          <ScrollArea className="flex-1 px-6">
            <div className="py-6 space-y-6">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[90%] rounded-2xl p-4 text-sm font-medium shadow-skeuo-md ${msg.role === "user" ? "bg-primary text-white" : "bg-white dark:bg-slate-800"}`}>
                    {msg.role === "user" ? msg.content : <div className="flex items-center gap-2 text-primary font-black"><Sparkles className="w-4 h-4" /> Сайт обновлён</div>}
                  </div>
                </div>
              ))}
              {isGenerating && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 text-sm font-black flex items-center gap-3 shadow-skeuo-md animate-pulse">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    Генерируем шедевр...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
          
          <div className="p-6 border-t bg-slate-50/50 dark:bg-slate-800/20">
            {imagePreview && (
              <div className="mb-4 relative w-20 h-20 group">
                <img src={imagePreview} className="w-full h-full object-cover rounded-xl shadow-lg" />
                <button className="absolute -top-2 -right-2 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-lg" onClick={() => {setImagePreview(null); setImageBase64(null);}}>×</button>
              </div>
            )}
            <div className="flex items-end gap-3">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              <Button variant="outline" size="icon" className="h-12 w-12 rounded-xl shrink-0 bg-white dark:bg-slate-900" onClick={() => fileInputRef.current?.click()} disabled={isGenerating}>
                <ImageIcon className="w-5 h-5" />
              </Button>
              <Textarea 
                placeholder="Что добавим?"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleGenerate())}
                className="min-h-[48px] h-12 rounded-xl border-none bg-white dark:bg-slate-900 shadow-skeuo-inner font-medium py-3"
                disabled={isGenerating}
              />
              <Button className="h-12 w-12 rounded-xl shrink-0 shadow-lg shadow-primary/20" onClick={() => handleGenerate()} disabled={isGenerating || (!prompt.trim() && !imageBase64)}>
                <Send className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </SkeuoPanel>

        <button 
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={`absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-12 bg-white dark:bg-slate-900 shadow-skeuo-md border border-white/20 dark:border-white/5 rounded-r-xl flex items-center justify-center hover:bg-primary hover:text-white transition-all ${sidebarOpen ? 'translate-x-[400px]' : 'translate-x-0'}`}
        >
          {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <SkeuoPanel className="flex-1 relative bg-slate-100 dark:bg-black p-4">
          {showCode ? (
            <div className="w-full h-full p-6 bg-slate-900 rounded-[1.5rem] shadow-skeuo-inner overflow-auto">
              <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap">{currentCode || "// Тут будет код"}</pre>
            </div>
          ) : currentCode ? (
            <div className="w-full h-full flex items-center justify-center overflow-hidden">
               <div className="bg-white rounded-2xl shadow-2xl transition-all duration-500 overflow-hidden border border-white/20" style={{ width: deviceWidths[previewDevice], height: '100%' }}>
                  <iframe srcDoc={currentCode} className="w-full h-full border-none" sandbox="allow-scripts allow-same-origin" />
               </div>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
              <div className="w-24 h-24 rounded-3xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center shadow-skeuo-inner">
                <Maximize2 className="w-10 h-10 text-slate-400" />
              </div>
              <p className="text-slate-500 font-black uppercase tracking-widest text-xs">Ожидание первого байта...</p>
            </div>
          )}
        </SkeuoPanel>
      </div>

      <Dialog open={imgGenOpen} onOpenChange={setImgGenOpen}>
        <DialogContent className="sm:max-w-lg bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-white/20 dark:border-white/10 shadow-skeuo-lg rounded-3xl" aria-describedby="img-gen-description">
          <DialogHeader>
            <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-violet-500" />
              AI Генерация изображений
            </DialogTitle>
            <DialogDescription id="img-gen-description">
              Nano Banana создаст изображение и вставит его в ваш сайт
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-bold mb-1.5 block text-slate-700 dark:text-slate-300">Описание изображения</label>
              <Textarea
                placeholder="Современный офис с панорамными окнами, минималистичный дизайн..."
                value={imgPrompt}
                onChange={e => setImgPrompt(e.target.value)}
                className="min-h-[80px] rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-skeuo-inner"
                disabled={imgGenerating}
                data-testid="input-image-prompt"
              />
            </div>

            <div>
              <label className="text-sm font-bold mb-1.5 block text-slate-700 dark:text-slate-300">Соотношение сторон</label>
              <Select value={imgSize} onValueChange={setImgSize} disabled={imgGenerating}>
                <SelectTrigger className="rounded-xl" data-testid="select-image-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 (Широкий баннер)</SelectItem>
                  <SelectItem value="1:1">1:1 (Квадрат)</SelectItem>
                  <SelectItem value="4:3">4:3 (Стандарт)</SelectItem>
                  <SelectItem value="3:2">3:2 (Фото)</SelectItem>
                  <SelectItem value="9:16">9:16 (Вертикальный)</SelectItem>
                  <SelectItem value="3:4">3:4 (Портрет)</SelectItem>
                  <SelectItem value="21:9">21:9 (Ультраширокий)</SelectItem>
                  <SelectItem value="auto">Авто</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full rounded-xl font-black h-12 shadow-lg bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-700 hover:to-pink-700 text-white"
              onClick={handleGenerateImage}
              disabled={imgGenerating || !imgPrompt.trim()}
              data-testid="button-generate-image"
            >
              {imgGenerating ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {imgStatus === "creating" ? "Создаём задачу..." : "Генерируем изображение..."}</>
              ) : (
                <><Wand2 className="w-4 h-4 mr-2" /> Сгенерировать</>
              )}
            </Button>

            {imgStatus === "waiting" && (
              <div className="flex items-center gap-3 p-4 bg-violet-50 dark:bg-violet-900/20 rounded-xl border border-violet-200 dark:border-violet-800">
                <Loader2 className="w-5 h-5 animate-spin text-violet-500 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-violet-700 dark:text-violet-300">Генерация в процессе</p>
                  <p className="text-xs text-violet-500">Обычно занимает 15-60 секунд</p>
                </div>
              </div>
            )}

            {imgStatus === "fail" && (
              <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800">
                <XCircle className="w-5 h-5 text-red-500 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-red-700 dark:text-red-300">Ошибка генерации</p>
                  <p className="text-xs text-red-500">{imgError}</p>
                </div>
              </div>
            )}

            {imgStatus === "success" && imgResultUrls.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" />
                  Изображение готово!
                </div>
                {imgResultUrls.map((url, i) => (
                  <div key={i} className="space-y-4">
                    <img src={url} alt="Сгенерированное изображение" className="w-full rounded-xl shadow-skeuo-md border border-white/20" data-testid={`img-result-${i}`} />

                    {imgSections.length > 0 && (
                      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                        <label className="text-sm font-bold block text-slate-700 dark:text-slate-300">Вставить в секцию</label>
                        <Select value={imgTargetSection} onValueChange={setImgTargetSection}>
                          <SelectTrigger className="rounded-xl" data-testid="select-target-section">
                            <SelectValue placeholder="Выберите секцию" />
                          </SelectTrigger>
                          <SelectContent>
                            {imgSections.map(s => (
                              <SelectItem key={s.id} value={s.id}>
                                <span className="flex items-center gap-2">
                                  {s.type === "placeholder" && <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />}
                                  {s.type === "has-image" && <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />}
                                  {s.type === "no-image" && <span className="w-2 h-2 rounded-full bg-slate-300 inline-block" />}
                                  {s.label}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          className="w-full rounded-xl font-bold bg-violet-600 hover:bg-violet-700 text-white"
                          onClick={() => handleInsertImage(url, "into-section", imgTargetSection)}
                          disabled={!imgTargetSection}
                          data-testid={`button-insert-section-${i}`}
                        >
                          <ImageIcon className="w-3.5 h-3.5 mr-1.5" />
                          Вставить в {imgSections.find(s => s.id === imgTargetSection)?.label || "секцию"}
                        </Button>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => handleInsertImage(url, "replace-first-placeholder")}
                        data-testid={`button-replace-placeholder-${i}`}
                      >
                        <Replace className="w-3.5 h-3.5 mr-1.5" />
                        Заменить placeholder
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 rounded-xl font-bold"
                        onClick={() => handleInsertImage(url, "append")}
                        data-testid={`button-append-image-${i}`}
                      >
                        <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
                        В конец сайта
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
