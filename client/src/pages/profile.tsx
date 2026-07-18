import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Coins, Calendar, Hash, User, Shield, HeadphonesIcon, Gift, LogOut, History } from "lucide-react";

const appleFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

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

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  const { data: history = [] } = useQuery<CreditTxn[]>({
    queryKey: ["/api/credits/history"],
    enabled: !!user,
  });

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

        {/* Transparent token spend history */}
        <div style={{ background: "#fff", borderRadius: 20, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.95rem 1.25rem", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(0,122,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <History size={16} color="#007AFF" />
            </div>
            <div>
              <div style={{ fontSize: "0.92rem", fontWeight: 700, color: "#1D1D1F" }}>Расход токенов</div>
              <div style={{ fontSize: "0.72rem", color: "#AEAEB2", marginTop: 2 }}>Прозрачная история списаний и возвратов</div>
            </div>
          </div>
          {history.length === 0 ? (
            <div style={{ padding: "1.25rem", fontSize: "0.85rem", color: "#AEAEB2" }}>Пока нет операций</div>
          ) : (
            history.slice(0, 40).map((t, i) => {
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
                    borderBottom: i < Math.min(history.length, 40) - 1 ? "1px solid rgba(0,0,0,0.04)" : "none",
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
            })
          )}
        </div>

        {/* Nav items */}
        <div style={{ background: "#fff", borderRadius: 20, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden", marginBottom: "1.25rem" }}>
          {navItems.map((item, i) => (
            <button
              key={i}
              onClick={item.onClick}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: "0.875rem", padding: "0.9rem 1.25rem", borderBottom: i < navItems.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
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
        </div>

        {/* Logout */}
        <div style={{ background: "#fff", borderRadius: 20, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden" }}>
          <button
            onClick={async () => { await logout(); setLocation("/auth"); }}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: "0.875rem", padding: "0.9rem 1.25rem", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,59,48,0.04)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,59,48,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#FF3B30" }}>
              <LogOut size={15} />
            </div>
            <span style={{ fontSize: "0.92rem", fontWeight: 600, color: "#FF3B30" }}>Выйти</span>
          </button>
        </div>
      </main>
    </div>
  );
}
