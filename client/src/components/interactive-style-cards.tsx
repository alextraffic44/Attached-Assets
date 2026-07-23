import { useState } from "react";

export type InteractiveStyleId = "parallax" | "split" | "action" | "motion" | "trigger";

export const INTERACTIVE_STYLES: Array<{
  id: InteractiveStyleId;
  label: string;
  desc: string;
}> = [
  { id: "parallax", label: "Параллакс", desc: "Видео на весь экран, текст поверх" },
  { id: "split", label: "Сплит", desc: "Текст слева, продукт справа" },
  { id: "action", label: "Экшн", desc: "Слоумо и облёт камеры" },
  { id: "motion", label: "Моушн", desc: "Объект морфится · текст слева" },
  { id: "trigger", label: "Тригер", desc: "Сцены следят за курсором" },
];

function HeroPreview({ id, playing }: { id: InteractiveStyleId; playing: boolean }) {
  const play = playing ? "running" : "paused";

  if (id === "parallax") {
    return (
      <div className="isp-stage isp-parallax" data-playing={playing ? "1" : "0"}>
        <div className="isp-parallax-sky" style={{ animationPlayState: play }} />
        <div className="isp-parallax-mid" style={{ animationPlayState: play }} />
        <div className="isp-parallax-fg" style={{ animationPlayState: play }} />
        <div className="isp-parallax-copy" style={{ animationPlayState: play }}>
          <span className="isp-kicker">HERO</span>
          <span className="isp-title">Full-bleed motion</span>
        </div>
        <div className="isp-parallax-scrim" />
      </div>
    );
  }

  if (id === "split") {
    return (
      <div className="isp-stage isp-split" data-playing={playing ? "1" : "0"}>
        <div className="isp-split-left">
          <span className="isp-kicker dark">SPLIT</span>
          <span className="isp-title dark">Left · Right</span>
          <span className="isp-line" style={{ animationPlayState: play }} />
        </div>
        <div className="isp-split-right">
          <div className="isp-split-orb" style={{ animationPlayState: play }} />
          <div className="isp-split-ring" style={{ animationPlayState: play }} />
        </div>
      </div>
    );
  }

  if (id === "action") {
    return (
      <div className="isp-stage isp-action" data-playing={playing ? "1" : "0"}>
        <div className="isp-action-burst" style={{ animationPlayState: play }} />
        <div className="isp-action-orbit" style={{ animationPlayState: play }} />
        <div className="isp-action-orbit isp-action-orbit-2" style={{ animationPlayState: play }} />
        <div className="isp-action-core" style={{ animationPlayState: play }} />
        <div className="isp-action-streaks" style={{ animationPlayState: play }} />
        <div className="isp-parallax-copy isp-action-copy">
          <span className="isp-kicker">ACTION</span>
          <span className="isp-title">Slow-mo orbit</span>
        </div>
      </div>
    );
  }

  if (id === "motion") {
    return (
      <div className="isp-stage isp-motion" data-playing={playing ? "1" : "0"}>
        <div className="isp-motion-copy">
          <span className="isp-kicker dark">MOTION</span>
          <span className="isp-title dark">Morph object</span>
        </div>
        <div className="isp-motion-blob" style={{ animationPlayState: play }} />
        <div className="isp-motion-blob isp-motion-blob-2" style={{ animationPlayState: play }} />
      </div>
    );
  }

  return (
    <div className="isp-stage isp-trigger" data-playing={playing ? "1" : "0"}>
      <div className="isp-trigger-panel" style={{ animationPlayState: play }} />
      <div className="isp-trigger-panel isp-trigger-panel-r" style={{ animationPlayState: play }} />
      <div className="isp-trigger-cursor" style={{ animationPlayState: play }} />
      <div className="isp-parallax-copy">
        <span className="isp-kicker">TRIGGER</span>
        <span className="isp-title">Follow cursor</span>
      </div>
    </div>
  );
}

export function InteractiveStyleCards({
  value,
  onChange,
}: {
  value: InteractiveStyleId;
  onChange: (id: InteractiveStyleId) => void;
}) {
  const [hovered, setHovered] = useState<InteractiveStyleId | null>(null);

  return (
    <div className="isp-root">
      <style>{ISP_CSS}</style>
      <div className="isp-grid">
        {INTERACTIVE_STYLES.map((s) => {
          const selected = value === s.id;
          const playing = hovered === s.id || selected;
          return (
            <button
              key={s.id}
              type="button"
              data-testid={`button-interactive-style-${s.id}`}
              className={`isp-card${selected ? " is-selected" : ""}`}
              onClick={() => onChange(s.id)}
              onMouseEnter={() => setHovered(s.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(s.id)}
              onBlur={() => setHovered(null)}
            >
              <div className="isp-media">
                <HeroPreview id={s.id} playing={playing} />
                <div className={`isp-play${playing ? " is-on" : ""}`} aria-hidden>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M8 5.5v13l11-6.5L8 5.5z" />
                  </svg>
                </div>
              </div>
              <div className="isp-meta">
                <span className="isp-name">{s.label}</span>
                <span className="isp-desc">{s.desc}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ISP_CSS = `
.isp-root { width: 100%; }
.isp-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
  justify-content: center;
}
.isp-card {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  border-radius: 18px;
  width: calc((100% - 1.7rem) / 3);
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
@media (max-width: 720px) {
  .isp-card { width: calc((100% - 0.65rem) / 2); }
  .isp-grid { gap: 0.65rem; }
}
@media (max-width: 420px) {
  .isp-card { width: 100%; }
}
.isp-card:hover { transform: translateY(-3px); }
.isp-card:focus-visible { outline: 2px solid rgba(13,148,136,0.55); outline-offset: 3px; }
.isp-media {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 16px;
  overflow: hidden;
  background: #0c0d10;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.06) inset,
    0 10px 28px rgba(0,0,0,0.12);
  border: 1.5px solid rgba(0,0,0,0.08);
  transition: border-color 0.25s ease, box-shadow 0.35s ease;
}
.isp-card:hover .isp-media {
  border-color: rgba(0,0,0,0.16);
  box-shadow: 0 14px 36px rgba(0,0,0,0.16);
}
.isp-card.is-selected .isp-media {
  border-color: rgba(13,148,136,0.65);
  box-shadow:
    0 0 0 2px rgba(13,148,136,0.18),
    0 14px 36px rgba(13,148,136,0.18);
}
.isp-meta { padding: 0 0.15rem 0.1rem; min-width: 0; }
.isp-name {
  display: block;
  font-size: 0.84rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #1D1D1F;
  line-height: 1.2;
}
.isp-card.is-selected .isp-name { color: #0f766e; }
.isp-desc {
  display: block;
  margin-top: 0.18rem;
  font-size: 0.68rem;
  line-height: 1.35;
  color: #86868B;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.isp-play {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: #fff;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.18);
  opacity: 0.85;
  transition: opacity 0.2s, transform 0.25s, background 0.2s;
  pointer-events: none;
}
.isp-play.is-on {
  opacity: 0;
  transform: scale(0.85);
}
.isp-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.isp-kicker {
  display: block;
  font-size: 0.48rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: rgba(255,255,255,0.55);
  margin-bottom: 0.2rem;
}
.isp-kicker.dark { color: rgba(29,29,31,0.45); }
.isp-title {
  display: block;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #fff;
  line-height: 1.15;
}
.isp-title.dark { color: #1D1D1F; }

/* Parallax */
.isp-parallax { background: linear-gradient(155deg, #06141a 0%, #0b2a32 45%, #123c48 100%); }
.isp-parallax-sky {
  position: absolute; inset: -20%;
  background:
    radial-gradient(ellipse 50% 40% at 70% 30%, rgba(45,212,191,0.35), transparent 60%),
    radial-gradient(ellipse 40% 35% at 20% 70%, rgba(14,165,233,0.25), transparent 55%);
  animation: isp-drift 8s ease-in-out infinite alternate;
}
.isp-parallax-mid {
  position: absolute; left: -10%; right: -10%; bottom: 18%; height: 42%;
  background: linear-gradient(180deg, transparent, rgba(6,20,26,0.55));
  border-radius: 40% 40% 0 0;
  transform: scaleX(1.1);
  animation: isp-mid 7s ease-in-out infinite alternate;
}
.isp-parallax-fg {
  position: absolute; left: 8%; right: 8%; bottom: 10%; height: 28%;
  background: linear-gradient(180deg, rgba(15,118,110,0.15), rgba(2,8,12,0.85));
  border-radius: 24px 24px 0 0;
  animation: isp-fg 5.5s ease-in-out infinite alternate;
}
.isp-parallax-scrim {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, transparent 35%, rgba(0,0,0,0.45) 100%);
  pointer-events: none;
}
.isp-parallax-copy {
  position: absolute; left: 10%; bottom: 14%; z-index: 2;
  animation: isp-copy 6s ease-in-out infinite alternate;
}

/* Split */
.isp-split { display: grid; grid-template-columns: 1.05fr 1fr; background: #f3efe8; }
.isp-split-left {
  display: flex; flex-direction: column; justify-content: center;
  padding: 0 10% 0 12%; gap: 0.15rem;
  background: linear-gradient(160deg, #f7f3ec, #ebe4d8);
}
.isp-line {
  width: 28px; height: 2px; margin-top: 0.35rem; border-radius: 2px;
  background: #c4a574;
  animation: isp-line 3.5s ease-in-out infinite alternate;
}
.isp-split-right {
  position: relative;
  background: linear-gradient(145deg, #1a2330 0%, #243447 100%);
  overflow: hidden;
}
.isp-split-orb {
  position: absolute; width: 46%; aspect-ratio: 1; border-radius: 50%;
  left: 50%; top: 50%; transform: translate(-50%, -50%);
  background: radial-gradient(circle at 35% 30%, #f5e6c8, #c49a5c 45%, #6b4a28 100%);
  box-shadow: 0 12px 28px rgba(0,0,0,0.35);
  animation: isp-orb 4.5s ease-in-out infinite alternate;
}
.isp-split-ring {
  position: absolute; width: 62%; aspect-ratio: 1; border-radius: 50%;
  left: 50%; top: 50%; transform: translate(-50%, -50%);
  border: 1px solid rgba(255,255,255,0.18);
  animation: isp-ring 5s ease-in-out infinite alternate;
}

/* Action */
.isp-action { background: radial-gradient(circle at 50% 45%, #1c2433, #07090d 70%); }
.isp-action-burst {
  position: absolute; inset: 8%;
  background: radial-gradient(circle, rgba(251,146,60,0.22), transparent 55%);
  animation: isp-pulse 3.2s ease-in-out infinite;
}
.isp-action-orbit {
  position: absolute; width: 58%; aspect-ratio: 1; border-radius: 50%;
  left: 50%; top: 46%; transform: translate(-50%, -50%);
  border: 1px dashed rgba(251,146,60,0.35);
  animation: isp-spin 9s linear infinite;
}
.isp-action-orbit-2 {
  width: 74%; border-color: rgba(255,255,255,0.12);
  animation-duration: 14s; animation-direction: reverse;
}
.isp-action-core {
  position: absolute; width: 22%; aspect-ratio: 1; border-radius: 50%;
  left: 50%; top: 46%; transform: translate(-50%, -50%);
  background: radial-gradient(circle at 35% 30%, #fff7ed, #fb923c 50%, #9a3412);
  box-shadow: 0 0 24px rgba(251,146,60,0.45);
  animation: isp-core 3.8s ease-in-out infinite alternate;
}
.isp-action-streaks {
  position: absolute; inset: 0;
  background:
    linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.08) 50%, transparent 60%),
    linear-gradient(75deg, transparent 35%, rgba(251,146,60,0.12) 48%, transparent 62%);
  background-size: 200% 100%;
  animation: isp-streak 4s linear infinite;
}
.isp-action-copy { bottom: 10%; left: 8%; }

/* Motion */
.isp-motion {
  background: linear-gradient(135deg, #eef2f6 0%, #e2e8f0 100%);
}
.isp-motion-copy {
  position: absolute; left: 9%; top: 50%; transform: translateY(-50%); z-index: 2;
}
.isp-motion-blob {
  position: absolute; right: 8%; top: 50%; width: 42%; aspect-ratio: 1;
  transform: translateY(-50%);
  border-radius: 58% 42% 48% 52% / 48% 55% 45% 52%;
  background: linear-gradient(145deg, #5eead4, #0d9488 55%, #115e59);
  box-shadow: 0 16px 32px rgba(13,148,136,0.28);
  animation: isp-morph 5s ease-in-out infinite;
}
.isp-motion-blob-2 {
  width: 28%; right: 18%; opacity: 0.35; filter: blur(6px);
  animation-duration: 6.5s; animation-direction: reverse;
}

/* Trigger */
.isp-trigger { background: #0a0b0e; }
.isp-trigger-panel {
  position: absolute; left: 6%; top: 14%; bottom: 14%; width: 34%;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
  border: 1px solid rgba(255,255,255,0.08);
  animation: isp-panel-l 4.5s ease-in-out infinite alternate;
}
.isp-trigger-panel-r {
  left: auto; right: 6%; width: 40%;
  background: linear-gradient(160deg, rgba(56,189,248,0.18), rgba(255,255,255,0.04));
  animation-name: isp-panel-r;
}
.isp-trigger-cursor {
  position: absolute; width: 10px; height: 10px; border-radius: 50%;
  background: #fff; box-shadow: 0 0 16px rgba(56,189,248,0.8);
  animation: isp-cursor 5s ease-in-out infinite;
  z-index: 3;
}

@keyframes isp-drift { from { transform: translate3d(-2%, -1%, 0) scale(1); } to { transform: translate3d(3%, 2%, 0) scale(1.06); } }
@keyframes isp-mid { from { transform: translateY(4%) scaleX(1.05); } to { transform: translateY(-3%) scaleX(1.12); } }
@keyframes isp-fg { from { transform: translateY(6%); } to { transform: translateY(-4%); } }
@keyframes isp-copy { from { transform: translateY(4px); opacity: 0.92; } to { transform: translateY(-2px); opacity: 1; } }
@keyframes isp-line { from { width: 18px; opacity: 0.6; } to { width: 36px; opacity: 1; } }
@keyframes isp-orb { from { transform: translate(-52%, -48%) scale(0.96); } to { transform: translate(-46%, -54%) scale(1.04); } }
@keyframes isp-ring { from { transform: translate(-50%, -50%) scale(0.92); opacity: 0.5; } to { transform: translate(-50%, -50%) scale(1.08); opacity: 1; } }
@keyframes isp-pulse { 0%,100% { opacity: 0.55; transform: scale(0.96); } 50% { opacity: 1; transform: scale(1.05); } }
@keyframes isp-spin { to { transform: translate(-50%, -50%) rotate(360deg); } }
@keyframes isp-core { from { transform: translate(-50%, -50%) scale(0.94); } to { transform: translate(-48%, -52%) scale(1.06); } }
@keyframes isp-streak { from { background-position: 120% 0, -20% 0; } to { background-position: -40% 0, 140% 0; } }
@keyframes isp-morph {
  0% { border-radius: 58% 42% 48% 52% / 48% 55% 45% 52%; transform: translateY(-50%) rotate(0deg); }
  50% { border-radius: 42% 58% 52% 48% / 55% 42% 58% 45%; transform: translateY(-52%) rotate(8deg); }
  100% { border-radius: 52% 48% 42% 58% / 45% 52% 48% 55%; transform: translateY(-48%) rotate(-4deg); }
}
@keyframes isp-panel-l { from { transform: translateX(0); } to { transform: translateX(-6%); } }
@keyframes isp-panel-r { from { transform: translateX(0); } to { transform: translateX(7%); } }
@keyframes isp-cursor {
  0% { left: 28%; top: 42%; }
  35% { left: 62%; top: 28%; }
  65% { left: 72%; top: 58%; }
  100% { left: 28%; top: 42%; }
}
`;
