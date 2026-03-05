import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles } from "lucide-react";

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
  @keyframes type3 { 0%, 35% { width: 0; } 45%, 95% { width: 160px; } 96%, 100% { width: 0; } }
  .mask-4 { animation: type4 10s infinite linear; }
  @keyframes type4 { 0%, 50% { width: 0; } 60%, 95% { width: 220px; } 96%, 100% { width: 0; } }
  .mask-5 { animation: type5 10s infinite linear; }
  @keyframes type5 { 0%, 65% { width: 0; } 70%, 95% { width: 40px; } 96%, 100% { width: 0; } }
  .mask-6 { animation: type6 10s infinite linear; }
  @keyframes type6 { 0%, 75% { width: 0; } 85%, 95% { width: 250px; } 96%, 100% { width: 0; } }
  .dot { animation: dotFade 1.5s infinite; }
  .dot:nth-child(2) { animation-delay: 0.5s; }
  .dot:nth-child(3) { animation-delay: 1s; }
  @keyframes dotFade { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }
  .c1 { animation: cur1 10s infinite linear; }
  @keyframes cur1 { 0% { transform: translate(300px, 206px); opacity: 1; } 10% { transform: translate(450px, 206px); opacity: 1; } 10.01%, 100% { opacity: 0; } }
  .c2 { animation: cur2 10s infinite linear; }
  @keyframes cur2 { 0%, 14.99% { opacity: 0; } 15% { transform: translate(300px, 241px); opacity: 1; } 30% { transform: translate(550px, 241px); opacity: 1; } 30.01%, 100% { opacity: 0; } }
  .c3 { animation: cur3 10s infinite linear; }
  @keyframes cur3 { 0%, 34.99% { opacity: 0; } 35% { transform: translate(300px, 276px); opacity: 1; } 45% { transform: translate(450px, 276px); opacity: 1; } 45.01%, 100% { opacity: 0; } }
  .c4 { animation: cur4 10s infinite linear; }
  @keyframes cur4 { 0%, 49.99% { opacity: 0; } 50% { transform: translate(300px, 311px); opacity: 1; } 60% { transform: translate(500px, 311px); opacity: 1; } 60.01%, 100% { opacity: 0; } }
  .c5 { animation: cur5 10s infinite linear; }
  @keyframes cur5 { 0%, 64.99% { opacity: 0; } 65% { transform: translate(300px, 346px); opacity: 1; } 70% { transform: translate(330px, 346px); opacity: 1; } 70.01%, 100% { opacity: 0; } }
  .c6 { animation: cur6 10s infinite linear; }
  @keyframes cur6 { 0%, 74.99% { opacity: 0; } 75% { transform: translate(300px, 381px); opacity: 1; } 85% { transform: translate(530px, 381px); opacity: 1; } 86%, 88%, 90%, 92%, 94% { opacity: 0; transform: translate(530px, 381px); } 87%, 89%, 91%, 93%, 95% { opacity: 1; transform: translate(530px, 381px); } 95.01%, 100% { opacity: 0; } }
`;

const AgentSVG = () => (
  <svg viewBox="0 0 900 600" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="heavy-blur" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="30" result="blur" />
      </filter>
      <filter id="glow-light" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
      <linearGradient id="metal-text" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#626262" />
        <stop offset="100%" stopColor="#ffffff" />
      </linearGradient>
      <pattern id="hex-grid" width="30" height="52" patternUnits="userSpaceOnUse" patternTransform="scale(0.5)">
        <path d="M 15 0 L 30 13 L 30 39 L 15 52 L 0 39 L 0 13 Z" fill="none" stroke="#626262" strokeWidth="1" opacity="0.15"/>
      </pattern>
      <mask id="code-mask-1"><rect x="300" y="200" width="0" height="30" fill="white" className="mask-1" /></mask>
      <mask id="code-mask-2"><rect x="300" y="235" width="0" height="30" fill="white" className="mask-2" /></mask>
      <mask id="code-mask-3"><rect x="300" y="270" width="0" height="30" fill="white" className="mask-3" /></mask>
      <mask id="code-mask-4"><rect x="300" y="305" width="0" height="30" fill="white" className="mask-4" /></mask>
      <mask id="code-mask-5"><rect x="300" y="340" width="0" height="30" fill="white" className="mask-5" /></mask>
      <mask id="code-mask-6"><rect x="300" y="375" width="0" height="30" fill="white" className="mask-6" /></mask>
    </defs>
    <rect width="900" height="600" fill="url(#hex-grid)" />
    <g filter="url(#heavy-blur)" className="glow-pulse">
      <circle cx="350" cy="200" r="110" fill="hsl(27deg 93% 60%)" opacity="0.6" />
      <circle cx="680" cy="200" r="120" fill="#00a6ff" opacity="0.6" />
      <circle cx="350" cy="400" r="100" fill="#ff0056" opacity="0.6" />
      <circle cx="680" cy="400" r="130" fill="#6500ff" opacity="0.6" />
    </g>
    <g>
      <rect x="260" y="140" width="520" height="320" rx="16" fill="#050505" stroke="#1e1e24" strokeWidth="2" opacity="0.9" />
      <path d="M 260 156 A 16 16 0 0 1 276 140 L 764 140 A 16 16 0 0 1 780 156 L 780 170 L 260 170 Z" fill="#1e1e24" />
      <circle cx="285" cy="155" r="6" fill="#ff0056" />
      <circle cx="305" cy="155" r="6" fill="hsl(27deg 93% 60%)" />
      <circle cx="325" cy="155" r="6" fill="#00a6ff" />
      <text x="520" y="160" fill="url(#metal-text)" fontSize="14" fontFamily="monospace" fontWeight="bold" textAnchor="middle" letterSpacing="1">NEON_AGENT_MODULE.ts</text>
      <line x1="260" y1="170" x2="780" y2="170" stroke="#1e1e24" strokeWidth="2" />
      <g fontFamily="monospace" fontSize="14" fill="#626262" textAnchor="end">
        <text x="285" y="220">1</text>
        <text x="285" y="255">2</text>
        <text x="285" y="290">3</text>
        <text x="285" y="325">4</text>
        <text x="285" y="360">5</text>
        <text x="285" y="395">6</text>
      </g>
      <line x1="292" y1="170" x2="292" y2="460" stroke="#1e1e24" strokeWidth="1" />
    </g>
    <g className="code-font code-group">
      <g mask="url(#code-mask-1)">
        <text x="300" y="220" fill="url(#metal-text)">// Initialize Agent Protocol</text>
      </g>
      <g mask="url(#code-mask-2)">
        <text x="300" y="255">
          <tspan fill="#8e44ff">const</tspan>{" "}<tspan fill="#00a6ff">agent</tspan>{" "}<tspan fill="#ffffff">=</tspan>{" "}<tspan fill="#8e44ff">new</tspan>{" "}<tspan fill="hsl(27deg 93% 60%)">AIAgent</tspan>{"();"}
        </text>
      </g>
      <g mask="url(#code-mask-3)">
        <text x="300" y="290">
          <tspan fill="#00a6ff">agent</tspan>{"."}<tspan fill="#ff0056">connect</tspan>{"({"}
        </text>
      </g>
      <g mask="url(#code-mask-4)">
        <text x="300" y="325">
          <tspan fill="#ffffff">{"  mode:"}</tspan>{" "}<tspan fill="hsl(27deg 93% 60%)">"autonomous"</tspan><tspan fill="#ffffff">,</tspan>
        </text>
      </g>
      <g mask="url(#code-mask-5)">
        <text x="300" y="360" fill="#ffffff">{"});"}</text>
      </g>
      <g mask="url(#code-mask-6)">
        <text x="300" y="395">
          <tspan fill="#8e44ff">await</tspan>{" "}<tspan fill="#00a6ff">agent</tspan>{"."}<tspan fill="#ff0056">deploy</tspan>{"();"}
        </text>
      </g>
    </g>
    <g className="code-group">
      <rect className="cursor c1" width="10" height="18" fill="#fff" />
      <rect className="cursor c2" width="10" height="18" fill="#fff" />
      <rect className="cursor c3" width="10" height="18" fill="#fff" />
      <rect className="cursor c4" width="10" height="18" fill="#fff" />
      <rect className="cursor c5" width="10" height="18" fill="#fff" />
      <rect className="cursor c6" width="10" height="18" fill="#fff" />
    </g>
    <g className="robot-float" style={{ transform: "translate(30px, 30px)" }}>
      <line x1="130" y1="155" x2="130" y2="185" stroke="#626262" strokeWidth="2"/>
      <circle cx="130" cy="148" r="7" className="antenna-glow"/>
      <rect x="70" y="180" width="120" height="100" rx="25" fill="#1e1e24" stroke="#626262" strokeWidth="1.5"/>
      <rect x="55" y="210" width="20" height="40" rx="5" fill="#050505" stroke="#1e1e24" strokeWidth="2"/>
      <rect x="185" y="210" width="20" height="40" rx="5" fill="#050505" stroke="#1e1e24" strokeWidth="2"/>
      <rect x="85" y="195" width="90" height="55" rx="12" fill="#050505" stroke="#1e1e24" strokeWidth="2"/>
      <g className="eye-blink">
        <circle cx="110" cy="225" r="8" fill="#00a6ff" filter="url(#glow-light)"/>
        <circle cx="110" cy="225" r="3" fill="#ffffff" className="pupil" style={{ transformOrigin: "110px 225px" }}/>
        <circle cx="150" cy="225" r="8" fill="#00a6ff" filter="url(#glow-light)"/>
        <circle cx="150" cy="225" r="3" fill="#ffffff" className="pupil" style={{ transformOrigin: "150px 225px" }}/>
      </g>
      <rect x="115" y="280" width="30" height="15" fill="#1e1e24" />
      <g className="hand-left">
        <rect x="85" y="300" width="30" height="15" rx="7" fill="#ff0056" filter="url(#glow-light)"/>
      </g>
      <g className="hand-right">
        <rect x="145" y="300" width="30" height="15" rx="7" fill="#00a6ff" filter="url(#glow-light)"/>
      </g>
    </g>
    <text x="450" y="540" fontSize="20" fontWeight="bold" letterSpacing="2" textAnchor="middle">
      <tspan fill="#ff0056" filter="url(#glow-light)">SYS_READY: </tspan>
      <tspan fill="url(#metal-text)">Агент компилирует код</tspan>
      <tspan className="dot" fill="url(#metal-text)">.</tspan>
      <tspan className="dot" fill="url(#metal-text)">.</tspan>
      <tspan className="dot" fill="url(#metal-text)">.</tspan>
    </text>
    <path d="M 170 530 L 160 530 L 160 545 L 170 545" fill="none" stroke="#626262" strokeWidth="2" />
    <path d="M 730 530 L 740 530 L 740 545 L 730 545" fill="none" stroke="#626262" strokeWidth="2" />
  </svg>
);

declare global {
  interface Window { onTelegramAuth?: (user: any) => void; }
}

export default function AuthPage() {
  const [isTelegramLoading, setIsTelegramLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;

  useEffect(() => {
    const style = document.createElement("style");
    style.id = "auth-svg-styles";
    style.textContent = SVG_CSS;
    document.head.appendChild(style);
    return () => { document.getElementById("auth-svg-styles")?.remove(); };
  }, []);

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
    return () => { document.getElementById("telegram-widget")?.remove(); delete window.onTelegramAuth; };
  }, [botUsername, setLocation, toast]);

  return (
    <div style={{ fontFamily: appleFont, minHeight: "100vh", display: "flex", overflow: "hidden" }}>

      {/* LEFT — Auth */}
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
        {/* Subtle background blobs */}
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
          {/* Heading */}
          <h1 className="craft-title" style={{ fontSize: "2.6rem", fontWeight: 800, letterSpacing: "-0.05em", margin: "0 0 0.4rem", textAlign: "center" }}>
            Craft AI
          </h1>
          <p style={{ fontSize: "0.9rem", color: "#86868B", margin: "0 0 2.25rem", textAlign: "center" }}>
            ИИ-конструктор сайтов нового поколения
          </p>

          {/* Auth card */}
          <div style={{
            width: "100%",
            background: "#F5F5F7",
            borderRadius: 24,
            padding: "1.75rem",
            border: "1px solid rgba(0,0,0,0.06)",
          }}>
            {/* Card header */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem" }}>
              <Sparkles size={16} style={{ color: "#007AFF" }} />
              <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1D1D1F", letterSpacing: "-0.01em" }}>Авторизация</span>
            </div>

            {/* Telegram button area */}
            {isTelegramLoading ? (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem",
                height: 52, borderRadius: 14, background: "#2AABEE", color: "#fff",
                fontSize: "0.95rem", fontWeight: 600,
              }}>
                <Loader2 size={18} className="animate-spin" />
                Авторизация...
              </div>
            ) : botUsername ? (
              <div id="telegram-widget-container" style={{
                display: "flex", justifyContent: "center",
                background: "#fff", borderRadius: 14, padding: "0.75rem",
                border: "1px solid rgba(0,0,0,0.06)",
              }} />
            ) : (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 52, borderRadius: 14, background: "#e8e8ed",
                fontSize: "0.85rem", color: "#86868B",
              }}>
                Telegram-авторизация не настроена
              </div>
            )}
          </div>

          {/* Legal */}
          <p style={{ fontSize: "0.72rem", color: "#AEAEB2", marginTop: "1.5rem", textAlign: "center", lineHeight: 1.6, maxWidth: 320 }}>
            Создавая аккаунт, вы соглашаетесь с{" "}
            <a href="/oferta" style={{ color: "#007AFF", textDecoration: "none" }}>договором оферты</a>
            {" "}и{" "}
            <a href="/privacy" style={{ color: "#007AFF", textDecoration: "none" }}>политикой конфиденциальности</a>
          </p>

          {/* Back */}
          <button
            onClick={() => setLocation("/")}
            style={{ marginTop: "1rem", background: "none", border: "none", cursor: "pointer", fontSize: "0.82rem", color: "#AEAEB2", fontFamily: appleFont }}
          >
            ← Вернуться на главную
          </button>
        </motion.div>
      </div>

      {/* RIGHT — SVG Animation */}
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
