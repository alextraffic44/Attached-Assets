import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

const stagger = {
  visible: {
    transition: { staggerChildren: 0.06 },
  },
};

type CreateMode = "prompt" | "template" | "photo";

const createModes: { mode: CreateMode; icon: typeof MessageSquare; title: string; description: string }[] = [
  {
    mode: "prompt",
    icon: MessageSquare,
    title: "По описанию",
    description: "Опишите сайт текстом и ИИ создаст его для вас",
  },
  {
    mode: "template",
    icon: Layers,
    title: "Промт + Шаблон",
    description: "Выберите тип сайта и опишите детали",
  },
  {
    mode: "photo",
    icon: Image,
    title: "По фото (Vision)",
    description: "Загрузите скриншот сайта-примера",
  },
];

const templates = [
  "Лендинг для бизнеса",
  "Портфолио дизайнера",
  "Интернет-магазин",
  "Блог/Медиа",
  "Ресторан/Кафе",
  "Сайт-визитка",
];

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createStep, setCreateStep] = useState<"choose" | "details">("choose");
  const [selectedMode, setSelectedMode] = useState<CreateMode>("prompt");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");

  const { data: userProjects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
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
      resetForm();

      const prompt = buildInitialPrompt();
      setLocation(`/editor/${project.id}?prompt=${encodeURIComponent(prompt)}&mode=${selectedMode}`);
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось создать проект", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Проект удалён" });
    },
  });

  function buildInitialPrompt() {
    if (selectedMode === "template" && selectedTemplate) {
      return `Создай сайт: ${selectedTemplate}. ${description}`;
    }
    return description || title || "Создай современный лендинг";
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setSelectedTemplate("");
    setCreateStep("choose");
    setSelectedMode("prompt");
  }

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold">НейроЗодчий</span>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="hidden sm:flex">
              <Coins className="w-3 h-3 mr-1" />
              {user?.credits ?? 0} кредитов
            </Badge>
            <span className="text-sm text-muted-foreground hidden sm:block" data-testid="text-user-name">
              {user?.displayName}
            </span>
            <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">Мои проекты</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {userProjects.length > 0
                ? `${userProjects.length} проект${userProjects.length === 1 ? "" : userProjects.length < 5 ? "а" : "ов"}`
                : "Пока нет проектов"}
            </p>
          </div>
          <Button onClick={() => setShowCreateModal(true)} data-testid="button-create-project">
            <Plus className="w-4 h-4 mr-2" />
            Создать проект
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : userProjects.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-20"
          >
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Начните создавать</h2>
            <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
              Создайте свой первый сайт с помощью ИИ за считанные секунды
            </p>
            <Button onClick={() => setShowCreateModal(true)} data-testid="button-create-first">
              <Plus className="w-4 h-4 mr-2" />
              Создать первый проект
            </Button>
          </motion.div>
        ) : (
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            {userProjects.map((project) => (
              <motion.div key={project.id} variants={fadeUp} transition={{ duration: 0.3 }}>
                <Card
                  className="group cursor-pointer hover-elevate p-0"
                  onClick={() => setLocation(`/editor/${project.id}`)}
                  data-testid={`card-project-${project.id}`}
                >
                  <div className="h-36 bg-muted/30 rounded-t-md flex items-center justify-center border-b">
                    {project.generatedCode ? (
                      <div className="w-full h-full overflow-hidden rounded-t-md relative">
                        <iframe
                          srcDoc={project.generatedCode}
                          className="w-[200%] h-[200%] origin-top-left scale-50 pointer-events-none"
                          sandbox="allow-scripts"
                          title={project.title}
                        />
                      </div>
                    ) : (
                      <Code2 className="w-8 h-8 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold truncate mb-1">{project.title}</h3>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {new Date(project.createdAt).toLocaleDateString("ru-RU")}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMutation.mutate(project.id);
                        }}
                        data-testid={`button-delete-${project.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        )}
      </main>

      <Dialog open={showCreateModal} onOpenChange={(open) => { setShowCreateModal(open); if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {createStep === "choose" ? "Создать проект" : "Детали проекта"}
            </DialogTitle>
          </DialogHeader>

          <AnimatePresence mode="wait">
            {createStep === "choose" ? (
              <motion.div
                key="choose"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {createModes.map((m) => (
                  <button
                    key={m.mode}
                    className={`w-full flex items-start gap-4 p-4 rounded-md border text-left transition-colors ${
                      selectedMode === m.mode ? "border-primary bg-primary/5" : "border-border"
                    }`}
                    onClick={() => {
                      setSelectedMode(m.mode);
                      setCreateStep("details");
                    }}
                    data-testid={`button-mode-${m.mode}`}
                  >
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <m.icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm">{m.title}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>
                    </div>
                  </button>
                ))}
              </motion.div>
            ) : (
              <motion.div
                key="details"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label>Название проекта</Label>
                  <Input
                    placeholder="Мой сайт"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    data-testid="input-project-title"
                  />
                </div>

                {selectedMode === "template" && (
                  <div className="space-y-2">
                    <Label>Шаблон</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {templates.map((t) => (
                        <button
                          key={t}
                          className={`p-3 rounded-md border text-sm text-left transition-colors ${
                            selectedTemplate === t ? "border-primary bg-primary/5" : "border-border"
                          }`}
                          onClick={() => setSelectedTemplate(t)}
                          data-testid={`button-template-${t}`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>
                    {selectedMode === "photo"
                      ? "Описание (что изменить или добавить)"
                      : "Описание сайта"}
                  </Label>
                  <Textarea
                    placeholder={
                      selectedMode === "prompt"
                        ? "Опишите сайт, который хотите создать..."
                        : selectedMode === "template"
                          ? "Добавьте детали к выбранному шаблону..."
                          : "Опишите, что хотите получить на основе фото..."
                    }
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    data-testid="input-project-description"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={() => setCreateStep("choose")} data-testid="button-back-step">
                    Назад
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => createMutation.mutate()}
                    disabled={createMutation.isPending}
                    data-testid="button-create-confirm"
                  >
                    {createMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Создание...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Создать
                      </>
                    )}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
    </div>
  );
}
