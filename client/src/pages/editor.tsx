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
  History,
  Clock,
  FileText,
  Plus,
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
  const [streamingReply, setStreamingReply] = useState("");
  const [editMode, setEditMode] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingImageTarget = useRef<string | null>(null);

  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [imagePickerTab, setImagePickerTab] = useState<"library" | "upload">("library");
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

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

  const { data: versions = [] } = useQuery<ProjectVersion[]>({
    queryKey: ["/api/projects", projectId, "versions"],
  });

  const [showVersions, setShowVersions] = useState(false);

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
    setStreamingReply("");
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

              const firstFileMarker = fullText.indexOf("--- FILE:");
              const htmlBlockStart = fullText.indexOf("```html\n");

              if (firstFileMarker > 0 && (htmlBlockStart === -1 || firstFileMarker < htmlBlockStart)) {
                const textBefore = fullText.substring(0, firstFileMarker).trim();
                if (textBefore) setStreamingReply(textBefore);
              } else if (htmlBlockStart > 0) {
                const textBefore = fullText.substring(0, htmlBlockStart).trim();
                if (textBefore) setStreamingReply(textBefore);
              }

              const indexFileMatch = fullText.match(/---\s*FILE:\s*index\.html\s*---\s*\n?\s*```html\s*\n?([\s\S]*?)```/i);
              if (indexFileMatch) {
                setStreamedCode(indexFileMatch[1].trim());
              } else if (firstFileMarker !== -1) {
                const indexMarkerMatch = fullText.match(/---\s*FILE:\s*index\.html\s*---\s*\n?\s*```html\s*\n?([\s\S]*)/i);
                if (indexMarkerMatch) {
                  const partialCode = indexMarkerMatch[1].trim();
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
            if (data.done && data.code) {
              setGenerationStatus(null);
              setStreamedCode(data.code);
              setActiveFile("index.html");
              queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] });
              queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
            }
            if (data.error) {
              toast({ title: "Ошибка генерации", description: data.error, variant: "destructive" });
            }
          }
        }
      }

      setImageBase64(null);
      setImagePreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "versions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, projectId, imageBase64, toast]);

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
        for (const [remoteUrl, localPath] of allImageUrls) {
          pfCode = pfCode.split(remoteUrl).join(localPath);
        }
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
    if(!href||href==='#') return;
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
    if (!editMode || !code) return injectProjectId(code);
    const editorScript = `<!--NZ_EDITOR_START--><style data-nz-editor>
[contenteditable]:hover{outline:2px dashed rgba(59,130,246,0.5);outline-offset:2px;cursor:text}
[contenteditable]:focus{outline:2px solid rgba(59,130,246,0.8);outline-offset:2px;background:rgba(59,130,246,0.05)}
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
      el.addEventListener('mouseenter',function(){showTip(el,'Клик для редактирования')});
      el.addEventListener('mouseleave',hideTip);
      el.addEventListener('blur',function(){
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
  }, [editMode, injectProjectId]);

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
        const filename = e.data.filename;
        setActiveFile(filename);
        if (filename === "index.html") setStreamedCode("");
      }
      if (e.data.type === 'nz-img-click' || e.data.type === 'nz-placeholder-click') {
        pendingImageTarget.current = e.data.path;
        setImagePickerTab("library");
        setImagePickerOpen(true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [projectId, activeFile, allFiles]);

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
            <div className="flex items-center gap-2">
              {versions.length > 0 && (
                <Button
                  variant={showVersions ? "default" : "outline"}
                  size="sm"
                  className="h-7 rounded-lg text-xs gap-1.5"
                  onClick={() => setShowVersions(!showVersions)}
                  data-testid="button-toggle-versions"
                >
                  <History className="w-3.5 h-3.5" />
                  {versions.length}
                </Button>
              )}
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
          <ScrollArea className="flex-1 px-6">
            <div className="py-6 space-y-6">
              {messages.map((msg, idx) => {
                const isModel = msg.role === "model";
                const isLatestModel = isModel && !messages.slice(idx + 1).some(m => m.role === "model");
                return (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[90%] rounded-2xl p-4 text-sm font-medium shadow-skeuo-md ${msg.role === "user" ? "bg-primary text-white" : "bg-white dark:bg-slate-800"}`}>
                      {msg.role === "user" ? msg.content : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 mb-1">
                            <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span className="text-primary font-black text-[11px]">Gemini</span>
                            {isLatestModel && (
                              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[10px] px-1.5 py-0 rounded-full">текущий</Badge>
                            )}
                          </div>
                          <p className="text-slate-700 dark:text-slate-300 text-[13px] leading-relaxed">{msg.content.startsWith("<!") || msg.content.startsWith("<html") ? "Сайт обновлён" : msg.content}</p>
                        </div>
                      )}
                    </div>
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

        <SkeuoPanel className="flex-1 relative bg-slate-100 dark:bg-black flex flex-col overflow-hidden">
          {allFiles.length > 1 && (
            <div className="flex items-center gap-1 px-4 pt-3 pb-1 overflow-x-auto shrink-0">
              {allFiles.map(f => (
                <button
                  key={f.filename}
                  onClick={() => { setActiveFile(f.filename); if (f.filename === "index.html") setStreamedCode(""); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeFile === f.filename ? "bg-primary text-white shadow-md" : "bg-white/60 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700"}`}
                  data-testid={`tab-file-${f.filename}`}
                >
                  <FileText className="w-3 h-3" />
                  {f.filename}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 p-4 overflow-hidden">
            {showCode ? (
              <div className="w-full h-full p-6 bg-slate-900 rounded-[1.5rem] shadow-skeuo-inner overflow-auto">
                <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap">{currentCode || "// Тут будет код"}</pre>
              </div>
            ) : currentCode ? (
              <div className="w-full h-full flex items-center justify-center overflow-hidden">
                 <div className="bg-white rounded-2xl shadow-2xl transition-all duration-500 overflow-hidden border border-white/20" style={{ width: deviceWidths[previewDevice], height: '100%' }}>
                    <iframe ref={iframeRef} srcDoc={getEditableCode(currentCode)} className="w-full h-full border-none" sandbox="allow-scripts allow-same-origin allow-forms" />
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

    </div>
  );
}
