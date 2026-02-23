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
  Upload,
  Image,
} from "lucide-react";

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
      setTimeout(() => {
        handleGenerate(initialPrompt);
      }, 500);
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

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Ошибка генерации");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let fullText = "";
      let finalCode = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullText += data.content;
                let htmlCode = fullText;
                const htmlMatch = fullText.match(/```html\n?([\s\S]*?)```/);
                if (htmlMatch) {
                  htmlCode = htmlMatch[1].trim();
                } else if (fullText.includes("<!DOCTYPE") || fullText.includes("<html")) {
                  htmlCode = fullText.trim();
                }
                setStreamedCode(htmlCode);
              }
              if (data.done && data.code) {
                finalCode = data.code;
                setStreamedCode(data.code);
              }
              if (data.error) {
                toast({ title: "Ошибка", description: data.error, variant: "destructive" });
              }
            } catch {}
          }
        }
      }

      setImageBase64(null);
      setImagePreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    } catch (err: any) {
      toast({ title: "Ошибка генерации", description: err.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, projectId, imageBase64, toast]);

  const handleDownloadZip = async () => {
    if (!currentCode) return;

    const zip = new JSZip();
    zip.file("index.html", currentCode);

    const cssMatch = currentCode.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    const jsMatch = currentCode.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);

    if (cssMatch) {
      const allCss = cssMatch.map((s: string) => s.replace(/<\/?style[^>]*>/gi, "")).join("\n\n");
      zip.file("styles.css", allCss);
    }
    if (jsMatch) {
      const allJs = jsMatch.map((s: string) => s.replace(/<\/?script[^>]*>/gi, "")).join("\n\n");
      zip.file("script.js", allJs);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.title || "website"}.zip`;
    a.click();
    URL.revokeObjectURL(url);

    toast({ title: "Архив скачан" });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImagePreview(result);
      const base64 = result.split(",")[1];
      setImageBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const deviceWidths = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  if (projectLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col">
      <header className="h-14 border-b flex items-center justify-between gap-2 px-4 shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/dashboard")} data-testid="button-back-dashboard">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm truncate max-w-[200px]" data-testid="text-project-title">
            {project?.title || "Проект"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="hidden sm:flex items-center border rounded-md p-0.5 gap-0.5">
            {[
              { device: "desktop" as const, icon: Monitor },
              { device: "tablet" as const, icon: Tablet },
              { device: "mobile" as const, icon: Smartphone },
            ].map(({ device, icon: Icon }) => (
              <Button
                key={device}
                variant={previewDevice === device ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setPreviewDevice(device)}
                data-testid={`button-device-${device}`}
              >
                <Icon className="w-3.5 h-3.5" />
              </Button>
            ))}
          </div>

          <Button
            variant={showCode ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowCode(!showCode)}
            data-testid="button-toggle-code"
          >
            {showCode ? <Eye className="w-3.5 h-3.5 mr-1.5" /> : <Code2 className="w-3.5 h-3.5 mr-1.5" />}
            {showCode ? "Превью" : "Код"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadZip}
            disabled={!currentCode}
            data-testid="button-download-zip"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            ZIP
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              toast({
                title: "Публикация",
                description: "Функция публикации будет доступна в ближайшем обновлении. Пока вы можете скачать ZIP-архив и разместить сайт на любом хостинге.",
              });
            }}
            data-testid="button-publish"
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Опубликовать
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-full sm:w-[380px] lg:w-[420px] border-r flex flex-col shrink-0">
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-4">
                {messages.length === 0 && !isGenerating && (
                  <div className="text-center py-12">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                      <Sparkles className="w-6 h-6 text-primary" />
                    </div>
                    <h3 className="font-semibold mb-1">Начните создание</h3>
                    <p className="text-sm text-muted-foreground max-w-[240px] mx-auto">
                      Опишите сайт, который хотите создать, или загрузите скриншот-пример
                    </p>
                  </div>
                )}

                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    data-testid={`message-${msg.id}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg p-3 text-sm ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50"
                      }`}
                    >
                      {msg.role === "user" ? (
                        msg.content
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 shrink-0" />
                          <span>Сайт сгенерирован</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isGenerating && (
                  <div className="flex justify-start">
                    <div className="bg-muted/50 rounded-lg p-3 text-sm flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      <span>Генерация сайта...</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
          </div>

          <div className="border-t p-3 space-y-2">
            {imagePreview && (
              <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-md">
                <img src={imagePreview} alt="Preview" className="w-10 h-10 rounded object-cover" />
                <span className="text-xs text-muted-foreground flex-1 truncate">Изображение прикреплено</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => { setImageBase64(null); setImagePreview(null); }}
                >
                  <span className="text-xs">x</span>
                </Button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                data-testid="input-image-upload"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={isGenerating}
                data-testid="button-upload-image"
              >
                <Image className="w-4 h-4" />
              </Button>
              <Textarea
                placeholder="Опишите сайт или изменения..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                className="resize-none min-h-[40px] flex-1"
                disabled={isGenerating}
                data-testid="input-chat-prompt"
              />
              <Button
                size="icon"
                onClick={() => handleGenerate()}
                disabled={isGenerating || (!prompt.trim() && !imageBase64)}
                data-testid="button-send-prompt"
              >
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 bg-muted/10 flex items-center justify-center p-4 overflow-hidden">
          {showCode ? (
            <div className="w-full h-full overflow-auto">
              <pre className="text-xs font-mono p-4 bg-card rounded-lg border whitespace-pre-wrap break-all h-full overflow-auto">
                <code data-testid="text-generated-code">{currentCode || "Код пока не сгенерирован"}</code>
              </pre>
            </div>
          ) : currentCode ? (
            <div
              className="bg-white rounded-lg shadow-lg overflow-hidden transition-all duration-300"
              style={{
                width: deviceWidths[previewDevice],
                maxWidth: "100%",
                height: "100%",
              }}
            >
              <iframe
                srcDoc={currentCode}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin"
                title="Preview"
                data-testid="iframe-preview"
              />
            </div>
          ) : (
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                <Eye className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <h3 className="font-semibold mb-1 text-muted-foreground">Превью</h3>
              <p className="text-sm text-muted-foreground/70">
                Здесь появится предпросмотр сайта после генерации
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
