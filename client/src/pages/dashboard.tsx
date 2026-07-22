import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Project } from "@shared/schema";
import {
  Plus,
  Sparkles,
  LogOut,
  Code2,
  Trash2,
  Calendar,
  Loader2,
  FolderOpen,
  Coins,
  Inbox,
  Wand2,
  Globe,
  Search,
  Upload,
  ImageIcon,
  X,
} from "lucide-react";
import { useRef, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { STYLE_PICKER_BY_CATEGORY, type UITemplate } from "@/components/ui-templates";

function StyleTemplateCard({ tmpl, isCard, onClick }: { tmpl: UITemplate; isCard: boolean; onClick: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [hovered, setHovered] = useState(false);

  const triggerHover = useCallback((enter: boolean) => {
    setHovered(enter);
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument) return;
    const allEls = iframe.contentDocument.querySelectorAll("button, a, div, span, [class]");
    allEls.forEach(el => {
      if (enter) {
        el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        (el as HTMLElement).classList.add("hover");
      } else {
        el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        (el as HTMLElement).classList.remove("hover");
      }
    });
  }, []);

  const previewHtml = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box;}html,body{height:100%;overflow:hidden;}body{display:flex;align-items:center;justify-content:center;min-height:100%;background:#f5f5f7;font-family:system-ui,sans-serif;}${tmpl.css.replace(/:hover/g, ':hover,.hover')}</style></head><body>${tmpl.html}</body></html>`;

  return (
    <div
      data-testid={`button-style-template-${tmpl.id}`}
      className="group relative rounded-xl overflow-hidden cursor-pointer"
      style={{ background: '#f5f5f7', border: hovered ? '1.5px solid rgba(0,0,0,0.18)' : '1.5px solid rgba(0,0,0,0.07)', boxShadow: hovered ? '0 4px 16px rgba(0,0,0,0.08)' : 'none', transition: 'border-color 0.2s, box-shadow 0.2s' }}
      onClick={onClick}
      onMouseEnter={() => triggerHover(true)}
      onMouseLeave={() => triggerHover(false)}
    >
      <div style={{ height: isCard ? 180 : 160, overflow: 'hidden', position: 'relative' }}>
        <iframe
          ref={iframeRef}
          srcDoc={previewHtml}
          style={isCard ? { width: '200%', height: '200%', border: 'none', pointerEvents: 'none', transform: 'scale(0.5)', transformOrigin: 'top left' } : { width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
          sandbox="allow-same-origin"
          title={tmpl.name}
        />
      </div>
      <div style={{ padding: '0.6rem 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(0,0,0,0.06)', background: '#fff' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1D1D1F' }}>{tmpl.name}</span>
        <span style={{ fontSize: '0.65rem', color: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: 4 }}>&lt;/&gt; выбрать</span>
      </div>
    </div>
  );
}

interface TourStep {
  target: string;
  title: string;
  text: string;
  position?: "top" | "bottom" | "left" | "right";
}

const CHOOSE_TOUR_STEPS: TourStep[] = [
  { target: '[data-tour="mode-photo"]', title: "Профессионал", text: "Загрузите референсы (скриншот дизайна и/или фото товара) — ИИ вдохновится ими и создаст свой профессиональный сайт.", position: "bottom" },
  { target: '[data-tour="mode-prompt"]', title: "По описанию", text: "Просто напишите текстом, что вам нужно — ИИ сделает сайт по вашему описанию.", position: "bottom" },
  { target: '[data-tour="mode-interactive"]', title: "Интерактивный", text: "Сайт с кинематографичной анимацией, которая разворачивается по мере прокрутки.", position: "bottom" },
];

const PHOTO_TOUR_STEPS: TourStep[] = [
  { target: '[data-tour="photo-title"]', title: "Название", text: "Задайте имя проекта, чтобы легко найти его на дашборде.", position: "bottom" },
  { target: '[data-tour="photo-desc"]', title: "Описание", text: "Добавьте инструкции: замените текст, укажите язык, опишите желаемые изменения.", position: "bottom" },
  { target: '[data-tour="photo-upload"]', title: "Загрузите скриншот", text: "Перетащите скриншот или макет сайта. ИИ воссоздаст его дизайн.", position: "left" },
  { target: '[data-tour="photo-ai-gen"]', title: "AI генератор макетов", text: "Нет скриншота? Опишите дизайн — ИИ нарисует макет для вас (15 токенов).", position: "left" },
  { target: '[data-tour="photo-create"]', title: "Создать проект", text: "Нажмите, чтобы запустить генерацию сайта. ИИ создаст готовый HTML/CSS/JS код.", position: "top" },
];

function TourTooltip({ steps, currentStep, onNext, onPrev, onClose }: {
  steps: TourStep[];
  currentStep: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; arrowSide: string } | null>(null);
  const step = steps[currentStep];

  useEffect(() => {
    if (!step) return;
    const tryPosition = () => {
      const el = document.querySelector(step.target);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const tooltipW = 280;
      const tooltipH = 140;
      const gap = 12;
      let top = 0;
      let left = 0;
      let arrowSide = "top";
      const preferBottom = window.innerWidth < 640 && (step.position === "left" || step.position === "right");
      const effectivePos = preferBottom ? "bottom" : step.position;

      if (effectivePos === "bottom") {
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2 - tooltipW / 2;
        arrowSide = "top";
      } else if (effectivePos === "top") {
        top = rect.top - tooltipH - gap;
        left = rect.left + rect.width / 2 - tooltipW / 2;
        arrowSide = "bottom";
      } else if (effectivePos === "left") {
        top = rect.top + rect.height / 2 - tooltipH / 2;
        left = rect.left - tooltipW - gap;
        arrowSide = "right";
      } else {
        top = rect.top + rect.height / 2 - tooltipH / 2;
        left = rect.right + gap;
        arrowSide = "left";
      }

      left = Math.max(8, Math.min(left, window.innerWidth - tooltipW - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - tooltipH - 8));
      setPos({ top, left, arrowSide });

      el.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    };
    const timer = setTimeout(tryPosition, 150);
    return () => clearTimeout(timer);
  }, [step, currentStep]);

  if (!step || !pos) return null;

  const arrowStyles: Record<string, any> = {
    top: { top: -6, left: '50%', transform: 'translateX(-50%) rotate(45deg)' },
    bottom: { bottom: -6, left: '50%', transform: 'translateX(-50%) rotate(45deg)' },
    left: { left: -6, top: '50%', transform: 'translateY(-50%) rotate(45deg)' },
    right: { right: -6, top: '50%', transform: 'translateY(-50%) rotate(45deg)' },
  };

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      />
      <div
        style={{
          position: 'fixed', top: pos.top, left: pos.left, width: 280,
          zIndex: 9999, background: '#fff', borderRadius: 14,
          boxShadow: '0 12px 40px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1)',
          padding: '16px 18px', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
          animation: 'tourFadeIn 0.25s ease-out', pointerEvents: 'all',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ position: 'absolute', width: 12, height: 12, background: '#fff', boxShadow: '-1px -1px 2px rgba(0,0,0,0.06)', ...arrowStyles[pos.arrowSide] }} />
        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1D1D1F', marginBottom: 6, letterSpacing: '-0.02em' }}>{step.title}</div>
        <div style={{ fontSize: '0.78rem', color: '#6B6B70', lineHeight: 1.5, marginBottom: 14 }}>{step.text}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {steps.map((_, i) => (
              <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i === currentStep ? '#007AFF' : '#E0E0E0', transition: 'background 0.2s' }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {currentStep > 0 && (
              <button
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onPrev(); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', color: '#86868B', fontWeight: 500, padding: '4px 0' }}
              >
                Назад
              </button>
            )}
            <button
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onNext(); }}
              style={{
                background: '#007AFF', color: '#fff', border: 'none', cursor: 'pointer',
                fontSize: '0.78rem', fontWeight: 600, padding: '6px 16px', borderRadius: 20,
              }}
            >
              {currentStep < steps.length - 1 ? "Далее" : "Готово"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const GlassCard = ({ children, className = "", onClick = undefined }: { children: any; className?: string; onClick?: any }) => (
  <div
    onClick={onClick}
    style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif' }}
    className={`bg-white/60 backdrop-blur-xl border border-white/40 shadow-[0_8px_40px_rgba(0,0,0,0.06)] hover:shadow-[0_16px_60px_rgba(0,0,0,0.10)] transition-all duration-500 rounded-[2rem] p-6 ${onClick ? 'cursor-pointer hover:-translate-y-1 active:scale-[0.98]' : ''} ${className}`}
  >
    {children}
  </div>
);

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createStep, setCreateStep] = useState<"choose" | "templates" | "details">("choose");
  const [selectedMode, setSelectedMode] = useState<"prompt" | "interactive" | "photo">("prompt");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedStyleTemplate, setSelectedStyleTemplate] = useState<UITemplate | null>(null);
  const [styleCategory, setStyleCategory] = useState("buttons");
  const [isEnhanced, setIsEnhanced] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  const [researchData, setResearchData] = useState("");
  const [showDeepResearchPopup, setShowDeepResearchPopup] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState<number | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [multiPageEnabled, setMultiPageEnabled] = useState(false);
  const [pageNames, setPageNames] = useState<string[]>(["О нас", "Услуги", "Контакты"]);
  const [seoEnabled, setSeoEnabled] = useState(false);
  const [creatingSeo, setCreatingSeo] = useState(false);
  const [leadFormEnabled, setLeadFormEnabled] = useState(true);
  const [agentVersion, setAgentVersion] = useState<"v1" | "v2">("v2");
  const [seoH1, setSeoH1] = useState("");
  const [seoH2s, setSeoH2s] = useState<string[]>(["", ""]);
  const [photoImages, setPhotoImages] = useState<Array<{ base64: string; mimeType: string; preview: string }>>([]);
  const [interactiveStyle, setInteractiveStyle] = useState<"parallax" | "split" | "action" | "immersion" | "site3d" | "motion">("parallax");
  const [interactiveProductImage, setInteractiveProductImage] = useState<{ base64: string; mimeType: string; preview: string } | null>(null);
  const [tourStep, setTourStep] = useState(-1);
  const [activeTour, setActiveTour] = useState<TourStep[] | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const interactiveProductImgRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get("payment");
    if (paymentStatus === "success") {
      toast({ title: "Оплата прошла успешно!", description: "Токены будут начислены в течение минуты" });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      window.history.replaceState({}, "", "/dashboard");
    } else if (paymentStatus === "failed") {
      toast({ title: "Оплата не прошла", description: "Попробуйте ещё раз или выберите другой способ", variant: "destructive" });
      window.history.replaceState({}, "", "/dashboard");
    }
  }, []);

  useEffect(() => {
    if (!showCreateModal) { setActiveTour(null); setTourStep(-1); return; }
    const seenChoose = localStorage.getItem("tour_choose_seen");
    if (createStep === "choose" && !seenChoose) {
      const t = setTimeout(() => { setActiveTour(CHOOSE_TOUR_STEPS); setTourStep(0); }, 600);
      return () => clearTimeout(t);
    }
    const seenPhoto = localStorage.getItem("tour_photo_seen");
    if (createStep === "details" && selectedMode === "photo" && !seenPhoto) {
      const t = setTimeout(() => { setActiveTour(PHOTO_TOUR_STEPS); setTourStep(0); }, 500);
      return () => clearTimeout(t);
    }
  }, [showCreateModal, createStep, selectedMode]);
  const [mockupPrompt, setMockupPrompt] = useState("");
  const [mockupGenerating, setMockupGenerating] = useState(false);

  const cachedProjects = useMemo<Project[] | undefined>(() => {
    try {
      const raw = localStorage.getItem("craft_projects_cache");
      return raw ? JSON.parse(raw) : undefined;
    } catch { return undefined; }
  }, []);

  const { data: userProjects = [], isLoading, isFetching } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
    placeholderData: cachedProjects,
  });

  useEffect(() => {
    if (userProjects.length > 0 && !isFetching) {
      try { localStorage.setItem("craft_projects_cache", JSON.stringify(userProjects)); } catch {}
    }
  }, [userProjects, isFetching]);

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/leads/unread-count"],
    refetchInterval: 30000,
  });

  const resetCreateState = () => {
    setCreateStep("choose");
    setTitle("");
    setDescription("");
    setIsEnhanced(false);
    setResearchData("");
    setMultiPageEnabled(false);
    setPageNames(["О нас", "Услуги", "Контакты"]);
    setSeoEnabled(false);
    setSeoH1("");
    setSeoH2s(["", ""]);
    setPhotoImages([]);
    setInteractiveProductImage(null);
    setSelectedStyleTemplate(null);
    setSelectedTemplate("");
    setStyleCategory("buttons");
    setSelectedMode("prompt");
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      // Upload assets BEFORE creating/navigating so failures keep the modal usable
      let mockupUrls: string[] = [];
      if (selectedMode === "photo" && photoImages.length > 0) {
        for (const img of photoImages) {
          const uploadResp = await fetch("/api/upload-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base64: img.base64, mimeType: img.mimeType, name: "mockup" }),
            credentials: "include",
          });
          const uploadData = await uploadResp.json();
          if (!uploadResp.ok) throw new Error(uploadData.message || "Не удалось загрузить изображения");
          mockupUrls.push(uploadData.url);
        }
      }
      let productUrl = "";
      if (selectedMode === "interactive" && interactiveProductImage) {
        const uploadResp = await fetch("/api/upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64: interactiveProductImage.base64, mimeType: interactiveProductImage.mimeType, name: "product-ref" }),
          credentials: "include",
        });
        const uploadData = await uploadResp.json();
        if (!uploadResp.ok) throw new Error(uploadData.message || "Не удалось загрузить фото продукта");
        productUrl = uploadData.url;
      }

      const res = await apiRequest("POST", "/api/projects", {
        title: title || "Новый проект",
        description: description || null,
      });
      const project = await res.json();
      return { project, mockupUrls, productUrl };
    },
    onSuccess: async ({ project, mockupUrls, productUrl }: { project: Project; mockupUrls: string[]; productUrl: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      const prompt = selectedMode === "photo"
        ? (description || (photoImages.length > 0 ? "Создай профессиональный сайт, вдохновляясь приложенными референсами" : "Создай стильный профессиональный сайт"))
        : description || title;
      const interactiveParam = selectedMode === "interactive"
        ? `&interactive=1&istyle=${interactiveStyle}`
        : "";
      const enhancedParam = isEnhanced ? "&enhanced=1" : "";
      const researchParam = researchData ? `&research=${encodeURIComponent(researchData)}` : "";
      const multiPageParam = (multiPageEnabled && pageNames.filter(p => p.trim()).length > 0)
        ? `&multipages=${encodeURIComponent(pageNames.filter(p => p.trim()).join(","))}`
        : "";
      const seoParam = (seoEnabled && seoH1.trim())
        ? `&seoh1=${encodeURIComponent(seoH1.trim())}&seoh2s=${encodeURIComponent(seoH2s.filter(h => h.trim()).join(","))}`
        : "";
      const leadFormParam = leadFormEnabled ? "" : "&leadform=0";
      const agentParam = `&agent=${agentVersion}`;
      const mockupParam = mockupUrls.length > 0
        ? `&mockup=1&mockupUrls=${encodeURIComponent(mockupUrls.join(","))}`
        : "";
      const iProductParam = productUrl ? `&iproductUrl=${encodeURIComponent(productUrl)}` : "";
      setShowCreateModal(false);
      resetCreateState();
      setLocation(`/editor/${project.id}?prompt=${encodeURIComponent(prompt)}${interactiveParam}${enhancedParam}${researchParam}${multiPageParam}${seoParam}${leadFormParam}${agentParam}${mockupParam}${iProductParam}`);
    },
    onError: (err: any) => {
      toast({
        title: "Не удалось создать сайт",
        description: err?.message || "Попробуйте ещё раз",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/projects/${id}`);
    },
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ["/api/projects"] });
      const previous = queryClient.getQueryData<Project[]>(["/api/projects"]);
      queryClient.setQueryData<Project[]>(["/api/projects"], (old) =>
        (old || []).filter((p) => p.id !== id)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(["/api/projects"], context.previous);
      toast({ title: "Не удалось удалить", variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: "Удалено" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    },
  });

  const appleFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
  const isMobile = useIsMobile();
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMobile || !showProfile) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfile(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [isMobile, showProfile]);

  return (
    <div className="min-h-screen relative overflow-x-hidden" style={{ background: '#FBFBFD', fontFamily: appleFont, display: 'flex', flexDirection: 'column' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        :root { --rainbow-grad: linear-gradient(90deg, #FF4242, #A5FF42, #42A5FF, #42E6FF, #B742FF, #FF4242); }
        @keyframes db-rainbow { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
        .db-magic-btn {
          display: inline-flex; align-items: center; justify-content: center;
          white-space: nowrap; border-radius: 0.5rem; font-size: 0.9rem; font-weight: 500;
          transition: transform 0.2s ease, opacity 0.2s ease; cursor: pointer;
          position: relative; color: #1D1D1F; text-decoration: none;
          height: 2.5rem; padding: 0 1.1rem; z-index: 1;
          border: 1.3px solid transparent;
          background: linear-gradient(#fff, #fff) padding-box, var(--rainbow-grad) border-box;
          background-size: 200% auto; animation: db-rainbow 3s linear infinite;
        }
        @media (max-width: 639px) {
          .db-magic-btn { height: 2.25rem; padding: 0 0.75rem; font-size: 0.8rem; }
          .db-tpl-layout { flex-direction: column !important; height: min(85dvh, 720px) !important; min-height: 0 !important; }
          .db-tpl-sidebar { width: 100% !important; border-right: none !important; border-bottom: 1px solid rgba(0,0,0,0.07) !important; padding: 0.75rem 0 !important; max-height: none !important; }
          .db-tpl-cats { flex-direction: row !important; overflow-x: auto !important; gap: 0.35rem !important; padding: 0 0.75rem !important; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
          .db-tpl-cats::-webkit-scrollbar { display: none; }
          .db-tpl-cats button { width: auto !important; flex-shrink: 0; white-space: nowrap; }
          .db-tpl-back { display: none !important; }
          .db-tpl-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .db-topup-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 0.75rem !important; }
          .db-topup-pad { padding: 1.25rem 1rem 1.5rem !important; }
          .topup-m2card { padding: 1.25rem 0.75rem !important; border-radius: 18px !important; }
          .topup-m2card span[style*="2.2rem"] { font-size: 1.5rem !important; }
          .db-create-pad { padding: 1.25rem 1rem !important; min-height: 0 !important; }
          .db-mode-card { min-height: 0 !important; padding: 1.1rem 1rem !important; flex-direction: row !important; text-align: left !important; align-items: center !important; gap: 0.85rem; }
          .db-mode-card .db-mode-icon { margin-bottom: 0 !important; width: 44px !important; height: 44px !important; flex-shrink: 0; }
          .db-mode-card h3 { margin-bottom: 2px !important; font-size: 0.95rem !important; }
          .db-mode-card p { font-size: 0.75rem !important; }
          .db-details-grid { grid-template-columns: 1fr !important; }
          .db-hit-badge { top: -10px !important; right: 10px !important; left: auto !important; transform: none !important; font-size: 0.62rem !important; padding: 0.22rem 0.65rem !important; }
        }
        @keyframes db-hit-shimmer {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        .db-hit-badge {
          position: absolute;
          top: -12px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 3;
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0.14em;
          padding: 0.28rem 0.85rem;
          border-radius: 999px;
          color: #0b3a5c;
          border: 1px solid rgba(255,255,255,0.65);
          box-shadow: 0 4px 14px rgba(56, 189, 248, 0.35), inset 0 1px 0 rgba(255,255,255,0.7);
          background: linear-gradient(
            110deg,
            #7dd3fc 0%,
            #bae6fd 22%,
            #e2e8f0 38%,
            #38bdf8 55%,
            #f8fafc 72%,
            #7dd3fc 100%
          );
          background-size: 220% 100%;
          animation: db-hit-shimmer 2.4s linear infinite;
          white-space: nowrap;
          pointer-events: none;
        }
        .db-magic-btn::before {
          content: ''; position: absolute; bottom: -20%; left: 50%; z-index: -1;
          height: 20%; width: 60%; transform: translateX(-50%);
          background: var(--rainbow-grad); background-size: 200% auto;
          animation: db-rainbow 3s linear infinite; filter: blur(12px);
        }
        .db-magic-btn:hover { transform: scale(1.05); }
        .db-magic-btn:active { transform: scale(0.95); }
        .db-enhance-btn {
          border: 1.3px solid transparent;
          background: linear-gradient(#fff, #fff) padding-box, var(--rainbow-grad) border-box;
          background-size: 200% auto; animation: db-rainbow 3s linear infinite;
          color: #1D1D1F !important;
        }
        .db-enhance-btn::before {
          content: ''; position: absolute; bottom: -20%; left: 50%; z-index: -1;
          height: 20%; width: 60%; transform: translateX(-50%);
          background: var(--rainbow-grad); background-size: 200% auto;
          animation: db-rainbow 3s linear infinite; filter: blur(10px);
        }
      ` }} />
      {/* Ambient glows matching landing page */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[60%] pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(66,165,255,0.07) 0%, transparent 70%)' }} />
      <div className="absolute top-0 left-0 right-0 h-px pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent, rgba(66,165,255,0.3), rgba(181,66,255,0.3), transparent)' }} />

      {/* Header — matching landing page nav */}
      <header className="fixed top-0 left-0 right-0 z-50" style={{ padding: '0.75rem 0', transition: 'all 0.3s', background: 'rgba(251,251,253,0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 flex items-center justify-between gap-2">
          {/* Logo identical to landing page */}
          <div className="flex items-center gap-2 sm:gap-2.5 cursor-pointer shrink-0" onClick={() => setLocation("/")}>
            <svg viewBox="0 0 32 32" stroke="currentColor" strokeWidth="2" fill="none" className="w-7 h-7 sm:w-8 sm:h-8 shrink-0">
              <defs>
                <linearGradient id="db-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%"><animate attributeName="stop-color" values="#FF4242;#A5FF42;#42A5FF;#42E6FF;#B742FF;#FF4242" dur="5s" repeatCount="indefinite"/></stop>
                  <stop offset="100%"><animate attributeName="stop-color" values="#B742FF;#FF4242;#A5FF42;#42A5FF;#42E6FF;#B742FF" dur="5s" repeatCount="indefinite"/></stop>
                </linearGradient>
              </defs>
              <rect x="4" y="4" width="24" height="18" rx="4" stroke="url(#db-logo-grad)"/>
              <circle cx="10" cy="10" r="1.5" fill="url(#db-logo-grad)" stroke="none"/>
              <circle cx="22" cy="10" r="1.5" fill="url(#db-logo-grad)" stroke="none"/>
              <path d="M12 16l-2 2 2 2 M20 16l2 2-2 2" stroke="url(#db-logo-grad)" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="15" y1="20" x2="17" y2="20" stroke="url(#db-logo-grad)" strokeLinecap="round"/>
              <path d="M8 26 h16 M10 28 h12" stroke="url(#db-logo-grad)" strokeLinecap="round"/>
            </svg>
            <span className="text-[0.95rem] sm:text-[1.1rem]" style={{ fontWeight: 700, letterSpacing: '-0.03em', color: '#1D1D1F' }}>Craft AI</span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
            <button
              onClick={() => setLocation("/leads")}
              data-testid="button-leads"
              className="relative flex items-center justify-center gap-2 transition-all shrink-0"
              style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 100, padding: isMobile ? '0.45rem' : '0.45rem 1.1rem', fontSize: '0.82rem', fontWeight: 600, color: '#1D1D1F', cursor: 'pointer', width: isMobile ? 36 : undefined, height: isMobile ? 36 : undefined }}
              title="Лиды"
            >
              <Inbox className="w-3.5 h-3.5" style={{ color: '#86868B' }} />
              <span className="hidden sm:inline">Лиды</span>
              {(unreadData?.count ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-white text-[10px] font-black rounded-full px-1" style={{ background: 'linear-gradient(135deg,#FF4242,#B742FF)' }}>
                  {unreadData!.count}
                </span>
              )}
            </button>

            <button
              onClick={() => setLocation("/generations")}
              data-testid="button-generations"
              className="flex items-center justify-center gap-2 transition-all shrink-0"
              style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 100, padding: isMobile ? '0.45rem' : '0.45rem 1.1rem', fontSize: '0.82rem', fontWeight: 600, color: '#1D1D1F', cursor: 'pointer', width: isMobile ? 36 : undefined, height: isMobile ? 36 : undefined }}
              title="Генерации"
            >
              <ImageIcon className="w-3.5 h-3.5" style={{ color: '#86868B' }} />
              <span className="hidden sm:inline">Генерации</span>
            </button>

            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0" style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 100, padding: isMobile ? '0.4rem 0.65rem' : '0.45rem 1.1rem' }}>
              <Coins className="w-3.5 h-3.5" style={{ color: '#86868B' }} />
              <span style={{ fontSize: isMobile ? '0.78rem' : '0.85rem', fontWeight: 700, color: '#1D1D1F' }}>{user?.credits ?? 0}</span>
              <span className="hidden sm:inline" style={{ fontSize: '0.65rem', fontWeight: 600, color: '#86868B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>токенов</span>
            </div>

            <button
              data-testid="button-topup"
              onClick={() => setShowTopUpModal(true)}
              className="db-magic-btn shrink-0"
            >
              {isMobile ? '+' : 'Пополнить'}
            </button>

            {/* Profile avatar button */}
            <div
              ref={profileMenuRef}
              style={{ position: 'relative' }}
              onMouseEnter={!isMobile ? () => setShowProfile(true) : undefined}
              onMouseLeave={!isMobile ? () => setShowProfile(false) : undefined}
            >
              <button
                data-testid="button-profile"
                onClick={() => {
                  if (isMobile) setShowProfile(v => !v);
                  else setLocation('/profile');
                }}
                style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid rgba(0,0,0,0.08)', overflow: 'hidden', cursor: 'pointer', background: 'linear-gradient(135deg,hsl(27deg 93% 60%),#00a6ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}
              >
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fff' }}>
                    {(user?.displayName || user?.email || 'U')[0].toUpperCase()}
                  </span>
                )}
              </button>

              <AnimatePresence>
                {showProfile && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 99, width: 210, background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 16px 48px rgba(0,0,0,0.12)', overflow: 'hidden', paddingTop: '0.35rem', paddingBottom: '0.35rem' }}
                  >
                    {[
                      { label: 'Профиль', icon: '👤', onClick: () => setLocation('/profile') },
                      { label: 'Реф программа', icon: '🎁', onClick: () => {} },
                      { label: 'Поддержка', icon: '💬', onClick: () => {} },
                    ].map((item, i) => (
                      <button
                        key={i}
                        onClick={() => { setShowProfile(false); item.onClick(); }}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0.9rem', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 500, color: '#1D1D1F', textAlign: 'left', fontFamily: appleFont }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span style={{ fontSize: '0.95rem' }}>{item.icon}</span>
                        {item.label}
                      </button>
                    ))}
                    <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '0.35rem 0' }} />
                    <button
                      onClick={async () => { setShowProfile(false); await logout(); setLocation("/auth"); }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0.9rem', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 500, color: '#FF3B30', textAlign: 'left', fontFamily: appleFont }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,59,48,0.05)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <LogOut size={14} />
                      Выйти
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: '5.5rem', flex: 1, paddingBottom: '3rem' }}>
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 sm:mb-12">
          <div className="min-w-0">
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#86868B', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
              Добро пожаловать, {user?.displayName || user?.email?.split('@')[0]}
            </p>
            <h1 style={{ fontSize: 'clamp(1.6rem,4vw,3rem)', fontWeight: 700, letterSpacing: '-0.04em', color: '#1D1D1F', lineHeight: 1.1, margin: 0 }}>
              Ваши проекты
            </h1>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-2.5 w-full sm:w-auto">
            <button
              disabled={creatingSeo}
              onClick={async () => {
                if (creatingSeo) return;
                setCreatingSeo(true);
                try {
                  const r = await fetch('/api/seo/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ title: 'SEO-сайт', niche: '' }) });
                  const d = await r.json();
                  if (d.project?.id) { setLocation(`/seo/${d.project.id}`); return; }
                  throw new Error('no id');
                } catch {
                  toast({ title: 'Не удалось создать SEO-сайт', variant: 'destructive' });
                  setCreatingSeo(false);
                }
              }}
              className="flex w-full sm:w-auto items-center justify-center gap-2 transition-all hover:-translate-y-0.5 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg,#1a1a3e,#312e81)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 16, padding: isMobile ? '0.75rem 1rem' : '0.85rem 1.4rem', fontSize: isMobile ? '0.8rem' : '0.88rem', fontWeight: 600, cursor: creatingSeo ? 'wait' : 'pointer', letterSpacing: '-0.01em', opacity: creatingSeo ? 0.7 : 1 }}
              title="Создать SEO-сайт из ключевых слов"
            >
              {creatingSeo ? <Loader2 className="w-4 h-4 animate-spin" /> : <span style={{ fontSize: '1rem' }}>📊</span>}
              {creatingSeo ? 'Создаём…' : 'SEO-машина'}
            </button>
            <button
              onClick={() => { resetCreateState(); setShowCreateModal(true); }}
              className="flex flex-1 sm:flex-none items-center justify-center gap-2 transition-all hover:-translate-y-0.5 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg,#1D1D1F,#3a3a3c)', color: '#fff', border: 'none', borderRadius: 16, padding: isMobile ? '0.75rem 1rem' : '0.85rem 1.6rem', fontSize: isMobile ? '0.8rem' : '0.9rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 8px 30px rgba(0,0,0,0.15)', letterSpacing: '-0.01em' }}
            >
              <Plus className="w-5 h-5" />
              Новый сайт
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: cachedProjects?.length || 3 }).map((_, i) => (
              <div key={i} className="rounded-[2rem] animate-pulse" style={{ height: 280, background: 'rgba(0,0,0,0.04)' }} />
            ))}
          </div>
        ) : userProjects.length === 0 ? (
          <GlassCard className="flex flex-col items-center justify-center py-16 sm:py-32 text-center space-y-6 sm:space-y-8">
            <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-[1.5rem] sm:rounded-[2rem] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.06)' }}>
              <FolderOpen className="w-8 h-8 sm:w-12 sm:h-12" style={{ color: 'rgba(0,0,0,0.12)' }} />
            </div>
            <div className="space-y-3">
              <h2 className="text-xl sm:text-[1.8rem]" style={{ fontWeight: 700, letterSpacing: '-0.03em', color: '#1D1D1F' }}>Пока здесь пусто</h2>
              <p style={{ color: '#86868B', maxWidth: 360, margin: '0 auto', fontSize: '1rem', lineHeight: 1.6 }}>Создайте свой первый проект, используя возможности искусственного интеллекта.</p>
            </div>
            <button onClick={() => { resetCreateState(); setShowCreateModal(true); }} className="transition-all hover:opacity-80" style={{ background: '#1D1D1F', color: '#fff', border: 'none', borderRadius: 14, padding: '0.85rem 2rem', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer' }}>
              Создать первый сайт
            </button>
          </GlassCard>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {userProjects.map((project) => (
              <div
                key={project.id}
                onClick={() => setLocation((project as any).type === "seo" ? `/seo/${project.id}` : `/editor/${project.id}`)}
                className="group cursor-pointer transition-all duration-500 hover:-translate-y-1.5"
                style={{ borderRadius: '2rem', overflow: 'hidden', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 20px rgba(0,0,0,0.04)', position: 'relative' }}
              >
                {/* Preview */}
                <div style={{ height: 220, position: 'relative', overflow: 'hidden', background: '#FBFBFD', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {project.generatedCode ? (
                    <div style={{ width: '100%', height: '100%', transform: 'scale(0.4)', transformOrigin: 'center', opacity: 0.7, transition: 'all 0.7s', filter: 'blur(1px)' }}
                      className="group-hover:opacity-100 group-hover:blur-none">
                      <iframe srcDoc={project.generatedCode} sandbox="" loading="lazy" className="border-none pointer-events-none" style={{ width: '250%', height: '250%' }} />
                    </div>
                  ) : (
                    <div style={{ width: 64, height: 64, borderRadius: 20, background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Code2 style={{ width: 32, height: 32, color: 'rgba(0,0,0,0.12)' }} />
                    </div>
                  )}
                  <div className="absolute inset-0 transition-opacity duration-500 group-hover:opacity-30" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.1) 100%)' }} />
                </div>

                {/* Info */}
                <div style={{ padding: '1.25rem 1.5rem 1.5rem', position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, #fff 70%, transparent)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <div style={{ minWidth: 0 }}>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="truncate transition-colors group-hover:text-[#0071e3]" style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.02em', color: '#1D1D1F' }}>
                          {project.title}
                        </h3>
                        {project.publishStatus === 'published' && (
                          <span style={{ flexShrink: 0, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 100, padding: '0.15rem 0.5rem' }}>
                            Live
                          </span>
                        )}
                        {project.publishStatus === 'suspended' && (
                          <span style={{ flexShrink: 0, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 100, padding: '0.15rem 0.5rem' }}>
                            Приостановлен
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5" style={{ fontSize: '0.72rem', fontWeight: 600, color: '#86868B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        <Calendar style={{ width: 11, height: 11 }} />
                        {new Date(project.createdAt).toLocaleDateString('ru-RU')}
                      </div>
                    </div>
                    <button
                      className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-300"
                      disabled={deleteMutation.isPending && deleteMutation.variables === project.id}
                      onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(project.id); }}
                      style={{ background: 'rgba(255,59,48,0.08)', border: 'none', borderRadius: 10, padding: '0.4rem', cursor: 'pointer', color: '#FF3B30', flexShrink: 0 }}
                    >
                      {deleteMutation.isPending && deleteMutation.variables === project.id
                        ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} />
                        : <Trash2 style={{ width: 16, height: 16 }} />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Dialog open={showCreateModal} onOpenChange={(open) => { if (!open && isResearching) return; setShowCreateModal(open); if (!open) { setResearchData(""); setDeepResearchEnabled(false); setIsResearching(false); } }}>
        <DialogContent className={`p-0 max-h-[92dvh] ${createStep === "templates" ? "overflow-hidden" : "overflow-y-auto"}`} style={{ width: '92vw', maxWidth: createStep === "templates" ? 1080 : 860, borderRadius: isMobile ? 20 : 24, border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 32px 80px rgba(0,0,0,0.12)', background: '#fff', fontFamily: appleFont, transition: 'max-width 0.3s ease' }}>
          <div className={createStep === "templates" ? undefined : "db-create-pad"} style={{ padding: createStep === "templates" ? '0' : (isMobile ? '1.25rem 1rem' : '2rem 2.5rem'), minHeight: createStep === "templates" ? 0 : (isMobile ? 0 : 440), display: 'flex', flexDirection: 'column' }}>
            {createStep !== "templates" && (
              <DialogHeader>
                <DialogTitle style={{ fontSize: isMobile ? '1.25rem' : '1.5rem', fontWeight: 700, letterSpacing: '-0.035em', color: '#1D1D1F', textAlign: 'center' }}>
                  {createStep === "choose" ? "С чего начнём?" : "Оживите мечту"}
                </DialogTitle>
              </DialogHeader>
            )}

            <AnimatePresence mode="wait">
              {createStep === "choose" ? (
                <motion.div key="c" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 flex-1 items-stretch sm:items-center" style={{ marginTop: isMobile ? 20 : 32 }}>
                  {[
                    {
                      m: "prompt",
                      t: "По описанию",
                      d: "Просто напишите, что вам нужно",
                      badge: null as string | null,
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8">
                          <g className="transition-transform duration-500 origin-center group-hover:scale-110">
                            <path d="M21 11.5C21.0034 12.8199 20.6951 14.1219 20.1 15.3C19.3944 16.7118 18.3098 17.8992 16.9674 18.7293C15.6251 19.5594 14.0782 19.9994 12.5 20C11.1702 19.9991 9.854 19.6905 8.66 19.1L3 21L4.9 15.34C4.30948 14.146 4.00085 12.8298 4 11.5C4.00061 9.92179 4.44061 8.37488 5.27072 7.03258C6.10083 5.69028 7.28825 4.6056 8.7 3.90003C9.87806 3.30491 11.1801 2.99658 12.5 3.00003H13C15.0843 3.11502 17.053 3.99479 18.5291 5.47089C20.0052 6.94699 20.885 8.91568 21 11V11.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500" />
                            <circle cx="8" cy="12" r="1.5" fill="currentColor" className="text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-75" />
                            <circle cx="12" cy="12" r="1.5" fill="currentColor" className="text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-150" />
                            <circle cx="16" cy="12" r="1.5" fill="currentColor" className="text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-[300ms]" />
                          </g>
                        </svg>
                      ),
                    },
                    {
                      m: "interactive",
                      t: "Интерактивный",
                      d: "Сайт с анимацией при скролле",
                      badge: "HIT" as string | null,
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8">
                          <g className="transition-transform duration-500 origin-center group-hover:scale-110">
                            <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" className="text-teal-500" />
                            <path d="M10 8.5L15.5 12L10 15.5V8.5Z" fill="currentColor" className="text-teal-600 transition-transform duration-500 group-hover:translate-x-[2px]" />
                            <path d="M3 9H6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-teal-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-75" />
                            <path d="M3 15H6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-teal-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-150" />
                          </g>
                        </svg>
                      ),
                    },
                    {
                      m: "photo",
                      t: "Профессионал",
                      d: "Референсы + ИИ-креатив",
                      badge: null as string | null,
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8">
                          <defs><clipPath id="pm"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></clipPath></defs>
                          <g className="transition-transform duration-500 origin-center group-hover:scale-110">
                            <g clipPath="url(#pm)">
                              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" className="text-purple-400 transition-all duration-500 origin-center group-hover:scale-[2.5] group-hover:text-yellow-400" />
                              <path d="M21 15L16 10L5 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-500/70" />
                              <path d="M5 21L14 12L21 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-600" />
                            </g>
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" strokeWidth="2" className="text-purple-500" />
                          </g>
                        </svg>
                      ),
                    },
                  ].map(x => (
                    <button
                      key={x.m}
                      data-testid={`button-create-${x.m}`}
                      data-tour={`mode-${x.m}`}
                      className="db-mode-card group flex flex-col items-center justify-center text-center transition-all duration-300 ease-out hover:-translate-y-1 focus:outline-none"
                      style={{ position: 'relative', padding: '2rem 1.5rem', borderRadius: 20, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', minHeight: 180 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 30px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,0,0,0.12)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.02)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,0,0,0.06)'; }}
                      onClick={() => { setSelectedMode(x.m as any); setCreateStep("details"); }}
                    >
                      {x.badge && <span className="db-hit-badge" data-testid="badge-interactive-hit">{x.badge}</span>}
                      <div className="db-mode-icon flex items-center justify-center mb-4" style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)' }}>
                        {x.icon}
                      </div>
                      <div className="min-w-0">
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#1D1D1F', marginBottom: 4, letterSpacing: '-0.02em' }}>{x.t}</h3>
                      <p style={{ fontSize: '0.82rem', color: '#86868B', fontWeight: 400, lineHeight: 1.4 }}>{x.d}</p>
                      </div>
                    </button>
                  ))}
                </motion.div>
              ) : createStep === "templates" ? (
                <motion.div key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="db-tpl-layout" style={{ display: 'flex', height: '80vh', minHeight: 520 }}>
                  <div className="db-tpl-sidebar" style={{ width: 200, borderRight: '1px solid rgba(0,0,0,0.07)', padding: '1.5rem 0', flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
                    <div style={{ padding: '0 1.25rem 1rem', fontSize: '1.05rem', fontWeight: 700, color: '#1D1D1F', letterSpacing: '-0.02em' }}>
                      Стили UI
                    </div>
                    <div className="db-tpl-cats flex flex-col gap-0.5" style={{ padding: '0 0.5rem', flex: 1 }}>
                      {STYLE_PICKER_BY_CATEGORY.map(cat => (
                        <button
                          key={cat.key}
                          onClick={() => setStyleCategory(cat.key)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.6rem',
                            padding: '0.6rem 0.75rem', borderRadius: 12, border: 'none',
                            background: styleCategory === cat.key ? 'rgba(0,0,0,0.06)' : 'transparent',
                            color: styleCategory === cat.key ? '#1D1D1F' : '#86868B',
                            fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                            transition: 'all 0.15s', width: '100%',
                          }}
                        >
                          <span style={{ fontSize: '1rem' }}>{cat.icon}</span>
                          <span>{cat.label}</span>
                          <span style={{ marginLeft: 'auto', fontSize: '0.72rem', fontWeight: 400, opacity: 0.5 }}>{cat.templates.length}</span>
                        </button>
                      ))}
                    </div>
                    <div className="db-tpl-back" style={{ padding: '1rem 0.75rem 0' }}>
                      <button
                        data-testid="button-templates-back"
                        onClick={() => setCreateStep("choose")}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem 0.75rem', fontSize: '0.8rem', fontWeight: 600, color: '#86868B', width: '100%', textAlign: 'left', borderRadius: 10 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#1D1D1F'; (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#86868B'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        ← Назад
                      </button>
                    </div>
                  </div>

                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ padding: isMobile ? '0.75rem 1rem' : '1rem 1.5rem', borderBottom: '1px solid rgba(0,0,0,0.07)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#1D1D1F', margin: 0 }}>
                          {STYLE_PICKER_BY_CATEGORY.find(c => c.key === styleCategory)?.label}
                        </h3>
                        <p style={{ fontSize: '0.72rem', color: '#86868B', margin: '0.15rem 0 0' }}>
                          {STYLE_PICKER_BY_CATEGORY.find(c => c.key === styleCategory)?.templates.length} шаблонов
                        </p>
                      </div>
                      {isMobile && (
                        <button
                          data-testid="button-templates-back-mobile"
                          onClick={() => setCreateStep("choose")}
                          style={{ background: 'rgba(0,0,0,0.04)', border: 'none', cursor: 'pointer', padding: '0.4rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, color: '#86868B', borderRadius: 10, flexShrink: 0 }}
                        >
                          ← Назад
                        </button>
                      )}
                    </div>
                    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? '0.85rem 1rem' : '1.25rem 1.5rem' }}>
                      <div className="db-tpl-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', paddingBottom: '1rem' }}>
                        {(STYLE_PICKER_BY_CATEGORY.find(c => c.key === styleCategory)?.templates || []).map(tmpl => (
                          <StyleTemplateCard
                            key={tmpl.id}
                            tmpl={tmpl}
                            isCard={styleCategory === 'cards'}
                            onClick={() => { setSelectedStyleTemplate(tmpl); setSelectedTemplate(tmpl.name); setCreateStep("details"); }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="d" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col flex-1" style={{ marginTop: 20 }}>
                  {selectedStyleTemplate && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: '0.72rem', color: '#86868B', fontWeight: 500 }}>Стиль:</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(0,122,255,0.08)', border: '1px solid rgba(0,122,255,0.2)', borderRadius: 8, padding: '3px 10px', fontSize: '0.72rem', fontWeight: 600, color: '#007AFF' }}>
                        {selectedStyleTemplate.name}
                        <button onClick={() => { setSelectedStyleTemplate(null); setSelectedTemplate(""); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: '#007AFF', opacity: 0.6, fontSize: '0.9rem', marginLeft: 2 }}>×</button>
                      </span>
                    </div>
                  )}
                  <div className="db-details-grid grid gap-4 sm:gap-6 flex-1" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <div className="flex flex-col gap-3">
                      <div className="space-y-1.5" data-tour="photo-title">
                        <Label style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#86868B', paddingLeft: 4 }}>Название</Label>
                        <Input
                          placeholder="Например: Моё кафе"
                          value={title}
                          onChange={e => setTitle(e.target.value)}
                          className="h-10 rounded-xl font-medium text-gray-900 placeholder:text-gray-400 text-sm"
                          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
                        />
                      </div>
                      <div className="space-y-1.5 flex-1 flex flex-col" data-tour="photo-desc">
                        <div className="flex items-center justify-between px-1">
                          <Label style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#86868B' }}>Описание</Label>
                          {isEnhanced && (
                            <span data-testid="text-enhanced-status" className="flex items-center gap-1" style={{ fontSize: '0.65rem', fontWeight: 600, color: '#34C759' }}>
                              <Sparkles className="w-3 h-3" /> Улучшено AI
                            </span>
                          )}
                        </div>
                        <Textarea
                          placeholder={
                            selectedMode === "photo"
                              ? "Сделай сайт как у референса, но с моим товаром"
                              : "Сайт SPA студии, в бежевых тонах, с картинкой в Hero секции, и плавной анимацией"
                          }
                          value={description}
                          onChange={e => { setDescription(e.target.value); if (isEnhanced) setIsEnhanced(false); }}
                          className="rounded-xl font-medium text-gray-900 placeholder:text-gray-400 text-sm flex-1"
                          style={{ background: isEnhanced ? 'rgba(52,199,89,0.04)' : 'rgba(0,0,0,0.03)', border: isEnhanced ? '1px solid rgba(52,199,89,0.3)' : '1px solid rgba(0,0,0,0.08)', resize: 'none', minHeight: selectedMode === "photo" ? 80 : 120 }}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-3">
                      {selectedMode === "interactive" ? (
                        <div className="flex flex-col gap-3 flex-1">
                          {/* Style picker */}
                          <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#86868B', paddingLeft: 4 }}>Стиль анимации</div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                            {[
                              {
                                id: "parallax" as const,
                                label: "Параллакс",
                                desc: "Видео на весь экран, текст поверх",
                                icon: (
                                  <svg viewBox="0 0 40 28" fill="none" className="w-10 h-7">
                                    <rect x="0" y="0" width="40" height="28" rx="4" fill="currentColor" opacity="0.08"/>
                                    <rect x="4" y="10" width="32" height="3" rx="1.5" fill="currentColor" opacity="0.4"/>
                                    <rect x="10" y="16" width="20" height="2" rx="1" fill="currentColor" opacity="0.25"/>
                                    <circle cx="20" cy="7" r="3" fill="currentColor" opacity="0.5"/>
                                  </svg>
                                ),
                              },
                              {
                                id: "split" as const,
                                label: "Сплит",
                                desc: "Текст слева, продукт справа",
                                icon: (
                                  <svg viewBox="0 0 40 28" fill="none" className="w-10 h-7">
                                    <rect x="0" y="0" width="18" height="28" rx="4" fill="currentColor" opacity="0.08"/>
                                    <rect x="22" y="0" width="18" height="28" rx="4" fill="currentColor" opacity="0.15"/>
                                    <rect x="3" y="10" width="12" height="2" rx="1" fill="currentColor" opacity="0.5"/>
                                    <rect x="3" y="14" width="9" height="1.5" rx="0.75" fill="currentColor" opacity="0.3"/>
                                    <circle cx="31" cy="14" r="5" fill="currentColor" opacity="0.4"/>
                                  </svg>
                                ),
                              },
                              {
                                id: "action" as const,
                                label: "Экшн",
                                desc: "Слоумо и облёт камеры",
                                icon: (
                                  <svg viewBox="0 0 40 28" fill="none" className="w-10 h-7">
                                    <rect x="0" y="0" width="40" height="28" rx="4" fill="currentColor" opacity="0.08"/>
                                    <circle cx="20" cy="14" r="4.5" fill="currentColor" opacity="0.5"/>
                                    <path d="M20 3 L20 6 M20 22 L20 25 M5 14 L8 14 M32 14 L35 14 M9.5 9.5 L11.6 11.6 M30.5 9.5 L28.4 11.6 M9.5 18.5 L11.6 16.4 M30.5 18.5 L28.4 16.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
                                  </svg>
                                ),
                              },
                              {
                                id: "immersion" as const,
                                label: "Погружение",
                                desc: "Видео-фон на весь сайт + glass",
                                icon: (
                                  <svg viewBox="0 0 40 28" fill="none" className="w-10 h-7">
                                    <rect x="0" y="0" width="40" height="28" rx="4" fill="currentColor" opacity="0.08"/>
                                    <ellipse cx="20" cy="16" rx="11" ry="6" fill="currentColor" opacity="0.12"/>
                                    <path d="M8 18 C12 10, 28 10, 32 18" stroke="currentColor" strokeWidth="1.4" fill="none" opacity="0.45"/>
                                    <circle cx="14" cy="14" r="1.6" fill="currentColor" opacity="0.55"/>
                                    <circle cx="20" cy="11" r="2" fill="currentColor" opacity="0.65"/>
                                    <circle cx="26" cy="14" r="1.6" fill="currentColor" opacity="0.55"/>
                                    <path d="M20 4 L20 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.4"/>
                                  </svg>
                                ),
                              },
                              {
                                id: "site3d" as const,
                                label: "3D",
                                desc: "Продукт на чёрном + scroll-scrub",
                                icon: (
                                  <svg viewBox="0 0 40 28" fill="none" className="w-10 h-7">
                                    <rect x="0" y="0" width="40" height="28" rx="4" fill="currentColor" opacity="0.08"/>
                                    <rect x="14" y="8" width="12" height="16" rx="2.5" fill="currentColor" opacity="0.35"/>
                                    <path d="M14 12 H26 M14 16 H26 M14 20 H22" stroke="currentColor" strokeWidth="1" opacity="0.25"/>
                                    <path d="M8 22 L12 10 L16 22" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.4"/>
                                    <path d="M24 22 L28 10 L32 22" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.4"/>
                                    <circle cx="20" cy="6" r="1.5" fill="currentColor" opacity="0.55"/>
                                  </svg>
                                ),
                              },
                              {
                                id: "motion" as const,
                                label: "Моушн",
                                desc: "Цветной morph под любую нишу",
                                icon: (
                                  <svg viewBox="0 0 40 28" fill="none" className="w-10 h-7">
                                    <rect x="0" y="0" width="40" height="28" rx="4" fill="currentColor" opacity="0.08"/>
                                    <circle cx="16" cy="14" r="7" fill="currentColor" opacity="0.22"/>
                                    <path d="M22 7 C28 10, 30 18, 24 22" stroke="currentColor" strokeWidth="1.6" fill="none" opacity="0.45"/>
                                    <circle cx="26" cy="14" r="5.5" fill="currentColor" opacity="0.45"/>
                                    <circle cx="27.5" cy="12.5" r="1.2" fill="currentColor" opacity="0.7"/>
                                  </svg>
                                ),
                              },
                            ].map(s => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => setInteractiveStyle(s.id)}
                                className="flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all"
                                style={{
                                  border: interactiveStyle === s.id ? '1.5px solid rgba(20,184,166,0.5)' : '1.5px solid rgba(0,0,0,0.07)',
                                  background: interactiveStyle === s.id ? 'rgba(20,184,166,0.07)' : 'rgba(0,0,0,0.02)',
                                  color: interactiveStyle === s.id ? '#0d9488' : '#86868B',
                                  cursor: 'pointer',
                                }}
                              >
                                {s.icon}
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, lineHeight: 1.2 }}>{s.label}</span>
                                <span style={{ fontSize: '0.62rem', opacity: 0.7, lineHeight: 1.3, textAlign: 'center' }}>{s.desc}</span>
                              </button>
                            ))}
                          </div>
                          {/* Product photo upload (optional) */}
                          <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#86868B', paddingLeft: 4, marginTop: 4 }}>
                            Фото продукта <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#aaa' }}>
                              {interactiveStyle === "site3d" ? "(рекомендуется для 3D)" : "(необязательно)"}
                            </span>
                          </div>
                          <input
                            ref={interactiveProductImgRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              if (file.size > 10 * 1024 * 1024) {
                                toast({ title: "Файл слишком большой", description: "Максимум 10 МБ", variant: "destructive" });
                                return;
                              }
                              const reader = new FileReader();
                              reader.onload = () => {
                                const dataUrl = reader.result as string;
                                const base64 = dataUrl.split(",")[1];
                                setInteractiveProductImage({ base64, mimeType: file.type || "image/jpeg", preview: dataUrl });
                              };
                              reader.readAsDataURL(file);
                            }}
                          />
                          {interactiveProductImage ? (
                            <div className="relative rounded-xl overflow-hidden flex-1" style={{ border: '1px solid rgba(20,184,166,0.3)', background: 'rgba(20,184,166,0.04)', minHeight: 80 }}>
                              <img src={interactiveProductImage.preview} alt="Продукт" className="w-full h-full object-contain" style={{ maxHeight: 110 }} />
                              <button
                                type="button"
                                onClick={() => { setInteractiveProductImage(null); if (interactiveProductImgRef.current) interactiveProductImgRef.current.value = ''; }}
                                className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full"
                                style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer' }}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                              <div className="absolute bottom-2 left-2 px-2 py-1 rounded-md" style={{ background: 'rgba(13,148,136,0.85)', backdropFilter: 'blur(8px)' }}>
                                <span className="text-white text-[10px] font-semibold flex items-center gap-1">
                                  <ImageIcon className="w-3 h-3" /> Фото загружено
                                </span>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => interactiveProductImgRef.current?.click()}
                              className="flex flex-col items-center justify-center gap-2 rounded-xl transition-all hover:border-teal-400 flex-1"
                              style={{ border: '2px dashed rgba(20,184,166,0.3)', background: 'rgba(20,184,166,0.02)', minHeight: 80, cursor: 'pointer' }}
                            >
                              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(20,184,166,0.08)' }}>
                                <Upload className="w-4 h-4" style={{ color: '#0d9488' }} />
                              </div>
                              <div className="text-center">
                                <p className="text-xs font-semibold" style={{ color: '#0d9488' }}>Загрузить фото продукта</p>
                                <p className="text-[10px] mt-0.5" style={{ color: '#5eead4' }}>PNG, JPG до 10 МБ — AI оживит его</p>
                              </div>
                            </button>
                          )}
                        </div>
                      ) : selectedMode === "photo" ? (
                        <div className="flex flex-col gap-3 flex-1">
                          <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#86868B', paddingLeft: 4 }}>Референсы (дизайн и/или фото товара) — необязательно</div>
                          <input
                            ref={photoInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            data-testid="input-photo-upload"
                            onChange={(e) => {
                              const files = Array.from(e.target.files || []);
                              if (files.length === 0) return;
                              const remaining = Math.max(0, 5 - photoImages.length);
                              if (files.length > remaining) {
                                toast({ title: "Слишком много файлов", description: "Максимум 5 референсов", variant: "destructive" });
                              }
                              files.slice(0, remaining).forEach(file => {
                                if (file.size > 5 * 1024 * 1024) {
                                  toast({ title: "Файл слишком большой", description: `${file.name}: максимум 5 МБ`, variant: "destructive" });
                                  return;
                                }
                                const reader = new FileReader();
                                reader.onload = () => {
                                  const dataUrl = reader.result as string;
                                  const base64 = dataUrl.split(",")[1];
                                  const mimeType = file.type || "image/jpeg";
                                  setPhotoImages(prev => [...prev, { base64, mimeType, preview: dataUrl }]);
                                };
                                reader.readAsDataURL(file);
                              });
                              if (photoInputRef.current) photoInputRef.current.value = '';
                            }}
                          />
                          {photoImages.length > 0 ? (
                            <div className="flex flex-col gap-2 flex-1">
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {photoImages.map((img, i) => (
                                  <div key={i} className="relative rounded-xl overflow-hidden" style={{ border: '1px solid rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.04)', aspectRatio: '1/1' }}>
                                    <img src={img.preview} alt={`Референс ${i + 1}`} className="w-full h-full object-cover" />
                                    <button
                                      type="button"
                                      data-testid={`button-remove-photo-${i}`}
                                      onClick={() => setPhotoImages(prev => prev.filter((_, idx) => idx !== i))}
                                      className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full transition-all hover:scale-110"
                                      style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer' }}
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                    <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(139,92,246,0.85)', backdropFilter: 'blur(8px)' }}>
                                      <span className="text-white text-[9px] font-semibold">#{i + 1}</span>
                                    </div>
                                  </div>
                                ))}
                                {photoImages.length < 5 && (
                                  <button
                                    type="button"
                                    data-testid="button-add-more-photos"
                                    onClick={() => photoInputRef.current?.click()}
                                    className="flex flex-col items-center justify-center gap-1 rounded-xl transition-all hover:border-purple-400"
                                    style={{ border: '2px dashed rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.02)', aspectRatio: '1/1', cursor: 'pointer' }}
                                  >
                                    <Upload className="w-4 h-4" style={{ color: '#8B5CF6' }} />
                                    <span className="text-[9px] font-semibold" style={{ color: '#6D28D9' }}>Добавить</span>
                                  </button>
                                )}
                              </div>
                              <p className="text-[10px]" style={{ color: '#A78BFA' }}>Приложите скриншот дизайна-референса и/или реальные фото товара/бренда — ИИ сам решит, что использовать как вдохновение, а что сохранить как есть</p>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2 flex-1">
                              <button
                                type="button"
                                data-testid="button-upload-photo"
                                data-tour="photo-upload"
                                onClick={() => photoInputRef.current?.click()}
                                className="flex-1 flex flex-col items-center justify-center gap-2 rounded-xl transition-all hover:border-purple-400"
                                style={{ border: '2px dashed rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.02)', minHeight: 100, cursor: 'pointer' }}
                              >
                                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.08)' }}>
                                  <Upload className="w-5 h-5" style={{ color: '#8B5CF6' }} />
                                </div>
                                <div className="text-center">
                                  <p className="text-sm font-semibold" style={{ color: '#6D28D9' }}>Загрузить референсы</p>
                                  <p className="text-xs mt-0.5" style={{ color: '#A78BFA' }}>Необязательно — дизайн и/или фото товара, до 5 файлов, PNG/JPG/WEBP до 5 МБ</p>
                                </div>
                              </button>
                              <div className="rounded-xl p-2.5" data-tour="photo-ai-gen" style={{ background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(139,92,246,0.15)' }}>
                                <div className="flex flex-col sm:flex-row gap-2">
                                  <input
                                    type="text"
                                    data-testid="input-mockup-prompt"
                                    placeholder="Spa центр Mango, нежные тона сайта, стильный шрифт"
                                    value={mockupPrompt}
                                    onChange={e => setMockupPrompt(e.target.value)}
                                    className="flex-1 text-xs rounded-lg px-2.5 py-2 font-medium"
                                    style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(139,92,246,0.2)', outline: 'none', color: '#1D1D1F' }}
                                    disabled={mockupGenerating}
                                  />
                                  <button
                                    type="button"
                                    data-testid="button-generate-mockup"
                                    disabled={!mockupPrompt.trim() || mockupGenerating}
                                    onClick={async () => {
                                      if (!mockupPrompt.trim()) return;
                                      setMockupGenerating(true);
                                      try {
                                        const resp = await fetch("/api/images/generate", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ prompt: "Макет для сайта, стильный и премиальный. " + mockupPrompt.trim(), aspectRatio: "9:16" }),
                                          credentials: "include",
                                        });
                                        const data = await resp.json();
                                        if (!resp.ok) throw new Error(data.message);
                                        if (data.newBalance !== undefined) {
                                          queryClient.setQueryData(["/api/auth/user"], (old: any) => old ? { ...old, credits: data.newBalance } : old);
                                        }
                                        const taskId = data.taskId;
                                        const poll = setInterval(async () => {
                                          try {
                                            const sr = await fetch(`/api/images/status/${taskId}`, { credentials: "include" });
                                            const sd = await sr.json();
                                            if (sd.state === "success" && sd.urls?.[0]) {
                                              clearInterval(poll);
                                              const imgResp = await fetch(sd.urls[0]);
                                              const blob = await imgResp.blob();
                                              const reader = new FileReader();
                                              reader.onload = () => {
                                                const dataUrl = reader.result as string;
                                                const base64 = dataUrl.split(",")[1];
                                                setPhotoImages(prev => [...prev, { base64, mimeType: "image/jpeg", preview: dataUrl }]);
                                                setMockupGenerating(false);
                                              };
                                              reader.readAsDataURL(blob);
                                            } else if (sd.state === "fail") {
                                              clearInterval(poll);
                                              toast({ title: "Ошибка генерации", description: sd.error || "Не удалось создать макет", variant: "destructive" });
                                              setMockupGenerating(false);
                                            }
                                          } catch {
                                            clearInterval(poll);
                                            setMockupGenerating(false);
                                          }
                                        }, 3000);
                                        setTimeout(() => { clearInterval(poll); setMockupGenerating(false); }, 180000);
                                      } catch (err: any) {
                                        toast({ title: "Ошибка", description: err.message || "Не удалось создать макет", variant: "destructive" });
                                        setMockupGenerating(false);
                                      }
                                    }}
                                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
                                    style={{ background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)', cursor: mockupGenerating ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
                                  >
                                    {mockupGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                                    {mockupGenerating ? "Генерация..." : "Создать"}
                                  </button>
                                </div>
                                <p className="text-[10px] mt-1.5" style={{ color: '#A78BFA' }}>AI сгенерирует макет (15 токенов)</p>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                      {/* Agent V1/V2 selector */}
                      <div className="flex items-center gap-1.5 p-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.08)', display: 'inline-flex', marginBottom: 4 }}>
                        <button type="button" onClick={() => setAgentVersion("v1")}
                          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all"
                          style={{ background: agentVersion === "v1" ? '#fff' : 'transparent', color: agentVersion === "v1" ? '#1d1d1f' : '#86868B', boxShadow: agentVersion === "v1" ? '0 1px 4px rgba(0,0,0,0.12)' : 'none', cursor: 'pointer' }}>
                          {isMobile ? 'V1' : 'V1 · Claude Sonnet 5'}
                        </button>
                        <button type="button" onClick={() => setAgentVersion("v2")}
                          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all"
                          style={{ background: agentVersion === "v2" ? 'linear-gradient(135deg,#4f46e5,#7c3aed)' : 'transparent', color: agentVersion === "v2" ? '#fff' : '#86868B', boxShadow: agentVersion === "v2" ? '0 1px 6px rgba(99,102,241,0.4)' : 'none', cursor: 'pointer' }}>
                          {isMobile ? '✦ V2' : '✦ V2 · Gemini Flash'}
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setMultiPageEnabled(v => !v)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                          style={{ border: multiPageEnabled ? '1px solid rgba(0,113,227,0.4)' : '1.5px dashed rgba(0,0,0,0.15)', background: multiPageEnabled ? 'rgba(0,113,227,0.07)' : 'transparent', color: multiPageEnabled ? '#0058b3' : '#86868B', cursor: 'pointer' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                          Многостраничный
                        </button>
                        <button type="button" onClick={() => setSeoEnabled(v => !v)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                          style={{ border: seoEnabled ? '1px solid rgba(52,199,89,0.4)' : '1.5px dashed rgba(0,0,0,0.15)', background: seoEnabled ? 'rgba(52,199,89,0.07)' : 'transparent', color: seoEnabled ? '#1D8348' : '#86868B', cursor: 'pointer' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                          SEO
                        </button>
                        <button type="button" onClick={() => setLeadFormEnabled(v => !v)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                          style={{ border: leadFormEnabled ? '1px solid rgba(239,68,68,0.4)' : '1.5px dashed rgba(0,0,0,0.15)', background: leadFormEnabled ? 'rgba(239,68,68,0.07)' : 'transparent', color: leadFormEnabled ? '#b91c1c' : '#86868B', cursor: 'pointer' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                          Лид-форма
                        </button>
                      </div>
                      {multiPageEnabled && (
                        <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(0,113,227,0.04)', border: '1px solid rgba(0,113,227,0.15)' }}>
                          <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#0058b3', marginBottom: 2 }}>Страницы сайта</div>
                          {pageNames.map((name, i) => (
                            <div key={i} className="flex gap-2 items-center">
                              <Input placeholder={`Страница ${i + 1}`} value={name}
                                onChange={e => setPageNames(prev => prev.map((p, idx) => idx === i ? e.target.value : p))}
                                className="h-7 rounded-lg text-xs" style={{ background: '#fff', border: '1px solid rgba(0,113,227,0.2)' }} />
                              {pageNames.length > 1 && (
                                <button type="button" onClick={() => setPageNames(prev => prev.filter((_, idx) => idx !== i))}
                                  style={{ color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', padding: '2px', fontSize: '0.75rem' }}>✕</button>
                              )}
                            </div>
                          ))}
                          <button type="button" onClick={() => setPageNames(prev => [...prev, ""])}
                            className="text-xs font-semibold" style={{ color: '#0058b3', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 0' }}>+ Добавить</button>
                        </div>
                      )}
                      {seoEnabled && (
                        <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(52,199,89,0.04)', border: '1px solid rgba(52,199,89,0.2)' }}>
                          <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#1D8348', marginBottom: 2 }}>SEO заголовки</div>
                          <div className="flex gap-2 items-center">
                            <span className="text-xs font-bold w-6 shrink-0" style={{ color: '#1D8348' }}>H1</span>
                            <Input placeholder="Главный заголовок" value={seoH1} onChange={e => setSeoH1(e.target.value)}
                              className="h-7 rounded-lg text-xs" style={{ background: '#fff', border: '1px solid rgba(52,199,89,0.25)' }} />
                          </div>
                          {seoH2s.map((h2, i) => (
                            <div key={i} className="flex gap-2 items-center">
                              <span className="text-xs font-bold w-6 shrink-0" style={{ color: '#1D8348' }}>H2</span>
                              <Input placeholder={`Подзаголовок ${i + 1}`} value={h2}
                                onChange={e => setSeoH2s(prev => prev.map((h, idx) => idx === i ? e.target.value : h))}
                                className="h-7 rounded-lg text-xs" style={{ background: '#fff', border: '1px solid rgba(52,199,89,0.2)' }} />
                              {seoH2s.length > 1 && (
                                <button type="button" onClick={() => setSeoH2s(prev => prev.filter((_, idx) => idx !== i))}
                                  style={{ color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', padding: '2px', fontSize: '0.75rem' }}>✕</button>
                              )}
                            </div>
                          ))}
                          <button type="button" onClick={() => setSeoH2s(prev => [...prev, ""])}
                            className="text-xs font-semibold" style={{ color: '#1D8348', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 0' }}>+ Добавить H2</button>
                        </div>
                      )}
                      {!multiPageEnabled && !seoEnabled && (
                        <div className="flex-1 flex items-center justify-center rounded-xl" style={{ border: '1.5px dashed rgba(0,0,0,0.08)', minHeight: 80 }}>
                          <p style={{ fontSize: '0.8rem', color: '#c0c0c0', textAlign: 'center', lineHeight: 1.5 }}>Включите опции выше<br/>для дополнительных настроек</p>
                        </div>
                      )}
                      {!leadFormEnabled && (
                        <div className="rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.18)' }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                          <p style={{ fontSize: '0.72rem', color: '#b91c1c', margin: 0 }}>Лид-форма отключена — AI не добавит форму сбора заявок</p>
                        </div>
                      )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className={`grid gap-2 sm:gap-3 ${selectedMode === "photo" ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`} style={{ marginTop: 16 }}>
                    <button
                      className="h-10 font-semibold transition-all text-sm"
                      style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, color: '#86868B', cursor: 'pointer' }}
                      onClick={() => { setCreateStep("choose"); setIsEnhanced(false); }}
                    >
                      ← Назад
                    </button>
                    {selectedMode !== "photo" && (
                    <button
                      data-testid="button-enhance-prompt"
                      type="button"
                      onClick={async () => {
                        if (isEnhancing || isResearching) return;
                        if (!description.trim() || description.trim().length < 3) {
                          toast({ title: "Введите описание", description: "Напишите хотя бы несколько слов для улучшения", variant: "destructive" });
                          return;
                        }
                        setIsEnhancing(true);
                        queryClient.setQueryData(["/api/auth/user"], (old: any) => old ? { ...old, credits: Math.max(0, old.credits - 5) } : old);
                        try {
                          const res = await apiRequest("POST", "/api/enhance-prompt", { prompt: description });
                          const data = await res.json();
                          if (data.newBalance !== undefined) {
                            queryClient.setQueryData(["/api/auth/user"], (old: any) => old ? { ...old, credits: data.newBalance } : old);
                          }
                          if (data.warning) {
                            toast({ title: "Внимание", description: data.warning });
                          } else if (data.enhancedPrompt) {
                            setDescription(data.enhancedPrompt);
                            setIsEnhanced(true);
                            toast({ title: "Промпт улучшен!", description: "Проверьте описание и нажмите «Создать проект»" });
                          }
                        } catch (err: any) {
                          let msg = "Не удалось улучшить промпт";
                          try { const t = err?.message || ""; const m = t.match(/\{.*\}/); if (m) { const p = JSON.parse(m[0]); if (p.message) msg = p.message; } } catch {}
                          toast({ title: "Ошибка", description: msg, variant: "destructive" });
                        } finally { setIsEnhancing(false); }
                      }}
                      disabled={isEnhancing || isResearching || !description.trim()}
                      className={`h-10 flex items-center justify-center gap-1.5 font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed${!isEnhanced && !isEnhancing && description.trim() ? ' db-enhance-btn' : ''}`}
                      style={{ border: isEnhanced ? '1px solid rgba(52,199,89,0.4)' : (!description.trim() ? '1.5px dashed rgba(0,0,0,0.12)' : undefined), background: isEnhanced ? 'rgba(52,199,89,0.06)' : undefined, color: isEnhanced ? '#1D8348' : (description.trim() && !isEnhancing ? undefined : '#86868B'), borderRadius: 12, cursor: 'pointer' }}
                    >
                      {isEnhancing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isEnhanced ? <Sparkles className="w-3.5 h-3.5" /> : <Wand2 className="w-3.5 h-3.5" />}
                      {isEnhancing ? 'Улучшаем...' : isEnhanced ? 'Улучшено' : 'AI улучшение'}
                    </button>
                    )}
                    <button
                      data-tour="photo-create"
                      className="h-10 font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                      style={{ background: 'linear-gradient(135deg,#1D1D1F,#3a3a3c)', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}
                      onClick={() => {
                        createMutation.mutate();
                      }}
                      disabled={createMutation.isPending || isEnhancing || isResearching}
                    >
                      {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Создать проект"}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {activeTour && tourStep >= 0 && (
            <TourTooltip
              steps={activeTour}
              currentStep={tourStep}
              onNext={() => {
                if (tourStep < activeTour.length - 1) {
                  setTourStep(tourStep + 1);
                } else {
                  if (activeTour === CHOOSE_TOUR_STEPS) localStorage.setItem("tour_choose_seen", "1");
                  if (activeTour === PHOTO_TOUR_STEPS) localStorage.setItem("tour_photo_seen", "1");
                  setActiveTour(null);
                  setTourStep(-1);
                }
              }}
              onPrev={() => { if (tourStep > 0) setTourStep(tourStep - 1); }}
              onClose={() => {
                if (activeTour === CHOOSE_TOUR_STEPS) localStorage.setItem("tour_choose_seen", "1");
                if (activeTour === PHOTO_TOUR_STEPS) localStorage.setItem("tour_photo_seen", "1");
                setActiveTour(null);
                setTourStep(-1);
              }}
            />
          )}
        </DialogContent>
      </Dialog>


      <Dialog open={showTopUpModal} onOpenChange={setShowTopUpModal}>
        <DialogContent className="p-0 overflow-y-auto max-h-[92dvh]" style={{ maxWidth: 900, width: '92vw', borderRadius: isMobile ? 20 : 28, border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 40px 100px rgba(0,0,0,0.5)', background: 'linear-gradient(135deg,#1e1e24 10%,#050505 60%)', fontFamily: appleFont }}>
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes m2-gradient-shift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
            @keyframes m2-blur{to{filter:blur(3vmin);transform:scale(1.05)}}
            .db-topup-grid > * { min-height: 0; height: 100%; display: flex; }
            .topup-m2card{
              position:relative;border-radius:24px;
              background:linear-gradient(135deg,#1e1e24 10%,#050505 60%);
              background-size:200% 200%;
              animation:m2-gradient-shift 5s ease-in-out infinite;
              display:flex;flex-direction:column;align-items:center;
              justify-content:flex-start;
              padding:2rem 1.25rem;cursor:pointer;color:inherit;
              transition:transform .4s cubic-bezier(.2,.8,.2,1);
              border:none;text-align:center;width:100%;height:100%;
              box-sizing:border-box;
            }
            .topup-m2card .topup-desc{
              flex:1 1 auto;display:flex;flex-direction:column;
              justify-content:center;gap:0.3rem;width:100%;
              min-height:3.6rem;margin-bottom:1rem;
            }
            .topup-m2card .topup-price{margin-top:auto;}
            .topup-m2card:hover{transform:translateY(-6px) scale(1.02)}
            .topup-m2card::before,.topup-m2card::after{
              --size:5px;content:"";position:absolute;
              top:calc(var(--size) / -2);left:calc(var(--size) / -2);
              width:calc(100% + var(--size));height:calc(100% + var(--size));
              border-radius:28px;
              background:
                radial-gradient(circle at 0 0,hsl(27deg 93% 60%),transparent),
                radial-gradient(circle at 100% 0,#00a6ff,transparent),
                radial-gradient(circle at 0 100%,#ff0056,transparent),
                radial-gradient(circle at 100% 100%,#6500ff,transparent);
            }
            .topup-m2card::after{--size:2px;z-index:-1}
            .topup-m2card::before{--size:10px;z-index:-2;filter:blur(2vmin);animation:m2-blur 3s ease-in-out alternate infinite;}
          `}} />
          <div className="db-topup-pad" style={{ padding: '2.5rem 2.5rem 2.5rem' }}>
            <DialogHeader>
              <DialogTitle style={{ fontSize: isMobile ? '1.35rem' : '1.8rem', fontWeight: 700, letterSpacing: '-0.035em', color: '#fff' }}>
                Пополнить баланс
              </DialogTitle>
            </DialogHeader>
            <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.45)', marginTop: '0.4rem', marginBottom: isMobile ? '1.25rem' : '2rem' }}>Выберите подходящий тариф для пополнения токенов</p>
            <div className="db-topup-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
              {[
                { price: 990,  tokens: 1000, label: "Старт",   popular: false, desc: ["1 сайт", "10 итераций редактирования"] },
                { price: 1690, tokens: 1900, label: "Базовый", popular: false, desc: ["2 сайта", "19 итераций редактирования"] },
                { price: 3990, tokens: 4500, label: "Профи",   popular: false, desc: ["3 сайта", "45 итераций редактирования", "Премиум шаблоны"] },
                { price: 9990, tokens: 10000, label: "Ультра",  popular: true,  desc: ["5 сайтов", "100 итераций редактирования", "Премиум шаблоны"] },
              ].map((plan) => (
                <div key={plan.price} style={{ position: 'relative', height: '100%' }}>
                  {plan.popular && (
                    <span style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(90deg,hsl(27deg 93% 60%),#00a6ff,#6500ff)', color: '#fff', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', padding: '0.28rem 0.9rem', borderRadius: 100, whiteSpace: 'nowrap', zIndex: 3 }}>
                      Популярный
                    </span>
                  )}
                  <button
                    className="topup-m2card"
                    data-testid={`button-plan-${plan.price}`}
                    disabled={paymentLoading !== null}
                    onClick={async () => {
                      // Open blank tab synchronously to avoid popup blockers after await
                      const payWin = window.open("about:blank", "_blank");
                      try {
                        setPaymentLoading(plan.price);
                        const res = await apiRequest("POST", "/api/payments/create", { price: plan.price });
                        const data = await res.json();
                        if (data.url) {
                          if (payWin && !payWin.closed) {
                            payWin.location.href = data.url;
                          } else {
                            window.location.assign(data.url);
                          }
                          setShowTopUpModal(false);
                          toast({ title: "Перенаправление на оплату", description: "Откроется страница оплаты через СБП" });
                        } else {
                          if (payWin && !payWin.closed) payWin.close();
                          toast({ title: "Ошибка", description: data.message || "Не удалось создать платёж", variant: "destructive" });
                        }
                      } catch (err: any) {
                        if (payWin && !payWin.closed) payWin.close();
                        toast({ title: "Ошибка", description: "Не удалось создать платёж", variant: "destructive" });
                      } finally {
                        setPaymentLoading(null);
                      }
                    }}
                  >
                    <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: plan.popular ? '#00d2ff' : 'rgba(255,255,255,0.5)', marginBottom: '0.6rem' }}>{plan.label}</span>
                    <span style={{ fontSize: '2.2rem', fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1, color: '#fff' }}>{plan.tokens.toLocaleString("ru-RU")}</span>
                    <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginTop: '0.3rem', marginBottom: '1rem' }}>токенов</span>
                    <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.07)', marginBottom: '1rem', flexShrink: 0 }} />
                    <div className="topup-desc">
                      {plan.desc.map((line, i) => (
                        <span key={i} style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.4, textAlign: 'center' }}>{line}</span>
                      ))}
                    </div>
                    <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.07)', marginBottom: '1rem', flexShrink: 0 }} />
                    <div className="topup-price">
                      {paymentLoading === plan.price ? (
                        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#00d2ff' }}>Загрузка...</span>
                      ) : (
                        <span style={{ fontSize: '1.15rem', fontWeight: 600, letterSpacing: '-0.02em', color: plan.popular ? '#00d2ff' : '#fff' }}>{plan.price.toLocaleString("ru-RU")} ₽</span>
                      )}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: '2rem 1rem 2.5rem', color: '#86868B', fontSize: '0.78rem', lineHeight: 1.8 }}>
        <div className="flex flex-col sm:flex-row justify-center items-center gap-2 sm:gap-6 mb-2">
          <a href="/oferta" style={{ color: '#86868B', textDecoration: 'none' }}>Договор оферты</a>
          <a href="/privacy" style={{ color: '#86868B', textDecoration: 'none' }}>Политика конфиденциальности</a>
        </div>
        <div>© 2026 Craft AI. Все права защищены.</div>
        <div className="px-2 break-words">ИП Pushkaryov Sergey Borisovich (ПИНФЛ 30904686530039) &nbsp;·&nbsp; <a href="mailto:psb-trx1@yandex.ru" style={{ color: 'inherit', textDecoration: 'none' }}>psb-trx1@yandex.ru</a></div>
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes tourFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}} />
    </div>
  );
}
