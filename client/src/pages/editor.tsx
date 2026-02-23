import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useLocation, useParams } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Project, ProjectMessage, ProjectImage } from "@shared/schema";
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
  Trash2,
  ImagePlus,
  RotateCcw,
  MousePointer2,
  Type,
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

const SkeuoPanel = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
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
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingImageTarget = useRef<string | null>(null);

  const [imgGenOpen, setImgGenOpen] = useState(false);
  const [imgName, setImgName] = useState("");
  const [imgPrompt, setImgPrompt] = useState("");
  const [imgSize, setImgSize] = useState("16:9");
  const [imgGenerating, setImgGenerating] = useState(false);
  const [imgStatus, setImgStatus] = useState<"idle" | "creating" | "waiting" | "success" | "fail">("idle");
  const [imgResultUrls, setImgResultUrls] = useState<string[]>([]);
  const [imgError, setImgError] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
  });

  const { data: messages = [] } = useQuery<ProjectMessage[]>({
    queryKey: ["/api/projects", projectId, "messages"],
  });

  const { data: projectImages = [] } = useQuery<ProjectImage[]>({
    queryKey: ["/api/projects", projectId, "images"],
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
            if (data.status) {
              setGenerationStatus(data.status);
            }
            if (data.content) {
              setGenerationStatus(null);
              fullText += data.content;
              const htmlMatch = fullText.match(/```html\n?([\s\S]*?)```/);
              setStreamedCode(htmlMatch ? htmlMatch[1].trim() : (fullText.includes("<html") ? fullText.trim() : ""));
            }
            if (data.done && data.code) {
              setGenerationStatus(null);
              setStreamedCode(data.code);
            }
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
    toast({ title: "Подготовка архива...", description: "Скачиваем изображения" });

    const zip = new JSZip();
    const imgFolder = zip.folder("images");
    let htmlCode = currentCode;

    const allImageUrls = new Map<string, string>();

    const downloadImage = async (imageUrl: string): Promise<Blob | null> => {
      try {
        const resp = await fetch(`/api/proxy-image?url=${encodeURIComponent(imageUrl)}`);
        if (!resp.ok) throw new Error("proxy failed");
        return await resp.blob();
      } catch {
        try {
          const resp = await fetch(imageUrl);
          return await resp.blob();
        } catch {
          return null;
        }
      }
    };

    if (projectImages.length > 0 && imgFolder) {
      for (const img of projectImages) {
        const ext = img.url.match(/\.(png|jpg|jpeg|webp|gif|svg)(\?|$)/i)?.[1] || "png";
        const fileName = `${img.name.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, "_")}.${ext}`;
        const blob = await downloadImage(img.url);
        if (blob) {
          imgFolder.file(fileName, blob);
          allImageUrls.set(img.url, `images/${fileName}`);
        }
      }
    }

    const externalImgRegex = /(?:src\s*=\s*["']|url\s*\(\s*["']?)(https?:\/\/[^"'\s)]+(?:\.(?:png|jpg|jpeg|webp|gif|svg)|\/[^"'\s)]*))(?:\?[^"'\s)]*)?/gi;
    let match;
    const externalUrls = new Set<string>();
    while ((match = externalImgRegex.exec(htmlCode)) !== null) {
      const url = match[1];
      if (!allImageUrls.has(url) && !url.includes("placehold.co")) {
        externalUrls.add(url);
      }
    }

    if (externalUrls.size > 0 && imgFolder) {
      let idx = 0;
      for (const url of externalUrls) {
        const ext = url.match(/\.(png|jpg|jpeg|webp|gif|svg)(\?|$)/i)?.[1] || "png";
        const fileName = `image_${idx++}.${ext}`;
        const blob = await downloadImage(url);
        if (blob) {
          imgFolder.file(fileName, blob);
          allImageUrls.set(url, `images/${fileName}`);
        }
      }
    }

    for (const [remoteUrl, localPath] of allImageUrls) {
      htmlCode = htmlCode.split(remoteUrl).join(localPath);
    }

    zip.file("index.html", htmlCode);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.title || "site"}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Архив готов!", description: `${allImageUrls.size} изображений включено` });
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
    if (!imgPrompt.trim() || !imgName.trim()) return;
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

      setTimeout(() => clearInterval(pollInterval), 180000);
    } catch (err: any) {
      setImgError(err.message);
      setImgStatus("fail");
      setImgGenerating(false);
    }
  }, [imgPrompt, imgSize, imgName]);

  const handleSaveImage = useCallback(async (url: string) => {
    try {
      const resp = await fetch(`/api/projects/${projectId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: imgName.trim(), url, prompt: imgPrompt }),
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Ошибка сохранения");
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "images"] });
      toast({ title: "Сохранено в библиотеку", description: `Изображение "${imgName}" готово к использованию` });
      setImgGenOpen(false);
      setImgStatus("idle");
      setImgResultUrls([]);
      setImgName("");
      setImgPrompt("");
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
  }, [projectId, imgName, imgPrompt, toast]);

  const handleDeleteImage = useCallback(async (imageId: number) => {
    try {
      await fetch(`/api/projects/${projectId}/images/${imageId}`, {
        method: "DELETE",
        credentials: "include",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "images"] });
      toast({ title: "Изображение удалено" });
    } catch {
      toast({ title: "Ошибка удаления", variant: "destructive" });
    }
  }, [projectId, toast]);

  const handleRestoreFromMessage = useCallback(async (code: string) => {
    try {
      const resp = await fetch(`/api/projects/${projectId}/code`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generatedCode: code }),
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Ошибка восстановления");
      setStreamedCode(code);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({ title: "Версия восстановлена" });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
  }, [projectId, toast]);

  const getEditableCode = useCallback((code: string) => {
    if (!editMode || !code) return code;
    const editorScript = `
<style>
  [contenteditable]:hover { outline: 2px dashed rgba(59,130,246,0.5); outline-offset: 2px; cursor: text; }
  [contenteditable]:focus { outline: 2px solid rgba(59,130,246,0.8); outline-offset: 2px; background: rgba(59,130,246,0.05); }
  img:hover, .image-placeholder:hover { outline: 2px dashed rgba(168,85,247,0.6); outline-offset: 2px; cursor: pointer; }
  .__edit-tooltip { position: fixed; background: #1e293b; color: white; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; pointer-events: none; z-index: 99999; white-space: nowrap; }
</style>
<script>
(function() {
  var tooltip = null;
  function showTooltip(el, text) {
    if (!tooltip) { tooltip = document.createElement('div'); tooltip.className = '__edit-tooltip'; document.body.appendChild(tooltip); }
    tooltip.textContent = text;
    var r = el.getBoundingClientRect();
    tooltip.style.left = r.left + 'px';
    tooltip.style.top = (r.top - 28) + 'px';
    tooltip.style.display = 'block';
  }
  function hideTooltip() { if (tooltip) tooltip.style.display = 'none'; }

  document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,a,li,td,th,button,label,figcaption').forEach(function(el) {
    if (el.children.length === 0 || el.childNodes.length === 1) {
      el.setAttribute('contenteditable', 'true');
      el.addEventListener('mouseenter', function() { showTooltip(el, 'Клик для редактирования текста'); });
      el.addEventListener('mouseleave', hideTooltip);
      el.addEventListener('blur', function() {
        window.parent.postMessage({ type: 'nz-text-edit', html: document.documentElement.outerHTML }, '*');
      });
    }
  });

  document.querySelectorAll('img').forEach(function(img) {
    img.addEventListener('mouseenter', function() { showTooltip(img, 'Клик для замены изображения'); });
    img.addEventListener('mouseleave', hideTooltip);
    img.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      hideTooltip();
      var path = [];
      var node = img;
      while (node && node !== document.body) {
        var idx = 0;
        var sib = node;
        while (sib.previousElementSibling) { sib = sib.previousElementSibling; idx++; }
        path.unshift(idx);
        node = node.parentElement;
      }
      window.parent.postMessage({ type: 'nz-img-click', path: path.join(','), src: img.src }, '*');
    });
  });

  document.querySelectorAll('.image-placeholder').forEach(function(ph) {
    ph.addEventListener('mouseenter', function() { showTooltip(ph, 'Клик для добавления изображения'); });
    ph.addEventListener('mouseleave', hideTooltip);
    ph.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      hideTooltip();
      var path = [];
      var node = ph;
      while (node && node !== document.body) {
        var idx = 0;
        var sib = node;
        while (sib.previousElementSibling) { sib = sib.previousElementSibling; idx++; }
        path.unshift(idx);
        node = node.parentElement;
      }
      window.parent.postMessage({ type: 'nz-placeholder-click', path: path.join(','), hint: ph.getAttribute('data-image-hint') || '' }, '*');
    });
  });

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'nz-replace-image') {
      var path = e.data.path.split(',').map(Number);
      var node = document.body;
      for (var i = 0; i < path.length; i++) {
        if (node.children[path[i]]) node = node.children[path[i]];
        else break;
      }
      if (node.tagName === 'IMG') {
        node.src = e.data.url;
        node.style.objectFit = 'cover';
      } else if (node.classList && node.classList.contains('image-placeholder')) {
        var img = document.createElement('img');
        img.src = e.data.url;
        img.alt = node.getAttribute('data-image-hint') || '';
        img.style.width = node.style.width || '100%';
        img.style.height = node.style.height || '400px';
        img.style.objectFit = 'cover';
        img.style.borderRadius = node.style.borderRadius || '16px';
        node.parentNode.replaceChild(img, node);
      }
      window.parent.postMessage({ type: 'nz-text-edit', html: document.documentElement.outerHTML }, '*');
    }
  });
})();
</script>`;
    return code.replace('</body>', editorScript + '</body>');
  }, [editMode]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'nz-text-edit') {
        const cleanHtml = e.data.html
          .replace(/<style>[\s\S]*?\[contenteditable\][\s\S]*?<\/style>/g, '')
          .replace(/<script>[\s\S]*?nz-text-edit[\s\S]*?<\/script>/g, '')
          .replace(/<div class="__edit-tooltip"[\s\S]*?<\/div>/g, '')
          .replace(/\s*contenteditable="true"/g, '');
        const doctype = '<!DOCTYPE html>\n';
        const finalHtml = cleanHtml.startsWith('<!DOCTYPE') ? cleanHtml : doctype + cleanHtml;
        setStreamedCode(finalHtml);
        fetch(`/api/projects/${projectId}/code`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generatedCode: finalHtml }),
          credentials: "include",
        });
      }
      if (e.data.type === 'nz-img-click' || e.data.type === 'nz-placeholder-click') {
        pendingImageTarget.current = e.data.path;
        const imgInput = document.createElement('input');
        imgInput.type = 'file';
        imgInput.accept = 'image/*';
        imgInput.onchange = (ev) => {
          const file = (ev.target as HTMLInputElement).files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            iframeRef.current?.contentWindow?.postMessage({
              type: 'nz-replace-image',
              path: pendingImageTarget.current,
              url: dataUrl,
            }, '*');
          };
          reader.readAsDataURL(file);
        };
        imgInput.click();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [projectId]);

  const deviceWidths = { desktop: "100%", tablet: "768px", mobile: "375px" };

  if (projectLoading) return <div className="h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-[#0F172A]"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;

  return (
    <div className="h-screen bg-[#F8FAFC] dark:bg-[#0F172A] flex flex-col p-4 gap-4 overflow-hidden">
      <header className="h-16 flex items-center justify-between gap-4 px-2">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="rounded-xl shadow-skeuo-sm bg-white dark:bg-slate-900" onClick={() => setLocation("/dashboard")} data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex flex-col">
            <span className="text-sm font-black uppercase tracking-widest text-primary leading-none mb-1">PRO-PROJECT</span>
            <h1 className="text-xl font-black tracking-tighter leading-none" data-testid="text-project-title">{project?.title}</h1>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-white/40 dark:bg-black/20 backdrop-blur-xl border border-white/20 dark:border-white/5 rounded-2xl p-1.5 shadow-glass">
          <div className="flex items-center border rounded-xl p-0.5 gap-0.5 bg-slate-100/50 dark:bg-slate-800/50 shadow-skeuo-inner">
            {[
              { d: "desktop" as const, i: Monitor },
              { d: "tablet" as const, i: Tablet },
              { d: "mobile" as const, i: Smartphone },
            ].map(({ d, i: Icon }) => (
              <Button key={d} variant={previewDevice === d ? "secondary" : "ghost"} size="icon" className="h-8 w-8 rounded-lg" onClick={() => setPreviewDevice(d)} data-testid={`button-device-${d}`}>
                <Icon className="w-3.5 h-3.5" />
              </Button>
            ))}
          </div>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

          <Button variant={showCode ? "secondary" : "ghost"} size="sm" className="rounded-xl font-bold px-4" onClick={() => { setShowCode(!showCode); if (!showCode) setEditMode(false); }} data-testid="button-toggle-code">
            {showCode ? <Eye className="w-4 h-4 mr-2" /> : <Code2 className="w-4 h-4 mr-2" />}
            {showCode ? "Сайт" : "Код"}
          </Button>

          {!showCode && currentCode && (
            <Button variant={editMode ? "default" : "outline"} size="sm" className={`rounded-xl font-bold px-4 ${editMode ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}`} onClick={() => setEditMode(!editMode)} data-testid="button-toggle-edit">
              <MousePointer2 className="w-4 h-4 mr-2" />
              {editMode ? "Редактор ВКЛ" : "Редактор"}
            </Button>
          )}

          <Button variant="outline" size="sm" className="rounded-xl font-bold px-4" onClick={handleDownloadZip} disabled={!currentCode} data-testid="button-download-zip">
            <Download className="w-4 h-4 mr-2" />
            ZIP
          </Button>

          <Button variant="outline" size="sm" className="rounded-xl font-bold px-4 bg-gradient-to-r from-violet-500/10 to-pink-500/10 border-violet-500/20 text-violet-700 dark:text-violet-300 hover:from-violet-500/20 hover:to-pink-500/20" onClick={() => setImgGenOpen(true)} data-testid="button-open-image-gen">
            <Wand2 className="w-4 h-4 mr-2" />
            AI Фото
            {projectImages.length > 0 && (
              <Badge className="ml-1.5 bg-violet-500 text-white text-[10px] px-1.5 py-0 rounded-full">{projectImages.length}</Badge>
            )}
          </Button>

          <Button size="sm" className="rounded-xl font-black px-6 shadow-lg shadow-primary/20 hover-elevate" onClick={() => toast({ title: "Публикация", description: "Скоро!" })} data-testid="button-publish">
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
              {messages.map((msg, idx) => {
                const isModel = msg.role === "model";
                const isLatestModel = isModel && !messages.slice(idx + 1).some(m => m.role === "model");
                return (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[90%] rounded-2xl p-4 text-sm font-medium shadow-skeuo-md ${msg.role === "user" ? "bg-primary text-white" : "bg-white dark:bg-slate-800"}`}>
                      {msg.role === "user" ? msg.content : (
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-primary" />
                          <span className="text-primary font-black">Сайт обновлён</span>
                          {!isLatestModel && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="ml-1 h-7 px-2 rounded-lg text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                              onClick={() => handleRestoreFromMessage(msg.content)}
                              data-testid={`button-rollback-msg-${msg.id}`}
                            >
                              <RotateCcw className="w-3.5 h-3.5 mr-1" />
                              <span className="text-xs font-bold">Откатить</span>
                            </Button>
                          )}
                          {isLatestModel && (
                            <Badge className="ml-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[10px] px-1.5 py-0 rounded-full">текущий</Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {isGenerating && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 text-sm font-black flex items-center gap-3 shadow-skeuo-md animate-pulse">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    {generationStatus || "Генерируем шедевр..."}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {projectImages.length > 0 && (
            <div className="px-6 py-3 border-t bg-violet-50/50 dark:bg-violet-900/10">
              <p className="text-xs font-bold text-violet-600 dark:text-violet-400 mb-2 flex items-center gap-1.5">
                <ImagePlus className="w-3.5 h-3.5" />
                Библиотека изображений ({projectImages.length})
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {projectImages.map((img) => (
                  <div key={img.id} className="relative shrink-0 group" data-testid={`image-library-${img.id}`}>
                    <img src={img.url} alt={img.name} className="w-12 h-12 rounded-lg object-cover border-2 border-violet-200 dark:border-violet-700" title={img.name} />
                    <span className="absolute -bottom-1 left-0 right-0 text-[8px] font-black text-center text-violet-700 dark:text-violet-300 bg-white/90 dark:bg-slate-900/90 rounded-b-lg truncate px-0.5">{img.name}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-violet-500 mt-1.5">Напишите в чат: "вставь изображение [имя] в hero секцию"</p>
            </div>
          )}

          <div className="p-6 border-t bg-slate-50/50 dark:bg-slate-800/20">
            {imagePreview && (
              <div className="mb-4 relative w-20 h-20 group">
                <img src={imagePreview} className="w-full h-full object-cover rounded-xl shadow-lg" />
                <button className="absolute -top-2 -right-2 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-lg" onClick={() => {setImagePreview(null); setImageBase64(null);}}>×</button>
              </div>
            )}
            <div className="flex items-end gap-3">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              <Button variant="outline" size="icon" className="h-12 w-12 rounded-xl shrink-0 bg-white dark:bg-slate-900" onClick={() => fileInputRef.current?.click()} disabled={isGenerating} data-testid="button-upload-image">
                <ImageIcon className="w-5 h-5" />
              </Button>
              <Textarea 
                placeholder={projectImages.length > 0 ? `Вставь "${projectImages[0].name}" в hero...` : "Что добавим?"}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleGenerate())}
                className="min-h-[48px] h-12 rounded-xl border-none bg-white dark:bg-slate-900 shadow-skeuo-inner font-medium py-3"
                disabled={isGenerating}
                data-testid="input-prompt"
              />
              <Button className="h-12 w-12 rounded-xl shrink-0 shadow-lg shadow-primary/20" onClick={() => handleGenerate()} disabled={isGenerating || (!prompt.trim() && !imageBase64)} data-testid="button-send">
                <Send className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </SkeuoPanel>

        <button 
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={`absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-12 bg-white dark:bg-slate-900 shadow-skeuo-md border border-white/20 dark:border-white/5 rounded-r-xl flex items-center justify-center hover:bg-primary hover:text-white transition-all ${sidebarOpen ? 'translate-x-[400px]' : 'translate-x-0'}`}
          data-testid="button-toggle-sidebar"
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
                  <iframe ref={iframeRef} srcDoc={getEditableCode(currentCode)} className="w-full h-full border-none" sandbox="allow-scripts allow-same-origin" />
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
        <DialogContent className="sm:max-w-lg bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-white/20 dark:border-white/10 shadow-skeuo-lg rounded-3xl max-h-[90vh] overflow-y-auto" aria-describedby="img-gen-description">
          <DialogHeader>
            <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-violet-500" />
              AI Генерация изображений
            </DialogTitle>
            <DialogDescription id="img-gen-description">
              Создайте изображение, дайте ему имя, а потом скажите Gemini куда его вставить
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-bold mb-1.5 block text-slate-700 dark:text-slate-300">Имя изображения</label>
              <Input
                placeholder="например: персик, баннер, офис..."
                value={imgName}
                onChange={e => setImgName(e.target.value)}
                className="rounded-xl bg-white dark:bg-slate-800 shadow-skeuo-inner"
                disabled={imgGenerating}
                data-testid="input-image-name"
              />
              <p className="text-[11px] text-slate-400 mt-1">Это имя вы будете использовать в чате: "вставь [имя] в hero секцию"</p>
            </div>

            <div>
              <label className="text-sm font-bold mb-1.5 block text-slate-700 dark:text-slate-300">Описание изображения</label>
              <Textarea
                placeholder="Сочный персик на белом фоне, студийное фото..."
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
              disabled={imgGenerating || !imgPrompt.trim() || !imgName.trim()}
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
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" />
                  Изображение "{imgName}" готово!
                </div>
                {imgResultUrls.map((url, i) => (
                  <div key={i} className="space-y-3">
                    <img src={url} alt={imgName} className="w-full rounded-xl shadow-skeuo-md border border-white/20" data-testid={`img-result-${i}`} />
                    <Button
                      className="w-full rounded-xl font-black h-11 bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg"
                      onClick={() => handleSaveImage(url)}
                      data-testid={`button-save-image-${i}`}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Сохранить как "{imgName}" в библиотеку
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {projectImages.length > 0 && (
              <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-black text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                  <ImagePlus className="w-4 h-4 text-violet-500" />
                  Библиотека проекта
                </h3>
                <div className="space-y-2">
                  {projectImages.map((img) => (
                    <div key={img.id} className="flex items-center gap-3 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700" data-testid={`image-item-${img.id}`}>
                      <img src={img.url} alt={img.name} className="w-14 h-14 rounded-lg object-cover shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black truncate">{img.name}</p>
                        <p className="text-[11px] text-slate-400 truncate">{img.prompt}</p>
                        <code className="text-[10px] text-violet-500 font-mono">{`{{IMG:${img.name}}}`}</code>
                      </div>
                      <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => handleDeleteImage(img.id)} data-testid={`button-delete-image-${img.id}`}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
