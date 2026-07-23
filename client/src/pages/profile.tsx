import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowLeft, Coins, Calendar, Hash, User, Shield, HeadphonesIcon, Gift,
  LogOut, History, ChevronLeft, ChevronRight, Trash2, AlertTriangle, Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

const appleFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
const TXN_PER_PAGE = 20;

const PLAN_LABELS: Record<string, string> = {
  free: "Бесплатный",
  bronze: "Старт",
  silver: "Базовый",
  gold: "Профи",
  platinum: "Ультра",
};

type CreditTxn = {
  id: number;
  amount: number;
  type: string;
  operation: string;
  label: string;
  note: string | null;
  createdAt: string;
};

type CreditHistoryPage = {
  items: CreditTxn[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

function buildPageItems(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => pages.add(p));
  const sorted = Array.from(pages).filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const items: Array<number | "…"> = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) items.push("…");
    items.push(sorted[i]);
  }
  return items;
}

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [txnPage, setTxnPage] = useState(1);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const { data: historyPage, isLoading: historyLoading } = useQuery<CreditHistoryPage>({
    queryKey: ["/api/credits/history", txnPage, TXN_PER_PAGE],
    queryFn: async () => {
      const res = await fetch(`/api/credits/history?page=${txnPage}&limit=${TXN_PER_PAGE}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Не удалось загрузить историю");
      return res.json();
    },
    enabled: !!user,
    placeholderData: (prev) => prev,
  });

  const history = historyPage?.items ?? [];
  const totalTxns = historyPage?.total ?? 0;
  const totalPages = historyPage?.totalPages ?? 1;
  const currentPage = historyPage?.page ?? txnPage;
  const pageItems = useMemo(() => buildPageItems(currentPage, totalPages), [currentPage, totalPages]);
  const pageStart = totalTxns === 0 ? 0 : (currentPage - 1) * TXN_PER_PAGE + 1;
  const pageEnd = Math.min(currentPage * TXN_PER_PAGE, totalTxns);

  if (!user) return null;

  const joinDate = new Date(user.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const planLabel = PLAN_LABELS[user.plan ?? "free"] ?? user.plan;

  const rows = [
    { icon: <Hash size={16} color="#007AFF" />, bg: "rgba(0,122,255,0.08)", label: "Пользователь ID", value: `#${user.id}`, mono: true },
    { icon: <User size={16} color="#5856D6" />, bg: "rgba(88,86,214,0.08)", label: "Имя", value: user.displayName || user.email?.split("@")[0] || "—" },
    { icon: <Coins size={16} color="hsl(27deg 93% 60%)" />, bg: "rgba(255,149,0,0.08)", label: "Токены", value: String(user.credits ?? 0) },
    { icon: <Shield size={16} color="#34C759" />, bg: "rgba(52,199,89,0.08)", label: "Тарифный план", value: planLabel },
    { icon: <Calendar size={16} color="#FF9500" />, bg: "rgba(255,149,0,0.08)", label: "Дата регистрации", value: joinDate },
  ];

  const navItems = [
    { icon: <Gift size={15} />, label: "Реферальная программа", color: "#5856D6", onClick: () => {} },
    { icon: <HeadphonesIcon size={15} />, label: "Поддержка", color: "#007AFF", onClick: () => {} },
  ];

  const canConfirmDelete = deleteConfirm.trim().toUpperCase() === "УДАЛИТЬ";

  const handleDeleteAccount = async () => {
    if (!canConfirmDelete || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/auth/account", {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "Не удалось удалить аккаунт");
      }
      queryClient.clear();
      try { localStorage.removeItem("craft_projects_cache"); } catch {}
      toast({
        title: "Аккаунт удалён",
        description: data?.deletedProjects
          ? `Удалено проектов: ${data.deletedProjects}`
          : "Все данные аккаунта удалены",
      });
      setShowDeleteDialog(false);
      setLocation("/auth");
    } catch (e: any) {
      toast({
        title: "Ошибка",
        description: e?.message || "Не удалось удалить аккаунт",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#FBFBFD", fontFamily: appleFont }}>

      {/* Header */}
      <header style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(251,251,253,0.88)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 1.5rem", display: "flex", alignItems: "center", gap: "1rem", height: 64 }}>
          <button
            onClick={() => setLocation("/dashboard")}
            style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(0,0,0,0.04)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#86868B" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,0,0,0.04)")}
          >
            <ArrowLeft size={17} />
          </button>
          <span style={{ fontSize: "1.05rem", fontWeight: 700, letterSpacing: "-0.025em", color: "#1D1D1F" }}>Профиль</span>
        </div>
      </header>

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "2.5rem 1.5rem" }}>

        {/* Avatar block */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "2.5rem" }}>
          <div style={{ width: 96, height: 96, borderRadius: "50%", overflow: "hidden", background: "linear-gradient(135deg,hsl(27deg 93% 60%),#00a6ff)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 32px rgba(0,166,255,0.25)", marginBottom: "1rem", border: "3px solid rgba(255,255,255,0.9)" }}>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: "2.2rem", fontWeight: 700, color: "#fff" }}>
                {(user.displayName || user.email || "U")[0].toUpperCase()}
              </span>
            )}
          </div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.035em", color: "#1D1D1F", margin: "0 0 0.25rem" }}>
            {user.displayName || user.email?.split("@")[0]}
          </h1>
          <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#007AFF", background: "rgba(0,122,255,0.08)", padding: "0.2rem 0.75rem", borderRadius: 100 }}>
            {planLabel}
          </span>
        </div>

        {/* Info rows */}
        <div style={{ background: "#fff", borderRadius: 20, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden", marginBottom: "1.25rem" }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.875rem", padding: "0.9rem 1.25rem", borderBottom: i < rows.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none" }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: row.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {row.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#AEAEB2", marginBottom: 2 }}>{row.label}</div>
                <div style={{ fontSize: "0.92rem", fontWeight: 600, color: "#1D1D1F", fontFamily: row.mono ? '"SF Mono", "Menlo", monospace' : appleFont }}>{row.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Nav items — right after registration date */}
        <div style={{ background: "#fff", borderRadius: 20, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden", marginBottom: "1.25rem" }}>
          {navItems.map((item, i) => (
            <button
              key={i}
              onClick={item.onClick}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: "0.875rem", padding: "0.9rem 1.25rem", borderBottom: "1px solid rgba(0,0,0,0.05)", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.015)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ width: 34, height: 34, borderRadius: 10, background: `${item.color}14`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: item.color }}>
                {item.icon}
              </div>
              <span style={{ fontSize: "0.92rem", fontWeight: 600, color: "#1D1D1F", fontFamily: appleFont }}>{item.label}</span>
              <span style={{ marginLeft: "auto", color: "#AEAEB2", fontSize: "1rem" }}>›</span>
            </button>
          ))}
          <button
            onClick={async () => { await logout(); setLocation("/auth"); }}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: "0.875rem", padding: "0.9rem 1.25rem", background: "transparent", border: "none", borderBottom: "1px solid rgba(0,0,0,0.05)", cursor: "pointer", textAlign: "left" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,59,48,0.04)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,59,48,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#FF3B30" }}>
              <LogOut size={15} />
            </div>
            <span style={{ fontSize: "0.92rem", fontWeight: 600, color: "#FF3B30" }}>Выйти</span>
          </button>
          <button
            onClick={() => { setDeleteConfirm(""); setShowDeleteDialog(true); }}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: "0.875rem", padding: "0.9rem 1.25rem", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,59,48,0.04)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            data-testid="button-delete-account"
          >
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,59,48,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#FF3B30" }}>
              <Trash2 size={15} />
            </div>
            <span style={{ fontSize: "0.92rem", fontWeight: 600, color: "#FF3B30" }}>Удалить аккаунт</span>
          </button>
        </div>

        {/* Transparent token spend history */}
        <div style={{ background: "#fff", borderRadius: 20, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.95rem 1.25rem", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(0,122,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <History size={16} color="#007AFF" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.92rem", fontWeight: 700, color: "#1D1D1F" }}>Расход токенов</div>
              <div style={{ fontSize: "0.72rem", color: "#AEAEB2", marginTop: 2 }}>Прозрачная история списаний и возвратов</div>
            </div>
          </div>
          {historyLoading && history.length === 0 ? (
            <div style={{ padding: "1.5rem", display: "flex", justifyContent: "center" }}>
              <Loader2 size={22} className="animate-spin" style={{ color: "#AEAEB2" }} />
            </div>
          ) : history.length === 0 ? (
            <div style={{ padding: "1.25rem", fontSize: "0.85rem", color: "#AEAEB2" }}>Пока нет операций</div>
          ) : (
            <>
              {history.map((t, i) => {
                const isCredit = t.type === "credit";
                const when = new Date(t.createdAt).toLocaleString("ru-RU", {
                  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                });
                return (
                  <div
                    key={t.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.75rem 1.25rem",
                      borderBottom: i < history.length - 1 || totalPages > 1 ? "1px solid rgba(0,0,0,0.04)" : "none",
                      opacity: historyLoading ? 0.55 : 1,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.86rem", fontWeight: 600, color: "#1D1D1F" }}>{t.label}</div>
                      <div style={{ fontSize: "0.7rem", color: "#AEAEB2", marginTop: 2 }}>{when}</div>
                    </div>
                    <div style={{ fontSize: "0.9rem", fontWeight: 700, color: isCredit ? "#34C759" : "#1D1D1F", fontVariantNumeric: "tabular-nums" }}>
                      {isCredit ? "+" : "−"}{t.amount}
                    </div>
                  </div>
                );
              })}
              {totalPages > 1 && (
                <div style={{ padding: "0.85rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontSize: "0.72rem", color: "#86868B" }}>
                    {pageStart}–{pageEnd} из {totalTxns}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button
                      onClick={() => setTxnPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage <= 1 || historyLoading}
                      style={{
                        width: 32, height: 32, borderRadius: 8, border: "1px solid #E0E0E5", background: "#fff",
                        cursor: currentPage <= 1 ? "default" : "pointer", opacity: currentPage <= 1 ? 0.4 : 1,
                        display: "flex", alignItems: "center", justifyContent: "center", color: "#1D1D1F",
                      }}
                      aria-label="Предыдущая страница"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    {pageItems.map((item, idx) =>
                      item === "…" ? (
                        <span key={`e-${idx}`} style={{ width: 26, textAlign: "center", color: "#AEAEB2", fontSize: "0.8rem" }}>…</span>
                      ) : (
                        <button
                          key={item}
                          onClick={() => setTxnPage(item)}
                          disabled={historyLoading}
                          style={{
                            minWidth: 32, height: 32, borderRadius: 8, border: item === currentPage ? "none" : "1px solid #E0E0E5",
                            background: item === currentPage ? "#007AFF" : "#fff",
                            color: item === currentPage ? "#fff" : "#1D1D1F",
                            fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", padding: "0 0.4rem",
                          }}
                        >
                          {item}
                        </button>
                      )
                    )}
                    <button
                      onClick={() => setTxnPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage >= totalPages || historyLoading}
                      style={{
                        width: 32, height: 32, borderRadius: 8, border: "1px solid #E0E0E5", background: "#fff",
                        cursor: currentPage >= totalPages ? "default" : "pointer", opacity: currentPage >= totalPages ? 0.4 : 1,
                        display: "flex", alignItems: "center", justifyContent: "center", color: "#1D1D1F",
                      }}
                      aria-label="Следующая страница"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <Dialog open={showDeleteDialog} onOpenChange={(open) => { if (!deleting) { setShowDeleteDialog(open); if (!open) setDeleteConfirm(""); } }}>
        <DialogContent
          className="p-0"
          style={{
            maxWidth: 420,
            width: "92vw",
            borderRadius: 20,
            border: "1px solid rgba(0,0,0,0.08)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.14)",
            background: "#fff",
            fontFamily: appleFont,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "1.35rem 1.35rem 0.5rem" }}>
            <DialogHeader className="space-y-2 text-left">
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,59,48,0.1)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
                <AlertTriangle size={22} color="#FF3B30" />
              </div>
              <DialogTitle style={{ fontSize: "1.15rem", fontWeight: 800, letterSpacing: "-0.03em", color: "#1D1D1F" }}>
                Удалить аккаунт?
              </DialogTitle>
              <DialogDescription style={{ fontSize: "0.9rem", color: "#636366", lineHeight: 1.55 }}>
                Это действие необратимо. Будут безвозвратно удалены все ваши сайты, файлы, изображения, видео, история чатов и данные аккаунта.
              </DialogDescription>
            </DialogHeader>
            <div style={{ marginTop: "1rem", padding: "0.85rem 1rem", borderRadius: 12, background: "rgba(255,59,48,0.06)", border: "1px solid rgba(255,59,48,0.15)", fontSize: "0.82rem", color: "#8B1E18", lineHeight: 1.45 }}>
              Для подтверждения введите слово <strong>УДАЛИТЬ</strong>
            </div>
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="УДАЛИТЬ"
              disabled={deleting}
              autoComplete="off"
              data-testid="input-delete-confirm"
              style={{
                marginTop: "0.85rem",
                width: "100%",
                boxSizing: "border-box",
                padding: "0.75rem 0.9rem",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.12)",
                fontSize: "0.95rem",
                fontWeight: 600,
                letterSpacing: "0.04em",
                outline: "none",
                fontFamily: appleFont,
              }}
            />
          </div>
          <div style={{ display: "flex", gap: "0.65rem", padding: "1rem 1.35rem 1.35rem" }}>
            <button
              type="button"
              disabled={deleting}
              onClick={() => setShowDeleteDialog(false)}
              style={{
                flex: 1, height: 44, borderRadius: 12, border: "1px solid rgba(0,0,0,0.1)",
                background: "#F5F5F7", color: "#1D1D1F", fontWeight: 600, fontSize: "0.9rem", cursor: "pointer",
              }}
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={!canConfirmDelete || deleting}
              onClick={handleDeleteAccount}
              data-testid="button-confirm-delete-account"
              style={{
                flex: 1, height: 44, borderRadius: 12, border: "none",
                background: canConfirmDelete && !deleting ? "#FF3B30" : "rgba(255,59,48,0.35)",
                color: "#fff", fontWeight: 700, fontSize: "0.9rem",
                cursor: canConfirmDelete && !deleting ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : null}
              {deleting ? "Удаляем…" : "Удалить навсегда"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
