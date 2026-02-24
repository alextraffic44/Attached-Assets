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
} from "lucide-react";

const SkeuoCard = ({ children, className = "", onClick = undefined }) => (
  <div 
    onClick={onClick}
    className={`bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-skeuo-md hover:shadow-skeuo-lg transition-all duration-300 rounded-[2rem] p-6 ${onClick ? 'cursor-pointer' : ''} ${className}`}
  >
    {children}
  </div>
);

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createStep, setCreateStep] = useState<"choose" | "details">("choose");
  const [selectedMode, setSelectedMode] = useState<"prompt" | "template" | "photo">("prompt");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");

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
      setLocation(`/editor/${project.id}?prompt=${encodeURIComponent(prompt)}`);
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
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0F172A] pb-20">
      <header className="fixed top-0 w-full z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between bg-white/40 dark:bg-black/20 backdrop-blur-xl border border-white/20 dark:border-white/5 rounded-2xl px-6 py-3 shadow-glass">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-chart-3 flex items-center justify-center shadow-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-black tracking-tight uppercase text-sm">НЕЙРОЗОДЧИЙ</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLocation("/leads")}
              className="relative flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-full px-4 py-1.5 shadow-skeuo-inner hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              data-testid="button-leads"
            >
              <Inbox className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-black">Лиды</span>
              {(unreadData?.count ?? 0) > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center bg-emerald-500 text-white text-[10px] font-black rounded-full px-1 shadow-lg shadow-emerald-500/30">
                  {unreadData!.count}
                </span>
              )}
            </button>
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-full px-4 py-1.5 shadow-skeuo-inner">
              <Coins className="w-4 h-4 text-primary" />
              <span className="text-xs font-black">{user?.credits}</span>
            </div>
            <Button variant="ghost" size="icon" className="rounded-full" onClick={logout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-28 space-y-12">
        <div className="flex items-end justify-between">
          <div className="space-y-1">
            <h1 className="text-4xl font-black tracking-tighter">Ваши проекты</h1>
            <p className="text-slate-500 font-medium">Создайте что-то потрясающее сегодня</p>
          </div>
          <Button 
            className="h-14 px-8 rounded-2xl font-black text-lg shadow-xl shadow-primary/20 hover-elevate"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus className="w-5 h-5 mr-2" />
            Новый сайт
          </Button>
        </div>

        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1,2,3].map(i => <div key={i} className="h-64 rounded-[2rem] bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
          </div>
        ) : userProjects.length === 0 ? (
          <SkeuoCard className="flex flex-col items-center justify-center py-24 text-center space-y-6">
            <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shadow-skeuo-inner">
              <FolderOpen className="w-10 h-10 text-slate-300" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">Пока здесь пусто</h2>
              <p className="text-slate-500 max-w-xs mx-auto">Создайте свой первый проект, используя возможности искусственного интеллекта.</p>
            </div>
            <Button onClick={() => setShowCreateModal(true)} className="rounded-xl h-12 px-6 font-bold">
              Создать первый сайт
            </Button>
          </SkeuoCard>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {userProjects.map((project) => (
              <SkeuoCard 
                key={project.id} 
                className="group p-0 overflow-hidden"
                onClick={() => setLocation(`/editor/${project.id}`)}
              >
                <div className="h-48 bg-slate-50 dark:bg-slate-800/50 relative overflow-hidden flex items-center justify-center">
                  {project.generatedCode ? (
                    <div className="w-full h-full scale-[0.3] origin-center opacity-40 group-hover:opacity-100 transition-opacity duration-500">
                       <iframe srcDoc={project.generatedCode} className="w-[333%] h-[333%] border-none pointer-events-none" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-white dark:bg-slate-900 shadow-skeuo-md flex items-center justify-center">
                      <Code2 className="w-8 h-8 text-slate-200" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-white/90 dark:from-slate-900/90 to-transparent flex items-end p-6">
                    <h3 className="text-xl font-black tracking-tight truncate">{project.title}</h3>
                  </div>
                </div>
                <div className="p-6 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
                    <Calendar className="w-3.5 h-3.5" />
                    {new Date(project.createdAt).toLocaleDateString()}
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:bg-destructive/10"
                    onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(project.id); }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
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
                {createStep === "choose" ? "С чего начнём?" : "Оживите мечту"}
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
                      colorClass: "group-hover:border-blue-200 group-hover:shadow-blue-500/15 group-hover:bg-blue-50/30",
                      iconBgClass: "bg-blue-100/50 group-hover:bg-blue-100",
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
                      colorClass: "group-hover:border-indigo-200 group-hover:shadow-indigo-500/15 group-hover:bg-indigo-50/30",
                      iconBgClass: "bg-indigo-100/50 group-hover:bg-indigo-100",
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
                      colorClass: "group-hover:border-purple-200 group-hover:shadow-purple-500/15 group-hover:bg-purple-50/30",
                      iconBgClass: "bg-purple-100/50 group-hover:bg-purple-100",
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
                      className={`group relative flex items-center w-full p-4 rounded-2xl bg-gray-50/50 border border-transparent transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-gray-100 ${x.colorClass}`}
                      onClick={() => { setSelectedMode(x.m as any); setCreateStep("details"); }}
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
                    <Label className="text-xs font-bold uppercase tracking-widest text-gray-400 px-2">Описание</Label>
                    <Textarea 
                      placeholder="Опишите структуру, цвета и контент..."
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      className="min-h-[120px] rounded-2xl bg-gray-50 border border-gray-200 font-medium text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
                    />
                  </div>
                  <div className="flex gap-4 pt-4">
                    <Button variant="ghost" className="h-14 rounded-2xl font-bold flex-1 text-gray-600 hover:bg-gray-100" onClick={() => setCreateStep("choose")}>Назад</Button>
                    <Button 
                      className="h-14 rounded-2xl font-extrabold text-lg flex-[2] shadow-xl shadow-primary/20"
                      onClick={() => createMutation.mutate()}
                      disabled={createMutation.isPending}
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
    </div>
  );
}
