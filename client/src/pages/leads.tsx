import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Lead } from "@shared/schema";
import {
  ArrowLeft,
  Mail,
  Phone,
  User,
  MessageSquare,
  Trash2,
  Clock,
  Inbox,
  ChevronDown,
} from "lucide-react";

const appleFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

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
    if (lead.isRead === 0) markReadMutation.mutate(lead.id);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#FBFBFD", fontFamily: appleFont }}>

      {/* Header */}
      <header style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(251,251,253,0.85)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <button
              onClick={() => setLocation("/dashboard")}
              data-testid="button-back-dashboard"
              style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(0,0,0,0.04)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#86868B", transition: "background 0.2s" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.08)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,0,0,0.04)")}
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, hsl(27deg 93% 60%), #00a6ff)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,166,255,0.25)" }}>
                  <Inbox size={15} color="#fff" />
                </div>
                <span style={{ fontSize: "1.05rem", fontWeight: 700, letterSpacing: "-0.025em", color: "#1D1D1F" }}>Лиды</span>
                {unreadCount > 0 && (
                  <span data-testid="badge-unread-count" style={{ fontSize: "0.65rem", fontWeight: 700, background: "linear-gradient(90deg, hsl(27deg 93% 60%), #00a6ff)", color: "#fff", padding: "0.2rem 0.55rem", borderRadius: 100 }}>
                    {unreadCount}
                  </span>
                )}
              </div>
              <p style={{ fontSize: "0.75rem", color: "#86868B", marginTop: 2 }}>Заявки с ваших сайтов</p>
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "2rem 1.5rem" }}>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1.75rem", background: "rgba(0,0,0,0.03)", borderRadius: 14, padding: "0.25rem", width: "fit-content" }}>
          {[
            { key: "all",    label: "Все",           count: allLeads.length },
            { key: "unread", label: "Новые",         count: unreadCount },
            { key: "read",   label: "Прочитанные",   count: allLeads.length - unreadCount },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key as any)}
              data-testid={`filter-${f.key}`}
              style={{
                display: "flex", alignItems: "center", gap: "0.4rem",
                padding: "0.45rem 0.9rem", borderRadius: 10, border: "none", cursor: "pointer",
                fontFamily: appleFont, fontSize: "0.82rem", fontWeight: 600,
                background: filter === f.key ? "#fff" : "transparent",
                color: filter === f.key ? "#1D1D1F" : "#86868B",
                boxShadow: filter === f.key ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.18s",
              }}
            >
              {f.label}
              <span style={{ fontSize: "0.65rem", fontWeight: 700, background: filter === f.key ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.04)", borderRadius: 100, padding: "0.1rem 0.45rem", color: filter === f.key ? "#1D1D1F" : "#AEAEB2" }}>
                {f.count}
              </span>
            </button>
          ))}
        </div>

        {/* Content */}
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 72, borderRadius: 18, background: "rgba(0,0,0,0.03)", animation: "pulse 1.5s infinite" }} />
            ))}
          </div>
        ) : filteredLeads.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "6rem 1rem", textAlign: "center" }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, background: "rgba(0,0,0,0.03)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.25rem" }}>
              <Inbox size={32} color="rgba(0,0,0,0.12)" />
            </div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#86868B", margin: 0 }}>Заявок пока нет</h2>
            <p style={{ fontSize: "0.85rem", color: "#AEAEB2", marginTop: "0.5rem", maxWidth: 280, lineHeight: 1.5 }}>
              Когда посетители ваших сайтов заполнят формы, заявки появятся здесь
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <AnimatePresence>
              {filteredLeads.map((lead) => {
                const isNew = lead.isRead === 0;
                const isExpanded = expandedId === lead.id;
                return (
                  <motion.div
                    key={lead.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    layout
                    data-testid={`lead-card-${lead.id}`}
                  >
                    <div
                      onClick={() => handleExpand(lead)}
                      style={{
                        borderRadius: 18,
                        background: isNew ? "rgba(0,166,255,0.03)" : "#fff",
                        border: `1px solid ${isNew ? "rgba(0,166,255,0.15)" : "rgba(0,0,0,0.06)"}`,
                        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                        cursor: "pointer",
                        transition: "border-color 0.2s, box-shadow 0.2s",
                        overflow: "hidden",
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)"; (e.currentTarget as HTMLDivElement).style.borderColor = isNew ? "rgba(0,166,255,0.3)" : "rgba(0,0,0,0.12)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)"; (e.currentTarget as HTMLDivElement).style.borderColor = isNew ? "rgba(0,166,255,0.15)" : "rgba(0,0,0,0.06)"; }}
                    >
                      {/* Row */}
                      <div style={{ display: "flex", alignItems: "center", gap: "0.875rem", padding: "1rem 1.25rem" }}>
                        {/* Unread dot */}
                        <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: isNew ? "linear-gradient(135deg, hsl(27deg 93% 60%), #00a6ff)" : "rgba(0,0,0,0.08)" }} />

                        {/* Avatar */}
                        <div style={{ width: 38, height: 38, borderRadius: 12, background: isNew ? "linear-gradient(135deg, rgba(0,166,255,0.12), rgba(101,0,255,0.08))" : "rgba(0,0,0,0.04)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <User size={16} color={isNew ? "#00a6ff" : "#AEAEB2"} />
                        </div>

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "#1D1D1F", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {lead.name || lead.email || "Без имени"}
                            </span>
                            <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#86868B", background: "rgba(0,0,0,0.04)", padding: "0.15rem 0.5rem", borderRadius: 100, whiteSpace: "nowrap", flexShrink: 0 }}>
                              {lead.projectTitle}
                            </span>
                            {isNew && (
                              <span style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#00a6ff", background: "rgba(0,166,255,0.08)", padding: "0.15rem 0.5rem", borderRadius: 100, flexShrink: 0 }}>
                                Новая
                              </span>
                            )}
                          </div>
                          {lead.message && (
                            <p style={{ fontSize: "0.78rem", color: "#86868B", margin: "0.15rem 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {lead.message}
                            </p>
                          )}
                        </div>

                        {/* Right side */}
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
                          <span style={{ fontSize: "0.72rem", color: "#AEAEB2", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                            <Clock size={11} />
                            {new Date(lead.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <button
                            onClick={e => { e.stopPropagation(); deleteMutation.mutate(lead.id); }}
                            data-testid={`button-delete-lead-${lead.id}`}
                            style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#AEAEB2", transition: "all 0.15s" }}
                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,59,48,0.08)"; e.currentTarget.style.color = "#FF3B30"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#AEAEB2"; }}
                          >
                            <Trash2 size={13} />
                          </button>
                          <div style={{ color: "#AEAEB2", transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                            <ChevronDown size={15} />
                          </div>
                        </div>
                      </div>

                      {/* Expanded */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            style={{ overflow: "hidden" }}
                          >
                            <div style={{ padding: "1rem 1.25rem 1.25rem", borderTop: "1px solid rgba(0,0,0,0.05)", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                              {lead.name && (
                                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                                  <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(0,0,0,0.03)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <User size={14} color="#86868B" />
                                  </div>
                                  <div>
                                    <p style={{ fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#AEAEB2", margin: 0 }}>Имя</p>
                                    <p style={{ fontSize: "0.88rem", color: "#1D1D1F", margin: 0, fontWeight: 500 }}>{lead.name}</p>
                                  </div>
                                </div>
                              )}
                              {lead.email && (
                                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                                  <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(0,122,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <Mail size={14} color="#007AFF" />
                                  </div>
                                  <div>
                                    <p style={{ fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#AEAEB2", margin: 0 }}>Email</p>
                                    <a href={`mailto:${lead.email}`} style={{ fontSize: "0.88rem", color: "#007AFF", fontWeight: 500, textDecoration: "none" }}>{lead.email}</a>
                                  </div>
                                </div>
                              )}
                              {lead.phone && (
                                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                                  <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(52,199,89,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <Phone size={14} color="#34C759" />
                                  </div>
                                  <div>
                                    <p style={{ fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#AEAEB2", margin: 0 }}>Телефон</p>
                                    <a href={`tel:${lead.phone}`} style={{ fontSize: "0.88rem", color: "#34C759", fontWeight: 500, textDecoration: "none" }}>{lead.phone}</a>
                                  </div>
                                </div>
                              )}
                              {lead.message && (
                                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
                                  <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(88,86,214,0.06)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                                    <MessageSquare size={14} color="#5856D6" />
                                  </div>
                                  <div>
                                    <p style={{ fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#AEAEB2", margin: "0 0 0.25rem" }}>Сообщение</p>
                                    <p style={{ fontSize: "0.88rem", color: "#1D1D1F", margin: 0, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{lead.message}</p>
                                  </div>
                                </div>
                              )}
                              {lead.source && lead.source !== "form" && (
                                <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#5856D6", background: "rgba(88,86,214,0.08)", padding: "0.2rem 0.6rem", borderRadius: 100, alignSelf: "flex-start" }}>
                                  {lead.source}
                                </span>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
}
