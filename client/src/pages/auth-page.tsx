import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

const appleFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

const SVG_CSS = `
  @keyframes rainbow {
    0% { background-position: 0% center; }
    100% { background-position: 200% center; }
  }
  .craft-title {
    background: linear-gradient(90deg, #FF4242, #A5FF42, #42A5FF, #42E6FF, #B742FF, #FF4242);
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: rainbow 4s linear infinite;
    display: inline-block;
  }
  .auth-left { flex: 0 0 50% !important; }
  .auth-right { flex: 0 0 50% !important; }
  /* Official Telegram widget — never scale/transform the iframe (breaks hit-testing). */
  #telegram-login-widget {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 48px;
  }
  #telegram-login-widget iframe {
    border: 0 !important;
    margin: 0 auto !important;
    max-width: 100% !important;
    transform: none !important;
    opacity: 1 !important;
    pointer-events: auto !important;
    position: static !important;
  }
  @media (max-width: 768px) {
    .auth-left { flex: 0 0 100% !important; min-height: 100vh; padding: 2rem 1.5rem !important; }
    .auth-right { display: none !important; }
  }
  .glow-pulse { animation: pulseGlowBox 3s ease-in-out alternate infinite; transform-origin: center; }
  @keyframes pulseGlowBox { 0% { transform: scale(0.95); opacity: 0.7; } 100% { transform: scale(1.05); opacity: 1; filter: blur(35px); } }
  .robot-float { animation: float 4s infinite ease-in-out; transform-origin: center; }
  @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-15px); } }
  .pupil { animation: scan 3s infinite ease-in-out; }
  @keyframes scan { 0%, 100% { transform: translateX(-3px); } 50% { transform: translateX(4px); } }
  .eye-blink { animation: blink 4s infinite; transform-origin: center; }
  @keyframes blink { 0%, 46%, 48%, 100% { transform: scaleY(1); } 47% { transform: scaleY(0.1); } }
  .hand-left { animation: tapLeft 0.5s infinite linear; transform-origin: 100px 330px; }
  .hand-right { animation: tapRight 0.6s infinite linear; transform-origin: 160px 330px; }
  @keyframes tapLeft { 0%, 50%, 100% { transform: translateY(0) rotate(0); } 25% { transform: translateY(8px) rotate(-8deg); } }
  @keyframes tapRight { 0%, 40%, 100% { transform: translateY(0) rotate(0); } 20% { transform: translateY(10px) rotate(8deg); } 70% { transform: translateY(4px) rotate(4deg); } }
  .antenna-glow { animation: pulseAntenna 2s infinite ease-in-out; }
  @keyframes pulseAntenna { 0%, 100% { fill: #ff0056; filter: drop-shadow(0 0 2px #ff0056); } 50% { fill: #ff4d8a; filter: drop-shadow(0 0 12px #ff0056); } }
  .code-group { animation: codeFade 10s infinite; }
  @keyframes codeFade { 0%, 90% { opacity: 1; } 95%, 100% { opacity: 0; } }
  .code-font { font-family: 'Consolas', 'Courier New', monospace; font-size: 16px; font-weight: bold; }
  .mask-1 { animation: type1 10s infinite linear; }
  @keyframes type1 { 0% { width: 0; } 10%, 95% { width: 200px; } 96%, 100% { width: 0; } }
  .mask-2 { animation: type2 10s infinite linear; }
  @keyframes type2 { 0%, 15% { width: 0; } 30%, 95% { width: 280px; } 96%, 100% { width: 0; } }
  .mask-3 { animation: type3 10s infinite linear; }
  @keyframes type3 { 0%, 35% { width: 0; } 50%, 95% { width: 160px; } 96%, 100% { width: 0; } }
  .cursor { animation: blinkCursor 0.8s infinite; }
  @keyframes blinkCursor { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
`;

function AgentSVG() {
  return (
    <svg viewBox="0 0 800 450" style={{ width: "100%", height: "100%" }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gradBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e1e24" />
          <stop offset="100%" stopColor="#050505" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <clipPath id="clip1"><rect className="mask-1" x="380" y="155" height="24" width="200" /></clipPath>
        <clipPath id="clip2"><rect className="mask-2" x="380" y="195" height="24" width="280" /></clipPath>
        <clipPath id="clip3"><rect className="mask-3" x="380" y="235" height="24" width="160" /></clipPath>
      </defs>
      <rect width="800" height="450" fill="url(#gradBg)" />
      <circle className="glow-pulse" cx="130" cy="220" r="120" fill="#ff0056" opacity="0.15" filter="url(#glow)" />
      <circle className="glow-pulse" cx="130" cy="220" r="80" fill="#007AFF" opacity="0.1" filter="url(#glow)" style={{ animationDelay: "1.5s" }} />
      <g className="robot-float">
        <rect x="60" y="140" width="140" height="120" rx="28" fill="#1a1a20" stroke="#333" strokeWidth="2" />
        <rect x="75" y="165" width="110" height="50" rx="12" fill="#0a0a0c" />
        <g className="eye-blink">
          <circle cx="105" cy="190" r="12" fill="#ff0056" filter="url(#glow)" />
          <circle className="pupil" cx="105" cy="190" r="5" fill="#fff" />
          <circle cx="155" cy="190" r="12" fill="#007AFF" filter="url(#glow)" />
          <circle className="pupil" cx="155" cy="190" r="5" fill="#fff" />
        </g>
        <line x1="130" y1="140" x2="130" y2="110" stroke="#333" strokeWidth="3" />
        <circle className="antenna-glow" cx="130" cy="105" r="8" />
        <rect x="95" y="260" width="70" height="40" rx="10" fill="#1a1a20" stroke="#333" strokeWidth="2" />
        <g className="hand-left"><rect x="30" y="200" width="30" height="14" rx="7" fill="#1a1a20" stroke="#333" strokeWidth="2" /></g>
        <g className="hand-right"><rect x="200" y="200" width="30" height="14" rx="7" fill="#1a1a20" stroke="#333" strokeWidth="2" /></g>
      </g>
      <g className="code-group">
        <rect x="340" y="100" width="400" height="250" rx="16" fill="#111116" stroke="#2a2a35" strokeWidth="1.5" />
        <circle cx="365" cy="125" r="5" fill="#ff5f57" />
        <circle cx="385" cy="125" r="5" fill="#febc2e" />
        <circle cx="405" cy="125" r="5" fill="#28c840" />
        <text className="code-font" x="380" y="175" fill="#6b7280" clipPath="url(#clip1)">{"// Initialize Agent Pro"}</text>
        <text className="code-font" x="380" y="215" fill="#60a5fa" clipPath="url(#clip2)">{"const agent = new AIAgent();"}</text>
        <text className="code-font" x="380" y="255" fill="#34d399" clipPath="url(#clip3)">{"agent.connect"}<tspan className="cursor" fill="#fff">|</tspan></text>
      </g>
      <text x="400" y="400" textAnchor="middle" fill="#ff0056" fontFamily="monospace" fontSize="13" letterSpacing="2">SYS_READY: Агент компилирует код ..</text>
    </svg>
  );
}

const YandexIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.04 12C2.04 6.48 6.48 2.04 12 2.04C17.52 2.04 21.96 6.48 21.96 12C21.96 17.52 17.52 21.96 12 21.96C6.48 21.96 2.04 17.52 2.04 12Z" fill="#FC3F1D"/>
    <path d="M13.32 7.5H12.18C11.1 7.5 10.38 8.1 10.38 9C10.38 9.96 10.86 10.44 11.7 11.04L12.3 11.46L10.32 14.5H8.82L10.68 11.76C9.6 11.04 8.94 10.2 8.94 9C8.94 7.38 10.26 6.24 12.18 6.24H14.7V14.5H13.32V7.5Z" fill="white"/>
  </svg>
);

const WIDGET_SCRIPT_ID = "telegram-login-widget-script";

function mountOfficialTelegramWidget(
  container: HTMLElement,
  botUsername: string,
  onAuthCallbackName: string,
): HTMLScriptElement {
  container.innerHTML = "";
  document.getElementById(WIDGET_SCRIPT_ID)?.remove();

  const script = document.createElement("script");
  script.id = WIDGET_SCRIPT_ID;
  // Cache-bust after deploys so a stale telegram.org script cannot leave a dead iframe.
  script.src = `https://telegram.org/js/telegram-widget.js?22&_=${Date.now()}`;
  script.async = true;
  script.setAttribute("data-telegram-login", botUsername);
  script.setAttribute("data-size", "large");
  script.setAttribute("data-radius", "14");
  script.setAttribute("data-request-access", "write");
  script.setAttribute("data-userpic", "false");
  script.setAttribute("data-lang", "ru");
  script.setAttribute("data-onauth", `${onAuthCallbackName}(user)`);
  container.appendChild(script);
  return script;
}

export default function AuthPage() {
  const [isTelegramLoading, setIsTelegramLoading] = useState(false);
  const [isYandexLoading, setIsYandexLoading] = useState(false);
  const [telegramWidgetReady, setTelegramWidgetReady] = useState(false);
  const [telegramWidgetFailed, setTelegramWidgetFailed] = useState(false);
  const [widgetKey, setWidgetKey] = useState(0);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const widgetHostRef = useRef<HTMLDivElement | null>(null);

  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;
  const yandexClientId = import.meta.env.VITE_YANDEX_CLIENT_ID;

  const finishTelegramAuth = useCallback(async (user: Record<string, any>) => {
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
      queryClient.setQueryData(["/api/auth/user"], data);
      setLocation("/dashboard");
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
      setIsTelegramLoading(false);
    }
  }, [setLocation, toast]);

  const finishTelegramAuthRef = useRef(finishTelegramAuth);
  finishTelegramAuthRef.current = finishTelegramAuth;

  useEffect(() => {
    const style = document.createElement("style");
    style.id = "auth-svg-styles";
    style.textContent = SVG_CSS;
    document.head.appendChild(style);
    return () => { document.getElementById("auth-svg-styles")?.remove(); };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("yandex_callback") === "1") {
      try {
        const stored = sessionStorage.getItem("yandex_oauth_hash");
        sessionStorage.removeItem("yandex_oauth_hash");
        window.history.replaceState({}, "", "/auth");
        if (stored) {
          const hash = stored.startsWith("#") ? stored.slice(1) : stored;
          const token = new URLSearchParams(hash).get("access_token");
          if (token) {
            setIsYandexLoading(true);
            void (async () => {
              try {
                const res = await fetch("/api/auth/yandex", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ token }),
                  credentials: "include",
                });
                const result = await res.json();
                if (!res.ok) throw new Error(result.message || "Ошибка авторизации");
                queryClient.setQueryData(["/api/auth/user"], result);
                setLocation("/dashboard");
              } catch (err: any) {
                toast({ title: "Ошибка", description: err.message, variant: "destructive" });
                setIsYandexLoading(false);
              }
            })();
          }
        }
      } catch {
        window.history.replaceState({}, "", "/auth");
      }
    }
  }, [setLocation, toast]);

  // Official Telegram Login Widget (visible iframe, no CSS scale / fake overlay).
  useEffect(() => {
    if (!botUsername) return;

    const container = widgetHostRef.current;
    if (!container) return;

    setTelegramWidgetReady(false);
    setTelegramWidgetFailed(false);

    const callbackName = "onTelegramAuthCraft";
    const w = window as Window & { [key: string]: any };
    w[callbackName] = (user: Record<string, any>) => {
      void finishTelegramAuthRef.current(user);
    };

    mountOfficialTelegramWidget(container, botUsername, callbackName);

    const readyCheck = window.setInterval(() => {
      const iframe = container.querySelector("iframe");
      if (!iframe) return;
      // iframe present = widget painted; do not restyle/transform it.
      setTelegramWidgetReady(true);
      clearInterval(readyCheck);
    }, 150);

    const failTimer = window.setTimeout(() => {
      if (!container.querySelector("iframe")) {
        setTelegramWidgetFailed(true);
        clearInterval(readyCheck);
      }
    }, 8000);

    return () => {
      clearInterval(readyCheck);
      clearTimeout(failTimer);
      document.getElementById(WIDGET_SCRIPT_ID)?.remove();
      try {
        delete w[callbackName];
      } catch {
        w[callbackName] = undefined;
      }
    };
  }, [botUsername, widgetKey]);

  const reloadTelegramWidget = () => {
    setTelegramWidgetFailed(false);
    setTelegramWidgetReady(false);
    setWidgetKey((k) => k + 1);
  };

  const handleYandexAuth = () => {
    if (!yandexClientId || isYandexLoading) return;
    setIsYandexLoading(true);
    const redirectUri = window.location.origin + "/yandex-suggest-token.html";
    const authUrl = `https://oauth.yandex.ru/authorize?response_type=token&client_id=${yandexClientId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    window.location.href = authUrl;
  };

  return (
    <div style={{ fontFamily: appleFont, minHeight: "100vh", display: "flex", overflow: "hidden" }}>
      <div className="auth-left" style={{
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "3rem",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <div style={{ position: "absolute", top: "-5%", left: "-10%", width: "28rem", height: "28rem", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,122,255,0.07) 0%, transparent 70%)", filter: "blur(40px)" }} />
          <div style={{ position: "absolute", bottom: "-5%", right: "-5%", width: "22rem", height: "22rem", borderRadius: "50%", background: "radial-gradient(circle, rgba(88,86,214,0.07) 0%, transparent 70%)", filter: "blur(40px)" }} />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", zIndex: 1 }}
        >
          <h1 className="craft-title" style={{ fontSize: "2.6rem", fontWeight: 800, letterSpacing: "-0.05em", margin: "0 0 0.4rem", textAlign: "center" }}>
            Craft AI
          </h1>
          <p style={{ fontSize: "0.9rem", color: "#86868B", margin: "0 0 2.25rem", textAlign: "center" }}>
            ИИ-конструктор сайтов нового поколения
          </p>

          <div style={{
            width: "100%",
            background: "#F5F5F7",
            borderRadius: 24,
            padding: "1.75rem",
            border: "1px solid rgba(0,0,0,0.06)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem" }}>
              <Sparkles size={16} style={{ color: "#007AFF" }} />
              <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1D1D1F", letterSpacing: "-0.01em" }}>Авторизация</span>
            </div>

            {yandexClientId && (
              <button
                onClick={handleYandexAuth}
                disabled={isYandexLoading}
                data-testid="button-yandex-login"
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                  gap: "0.6rem", height: 52, borderRadius: 14, border: "1px solid rgba(0,0,0,0.08)",
                  background: "#fff", cursor: isYandexLoading ? "not-allowed" : "pointer",
                  fontSize: "0.95rem", fontWeight: 600, color: "#1D1D1F",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                  opacity: isYandexLoading ? 0.7 : 1,
                  transition: "all 0.15s",
                  fontFamily: appleFont,
                }}
                onMouseEnter={e => { if (!isYandexLoading) (e.currentTarget as HTMLButtonElement).style.background = "#F9F9F9"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "#fff"; }}
              >
                {isYandexLoading ? <Loader2 size={18} className="animate-spin" /> : <YandexIcon />}
                {isYandexLoading ? "Авторизация..." : "Войти через Яндекс"}
              </button>
            )}

            {yandexClientId && botUsername && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", margin: "0.9rem 0" }}>
                <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.08)" }} />
                <span style={{ fontSize: "0.72rem", color: "#AEAEB2", fontWeight: 600, letterSpacing: "0.04em" }}>или</span>
                <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.08)" }} />
              </div>
            )}

            {botUsername ? (
              <div
                data-testid="button-telegram-login"
                style={{
                  position: "relative",
                  width: "100%",
                  minHeight: 52,
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: isTelegramLoading ? "linear-gradient(135deg, #2AABEE 0%, #229ED9 100%)" : "transparent",
                }}
              >
                {isTelegramLoading && (
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "0.65rem",
                    height: 52, color: "#fff", fontSize: "0.95rem", fontWeight: 600, fontFamily: appleFont,
                    width: "100%",
                  }}>
                    <Loader2 size={18} className="animate-spin" />
                    Авторизация...
                  </div>
                )}

                {!isTelegramLoading && telegramWidgetFailed && (
                  <div style={{
                    width: "100%", textAlign: "center", padding: "0.5rem 0",
                    fontSize: "0.85rem", color: "#86868B", fontFamily: appleFont,
                  }}>
                    Виджет Telegram не загрузился
                  </div>
                )}

                {!isTelegramLoading && !telegramWidgetFailed && !telegramWidgetReady && (
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem",
                    color: "#86868B",
                    fontSize: "0.85rem",
                    fontFamily: appleFont,
                    pointerEvents: "none",
                    zIndex: 1,
                  }}>
                    <Loader2 size={16} className="animate-spin" />
                    Загрузка Telegram…
                  </div>
                )}

                {/* Official widget host — always laid out (never display:none / CSS scale). */}
                <div
                  id="telegram-login-widget"
                  ref={widgetHostRef}
                  aria-hidden={isTelegramLoading || telegramWidgetFailed || !telegramWidgetReady}
                  style={{
                    width: "100%",
                    minHeight: 48,
                    display: isTelegramLoading || telegramWidgetFailed ? "none" : "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    visibility: telegramWidgetReady ? "visible" : "hidden",
                  }}
                />
              </div>
            ) : (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 52, borderRadius: 14, background: "#e8e8ed",
                fontSize: "0.85rem", color: "#86868B", fontFamily: appleFont,
              }}>
                Telegram-авторизация не настроена
              </div>
            )}

            {telegramWidgetFailed && botUsername && (
              <button
                type="button"
                onClick={reloadTelegramWidget}
                style={{
                  marginTop: "0.65rem",
                  width: "100%",
                  height: 40,
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.08)",
                  background: "#fff",
                  cursor: "pointer",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "#007AFF",
                  fontFamily: appleFont,
                }}
              >
                Повторить загрузку Telegram
              </button>
            )}
          </div>

          <p style={{ fontSize: "0.72rem", color: "#AEAEB2", marginTop: "1.5rem", textAlign: "center", lineHeight: 1.6, maxWidth: 320 }}>
            Создавая аккаунт, вы соглашаетесь с{" "}
            <a href="/oferta" style={{ color: "#007AFF", textDecoration: "none" }}>договором оферты</a>
            {" "}и{" "}
            <a href="/privacy" style={{ color: "#007AFF", textDecoration: "none" }}>политикой конфиденциальности</a>
          </p>

          <button
            onClick={() => setLocation("/")}
            style={{ marginTop: "1rem", background: "none", border: "none", cursor: "pointer", fontSize: "0.82rem", color: "#AEAEB2", fontFamily: appleFont }}
          >
            ← Вернуться на главную
          </button>
        </motion.div>
      </div>

      <div className="auth-right" style={{
        background: "linear-gradient(135deg, #1e1e24 10%, #050505 60%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        overflow: "hidden",
      }}>
        <div style={{ width: "100%", maxWidth: 600, aspectRatio: "16/9" }}>
          <AgentSVG />
        </div>
      </div>
    </div>
  );
}
