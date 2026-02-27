import { useState } from "react";
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
import { useRef } from "react";

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
  const [selectedMode, setSelectedMode] = useState<"prompt" | "template" | "photo">("prompt");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [isEnhanced, setIsEnhanced] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  const [researchData, setResearchData] = useState("");
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [multiPageEnabled, setMultiPageEnabled] = useState(false);
  const [pageNames, setPageNames] = useState<string[]>(["О нас", "Услуги", "Контакты"]);
  const [seoEnabled, setSeoEnabled] = useState(false);
  const [seoH1, setSeoH1] = useState("");
  const [seoH2s, setSeoH2s] = useState<string[]>(["", ""]);
  const [photoImage, setPhotoImage] = useState<{ base64: string; mimeType: string; preview: string } | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const { data: userProjects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/leads/unread-count"],
    refetchInterval: 30000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/projects", {
        title: title || "Новый проект",
        description: description || null,
      });
      return res.json();
    },
    onSuccess: (project: Project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setShowCreateModal(false);
      const prompt = selectedMode === "template" ? `Создай сайт: ${selectedTemplate}. ${description}` : selectedMode === "photo" ? (description || "Воссоздай дизайн с загруженного скриншота") : description || title;
      const enhancedParam = isEnhanced ? "&enhanced=1" : "";
      const researchParam = researchData ? `&research=${encodeURIComponent(researchData)}` : "";
      const multiPageParam = (multiPageEnabled && pageNames.filter(p => p.trim()).length > 0)
        ? `&multipages=${encodeURIComponent(pageNames.filter(p => p.trim()).join(","))}`
        : "";
      const seoParam = (seoEnabled && seoH1.trim())
        ? `&seoh1=${encodeURIComponent(seoH1.trim())}&seoh2s=${encodeURIComponent(seoH2s.filter(h => h.trim()).join(","))}`
        : "";
      const mockupParam = (selectedMode === "photo" && photoImage) ? "&mockup=1" : "";
      if (selectedMode === "photo" && photoImage) {
        try {
          sessionStorage.setItem(`mockup_image_${project.id}`, JSON.stringify(photoImage));
        } catch (e) {
          console.error("Failed to save mockup image to sessionStorage:", e);
          toast({ title: "Ошибка", description: "Не удалось сохранить изображение. Попробуйте файл меньшего размера.", variant: "destructive" });
          return;
        }
      }
      setLocation(`/editor/${project.id}?prompt=${encodeURIComponent(prompt)}${enhancedParam}${researchParam}${multiPageParam}${seoParam}${mockupParam}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Удалено" });
    },
  });

  const appleFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

  return (
    <div className="min-h-screen pb-20 relative overflow-hidden" style={{ background: '#FBFBFD', fontFamily: appleFont }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .uv-topup{cursor:pointer;position:relative;border-radius:100em;background-color:rgba(15,15,15,0.9);box-shadow:-0.15em -0.15em 0.15em -0.075em rgba(80,80,80,0.15),0.0375em 0.0375em 0.0675em 0 rgba(0,0,0,0.3);}
        .uv-topup::after{content:"";position:absolute;z-index:0;width:calc(100% + 0.3em);height:calc(100% + 0.3em);top:-0.15em;left:-0.15em;border-radius:inherit;background:linear-gradient(-135deg,rgba(120,120,120,0.3),transparent 20%,transparent 100%);filter:blur(0.0125em);opacity:0.3;mix-blend-mode:screen;}
        .uv-topup-outer{position:relative;z-index:1;border-radius:inherit;transition:box-shadow 300ms ease;will-change:box-shadow;box-shadow:0 0.05em 0.05em -0.01em rgba(0,0,0,1),0 0.01em 0.01em -0.01em rgba(0,0,0,0.5),0.15em 0.3em 0.1em -0.01em rgba(0,0,0,0.4);}
        .uv-topup-btn:hover .uv-topup-outer{box-shadow:0 0 0 0 rgba(0,0,0,1),0 0 0 0 rgba(0,0,0,0.5),0 0 0 0 rgba(0,0,0,0.4);}
        .uv-topup-inner{position:relative;z-index:1;border-radius:inherit;padding:0.45em 1.2em;background-image:linear-gradient(135deg,rgba(55,55,60,1),rgba(20,20,22,1));transition:box-shadow 300ms ease,clip-path 250ms ease,transform 250ms ease;will-change:box-shadow,clip-path,transform;overflow:clip;clip-path:inset(0 0 0 0 round 100em);box-shadow:0 0 0 0 inset rgba(255,255,255,0.05),-0.05em -0.05em 0.05em 0 inset rgba(0,0,0,0.6),0 0 0 0 inset rgba(0,0,0,0.2),0 0 0.05em 0.2em inset rgba(255,255,255,0.04),0.025em 0.05em 0.1em 0 inset rgba(255,255,255,0.08),0.12em 0.12em 0.12em inset rgba(255,255,255,0.05),-0.075em -0.25em 0.25em 0.1em inset rgba(0,0,0,0.5);}
        .uv-topup-btn:hover .uv-topup-inner{clip-path:inset(clamp(1px,0.0625em,2px) clamp(1px,0.0625em,2px) clamp(1px,0.0625em,2px) clamp(1px,0.0625em,2px) round 100em);box-shadow:0.1em 0.15em 0.05em 0 inset rgba(0,0,0,0.9),-0.025em -0.03em 0.05em 0.025em inset rgba(0,0,0,0.7),0.25em 0.25em 0.2em 0 inset rgba(0,0,0,0.6),0 0 0.05em 0.5em inset rgba(255,255,255,0.03),0 0 0 0 inset rgba(255,255,255,0.08),0.12em 0.12em 0.12em inset rgba(255,255,255,0.04),-0.075em -0.12em 0.2em 0.1em inset rgba(0,0,0,0.5);}
        .uv-topup-btn:active .uv-topup-inner{transform:scale(0.975);}
        .uv-topup-inner span{position:relative;z-index:4;letter-spacing:-0.01em;font-weight:600;font-size:0.82rem;color:rgba(255,255,255,0);background-image:linear-gradient(135deg,rgba(255,255,255,0.95),rgba(200,200,210,0.85));-webkit-background-clip:text;background-clip:text;display:block;user-select:none;text-shadow:rgba(0,0,0,0.3) 0 0 0.2em;transition:transform 250ms ease;}
        .uv-topup-btn:hover .uv-topup-inner span{transform:scale(0.975);}
      ` }} />
      {/* Ambient glows matching landing page */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[60%] pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(66,165,255,0.07) 0%, transparent 70%)' }} />
      <div className="absolute top-0 left-0 right-0 h-px pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent, rgba(66,165,255,0.3), rgba(181,66,255,0.3), transparent)' }} />

      {/* Header — matching landing page nav */}
      <header className="fixed top-0 left-0 right-0 z-50" style={{ padding: '1rem 0', transition: 'all 0.3s', background: 'rgba(251,251,253,0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          {/* Logo identical to landing page */}
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setLocation("/")}>
            <svg viewBox="0 0 32 32" stroke="currentColor" strokeWidth="2" fill="none" style={{ width: 32, height: 32 }}>
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
            <span style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-0.03em', color: '#1D1D1F' }}>Craft AI</span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLocation("/leads")}
              data-testid="button-leads"
              className="relative flex items-center gap-2 transition-all"
              style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 100, padding: '0.45rem 1.1rem', fontSize: '0.82rem', fontWeight: 600, color: '#1D1D1F', cursor: 'pointer' }}
            >
              <Inbox className="w-3.5 h-3.5" style={{ color: '#86868B' }} />
              <span>Лиды</span>
              {(unreadData?.count ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-white text-[10px] font-black rounded-full px-1" style={{ background: 'linear-gradient(135deg,#FF4242,#B742FF)' }}>
                  {unreadData!.count}
                </span>
              )}
            </button>

            <div className="flex items-center gap-1.5" style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 100, padding: '0.45rem 1.1rem' }}>
              <Coins className="w-3.5 h-3.5" style={{ color: '#86868B' }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1D1D1F' }}>{user?.credits ?? 0}</span>
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#86868B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>токенов</span>
            </div>

            <button
              data-testid="button-topup"
              onClick={() => setShowTopUpModal(true)}
              className="uv-topup-btn"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <div className="uv-topup">
                <div className="uv-topup-outer">
                  <div className="uv-topup-inner">
                    <span>Пополнить</span>
                  </div>
                </div>
              </div>
            </button>

            {/* Profile avatar button */}
            <div
              style={{ position: 'relative' }}
              onMouseEnter={() => setShowProfile(true)}
              onMouseLeave={() => setShowProfile(false)}
            >
              <button
                data-testid="button-profile"
                onClick={() => setLocation('/profile')}
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
                        onClick={item.onClick}
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
                      onClick={async () => { await logout(); setLocation("/auth"); }}
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

      <main className="max-w-7xl mx-auto px-6" style={{ paddingTop: '6.5rem' }}>
        {/* Page header */}
        <div className="flex items-end justify-between mb-12">
          <div>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#86868B', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
              Добро пожаловать, {user?.displayName || user?.email?.split('@')[0]}
            </p>
            <h1 style={{ fontSize: 'clamp(2.5rem,5vw,3.5rem)', fontWeight: 700, letterSpacing: '-0.04em', color: '#1D1D1F', lineHeight: 1, margin: 0 }}>
              Ваши проекты
            </h1>
          </div>
          <button
            onClick={() => { setCreateStep("choose"); setTitle(""); setDescription(""); setIsEnhanced(false); setResearchData(""); setMultiPageEnabled(false); setPageNames(["О нас", "Услуги", "Контакты"]); setSeoEnabled(false); setSeoH1(""); setSeoH2s(["", ""]); setPhotoImage(null); setShowCreateModal(true); }}
            className="flex items-center gap-2 transition-all hover:-translate-y-0.5 active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg,#1D1D1F,#3a3a3c)', color: '#fff', border: 'none', borderRadius: 16, padding: '0.9rem 1.8rem', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 8px 30px rgba(0,0,0,0.15)', letterSpacing: '-0.01em' }}
          >
            <Plus className="w-5 h-5" />
            Новый сайт
          </button>
        </div>

        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1,2,3].map(i => <div key={i} className="h-72 rounded-[2rem] animate-pulse" style={{ background: 'rgba(0,0,0,0.04)' }} />)}
          </div>
        ) : userProjects.length === 0 ? (
          <GlassCard className="flex flex-col items-center justify-center py-32 text-center space-y-8">
            <div className="w-24 h-24 rounded-[2rem] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.06)' }}>
              <FolderOpen className="w-12 h-12" style={{ color: 'rgba(0,0,0,0.12)' }} />
            </div>
            <div className="space-y-3">
              <h2 style={{ fontSize: '1.8rem', fontWeight: 700, letterSpacing: '-0.03em', color: '#1D1D1F' }}>Пока здесь пусто</h2>
              <p style={{ color: '#86868B', maxWidth: 360, margin: '0 auto', fontSize: '1rem', lineHeight: 1.6 }}>Создайте свой первый проект, используя возможности искусственного интеллекта.</p>
            </div>
            <button onClick={() => setShowCreateModal(true)} className="transition-all hover:opacity-80" style={{ background: '#1D1D1F', color: '#fff', border: 'none', borderRadius: 14, padding: '0.85rem 2rem', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer' }}>
              Создать первый сайт
            </button>
          </GlassCard>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {userProjects.map((project) => (
              <div
                key={project.id}
                onClick={() => setLocation(`/editor/${project.id}`)}
                className="group cursor-pointer transition-all duration-500 hover:-translate-y-1.5"
                style={{ borderRadius: '2rem', overflow: 'hidden', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 20px rgba(0,0,0,0.04)', position: 'relative' }}
              >
                {/* Preview */}
                <div style={{ height: 220, position: 'relative', overflow: 'hidden', background: '#FBFBFD', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {project.generatedCode ? (
                    <div style={{ width: '100%', height: '100%', transform: 'scale(0.4)', transformOrigin: 'center', opacity: 0.7, transition: 'all 0.7s', filter: 'blur(1px)' }}
                      className="group-hover:opacity-100 group-hover:blur-none">
                      <iframe srcDoc={project.generatedCode} className="border-none pointer-events-none" style={{ width: '250%', height: '250%' }} />
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
                      className="opacity-0 group-hover:opacity-100 transition-all duration-300"
                      onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(project.id); }}
                      style={{ background: 'rgba(255,59,48,0.08)', border: 'none', borderRadius: 10, padding: '0.4rem', cursor: 'pointer', color: '#FF3B30', flexShrink: 0 }}
                    >
                      <Trash2 style={{ width: 16, height: 16 }} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="p-0 overflow-hidden" style={{ width: '90vw', maxWidth: 860, borderRadius: 24, border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 32px 80px rgba(0,0,0,0.12)', background: '#fff', fontFamily: appleFont }}>
          <div style={{ padding: '2rem 2.5rem', minHeight: 440, display: 'flex', flexDirection: 'column' }}>
            <DialogHeader>
              <DialogTitle style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.035em', color: '#1D1D1F', textAlign: 'center' }}>
                {createStep === "choose" ? "С чего начнём?" : createStep === "templates" ? "Выберите шаблон" : "Оживите мечту"}
              </DialogTitle>
            </DialogHeader>

            <AnimatePresence mode="wait">
              {createStep === "choose" ? (
                <motion.div key="c" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="grid grid-cols-3 gap-4 flex-1 items-center" style={{ marginTop: 32 }}>
                  {[
                    {
                      m: "prompt",
                      t: "По описанию",
                      d: "Просто напишите, что вам нужно",
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
                      m: "template",
                      t: "Промт + Шаблон",
                      d: "Выберите структуру и детали",
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8">
                          <g className="transition-transform duration-500 origin-center group-hover:scale-110">
                            <path d="M12 22L2 17L12 12L22 17L12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-300 transition-transform duration-500 group-hover:translate-y-[3px]" />
                            <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400" />
                            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600 transition-all duration-500 group-hover:-translate-y-[3px] group-hover:fill-indigo-50" />
                          </g>
                        </svg>
                      ),
                    },
                    {
                      m: "photo",
                      t: "По фото",
                      d: "Загрузите скриншот-пример",
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
                      className="group flex flex-col items-center justify-center text-center transition-all duration-300 ease-out hover:-translate-y-1 focus:outline-none"
                      style={{ padding: '2rem 1.5rem', borderRadius: 20, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', minHeight: 180 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 30px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,0,0,0.12)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.02)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,0,0,0.06)'; }}
                      onClick={() => { setSelectedMode(x.m as any); setCreateStep(x.m === "template" ? "templates" : "details"); }}
                    >
                      <div className="flex items-center justify-center mb-4" style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)' }}>
                        {x.icon}
                      </div>
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#1D1D1F', marginBottom: 4, letterSpacing: '-0.02em' }}>{x.t}</h3>
                      <p style={{ fontSize: '0.82rem', color: '#86868B', fontWeight: 400, lineHeight: 1.4 }}>{x.d}</p>
                    </button>
                  ))}
                </motion.div>
              ) : createStep === "templates" ? (
                <motion.div key="t" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="flex flex-col flex-1" style={{ marginTop: 32 }}>
                  <div className="grid grid-cols-3 gap-4 flex-1 items-center">
                  {[
                    {
                      id: "hero-video",
                      t: "Hero с видео",
                      d: "Динамичный фон с видеоплеером",
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9">
                          <g className="transition-transform duration-500 origin-center group-hover:scale-110">
                            <rect x="2" y="3" width="20" height="18" rx="2" fill="white" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 group-hover:text-rose-400 transition-colors duration-500" />
                            <path d="M2 7h20" stroke="currentColor" strokeWidth="1.5" className="text-gray-200" />
                            <circle cx="5" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-red-400 transition-colors duration-300" />
                            <circle cx="7.5" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-yellow-400 transition-colors duration-300 delay-75" />
                            <circle cx="10" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-green-400 transition-colors duration-300 delay-150" />
                            <rect x="6" y="9" width="12" height="10" rx="1" fill="currentColor" className="text-rose-100" />
                            <polygon points="10.5 11.5, 14.5 14, 10.5 16.5" fill="currentColor" className="text-rose-500 transition-transform duration-300 origin-center group-hover:scale-110" />
                          </g>
                        </svg>
                      ),
                    },
                    {
                      id: "hero-photo",
                      t: "Hero с фото",
                      d: "Классический баннер с изображением",
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9">
                          <g className="transition-transform duration-500 origin-center group-hover:scale-110">
                            <rect x="2" y="3" width="20" height="18" rx="2" fill="white" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 group-hover:text-sky-400 transition-colors duration-500" />
                            <path d="M2 7h20" stroke="currentColor" strokeWidth="1.5" className="text-gray-200" />
                            <circle cx="5" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-red-400 transition-colors duration-300" />
                            <circle cx="7.5" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-yellow-400 transition-colors duration-300 delay-75" />
                            <circle cx="10" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-green-400 transition-colors duration-300 delay-150" />
                            <circle cx="16" cy="10" r="2" fill="currentColor" className="text-sky-300" />
                            <path d="M6 22 L 14 13 L 24 22 Z" fill="currentColor" className="text-sky-400" />
                          </g>
                        </svg>
                      ),
                    },
                    {
                      id: "hero-svg",
                      t: "Hero с SVG",
                      d: "Современная интерактивная графика",
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9">
                          <g className="transition-transform duration-500 origin-center group-hover:scale-110">
                            <rect x="2" y="3" width="20" height="18" rx="2" fill="white" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 group-hover:text-emerald-400 transition-colors duration-500" />
                            <path d="M2 7h20" stroke="currentColor" strokeWidth="1.5" className="text-gray-200" />
                            <circle cx="5" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-red-400 transition-colors duration-300" />
                            <circle cx="7.5" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-yellow-400 transition-colors duration-300 delay-75" />
                            <circle cx="10" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-green-400 transition-colors duration-300 delay-150" />
                            <circle cx="7" cy="14" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="transparent" className="text-emerald-400 transition-all duration-700 origin-center group-hover:scale-125" />
                            <polygon points="12 9, 15 15, 9 15" stroke="currentColor" strokeWidth="1.5" fill="transparent" className="text-emerald-500 transition-all duration-700 delay-75 origin-center group-hover:rotate-12" />
                            <rect x="15" y="11" width="4" height="4" stroke="currentColor" strokeWidth="1.5" fill="transparent" className="text-emerald-300 transition-all duration-700 delay-150 origin-center group-hover:-rotate-12" />
                          </g>
                        </svg>
                      ),
                    },
                  ].map(x => (
                    <button
                      key={x.id}
                      data-testid={`button-template-${x.id}`}
                      className="group flex flex-col items-center justify-center text-center transition-all duration-300 ease-out hover:-translate-y-1 focus:outline-none"
                      style={{ padding: '2rem 1.5rem', borderRadius: 20, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', minHeight: 170 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 30px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,0,0,0.12)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.02)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,0,0,0.06)'; }}
                      onClick={() => { setSelectedTemplate(x.t); setCreateStep("details"); }}
                    >
                      <div className="flex items-center justify-center mb-4" style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)' }}>
                        {x.icon}
                      </div>
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#1D1D1F', marginBottom: 4, letterSpacing: '-0.02em' }}>{x.t}</h3>
                      <p style={{ fontSize: '0.82rem', color: '#86868B', fontWeight: 400, lineHeight: 1.4 }}>{x.d}</p>
                    </button>
                  ))}
                  </div>
                  <button
                    data-testid="button-templates-back"
                    className="transition-colors self-center mt-4"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600, color: '#86868B' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#1D1D1F'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#86868B'; }}
                    onClick={() => setCreateStep("choose")}
                  >
                    ← Назад
                  </button>
                </motion.div>
              ) : (
                <motion.div key="d" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col flex-1" style={{ marginTop: 20 }}>
                  <div className="grid gap-6 flex-1" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <div className="flex flex-col gap-3">
                      <div className="space-y-1.5">
                        <Label style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#86868B', paddingLeft: 4 }}>Название</Label>
                        <Input
                          placeholder="Например: Моё кафе"
                          value={title}
                          onChange={e => setTitle(e.target.value)}
                          className="h-10 rounded-xl font-medium text-gray-900 placeholder:text-gray-400 text-sm"
                          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
                        />
                      </div>
                      <div className="space-y-1.5 flex-1 flex flex-col">
                        <div className="flex items-center justify-between px-1">
                          <Label style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#86868B' }}>Описание</Label>
                          {isEnhanced && (
                            <span data-testid="text-enhanced-status" className="flex items-center gap-1" style={{ fontSize: '0.65rem', fontWeight: 600, color: '#34C759' }}>
                              <Sparkles className="w-3 h-3" /> Улучшено AI
                            </span>
                          )}
                        </div>
                        <Textarea
                          placeholder={selectedMode === "photo" ? "Воссоздай этот дизайн, замени текст на русский" : "Сайт SPA студии, в бежевых тонах, с картинкой в Hero секции, и плавной анимацией"}
                          value={description}
                          onChange={e => { setDescription(e.target.value); if (isEnhanced) setIsEnhanced(false); }}
                          className="rounded-xl font-medium text-gray-900 placeholder:text-gray-400 text-sm flex-1"
                          style={{ background: isEnhanced ? 'rgba(52,199,89,0.04)' : 'rgba(0,0,0,0.03)', border: isEnhanced ? '1px solid rgba(52,199,89,0.3)' : '1px solid rgba(0,0,0,0.08)', resize: 'none', minHeight: selectedMode === "photo" ? 80 : 120 }}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-3">
                      {selectedMode === "photo" ? (
                        <div className="flex flex-col gap-3 flex-1">
                          <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#86868B', paddingLeft: 4 }}>Скриншот / макет</div>
                          <input
                            ref={photoInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            data-testid="input-photo-upload"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              if (file.size > 5 * 1024 * 1024) {
                                toast({ title: "Файл слишком большой", description: "Максимум 5 МБ", variant: "destructive" });
                                return;
                              }
                              const img = new Image();
                              img.onload = () => {
                                const MAX_DIM = 1920;
                                let w = img.width, h = img.height;
                                if (w > MAX_DIM || h > MAX_DIM) {
                                  const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
                                  w = Math.round(w * ratio);
                                  h = Math.round(h * ratio);
                                }
                                const canvas = document.createElement("canvas");
                                canvas.width = w;
                                canvas.height = h;
                                const ctx = canvas.getContext("2d")!;
                                ctx.drawImage(img, 0, 0, w, h);
                                const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
                                const base64 = dataUrl.split(",")[1];
                                setPhotoImage({ base64, mimeType: "image/jpeg", preview: dataUrl });
                                URL.revokeObjectURL(img.src);
                              };
                              img.src = URL.createObjectURL(file);
                            }}
                          />
                          {photoImage ? (
                            <div className="relative flex-1 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.04)' }}>
                              <img src={photoImage.preview} alt="Макет" className="w-full h-full object-contain" style={{ maxHeight: 200 }} />
                              <button
                                type="button"
                                data-testid="button-remove-photo"
                                onClick={() => { setPhotoImage(null); if (photoInputRef.current) photoInputRef.current.value = ''; }}
                                className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full transition-all hover:scale-110"
                                style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer' }}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                              <div className="absolute bottom-2 left-2 px-2 py-1 rounded-md" style={{ background: 'rgba(139,92,246,0.85)', backdropFilter: 'blur(8px)' }}>
                                <span className="text-white text-[10px] font-semibold flex items-center gap-1">
                                  <ImageIcon className="w-3 h-3" /> Макет загружен
                                </span>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              data-testid="button-upload-photo"
                              onClick={() => photoInputRef.current?.click()}
                              className="flex-1 flex flex-col items-center justify-center gap-3 rounded-xl transition-all hover:border-purple-400"
                              style={{ border: '2px dashed rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.02)', minHeight: 140, cursor: 'pointer' }}
                            >
                              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.08)' }}>
                                <Upload className="w-6 h-6" style={{ color: '#8B5CF6' }} />
                              </div>
                              <div className="text-center">
                                <p className="text-sm font-semibold" style={{ color: '#6D28D9' }}>Загрузить скриншот</p>
                                <p className="text-xs mt-1" style={{ color: '#A78BFA' }}>PNG, JPG, WEBP до 5 МБ</p>
                              </div>
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
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
                        </>
                      )}
                    </div>
                  </div>
                  <div className={`grid gap-3 ${selectedMode === "photo" ? "grid-cols-2" : "grid-cols-4"}`} style={{ marginTop: 16 }}>
                    <button
                      className="h-10 font-semibold transition-all text-sm"
                      style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, color: '#86868B', cursor: 'pointer' }}
                      onClick={() => { setCreateStep(selectedMode === "template" ? "templates" : "choose"); setIsEnhanced(false); }}
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
                      className="h-10 flex items-center justify-center gap-1.5 font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ border: isEnhanced ? '1px solid rgba(52,199,89,0.4)' : '1.5px dashed rgba(0,0,0,0.12)', background: isEnhanced ? 'rgba(52,199,89,0.06)' : 'transparent', color: isEnhanced ? '#1D8348' : '#86868B', borderRadius: 12, cursor: 'pointer' }}
                    >
                      {isEnhancing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isEnhanced ? <Sparkles className="w-3.5 h-3.5" /> : <Wand2 className="w-3.5 h-3.5" />}
                      {isEnhancing ? 'Улучшаем...' : isEnhanced ? 'Улучшено' : 'AI улучшение'}
                    </button>
                    )}
                    {selectedMode !== "photo" && (
                    <button
                      data-testid="button-deep-research"
                      type="button"
                      onClick={async () => {
                        if (isEnhancing || isResearching) return;
                        if (researchData) { setDeepResearchEnabled(false); setResearchData(""); toast({ title: "Deep Research отключён" }); return; }
                        if (!description.trim() || description.trim().length < 3) {
                          toast({ title: "Введите описание", description: "Напишите хотя бы несколько слов для исследования", variant: "destructive" });
                          return;
                        }
                        setIsResearching(true); setDeepResearchEnabled(true);
                        queryClient.setQueryData(["/api/auth/user"], (old: any) => old ? { ...old, credits: Math.max(0, old.credits - 10) } : old);
                        try {
                          const res = await apiRequest("POST", "/api/deep-research", { prompt: description });
                          const data = await res.json();
                          if (data.newBalance !== undefined) { queryClient.setQueryData(["/api/auth/user"], (old: any) => old ? { ...old, credits: data.newBalance } : old); }
                          if (data.warning) { toast({ title: "Внимание", description: data.warning }); setDeepResearchEnabled(false); }
                          else if (data.research) { setResearchData(data.research); toast({ title: "Deep Research завершён!", description: "Реальные факты будут использованы при генерации сайта" }); }
                        } catch (err: any) {
                          let msg = "Не удалось провести исследование";
                          try { const t = err?.message || ""; const m = t.match(/\{.*\}/); if (m) { const p = JSON.parse(m[0]); if (p.message) msg = p.message; } } catch {}
                          toast({ title: "Ошибка", description: msg, variant: "destructive" }); setDeepResearchEnabled(false);
                        } finally { setIsResearching(false); }
                      }}
                      disabled={isEnhancing || isResearching || !description.trim()}
                      className="h-10 flex items-center justify-center gap-1.5 font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ border: researchData ? '1px solid rgba(0,113,227,0.3)' : '1.5px dashed rgba(0,0,0,0.12)', background: researchData ? 'rgba(0,113,227,0.06)' : 'transparent', color: researchData ? '#0058b3' : '#86868B', borderRadius: 12, cursor: 'pointer' }}
                    >
                      {isResearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : researchData ? <Globe className="w-3.5 h-3.5" /> : <Search className="w-3.5 h-3.5" />}
                      {isResearching ? 'Исследуем...' : researchData ? 'Исследовано' : 'Deep Research'}
                    </button>
                    )}
                    <button
                      className="h-10 font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                      style={{ background: 'linear-gradient(135deg,#1D1D1F,#3a3a3c)', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}
                      onClick={() => {
                        if (selectedMode === "photo" && !photoImage) {
                          toast({ title: "Загрузите скриншот", description: "Для режима «По фото» нужно загрузить изображение макета", variant: "destructive" });
                          return;
                        }
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
        </DialogContent>
      </Dialog>

      <Dialog open={showTopUpModal} onOpenChange={setShowTopUpModal}>
        <DialogContent className="p-0 overflow-visible" style={{ maxWidth: 900, borderRadius: 28, border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 40px 100px rgba(0,0,0,0.5)', background: 'linear-gradient(135deg,#1e1e24 10%,#050505 60%)', fontFamily: appleFont }}>
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes m2-gradient-shift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
            @keyframes m2-blur{to{filter:blur(3vmin);transform:scale(1.05)}}
            .topup-m2card{
              position:relative;border-radius:24px;
              background:linear-gradient(135deg,#1e1e24 10%,#050505 60%);
              background-size:200% 200%;
              animation:m2-gradient-shift 5s ease-in-out infinite;
              display:flex;flex-direction:column;align-items:center;
              padding:2rem 1.25rem;cursor:pointer;color:inherit;
              transition:transform .4s cubic-bezier(.2,.8,.2,1);
              border:none;text-align:center;width:100%;
            }
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
          <div style={{ padding: '2.5rem 2.5rem 2.5rem' }}>
            <DialogHeader>
              <DialogTitle style={{ fontSize: '1.8rem', fontWeight: 700, letterSpacing: '-0.035em', color: '#fff' }}>
                Пополнить баланс
              </DialogTitle>
            </DialogHeader>
            <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.45)', marginTop: '0.4rem', marginBottom: '2rem' }}>Выберите подходящий тариф для пополнения токенов</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
              {[
                { price: 990,  tokens: 1000, label: "Старт",   popular: false, desc: ["1 сайт", "10 итераций редактирования"] },
                { price: 1690, tokens: 1900, label: "Базовый", popular: false, desc: ["2 сайта", "19 итераций редактирования"] },
                { price: 3990, tokens: 4500, label: "Профи",   popular: false, desc: ["3 сайта", "45 итераций редактирования", "Премиум шаблоны"] },
                { price: 5990, tokens: 6500, label: "Ультра",  popular: true,  desc: ["5 сайтов", "65 итераций редактирования", "Премиум шаблоны"] },
              ].map((plan) => (
                <div key={plan.price} style={{ position: 'relative' }}>
                  {plan.popular && (
                    <span style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(90deg,hsl(27deg 93% 60%),#00a6ff,#6500ff)', color: '#fff', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', padding: '0.28rem 0.9rem', borderRadius: 100, whiteSpace: 'nowrap', zIndex: 3 }}>
                      Популярный
                    </span>
                  )}
                  <button
                    className="topup-m2card"
                    data-testid={`button-plan-${plan.price}`}
                    onClick={() => { toast({ title: "Скоро!", description: "Оплата будет доступна в ближайшее время" }); }}
                  >
                    <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: plan.popular ? '#00d2ff' : 'rgba(255,255,255,0.5)', marginBottom: '0.6rem' }}>{plan.label}</span>
                    <span style={{ fontSize: '2.2rem', fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1, color: '#fff' }}>{plan.tokens.toLocaleString("ru-RU")}</span>
                    <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginTop: '0.3rem', marginBottom: '1rem' }}>токенов</span>
                    <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.07)', marginBottom: '1rem' }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '1rem', width: '100%', minHeight: '4.2rem', justifyContent: 'center' }}>
                      {plan.desc.map((line, i) => (
                        <span key={i} style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.4, textAlign: 'center' }}>{line}</span>
                      ))}
                    </div>
                    <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.07)', marginBottom: '1rem' }} />
                    <span style={{ fontSize: '1.15rem', fontWeight: 600, letterSpacing: '-0.02em', color: plan.popular ? '#00d2ff' : '#fff' }}>{plan.price.toLocaleString("ru-RU")} ₽</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
