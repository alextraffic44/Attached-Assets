import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock, User, ArrowLeft, Loader2 } from "lucide-react";

const appleFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

const TelegramIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.697l-2.965-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.983.862z"/>
  </svg>
);

declare global {
  interface Window {
    onTelegramAuth?: (user: any) => void;
  }
}

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTelegramLoading, setIsTelegramLoading] = useState(false);
  const { login, register } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;

  useEffect(() => {
    if (!botUsername) return;

    window.onTelegramAuth = async (user: any) => {
      setIsTelegramLoading(true);
      try {
        const res = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Ошибка авторизации");
        setLocation("/dashboard");
      } catch (err: any) {
        toast({ title: "Ошибка", description: err.message, variant: "destructive" });
      } finally {
        setIsTelegramLoading(false);
      }
    };

    const existingScript = document.getElementById("telegram-widget");
    if (existingScript) existingScript.remove();

    const script = document.createElement("script");
    script.id = "telegram-widget";
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    script.async = true;
    document.getElementById("telegram-widget-container")?.appendChild(script);

    return () => {
      document.getElementById("telegram-widget")?.remove();
      delete window.onTelegramAuth;
    };
  }, [botUsername, setLocation, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, password, displayName);
      }
      setLocation("/dashboard");
    } catch (err: any) {
      toast({
        title: "Ошибка",
        description: err.message?.includes("401") ? "Неверный email или пароль" : "Произошла ошибка",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ fontFamily: appleFont, minHeight: "100vh", background: "#FBFBFD", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", position: "relative", overflow: "hidden" }}>
      {/* Background ambient */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: "15%", left: "20%", width: "28rem", height: "28rem", borderRadius: "50%", background: "radial-gradient(circle,rgba(0,113,227,0.06),transparent)", filter: "blur(60px)" }} />
        <div style={{ position: "absolute", bottom: "15%", right: "20%", width: "24rem", height: "24rem", borderRadius: "50%", background: "radial-gradient(circle,rgba(101,0,255,0.05),transparent)", filter: "blur(60px)" }} />
      </div>

      <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} style={{ width: "100%", maxWidth: 440, position: "relative", zIndex: 1 }}>

        {/* Back button */}
        <button
          onClick={() => setLocation("/")}
          style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "2rem", background: "none", border: "none", cursor: "pointer", color: "#86868B", fontSize: "0.9rem", fontWeight: 500, fontFamily: appleFont }}
        >
          <ArrowLeft size={16} />
          Назад
        </button>

        {/* Card */}
        <div style={{ background: "#fff", borderRadius: 28, border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 20px 60px rgba(0,0,0,0.07)", padding: "2.5rem" }}>

          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "2rem" }}>
            <svg viewBox="0 0 32 32" style={{ width: 36, height: 36 }} stroke="currentColor" strokeWidth="2" fill="none">
              <defs>
                <linearGradient id="auth-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#007AFF" />
                  <stop offset="100%" stopColor="#5856D6" />
                </linearGradient>
              </defs>
              <rect x="4" y="4" width="24" height="18" rx="4" stroke="url(#auth-logo-grad)" />
              <circle cx="10" cy="10" r="1.5" fill="url(#auth-logo-grad)" stroke="none" />
              <circle cx="22" cy="10" r="1.5" fill="url(#auth-logo-grad)" stroke="none" />
              <path d="M12 16l-2 2 2 2 M20 16l2 2-2 2" stroke="url(#auth-logo-grad)" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M8 26 h16 M10 28 h12" stroke="url(#auth-logo-grad)" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: "1.2rem", fontWeight: 700, letterSpacing: "-0.02em", color: "#1D1D1F" }}>Craft AI</span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={isLogin ? "login" : "register"} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25 }}>
              <h1 style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.035em", color: "#1D1D1F", marginBottom: "0.4rem" }}>
                {isLogin ? "С возвращением" : "Создать аккаунт"}
              </h1>
              <p style={{ fontSize: "0.9rem", color: "#86868B", marginBottom: "2rem" }}>
                {isLogin ? "Войдите в свой аккаунт Craft AI" : "Присоединяйтесь к Craft AI"}
              </p>

              {/* Telegram button */}
              {botUsername ? (
                <div style={{ marginBottom: "1.5rem" }}>
                  {isTelegramLoading ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", height: 48, borderRadius: 14, background: "#2AABEE", color: "#fff", fontSize: "0.95rem", fontWeight: 600 }}>
                      <Loader2 size={18} className="animate-spin" />
                      Авторизация...
                    </div>
                  ) : (
                    <div id="telegram-widget-container" style={{ display: "flex", justifyContent: "center" }} />
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", margin: "1.25rem 0" }}>
                    <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.07)" }} />
                    <span style={{ fontSize: "0.75rem", color: "#86868B", fontWeight: 500 }}>или через email</span>
                    <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.07)" }} />
                  </div>
                </div>
              ) : null}

              {/* Email form */}
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {!isLogin && (
                  <div>
                    <Label style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#86868B", display: "block", marginBottom: "0.4rem" }}>Имя</Label>
                    <div style={{ position: "relative" }}>
                      <User size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#86868B" }} />
                      <Input
                        placeholder="Ваше имя"
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        required={!isLogin}
                        className="h-12 pl-10 rounded-2xl font-medium"
                        style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.08)" }}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <Label style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#86868B", display: "block", marginBottom: "0.4rem" }}>Email</Label>
                  <div style={{ position: "relative" }}>
                    <Mail size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#86868B" }} />
                    <Input
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      className="h-12 pl-10 rounded-2xl font-medium"
                      style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.08)" }}
                    />
                  </div>
                </div>

                <div>
                  <Label style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#86868B", display: "block", marginBottom: "0.4rem" }}>Пароль</Label>
                  <div style={{ position: "relative" }}>
                    <Lock size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#86868B" }} />
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      className="h-12 pl-10 rounded-2xl font-medium"
                      style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.08)" }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{ height: 48, borderRadius: 14, background: "linear-gradient(135deg,#1D1D1F,#3a3a3c)", color: "#fff", border: "none", cursor: isSubmitting ? "not-allowed" : "pointer", fontFamily: appleFont, fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", opacity: isSubmitting ? 0.6 : 1, marginTop: "0.5rem", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}
                >
                  {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : (isLogin ? "Войти" : "Создать аккаунт")}
                </button>
              </form>

              <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid rgba(0,0,0,0.06)", textAlign: "center" }}>
                <button
                  type="button"
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 500, color: "#86868B", fontFamily: appleFont }}
                  onClick={() => setIsLogin(!isLogin)}
                >
                  {isLogin ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
