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
} from "lucide-react";

const SkeuoCard = ({ children, className = "", onClick = undefined }) => (
  <div 
    onClick={onClick}
    className={`bg-white/40 backdrop-blur-md border border-white/20 shadow-glass hover:shadow-xl transition-all duration-500 rounded-[2rem] p-6 ${onClick ? 'cursor-pointer hover:-translate-y-1 active:scale-[0.98]' : ''} ${className}`}
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
      const prompt = selectedMode === "template" ? `Создай сайт: ${selectedTemplate}. ${description}` : description || title;
      const enhancedParam = isEnhanced ? "&enhanced=1" : "";
      const researchParam = researchData ? `&research=${encodeURIComponent(researchData)}` : "";
      setLocation(`/editor/${project.id}?prompt=${encodeURIComponent(prompt)}${enhancedParam}${researchParam}`);
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

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-20 relative overflow-hidden">
      {/* Decorative Orbs */}
      <div className="absolute top-[-5%] left-[-5%] w-[35%] h-[35%] bg-indigo-400/10 rounded-full blur-[100px] pointer-events-none animate-pulse" />
      <div className="absolute bottom-[-5%] right-[-5%] w-[35%] h-[35%] bg-blue-400/10 rounded-full blur-[100px] pointer-events-none animate-pulse" style={{ animationDelay: '1s' }} />
      
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(120,119,198,0.06),transparent_50%)] pointer-events-none" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-200 to-transparent opacity-30" />
      
      <header className="fixed top-6 w-full z-50 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between bg-white/80 backdrop-blur-xl border border-white/20 rounded-[2.5rem] px-8 py-3 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-black tracking-tight text-xl text-slate-900">NEURO</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLocation("/leads")}
              className="group relative flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-full px-5 py-2 hover:bg-indigo-50 hover:border-indigo-100 transition-all shadow-sm"
              data-testid="button-leads"
            >
              <Inbox className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />
              <span className="text-xs font-bold text-slate-600 group-hover:text-indigo-900">Лиды</span>
              {(unreadData?.count ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-indigo-600 text-white text-[10px] font-black rounded-full px-1 shadow-md">
                  {unreadData!.count}
                </span>
              )}
            </button>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-full px-5 py-2 shadow-sm">
              <Coins className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-bold text-slate-900">{user?.credits}</span>
            </div>
            <Button
              data-testid="button-topup"
              variant="outline"
              size="sm"
              className="rounded-full font-bold text-xs h-9 px-5 border-indigo-100 text-indigo-600 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-all shadow-sm"
              onClick={() => setShowTopUpModal(true)}
            >
              Пополнить
            </Button>
            <div className="w-px h-6 bg-slate-200 mx-1" />
            <Button variant="ghost" size="icon" className="rounded-full w-9 h-9 text-slate-400 hover:text-slate-900 hover:bg-slate-100" onClick={logout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-36 space-y-12">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-5xl font-black tracking-tight text-slate-900 leading-none">Ваши проекты</h1>
            <p className="text-slate-500 font-medium text-lg">Создайте что-то потрясающее сегодня</p>
          </div>
          <Button 
            className="h-14 px-10 rounded-2xl font-black text-lg bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all hover:scale-[1.02] active:scale-[0.98]"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus className="w-6 h-6 mr-2" />
            Новый сайт
          </Button>
        </div>

        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1,2,3].map(i => <div key={i} className="h-72 rounded-[2rem] bg-slate-100 animate-pulse" />)}
          </div>
        ) : userProjects.length === 0 ? (
          <SkeuoCard className="flex flex-col items-center justify-center py-32 text-center space-y-8">
            <div className="w-24 h-24 rounded-[2rem] bg-slate-50 border border-slate-100 flex items-center justify-center">
              <FolderOpen className="w-12 h-12 text-slate-200" />
            </div>
            <div className="space-y-3">
              <h2 className="text-3xl font-black text-slate-900">Пока здесь пусто</h2>
              <p className="text-slate-400 max-w-sm mx-auto text-lg font-medium">Создайте свой первый проект, используя возможности искусственного интеллекта.</p>
            </div>
            <Button onClick={() => setShowCreateModal(true)} className="rounded-2xl h-14 px-8 font-black text-lg bg-slate-900 hover:bg-slate-800 shadow-lg">
              Создать первый сайт
            </Button>
          </SkeuoCard>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-10">
            {userProjects.map((project) => (
              <SkeuoCard 
                key={project.id} 
                className="group p-0 overflow-hidden relative"
                onClick={() => setLocation(`/editor/${project.id}`)}
              >
                <div className="h-56 bg-white relative overflow-hidden flex items-center justify-center">
                  {project.generatedCode ? (
                    <div className="w-full h-full scale-[0.4] origin-center opacity-60 group-hover:opacity-100 transition-all duration-700 blur-[2px] group-hover:blur-0">
                       <iframe srcDoc={project.generatedCode} className="w-[250%] h-[250%] border-none pointer-events-none" />
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-3xl bg-slate-50 border border-slate-100 flex items-center justify-center">
                      <Code2 className="w-10 h-10 text-slate-200" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-white/95 via-white/20 to-transparent transition-opacity duration-500 group-hover:opacity-40" />
                </div>
                
                <div className="absolute bottom-0 left-0 right-0 p-8 pt-12 bg-gradient-to-t from-white via-white/90 to-transparent">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="text-2xl font-black text-slate-900 truncate leading-tight mb-1 group-hover:text-indigo-600 transition-colors">{project.title}</h3>
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(project.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 text-slate-300 hover:text-destructive hover:bg-destructive/5 rounded-xl"
                      onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(project.id); }}
                    >
                      <Trash2 className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              </SkeuoCard>
            ))}
          </div>
        )}
      </main>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="sm:max-w-[540px] rounded-[32px] p-0 overflow-hidden border border-gray-100/50 shadow-2xl bg-white">
          <div className="px-8 pt-10 pb-8">
            <DialogHeader>
              <DialogTitle className="text-3xl font-extrabold text-gray-900 tracking-tight">
                {createStep === "choose" ? "С чего начнём?" : createStep === "templates" ? "Выберите шаблон" : "Оживите мечту"}
              </DialogTitle>
            </DialogHeader>

            <AnimatePresence mode="wait">
              {createStep === "choose" ? (
                <motion.div key="c" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="flex flex-col gap-4 mt-8">
                  {[
                    {
                      m: "prompt",
                      t: "По описанию",
                      d: "Просто напишите, что вам нужно",
                      colorClass: "hover:border-blue-200/50 hover:bg-blue-50/30",
                      iconBgClass: "bg-blue-50 group-hover:bg-blue-100/50",
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 relative z-10 overflow-visible">
                          <g className="transition-transform duration-500 origin-center group-hover:scale-105 group-hover:-translate-y-0.5">
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
                      colorClass: "hover:border-indigo-200/50 hover:bg-indigo-50/30",
                      iconBgClass: "bg-indigo-50 group-hover:bg-indigo-100/50",
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 relative z-10 overflow-visible">
                          <g className="transition-transform duration-500 origin-center group-hover:scale-105">
                            <path d="M12 22L2 17L12 12L22 17L12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-300 transition-transform duration-500 group-hover:translate-y-[3px]" />
                            <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400 transition-transform duration-500" />
                            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600 transition-all duration-500 group-hover:-translate-y-[3px] group-hover:fill-indigo-50" />
                          </g>
                        </svg>
                      ),
                    },
                    {
                      m: "photo",
                      t: "По фото",
                      d: "Загрузите скриншот-пример",
                      colorClass: "hover:border-purple-200/50 hover:bg-purple-50/30",
                      iconBgClass: "bg-purple-50 group-hover:bg-purple-100/50",
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 relative z-10 overflow-visible">
                          <defs>
                            <clipPath id="photo-mask">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            </clipPath>
                          </defs>
                          <g className="transition-transform duration-500 origin-center group-hover:scale-105">
                            <g clipPath="url(#photo-mask)">
                              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" className="text-purple-400 transition-all duration-500 origin-center group-hover:scale-[2.5] group-hover:translate-x-1 group-hover:text-yellow-400" />
                              <path d="M21 15L16 10L5 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-500/70 transition-transform duration-500 origin-bottom group-hover:translate-y-1 group-hover:scale-105" />
                              <path d="M5 21L14 12L21 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-600 transition-transform duration-700 ease-out origin-bottom group-hover:scale-110" />
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
                      className={`group relative flex items-center w-full p-4 rounded-2xl bg-slate-50/50 border border-slate-100/50 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-slate-100 ${x.colorClass}`}
                      onClick={() => { setSelectedMode(x.m as any); setCreateStep(x.m === "template" ? "templates" : "details"); }}
                    >
                      <div className={`flex-shrink-0 w-16 h-16 rounded-xl flex items-center justify-center mr-5 transition-colors duration-300 relative overflow-hidden ${x.iconBgClass}`}>
                        <div className="absolute inset-0 bg-white/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl blur-md" />
                        {x.icon}
                      </div>
                      <div className="flex-grow text-left">
                        <h3 className="text-[19px] font-bold text-slate-900 mb-1 group-hover:text-black transition-colors">{x.t}</h3>
                        <p className="text-[15px] text-slate-500 font-medium group-hover:text-slate-600 transition-colors">{x.d}</p>
                      </div>
                      <div className="flex-shrink-0 text-slate-300 group-hover:text-slate-900 transition-all duration-300 transform group-hover:translate-x-1">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                      </div>
                    </button>
                  ))}
                </motion.div>
              ) : createStep === "templates" ? (
                <motion.div key="t" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="flex flex-col gap-4 mt-8">
                  {[
                    {
                      id: "hero-video",
                      t: "Hero с видео",
                      d: "Динамичный фон с видеоплеером",
                      colorClass: "group-hover:border-rose-200 group-hover:shadow-rose-500/15 group-hover:bg-rose-50/30",
                      iconBgClass: "bg-rose-100/50 group-hover:bg-rose-100",
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9 relative z-10 overflow-visible">
                          <g className="transition-transform duration-500 origin-center group-hover:scale-105">
                            <rect x="2" y="3" width="20" height="18" rx="2" fill="white" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 transition-colors duration-500" />
                            <path d="M2 7h20" stroke="currentColor" strokeWidth="1.5" className="text-gray-200" />
                            <circle cx="5" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-red-400 transition-colors duration-300" />
                            <circle cx="7.5" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-yellow-400 transition-colors duration-300 delay-75" />
                            <circle cx="10" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-green-400 transition-colors duration-300 delay-150" />
                            <rect x="6" y="9" width="12" height="10" rx="1" fill="currentColor" className="text-rose-100 group-hover:text-rose-50 transition-colors duration-500" />
                            <polygon points="10.5 11.5, 14.5 14, 10.5 16.5" fill="currentColor" className="text-rose-500 transition-transform duration-300 origin-center group-hover:scale-110" />
                            <rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 group-hover:text-rose-400 transition-colors duration-500" />
                          </g>
                        </svg>
                      ),
                    },
                    {
                      id: "hero-photo",
                      t: "Hero с фото",
                      d: "Классический баннер с изображением",
                      colorClass: "group-hover:border-sky-200 group-hover:shadow-sky-500/15 group-hover:bg-sky-50/30",
                      iconBgClass: "bg-sky-100/50 group-hover:bg-sky-100",
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9 relative z-10 overflow-visible">
                          <g className="transition-transform duration-500 origin-center group-hover:scale-105">
                            <rect x="2" y="3" width="20" height="18" rx="2" fill="white" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 transition-colors duration-500" />
                            <path d="M2 7h20" stroke="currentColor" strokeWidth="1.5" className="text-gray-200" />
                            <circle cx="5" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-red-400 transition-colors duration-300" />
                            <circle cx="7.5" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-yellow-400 transition-colors duration-300 delay-75" />
                            <circle cx="10" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-green-400 transition-colors duration-300 delay-150" />
                            <circle cx="16" cy="10" r="2" fill="currentColor" className="text-sky-300 transition-transform duration-700 origin-center group-hover:scale-150 group-hover:-translate-y-1" />
                            <path d="M-2 22 L 8 10 L 14 16 L 26 22 Z" fill="currentColor" className="text-sky-100 group-hover:text-sky-200 transition-all duration-500 group-hover:translate-y-1" />
                            <path d="M6 22 L 14 13 L 24 22 Z" fill="currentColor" className="text-sky-400 transition-all duration-700 group-hover:-translate-x-1 group-hover:scale-105 origin-bottom" />
                            <rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 group-hover:text-sky-400 transition-colors duration-500" />
                          </g>
                        </svg>
                      ),
                    },
                    {
                      id: "hero-svg",
                      t: "Hero с SVG анимацией",
                      d: "Современная интерактивная графика",
                      colorClass: "group-hover:border-emerald-200 group-hover:shadow-emerald-500/15 group-hover:bg-emerald-50/30",
                      iconBgClass: "bg-emerald-100/50 group-hover:bg-emerald-100",
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9 relative z-10 overflow-visible">
                          <g className="transition-transform duration-500 origin-center group-hover:scale-105">
                            <rect x="2" y="3" width="20" height="18" rx="2" fill="white" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 transition-colors duration-500" />
                            <path d="M2 7h20" stroke="currentColor" strokeWidth="1.5" className="text-gray-200" />
                            <circle cx="5" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-red-400 transition-colors duration-300" />
                            <circle cx="7.5" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-yellow-400 transition-colors duration-300 delay-75" />
                            <circle cx="10" cy="5" r="0.75" fill="currentColor" className="text-gray-300 group-hover:text-green-400 transition-colors duration-300 delay-150" />
                            <circle cx="7" cy="14" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="transparent" className="text-emerald-400 transition-all duration-700 origin-center group-hover:scale-125 group-hover:-translate-y-2 group-hover:translate-x-1" />
                            <polygon points="12 9, 15 15, 9 15" stroke="currentColor" strokeWidth="1.5" fill="transparent" className="text-emerald-500 transition-all duration-700 delay-75 origin-center group-hover:rotate-12 group-hover:-translate-y-1" />
                            <rect x="15" y="11" width="4" height="4" stroke="currentColor" strokeWidth="1.5" fill="transparent" className="text-emerald-300 transition-all duration-700 delay-150 origin-center group-hover:-rotate-12 group-hover:-translate-y-2 group-hover:-translate-x-1" />
                            <rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 group-hover:text-emerald-400 transition-colors duration-500" />
                          </g>
                        </svg>
                      ),
                    },
                  ].map(x => (
                    <button
                      key={x.id}
                      data-testid={`button-template-${x.id}`}
                      className={`group relative flex items-center w-full p-4 rounded-2xl bg-gray-50/50 border border-transparent transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-gray-100 ${x.colorClass}`}
                      onClick={() => { setSelectedTemplate(x.t); setCreateStep("details"); }}
                    >
                      <div className={`flex-shrink-0 w-16 h-16 rounded-xl flex items-center justify-center mr-5 transition-colors duration-300 relative overflow-hidden ${x.iconBgClass}`}>
                        <div className="absolute inset-0 bg-white/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl blur-md" />
                        {x.icon}
                      </div>
                      <div className="flex-grow text-left">
                        <h3 className="text-[19px] font-bold text-gray-900 mb-1 group-hover:text-black transition-colors">{x.t}</h3>
                        <p className="text-[15px] text-gray-500 font-medium group-hover:text-gray-600 transition-colors">{x.d}</p>
                      </div>
                      <div className="flex-shrink-0 text-gray-300 group-hover:text-gray-900 transition-all duration-300 transform group-hover:translate-x-1">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                      </div>
                    </button>
                  ))}
                  <button
                    data-testid="button-templates-back"
                    className="text-gray-500 font-bold hover:text-gray-900 transition-colors px-2 py-3 text-[15px] self-start mt-2"
                    onClick={() => setCreateStep("choose")}
                  >
                    ← Назад
                  </button>
                </motion.div>
              ) : (
                <motion.div key="d" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6 mt-8">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest text-gray-400 px-2">Название</Label>
                    <Input 
                      placeholder="Например: Моё кафе"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      className="h-14 rounded-2xl bg-gray-50 border border-gray-200 font-bold text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-gray-400">Описание</Label>
                      {isEnhanced && (
                        <span data-testid="text-enhanced-status" className="text-xs font-semibold text-emerald-500 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" /> Улучшено AI
                        </span>
                      )}
                    </div>
                    <Textarea 
                      placeholder="Опишите структуру, цвета и контент..."
                      value={description}
                      onChange={e => { setDescription(e.target.value); if (isEnhanced) setIsEnhanced(false); }}
                      className={`min-h-[120px] rounded-2xl bg-gray-50 border font-medium text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all ${isEnhanced ? 'border-emerald-300 bg-emerald-50/30 min-h-[200px] text-sm' : 'border-gray-200'}`}
                    />
                  </div>
                  <div className="flex gap-3">
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
                        try {
                          const res = await apiRequest("POST", "/api/enhance-prompt", { prompt: description });
                          const data = await res.json();
                          if (data.warning) {
                            toast({ title: "Внимание", description: data.warning });
                          } else if (data.enhancedPrompt) {
                            setDescription(data.enhancedPrompt);
                            setIsEnhanced(true);
                            toast({ title: "Промпт улучшен!", description: "Проверьте описание и нажмите «Создать проект»" });
                          }
                        } catch (err: any) {
                          let msg = "Не удалось улучшить промпт";
                          try {
                            const errText = err?.message || "";
                            const jsonMatch = errText.match(/\{.*\}/);
                            if (jsonMatch) {
                              const parsed = JSON.parse(jsonMatch[0]);
                              if (parsed.message) msg = parsed.message;
                            }
                          } catch {}
                          toast({ title: "Ошибка", description: msg, variant: "destructive" });
                        } finally {
                          setIsEnhancing(false);
                        }
                      }}
                      disabled={isEnhancing || isResearching || !description.trim()}
                      className={`flex-1 flex items-center justify-center gap-2 h-11 rounded-2xl font-bold text-sm transition-all duration-300 border-2 ${
                        isEnhanced
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : isEnhancing
                          ? "border-violet-300 bg-violet-50 text-violet-600"
                          : "border-dashed border-violet-200 text-violet-500 hover:border-violet-400 hover:bg-violet-50/50"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {isEnhancing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Улучшаем...</span>
                        </>
                      ) : isEnhanced ? (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>Улучшено</span>
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-4 h-4" />
                          <span>AI улучшение</span>
                        </>
                      )}
                    </button>
                    <button
                      data-testid="button-deep-research"
                      type="button"
                      onClick={async () => {
                        if (isEnhancing || isResearching) return;
                        if (researchData) {
                          setDeepResearchEnabled(false);
                          setResearchData("");
                          toast({ title: "Deep Research отключён", description: "Исследование не будет использовано" });
                          return;
                        }
                        if (!description.trim() || description.trim().length < 3) {
                          toast({ title: "Введите описание", description: "Напишите хотя бы несколько слов для исследования", variant: "destructive" });
                          return;
                        }
                        setIsResearching(true);
                        setDeepResearchEnabled(true);
                        try {
                          const res = await apiRequest("POST", "/api/deep-research", { prompt: description });
                          const data = await res.json();
                          if (data.warning) {
                            toast({ title: "Внимание", description: data.warning });
                            setDeepResearchEnabled(false);
                          } else if (data.research) {
                            setResearchData(data.research);
                            toast({ title: "Deep Research завершён!", description: "Реальные факты будут использованы при генерации сайта" });
                          }
                        } catch (err: any) {
                          let msg = "Не удалось провести исследование";
                          try {
                            const errText = err?.message || "";
                            const jsonMatch = errText.match(/\{.*\}/);
                            if (jsonMatch) {
                              const parsed = JSON.parse(jsonMatch[0]);
                              if (parsed.message) msg = parsed.message;
                            }
                          } catch {}
                          toast({ title: "Ошибка", description: msg, variant: "destructive" });
                          setDeepResearchEnabled(false);
                        } finally {
                          setIsResearching(false);
                        }
                      }}
                      disabled={isEnhancing || isResearching || !description.trim()}
                      className={`flex-1 flex items-center justify-center gap-2 h-11 rounded-2xl font-bold text-sm transition-all duration-300 border-2 ${
                        researchData
                          ? "border-blue-300 bg-blue-50 text-blue-700"
                          : isResearching
                          ? "border-blue-300 bg-blue-50 text-blue-600"
                          : "border-dashed border-blue-200 text-blue-500 hover:border-blue-400 hover:bg-blue-50/50"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {isResearching ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Исследуем...</span>
                        </>
                      ) : researchData ? (
                        <>
                          <Globe className="w-4 h-4" />
                          <span>Исследовано</span>
                        </>
                      ) : (
                        <>
                          <Search className="w-4 h-4" />
                          <span>Deep Research</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="flex gap-4 pt-2">
                    <Button variant="ghost" className="h-14 rounded-2xl font-bold flex-1 text-gray-600 hover:bg-gray-100" onClick={() => { setCreateStep(selectedMode === "template" ? "templates" : "choose"); setIsEnhanced(false); }}>Назад</Button>
                    <Button 
                      className="h-14 rounded-2xl font-extrabold text-lg flex-[2] shadow-xl shadow-primary/20"
                      onClick={() => createMutation.mutate()}
                      disabled={createMutation.isPending || isEnhancing || isResearching}
                    >
                      {createMutation.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : "Создать проект"}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showTopUpModal} onOpenChange={setShowTopUpModal}>
        <DialogContent className="sm:max-w-[560px] rounded-[32px] p-0 overflow-hidden border border-gray-100/50 shadow-2xl bg-white">
          <div className="px-8 pt-10 pb-8">
            <DialogHeader>
              <DialogTitle className="text-3xl font-extrabold text-gray-900 tracking-tight">
                Пополнить баланс
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-slate-500 mt-2 mb-6">Выберите подходящий тариф для пополнения токенов</p>
            <div className="grid grid-cols-2 gap-4">
              {[
                { price: 990, tokens: 1000, popular: false },
                { price: 1690, tokens: 1900, popular: true },
                { price: 3990, tokens: 4500, popular: false },
                { price: 5990, tokens: 6000, popular: false },
              ].map((plan) => (
                <button
                  key={plan.price}
                  data-testid={`button-plan-${plan.price}`}
                  onClick={() => {
                    toast({ title: "Скоро!", description: "Оплата будет доступна в ближайшее время" });
                  }}
                  className={`relative flex flex-col items-center p-6 rounded-2xl border-2 transition-all duration-200 text-center group ${
                    plan.popular
                      ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                      : "border-gray-200 hover:border-primary/40 hover:bg-gray-50"
                  }`}
                >
                  {plan.popular && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white text-[10px] font-black px-3 py-0.5 rounded-full uppercase tracking-wider">
                      Выгодно
                    </span>
                  )}
                  <span className="text-3xl font-black text-gray-900">{plan.tokens.toLocaleString("ru-RU")}</span>
                  <span className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">токенов</span>
                  <div className="mt-4 w-full pt-4 border-t border-gray-100">
                    <span className="text-lg font-extrabold text-gray-800">{plan.price.toLocaleString("ru-RU")} ₽</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
