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
} from "lucide-react";

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
    </div>
  );
}
