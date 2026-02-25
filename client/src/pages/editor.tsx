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
import type { Project, ProjectMessage, ProjectImage, ProjectVersion, ProjectFile } from "@shared/schema";
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
  Paperclip,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Crosshair,
  Wand2,
  CheckCircle2,
  XCircle,
  Trash2,
  ImagePlus,
  RotateCcw,
  MousePointer2,
  Type,
  History,
  Clock,
  FileText,
  Plus,
  X,
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
  const [attachedImages, setAttachedImages] = useState<Array<{base64: string, mimeType: string, preview: string | null, fileName: string}>>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [streamingReply, setStreamingReply] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [selectorMode, setSelectorMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<{tag: string, text: string, classes: string, path: string, outerSnippet: string} | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingImageTarget = useRef<string | null>(null);

  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [imagePickerTab, setImagePickerTab] = useState<"library" | "upload">("library");
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  const [imgGenOpen, setImgGenOpen] = useState(false);
  const [faviconUploading, setFaviconUploading] = useState(false);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const [faviconCropOpen, setFaviconCropOpen] = useState(false);
  const [faviconRawSrc, setFaviconRawSrc] = useState<string>("");
  const [faviconRawMime, setFaviconRawMime] = useState<string>("image/png");
  const [cropBox, setCropBox] = useState({ x: 0, y: 0, size: 100 });
  const [cropDrag, setCropDrag] = useState<{ mode: "move" | "resize"; startX: number; startY: number; origBox: { x: number; y: number; size: number } } | null>(null);
  const cropImgRef = useRef<HTMLImageElement>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);
  const [imgName, setImgName] = useState("");
  const [imgPrompt, setImgPrompt] = useState("");
  const [imgSize, setImgSize] = useState("16:9");
  const [imgGenerating, setImgGenerating] = useState(false);
  const [imgStatus, setImgStatus] = useState<"idle" | "creating" | "waiting" | "success" | "fail">("idle");
  const [imgResultUrls, setImgResultUrls] = useState<string[]>([]);
  const [imgError, setImgError] = useState("");

  const [showPublishModal, setShowPublishModal] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [customDomain, setCustomDomain] = useState("");
  const [domainAdding, setDomainAdding] = useState(false);
  const [domainResult, setDomainResult] = useState<{ added: boolean; instructions: boolean } | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [domainVerified, setDomainVerified] = useState<boolean | null>(null);
  const [domainChecking, setDomainChecking] = useState(false);

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

  const { data: versions = [] } = useQuery<ProjectVersion[]>({
    queryKey: ["/api/projects", projectId, "versions"],
  });

  const [showVersions, setShowVersions] = useState(false);
  const [addPageOpen, setAddPageOpen] = useState(false);
  const [newPageName, setNewPageName] = useState("");

  const { data: projectFiles = [] } = useQuery<ProjectFile[]>({
    queryKey: ["/api/projects", projectId, "files"],
  });

  const [activeFile, setActiveFile] = useState("index.html");

  const allFiles = [
    { filename: "index.html", code: project?.generatedCode || "" },
    ...projectFiles.filter(f => f.filename !== "index.html"),
  ];

  const activeFileCode = activeFile === "index.html"
    ? (streamedCode || project?.generatedCode || "")
    : (projectFiles.find(f => f.filename === activeFile)?.code || "");

  const currentCode = activeFileCode;

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const initialPrompt = urlParams.get("prompt");
    const enhanced = urlParams.get("enhanced") === "1";
    const initialResearch = urlParams.get("research") || "";
    if (initialPrompt && !project?.generatedCode && messages.length === 0) {
      setPrompt(initialPrompt);
      setTimeout(() => handleGenerate(initialPrompt, enhanced, initialResearch), 500);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [project, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleAddPage = useCallback(async () => {
    let name = newPageName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!name) return;
    if (!name.endsWith(".html")) name += ".html";
    if (name === "index.html" || allFiles.some(f => f.filename === name)) {
      toast({ title: "Ошибка", description: "Страница с таким именем уже существует", variant: "destructive" });
      return;
    }
    try {
      const baseCode = project?.generatedCode || "";
      const headMatch = baseCode.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
      const headerMatch = baseCode.match(/<header[^>]*>[\s\S]*?<\/header>/i);
      const navMatch = baseCode.match(/<nav[^>]*>[\s\S]*?<\/nav>/i);
      const footerMatch = baseCode.match(/<footer[^>]*>[\s\S]*?<\/footer>/i);
      const topSection = headerMatch ? headerMatch[0] : (navMatch ? navMatch[0] : "");
      const headContent = headMatch ? headMatch[1].replace(/<title>[\s\S]*?<\/title>/i, "") : "";
      const pageName = name.replace(".html", "");
      const pageLabel = pageName.charAt(0).toUpperCase() + pageName.slice(1);
      const template = `<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>${pageLabel}</title>\n${headContent}\n</head>\n<body>\n${topSection}\n\n<section style="min-height:80vh;display:flex;align-items:center;justify-content:center;padding:4rem 2rem">\n<div style="text-align:center;max-width:800px">\n<h1>${pageLabel}</h1>\n<p>Содержимое страницы. Опишите в чате, что здесь разместить.</p>\n</div>\n</section>\n\n${footerMatch ? footerMatch[0] : ""}\n</body>\n</html>`;
      await fetch(`/api/projects/${projectId}/files/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: template }),
      });

      await fetch(`/api/projects/${projectId}/sync-nav`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] });
      setActiveFile(name);
      setAddPageOpen(false);
      setNewPageName("");
      toast({ title: "Готово", description: `Страница ${pageLabel} создана и добавлена в навигацию` });
    } catch {
      toast({ title: "Ошибка", description: "Не удалось создать страницу", variant: "destructive" });
    }
  }, [newPageName, projectId, allFiles, project, toast]);

  const handleGenerate = useCallback(async (customPrompt?: string, skipEnhance?: boolean, deepResearchData?: string) => {
    let text = customPrompt || prompt;
    if (!text.trim() && attachedImages.length === 0) return;

    if (selectedElement && !customPrompt) {
      const elRef = `[Выбранный элемент: <${selectedElement.tag}>${selectedElement.classes ? ` class="${selectedElement.classes}"` : ''} — "${selectedElement.text.substring(0, 80)}"\nHTML: ${selectedElement.outerSnippet}]\n\n`;
      text = elRef + text;
      setSelectedElement(null);
      setSelectorMode(false);
    }

    setIsGenerating(true);
    setStreamingReply("");
    setStreamedCode("");
    setPrompt("");
    queryClient.setQueryData(["/api/auth/user"], (old: any) => old ? { ...old, credits: Math.max(0, old.credits - 100) } : old);

    const images = attachedImages.map(img => ({ base64: img.base64, mimeType: img.mimeType, fileName: img.fileName }));
    const sentPreviews = attachedImages.filter(img => img.preview).map(img => ({ preview: img.preview!, fileName: img.fileName }));

    // Сразу очищаем прикреплённые файлы из поля ввода
    setAttachedImages([]);

    // Оптимистичное добавление сообщения в UI с превью картинок
    const imageInfo = sentPreviews.length > 0 ? `\n__IMAGES__${JSON.stringify(sentPreviews)}` : "";
    const tempUserMessage: ProjectMessage = {
      id: Math.random(),
      projectId,
      role: "user",
      content: text + imageInfo,
      createdAt: new Date()
    };
    
    // Временно обновляем кэш сообщений для мгновенного отображения
    queryClient.setQueryData(["/api/projects", projectId, "messages"], (old: ProjectMessage[] | undefined) => {
      const messages = [...(old || []), tempUserMessage];
      return messages;
    });

    // Прокрутка вниз после добавления сообщения
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);

    try {
      const bodyData: any = { prompt: text, images, activeFile, skipEnhance: !!skipEnhance };
      if (deepResearchData) {
        bodyData.deepResearchData = deepResearchData;
      }
      const response = await fetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData),
        credentials: "include",
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        const errMsg = errData?.message || "Ошибка генерации";
        throw new Error(errMsg);
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let fullText = "";
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        sseBuffer += chunk;
        const messages = sseBuffer.split("\n\n");
        sseBuffer = messages.pop() || "";

        for (const msg of messages) {
          const dataLines = msg.split("\n").filter(l => l.startsWith("data: ")).map(l => l.slice(6));
          if (dataLines.length === 0) continue;
          const jsonStr = dataLines.join("\n");
          let data: any;
          try { data = JSON.parse(jsonStr); } catch (e) { continue; }
          if (data.status) {
            setGenerationStatus(data.status);
          }
          if (data.content) {
            setGenerationStatus(null);
            fullText += data.content;

            const firstFileMarker = fullText.indexOf("--- FILE:");
            const htmlBlockStart = fullText.indexOf("```html\n");
            const targetFn = activeFile || "index.html";
            const escapedFn = targetFn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            if (firstFileMarker > 0 && (htmlBlockStart === -1 || firstFileMarker < htmlBlockStart)) {
              const textBefore = fullText.substring(0, firstFileMarker).trim();
              if (textBefore) setStreamingReply(textBefore);
            } else if (htmlBlockStart > 0) {
              const textBefore = fullText.substring(0, htmlBlockStart).trim();
              if (textBefore) setStreamingReply(textBefore);
            }

            const fileCompleteRe = new RegExp(`---\\s*FILE:\\s*${escapedFn}\\s*---\\s*\\n?\\s*\`\`\`html\\s*\\n?([\\s\\S]*?)\`\`\``, 'i');
            const filePartialRe = new RegExp(`---\\s*FILE:\\s*${escapedFn}\\s*---\\s*\\n?\\s*\`\`\`html\\s*\\n?([\\s\\S]*)`, 'i');
            const fileCompleteMatch = fullText.match(fileCompleteRe);
            if (fileCompleteMatch) {
              setStreamedCode(fileCompleteMatch[1].trim());
            } else if (firstFileMarker !== -1) {
              const filePartialMatch = fullText.match(filePartialRe);
              if (filePartialMatch) {
                const partialCode = filePartialMatch[1].trim();
                if (partialCode) setStreamedCode(partialCode);
              }
            } else {
              const htmlMatchComplete = fullText.match(/```html\n?([\s\S]*?)```/);
              if (htmlMatchComplete) {
                setStreamedCode(htmlMatchComplete[1].trim());
              } else if (htmlBlockStart !== -1) {
                const codeAfterMarker = fullText.substring(htmlBlockStart + 8);
                if (codeAfterMarker.trim()) {
                  setStreamedCode(codeAfterMarker);
                }
              } else if (fullText.trimStart().startsWith("<!DOCTYPE") || fullText.trimStart().startsWith("<html")) {
                setStreamedCode(fullText.trim());
              }
            }
          }
          if (data.done) {
            setGenerationStatus(null);
            const targetFile = data.editedFile || activeFile || "index.html";
            const targetCode = targetFile === "index.html" ? data.code : (data.editedCode || data.code);
            if (targetCode) setStreamedCode(targetCode);
            setActiveFile(targetFile);
            queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] });
            queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
            if (data.newBalance !== undefined) {
              queryClient.setQueryData(["/api/auth/user"], (old: any) => old ? { ...old, credits: data.newBalance } : old);
            }
          }
          if (data.error) {
            toast({ title: "Ошибка генерации", description: data.error, variant: "destructive" });
          }
        }
      }

      setAttachedImages([]);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "versions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, projectId, attachedImages, activeFile, toast, selectedElement]);

  const handleDownloadZip = async () => {
    const indexCode = project?.generatedCode || currentCode;
    if (!indexCode) return;
    toast({ title: "Подготовка архива...", description: "Скачиваем изображения" });

    const zip = new JSZip();
    const imgFolder = zip.folder("images");
    let htmlCode = indexCode;

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

    const allCodeToScan = [htmlCode, ...projectFiles.filter(f => f.filename !== "index.html").map(f => f.code)].join("\n");

    const uploadRegex = /(?:src\s*=\s*["']|url\s*\(\s*["']?)(\/uploads\/[^"'\s)]+)/gi;
    let uploadMatch;
    const uploadUrls = new Set<string>();
    while ((uploadMatch = uploadRegex.exec(allCodeToScan)) !== null) {
      const url = uploadMatch[1];
      if (!allImageUrls.has(url)) uploadUrls.add(url);
    }
    if (uploadUrls.size > 0 && imgFolder) {
      let upIdx = 0;
      for (const url of Array.from(uploadUrls)) {
        const ext = url.match(/\.(png|jpg|jpeg|webp|gif|svg)(\?|$)/i)?.[1] || "png";
        const fileName = `upload_${upIdx++}.${ext}`;
        const blob = await downloadImage(url);
        if (blob) {
          imgFolder.file(fileName, blob);
          allImageUrls.set(url, `images/${fileName}`);
        }
      }
    }

    const externalImgRegex = /(?:src\s*=\s*["']|url\s*\(\s*["']?)(https?:\/\/[^"'\s)]+(?:\.(?:png|jpg|jpeg|webp|gif|svg)|\/[^"'\s)]*))(?:\?[^"'\s)]*)?/gi;
    let match;
    const externalUrls = new Set<string>();
    while ((match = externalImgRegex.exec(allCodeToScan)) !== null) {
      const url = match[1];
      if (!allImageUrls.has(url) && !url.includes("placehold.co")) {
        externalUrls.add(url);
      }
    }

    if (externalUrls.size > 0 && imgFolder) {
      let idx = 0;
      for (const url of Array.from(externalUrls)) {
        const ext = url.match(/\.(png|jpg|jpeg|webp|gif|svg)(\?|$)/i)?.[1] || "png";
        const fileName = `image_${idx++}.${ext}`;
        const blob = await downloadImage(url);
        if (blob) {
          imgFolder.file(fileName, blob);
          allImageUrls.set(url, `images/${fileName}`);
        }
      }
    }

    for (const [remoteUrl, localPath] of Array.from(allImageUrls.entries())) {
      htmlCode = htmlCode.split(remoteUrl).join(localPath);
    }

    const dataUriRegex = /(?:src\s*=\s*["'])(data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,([^"']+))["']/gi;
    let dataMatch;
    let dataIdx = 0;
    while ((dataMatch = dataUriRegex.exec(htmlCode)) !== null) {
      const fullDataUri = dataMatch[1];
      const ext = dataMatch[2].replace('+xml', '').replace('jpeg', 'jpg');
      const b64 = dataMatch[3];
      const fileName = `uploaded_${dataIdx++}.${ext}`;
      try {
        const byteChars = atob(b64);
        const byteArr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
        imgFolder?.file(fileName, byteArr);
        htmlCode = htmlCode.split(fullDataUri).join(`images/${fileName}`);
      } catch {}
    }

    const leadExportScript = `<script>
(function(){
  var API='${window.location.origin}/api/leads/${projectId}';
  function showToast(msg){
    var t=document.createElement('div');
    t.textContent=msg;
    t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:12px 24px;border-radius:12px;font-weight:600;font-size:14px;z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,0.3);transition:opacity 0.5s';
    document.body.appendChild(t);
    setTimeout(function(){t.style.opacity='0';setTimeout(function(){t.remove()},500)},3000);
  }
  document.addEventListener('submit',function(e){
    var form=e.target;
    if(!form||form.tagName!=='FORM') return;
    e.preventDefault();
    var fd=new FormData(form);
    var data={name:'',email:'',phone:'',message:'',source:form.dataset.leadForm||'form'};
    fd.forEach(function(v,k){
      var kl=k.toLowerCase();
      if(kl.indexOf('name')>-1||kl.indexOf('имя')>-1||kl.indexOf('фио')>-1) data.name=v;
      else if(kl.indexOf('email')>-1||kl.indexOf('почт')>-1||kl.indexOf('mail')>-1) data.email=v;
      else if(kl.indexOf('phone')>-1||kl.indexOf('тел')>-1) data.phone=v;
      else if(kl.indexOf('message')>-1||kl.indexOf('сооб')>-1||kl.indexOf('коммент')>-1||kl.indexOf('пожелан')>-1||kl.indexOf('текст')>-1) data.message=v;
      else if(!data.message) data.message=v;
    });
    if(!data.name&&!data.email&&!data.phone&&!data.message) return;
    fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
    .then(function(r){if(r.ok){showToast('Заявка отправлена!');form.reset();}})
    .catch(function(){});
  },true);
})();
</script>`;
    htmlCode = htmlCode.replace('</body>', leadExportScript + '\n</body>');

    zip.file("index.html", htmlCode);

    for (const pf of projectFiles) {
      if (pf.filename !== "index.html") {
        let pfCode = pf.code;
        Array.from(allImageUrls.entries()).forEach(([remoteUrl, localPath]) => {
          pfCode = pfCode.split(remoteUrl).join(localPath);
        });
        pfCode = pfCode.replace('</body>', leadExportScript + '\n</body>');
        zip.file(pf.filename, pfCode);
      }
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.title || "site"}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Архив готов!", description: `${allImageUrls.size} изображений включено` });
  };

  const handlePublish = async () => {
    if (!project) return;
    setIsPublishing(true);
    setPublishError(null);
    setPublishResult(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/publish`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Ошибка публикации");
      setPublishResult(data.url);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    } catch (e: any) {
      setPublishError(e.message);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddDomain = async () => {
    if (!project || !customDomain.trim()) return;
    setDomainAdding(true);
    setDomainError(null);
    setDomainResult(null);
    setDomainVerified(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ domain: customDomain.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Ошибка привязки домена");
      setDomainResult({ added: true, instructions: true });
      setDomainVerified(data.verified || false);
    } catch (e: any) {
      setDomainError(e.message);
    } finally {
      setDomainAdding(false);
    }
  };

  const handleFaviconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;
    setFaviconRawMime(file.type || "image/png");
    const reader = new FileReader();
    reader.onload = () => {
      setFaviconRawSrc(reader.result as string);
      setCropBox({ x: 0, y: 0, size: 200 });
      setFaviconCropOpen(true);
    };
    reader.readAsDataURL(file);
    if (faviconInputRef.current) faviconInputRef.current.value = "";
  };

  const applyFaviconCrop = async () => {
    if (!project || !cropImgRef.current || !cropContainerRef.current) return;
    const img = cropImgRef.current;
    const containerRect = cropContainerRef.current.getBoundingClientRect();
    const scaleX = img.naturalWidth / containerRect.width;
    const scaleY = img.naturalHeight / containerRect.height;
    const savedCropBox = { ...cropBox };
    setFaviconCropOpen(false);
    setFaviconUploading(true);
    try {
      const sx = savedCropBox.x * scaleX;
      const sy = savedCropBox.y * scaleY;
      const sw = savedCropBox.size * scaleX;
      const sh = savedCropBox.size * scaleY;
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 128, 128);
      const dataUrl = canvas.toDataURL("image/png", 0.9);
      const res = await fetch(`/api/projects/${project.id}/favicon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dataUrl, mimeType: "image/png" }),
      });
      if (res.ok) {
        await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
        const fresh = await fetch(`/api/projects/${project.id}`, { credentials: "include" });
        if (fresh.ok) {
          const p = await fresh.json();
          if (iframeRef.current && p.generatedCode) {
            const blob = new Blob([p.generatedCode], { type: "text/html" });
            iframeRef.current.src = URL.createObjectURL(blob);
          }
        }
      }
    } catch {}
    setFaviconUploading(false);
  };

  const onCropMouseDown = (e: React.MouseEvent, mode: "move" | "resize") => {
    e.preventDefault();
    setCropDrag({ mode, startX: e.clientX, startY: e.clientY, origBox: { ...cropBox } });
  };

  const onCropMouseMove = (e: React.MouseEvent) => {
    if (!cropDrag || !cropContainerRef.current) return;
    const containerRect = cropContainerRef.current.getBoundingClientRect();
    const dx = e.clientX - cropDrag.startX;
    const dy = e.clientY - cropDrag.startY;
    if (cropDrag.mode === "move") {
      const nx = Math.max(0, Math.min(containerRect.width - cropDrag.origBox.size, cropDrag.origBox.x + dx));
      const ny = Math.max(0, Math.min(containerRect.height - cropDrag.origBox.size, cropDrag.origBox.y + dy));
      setCropBox(b => ({ ...b, x: nx, y: ny }));
    } else {
      const maxSize = Math.min(
        containerRect.width - cropDrag.origBox.x,
        containerRect.height - cropDrag.origBox.y
      );
      const newSize = Math.max(40, Math.min(maxSize, cropDrag.origBox.size + dx));
      setCropBox(b => ({ ...b, size: newSize }));
    }
  };

  const handleCheckDomain = async () => {
    if (!project || !customDomain.trim()) return;
    setDomainChecking(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/domain/status?domain=${encodeURIComponent(customDomain.trim())}`, { credentials: "include" });
      const data = await res.json();
      setDomainVerified(data.verified || false);
    } catch { setDomainVerified(false); }
    finally { setDomainChecking(false); }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const b64 = dataUrl.split(",")[1];
        const isImage = file.type.startsWith("image/");
        setAttachedImages(prev => [...prev, {
          base64: b64,
          mimeType: file.type || "application/octet-stream",
          preview: isImage ? dataUrl : null,
          fileName: file.name,
        }]);
      };
      reader.readAsDataURL(file);
    }
    if (e.target) e.target.value = "";
    toast({ title: `${files.length > 1 ? files.length + " файлов" : "Файл"} прикреплён`, description: "Можно отправить вместе с промтом" });
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    let count = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (!file) continue;
        count++;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          setAttachedImages(prev => [...prev, {
            base64: dataUrl.split(",")[1],
            mimeType: file.type || "image/png",
            preview: dataUrl,
            fileName: file.name || `pasted-image-${Date.now()}.png`,
          }]);
        };
        reader.readAsDataURL(file);
      }
    }
    if (count > 0) {
      toast({ title: "Изображение прикреплено", description: "Можно отправить вместе с промтом" });
    }
  }, [toast]);

  const handleGenerateImage = useCallback(async () => {
    if (!imgPrompt.trim() || !imgName.trim()) return;
    setImgGenerating(true);
    setImgStatus("creating");
    setImgResultUrls([]);
    setImgError("");
    queryClient.setQueryData(["/api/auth/user"], (old: any) => old ? { ...old, credits: Math.max(0, old.credits - 15) } : old);

    try {
      const resp = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: imgPrompt, imageSize: imgSize }),
        credentials: "include",
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message);
      if (data.newBalance !== undefined) {
        queryClient.setQueryData(["/api/auth/user"], (old: any) => old ? { ...old, credits: data.newBalance } : old);
      }

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

  const handleRestoreVersion = useCallback(async (versionId: number) => {
    try {
      const resp = await fetch(`/api/projects/${projectId}/versions/${versionId}/restore`, {
        method: "POST",
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Ошибка восстановления");
      const updated = await resp.json();
      setStreamedCode(updated.generatedCode || "");
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "versions"] });
      toast({ title: "Версия восстановлена" });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
  }, [projectId, toast]);

  const injectProjectId = useCallback((code: string) => {
    if (!code) return code;
    const leadScript = `<script data-nz-leads>
window.__PROJECT_ID__=${projectId};
(function(){
  var API=(window.location.origin==='null'?window.parent.location.origin:window.location.origin)+'/api/leads/${projectId}';
  document.addEventListener('click',function(e){
    var a=e.target.closest('a');
    if(!a) return;
    var href=a.getAttribute('href');
    if(!href||href==='#'||href===''){e.preventDefault();return;}
    if(href.startsWith('#')){e.preventDefault();var el=document.querySelector(href);if(el)el.scrollIntoView({behavior:'smooth'});return;}
    if(href.match(/^[a-zA-Z0-9_-]+\.html$/)){
      e.preventDefault();
      window.parent.postMessage({type:'nz-navigate-file',filename:href},'*');
      return;
    }
    e.preventDefault();
  },true);
  function showToast(msg){
    var t=document.createElement('div');
    t.textContent=msg;
    t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:12px 24px;border-radius:12px;font-weight:600;font-size:14px;z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,0.3);transition:opacity 0.5s';
    document.body.appendChild(t);
    setTimeout(function(){t.style.opacity='0';setTimeout(function(){t.remove()},500)},3000);
  }
  document.addEventListener('submit',function(e){
    var form=e.target;
    if(!form||form.tagName!=='FORM') return;
    e.preventDefault();
    var fd=new FormData(form);
    var data={name:'',email:'',phone:'',message:'',source:form.dataset.leadForm||'form'};
    fd.forEach(function(v,k){
      var kl=k.toLowerCase();
      if(kl.indexOf('name')>-1||kl.indexOf('имя')>-1||kl.indexOf('фио')>-1) data.name=v;
      else if(kl.indexOf('email')>-1||kl.indexOf('почт')>-1||kl.indexOf('mail')>-1) data.email=v;
      else if(kl.indexOf('phone')>-1||kl.indexOf('тел')>-1) data.phone=v;
      else if(kl.indexOf('message')>-1||kl.indexOf('сооб')>-1||kl.indexOf('коммент')>-1||kl.indexOf('пожелан')>-1||kl.indexOf('текст')>-1) data.message=v;
      else if(!data.message) data.message=v;
    });
    if(!data.name&&!data.email&&!data.phone&&!data.message) return;
    fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
    .then(function(r){if(r.ok){showToast('Заявка отправлена!');form.reset();}})
    .catch(function(){});
  },true);
})();
</script>`;
    return code.replace('</head>', leadScript + '</head>');
  }, [projectId]);

  const getEditableCode = useCallback((code: string) => {
    if (selectorMode && code) {
      const selectorStyle = `<style data-nz-selector>
.__nz-sel-hover{outline:2px dashed rgba(59,130,246,0.7)!important;outline-offset:2px!important;cursor:crosshair!important}
.__nz-sel-active{outline:3px solid rgba(59,130,246,1)!important;outline-offset:2px!important;background:rgba(59,130,246,0.05)!important}
.__nz-sel-label{position:fixed;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;padding:4px 12px;border-radius:8px;font-size:11px;font-weight:700;pointer-events:none;z-index:99999;white-space:nowrap;box-shadow:0 4px 12px rgba(59,130,246,0.3)}
*{cursor:crosshair!important}
</style>`;
      const selectorJs = `<script data-nz-selector>
document.addEventListener('DOMContentLoaded',function(){
  var hovered=null,selected=null,label=null;
  function getPath(el){var p=[];var n=el;while(n&&n!==document.body){var idx=0;var s=n;while(s.previousElementSibling){s=s.previousElementSibling;idx++}p.unshift(idx);n=n.parentElement}return p.join(',')}
  function getLbl(el){var t=el.tagName.toLowerCase();var c=el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\\s+/).slice(0,2).join('.'):'';return '<'+t+c+'>'}
  function showLabel(el){
    if(!label){label=document.createElement('div');label.className='__nz-sel-label';document.body.appendChild(label)}
    label.textContent=getLbl(el);var r=el.getBoundingClientRect();
    label.style.left=Math.max(0,r.left)+'px';label.style.top=Math.max(0,r.top-32)+'px';label.style.display='block';
  }
  function hideLabel(){if(label)label.style.display='none'}
  document.addEventListener('mouseover',function(e){
    var t=e.target;if(t===document.body||t===document.documentElement||t.hasAttribute('data-nz-selector'))return;
    if(hovered&&hovered!==selected)hovered.classList.remove('__nz-sel-hover');
    hovered=t;if(t!==selected)t.classList.add('__nz-sel-hover');
    showLabel(t);
  },true);
  document.addEventListener('mouseout',function(e){
    if(hovered&&hovered!==selected)hovered.classList.remove('__nz-sel-hover');hideLabel();
  },true);
  document.addEventListener('click',function(e){
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    var t=e.target;if(t===document.body||t===document.documentElement||t.hasAttribute('data-nz-selector'))return;
    if(selected)selected.classList.remove('__nz-sel-active');
    selected=t;t.classList.remove('__nz-sel-hover');t.classList.add('__nz-sel-active');
    var snippet=t.outerHTML;if(snippet.length>300)snippet=snippet.substring(0,300)+'...';
    var textContent=t.textContent||'';if(textContent.length>100)textContent=textContent.substring(0,100)+'...';
    window.parent.postMessage({type:'nz-element-selected',tag:t.tagName.toLowerCase(),text:textContent.trim(),classes:typeof t.className==='string'?t.className.replace(/__nz-sel-[a-z]+/g,'').trim():'',path:getPath(t),outerSnippet:snippet},'*');
  },true);
});
<\/script>`;
      let injected = code.replace('</head>', selectorStyle + '</head>');
      injected = injected.replace('</body>', selectorJs + '</body>');
      return injectProjectId(injected);
    }
    if (!editMode || !code) return injectProjectId(code);
    const editorScript = `<!--NZ_EDITOR_START--><style data-nz-editor>
[contenteditable]:hover{outline:2px dashed rgba(59,130,246,0.5);outline-offset:2px;cursor:text}
[contenteditable]:focus{outline:2px solid rgba(59,130,246,0.8);outline-offset:2px}
img:hover,.image-placeholder:hover,[data-image-hint]:hover,[class*="placeholder"]:not(input):hover{outline:2px dashed rgba(168,85,247,0.6);outline-offset:2px;cursor:pointer}
.__nz-tooltip{position:fixed;background:#1e293b;color:#fff;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;pointer-events:none;z-index:99999;white-space:nowrap}
</style><script data-nz-editor>
(function(){
  function getCleanHtml(){
    var clone=document.documentElement.cloneNode(true);
    var eds=clone.querySelectorAll('[data-nz-editor],[data-nz-leads]');
    for(var i=0;i<eds.length;i++) eds[i].parentNode.removeChild(eds[i]);
    var tips=clone.querySelectorAll('.__nz-tooltip');
    for(var i=0;i<tips.length;i++) tips[i].parentNode.removeChild(tips[i]);
    var ces=clone.querySelectorAll('[contenteditable]');
    for(var i=0;i<ces.length;i++) ces[i].removeAttribute('contenteditable');
    var html=clone.outerHTML;
    html=html.replace(/<!--NZ_EDITOR_START-->|<!--NZ_EDITOR_END-->/g,'');
    return '<!DOCTYPE html>\\n'+html;
  }
  function getPath(el){
    var path=[];var node=el;
    while(node&&node!==document.body){
      var idx=0;var sib=node;
      while(sib.previousElementSibling){sib=sib.previousElementSibling;idx++}
      path.unshift(idx);node=node.parentElement;
    }
    return path.join(',');
  }
  var tooltip=null;
  function showTip(el,text){
    if(!tooltip){tooltip=document.createElement('div');tooltip.className='__nz-tooltip';document.body.appendChild(tooltip)}
    tooltip.textContent=text;var r=el.getBoundingClientRect();
    tooltip.style.left=r.left+'px';tooltip.style.top=(r.top-28)+'px';tooltip.style.display='block';
  }
  function hideTip(){if(tooltip)tooltip.style.display='none'}

  document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,a,li,td,th,button,label,figcaption').forEach(function(el){
    if(el.children.length===0||el.childNodes.length===1){
      el.setAttribute('contenteditable','true');
      var savedBg='';var savedClip='';var savedFill='';
      el.addEventListener('mouseenter',function(){showTip(el,'Клик для редактирования')});
      el.addEventListener('mouseleave',hideTip);
      el.addEventListener('focus',function(){
        var cs=window.getComputedStyle(el);
        if(cs.webkitBackgroundClip==='text'||cs.backgroundClip==='text'){
          savedBg=el.style.background||'';savedClip=el.style.webkitBackgroundClip||el.style.backgroundClip||'';savedFill=el.style.webkitTextFillColor||'';
          el.style.webkitBackgroundClip='unset';el.style.backgroundClip='unset';
          el.style.webkitTextFillColor=cs.color||'#fff';el.style.background='transparent';
        }
      });
      el.addEventListener('blur',function(){
        if(savedClip){el.style.background=savedBg;el.style.webkitBackgroundClip=savedClip;el.style.backgroundClip=savedClip;el.style.webkitTextFillColor=savedFill;savedClip=''}
        window.parent.postMessage({type:'nz-text-edit',html:getCleanHtml()},'*');
      });
    }
  });
  document.querySelectorAll('img').forEach(function(img){
    img.style.cursor='pointer';
    img.addEventListener('mouseenter',function(){showTip(img,'Клик для замены')});
    img.addEventListener('mouseleave',hideTip);
    img.addEventListener('click',function(e){
      e.preventDefault();e.stopPropagation();hideTip();
      window.parent.postMessage({type:'nz-img-click',path:getPath(img),src:img.src},'*');
    });
  });
  var phSelectors='.image-placeholder,[data-image-hint],[class*="placeholder"],[class*="img-placeholder"]';
  document.querySelectorAll(phSelectors).forEach(function(ph){
    if(ph.tagName==='IMG') return;
    ph.style.cursor='pointer';ph.style.position=ph.style.position||'relative';
    ph.addEventListener('mouseenter',function(){showTip(ph,'Клик для добавления изображения')});
    ph.addEventListener('mouseleave',hideTip);
    ph.addEventListener('click',function(e){
      e.preventDefault();e.stopPropagation();hideTip();
      window.parent.postMessage({type:'nz-placeholder-click',path:getPath(ph),hint:ph.getAttribute('data-image-hint')||ph.textContent.trim().substring(0,100)||''},'*');
    });
    var kids=ph.querySelectorAll('*');
    for(var k=0;k<kids.length;k++){
      kids[k].style.pointerEvents='none';
    }
  });
  window.addEventListener('message',function(e){
    if(e.data&&e.data.type==='nz-replace-image'){
      var path=e.data.path.split(',').map(Number);var node=document.body;
      for(var i=0;i<path.length;i++){if(node.children[path[i]])node=node.children[path[i]];else break}
      if(node.tagName==='IMG'){node.src=e.data.url;node.style.objectFit='cover'}
      else{
        var img=document.createElement('img');img.src=e.data.url;
        img.alt=node.getAttribute('data-image-hint')||'';
        var cs=window.getComputedStyle(node);
        img.style.width=cs.width||'100%';
        img.style.height=cs.height||'400px';
        img.style.objectFit='cover';
        img.style.borderRadius=cs.borderRadius||'16px';
        img.style.display='block';
        node.parentNode.replaceChild(img,node);
      }
      window.parent.postMessage({type:'nz-text-edit',html:getCleanHtml()},'*');
    }
  });
})();
<\/script><!--NZ_EDITOR_END-->`;
    return injectProjectId(code.replace('</body>', editorScript + '</body>'));
  }, [editMode, selectorMode, injectProjectId]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'nz-text-edit') {
        const finalHtml = e.data.html;
        if (activeFile === "index.html") {
          setStreamedCode(finalHtml);
          fetch(`/api/projects/${projectId}/code`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ generatedCode: finalHtml }),
            credentials: "include",
          });
        } else {
          fetch(`/api/projects/${projectId}/files/${activeFile}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: finalHtml }),
            credentials: "include",
          }).then(() => {
            queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] });
          });
        }
      }
      if (e.data.type === 'nz-navigate-file') {
        if (isGenerating) return;
        const filename = e.data.filename;
        setActiveFile(filename);
        if (filename === "index.html") setStreamedCode("");
      }
      if (e.data.type === 'nz-img-click' || e.data.type === 'nz-placeholder-click') {
        pendingImageTarget.current = e.data.path;
        setImagePickerTab("library");
        setImagePickerOpen(true);
      }
      if (e.data.type === 'nz-element-selected') {
        setSelectedElement({
          tag: e.data.tag,
          text: e.data.text,
          classes: e.data.classes,
          path: e.data.path,
          outerSnippet: e.data.outerSnippet,
        });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [projectId, activeFile, allFiles, isGenerating]);

  const deviceWidths = { desktop: "100%", tablet: "768px", mobile: "375px" };

  const applyImageToIframe = useCallback((url: string) => {
    if (!pendingImageTarget.current) return;
    iframeRef.current?.contentWindow?.postMessage({
      type: 'nz-replace-image',
      path: pendingImageTarget.current,
      url,
    }, '*');
    setImagePickerOpen(false);
  }, []);

  const handleReplaceFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      applyImageToIframe(reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [applyImageToIframe]);

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
            <>
              <Button variant={editMode ? "default" : "outline"} size="sm" className={`rounded-xl font-bold px-4 ${editMode ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}`} onClick={() => { setEditMode(!editMode); if (!editMode) setSelectorMode(false); }} data-testid="button-toggle-edit">
                <MousePointer2 className="w-4 h-4 mr-2" />
                {editMode ? "Редактор ВКЛ" : "Редактор"}
              </Button>
              <Button variant={selectorMode ? "default" : "outline"} size="sm" className={`rounded-xl font-bold px-4 ${selectorMode ? "bg-orange-500 hover:bg-orange-600 text-white" : "border-orange-300 text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-500/30 dark:hover:bg-orange-500/10"}`} onClick={() => { setSelectorMode(!selectorMode); if (!selectorMode) { setEditMode(false); setSelectedElement(null); } }} data-testid="button-toggle-selector">
                <Crosshair className="w-4 h-4 mr-2" />
                {selectorMode ? "Выбор ВКЛ" : "Выбрать"}
              </Button>
            </>
          )}

          <Button variant="outline" size="sm" className="rounded-xl font-bold px-4" onClick={handleDownloadZip} disabled={!currentCode} data-testid="button-download-zip">
            <Download className="w-4 h-4 mr-2" />
            ZIP
          </Button>

          <input ref={faviconInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/x-icon,image/webp" className="hidden" onChange={handleFaviconUpload} data-testid="input-favicon-upload" />
          <Button variant="outline" size="sm" className="rounded-xl font-bold px-3" onClick={() => faviconInputRef.current?.click()} disabled={faviconUploading || !currentCode} title="Загрузить фавикон" data-testid="button-favicon-upload">
            {faviconUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              project?.generatedCode?.includes('rel="icon"') || project?.generatedCode?.includes("rel='icon'")
                ? <span style={{ fontSize: 16 }}>✅</span>
                : <span style={{ fontSize: 16 }}>🔖</span>
            )}
            <span className="ml-1.5 hidden sm:inline">Фавикон</span>
          </Button>

          <Button variant="outline" size="sm" className="rounded-xl font-bold px-4 bg-gradient-to-r from-violet-500/10 to-pink-500/10 border-violet-500/20 text-violet-700 dark:text-violet-300 hover:from-violet-500/20 hover:to-pink-500/20" onClick={() => setImgGenOpen(true)} data-testid="button-open-image-gen">
            <Wand2 className="w-4 h-4 mr-2" />
            AI Фото
            {projectImages.length > 0 && (
              <Badge className="ml-1.5 bg-violet-500 text-white text-[10px] px-1.5 py-0 rounded-full">{projectImages.length}</Badge>
            )}
          </Button>

          <Button
            size="sm"
            className="rounded-xl font-black px-6 shadow-lg shadow-primary/20 hover-elevate"
            onClick={() => {
              setPublishResult(null);
              setPublishError(null);
              setDomainError(null);
              setDomainVerified(null);
              if (project?.customDomain) {
                setCustomDomain(project.customDomain);
                setDomainResult({ added: true, instructions: true });
                setDomainVerified(null);
                setTimeout(async () => {
                  try {
                    const res = await fetch(`/api/projects/${project.id}/domain/status?domain=${encodeURIComponent(project.customDomain!)}`, { credentials: "include" });
                    const data = await res.json();
                    setDomainVerified(data.verified || false);
                  } catch { setDomainVerified(false); }
                }, 100);
              } else {
                setDomainResult(null);
              }
              setShowPublishModal(true);
            }}
            data-testid="button-publish"
          >
            {project?.publishStatus === "published" ? (
              <CheckCircle2 className="w-4 h-4 mr-2 text-green-400" />
            ) : (
              <ExternalLink className="w-4 h-4 mr-2" />
            )}
            {project?.publishStatus === "published" ? "Опубликован" : "Опубликовать"}
          </Button>
        </div>
      </header>

      <div className="flex-1 flex gap-4 overflow-hidden relative">
        <SkeuoPanel className={`transition-all duration-500 ease-in-out min-w-0 ${sidebarOpen ? 'w-full sm:w-[400px] sm:min-w-[400px]' : 'w-0 opacity-0 -translate-x-full'}`}>
          <div className="p-6 border-b flex items-center justify-between">
            <h2 className="text-lg font-black tracking-tight">AI Конструктор</h2>
            <div className="flex items-center gap-2">
              <Badge className="bg-primary/10 text-primary border-primary/20 rounded-lg">Gemini 3.1</Badge>
            </div>
          </div>
          {showVersions && versions.length > 0 && (
            <div className="border-b bg-slate-50/80 dark:bg-slate-900/50 max-h-[240px] overflow-y-auto">
              <div className="px-4 py-3">
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Чекпоинты</p>
                <div className="space-y-1.5">
                  {versions.slice().reverse().map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-2 bg-white dark:bg-slate-800 rounded-xl px-3 py-2 shadow-sm border border-slate-100 dark:border-slate-700/50" data-testid={`version-item-${v.id}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-300 truncate">{v.label}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(v.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 rounded-lg text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20 shrink-0"
                        onClick={() => handleRestoreVersion(v.id)}
                        data-testid={`button-restore-version-${v.id}`}
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        <span className="text-[11px] font-bold">Откатить</span>
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <ScrollArea className="flex-1">
            <div className="py-6 space-y-6 px-4 min-w-0">
              {messages.map((msg, idx) => {
                const isModel = msg.role === "model";
                const isLatestModel = isModel && !messages.slice(idx + 1).some(m => m.role === "model");
                return (
                    <div key={msg.id} className={`rounded-2xl p-4 text-sm font-medium shadow-skeuo-md min-w-0 ${msg.role === "user" ? "bg-primary text-white ml-auto max-w-[85%]" : "bg-white dark:bg-slate-800 mr-auto"}`} style={{ overflowWrap: "break-word", wordBreak: "break-word" }}>
                      {msg.role === "user" ? (() => {
                        const hasImages = msg.content.includes("\n__IMAGES__");
                        const textContent = hasImages ? msg.content.split("\n__IMAGES__")[0] : msg.content;
                        let imgPreviews: Array<{preview: string, fileName: string}> = [];
                        if (hasImages) {
                          try { imgPreviews = JSON.parse(msg.content.split("\n__IMAGES__")[1]); } catch {}
                        }
                        return (
                          <div style={{ overflowWrap: "break-word", wordBreak: "break-word" }}>
                            {textContent}
                            {imgPreviews.length > 0 && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                {imgPreviews.map((img, i) => (
                                  <div key={i} className="flex items-center gap-2 bg-white/15 rounded-lg px-2 py-1.5">
                                    <img src={img.preview} className="w-8 h-8 object-cover rounded" />
                                    <span className="text-[11px] opacity-80 max-w-[100px] truncate">{img.fileName}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })() : (
                        <div className="space-y-2 min-w-0" style={{ overflowWrap: "break-word", wordBreak: "break-word" }}>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <button 
                              onClick={() => {
                                const vNum = messages.filter((m, i) => (m.role === "assistant" || m.role === "model") && i <= idx).length;
                                const v = versions[vNum - 1];
                                if (v) handleRestoreVersion(v.id);
                                else toast({ title: "Инфо", description: "Чекпоинт для этой версии не найден" });
                              }}
                              className="hover:opacity-70 transition-opacity"
                            >
                              <Badge variant="secondary" className="bg-primary/10 text-primary border-none text-[10px] h-5 px-1.5 flex items-center gap-1 cursor-pointer">
                                <History className="w-3 h-3" />
                                <span>v{messages.filter((m, i) => (m.role === "assistant" || m.role === "model") && i <= idx).length}</span>
                              </Badge>
                            </button>
                            <span className="text-primary font-black text-[11px]">Gemini</span>
                            {isLatestModel && (
                              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[10px] px-1.5 py-0 rounded-full">текущий</Badge>
                            )}
                          </div>
                          <div className="text-slate-700 dark:text-slate-300 text-[13px] leading-relaxed select-text" style={{ overflowWrap: "break-word", wordBreak: "break-word" }}>
                            {msg.content.startsWith("<!") || msg.content.startsWith("<html") ? "Сайт обновлён" : msg.content}
                          </div>
                        </div>
                      )}
                    </div>
                );
              })}
              {isGenerating && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 text-sm shadow-skeuo-md max-w-[90%]">
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="text-primary font-black text-[11px]">Gemini</span>
                      <Loader2 className="w-3 h-3 animate-spin text-primary" />
                    </div>
                    {streamingReply ? (
                      <p className="text-slate-700 dark:text-slate-300 text-[13px] leading-relaxed">{streamingReply}</p>
                    ) : (
                      <p className="text-slate-500 text-[13px] font-medium animate-pulse">{generationStatus || "Генерируем шедевр..."}</p>
                    )}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>


          <div className="p-4 border-t bg-slate-50/50 dark:bg-slate-800/20">
            {selectedElement && (
              <div className="mb-3 flex items-center gap-2 bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 rounded-xl px-3 py-2.5">
                <Crosshair className="w-4 h-4 text-orange-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold text-orange-600 dark:text-orange-400">Выбран элемент: </span>
                  <code className="text-xs bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded font-mono">&lt;{selectedElement.tag}{selectedElement.classes ? `.${selectedElement.classes.split(' ')[0]}` : ''}&gt;</code>
                  {selectedElement.text && (
                    <span className="text-xs text-orange-500/70 ml-1.5 truncate block mt-0.5">«{selectedElement.text.substring(0, 60)}{selectedElement.text.length > 60 ? '...' : ''}»</span>
                  )}
                </div>
                <button onClick={() => setSelectedElement(null)} className="text-orange-400 hover:text-orange-600 transition-colors shrink-0" data-testid="button-clear-selection">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            )}
            {attachedImages.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {attachedImages.map((img, idx) => (
                  <div key={idx} className="relative group inline-flex items-center gap-2 bg-white dark:bg-slate-800 rounded-lg px-3 py-2 shadow-sm border border-slate-200/50 dark:border-slate-700/50">
                    {img.preview ? (
                      <img src={img.preview} className="w-12 h-12 object-cover rounded-md" />
                    ) : (
                      <div className="w-12 h-12 rounded-md bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                        <FileText className="w-5 h-5 text-slate-400" />
                      </div>
                    )}
                    <span className="text-xs text-slate-500 dark:text-slate-400 max-w-[80px] truncate">{img.fileName}</span>
                    <button className="ml-1 text-slate-400 hover:text-destructive transition-colors" onClick={() => setAttachedImages(prev => prev.filter((_, i) => i !== idx))}>
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="relative flex items-end">
              <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx" multiple onChange={handleImageUpload} className="hidden" />
              <div className="flex-1 relative bg-white dark:bg-slate-900 rounded-2xl shadow-skeuo-inner border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
                <Textarea 
                  placeholder="Редактируйте блоки, вставляйте изображения, видео, SVG анимацию, меняйте дизайн."
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleGenerate())}
                  onPaste={handlePaste}
                  className="min-h-[80px] max-h-[500px] resize-y rounded-2xl border-none bg-transparent font-medium pl-4 pr-20 py-4 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                  disabled={isGenerating}
                  data-testid="input-prompt"
                />
                <div className="absolute right-2 bottom-2 flex items-center gap-1">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isGenerating}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all disabled:opacity-40"
                    data-testid="button-upload-image"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleGenerate()}
                    disabled={isGenerating || (!prompt.trim() && attachedImages.length === 0)}
                    className="h-8 w-8 rounded-lg flex items-center justify-center bg-primary text-white shadow-sm hover:bg-primary/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    data-testid="button-send"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
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

        <SkeuoPanel className="flex-1 relative bg-slate-100 dark:bg-black flex flex-col overflow-hidden">
            <div className="flex items-center gap-1 px-4 pt-3 pb-1 overflow-x-auto shrink-0">
              {allFiles.map(f => (
                <div key={f.filename} className={`flex items-center gap-0.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeFile === f.filename ? "bg-primary text-white shadow-md" : "bg-white/60 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700"}`}>
                  <button
                    onClick={() => { if (isGenerating) return; setActiveFile(f.filename); if (f.filename === "index.html") setStreamedCode(""); }}
                    className="flex items-center gap-1.5 px-3 py-1.5"
                    disabled={isGenerating && activeFile !== f.filename}
                    data-testid={`tab-file-${f.filename}`}
                  >
                    <FileText className="w-3 h-3" />
                    {f.filename}
                  </button>
                  {f.filename !== "index.html" && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Удалить страницу ${f.filename}?`)) return;
                        const fileId = projectFiles.find(pf => pf.filename === f.filename)?.id;
                        if (!fileId) return;
                        await fetch(`/api/projects/${projectId}/files/${fileId}`, { method: "DELETE", credentials: "include" });
                        if (activeFile === f.filename) setActiveFile("index.html");
                        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] });
                      }}
                      className={`pr-2 pl-0.5 py-1.5 opacity-60 hover:opacity-100 transition-opacity`}
                      title={`Удалить ${f.filename}`}
                      data-testid={`button-delete-file-${f.filename}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => setAddPageOpen(true)}
                className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-primary hover:bg-white dark:hover:bg-slate-700 transition-all shrink-0"
                title="Добавить страницу"
                data-testid="button-add-page"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          <div className="flex-1 p-4 overflow-hidden">
            {showCode ? (
              <div className="w-full h-full p-6 bg-slate-900 rounded-[1.5rem] shadow-skeuo-inner overflow-auto">
                <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap">{currentCode || "// Тут будет код"}</pre>
              </div>
            ) : currentCode ? (
              <div className="w-full h-full flex items-center justify-center overflow-hidden">
                 <div className="bg-white rounded-2xl shadow-2xl transition-all duration-500 overflow-hidden border border-white/20" style={{ width: deviceWidths[previewDevice], height: '100%' }}>
                    <iframe key={selectorMode ? 'sel' : editMode ? 'edit' : 'view'} ref={iframeRef} srcDoc={getEditableCode(currentCode)} className="w-full h-full border-none" sandbox="allow-scripts allow-same-origin allow-forms" />
                 </div>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[#0b0f19] rounded-2xl overflow-hidden">
                <style dangerouslySetInnerHTML={{ __html: `
                  .nz-robot-float{animation:nzFloat 4s infinite ease-in-out;transform-origin:center}
                  @keyframes nzFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
                  .nz-pupil{animation:nzScan 3s infinite ease-in-out}
                  @keyframes nzScan{0%,100%{transform:translateX(-2px)}50%{transform:translateX(3px)}}
                  .nz-eye-blink{animation:nzBlink 4s infinite;transform-origin:center}
                  @keyframes nzBlink{0%,46%,48%,100%{transform:scaleY(1)}47%{transform:scaleY(.1)}}
                  .nz-hand-left{animation:nzTapL .5s infinite linear}
                  .nz-hand-right{animation:nzTapR .6s infinite linear}
                  @keyframes nzTapL{0%,50%,100%{transform:translateY(0)}25%{transform:translateY(5px) rotate(-5deg)}}
                  @keyframes nzTapR{0%,40%,100%{transform:translateY(0)}20%{transform:translateY(6px) rotate(5deg)}70%{transform:translateY(3px) rotate(2deg)}}
                  .nz-kp1{animation:nzKP .4s infinite alternate}
                  .nz-kp2{animation:nzKP .7s infinite alternate-reverse}
                  .nz-kp3{animation:nzKP .5s infinite alternate}
                  @keyframes nzKP{0%{opacity:0}100%{opacity:.8}}
                  .nz-antenna-glow{animation:nzPulseG 2s infinite ease-in-out}
                  @keyframes nzPulseG{0%,100%{fill:#38bdf8;filter:drop-shadow(0 0 2px #38bdf8)}50%{fill:#bae6fd;filter:drop-shadow(0 0 10px #38bdf8)}}
                  .nz-data-stream{animation:nzStream .5s linear infinite}
                  @keyframes nzStream{to{stroke-dashoffset:-12}}
                  .nz-code-group{animation:nzCodeFade 6s infinite}
                  @keyframes nzCodeFade{0%,85%{opacity:1}90%,98%{opacity:0}100%{opacity:1}}
                  .nz-m1{animation:nzT1 6s infinite linear}
                  @keyframes nzT1{0%{width:0}15%,90%{width:220px}95%,100%{width:0}}
                  .nz-m2{animation:nzT2 6s infinite linear}
                  @keyframes nzT2{0%,15%{width:0}35%,90%{width:200px}95%,100%{width:0}}
                  .nz-m3{animation:nzT3 6s infinite linear}
                  @keyframes nzT3{0%,35%{width:0}50%,90%{width:230px}95%,100%{width:0}}
                  .nz-m4{animation:nzT4 6s infinite linear}
                  @keyframes nzT4{0%,50%{width:0}60%,90%{width:170px}95%,100%{width:0}}
                  .nz-m5{animation:nzT5 6s infinite linear}
                  @keyframes nzT5{0%,60%{width:0}70%,90%{width:50px}95%,100%{width:0}}
                  .nz-cursor{width:10px;height:20px;fill:#e2e8f0}
                  .nz-c1{animation:nzC1 6s infinite linear}
                  @keyframes nzC1{0%{transform:translate(310px,215px);opacity:1}15%{transform:translate(520px,215px);opacity:1}15.01%,100%{opacity:0}}
                  .nz-c2{animation:nzC2 6s infinite linear}
                  @keyframes nzC2{0%,14.99%{opacity:0}15%{transform:translate(310px,250px);opacity:1}35%{transform:translate(500px,250px);opacity:1}35.01%,100%{opacity:0}}
                  .nz-c3{animation:nzC3 6s infinite linear}
                  @keyframes nzC3{0%,34.99%{opacity:0}35%{transform:translate(350px,285px);opacity:1}50%{transform:translate(570px,285px);opacity:1}50.01%,100%{opacity:0}}
                  .nz-c4{animation:nzC4 6s infinite linear}
                  @keyframes nzC4{0%,49.99%{opacity:0}50%{transform:translate(350px,320px);opacity:1}60%{transform:translate(510px,320px);opacity:1}60.01%,100%{opacity:0}}
                  .nz-c5{animation:nzC5 6s infinite linear}
                  @keyframes nzC5{0%,59.99%{opacity:0}60%{transform:translate(310px,355px);opacity:1}70%{transform:translate(350px,355px);opacity:1}72%{transform:translate(350px,355px);opacity:0}74%{opacity:1}76%{opacity:0}78%{opacity:1}80%{opacity:0}82%{opacity:1}85%,100%{opacity:0}}
                  .nz-dot1{animation:nzD1 1.5s infinite}
                  .nz-dot2{animation:nzD2 1.5s infinite}
                  .nz-dot3{animation:nzD3 1.5s infinite}
                  @keyframes nzD1{0%,100%{opacity:0}20%,80%{opacity:1}}
                  @keyframes nzD2{0%,100%{opacity:0}40%,80%{opacity:1}}
                  @keyframes nzD3{0%,100%{opacity:0}60%,80%{opacity:1}}
                  .nz-progress-bar{animation:nzProg 6s infinite ease-out}
                  @keyframes nzProg{0%{width:0}80%,100%{width:300px}}
                ` }} />
                <svg viewBox="0 0 800 600" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style={{ maxWidth: 600 }}>
                  <defs>
                    <filter id="nz-glow-bg" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="25" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                    <filter id="nz-terminal-shadow" x="-10%" y="-10%" width="120%" height="120%">
                      <feDropShadow dx="0" dy="15" stdDeviation="15" floodColor="#000" floodOpacity="0.5" />
                    </filter>
                    <pattern id="nz-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5" opacity="0.5"/>
                    </pattern>
                    <mask id="nz-m1"><rect x="310" y="210" width="0" height="30" fill="white" className="nz-m1" /></mask>
                    <mask id="nz-m2"><rect x="310" y="245" width="0" height="30" fill="white" className="nz-m2" /></mask>
                    <mask id="nz-m3"><rect x="350" y="280" width="0" height="30" fill="white" className="nz-m3" /></mask>
                    <mask id="nz-m4"><rect x="350" y="315" width="0" height="30" fill="white" className="nz-m4" /></mask>
                    <mask id="nz-m5"><rect x="310" y="350" width="0" height="30" fill="white" className="nz-m5" /></mask>
                  </defs>
                  <rect width="800" height="600" fill="url(#nz-grid)" />
                  <rect x="250" y="140" width="480" height="320" rx="15" fill="#38bdf8" opacity="0.1" filter="url(#nz-glow-bg)" />
                  <g filter="url(#nz-terminal-shadow)">
                    <rect x="250" y="140" width="480" height="320" rx="12" fill="#111827" stroke="#1f2937" strokeWidth="2" />
                    <rect x="250" y="140" width="480" height="40" fill="#1f2937" />
                    <path d="M 250 160 L 250 180 L 730 180 L 730 160 Z" fill="#1f2937" />
                    <circle cx="275" cy="160" r="6" fill="#f43f5e" />
                    <circle cx="295" cy="160" r="6" fill="#fbbf24" />
                    <circle cx="315" cy="160" r="6" fill="#10b981" />
                    <text x="490" y="165" fill="#9ca3af" fontSize="14" fontFamily="monospace" textAnchor="middle">ai_agent.ts</text>
                    <g fontFamily="monospace" fontSize="14" fill="#4b5563" textAnchor="end">
                      <text x="285" y="230">1</text>
                      <text x="285" y="265">2</text>
                      <text x="285" y="300">3</text>
                      <text x="285" y="335">4</text>
                      <text x="285" y="370">5</text>
                    </g>
                    <line x1="300" y1="180" x2="300" y2="460" stroke="#1f2937" strokeWidth="1" />
                    <g className="nz-code-group">
                      <g mask="url(#nz-m1)">
                        <rect x="310" y="215" width="20" height="20" rx="4" fill="#34d399" />
                        <rect x="340" y="215" width="100" height="20" rx="4" fill="#34d399" opacity="0.8"/>
                        <rect x="450" y="215" width="60" height="20" rx="4" fill="#34d399" opacity="0.6"/>
                      </g>
                      <g mask="url(#nz-m2)">
                        <rect x="310" y="250" width="70" height="20" rx="4" fill="#cba6f7" />
                        <rect x="390" y="250" width="80" height="20" rx="4" fill="#60a5fa" />
                        <rect x="480" y="250" width="20" height="20" rx="4" fill="#fbbf24" />
                      </g>
                      <g mask="url(#nz-m3)">
                        <rect x="350" y="285" width="40" height="20" rx="4" fill="#cba6f7" />
                        <rect x="400" y="285" width="40" height="20" rx="4" fill="#e2e8f0" />
                        <rect x="450" y="290" width="10" height="10" fill="#f472b6" />
                        <rect x="470" y="285" width="90" height="20" rx="4" fill="#34d399" />
                      </g>
                      <g mask="url(#nz-m4)">
                        <rect x="350" y="320" width="50" height="20" rx="4" fill="#cba6f7" />
                        <rect x="410" y="320" width="50" height="20" rx="4" fill="#60a5fa" />
                        <rect x="470" y="320" width="40" height="20" rx="4" fill="#e2e8f0" />
                      </g>
                      <g mask="url(#nz-m5)">
                        <rect x="310" y="355" width="20" height="20" rx="4" fill="#fbbf24" />
                      </g>
                    </g>
                    <rect className="nz-cursor nz-c1" />
                    <rect className="nz-cursor nz-c2" />
                    <rect className="nz-cursor nz-c3" />
                    <rect className="nz-cursor nz-c4" />
                    <rect className="nz-cursor nz-c5" />
                  </g>
                  <path d="M 200 340 L 250 340" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="6, 6" opacity="0.6" className="nz-data-stream" />
                  <g className="nz-robot-float">
                    <line x1="120" y1="200" x2="120" y2="150" stroke="#475569" strokeWidth="4" strokeLinecap="round"/>
                    <circle cx="120" cy="150" r="8" fill="#38bdf8" className="nz-antenna-glow"/>
                    <rect x="70" y="200" width="100" height="90" rx="20" fill="#64748b" />
                    <rect x="80" y="215" width="80" height="50" rx="10" fill="#030712" />
                    <g className="nz-eye-blink">
                      <circle cx="100" cy="240" r="7" fill="#0ea5e9" />
                      <circle cx="100" cy="240" r="3" fill="#e0f2fe" className="nz-pupil" style={{ transformOrigin: '100px 240px' }}/>
                      <circle cx="140" cy="240" r="7" fill="#0ea5e9" />
                      <circle cx="140" cy="240" r="3" fill="#e0f2fe" className="nz-pupil" style={{ transformOrigin: '140px 240px' }}/>
                    </g>
                    <g opacity="0.8">
                      <polygon points="40,340 200,340 220,360 20,360" fill="#0f172a" stroke="#38bdf8" strokeWidth="1.5" />
                      <line x1="60" y1="345" x2="200" y2="345" stroke="#38bdf8" strokeWidth="1" opacity="0.3" />
                      <line x1="50" y1="350" x2="210" y2="350" stroke="#38bdf8" strokeWidth="1" opacity="0.3" />
                      <line x1="40" y1="355" x2="220" y2="355" stroke="#38bdf8" strokeWidth="1" opacity="0.3" />
                      <rect x="80" y="347" width="12" height="4" fill="#38bdf8" className="nz-kp1" />
                      <rect x="130" y="352" width="15" height="4" fill="#38bdf8" className="nz-kp2" />
                      <rect x="100" y="342" width="10" height="4" fill="#38bdf8" className="nz-kp3" />
                    </g>
                    <g className="nz-hand-left" style={{ transformOrigin: '90px 320px' }}>
                      <rect x="80" y="315" width="25" height="12" rx="6" fill="#94a3b8" />
                    </g>
                    <g className="nz-hand-right" style={{ transformOrigin: '140px 320px' }}>
                      <rect x="135" y="315" width="25" height="12" rx="6" fill="#94a3b8" />
                    </g>
                  </g>
                  <text x="400" y="520" fill="#cbd5e1" fontSize="18" fontWeight="500" letterSpacing="1" textAnchor="middle">
                    {generationStatus || "ИИ-агент пишет код"}
                    <tspan className="nz-dot1">.</tspan>
                    <tspan className="nz-dot2">.</tspan>
                    <tspan className="nz-dot3">.</tspan>
                  </text>
                  <rect x="250" y="540" width="300" height="4" rx="2" fill="#1e293b" />
                  <rect x="250" y="540" width="0" height="4" rx="2" fill="#38bdf8" className="nz-progress-bar" />
                </svg>
              </div>
            )}
          </div>
        </SkeuoPanel>
      </div>

      <Dialog open={imgGenOpen} onOpenChange={setImgGenOpen}>
        <DialogContent className="sm:max-w-md p-0 bg-[#0c0c0f] border border-white/[0.08] shadow-[0_24px_80px_rgba(0,0,0,0.6)] rounded-2xl max-h-[85vh] overflow-hidden" aria-describedby="img-gen-description">
          <div className="relative overflow-y-auto max-h-[85vh]">
            <div className="sticky top-0 z-10 bg-[#0c0c0f]/90 backdrop-blur-xl border-b border-white/[0.06] px-6 py-5">
              <DialogHeader>
                <DialogTitle className="text-lg font-black tracking-tight text-white flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
                    <Wand2 className="w-4 h-4 text-white" />
                  </div>
                  AI Генератор
                </DialogTitle>
                <DialogDescription id="img-gen-description" className="text-white/40 text-sm mt-1">
                  Создайте уникальное изображение с помощью ИИ
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div>
                <label className="text-xs font-bold text-white/50 uppercase tracking-wider mb-2 block">Название</label>
                <Input
                  placeholder="баннер, логотип, фон..."
                  value={imgName}
                  onChange={e => setImgName(e.target.value)}
                  className="rounded-xl bg-white/[0.05] border-white/[0.08] text-white placeholder:text-white/25 focus:border-violet-500/50 focus:ring-violet-500/20 h-11"
                  disabled={imgGenerating}
                  data-testid="input-image-name"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-white/50 uppercase tracking-wider mb-2 block">Описание</label>
                <Textarea
                  placeholder="Опишите что должно быть на изображении..."
                  value={imgPrompt}
                  onChange={e => setImgPrompt(e.target.value)}
                  className="min-h-[90px] rounded-xl bg-white/[0.05] border-white/[0.08] text-white placeholder:text-white/25 focus:border-violet-500/50 focus:ring-violet-500/20 resize-none"
                  disabled={imgGenerating}
                  data-testid="input-image-prompt"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-white/50 uppercase tracking-wider mb-2 block">Формат</label>
                <Select value={imgSize} onValueChange={setImgSize} disabled={imgGenerating}>
                  <SelectTrigger className="rounded-xl bg-white/[0.05] border-white/[0.08] text-white h-11" data-testid="select-image-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a1f] border-white/[0.08] text-white">
                    <SelectItem value="16:9">16:9 — Широкий</SelectItem>
                    <SelectItem value="1:1">1:1 — Квадрат</SelectItem>
                    <SelectItem value="4:3">4:3 — Стандарт</SelectItem>
                    <SelectItem value="3:2">3:2 — Фото</SelectItem>
                    <SelectItem value="9:16">9:16 — Вертикальный</SelectItem>
                    <SelectItem value="3:4">3:4 — Портрет</SelectItem>
                    <SelectItem value="21:9">21:9 — Ультраширокий</SelectItem>
                    <SelectItem value="auto">Авто</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="w-full rounded-xl font-bold h-12 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 transition-all border-0"
                onClick={handleGenerateImage}
                disabled={imgGenerating || !imgPrompt.trim() || !imgName.trim()}
                data-testid="button-generate-image"
              >
                {imgGenerating ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {imgStatus === "creating" ? "Создаём..." : "Генерируем..."}</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Сгенерировать</>
                )}
              </Button>

              {imgStatus === "waiting" && (
                <div className="flex items-center gap-3 p-4 bg-violet-500/[0.08] rounded-xl border border-violet-500/[0.15]">
                  <Loader2 className="w-5 h-5 animate-spin text-violet-400 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-violet-300">Генерация...</p>
                    <p className="text-xs text-violet-400/60">15–60 секунд</p>
                  </div>
                </div>
              )}

              {imgStatus === "fail" && (
                <div className="flex items-center gap-3 p-4 bg-red-500/[0.08] rounded-xl border border-red-500/[0.15]">
                  <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-red-300">Ошибка</p>
                    <p className="text-xs text-red-400/70">{imgError}</p>
                  </div>
                </div>
              )}

              {imgStatus === "success" && imgResultUrls.length > 0 && (
                <div className="space-y-4">
                  {imgResultUrls.map((url, i) => (
                    <div key={i} className="space-y-3">
                      <div className="relative rounded-xl overflow-hidden border border-white/[0.08]">
                        <img src={url} alt={imgName} className="w-full" data-testid={`img-result-${i}`} />
                        <div className="absolute top-3 left-3 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Готово
                        </div>
                      </div>
                      <Button
                        className="w-full rounded-xl font-bold h-11 bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 border-0"
                        onClick={() => handleSaveImage(url)}
                        data-testid={`button-save-image-${i}`}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Сохранить в библиотеку
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={imagePickerOpen} onOpenChange={setImagePickerOpen}>
        <DialogContent className="sm:max-w-lg p-0 bg-[#0c0c0f] border border-white/[0.08] shadow-[0_24px_80px_rgba(0,0,0,0.6)] rounded-2xl max-h-[85vh] overflow-hidden">
          <div className="px-6 py-5 border-b border-white/[0.06]">
            <DialogHeader>
              <DialogTitle className="text-lg font-black text-white flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                  <ImageIcon className="w-4 h-4 text-white" />
                </div>
                Выбор изображения
              </DialogTitle>
              <DialogDescription className="text-white/40 text-sm mt-1">Библиотека или загрузка с компьютера</DialogDescription>
            </DialogHeader>

            <div className="flex gap-1.5 mt-4 bg-white/[0.04] rounded-xl p-1">
              <button
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${imagePickerTab === "library" ? "bg-white/[0.1] text-white shadow-sm" : "text-white/40 hover:text-white/60"}`}
                onClick={() => setImagePickerTab("library")}
                data-testid="button-picker-library"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                Библиотека
                {projectImages.length > 0 && <span className="text-[10px] bg-violet-500/30 text-violet-300 px-1.5 py-0.5 rounded-full">{projectImages.length}</span>}
              </button>
              <button
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${imagePickerTab === "upload" ? "bg-white/[0.1] text-white shadow-sm" : "text-white/40 hover:text-white/60"}`}
                onClick={() => setImagePickerTab("upload")}
                data-testid="button-picker-upload"
              >
                <Download className="w-3.5 h-3.5" />
                Загрузка
              </button>
            </div>
          </div>

          <div className="px-6 py-5 overflow-y-auto max-h-[50vh]">
            {imagePickerTab === "library" ? (
              <>
                {projectImages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 text-white/30">
                    <div className="w-16 h-16 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-4">
                      <ImageIcon className="w-8 h-8 opacity-40" />
                    </div>
                    <p className="text-sm font-bold text-white/50">Пока пусто</p>
                    <p className="text-xs mt-1 text-white/30">Сгенерируйте через AI Фото</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {projectImages.map((img) => (
                      <button
                        key={img.id}
                        className="group relative rounded-xl overflow-hidden border border-white/[0.06] hover:border-violet-500/50 transition-all cursor-pointer aspect-video bg-white/[0.03] hover:scale-[1.02]"
                        onClick={() => applyImageToIframe(img.url)}
                        data-testid={`picker-image-${img.id}`}
                      >
                        <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all flex items-end">
                          <p className="text-white text-xs font-bold p-2.5 truncate w-full">{img.name}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 border border-dashed border-white/[0.1] rounded-2xl bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                <input
                  ref={replaceFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleReplaceFileUpload}
                  className="hidden"
                />
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center mb-4">
                  <Download className="w-6 h-6 text-cyan-400" />
                </div>
                <p className="text-sm font-bold text-white/60 mb-1">Загрузить с компьютера</p>
                <p className="text-xs text-white/30 mb-5">PNG, JPG, WEBP</p>
                <Button
                  className="rounded-xl font-bold bg-white/[0.08] hover:bg-white/[0.12] text-white border border-white/[0.1] shadow-none"
                  onClick={() => replaceFileInputRef.current?.click()}
                  data-testid="button-picker-file-upload"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Выбрать файл
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={addPageOpen} onOpenChange={setAddPageOpen}>
        <DialogContent className="sm:max-w-sm" aria-describedby="add-page-description">
          <DialogHeader>
            <DialogTitle>Новая страница</DialogTitle>
            <DialogDescription id="add-page-description">Введите имя файла для новой страницы</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <div className="flex items-center gap-2">
              <Input
                value={newPageName}
                onChange={(e) => setNewPageName(e.target.value)}
                placeholder="about"
                className="flex-1"
                data-testid="input-new-page-name"
                onKeyDown={(e) => { if (e.key === "Enter") handleAddPage(); }}
              />
              <span className="text-sm text-muted-foreground">.html</span>
            </div>
            <Button onClick={handleAddPage} disabled={!newPageName.trim()} data-testid="button-confirm-add-page">
              <Plus className="w-4 h-4 mr-2" />
              Создать
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Favicon Crop Modal */}
      {faviconCropOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onMouseMove={onCropMouseMove} onMouseUp={() => setCropDrag(null)} onMouseLeave={() => setCropDrag(null)}>
          <div style={{ background: "#1a1a2e", borderRadius: 20, padding: 24, width: 520, maxWidth: "95vw", boxShadow: "0 25px 80px rgba(0,0,0,0.6)" }}>
            <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#fff", marginBottom: 6 }}>Обрезать фавикон</div>
            <div style={{ color: "#aaa", fontSize: "0.8rem", marginBottom: 16 }}>Перетащите квадрат в нужное место. Потяните за угол — изменить размер.</div>
            <div ref={cropContainerRef} style={{ position: "relative", width: "100%", aspectRatio: "1/1", overflow: "hidden", borderRadius: 12, background: "#000", cursor: cropDrag?.mode === "move" ? "grabbing" : "default" }}>
              <img ref={cropImgRef} src={faviconRawSrc} onLoad={() => {
                if (cropContainerRef.current) {
                  const r = cropContainerRef.current.getBoundingClientRect();
                  const s = Math.min(r.width, r.height) * 0.8;
                  setCropBox({ x: (r.width - s) / 2, y: (r.height - s) / 2, size: s });
                }
              }} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", userSelect: "none", pointerEvents: "none" }} alt="" />
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", pointerEvents: "none" }} />
              <div
                onMouseDown={(e) => onCropMouseDown(e, "move")}
                style={{
                  position: "absolute",
                  left: cropBox.x, top: cropBox.y,
                  width: cropBox.size, height: cropBox.size,
                  border: "2px solid #fff",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                  cursor: "grab",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ position: "absolute", inset: 0, background: "transparent" }} />
                <div onMouseDown={(e) => { e.stopPropagation(); onCropMouseDown(e, "resize"); }}
                  style={{ position: "absolute", bottom: -6, right: -6, width: 16, height: 16, background: "#fff", borderRadius: 4, cursor: "se-resize", boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }} />
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", color: "rgba(255,255,255,0.6)", fontSize: "0.65rem", pointerEvents: "none", whiteSpace: "nowrap" }}>
                  {Math.round(cropBox.size)} × {Math.round(cropBox.size)}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <Button variant="outline" onClick={() => setFaviconCropOpen(false)} style={{ borderRadius: 10 }}>Отмена</Button>
              <Button onClick={applyFaviconCrop} style={{ borderRadius: 10, background: "linear-gradient(135deg,#667eea,#764ba2)", border: "none" }}>
                Сохранить фавикон
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Publish Modal */}
      <Dialog open={showPublishModal} onOpenChange={setShowPublishModal}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden" style={{ borderRadius: 24 }}>
          <div style={{ background: "linear-gradient(135deg,#0f0c29,#302b63,#24243e)", padding: "2rem 2rem 1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ExternalLink className="w-5 h-5 text-white" />
              </div>
              <div>
                <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#fff", letterSpacing: "-0.025em" }}>Публикация сайта</div>
                <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>Vercel Global CDN</div>
              </div>
            </div>
          </div>

          <div style={{ padding: "1.5rem 2rem 2rem" }}>
            {!publishResult && !isPublishing && !publishError && !project?.publishedUrl && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <p style={{ fontSize: "0.88rem", color: "#555", lineHeight: 1.6 }}>
                  Сайт будет опубликован на глобальной CDN Vercel. Вы получите постоянную ссылку, которую можно сразу отправить клиентам.
                </p>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <Button variant="outline" onClick={() => setShowPublishModal(false)} style={{ flex: 1 }}>Отмена</Button>
                  <Button onClick={handlePublish} style={{ flex: 2, background: "linear-gradient(135deg,#667eea,#764ba2)", border: "none" }} data-testid="button-confirm-publish">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Опубликовать
                  </Button>
                </div>
              </div>
            )}

            {!publishResult && !isPublishing && !publishError && project?.publishedUrl && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "#16a34a" }}>
                  <CheckCircle2 className="w-5 h-5" />
                  <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Сайт опубликован</span>
                </div>
                <div style={{ background: "#f8f8f8", borderRadius: 12, padding: "0.75rem 1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <a href={project.publishedUrl} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: "0.82rem", color: "#007AFF", wordBreak: "break-all" }}>{project.publishedUrl}</a>
                  <button
                    onClick={() => handleCopyUrl(project.publishedUrl!)}
                    style={{ flexShrink: 0, padding: "0.4rem 0.7rem", borderRadius: 8, border: "1px solid #e5e7eb", background: copied ? "#f0fdf4" : "#fff", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, color: copied ? "#16a34a" : "#555", transition: "all 0.2s" }}
                  >
                    {copied ? "Скопировано!" : "Копировать"}
                  </button>
                </div>

                <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "1rem" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#333", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    Свой домен
                    {domainResult && domainVerified === true && (
                      <span style={{ fontSize: "0.72rem", color: "#16a34a", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", display: "inline-block", boxShadow: "0 0 6px #22c55e" }} />
                        Подключён
                      </span>
                    )}
                    {domainResult && domainVerified !== true && (
                      <span style={{ fontSize: "0.72rem", color: "#f59e0b", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", display: "inline-block", boxShadow: "0 0 6px #f59e0b" }} />
                        Добавлен
                      </span>
                    )}
                  </div>
                  {!domainResult ? (
                    <>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <input
                          type="text"
                          placeholder="example.ru"
                          value={customDomain}
                          onChange={(e) => setCustomDomain(e.target.value)}
                          style={{ flex: 1, padding: "0.5rem 0.75rem", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: "0.85rem", outline: "none" }}
                          data-testid="input-custom-domain"
                        />
                        <Button
                          size="sm"
                          onClick={handleAddDomain}
                          disabled={domainAdding || !customDomain.trim()}
                          style={{ borderRadius: 10, fontSize: "0.8rem" }}
                          data-testid="button-add-domain"
                        >
                          {domainAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : "Привязать"}
                        </Button>
                      </div>
                      {domainError && (
                        <div style={{ marginTop: 8, fontSize: "0.78rem", color: "#dc2626" }}>{domainError}</div>
                      )}
                    </>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "0.75rem 1rem" }}>
                        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#1d4ed8", marginBottom: 8 }}>Настройка DNS для <a href={`https://${customDomain}`} target="_blank" rel="noreferrer" style={{ color: "#1d4ed8", textDecoration: "underline", cursor: "pointer" }}>{customDomain}</a></div>
                        <div style={{ fontSize: "0.78rem", color: "#374151", lineHeight: 1.8 }}>
                          <div><b>1.</b> Откройте <a href="https://www.reg.ru/user/domain-list" target="_blank" rel="noreferrer" style={{ color: "#1d4ed8", textDecoration: "underline" }}>reg.ru</a> → <b>Домены</b> → выберите <b>{customDomain}</b></div>
                          <div><b>2.</b> Раздел «<b>DNS-серверы и управление зоной</b>» → «<b>Изменить</b>»</div>
                          <div><b>3.</b> Выберите «<b>Свой список DNS-серверов</b>» и укажите:</div>
                          <div style={{ background: "#f1f5f9", borderRadius: 8, padding: "0.5rem 0.75rem", margin: "6px 0", fontFamily: "monospace", fontSize: "0.76rem" }}>
                            <div><b>ns1.vercel-dns.com</b></div>
                            <div><b>ns2.vercel-dns.com</b></div>
                          </div>
                          <div style={{ color: "#6b7280", fontSize: "0.72rem", marginTop: 4 }}>Vercel сам настроит все записи и SSL-сертификат. DNS обновляется от 5 минут до 24 часов.</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCheckDomain}
                          disabled={domainChecking}
                          style={{ borderRadius: 10, fontSize: "0.78rem" }}
                          data-testid="button-check-domain"
                        >
                          {domainChecking ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                          Проверить DNS
                        </Button>
                        {domainChecking === false && domainVerified === false && (
                          <span style={{ fontSize: "0.75rem", color: "#f59e0b", fontWeight: 500 }}>DNS ещё не обновился</span>
                        )}
                        {domainChecking === false && domainVerified === true && (
                          <span style={{ fontSize: "0.75rem", color: "#16a34a", fontWeight: 500 }}>Домен работает!</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <Button variant="outline" onClick={() => window.open(project.publishedUrl!, "_blank")} style={{ flex: 1 }}>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Открыть сайт
                  </Button>
                  <Button onClick={handlePublish} style={{ flex: 1, background: "linear-gradient(135deg,#667eea,#764ba2)", border: "none" }} data-testid="button-confirm-publish">
                    Обновить сайт
                  </Button>
                </div>
              </div>
            )}

            {isPublishing && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "1rem 0" }}>
                <Loader2 className="w-10 h-10 animate-spin" style={{ color: "#764ba2" }} />
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 700, color: "#1D1D1F", marginBottom: 4 }}>Публикуем сайт…</div>
                  <div style={{ fontSize: "0.82rem", color: "#86868B" }}>Загружаем файлы на Vercel CDN</div>
                </div>
              </div>
            )}

            {publishResult && !isPublishing && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "#16a34a" }}>
                  <CheckCircle2 className="w-5 h-5" />
                  <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Сайт опубликован!</span>
                </div>
                <div style={{ background: "#f8f8f8", borderRadius: 12, padding: "0.75rem 1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <a href={publishResult} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: "0.82rem", color: "#007AFF", wordBreak: "break-all" }}>{publishResult}</a>
                  <button
                    onClick={() => handleCopyUrl(publishResult)}
                    style={{ flexShrink: 0, padding: "0.4rem 0.7rem", borderRadius: 8, border: "1px solid #e5e7eb", background: copied ? "#f0fdf4" : "#fff", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, color: copied ? "#16a34a" : "#555", transition: "all 0.2s" }}
                  >
                    {copied ? "Скопировано!" : "Копировать"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <Button variant="outline" onClick={() => setShowPublishModal(false)} style={{ flex: 1 }}>Закрыть</Button>
                  <Button
                    onClick={() => window.open(publishResult, "_blank")}
                    style={{ flex: 1, background: "linear-gradient(135deg,#667eea,#764ba2)", border: "none" }}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Открыть сайт
                  </Button>
                </div>
              </div>
            )}

            {publishError && !isPublishing && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "#dc2626" }}>
                  <XCircle className="w-5 h-5" />
                  <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Ошибка публикации</span>
                </div>
                <div style={{ background: "#fef2f2", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.82rem", color: "#dc2626" }}>{publishError}</div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <Button variant="outline" onClick={() => setShowPublishModal(false)} style={{ flex: 1 }}>Закрыть</Button>
                  <Button onClick={handlePublish} style={{ flex: 1 }}>Повторить</Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
