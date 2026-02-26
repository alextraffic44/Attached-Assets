import { useState, useEffect } from "react";
import { useLocation } from "wouter";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const accepted = localStorage.getItem("cookie-consent");
    if (!accepted) {
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const accept = () => {
    localStorage.setItem("cookie-consent", "accepted");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "1.5rem",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        width: "calc(100% - 3rem)",
        maxWidth: "680px",
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: "16px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.12)",
        padding: "1.1rem 1.4rem",
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        flexWrap: "wrap",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
        animation: "cookieSlideUp 0.4s cubic-bezier(0.2,0.8,0.2,1) forwards",
      }}
    >
      <style>{`
        @keyframes cookieSlideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
      <div style={{ flex: 1, minWidth: "200px" }}>
        <span style={{ fontSize: "0.88rem", color: "#1D1D1F", lineHeight: 1.5 }}>
          Мы используем <strong>куки</strong>, чтобы сайт работал лучше. Продолжая пользоваться сайтом, вы соглашаетесь с нашей{" "}
          <button
            onClick={() => setLocation("/privacy")}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "#42A5FF",
              cursor: "pointer",
              fontSize: "inherit",
              textDecoration: "underline",
              textDecorationColor: "rgba(66,165,255,0.4)",
            }}
          >
            Политикой конфиденциальности
          </button>
          .
        </span>
      </div>
      <button
        onClick={accept}
        data-testid="button-accept-cookies"
        style={{
          flexShrink: 0,
          background: "#1D1D1F",
          color: "#fff",
          border: "none",
          borderRadius: "10px",
          padding: "0.55rem 1.3rem",
          fontSize: "0.85rem",
          fontWeight: 600,
          cursor: "pointer",
          letterSpacing: "-0.01em",
          transition: "background 0.2s",
          fontFamily: "inherit",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "#333")}
        onMouseLeave={e => (e.currentTarget.style.background = "#1D1D1F")}
      >
        Понятно
      </button>
    </div>
  );
}
