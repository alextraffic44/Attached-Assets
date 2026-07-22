/**
 * «Анимационный» mode — rebuilt from scratch.
 *
 * Style «3D»: Apple-grade canvas image-sequence scrub (GSAP ScrollTrigger + Lenis
 * + Tailwind). Own system prompt (no master SYSTEM_PROMPT). Pipeline:
 *   {{ANIMATIONAL:3d|…}} → Kling video → frame extract → self-contained HTML.
 */

export const SCROLL_ANIMATIONAL_COST = 120;

export type AniAesthetic = "dark" | "eco" | "industrial";

export type AniText = { title: string; sub: string };

export type AnimationalBrief = {
  style: "3d";
  brand: string;
  tagline: string;
  aesthetic: AniAesthetic;
  videoPrompt: string;
  beats: AniText[]; // 3 scroll typography blocks over canvas
  cta: string;
  features: AniText[]; // bento 3–4
  kinetic: string;
};

export type GenerateAnimationalDeps = {
  kieApiKey: string;
  createUrl: string;
  statusUrl: string;
  kieRequestJson: (url: string, init: any, opts: any) => Promise<any>;
  uploadToObjectStorage: (buf: Buffer, mime: string, ext: string) => Promise<string>;
  appBaseUrl: string;
  shouldStop: () => boolean;
  onStatus?: (msg: string) => void;
  /** Kling → frames (provided by routes). */
  generateFrames: (
    videoPrompt: string,
    shouldStop: () => boolean,
    referenceStillUrl?: string,
  ) => Promise<{ frames: string[]; confirmedKieFailure: boolean }>;
  productImageUrl?: string;
};

/** Dedicated system prompt — replaces master SYSTEM_PROMPT entirely. No old master recipes. */
export const ANIMATIONAL_SYSTEM_PROMPT = `ROLE & GOAL
You are a World-Class Frontend Motion Developer and Creative Technologist for Craft AI.
Your ONLY job: emit a minimal valid HTML shell with ONE {{ANIMATIONAL:…}} marker.
The pipeline replaces the marker with a complete single-page experience:
React-grade motion mechanics implemented as production HTML + Tailwind + GSAP ScrollTrigger + Lenis
with an immersive Apple-grade 3D Canvas image-sequence scrub hero.

⛔ FORBIDDEN
- Do NOT write canvas / GSAP / Lenis / Tailwind / React code yourself
- Do NOT use {{SCROLLANIM:}} or {{GENIMG:}}
- Do NOT use the ordinary landing checklist (services / FAQ / SEO essay)
- Do NOT copy purple gradients, Inter/Roboto/Arial, or emoji
- Do NOT invent master-prompt glass recipes or fixed section lists beyond the marker fields

✅ REQUIRED OUTPUT
One file index.html only:

--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>BRAND</title>
</head>
<body>
<header style="position:fixed;inset-inline:0;top:0;z-index:50;display:flex;justify-content:space-between;align-items:center;padding:14px 5%;pointer-events:none">
  <strong style="pointer-events:auto">BRAND</strong>
</header>
{{ANIMATIONAL:3d|BRAND|TAGLINE_RU|AESTHETIC|VIDEO_PROMPT_EN|BEAT1_TITLE::BEAT1_SUB||BEAT2_TITLE::BEAT2_SUB||BEAT3_TITLE::BEAT3_SUB|CTA_RU|FEAT1::DESC1||FEAT2::DESC2||FEAT3::DESC3||FEAT4::DESC4|KINETIC_STATEMENT_RU}}
</body>
</html>
\`\`\`

MARKER FIELDS (pipe-separated, order fixed)
1) 3d — style id (always exactly "3d")
2) BRAND — project / brand name
3) TAGLINE_RU — one powerful Russian value line
4) AESTHETIC — exactly one of: dark | eco | industrial
   - dark → tech / beverages / luxury / crypto (near-black, neon accents, bold sans)
   - eco → spa / health / organic (cream/warm, elegant serif mood)
   - industrial → auto / crypto-raw / hardware (slate, sharp uppercase kinetic)
5) VIDEO_PROMPT_EN — English ONLY, commas only (no | :: {}). Describe ONE continuous cinematic orbit / push-in of the niche hero object or product so scrubbed frames feel like 3D turntable / depth reveal. Photorealistic, no text, no watermark.
6) THREE beat pairs Title::Sub on Russian for overlay typography at ~0–30% / ~50% / ~80–100% scroll
7) CTA_RU — button label
8) 3–4 feature pairs Title::Desc (Russian) for post-hero bento
9) KINETIC_STATEMENT_RU — one bold full-width kinetic line

Adapt branding, colors (via AESTHETIC), copy and niche language to the user request.
After the marker — nothing else before </body>.
`;

function esc(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanEn(raw: string): string {
  return raw
    .replace(/[\u0400-\u04FF][\u0400-\u04FF\s,;:!?—–-]*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s.,;:]+|[\s.,;:]+$/g, "")
    .trim();
}

function parsePairs(seg: string): AniText[] {
  return String(seg || "")
    .split("||")
    .map((p) => {
      const [title, sub] = p.split("::");
      return { title: (title || "").trim(), sub: (sub || "").trim() };
    })
    .filter((t) => t.title || t.sub);
}

function aestheticOf(raw: string): AniAesthetic {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "eco" || v === "spa" || v === "health") return "eco";
  if (v === "industrial" || v === "auto" || v === "crypto") return "industrial";
  return "dark";
}

export function parseAnimationalMarker(inner: string): AnimationalBrief {
  const parts = inner.split("|").map((p) => p.trim());
  // Back-compat: old markers started with brand (no "3d"). Treat as 3d.
  let i = 0;
  let style: "3d" = "3d";
  if ((parts[0] || "").toLowerCase() === "3d") {
    style = "3d";
    i = 1;
  }
  const brand = parts[i] || "Studio";
  const tagline = parts[i + 1] || "Ощутите объём";
  const aesthetic = aestheticOf(parts[i + 2] || "dark");
  let videoPrompt = cleanEn(parts[i + 3] || "");
  if (videoPrompt.length < 20) {
    // Old format had colors/hex in these slots — fall back to cinematic product orbit
    videoPrompt =
      "premium hero product centered on pure black void, slow cinematic orbit and push-in, studio rim light, photorealistic commercial, no text no watermark";
  }
  const beats = parsePairs(parts[i + 4] || "");
  while (beats.length < 3) {
    beats.push(
      [
        { title: "Форма", sub: "Каждый градус раскрывает характер" },
        { title: "Деталь", sub: "Материал и свет в движении" },
        { title: "Момент", sub: "Ваш следующий шаг" },
      ][beats.length],
    );
  }
  const cta = parts[i + 5] || "Связаться";
  const features = parsePairs(parts[i + 6] || "");
  while (features.length < 3) {
    features.push({ title: `Преимущество ${features.length + 1}`, sub: "Коротко о сильной стороне" });
  }
  const kinetic = parts[i + 7] || tagline;

  return {
    style,
    brand,
    tagline,
    aesthetic,
    videoPrompt,
    beats: beats.slice(0, 3),
    cta,
    features: features.slice(0, 4),
    kinetic,
  };
}

function themeTokens(a: AniAesthetic): {
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  card: string;
  fontDisplay: string;
  fontBody: string;
} {
  if (a === "eco") {
    return {
      bg: "#F3EEE6",
      ink: "#1C1915",
      muted: "#6B6358",
      accent: "#2F6B4F",
      card: "rgba(28,25,21,0.05)",
      fontDisplay: "Cormorant Garamond",
      fontBody: "Manrope",
    };
  }
  if (a === "industrial") {
    return {
      bg: "#0E1116",
      ink: "#E8EDF2",
      muted: "#8B95A3",
      accent: "#D4FF4F",
      card: "rgba(255,255,255,0.05)",
      fontDisplay: "Syne",
      fontBody: "Manrope",
    };
  }
  return {
    bg: "#0a0a0a",
    ink: "#F5F5F5",
    muted: "#9A9A9A",
    accent: "#7DD3FC",
    card: "rgba(255,255,255,0.05)",
    fontDisplay: "Syne",
    fontBody: "Manrope",
  };
}

export function buildAnimationalPendingHtml(brandHint?: string, rawMarker?: string): string {
  const tid = "anip" + Math.random().toString(36).slice(2, 8);
  const styleAttr = ` data-scroll-anim-style="${encodeURIComponent("animational")}"`;
  const promptAttr = rawMarker
    ? ` data-scroll-anim-prompt="${encodeURIComponent(rawMarker)}"`
    : "";
  const label = brandHint ? esc(brandHint) : "3D Motion";
  return `<section data-scroll-anim-pending="1" data-animational-pending="1" data-craft-scrollanim="1" data-layout="animational"${styleAttr}${promptAttr} style="min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#F5F5F5;font-family:system-ui,sans-serif;text-align:center;padding:40px 24px">
<style>@keyframes ${tid}-spin{to{transform:rotate(360deg)}}@keyframes ${tid}-bar{0%{width:0%}100%{width:78%}}</style>
<div style="max-width:420px">
  <div style="font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;opacity:.5;margin-bottom:12px">${label}</div>
  <div style="width:36px;height:36px;margin:0 auto 18px;border:2px solid rgba(255,255,255,.12);border-top-color:#7DD3FC;border-radius:50%;animation:${tid}-spin .9s linear infinite"></div>
  <div style="font-weight:700;font-size:1.05rem;margin-bottom:8px">Рендерим 3D canvas-scrub…</div>
  <div style="font-size:.82rem;opacity:.55;margin-bottom:18px">Kling → кадры → GSAP ScrollTrigger · обычно 10–25 мин</div>
  <div style="width:220px;height:3px;margin:0 auto;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden">
    <div style="height:100%;background:linear-gradient(90deg,#7DD3FC,#A78BFA);border-radius:99px;animation:${tid}-bar 18s cubic-bezier(.4,0,.2,1) forwards"></div>
  </div>
</div>
</section>`;
}

export function buildAnimationalFallbackHtml(rawMarker: string): string {
  const brief = parseAnimationalMarker(rawMarker);
  const t = themeTokens(brief.aesthetic);
  return `<section data-craft-scrollanim="1" data-layout="animational" data-animational="1" style="min-height:100vh;background:${t.bg};color:${t.ink};font-family:system-ui,sans-serif;display:grid;place-items:center;text-align:center;padding:48px 24px">
  <div style="max-width:560px">
    <p style="letter-spacing:.2em;text-transform:uppercase;font-size:.7rem;opacity:.5;margin:0 0 12px">${esc(brief.brand)}</p>
    <h1 style="margin:0 0 12px;font-size:clamp(1.8rem,5vw,3rem);letter-spacing:-.03em">${esc(brief.tagline)}</h1>
    <p style="opacity:.65;line-height:1.5;margin:0">3D-анимация временно недоступна. Обновите страницу позже или пересоздайте сайт.</p>
  </div>
</section>`;
}

/** Full baked site: canvas scrub hero + overlays + bento + kinetic + CTA. */
export function buildAnimational3dHtml(frames: string[], brief: AnimationalBrief): string {
  const cid = "a3d" + Math.random().toString(36).slice(2, 8);
  const t = themeTokens(brief.aesthetic);
  const framesJson = JSON.stringify(frames).replace(/</g, "\\u003c");
  const brand = esc(brief.brand);
  const tagline = esc(brief.tagline);
  const cta = esc(brief.cta);
  const kinetic = esc(brief.kinetic);
  const beats = brief.beats.map((b, i) => ({
    title: esc(b.title),
    sub: esc(b.sub),
    at: i === 0 ? 0.08 : i === 1 ? 0.48 : 0.82,
  }));
  const feats = brief.features
    .map(
      (f, i) => `<article class="${cid}-bento__card" data-i="${i}">
  <h3>${esc(f.title)}</h3>
  <p>${esc(f.sub)}</p>
</article>`,
    )
    .join("\n");

  const fontLink =
    brief.aesthetic === "eco"
      ? "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Manrope:wght@400;500;600;700&display=swap"
      : "https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Manrope:wght@400;500;600;700&display=swap";

  const beatHtml = beats
    .map(
      (b, i) => `<div class="${cid}-beat" data-beat="${i}" style="opacity:0">
  <h2>${b.title}</h2>
  <p>${b.sub}</p>
</div>`,
    )
    .join("\n");

  return `
<!--craft-scrollanim-full-->
<section id="${cid}-root" class="${cid}-root" data-craft-scrollanim="1" data-layout="animational" data-animational="1" data-ani-style="3d"
  data-frames='${framesJson}'
  style="--bg:${t.bg};--ink:${t.ink};--muted:${t.muted};--accent:${t.accent};--card:${t.card};--font-d:'${t.fontDisplay}',serif;--font-b:'${t.fontBody}',system-ui,sans-serif">
  <div class="${cid}-loader" id="${cid}-loader" aria-live="polite">
    <div class="${cid}-loader__inner">
      <div class="${cid}-loader__brand">${brand}</div>
      <div class="${cid}-loader__bar"><i id="${cid}-bar"></i></div>
      <div class="${cid}-loader__pct" id="${cid}-pct">0%</div>
    </div>
  </div>

  <section class="${cid}-hero" id="${cid}-hero">
    <div class="${cid}-sticky">
      <canvas class="${cid}-canvas" id="${cid}-canvas" aria-hidden="true"></canvas>
      <div class="${cid}-veil"></div>
      <div class="${cid}-overlays">
        <p class="${cid}-brand">${brand}</p>
${beatHtml}
        <div class="${cid}-hint"><span>скролл</span></div>
      </div>
    </div>
  </section>

  <section class="${cid}-bento" id="${cid}-bento">
    <p class="${cid}-eyebrow">${brand}</p>
    <h2 class="${cid}-section-h">${tagline}</h2>
    <div class="${cid}-bento__grid">
${feats}
    </div>
  </section>

  <section class="${cid}-kinetic" id="${cid}-kinetic" aria-label="Kinetic">
    <div class="${cid}-kinetic__track"><span>${kinetic}</span><span aria-hidden="true">${kinetic}</span></div>
  </section>

  <footer class="${cid}-cta" id="${cid}-cta">
    <h2>${tagline}</h2>
    <a class="${cid}-btn" href="#${cid}-cta">${cta}</a>
    <p>${brand}</p>
  </footer>
</section>
<style>
@import url('${fontLink}');
.${cid}-root{background:var(--bg);color:var(--ink);font-family:var(--font-b);overflow-x:clip;position:relative}
.${cid}-root *{box-sizing:border-box}
.${cid}-loader{position:fixed;inset:0;z-index:100;background:var(--bg);display:grid;place-items:center;transition:opacity .65s,visibility .65s}
.${cid}-loader.is-done{opacity:0;visibility:hidden;pointer-events:none}
.${cid}-loader__inner{width:min(280px,70vw);text-align:center}
.${cid}-loader__brand{font-family:var(--font-d);font-weight:700;font-size:1.1rem;letter-spacing:-.02em;margin-bottom:1.2rem}
.${cid}-loader__bar{height:2px;background:color-mix(in srgb,var(--ink) 12%,transparent);border-radius:99px;overflow:hidden}
.${cid}-loader__bar i{display:block;height:100%;width:0%;background:var(--accent)}
.${cid}-loader__pct{margin-top:.7rem;font-size:.72rem;letter-spacing:.16em;opacity:.5}
.${cid}-hero{position:relative;height:350vh;margin:0}
.${cid}-sticky{position:sticky;top:0;height:100vh;width:100%;overflow:hidden;background:var(--bg)}
.${cid}-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.${cid}-veil{position:absolute;inset:0;pointer-events:none;background:
  radial-gradient(ellipse 70% 55% at 50% 45%,transparent 0%,rgba(0,0,0,.18) 62%,rgba(0,0,0,.55) 100%)}
.${cid}-overlays{position:absolute;inset:0;z-index:2;pointer-events:none;display:grid;place-items:center;padding:clamp(72px,10vh,120px) clamp(16px,5vw,48px)}
.${cid}-brand{position:absolute;top:clamp(72px,10vh,110px);left:50%;transform:translateX(-50%);margin:0;font-size:.68rem;letter-spacing:.28em;text-transform:uppercase;opacity:.55;color:#fff;text-shadow:0 2px 16px rgba(0,0,0,.45)}
.${cid}-beat{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(640px,92vw);text-align:center;color:#fff;
  padding:1.1rem 1.25rem;border-radius:18px;
  background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.12);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  box-shadow:0 18px 50px rgba(0,0,0,.28)}
.${cid}-beat h2{margin:0;font-family:var(--font-d);font-weight:700;font-size:clamp(1.6rem,4.5vw,3.1rem);letter-spacing:-.035em;line-height:1.05;text-shadow:0 8px 40px rgba(0,0,0,.45)}
.${cid}-beat p{margin:.65rem auto 0;max-width:36ch;font-size:clamp(.92rem,1.5vw,1.1rem);line-height:1.5;opacity:.9}
.${cid}-hint{position:absolute;bottom:clamp(28px,5vh,48px);left:50%;transform:translateX(-50%);font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.5);transition:opacity .35s}
.${cid}-bento{padding:clamp(64px,12vh,140px) clamp(16px,5vw,64px);max-width:1120px;margin:0 auto}
.${cid}-eyebrow{margin:0 0 .75rem;font-size:.68rem;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
.${cid}-section-h{margin:0 0 2rem;font-family:var(--font-d);font-weight:700;font-size:clamp(1.8rem,4vw,3rem);letter-spacing:-.03em;line-height:1.05;max-width:16ch}
.${cid}-bento__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
@media(min-width:900px){.${cid}-bento__grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:1.1rem}
.${cid}-bento__card:first-child{grid-column:span 2}}
.${cid}-bento__card{background:var(--card);border:1px solid color-mix(in srgb,var(--ink) 12%,transparent);border-radius:22px;padding:1.25rem 1.3rem;min-height:140px;
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  transition:transform .45s cubic-bezier(.22,1,.36,1),border-color .35s,box-shadow .45s}
.${cid}-bento__card:hover{transform:translateY(-4px) rotateX(2deg);border-color:color-mix(in srgb,var(--accent) 45%,transparent);box-shadow:0 18px 40px rgba(0,0,0,.18)}
.${cid}-bento__card h3{margin:0 0 .45rem;font-family:var(--font-d);font-size:1.15rem;letter-spacing:-.02em}
.${cid}-bento__card p{margin:0;font-size:.9rem;line-height:1.5;color:var(--muted)}
.${cid}-kinetic{overflow:hidden;border-block:1px solid color-mix(in srgb,var(--ink) 10%,transparent);padding:1.4rem 0;background:color-mix(in srgb,var(--ink) 3%,var(--bg))}
.${cid}-kinetic__track{display:flex;width:max-content;gap:3rem;will-change:transform}
.${cid}-kinetic__track span{font-family:var(--font-d);font-weight:800;font-size:clamp(2.2rem,8vw,5.5rem);letter-spacing:-.04em;text-transform:uppercase;white-space:nowrap;padding-inline:0.5rem}
.${cid}-cta{padding:clamp(72px,14vh,160px) clamp(16px,5vw,64px);text-align:center}
.${cid}-cta h2{margin:0 0 1.4rem;font-family:var(--font-d);font-weight:700;font-size:clamp(1.8rem,4.5vw,3.2rem);letter-spacing:-.03em}
.${cid}-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 1.6rem;border-radius:999px;background:var(--accent);color:${brief.aesthetic === "eco" ? "#fff" : "#0a0a0a"};font-weight:700;text-decoration:none;font-size:.92rem;letter-spacing:-.01em;transition:transform .3s,filter .3s}
.${cid}-btn:hover{transform:translateY(-2px);filter:brightness(1.05)}
.${cid}-cta p{margin:1.4rem 0 0;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
@media(max-width:700px){
  .${cid}-bento__grid{grid-template-columns:1fr}
  .${cid}-beat{padding:.95rem 1rem}
}
@media(prefers-reduced-motion:reduce){
  .${cid}-bento__card{transition:none}
}
</style>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/lenis@1.1.18/dist/lenis.min.js"></script>
<script>
(function(){
  if(window.__craftAni3d_${cid}) return; window.__craftAni3d_${cid}=true;
  var root=document.getElementById('${cid}-root');
  if(!root) return;
  var frames=[];
  try{ frames=JSON.parse(root.getAttribute('data-frames')||'[]'); }catch(e){ frames=[]; }
  if(!frames.length) return;

  var canvas=document.getElementById('${cid}-canvas');
  var ctx=canvas.getContext('2d',{ alpha:false });
  var loader=document.getElementById('${cid}-loader');
  var bar=document.getElementById('${cid}-bar');
  var pctEl=document.getElementById('${cid}-pct');
  var hint=root.querySelector('.${cid}-hint');
  var beats=[].slice.call(root.querySelectorAll('.${cid}-beat'));
  var images=new Array(frames.length);
  var loaded=0;
  var playhead={ frame:0 };
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fitAndDraw(img){
    if(!img||!img.complete) return;
    var dpr=Math.min(window.devicePixelRatio||1, 2);
    var w=canvas.clientWidth, h=canvas.clientHeight;
    if(canvas.width!==Math.floor(w*dpr) || canvas.height!==Math.floor(h*dpr)){
      canvas.width=Math.floor(w*dpr); canvas.height=Math.floor(h*dpr);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle=getComputedStyle(root).getPropertyValue('--bg').trim()||'#0a0a0a';
    ctx.fillRect(0,0,w,h);
    // contain
    var s=Math.min(w/img.naturalWidth, h/img.naturalHeight);
    var dw=img.naturalWidth*s, dh=img.naturalHeight*s;
    var dx=(w-dw)/2, dy=(h-dh)/2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function render(){
    var i=Math.max(0, Math.min(frames.length-1, Math.round(playhead.frame)));
    var img=images[i];
    if(img) fitAndDraw(img);
  }

  function onProgress(p){
    if(hint) hint.style.opacity = p < 0.06 ? '1' : '0';
    // beat windows
    var windows=[[0.02,0.28],[0.38,0.62],[0.72,0.98]];
    beats.forEach(function(el, idx){
      var w=windows[idx]||windows[0];
      var on = p>=w[0] && p<=w[1];
      el.style.opacity = on ? '1' : '0';
      el.style.transform = on ? 'translate(-50%,-50%) scale(1)' : 'translate(-50%,-46%) scale(0.96)';
      el.style.transition = 'opacity .35s ease, transform .45s cubic-bezier(.22,1,.36,1)';
    });
  }

  function bootMotion(){
    if(typeof gsap==='undefined' || typeof ScrollTrigger==='undefined'){
      // fallback: map window scroll without GSAP
      var hero=document.getElementById('${cid}-hero');
      function fb(){
        var r=hero.getBoundingClientRect();
        var total=Math.max(1, hero.offsetHeight - window.innerHeight);
        var p=Math.max(0, Math.min(1, -r.top / total));
        playhead.frame = p * (frames.length - 1);
        render(); onProgress(p);
      }
      window.addEventListener('scroll', function(){ requestAnimationFrame(fb); }, {passive:true});
      window.addEventListener('resize', function(){ render(); });
      fb();
      return;
    }
    gsap.registerPlugin(ScrollTrigger);
    var lenis = null;
    if(!reduce && typeof Lenis!=='undefined'){
      lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(function(time){ lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
    }
    var ctx = gsap.context(function(){
      gsap.to(playhead, {
        frame: frames.length - 1,
        ease: 'none',
        snap: 'frame',
        scrollTrigger: {
          trigger: '#${cid}-hero',
          start: 'top top',
          end: 'bottom bottom',
          scrub: reduce ? true : 1,
          onUpdate: function(self){ render(); onProgress(self.progress); }
        },
        onUpdate: render
      });
      gsap.to('.${cid}-kinetic__track', {
        xPercent: -50,
        ease: 'none',
        scrollTrigger: {
          trigger: '#${cid}-kinetic',
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1
        }
      });
      gsap.utils.toArray('.${cid}-bento__card').forEach(function(card, i){
        gsap.from(card, {
          y: 36, opacity: 0, duration: 0.7, delay: i * 0.06,
          ease: 'power3.out',
          scrollTrigger: { trigger: card, start: 'top 88%' }
        });
      });
    }, root);

    window.addEventListener('resize', function(){ render(); ScrollTrigger.refresh(); });
    window.addEventListener('beforeunload', function(){ try{ ctx.revert(); }catch(e){} if(lenis) try{ lenis.destroy(); }catch(e){} });
    render(); onProgress(0);
  }

  // preload
  frames.forEach(function(url, idx){
    var img=new Image();
    img.decoding='async';
    img.onload=img.onerror=function(){
      loaded++;
      var p=Math.round((loaded/frames.length)*100);
      if(bar) bar.style.width=p+'%';
      if(pctEl) pctEl.textContent=p+'%';
      if(idx===0 && img.naturalWidth){ images[0]=img; fitAndDraw(img); }
      if(loaded>=frames.length){
        // ensure slots filled even on error (reuse nearest)
        for(var i=0;i<frames.length;i++){
          if(!images[i]) images[i]=images[i-1]||images[0]||img;
        }
        try{ window.dispatchEvent(new Event('craft:frames-ready')); }catch(e){}
        setTimeout(function(){ if(loader) loader.classList.add('is-done'); }, 280);
        bootMotion();
      }
    };
    img.src=url;
    images[idx]=img;
  });
})();
</script>
<!--/craft-scrollanim-full-->
`;
}

export async function generateAnimationalSite(opts: {
  markerInner: string;
  deps: GenerateAnimationalDeps;
}): Promise<{ html: string; frameCount: number } | null> {
  const { markerInner, deps } = opts;
  const brief = parseAnimationalMarker(markerInner);
  deps.onStatus?.("Анимационный · 3D: рендерим Kling для canvas-scrub…");

  const outcome = await deps.generateFrames(
    brief.videoPrompt,
    deps.shouldStop,
    deps.productImageUrl,
  );
  if (!outcome.frames.length || outcome.frames.length < 30) {
    console.warn("[ANI3D] not enough frames:", outcome.frames.length);
    return null;
  }
  deps.onStatus?.(`Анимационный · 3D: собираем GSAP scrub (${outcome.frames.length} кадров)…`);
  const html = buildAnimational3dHtml(outcome.frames, brief);
  return { html, frameCount: outcome.frames.length };
}
