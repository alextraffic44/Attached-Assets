import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Redirect } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Users, Coins, TrendingDown, TrendingUp, Search, ChevronRight, ArrowLeft, Plus, Minus, LayoutGrid, History, User as UserIcon, ExternalLink } from "lucide-react";

const appleFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif';

const OPERATION_LABELS: Record<string, { label: string; color: string }> = {
  enhance: { label: "AI Улучшение", color: "#007AFF" },
  "deep-research": { label: "Deep Research", color: "#8E44AD" },
  generate: { label: "Генерация сайта", color: "#00B16A" },
  image: { label: "AI Изображение", color: "#E74C3C" },
  "3d": { label: "3D Модель", color: "#E67E22" },
  daily_publish: { label: "Публикация (день)", color: "#95A5A6" },
  admin_add: { label: "Начисление (admin)", color: "#27AE60" },
  admin_deduct: { label: "Списание (admin)", color: "#C0392B" },
};

function fmt(n: number) {
  return n?.toLocaleString("ru-RU") ?? "0";
}

function timeAgo(date: string) {
  const d = new Date(date);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин. назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч. назад`;
  return d.toLocaleDateString("ru-RU");
}

function StatCard({ icon: Icon, label, value, color }: any) {
  return (
    <div style={{
      background: "#fff", borderRadius: 16, padding: "20px 24px",
      boxShadow: "0 1px 4px rgba(0,0,0,0.08)", border: "1px solid rgba(0,0,0,0.06)",
      display: "flex", alignItems: "center", gap: 16,
    }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div>
        <div style={{ fontSize: "0.72rem", color: "#86868B", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
        <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1D1D1F", lineHeight: 1.2 }}>{fmt(value)}</div>
      </div>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, [string, string]> = {
    bronze: ["#CD7F32", "#FDF3E7"],
    silver: ["#9E9E9E", "#F5F5F5"],
    gold: ["#F5A623", "#FFFBEE"],
    platinum: ["#7B68EE", "#F0EEFF"],
  };
  const [c, bg] = colors[plan] ?? ["#999", "#f5f5f5"];
  return (
    <span style={{ fontSize: "0.7rem", fontWeight: 700, color: c, background: bg, padding: "2px 8px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.04em" }}>
      {plan === "bronze" ? "Старт" : plan === "silver" ? "Базовый" : plan === "gold" ? "Профи" : "Ультра"}
    </span>
  );
}

function UserDetail({ userId, onBack }: { userId: number; onBack: () => void }) {
  const [tab, setTab] = useState<"overview" | "transactions" | "projects">("overview");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustType, setAdjustType] = useState<"credit" | "debit">("credit");
  const [adjustNote, setAdjustNote] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: user, isLoading: userLoading } = useQuery<any>({
    queryKey: ["/api/admin/users", userId],
    queryFn: () => apiRequest("GET", `/api/admin/users/${userId}`).then(r => r.json()),
    refetchInterval: 5000,
  });

  const { data: transactions = [], isLoading: txLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/users", userId, "transactions"],
    queryFn: () => apiRequest("GET", `/api/admin/users/${userId}/transactions`).then(r => r.json()),
    enabled: tab === "transactions",
    refetchInterval: 5000,
  });

  const { data: projects = [], isLoading: projLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/users", userId, "projects"],
    queryFn: () => apiRequest("GET", `/api/admin/users/${userId}/projects`).then(r => r.json()),
    enabled: tab === "projects",
  });

  const adjustMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/users/${userId}/adjust-credits`, {
      amount: Number(adjustAmount),
      type: adjustType,
      note: adjustNote,
    }).then(r => r.json()),
    onSuccess: (data) => {
      toast({ title: adjustType === "credit" ? "Токены начислены" : "Токены списаны", description: `Новый баланс: ${data.user?.credits}` });
      setAdjustAmount("");
      setAdjustNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  if (userLoading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300 }}>
      <Loader2 className="animate-spin" size={28} style={{ color: "#007AFF" }} />
    </div>
  );

  return (
    <div>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "#007AFF", fontSize: "0.85rem", fontWeight: 600, marginBottom: 20, padding: 0 }}>
        <ArrowLeft size={16} /> Назад к списку
      </button>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 20, marginBottom: 24, alignItems: "start" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,#007AFF,#5AC8FA)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: "1.2rem" }}>{user.displayName?.[0]?.toUpperCase()}</span>
              </div>
            )}
            <div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1D1D1F" }}>{user.displayName}</div>
              <div style={{ fontSize: "0.8rem", color: "#86868B" }}>ID #{user.id}</div>
            </div>
            <div style={{ marginLeft: "auto" }}><PlanBadge plan={user.plan} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              ["Email", user.email || "—"],
              ["Telegram", user.telegramId ? `@${user.telegramId}` : "—"],
              ["Токены", `${fmt(user.credits)} ток.`],
              ["Зарегистрирован", new Date(user.createdAt).toLocaleDateString("ru-RU")],
            ].map(([k, v]) => (
              <div key={k} style={{ background: "#F9F9F9", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: "0.68rem", color: "#86868B", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</div>
                <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#1D1D1F", marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", minWidth: 280 }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1D1D1F", marginBottom: 16 }}>Управление токенами</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {(["credit", "debit"] as const).map(t => (
              <button key={t} onClick={() => setAdjustType(t)} style={{
                flex: 1, padding: "8px 0", borderRadius: 10, border: "none", cursor: "pointer",
                fontWeight: 700, fontSize: "0.8rem",
                background: adjustType === t ? (t === "credit" ? "#27AE60" : "#E74C3C") : "#F2F2F7",
                color: adjustType === t ? "#fff" : "#86868B",
              }}>
                {t === "credit" ? <><Plus size={12} style={{ display: "inline", marginRight: 3 }} />Начислить</> : <><Minus size={12} style={{ display: "inline", marginRight: 3 }} />Списать</>}
              </button>
            ))}
          </div>
          <input
            type="number" placeholder="Количество токенов" value={adjustAmount}
            onChange={e => setAdjustAmount(e.target.value)} min={1}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #E0E0E5", fontSize: "0.88rem", marginBottom: 8, boxSizing: "border-box", outline: "none" }}
          />
          <input
            type="text" placeholder="Причина / комментарий" value={adjustNote}
            onChange={e => setAdjustNote(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #E0E0E5", fontSize: "0.88rem", marginBottom: 12, boxSizing: "border-box", outline: "none" }}
          />
          <button
            onClick={() => { if (adjustAmount && Number(adjustAmount) > 0) adjustMutation.mutate(); }}
            disabled={!adjustAmount || Number(adjustAmount) <= 0 || adjustMutation.isPending}
            style={{
              width: "100%", padding: "10px 0", borderRadius: 10, border: "none", cursor: "pointer",
              background: adjustType === "credit" ? "linear-gradient(135deg,#27AE60,#2ECC71)" : "linear-gradient(135deg,#C0392B,#E74C3C)",
              color: "#fff", fontWeight: 700, fontSize: "0.88rem", opacity: (!adjustAmount || Number(adjustAmount) <= 0) ? 0.5 : 1,
            }}
          >
            {adjustMutation.isPending ? <Loader2 size={16} className="animate-spin" style={{ display: "inline" }} /> : adjustType === "credit" ? `Начислить ${adjustAmount || "0"} ток.` : `Списать ${adjustAmount || "0"} ток.`}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "#F2F2F7", borderRadius: 12, padding: 4, width: "fit-content" }}>
        {[["overview", UserIcon, "Обзор"], ["transactions", History, "Транзакции"], ["projects", LayoutGrid, "Проекты"]].map(([id, Icon, label]: any) => (
          <button key={id} onClick={() => setTab(id)} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 9, border: "none", cursor: "pointer",
            background: tab === id ? "#fff" : "transparent",
            color: tab === id ? "#1D1D1F" : "#86868B",
            fontWeight: tab === id ? 700 : 500, fontSize: "0.83rem",
            boxShadow: tab === id ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
          }}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", overflow: "hidden" }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #F2F2F7", fontWeight: 700, fontSize: "0.9rem", color: "#1D1D1F" }}>Последние транзакции</div>
          <RecentTransactions userId={userId} />
        </div>
      )}

      {tab === "transactions" && (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", overflow: "hidden" }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #F2F2F7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#1D1D1F" }}>История транзакций ({transactions.length})</span>
          </div>
          {txLoading ? (
            <div style={{ padding: 40, textAlign: "center" }}><Loader2 className="animate-spin" size={24} style={{ color: "#007AFF", margin: "0 auto" }} /></div>
          ) : transactions.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#86868B", fontSize: "0.88rem" }}>Нет транзакций</div>
          ) : (
            <div>
              {transactions.map((tx: any) => {
                const info = OPERATION_LABELS[tx.operation] ?? { label: tx.operation, color: "#86868B" };
                const isCredit = tx.type === "credit";
                return (
                  <div key={tx.id} style={{ display: "flex", alignItems: "center", padding: "14px 24px", borderBottom: "1px solid #F9F9F9", gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: info.color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {isCredit ? <TrendingUp size={16} style={{ color: "#27AE60" }} /> : <TrendingDown size={16} style={{ color: info.color }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#1D1D1F" }}>{info.label}</div>
                      {tx.note && <div style={{ fontSize: "0.75rem", color: "#86868B" }}>{tx.note}</div>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: "0.9rem", color: isCredit ? "#27AE60" : "#E74C3C" }}>
                        {isCredit ? "+" : "-"}{tx.amount} ток.
                      </div>
                      <div style={{ fontSize: "0.72rem", color: "#86868B" }}>{timeAgo(tx.createdAt)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "projects" && (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", overflow: "hidden" }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #F2F2F7", fontWeight: 700, fontSize: "0.9rem", color: "#1D1D1F" }}>
            Проекты ({projects.length})
          </div>
          {projLoading ? (
            <div style={{ padding: 40, textAlign: "center" }}><Loader2 className="animate-spin" size={24} style={{ color: "#007AFF", margin: "0 auto" }} /></div>
          ) : projects.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#86868B", fontSize: "0.88rem" }}>Нет проектов</div>
          ) : (
            <div>
              {projects.map((p: any) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", padding: "14px 24px", borderBottom: "1px solid #F9F9F9", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#1D1D1F" }}>{p.title}</div>
                    <div style={{ fontSize: "0.75rem", color: "#86868B" }}>ID: {p.id} · {new Date(p.createdAt).toLocaleDateString("ru-RU")}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {p.publishStatus === "published" && (
                      <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#27AE60", background: "#E8F8F5", padding: "2px 8px", borderRadius: 20 }}>LIVE</span>
                    )}
                    {p.publishedUrl && (
                      <a href={p.publishedUrl} target="_blank" rel="noreferrer" style={{ color: "#007AFF" }}>
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecentTransactions({ userId }: { userId: number }) {
  const { data: transactions = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", userId, "transactions"],
    queryFn: () => apiRequest("GET", `/api/admin/users/${userId}/transactions`).then(r => r.json()),
    refetchInterval: 5000,
  });
  const recent = transactions.slice(0, 8);
  if (recent.length === 0) return <div style={{ padding: 32, textAlign: "center", color: "#86868B", fontSize: "0.88rem" }}>Нет транзакций</div>;
  return (
    <div>
      {recent.map((tx: any) => {
        const info = OPERATION_LABELS[tx.operation] ?? { label: tx.operation, color: "#86868B" };
        const isCredit = tx.type === "credit";
        return (
          <div key={tx.id} style={{ display: "flex", alignItems: "center", padding: "12px 24px", borderBottom: "1px solid #F9F9F9", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: info.color }}>{info.label}</span>
              {tx.note && <span style={{ fontSize: "0.75rem", color: "#86868B", marginLeft: 6 }}>· {tx.note}</span>}
            </div>
            <div style={{ fontWeight: 700, fontSize: "0.85rem", color: isCredit ? "#27AE60" : "#E74C3C" }}>
              {isCredit ? "+" : "-"}{tx.amount} ток.
            </div>
            <div style={{ fontSize: "0.72rem", color: "#86868B", minWidth: 80, textAlign: "right" }}>{timeAgo(tx.createdAt)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminPage() {
  const { user, isLoading } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/admin/stats"],
    queryFn: () => apiRequest("GET", "/api/admin/stats").then(r => r.json()),
    refetchInterval: 10000,
  });

  const { data: users = [], isLoading: usersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    queryFn: () => apiRequest("GET", "/api/admin/users").then(r => r.json()),
    refetchInterval: 15000,
  });

  if (isLoading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F5F5F7" }}>
      <Loader2 size={32} className="animate-spin" style={{ color: "#86868B" }} />
    </div>
  );
  if (!user) return <Redirect to="/auth" />;
  const isAdmin = user.id === 1 || user.telegramId === "661325490";
  if (!isAdmin) return <Redirect to="/dashboard" />;

  const filtered = users.filter((u: any) =>
    !search || u.displayName?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    String(u.id).includes(search) ||
    (u.telegramId && u.telegramId.includes(search))
  );

  return (
    <div style={{ minHeight: "100vh", background: "#F5F5F7", fontFamily: appleFont }}>
      <div style={{ background: "#1D1D1F", padding: "0 32px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <a href="/dashboard" style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.82rem", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
              <ArrowLeft size={14} /> Dashboard
            </a>
            <span style={{ color: "rgba(255,255,255,0.2)" }}>/</span>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: "0.88rem" }}>Админ панель</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#007AFF,#5AC8FA)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: "0.75rem" }}>{user.displayName?.[0]?.toUpperCase()}</span>
              </div>
            )}
            <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.8rem" }}>{user.displayName}</span>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
        {!selectedUserId ? (
          <>
            <div style={{ marginBottom: 28 }}>
              <h1 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#1D1D1F", margin: 0 }}>Обзор</h1>
              <p style={{ color: "#86868B", fontSize: "0.85rem", margin: "4px 0 0" }}>Статистика платформы Craft AI</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 32 }}>
              <StatCard icon={Users} label="Пользователей" value={stats?.totalUsers} color="#007AFF" />
              <StatCard icon={LayoutGrid} label="Проектов" value={stats?.totalProjects} color="#00B16A" />
              <StatCard icon={TrendingDown} label="Токенов потрачено" value={stats?.totalTokensSpent} color="#E74C3C" />
              <StatCard icon={TrendingUp} label="Токенов начислено" value={stats?.totalTokensAdded} color="#27AE60" />
            </div>

            <div style={{ background: "#fff", borderRadius: 18, border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 6px rgba(0,0,0,0.06)", overflow: "hidden" }}>
              <div style={{ padding: "20px 24px", borderBottom: "1px solid #F2F2F7", display: "flex", alignItems: "center", gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#1D1D1F" }}>Пользователи</h2>
                <div style={{ flex: 1 }} />
                <div style={{ position: "relative" }}>
                  <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#86868B" }} />
                  <input
                    value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Поиск по имени, email, ID..."
                    style={{ paddingLeft: 34, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderRadius: 10, border: "1px solid #E0E0E5", fontSize: "0.83rem", outline: "none", width: 240 }}
                  />
                </div>
              </div>

              {usersLoading ? (
                <div style={{ padding: 60, textAlign: "center" }}>
                  <Loader2 className="animate-spin" size={28} style={{ color: "#007AFF", margin: "0 auto" }} />
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: 60, textAlign: "center", color: "#86868B" }}>Пользователи не найдены</div>
              ) : (
                <div>
                  {filtered.map((u: any) => (
                    <div
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      style={{ display: "flex", alignItems: "center", padding: "14px 24px", borderBottom: "1px solid #F9F9F9", cursor: "pointer", gap: 14, transition: "background 0.15s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#F9F9F9")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      {u.avatarUrl ? (
                        <img src={u.avatarUrl} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg,#007AFF,#5AC8FA)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <span style={{ color: "#fff", fontWeight: 700, fontSize: "0.88rem" }}>{u.displayName?.[0]?.toUpperCase()}</span>
                        </div>
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#1D1D1F" }}>{u.displayName}</div>
                        <div style={{ fontSize: "0.75rem", color: "#86868B" }}>
                          ID #{u.id}
                          {u.email && <> · {u.email}</>}
                          {u.telegramId && <> · TG: {u.telegramId}</>}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1D1D1F" }}>{fmt(u.credits)} ток.</div>
                          <div style={{ fontSize: "0.72rem", color: "#86868B" }}>{new Date(u.createdAt).toLocaleDateString("ru-RU")}</div>
                        </div>
                        <PlanBadge plan={u.plan} />
                        <ChevronRight size={16} style={{ color: "#C0C0C5" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <UserDetail userId={selectedUserId} onBack={() => setSelectedUserId(null)} />
        )}
      </div>
    </div>
  );
}
