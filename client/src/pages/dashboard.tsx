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
  MessageSquare,
  Layers,
  Image,
  Loader2,
  FolderOpen,
  Coins,
  ChevronRight,
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
        <DialogContent className="sm:max-w-xl rounded-[3rem] p-0 overflow-hidden border-none shadow-2xl">
          <div className="p-10 space-y-8">
            <DialogHeader>
              <DialogTitle className="text-3xl font-black tracking-tighter">
                {createStep === "choose" ? "С чего начнём?" : "Оживите мечту"}
              </DialogTitle>
            </DialogHeader>

            <AnimatePresence mode="wait">
              {createStep === "choose" ? (
                <motion.div key="c" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                  {[
                    { m: "prompt", t: "По описанию", d: "Просто напишите, что вам нужно", i: MessageSquare },
                    { m: "template", t: "Промт + Шаблон", d: "Выберите структуру и детали", i: Layers },
                    { m: "photo", t: "По фото", d: "Загрузите скриншот-пример", i: Image },
                  ].map(x => (
                    <button 
                      key={x.m}
                      className="w-full flex items-center gap-6 p-6 rounded-[2rem] bg-slate-50 dark:bg-slate-800/50 hover:bg-primary/5 dark:hover:bg-primary/5 hover:ring-2 ring-primary/20 transition-all text-left shadow-skeuo-inner"
                      onClick={() => { setSelectedMode(x.m as any); setCreateStep("details"); }}
                    >
                      <div className="w-14 h-14 rounded-2xl bg-white dark:bg-slate-900 shadow-skeuo-md flex items-center justify-center shrink-0">
                        <x.i className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-lg font-black">{x.t}</h4>
                        <p className="text-sm text-slate-500 font-medium">{x.d}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300" />
                    </button>
                  ))}
                </motion.div>
              ) : (
                <motion.div key="d" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                  <div className="space-y-2">
                    <Label className="text-xs font-black uppercase tracking-widest text-slate-400 px-2">Название</Label>
                    <Input 
                      placeholder="Например: Моё кафе"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      className="h-14 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none shadow-skeuo-inner font-bold"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-black uppercase tracking-widest text-slate-400 px-2">Описание</Label>
                    <Textarea 
                      placeholder="Опишите структуру, цвета и контент..."
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      className="min-h-[120px] rounded-2xl bg-slate-50 dark:bg-slate-800 border-none shadow-skeuo-inner font-medium"
                    />
                  </div>
                  <div className="flex gap-4 pt-4">
                    <Button variant="ghost" className="h-14 rounded-2xl font-bold flex-1" onClick={() => setCreateStep("choose")}>Назад</Button>
                    <Button 
                      className="h-14 rounded-2xl font-black text-lg flex-[2] shadow-xl shadow-primary/20"
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
