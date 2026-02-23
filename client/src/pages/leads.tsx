import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Lead } from "@shared/schema";
import {
  Sparkles,
  ArrowLeft,
  Mail,
  Phone,
  User,
  MessageSquare,
  Trash2,
  Check,
  CheckCheck,
  Clock,
  Inbox,
  Filter,
  Eye,
} from "lucide-react";

type LeadWithProject = Lead & { projectTitle: string };

export default function LeadsPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: allLeads = [], isLoading } = useQuery<LeadWithProject[]>({
    queryKey: ["/api/leads"],
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/leads/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/unread-count"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/leads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/unread-count"] });
      toast({ title: "Заявка удалена" });
    },
  });

  const filteredLeads = allLeads.filter(l => {
    if (filter === "unread") return l.isRead === 0;
    if (filter === "read") return l.isRead === 1;
    return true;
  });

  const unreadCount = allLeads.filter(l => l.isRead === 0).length;

  const handleExpand = (lead: LeadWithProject) => {
    setExpandedId(expandedId === lead.id ? null : lead.id);
    if (lead.isRead === 0) {
      markReadMutation.mutate(lead.id);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <header className="sticky top-0 z-50 bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setLocation("/dashboard")}
              className="w-10 h-10 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center transition-colors"
              data-testid="button-back-dashboard"
            >
              <ArrowLeft className="w-4 h-4 text-white/60" />
            </button>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                  <Inbox className="w-4 h-4 text-white" />
                </div>
                Лиды
                {unreadCount > 0 && (
                  <span className="ml-1 text-xs bg-emerald-500 text-white px-2 py-0.5 rounded-full font-bold" data-testid="badge-unread-count">
                    {unreadCount}
                  </span>
                )}
              </h1>
              <p className="text-white/30 text-sm mt-0.5">Заявки с ваших сайтов</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex gap-2 mb-8">
          {[
            { key: "all", label: "Все", count: allLeads.length },
            { key: "unread", label: "Новые", count: unreadCount },
            { key: "read", label: "Прочитанные", count: allLeads.length - unreadCount },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                filter === f.key
                  ? "bg-white/[0.1] text-white"
                  : "text-white/30 hover:text-white/50"
              }`}
              data-testid={`filter-${f.key}`}
            >
              {f.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                filter === f.key ? "bg-white/[0.15]" : "bg-white/[0.05]"
              }`}>
                {f.count}
              </span>
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-2xl bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-2xl bg-white/[0.03] flex items-center justify-center mb-5">
              <Inbox className="w-10 h-10 text-white/10" />
            </div>
            <h2 className="text-xl font-bold text-white/50">Заявок пока нет</h2>
            <p className="text-white/25 text-sm mt-2 max-w-xs">
              Когда посетители ваших сайтов заполнят формы, заявки появятся здесь
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {filteredLeads.map((lead) => (
                <motion.div
                  key={lead.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  layout
                  data-testid={`lead-card-${lead.id}`}
                >
                  <div
                    className={`rounded-2xl border transition-all cursor-pointer ${
                      lead.isRead === 0
                        ? "bg-emerald-500/[0.04] border-emerald-500/[0.12] hover:border-emerald-500/[0.25]"
                        : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]"
                    }`}
                    onClick={() => handleExpand(lead)}
                  >
                    <div className="flex items-center gap-4 px-5 py-4">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${lead.isRead === 0 ? "bg-emerald-400" : "bg-white/10"}`} />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white truncate">
                            {lead.name || lead.email || "Без имени"}
                          </span>
                          <Badge variant="outline" className="text-[10px] bg-white/[0.04] border-white/[0.08] text-white/40 shrink-0">
                            {lead.projectTitle}
                          </Badge>
                        </div>
                        {lead.message && (
                          <p className="text-xs text-white/30 truncate mt-0.5">{lead.message}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[10px] text-white/20 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(lead.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-8 h-8 text-white/20 hover:text-red-400 hover:bg-red-500/10"
                          onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(lead.id); }}
                          data-testid={`button-delete-lead-${lead.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>

                    <AnimatePresence>
                      {expandedId === lead.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-5 pb-5 pt-1 border-t border-white/[0.04] space-y-3">
                            {lead.name && (
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center">
                                  <User className="w-3.5 h-3.5 text-white/40" />
                                </div>
                                <div>
                                  <p className="text-[10px] text-white/25 uppercase tracking-wider font-bold">Имя</p>
                                  <p className="text-sm text-white/80">{lead.name}</p>
                                </div>
                              </div>
                            )}
                            {lead.email && (
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center">
                                  <Mail className="w-3.5 h-3.5 text-white/40" />
                                </div>
                                <div>
                                  <p className="text-[10px] text-white/25 uppercase tracking-wider font-bold">Email</p>
                                  <a href={`mailto:${lead.email}`} className="text-sm text-emerald-400 hover:underline">{lead.email}</a>
                                </div>
                              </div>
                            )}
                            {lead.phone && (
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center">
                                  <Phone className="w-3.5 h-3.5 text-white/40" />
                                </div>
                                <div>
                                  <p className="text-[10px] text-white/25 uppercase tracking-wider font-bold">Телефон</p>
                                  <a href={`tel:${lead.phone}`} className="text-sm text-emerald-400 hover:underline">{lead.phone}</a>
                                </div>
                              </div>
                            )}
                            {lead.message && (
                              <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 mt-0.5">
                                  <MessageSquare className="w-3.5 h-3.5 text-white/40" />
                                </div>
                                <div>
                                  <p className="text-[10px] text-white/25 uppercase tracking-wider font-bold">Сообщение</p>
                                  <p className="text-sm text-white/70 whitespace-pre-wrap">{lead.message}</p>
                                </div>
                              </div>
                            )}
                            {lead.source && lead.source !== "form" && (
                              <div className="pt-1">
                                <Badge variant="outline" className="text-[10px] bg-violet-500/10 border-violet-500/20 text-violet-400">
                                  {lead.source}
                                </Badge>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
}
