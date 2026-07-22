import { type Express } from "express";
import type { IStorage } from "./storage";
import { deployToYandex } from "./yandex-deploy";
import { isInternalAgentFile } from "@shared/project-files";
import type { SeoConfig, SeoCluster, SeoKeyword, SeoTheme } from "@shared/schema";
import crypto from "crypto";

const KIE_API_KEY = process.env.KIE_API_KEY || "";
const KIE_GEMINI_MODEL = "gemini-3-5-flash";
const KIE_GEMINI_URL = `https://api.kie.ai/gemini/v1/models/${KIE_GEMINI_MODEL}:generateContent`;
// GPT Image-2 job endpoints (same shape used in server/routes.ts for {{GENIMG}})
const KIE_JOBS_CREATE = "https://api.kie.ai/api/v1/jobs/createTask";
const KIE_JOBS_STATUS = "https://api.kie.ai/api/v1/jobs/recordInfo";

const SEO_ARTICLE_COST = 70;
const DAILY_PUBLISH_COST = 35;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[а-яёА-ЯЁ]/g, (c) => {
      const map: Record<string, string> = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
      return map[c.toLowerCase()] || c;
    })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "page";
}

// Uses KIE Gemini flash via the non-streaming generateContent endpoint.
// Non-streaming avoids stream-accumulation overhead and returns a single JSON
// response — much faster for large keyword clusters and long articles.
async function kieSync(messages: { role: string; content: string }[], timeout = 90000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const contents: any[] = [];
    let systemPrompt = "";
    for (const m of messages) {
      if (m.role === "system" || m.role === "developer") {
        systemPrompt += (systemPrompt ? "\n\n" : "") + m.content;
        continue;
      }
      contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
    }
    const body: any = { contents };
    if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };

    const resp = await fetch(KIE_GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_API_KEY}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`KIE Gemini ${resp.status}${errText ? `: ${errText.slice(0, 300)}` : ""}`);
    }

    const data = await resp.json() as any;
    let text = "";
    for (const part of data?.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) text += part.text as string;
    }
    if (!text) throw new Error("Empty KIE response");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// One article cover via GPT Image-2 (text-to-image) at 1K, 16:9. Returns the raw
// KIE CDN URL on success, or null on any failure (caller renders a gradient cover).
async function generateImage(prompt: string, timeout = 120000): Promise<string | null> {
  if (!KIE_API_KEY) return null;
  try {
    const createRes = await fetch(KIE_JOBS_CREATE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-image-2-text-to-image",
        input: { prompt, aspect_ratio: "16:9", resolution: "1K" },
      }),
    });
    const createData = await createRes.json() as any;
    if (createData?.code !== 200 || !createData?.data?.taskId) return null;
    const taskId = createData.data.taskId;

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5000));
      const pollRes = await fetch(`${KIE_JOBS_STATUS}?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
      });
      const pollData = await pollRes.json() as any;
      if (pollData?.code !== 200) continue;
      const state = pollData.data?.state;
      if (state === "success") {
        let result: any = {};
        try { result = typeof pollData.data.resultJson === "string" ? JSON.parse(pollData.data.resultJson) : (pollData.data.resultJson || {}); } catch {}
        return (result.resultUrls || [])[0] || null;
      }
      if (state === "fail" || state === "failed" || state === "error") return null;
    }
    return null;
  } catch {
    return null;
  }
}

// Escape a user/AI-supplied string for safe interpolation into HTML text and
// attribute contexts (projectName is user-controlled).
function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Validate + escape a user-supplied link for use in an href attribute. Only
// absolute http(s) URLs with no attribute-breaking chars are allowed; anything
// else (javascript:, data:, relative, malformed) returns "" so no link renders.
function safeHref(url: string | undefined): string {
  const u = String(url ?? "").trim();
  if (!/^https?:\/\/[^\s'"<>`]+$/i.test(u)) return "";
  return esc(u);
}

// ── Visual themes ─────────────────────────────────────────────────────────────
// Each site gets ONE theme (deterministically chosen from the project name +
// niche, then stored in seoConfig). HTML structure is identical across themes —
// only palette / fonts / radius vary. All fonts are Cyrillic-capable.
const THEME_PRESETS: SeoTheme[] = [
  { id: "indigo", name: "Tech Indigo", headingFont: "Unbounded", bodyFont: "Manrope", accent: "#4f46e5", accent2: "#7c3aed", text: "#111827", text2: "#4b5563", muted: "#9ca3af", bg: "#ffffff", bg2: "#f9fafb", bg3: "#f3f4f6", border: "#e5e7eb", nav: "#0c0c14", radius: "8px" },
  { id: "editorial", name: "Editorial Serif", headingFont: "Playfair Display", bodyFont: "PT Serif", accent: "#b91c1c", accent2: "#9f1239", text: "#1a1a1a", text2: "#44403c", muted: "#a8a29e", bg: "#fffdf9", bg2: "#faf6ef", bg3: "#f3ede2", border: "#e7e0d3", nav: "#1a1a1a", radius: "2px" },
  { id: "finance", name: "Finance Blue", headingFont: "Montserrat", bodyFont: "Inter", accent: "#0369a1", accent2: "#0891b2", text: "#0f172a", text2: "#475569", muted: "#94a3b8", bg: "#ffffff", bg2: "#f8fafc", bg3: "#f1f5f9", border: "#e2e8f0", nav: "#0f172a", radius: "6px" },
  { id: "wellness", name: "Wellness Green", headingFont: "Unbounded", bodyFont: "Golos Text", accent: "#059669", accent2: "#16a34a", text: "#14201a", text2: "#3f4d45", muted: "#9ca3af", bg: "#ffffff", bg2: "#f4fbf6", bg3: "#eaf6ee", border: "#d7ebdd", nav: "#0c1a14", radius: "14px" },
  { id: "luxury", name: "Luxury Amber", headingFont: "Playfair Display", bodyFont: "Montserrat", accent: "#b45309", accent2: "#d97706", text: "#1c1917", text2: "#44403c", muted: "#a8a29e", bg: "#ffffff", bg2: "#fafaf9", bg3: "#f5f5f4", border: "#e7e5e4", nav: "#0a0a0a", radius: "4px" },
  { id: "vibrant", name: "Vibrant Magenta", headingFont: "Unbounded", bodyFont: "Manrope", accent: "#db2777", accent2: "#7c3aed", text: "#18181b", text2: "#52525b", muted: "#a1a1aa", bg: "#ffffff", bg2: "#fafafa", bg3: "#f4f4f5", border: "#e4e4e7", nav: "#14101c", radius: "12px" },
  { id: "teal", name: "Calm Teal", headingFont: "Montserrat", bodyFont: "Inter", accent: "#0d9488", accent2: "#0891b2", text: "#0f1f1d", text2: "#475569", muted: "#94a3b8", bg: "#ffffff", bg2: "#f5fbfa", bg3: "#ecf6f5", border: "#dcebe9", nav: "#0f2724", radius: "10px" },
  { id: "sunset", name: "Sunset Orange", headingFont: "Rubik", bodyFont: "Golos Text", accent: "#ea580c", accent2: "#db2777", text: "#1c1410", text2: "#57534e", muted: "#a8a29e", bg: "#ffffff", bg2: "#fdf8f5", bg3: "#f9efe9", border: "#eee0d6", nav: "#1c1410", radius: "16px" },
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}

// Deterministic per-project theme: same name+niche always yields the same theme,
// different projects spread across the presets.
function selectTheme(name: string, niche: string): SeoTheme {
  const idx = hashStr(`${name}|${niche}`) % THEME_PRESETS.length;
  return THEME_PRESETS[idx];
}

// Theme to use for a config — stored theme if present, else a deterministic pick
// (keeps sites created before theming was added working).
function themeOf(cfg: SeoConfig): SeoTheme {
  return cfg.theme || selectTheme(cfg.projectName || cfg.siteTitle || "", cfg.niche || "");
}

// Google Fonts @import for the theme's heading + body fonts (MUST be the first
// rule in the stylesheet).
function fontsImport(t: SeoTheme): string {
  const fam = (name: string, w: string) => `family=${name.replace(/ /g, "+")}:wght@${w}`;
  if (t.headingFont === t.bodyFont) {
    return `@import url('https://fonts.googleapis.com/css2?${fam(t.headingFont, "400;500;600;700;800;900")}&display=swap');`;
  }
  return `@import url('https://fonts.googleapis.com/css2?${fam(t.headingFont, "400;600;700;800;900")}&${fam(t.bodyFont, "400;500;600;700")}&display=swap');`;
}

// Inline SVG logo mark (gradient rounded square + project initial). idSuffix keeps
// the gradient id unique when the mark appears twice on one page (nav + footer).
function logoMark(t: SeoTheme, name: string, idSuffix: string): string {
  const first = esc((name.trim()[0] || "S").toUpperCase());
  const gid = `lgm-${idSuffix}`;
  return `<svg class="logo-mark" width="30" height="30" viewBox="0 0 36 36" aria-hidden="true" focusable="false"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.accent}"/><stop offset="1" stop-color="${t.accent2}"/></linearGradient></defs><rect width="36" height="36" rx="8" fill="url(#${gid})"/><text x="18" y="24.5" text-anchor="middle" font-family="${esc(t.headingFont)},sans-serif" font-size="19" font-weight="800" fill="#ffffff">${first}</text></svg>`;
}

function buildSiteCss(t: SeoTheme): string {
  return `${fontsImport(t)}
/* Craft AI SEO Magazine — theme: ${t.id} */
:root{--brand:${t.accent};--brand-light:${t.accent2};--text:${t.text};--text2:${t.text2};--muted:${t.muted};--bg:${t.bg};--bg2:${t.bg2};--bg3:${t.bg3};--border:${t.border};--nav:${t.nav};--heading-font:'${t.headingFont}';--body-font:'${t.bodyFont}';--shadow:0 1px 8px rgba(0,0,0,.08);--shadow-lg:0 4px 24px rgba(0,0,0,.14);--r:${t.radius};--w:1200px;--nh:58px}
*{margin:0;padding:0;box-sizing:border-box}html{scroll-behavior:smooth}
body{font-family:var(--body-font),-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.7}
.nav-logo .logo-text,.hero-title,.section-title,.ac-title,.cat-card h2,.cat-header h1,.article-header h1,.article-body h2,.article-body h3,.footer-logo .logo-text,.faq-section>h2,.related-articles>h2,.cta-hero-text h2,.cta-block .cta-text strong,.key-takeaways h3,.pull-quote,.stat-card .stat-num{font-family:var(--heading-font),-apple-system,BlinkMacSystemFont,system-ui,sans-serif}
a{color:inherit;text-decoration:none}img{max-width:100%;height:auto;display:block}
nav{background:var(--nav);height:var(--nh);position:sticky;top:0;z-index:100;box-shadow:0 2px 20px rgba(0,0,0,.4)}
.nav-inner{max-width:var(--w);margin:0 auto;padding:0 1.5rem;display:flex;align-items:center;gap:1rem;height:100%}
.nav-logo{display:flex;align-items:center;gap:.5rem;color:#fff;flex-shrink:0}
.nav-logo .logo-mark{flex-shrink:0;display:block}
.nav-logo .logo-text{font-weight:900;font-size:1.1rem;color:#fff;letter-spacing:-.03em}
.nav-links{display:flex;gap:.2rem;margin-left:auto;flex-wrap:wrap}
.nav-links a{font-size:.8rem;color:rgba(255,255,255,.65);font-weight:500;padding:.35rem .65rem;border-radius:6px;transition:.15s;white-space:nowrap}
.nav-links a:hover{color:#fff;background:rgba(255,255,255,.1)}
.container{max-width:var(--w);margin:0 auto;padding:0 1.5rem}
.breadcrumb{padding:.75rem 0;font-size:.75rem;color:var(--muted);display:flex;gap:.35rem;align-items:center;flex-wrap:wrap}
.breadcrumb a{color:var(--muted)}.breadcrumb a:hover{color:var(--brand)}.breadcrumb .sep{opacity:.4}.breadcrumb .cur{color:var(--text2);font-weight:500}
.cat-chip{display:inline-block;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:.18rem .5rem;border-radius:3px;color:#fff;background:var(--brand);line-height:1.5}
/* ── HERO ── */
.hero-wrap{padding:1.25rem 0 0}
.hero-grid{display:grid;grid-template-columns:2fr 1fr;gap:3px;background:var(--border);border-radius:var(--r);overflow:hidden}
.hero-main{position:relative;height:400px;display:block;overflow:hidden}
.hero-main-bg{width:100%;height:100%;object-fit:cover}
.hero-grad{width:100%;height:100%}
.hero-side{display:flex;flex-direction:column;gap:3px}
.hero-side-item{position:relative;flex:1;overflow:hidden;display:block;min-height:0}
.hero-side-item .hero-grad{transition:.25s}
.hero-side-item:hover .hero-grad{transform:scale(1.06)}
.hero-overlay{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.88) 0%,rgba(0,0,0,.2) 55%,transparent 100%)}
.hero-content{position:absolute;bottom:0;left:0;right:0;padding:1.1rem}
.hero-title{font-size:1.4rem;font-weight:800;color:#fff;line-height:1.25;margin-top:.35rem;letter-spacing:-.025em}
.hero-side-item .hero-title{font-size:.875rem;font-weight:700;line-height:1.3}
/* ── HOT STRIP ── */
.hot-strip{background:var(--bg2);border-bottom:1px solid var(--border);padding:.7rem 0;margin-top:1.25rem}
.hot-inner{display:flex;align-items:center;gap:.875rem;overflow-x:auto;scrollbar-width:none}
.hot-inner::-webkit-scrollbar{display:none}
.hot-label{font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--brand);white-space:nowrap;flex-shrink:0}
.hot-chip{white-space:nowrap;font-size:.76rem;padding:.22rem .62rem;border-radius:20px;border:1px solid var(--border);color:var(--text2);font-weight:500;flex-shrink:0;transition:.15s;display:block}
.hot-chip:hover{border-color:var(--brand);color:var(--brand);background:color-mix(in srgb,var(--brand) 9%,#fff)}
/* ── AD SLOTS ── */
.ad-slot{background:var(--bg2);border:1px dashed #d1d5db;border-radius:var(--r);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;min-height:90px}
.ad-slot::before{content:'Реклама';position:absolute;top:4px;right:6px;font-size:.6rem;color:var(--muted);letter-spacing:.05em;text-transform:uppercase}
.ad-728{width:100%;max-width:728px;height:90px;margin:1.25rem auto}
.ad-300{width:100%;min-height:250px}
.ad-resp{width:100%;min-height:100px;margin:1.5rem 0}
/* ── SECTION HEADERS ── */
.section-header{display:flex;align-items:baseline;gap:1rem;margin:2rem 0 1.25rem;padding-bottom:.5rem;border-bottom:2px solid var(--brand)}
.section-title{font-size:1.05rem;font-weight:800;letter-spacing:-.02em}
.section-more{font-size:.75rem;color:var(--brand);font-weight:600;margin-left:auto}
.section-more:hover{text-decoration:underline}
/* ── ARTICLE CARDS ── */
.articles-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.1rem;margin-bottom:2.5rem}
.article-card{display:block;border-radius:var(--r);overflow:hidden;border:1px solid var(--border);transition:.2s;background:#fff;color:var(--text)}
.article-card:hover{box-shadow:var(--shadow-lg);transform:translateY(-2px)}
.ac-img-wrap{height:175px;overflow:hidden;position:relative}
.ac-img-wrap img{width:100%;height:100%;object-fit:cover;transition:.25s}
.article-card:hover .ac-img-wrap img{transform:scale(1.05)}
.ac-img-grad{width:100%;height:100%}
.ac-body{padding:.875rem 1rem 1rem}
.ac-cat{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--brand);margin-bottom:.3rem;display:block}
.ac-title{font-size:.925rem;font-weight:700;line-height:1.4;color:var(--text);margin-bottom:.35rem}
.article-card:hover .ac-title{color:var(--brand)}
.ac-meta{font-size:.7rem;color:var(--muted)}
/* ── CATEGORY CARDS ── */
.cats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:1rem;margin-bottom:3rem}
.cat-card{border:1px solid var(--border);border-radius:var(--r);padding:1.4rem;display:block;color:var(--text);transition:.2s;background:#fff}
.cat-card:hover{border-color:var(--brand-light);box-shadow:var(--shadow);transform:translateY(-2px)}
.cat-card .cc-icon{font-size:1.4rem;margin-bottom:.5rem}
.cat-card h2{font-size:.975rem;font-weight:700;margin-bottom:.35rem}
.cat-card p{font-size:.8rem;color:var(--text2);line-height:1.5}
.cat-card .cc-count{margin-top:.5rem;font-size:.72rem;color:var(--brand);font-weight:600}
/* ── CATEGORY PAGE HEADER ── */
.cat-header{padding:2.25rem 0;margin-bottom:1.75rem;background:linear-gradient(135deg,var(--brand),var(--brand-light))}
.cat-header .container{color:#fff}
.cat-header h1{font-size:clamp(1.5rem,3.5vw,2.1rem);font-weight:900;letter-spacing:-.04em;margin-bottom:.4rem}
.cat-header p{opacity:.85;font-size:.95rem;max-width:540px}
.cat-header .breadcrumb{padding:.25rem 0 1rem}.cat-header .breadcrumb a,.cat-header .breadcrumb .sep{color:rgba(255,255,255,.5)}.cat-header .breadcrumb .cur{color:rgba(255,255,255,.85)}
/* ── ARTICLE PAGE ── */
.article-page{max-width:var(--w);margin:0 auto;padding:0 1.5rem 4rem}
.article-layout{display:grid;grid-template-columns:1fr 295px;gap:2.25rem;align-items:start;margin-top:1.25rem}
.article-main{min-width:0}
.article-header h1{font-size:clamp(1.55rem,3.5vw,2.1rem);font-weight:900;letter-spacing:-.04em;line-height:1.2;margin-bottom:.875rem}
.article-meta{font-size:.76rem;color:var(--muted);display:flex;gap:.875rem;align-items:center;flex-wrap:wrap;margin-bottom:1.5rem}
.article-meta .tag{background:var(--brand);color:#fff;border-radius:3px;padding:.18rem .5rem;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.hero-article-img{width:100%;border-radius:var(--r);margin-bottom:1.75rem;max-height:420px;object-fit:cover}
.hero-cover-fallback{width:100%;height:340px;border-radius:var(--r);margin-bottom:1.75rem;position:relative;overflow:hidden;background-size:cover;background-position:center}
.hero-cover-fallback::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 78% 22%,rgba(255,255,255,.28),transparent 42%),linear-gradient(120deg,rgba(255,255,255,.06),rgba(0,0,0,.18))}
.article-body{font-size:1.025rem;line-height:1.85}
.article-body h2{position:relative;font-size:1.25rem;font-weight:800;letter-spacing:-.025em;margin:2.25rem 0 .875rem;padding-top:.4rem;border-top:1px solid var(--border);line-height:1.25}
.article-body h2::after{content:'';display:block;width:48px;height:3px;margin-top:.5rem;border-radius:2px;background:linear-gradient(90deg,var(--brand),var(--brand-light));animation:h2bar 1s ease both}
.article-body h3{font-size:1.025rem;font-weight:700;margin:1.75rem 0 .6rem}
.article-body p{margin-bottom:1.2rem;color:var(--text2)}
.article-body .lead{font-size:1.16rem;line-height:1.7;color:var(--text);font-weight:500}
.article-body .lead::first-letter{float:left;font-family:var(--heading-font);font-size:3.3rem;line-height:.78;font-weight:800;color:var(--brand);margin:.12rem .6rem 0 0}
.article-body ul,.article-body ol{margin:1rem 0 1.4rem 1.5rem;color:var(--text2)}
.article-body li{margin-bottom:.4rem}
.article-body strong{color:var(--text);font-weight:600}
.article-body blockquote{border-left:4px solid var(--brand);padding:.875rem 1.4rem;background:var(--bg2);border-radius:0 8px 8px 0;margin:1.75rem 0;font-style:italic;color:var(--text2)}
.article-img{width:100%;border-radius:var(--r);margin:1.75rem 0;max-height:400px;object-fit:cover;box-shadow:var(--shadow)}
.reading-time{font-size:.7rem;color:var(--muted)}
/* ── PREMIUM MAGAZINE ELEMENTS ── */
.article-flourish{display:flex;justify-content:center;margin:1.4rem 0 2rem}
.article-flourish svg{width:min(260px,62%);height:auto;overflow:visible}
.af-line{fill:none;stroke:var(--brand);stroke-width:2;stroke-linecap:round;stroke-dasharray:240;stroke-dashoffset:240;animation:af-draw 1.8s ease forwards}
.af-dot{fill:var(--brand-light);animation:af-move 3.4s ease-in-out infinite}
.pull-quote{position:relative;font-size:1.35rem;line-height:1.5;font-weight:700;color:var(--text);margin:2rem 0;padding:.4rem 0 .4rem 1.6rem;border-left:4px solid var(--brand);font-style:normal}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin:1.75rem 0}
.stat-card{background:color-mix(in srgb,var(--brand) 6%,#fff);border:1px solid color-mix(in srgb,var(--brand) 18%,#fff);border-radius:var(--r);padding:1.1rem 1rem;text-align:center;animation:sa-rise .6s ease both}
.stat-card .stat-num{font-size:1.9rem;font-weight:900;color:var(--brand);line-height:1;letter-spacing:-.02em}
.stat-card .stat-label{font-size:.76rem;color:var(--text2);margin-top:.4rem;line-height:1.4}
.callout{display:flex;gap:.9rem;align-items:flex-start;background:color-mix(in srgb,var(--brand) 6%,#fff);border:1px solid color-mix(in srgb,var(--brand) 20%,#fff);border-left:4px solid var(--brand);border-radius:var(--r);padding:1rem 1.2rem;margin:1.5rem 0}
.callout .callout-ico{font-size:1.3rem;flex-shrink:0;line-height:1.4}
.callout .callout-body{font-size:.92rem;color:var(--text2);line-height:1.6}
.callout .callout-body strong{color:var(--text)}
@keyframes af-draw{to{stroke-dashoffset:0}}
@keyframes af-move{0%,100%{transform:translateX(0)}50%{transform:translateX(150px)}}
@keyframes h2bar{from{width:0;opacity:0}to{width:48px;opacity:1}}
@keyframes sa-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
/* ── SIDEBAR ── */
.sidebar{position:sticky;top:calc(var(--nh) + 1rem)}
.sb-block{margin-bottom:1.5rem;border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.sb-head{background:var(--nav);color:rgba(255,255,255,.85);padding:.55rem .9rem;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.09em}
.sb-body{padding:.75rem .9rem}
.sb-list{list-style:none}
.sb-list li{padding:.45rem 0;border-bottom:1px solid var(--border);font-size:.8rem;line-height:1.4}
.sb-list li:last-child{border-bottom:none}
.sb-list a{color:var(--text2);font-weight:500;display:block}.sb-list a:hover{color:var(--brand)}
.sb-num{font-size:.64rem;font-weight:700;color:var(--brand);margin-bottom:.1rem}
/* ── FAQ ── */
.faq-section{margin-top:2.5rem;padding-top:1.75rem;border-top:2px solid var(--brand)}
.faq-section>h2{font-size:1.1rem;font-weight:800;margin-bottom:1.1rem}
.faq-item{border:1px solid var(--border);border-radius:var(--r);margin-bottom:.45rem;overflow:hidden}
.faq-question{padding:.75rem 1rem;font-weight:600;font-size:.875rem;cursor:pointer;display:flex;justify-content:space-between;align-items:center;color:var(--text);user-select:none}
.faq-question:hover{background:var(--bg2)}.faq-answer{padding:.75rem 1rem;color:var(--text2);line-height:1.7;border-top:1px solid var(--border);font-size:.85rem;display:none}
/* ── RELATED ── */
.related-articles{margin-top:2.5rem;padding-top:1.75rem;border-top:1px solid var(--border)}
.related-articles>h2{font-size:.95rem;font-weight:800;margin-bottom:.875rem}
.related-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.75rem}
.related-card{border:1px solid var(--border);border-radius:var(--r);padding:.75rem;transition:.2s;color:var(--text);display:block;background:#fff}
.related-card:hover{border-color:var(--brand);box-shadow:var(--shadow)}
.related-card .rc-cat{font-size:.6rem;color:var(--brand);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.2rem}
.related-card .rc-title{font-size:.78rem;font-weight:600;line-height:1.35;color:var(--text2)}
.related-card:hover .rc-title{color:var(--brand)}
/* ── FOOTER ── */
footer{background:var(--nav);color:rgba(255,255,255,.65);padding:2.5rem 1.5rem;margin-top:4rem}
.footer-inner{max-width:var(--w);margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr;gap:2rem}
.footer-logo{display:flex;align-items:center;gap:.5rem;margin-bottom:.55rem}
.footer-logo .logo-text{font-weight:900;font-size:.975rem;color:#fff;letter-spacing:-.02em}
.footer-desc{font-size:.76rem;opacity:.5;line-height:1.6}
.footer-col h4{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.35);margin-bottom:.75rem}
.footer-col ul{list-style:none}.footer-col li{margin-bottom:.35rem}
.footer-col a{font-size:.78rem;color:rgba(255,255,255,.5)}.footer-col a:hover{color:#fff}
.footer-bottom{max-width:var(--w);margin:1.5rem auto 0;padding-top:1.1rem;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;font-size:.7rem;color:rgba(255,255,255,.28);flex-wrap:wrap;gap:.4rem}
/* ── SEO CONTENT ELEMENTS ── */
.key-takeaways{background:color-mix(in srgb,var(--brand) 7%,#fff);border-left:4px solid var(--brand);border-radius:0 8px 8px 0;padding:1.1rem 1.4rem;margin:1.5rem 0}
.key-takeaways h3{font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--brand);margin-bottom:.65rem}
.key-takeaways ul{margin:0;padding-left:1.1rem;color:var(--text2)}.key-takeaways li{margin-bottom:.3rem;font-size:.9rem}
.toc{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:1rem 1.25rem;margin:1.5rem 0}
.toc-title{font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:.55rem}
.toc ol{margin:0;padding-left:1.2rem}.toc li{margin-bottom:.28rem}
.toc a{font-size:.83rem;color:var(--text2);font-weight:500}.toc a:hover{color:var(--brand)}
.step-box{display:flex;gap:1rem;margin:1.5rem 0;padding:1.1rem;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r)}
.step-num{width:1.875rem;height:1.875rem;border-radius:50%;background:var(--brand);color:#fff;font-weight:800;font-size:.82rem;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.step-content h3{font-size:.975rem;font-weight:700;margin-bottom:.3rem;color:var(--text)}.step-content p{color:var(--text2);margin:0;font-size:.875rem}
.comparison-table{width:100%;border-collapse:collapse;margin:1.75rem 0;font-size:.84rem;border-radius:var(--r);overflow:hidden;box-shadow:var(--shadow)}
.comparison-table th{background:var(--brand);color:#fff;padding:.65rem .875rem;text-align:left;font-weight:700;font-size:.76rem}
.comparison-table td{padding:.6rem .875rem;border-bottom:1px solid var(--border)}.comparison-table tr:last-child td{border-bottom:none}
.comparison-table tr:nth-child(even) td{background:var(--bg2)}.comparison-table .ct-winner{color:#059669;font-weight:700}
.pros-cons{display:grid;grid-template-columns:1fr 1fr;gap:.875rem;margin:1.5rem 0}
.pros-cons .pros,.pros-cons .cons{padding:1rem 1.1rem;border-radius:var(--r)}
.pros-cons .pros{background:#f0fdf4;border:1px solid #bbf7d0}.pros-cons .cons{background:#fff5f5;border:1px solid #fecaca}
.pros-cons h4{font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.55rem}
.pros-cons .pros h4{color:#059669}.pros-cons .cons h4{color:#dc2626}
.pros-cons ul{margin:0;padding-left:1rem;font-size:.84rem;color:var(--text2)}.pros-cons li{margin-bottom:.28rem}
.author-box{display:flex;gap:.875rem;align-items:center;margin:2.25rem 0 1.5rem;padding:1rem;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r)}
.author-avatar{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--brand),var(--brand-light));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.95rem;flex-shrink:0}
.author-info .author-name{font-weight:700;font-size:.84rem;color:var(--text)}
.author-info .author-bio{font-size:.73rem;color:var(--muted);line-height:1.5;margin-top:.1rem}
.verdict-box{background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0 8px 8px 0;padding:1rem 1.4rem;margin:1.5rem 0}
.verdict-box h3{font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#16a34a;margin-bottom:.45rem}
.verdict-box p{color:var(--text2);margin:0;font-size:.9rem}
.highlight-box{background:linear-gradient(135deg,color-mix(in srgb,var(--brand) 8%,#fff),color-mix(in srgb,var(--brand-light) 10%,#fff));border:1px solid color-mix(in srgb,var(--brand) 22%,#fff);border-radius:var(--r);padding:1.1rem 1.4rem;margin:1.5rem 0}
@media(max-width:1024px){.article-layout{grid-template-columns:1fr}.sidebar{position:static}.articles-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:768px){.hero-grid{grid-template-columns:1fr}.hero-side{display:none}.footer-inner{grid-template-columns:1fr 1fr}.articles-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.articles-grid{grid-template-columns:1fr}.footer-inner{grid-template-columns:1fr}.nav-links{display:none}.pros-cons{grid-template-columns:1fr}.step-box{flex-direction:column;gap:.6rem}.comparison-table{font-size:.75rem}}
/* ── CTA BLOCK ── */
.cta-block{background:linear-gradient(135deg,var(--brand) 0%,var(--brand-light) 100%);border-radius:12px;padding:1.4rem 1.75rem;margin:2rem 0;display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;box-shadow:0 4px 24px rgba(0,0,0,.18)}
.cta-block .cta-icon{font-size:2rem;flex-shrink:0}
.cta-block .cta-text{flex:1;min-width:180px}
.cta-block .cta-text strong{display:block;color:#fff;font-size:1rem;font-weight:800;margin-bottom:.2rem}
.cta-block .cta-text span{color:rgba(255,255,255,.78);font-size:.84rem;line-height:1.45}
.cta-btn{display:inline-flex;align-items:center;gap:.4rem;background:#fff;color:var(--brand);font-weight:800;font-size:.875rem;padding:.6rem 1.25rem;border-radius:8px;white-space:nowrap;transition:.18s;text-decoration:none;flex-shrink:0}
.cta-btn:hover{background:color-mix(in srgb,var(--brand) 12%,#fff);transform:translateY(-1px);box-shadow:0 4px 20px rgba(0,0,0,.25)}
.cta-hero{background:linear-gradient(135deg,var(--brand),var(--brand-light));padding:1.75rem;border-radius:12px;margin:1.5rem 0;display:flex;align-items:center;justify-content:space-between;gap:1.5rem;flex-wrap:wrap}
.cta-hero-text h2{color:#fff;font-size:1.2rem;font-weight:800;margin-bottom:.3rem}
.cta-hero-text p{color:rgba(255,255,255,.78);font-size:.875rem}
`;
}

const CARD_GRADS = [
  "linear-gradient(135deg,#4f46e5,#7c3aed)",
  "linear-gradient(135deg,#0891b2,#0e7490)",
  "linear-gradient(135deg,#059669,#16a34a)",
  "linear-gradient(135deg,#dc2626,#b91c1c)",
  "linear-gradient(135deg,#d97706,#b45309)",
  "linear-gradient(135deg,#7c3aed,#4f46e5)",
  "linear-gradient(135deg,#0e7490,#0891b2)",
];

function buildNav(cfg: SeoConfig, rootPath = "/"): string {
  const name = cfg.siteTitle || cfg.projectName || "Site";
  const t = themeOf(cfg);
  const links = cfg.clusters.slice(0, 7).map(c =>
    `<a href="/${c.slug}/">${esc(c.name)}</a>`
  ).join("");
  return `<nav>
  <div class="nav-inner">
    <a href="${rootPath}" class="nav-logo" aria-label="${esc(name)}">${logoMark(t, name, "nav")}<span class="logo-text">${esc(name)}</span></a>
    <div class="nav-links">${links}</div>
  </div>
</nav>`;
}

function buildFooter(cfg: SeoConfig): string {
  const name = cfg.siteTitle || cfg.projectName || "Site";
  const t = themeOf(cfg);
  const catLinks = cfg.clusters.slice(0, 6).map(c =>
    `<li><a href="/${c.slug}/">${esc(c.name)}</a></li>`
  ).join("\n");
  return `<footer>
  <div class="footer-inner">
    <div>
      <div class="footer-logo">${logoMark(t, name, "foot")}<span class="logo-text">${esc(name)}</span></div>
      <p class="footer-desc">${esc(cfg.siteDescription)}</p>
    </div>
    <div class="footer-col">
      <h4>Разделы</h4>
      <ul>${catLinks}</ul>
    </div>
    <div class="footer-col">
      <h4>Навигация</h4>
      <ul>
        <li><a href="/">Главная</a></li>
        <li><a href="/sitemap.xml">Карта сайта</a></li>
      </ul>
    </div>
  </div>
  <div class="footer-bottom">
    <span>© ${new Date().getFullYear()} ${esc(name)}. Все права защищены.</span>
    <span>Создано с Craft AI</span>
  </div>
</footer>`;
}

// Validate an image URL is safe to embed in a CSS url('...') — only http(s)
// absolute URLs or root-relative paths, with no characters that could break out
// of the single-quoted url() and inject CSS. Returns null → caller uses gradient.
function cssUrl(image: string | undefined): string | null {
  if (!image) return null;
  if (!/^(https?:\/\/|\/)[^\s'"()\\<>]+$/i.test(image)) return null;
  return image;
}

function heroBg(image: string | undefined, gradIdx: number): string {
  const url = cssUrl(image);
  if (url) return `<div class="hero-grad" style="background-image:url('${url}');background-size:cover;background-position:center;position:absolute;inset:0"></div>`;
  return `<div class="hero-grad" style="background:${CARD_GRADS[gradIdx % CARD_GRADS.length]};position:absolute;inset:0"></div>`;
}

function cardBg(image: string | undefined, gradIdx: number): string {
  const url = cssUrl(image);
  if (url) return `<div class="ac-img-grad" style="background-image:url('${url}');background-size:cover;background-position:center;width:100%;height:100%"></div>`;
  return `<div class="ac-img-grad" style="background:${CARD_GRADS[gradIdx % CARD_GRADS.length]};width:100%;height:100%"></div>`;
}

function buildHomePage(cfg: SeoConfig): string {
  const nav = buildNav(cfg);
  const footer = buildFooter(cfg);
  const safeUrl = safeHref(cfg.targetUrl);
  const ctaLabelSafe = esc(cfg.ctaLabel || "Попробовать →");

  // Collect all done articles
  const allDone: Array<{ kw: SeoKeyword; cluster: SeoCluster; idx: number }> = [];
  let gi = 0;
  for (const c of cfg.clusters) {
    for (const kw of c.keywords) {
      if (kw.status === "done") { allDone.push({ kw, cluster: c, idx: gi++ }); }
    }
  }

  // ── Hero grid (top 4 articles) ──
  const h = allDone.slice(0, 4);
  const heroMain = h[0] ? `<a href="/${h[0].cluster.slug}/${h[0].kw.slug}/" class="hero-main">
    ${heroBg(h[0].kw.image, 0)}
    <div class="hero-overlay"></div>
    <div class="hero-content">
      <span class="cat-chip">${h[0].cluster.name}</span>
      <div class="hero-title">${h[0].kw.title}</div>
    </div>
  </a>` : `<div class="hero-main">${heroBg(undefined, 0)}<div class="hero-overlay"></div><div class="hero-content"><div class="hero-title">${cfg.siteTitle}</div></div></div>`;

  const heroSideItems = (h.length > 1 ? h.slice(1, 4) : cfg.clusters.slice(0, 3).map((c, i) => ({ kw: null as any, cluster: c, idx: i }))).map((a, i) =>
    a.kw
      ? `<a href="/${a.cluster.slug}/${a.kw.slug}/" class="hero-side-item">
          ${heroBg(a.kw.image, (i+1)%CARD_GRADS.length)}
          <div class="hero-overlay"></div>
          <div class="hero-content"><span class="cat-chip">${a.cluster.name}</span><div class="hero-title">${a.kw.title}</div></div>
        </a>`
      : `<a href="/${a.cluster.slug}/" class="hero-side-item">
          <div class="hero-grad" style="background:${CARD_GRADS[(i+1)%CARD_GRADS.length]};position:absolute;inset:0"></div>
          <div class="hero-overlay"></div>
          <div class="hero-content"><span class="cat-chip">${a.cluster.name}</span><div class="hero-title">${a.cluster.description}</div></div>
        </a>`
  ).join("\n");

  // ── Hot strip ──
  const hotChips = [
    ...cfg.clusters.slice(0, 5).map(c => `<a href="/${c.slug}/" class="hot-chip">${c.name}</a>`),
    ...allDone.slice(0, 8).map(a => `<a href="/${a.cluster.slug}/${a.kw.slug}/" class="hot-chip">${a.kw.keyword}</a>`),
  ].join("\n        ");

  // ── Ad unit ──
  const adUnit = cfg.adUnitCode
    ? cfg.adUnitCode
    : `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#9ca3af;font-size:.75rem">Рекламный блок 728×90</div>`;

  // ── Recent articles grid ──
  const recentCards = allDone.slice(4, 16).map((a, i) => `<a href="/${a.cluster.slug}/${a.kw.slug}/" class="article-card">
    <div class="ac-img-wrap">
      ${cardBg(a.kw.image, i)}
    </div>
    <div class="ac-body">
      <span class="ac-cat">${a.cluster.name}</span>
      <div class="ac-title">${a.kw.title}</div>
      <div class="ac-meta">⏱ ~5 мин чтения</div>
    </div>
  </a>`).join("\n    ");

  // ── Category cards ──
  const catCards = cfg.clusters.map((c, i) => {
    const count = c.keywords.filter(k => k.status === "done").length;
    return `<a href="/${c.slug}/" class="cat-card">
      <div class="cc-icon" style="width:36px;height:36px;border-radius:8px;background:${CARD_GRADS[i%CARD_GRADS.length]};margin-bottom:.625rem;display:flex;align-items:center;justify-content:center"></div>
      <h2>${c.name}</h2>
      <p>${c.description}</p>
      <div class="cc-count">${count} ${count === 1 ? "статья" : count < 5 ? "статьи" : "статей"}</div>
    </a>`;
  }).join("\n    ");

  const schema = JSON.stringify({ "@context": "https://schema.org", "@type": "WebSite", name: cfg.siteTitle, description: cfg.siteDescription });
  const adHeadCode = cfg.adHeadCode || "";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${cfg.siteTitle}</title>
<meta name="description" content="${cfg.siteDescription}">
<meta property="og:title" content="${cfg.siteTitle}">
<meta property="og:description" content="${cfg.siteDescription}">
<meta property="og:type" content="website">
<link rel="stylesheet" href="/assets/style.css">
<script type="application/ld+json">${schema}</script>
${adHeadCode}
</head>
<body>
${nav}
<div class="container">
  <div class="hero-wrap">
    <div class="hero-grid">
      ${heroMain}
      <div class="hero-side">${heroSideItems}</div>
    </div>
  </div>
</div>
<div class="hot-strip">
  <div class="container">
    <div class="hot-inner">
      <span class="hot-label">🔥 Горячее</span>
      ${hotChips}
    </div>
  </div>
</div>
<div class="container">
  <div class="ad-slot ad-728">${adUnit}</div>
</div>
${recentCards ? `<div class="container">
  <div class="section-header">
    <span class="section-title">Новые статьи</span>
  </div>
  <div class="articles-grid">
    ${recentCards}
  </div>
</div>` : ""}
${safeUrl ? `<div class="container">
  <div class="cta-hero">
    <div class="cta-hero-text">
      <h2>${esc(cfg.siteTitle)} — попробуйте прямо сейчас</h2>
      <p>${esc(cfg.siteDescription)}</p>
    </div>
    <a href="${safeUrl}" class="cta-btn" target="_blank" rel="noopener sponsored">${ctaLabelSafe}</a>
  </div>
</div>` : ""}
<div class="container">
  <div class="section-header">
    <span class="section-title">Все разделы</span>
  </div>
  <div class="cats-grid">
    ${catCards}
  </div>
</div>
${footer}
</body>
</html>`;
}

function buildCategoryPage(cluster: SeoCluster, cfg: SeoConfig): string {
  const nav = buildNav(cfg);
  const footer = buildFooter(cfg);
  const done = cluster.keywords.filter(k => k.status === "done");

  const cards = done.map((k, i) => `<a href="/${cluster.slug}/${k.slug}/" class="article-card">
    <div class="ac-img-wrap">
      ${cardBg(k.image, i)}
    </div>
    <div class="ac-body">
      <span class="ac-cat">${cluster.name}</span>
      <div class="ac-title">${k.title}</div>
      <div class="ac-meta">⏱ ~5 мин чтения</div>
    </div>
  </a>`).join("\n    ");

  const adUnit = cfg.adUnitCode || `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#9ca3af;font-size:.75rem">Рекламный блок</div>`;

  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: cluster.name,
    description: cluster.description,
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Главная", item: "/" },
        { "@type": "ListItem", position: 2, name: cluster.name },
      ],
    },
  });

  const adHeadCode = cfg.adHeadCode || "";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${cluster.name} | ${cfg.siteTitle}</title>
<meta name="description" content="${cluster.description}">
<meta property="og:title" content="${cluster.name} | ${cfg.siteTitle}">
<link rel="stylesheet" href="/assets/style.css">
<link rel="canonical" href="/${cluster.slug}/">
<script type="application/ld+json">${schema}</script>
${adHeadCode}
</head>
<body>
${nav}
<div class="cat-header">
  <div class="container">
    <div class="breadcrumb">
      <a href="/">Главная</a><span class="sep">›</span><span class="cur">${cluster.name}</span>
    </div>
    <h1>${cluster.name}</h1>
    <p>${cluster.description}</p>
  </div>
</div>
<div class="container">
  <div class="ad-slot ad-728">${adUnit}</div>
  ${done.length > 0 ? `<div class="articles-grid">${cards}</div>` : `<p style="text-align:center;padding:3rem 0;color:#9ca3af">Статьи генерируются...</p>`}
</div>
${footer}
</body>
</html>`;
}

function buildFallbackArticle(kw: SeoKeyword, cluster: SeoCluster, cfg: SeoConfig): string {
  const nav = buildNav(cfg);
  const footer = buildFooter(cfg);
  const adUnit = cfg.adUnitCode || `<div style="color:#9ca3af;font-size:.72rem;display:flex;align-items:center;justify-content:center;width:100%;height:100%">Рекламный блок 300×250</div>`;
  const adHeadCode = cfg.adHeadCode || "";

  const relatedLinks = cluster.keywords
    .filter(k => k.slug !== kw.slug && k.filename)
    .slice(0, 4)
    .map(k => `<a href="/${cluster.slug}/${k.slug}/" class="related-card">
      <div class="rc-cat">${cluster.name}</div>
      <div class="rc-title">${k.title}</div>
    </a>`).join("\n");

  const sidebar = `<aside class="sidebar">
  <div class="sb-block"><div class="ad-slot ad-300">${adUnit}</div></div>
</aside>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${kw.title} | ${cfg.siteTitle}</title>
<meta name="description" content="${kw.keyword} — читайте на ${cfg.siteTitle}">
<meta name="robots" content="noindex,follow">
<link rel="stylesheet" href="/assets/style.css">
${adHeadCode}
</head>
<body>
${nav}
<div class="article-page">
  <div class="breadcrumb">
    <a href="/">Главная</a><span class="sep">›</span>
    <a href="/${cluster.slug}/">${cluster.name}</a><span class="sep">›</span>
    <span class="cur">${kw.title}</span>
  </div>
  <div class="article-layout">
    <main class="article-main">
      <div class="article-header">
        <h1>${kw.title}</h1>
        <div class="article-meta"><span class="tag">${cluster.name}</span></div>
      </div>
      <div style="padding:3rem 0;text-align:center">
        <div style="font-size:2.5rem;margin-bottom:1rem">⏳</div>
        <div style="font-size:1.05rem;font-weight:700;color:#374151;margin-bottom:.5rem">Статья скоро появится</div>
        <div style="font-size:.875rem;color:#6b7280">Материал по теме «${kw.keyword}» находится в подготовке</div>
      </div>
      ${relatedLinks ? `<div class="related-articles"><h2>Читайте также</h2><div class="related-grid">${relatedLinks}</div></div>` : ""}
    </main>
    ${sidebar}
  </div>
</div>
${footer}
</body>
</html>`;
}

function buildSitemap(cfg: SeoConfig, baseUrl: string): string {
  const now = new Date().toISOString().split("T")[0];
  let urls = `  <url><loc>${baseUrl}/</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n`;
  for (const c of cfg.clusters) {
    urls += `  <url><loc>${baseUrl}/${c.slug}/</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
    for (const k of c.keywords.filter(kw => kw.status === "done")) {
      urls += `  <url><loc>${baseUrl}/${c.slug}/${k.slug}/</loc><lastmod>${now}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>\n`;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}</urlset>`;
}

function cleanHtml(raw: string): string {
  if (!raw) return "";
  let c = raw.replace(/^\uFEFF/, "").replace(/```[a-zA-Z]*\n?/g, "").replace(/```\s*$/g, "").trim();
  const di = c.search(/<!DOCTYPE\s+html/i);
  if (di > 0) c = c.slice(di);
  return c;
}

function getContentTypeInstructions(contentType: string | undefined, keyQuestions: string[] | undefined): string {
  const qt = contentType || "guide";
  const qBlock = (keyQuestions && keyQuestions.length > 0)
    ? `\nKEY QUESTIONS YOUR ARTICLE MUST ANSWER (based on real searcher intent):\n${keyQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n`
    : "";

  const structures: Record<string, string> = {
    guide: `CONTENT TYPE: Comprehensive Guide
- Open with a "Key Takeaways" box (class="key-takeaways"): <h3>Key Takeaways</h3><ul>3-5 bullet insights</ul>
- Then a Table of Contents (class="toc"): <p class="toc-title">Contents</p><ol>one <li><a href="#section-id">Section title</a></li> per H2</ol>
- 5-6 H2 sections with real depth — beginner-friendly first, advanced last
- Each section has practical examples, data points, or real-world scenarios
- Add 1-2 <blockquote> with expert-sounding insights
- Author box before FAQ: <div class="author-box"><div class="author-avatar">✍</div><div class="author-info"><div class="author-name">Editorial Team</div><div class="author-bio">Verified by experts with 10+ years in the field. Last updated: ${new Date().toLocaleDateString("ru-RU")}.</div></div></div>`,

    tutorial: `CONTENT TYPE: Step-by-Step Tutorial
- Open with a "What You'll Learn" box (class="key-takeaways"): <h3>What You'll Learn</h3><ul>3-4 outcomes</ul>
- Prerequisites paragraph (1-2 sentences)
- Table of Contents (class="toc")
- Number each step using <div class="step-box"><div class="step-num">1</div><div class="step-content"><h3>Step title</h3><p>Clear action + expected result</p></div></div>
- "Common Mistakes to Avoid" H2 section
- "Quick Reference" summary table at the end
- Author box before FAQ`,

    comparison: `CONTENT TYPE: Comparison Article
- Open with "Quick Verdict" box (class="key-takeaways"): <h3>Quick Verdict</h3><ul>3 decisive bullet conclusions</ul>
- Comparison table with HTML <table class="comparison-table">: columns for each option, rows for key features, mark winners with class="ct-winner"
- One H2 per option with deep dive + <div class="pros-cons"><div class="pros"><h4>Pros</h4><ul>…</ul></div><div class="cons"><h4>Cons</h4><ul>…</ul></div></div>
- "Which Should You Choose?" H2 with use-case matrix ("Choose X if… / Choose Y if…")
- Verdict box: <div class="verdict-box"><h3>Our Verdict</h3><p>…</p></div>
- Author box before FAQ`,

    review: `CONTENT TYPE: Review
- Open with verdict summary (class="key-takeaways"): <h3>Our Verdict</h3><ul>rating, key strengths, best for</ul>
- Key features H2 with numbered highlights
- <div class="pros-cons"> grid
- "Who It's For / Who Should Avoid It" H2
- Pricing & Value H2
- Comparison with 2-3 top alternatives
- Verdict box: <div class="verdict-box"><h3>Final Verdict</h3><p>…</p></div>
- Author box before FAQ`,

    listicle: `CONTENT TYPE: Listicle / Best-Of Article
- Brief intro (2-3 sentences): methodology, what was tested, time/experience basis
- Table of Contents (class="toc")
- One H2 per list item (numbered: "1. Best X for Y", "2. …")
- Each item: 150-200 words + pros/cons mini list + "Best for: …" sentence
- Summary comparison table (class="comparison-table") after all items
- "How to Choose" H2 with decision framework
- Author box before FAQ`,
  };

  return (structures[qt] || structures.guide) + qBlock;
}

async function generateArticleHtml(
  kw: SeoKeyword,
  cluster: SeoCluster,
  cfg: SeoConfig,
  allClusters: SeoCluster[],
  cover: string,
  idx: number,
): Promise<string> {
  // ── Build sidebar in TypeScript (reliable, consistent) ──
  const sidebarLinks = cluster.keywords
    .filter(k => k.status === "done" && k.slug !== kw.slug)
    .slice(0, 6)
    .map((k, i) => `<li><div class="sb-num">${String(i + 1).padStart(2, "0")}</div><a href="/${cluster.slug}/${k.slug}/">${k.title}</a></li>`)
    .join("\n");

  const otherLinks = allClusters
    .filter(c => c.id !== cluster.id)
    .flatMap(c => c.keywords.filter(k => k.status === "done").slice(0, 2))
    .slice(0, 4)
    .map(k => {
      const c = allClusters.find(x => x.keywords.some(x2 => x2.slug === k.slug))!;
      return `<li><a href="/${c.slug}/${k.slug}/">${k.title}</a></li>`;
    }).join("\n");

  const adUnit = cfg.adUnitCode || `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#9ca3af;font-size:.72rem">Рекламный блок 300×250</div>`;

  const sidebar = `<aside class="sidebar">
  <div class="sb-block"><div class="ad-slot ad-300">${adUnit}</div></div>
  ${sidebarLinks ? `<div class="sb-block">
    <div class="sb-head">В этом разделе</div>
    <div class="sb-body"><ul class="sb-list">${sidebarLinks}</ul></div>
  </div>` : ""}
  ${otherLinks ? `<div class="sb-block">
    <div class="sb-head">Ещё материалы</div>
    <div class="sb-body"><ul class="sb-list">${otherLinks}</ul></div>
  </div>` : ""}
  <div class="sb-block"><div class="ad-slot ad-300">${adUnit}</div></div>
</aside>`;

  // ── Internal links for AI ──
  const relatedLinks = allClusters
    .flatMap(c => c.keywords.filter(k => k.slug !== kw.slug && k.status === "done").slice(0, 2).map(k => `/${c.slug}/${k.slug}/ → ${k.title}`))
    .slice(0, 6).join("\n");

  const contentTypeBlock = getContentTypeInstructions(kw.contentType, kw.keyQuestions);
  const today = new Date().toLocaleDateString("ru-RU");

  const safeUrl = safeHref(cfg.targetUrl);
  const ctaLabelSafe = esc(cfg.ctaLabel || "Попробовать →");
  const ctaHtml = safeUrl ? `<div class="cta-block">
  <div class="cta-icon">🚀</div>
  <div class="cta-text">
    <strong>[Write a compelling 8-12 word hook about ${cfg.siteTitle} related to "${kw.keyword}"]</strong>
    <span>[One sentence: what the user gets by clicking — make it relevant to the article topic]</span>
  </div>
  <a href="${safeUrl}" class="cta-btn" target="_blank" rel="noopener sponsored">${ctaLabelSafe}</a>
</div>` : "";

  const prompt = `You are a world-class editorial designer + SEO writer creating a PREMIUM WEB MAGAZINE article. Write ONLY the inner article HTML fragment — NO <!DOCTYPE>, NO <html>, NO <head>, NO <nav>, NO <footer>, NO <body>.

KEYWORD: "${kw.keyword}"
TITLE (H1): "${kw.title}"
CATEGORY: "${cluster.name}"
SITE: "${cfg.siteTitle}" — ${cfg.siteDescription}
${safeUrl ? `TARGET URL: ${safeUrl} | CTA BUTTON TEXT: "${cfg.ctaLabel || "Попробовать →"}"` : ""}

${contentTypeBlock}

CONTENT QUALITY (write in the same language as the keyword):
- 2000-2800 genuinely informative words — no filler, every sentence adds real value
- Hook from sentence one: surprising fact, bold statement, or relatable problem
- Real statistics, concrete examples, named tools/brands where relevant
- Write with authority and warmth — expert talking to a smart friend
- 5 FAQ pairs in collapsible structure

VISUAL RHYTHM — THIS IS A MAGAZINE, NOT A WALL OF TEXT (CRITICAL):
- The VERY FIRST paragraph MUST be <p class="lead">…</p> (a bold, larger intro paragraph with a drop-cap).
- Break up the text. After every 2-3 paragraphs, insert ONE rich visual element. Choose from:
  • Pull quote: <blockquote class="pull-quote">Memorable insight in 10-18 words.</blockquote>
  • Callout box: <div class="callout"><div class="callout-title">💡 Совет</div><p>Actionable tip.</p></div> (also use ⚠️ Важно / 📌 Запомните variants)
  • Stat grid (2-4 cards of real numbers): <div class="stat-grid"><div class="stat-card"><div class="stat-num">73%</div><div class="stat-label">short description</div></div>…</div>
  • Inline SVG illustration for a concept — small, decorative, theme-neutral strokes using currentColor, e.g.:
    <figure class="article-svg"><svg viewBox="0 0 320 160" role="img" aria-label="[what it shows]"><!-- simple geometric/line illustration, stroke="currentColor" fill="none" or subtle fills --></svg><figcaption>[1-line caption]</figcaption></figure>
- Use these elements at least 4 times total across the article (mix of types). Never put two of the same type back-to-back.
- DO NOT output any <img> tags. The hero cover image is added automatically — never write <img>, never reference IMG_PLACEHOLDER.
- 5-6 H2 sections; vary paragraph length; use <ul>/<ol> and <table> where they genuinely help.

INTERNAL LINKS (use naturally in body text):
${relatedLinks || "(none yet)"}
${ctaHtml ? `
CTA BLOCK — insert this EXACTLY TWICE:
  1) Right after the opening lead paragraph (before first H2)
  2) Right before the [author-box]
Use this exact HTML (fill in the bracketed placeholders with compelling copy):
${ctaHtml}` : ""}

OUTPUT EXACTLY THIS STRUCTURE (no outer wrappers, no page-level tags):
<div class="article-header">
  <h1>${kw.title}</h1>
  <div class="article-meta">
    <span class="tag">${cluster.name}</span>
    <span class="reading-time">⏱ ~[N] мин чтения</span>
    <span>Обновлено: ${today}</span>
  </div>
</div>
{{COVER}}
[key-takeaways box if applicable]
[toc if guide/tutorial/listicle]
<div class="article-body">
  <p class="lead">[opening lead paragraph — bold, sets the stakes]</p>
  ${ctaHtml ? "[CTA BLOCK #1 — see above]" : ""}
  [h2 sections with full content; rich visual elements (pull-quote / callout / stat-grid / inline SVG) interleaved every 2-3 paragraphs; internal links where relevant]
  ${ctaHtml ? "[CTA BLOCK #2 — see above]" : ""}
</div>
[author-box]
<div class="faq-section">
  <h2>Часто задаваемые вопросы</h2>
  [5 faq-items: <div class="faq-item"><div class="faq-question">Question<span>+</span></div><div class="faq-answer">Answer text</div></div>]
</div>
<div class="related-articles">
  <h2>Читайте также</h2>
  <div class="related-grid">
    [3-4 related-card divs using internal links above]
  </div>
</div>

Output ONLY the HTML fragment above — no markdown, no explanations, no page-level tags. Keep the literal text {{COVER}} exactly where shown — it will be replaced automatically.`;

  let articleContent = "";
  try {
    articleContent = await kieSync([
      { role: "system", content: "You are an expert SEO content writer. Output only a clean inner HTML fragment — no markdown, no page-level tags, no explanation." },
      { role: "user", content: prompt },
    ], 120000);
    // Strip any accidental page-level wrapping
    articleContent = articleContent.replace(/^\uFEFF/, "").replace(/```[a-zA-Z]*\n?/g, "").replace(/```\s*$/g, "").trim();
    articleContent = articleContent.replace(/<!DOCTYPE[^>]*>/gi, "").replace(/<\/?html[^>]*>/gi, "").replace(/<head>[\s\S]*?<\/head>/gi, "").replace(/<\/?body[^>]*>/gi, "").replace(/<\/?nav[^>]*>[\s\S]*?<\/nav>/gi, "").replace(/<footer[\s\S]*?<\/footer>/gi, "").trim();
  } catch (e: any) {
    console.warn(`[SEO] Article gen failed for ${kw.keyword}:`, e?.message);
    return "";
  }

  // ── Cover image block (one per article, GPT-image-2 1K) with graceful fallback ──
  const coverUrl = cssUrl(cover);
  const coverImg = coverUrl
    ? `<img class="hero-article-img" src="${coverUrl}" alt="${esc(kw.title)}" loading="lazy">`
    : `<div class="hero-cover-fallback" style="background:${CARD_GRADS[idx % CARD_GRADS.length]}"><span>${esc(cluster.name)}</span></div>`;
  const flourish = `<div class="article-flourish" aria-hidden="true"><svg viewBox="0 0 200 16"><path class="af-line" d="M2 8 C 50 2,80 14,110 8 S 170 2,198 8"/><circle class="af-dot" cx="2" cy="8" r="4"/></svg></div>`;
  const coverBlock = `${coverImg}\n${flourish}`;
  // Strip any stray <img> the model may have emitted despite instructions
  articleContent = articleContent.replace(/<img\b[^>]*>/gi, "");
  if (articleContent.includes("{{COVER}}")) {
    articleContent = articleContent.replace(/\{\{COVER\}\}/g, coverBlock);
  } else {
    // No marker — inject cover right before the article body (robust), else prepend
    const bodyIdx = articleContent.search(/<div\s+class="article-body"/i);
    if (bodyIdx !== -1) {
      articleContent = articleContent.slice(0, bodyIdx) + coverBlock + "\n" + articleContent.slice(bodyIdx);
    } else {
      articleContent = coverBlock + "\n" + articleContent;
    }
  }

  // ── Schema.org ──
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: kw.title,
    description: `${kw.keyword} — читайте на ${cfg.siteTitle}`,
    author: { "@type": "Organization", name: cfg.siteTitle },
    publisher: { "@type": "Organization", name: cfg.siteTitle },
    datePublished: new Date().toISOString().split("T")[0],
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Главная", item: "/" },
        { "@type": "ListItem", position: 2, name: cluster.name, item: `/${cluster.slug}/` },
        { "@type": "ListItem", position: 3, name: kw.title },
      ],
    },
  });

  const nav = buildNav(cfg);
  const footer = buildFooter(cfg);
  const adHeadCode = cfg.adHeadCode || "";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${kw.title} | ${cfg.siteTitle}</title>
<meta name="description" content="${kw.keyword} — подробная статья. ${cfg.siteDescription.slice(0, 100)}">
<meta property="og:title" content="${kw.title} | ${cfg.siteTitle}">
<meta property="og:description" content="${kw.keyword} — читайте на ${cfg.siteTitle}">
<meta property="og:type" content="article">
<link rel="canonical" href="/${cluster.slug}/${kw.slug}/">
<link rel="stylesheet" href="/assets/style.css">
<script type="application/ld+json">${schema}</script>
${adHeadCode}
</head>
<body>
${nav}
<div class="article-page">
  <div class="breadcrumb">
    <a href="/">Главная</a><span class="sep">›</span>
    <a href="/${cluster.slug}/">${cluster.name}</a><span class="sep">›</span>
    <span class="cur">${kw.title}</span>
  </div>
  <div class="article-layout">
    <main class="article-main">
      ${articleContent}
    </main>
    ${sidebar}
  </div>
</div>
${footer}
<script>
document.querySelectorAll('.faq-question').forEach(function(q){
  q.addEventListener('click',function(){
    var a=this.nextElementSibling;
    var open=a&&a.style.display==='block';
    if(a){a.style.display=open?'none':'block';}
    var ic=this.querySelector('span');
    if(ic)ic.textContent=open?'+':'−';
  });
});
document.querySelectorAll('.toc a').forEach(function(a){
  a.addEventListener('click',function(e){
    e.preventDefault();
    var t=document.querySelector(decodeURIComponent(this.getAttribute('href')||''));
    if(t)t.scrollIntoView({behavior:'smooth',block:'start'});
  });
});
</script>
</body>
</html>`;
}

export function registerSeoRoutes(app: Express, storage: IStorage) {
  function requireAuth(req: any, res: any): number | null {
    if (!req.isAuthenticated()) { res.status(401).json({ message: "Требуется авторизация" }); return null; }
    return (req.user as any).id as number;
  }

  // GET /api/seo/:id — project data
  app.get("/api/seo/:id", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const proj = await storage.getProject(parseInt(req.params.id));
    if (!proj || proj.userId !== userId) return res.status(404).json({ message: "Not found" });
    const files = await storage.getProjectFiles(proj.id);
    res.json({ project: proj, files: files.map(f => ({ id: f.id, filename: f.filename })) });
  });

  // POST /api/seo/create — create SEO project
  app.post("/api/seo/create", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const { title, niche } = req.body;
    if (!title) return res.status(400).json({ message: "title required" });

    const initialConfig: SeoConfig = {
      niche: niche || "",
      rawKeywords: [],
      clusters: [],
      siteTitle: title,
      siteDescription: niche || title,
      status: "idle",
      pagesTotal: 0,
      pagesGenerated: 0,
    };

    const proj = await storage.createProject({
      userId,
      title,
      description: niche || "",
      generatedCode: "",
      type: "seo",
      seoConfig: initialConfig,
    } as any);

    res.json({ project: proj });
  });

  // POST /api/seo/:id/analyze — cluster keywords
  app.post("/api/seo/:id/analyze", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const proj = await storage.getProject(parseInt(req.params.id));
    if (!proj || proj.userId !== userId) return res.status(404).json({ message: "Not found" });

    const { keywords, niche, targetUrl, ctaLabel, projectName } = req.body as { keywords: string[]; niche?: string; targetUrl?: string; ctaLabel?: string; projectName?: string };
    if (!keywords || keywords.length === 0) return res.status(400).json({ message: "keywords required" });

    const limited = keywords.slice(0, 1000).map(k => k.trim()).filter(Boolean);
    const siteNiche = niche || (proj.seoConfig?.niche) || proj.title;

    // Sanitize project name — used verbatim across the site (logo + nav + footer + titles)
    const cleanName = String(projectName || "")
      .replace(/[<>"'`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    const prevCfg = (proj.seoConfig as SeoConfig) || ({} as SeoConfig);
    const siteName = cleanName || prevCfg.projectName || "";
    if (!siteName) return res.status(400).json({ message: "Введите название проекта" });

    await storage.updateProject(proj.id, {
      seoConfig: { ...prevCfg, status: "analyzing", rawKeywords: limited, niche: siteNiche, projectName: siteName },
    } as any);

    try {
      const prompt = `You are an expert SEO architect and content strategist. Cluster these ${limited.length} keywords into thematic categories for a website about "${siteNiche}".

KEYWORDS:
${limited.join("\n")}

RULES:
- Group related keywords into 3-10 logical categories
- Each category should have a clear topic focus
- Each keyword goes into exactly one category
- Max 100 keywords per category (merge small groups)
- Generate a compelling SEO article title for each keyword (50-60 chars)
- Keep category and keyword slugs URL-safe (Latin, no spaces)
- Classify each keyword's content type based on searcher intent:
  * "guide" — broad informational ("what is X", "how X works", "complete guide to X")
  * "tutorial" — how-to with steps ("how to do X", "step by step", "DIY")
  * "comparison" — X vs Y, best alternatives, "or", "vs"
  * "review" — specific product/service review, "rating", "pros cons", "worth it"
  * "listicle" — top-N, best-of, "10 ways", "list of"
- For each keyword, identify 3 real questions searchers have (short, 60 chars max each)

Respond with ONLY valid JSON, no explanation:
{
  "siteTitle": "Human-readable site title about the niche",
  "siteDescription": "One compelling sentence describing what the site covers (120-160 chars)",
  "clusters": [
    {
      "name": "Category display name",
      "slug": "category-slug",
      "description": "What this category covers (1-2 sentences)",
      "keywords": [
        {
          "keyword": "original keyword text",
          "slug": "keyword-slug",
          "title": "Full SEO article title (50-60 chars)",
          "contentType": "guide|tutorial|comparison|review|listicle",
          "keyQuestions": ["Question 1?", "Question 2?", "Question 3?"]
        }
      ]
    }
  ]
}`;

      const responseText = await kieSync([
        { role: "system", content: "You are an SEO architecture expert. Respond only with valid JSON." },
        { role: "user", content: prompt },
      ], 120000);

      let parsed: any;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch?.[0] || responseText);
      } catch {
        throw new Error("Invalid JSON from AI");
      }

      const clusters: SeoCluster[] = (parsed.clusters || []).map((c: any) => ({
        id: crypto.randomUUID(),
        name: c.name || "Category",
        slug: slugify(c.slug || c.name || "category"),
        description: c.description || "",
        keywords: (c.keywords || []).map((k: any) => ({
          id: crypto.randomUUID(),
          keyword: k.keyword || "",
          slug: slugify(k.slug || k.keyword || "page"),
          title: k.title || k.keyword || "",
          status: "pending" as const,
          contentType: (["guide","tutorial","comparison","review","listicle"].includes(k.contentType) ? k.contentType : "guide") as SeoKeyword["contentType"],
          keyQuestions: Array.isArray(k.keyQuestions) ? k.keyQuestions.slice(0, 3).map(String) : [],
        })),
      }));

      const totalPages = clusters.reduce((s, c) => s + c.keywords.length, 0);
      // Project name is authoritative — used verbatim as siteTitle across the whole site.
      const finalName = siteName || parsed.siteTitle || proj.title;
      const theme = selectTheme(finalName, siteNiche);
      const updatedConfig: SeoConfig = {
        niche: siteNiche,
        rawKeywords: limited,
        clusters,
        projectName: finalName,
        siteTitle: finalName,
        siteDescription: parsed.siteDescription || siteNiche,
        targetUrl: targetUrl || prevCfg.targetUrl || "",
        ctaLabel: ctaLabel || prevCfg.ctaLabel || "Попробовать →",
        theme,
        status: "idle",
        pagesTotal: totalPages,
        pagesGenerated: 0,
      };

      await storage.updateProject(proj.id, { seoConfig: updatedConfig, title: finalName } as any);
      res.json({ config: updatedConfig });
    } catch (e: any) {
      await storage.updateProject(proj.id, {
        seoConfig: { ...(proj.seoConfig as SeoConfig), status: "error" },
      } as any);
      res.status(500).json({ message: e?.message || "Analysis failed" });
    }
  });

  // POST /api/seo/:id/generate — SSE batch generation
  app.post("/api/seo/:id/generate", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const proj = await storage.getProject(parseInt(req.params.id));
    if (!proj || proj.userId !== userId) return res.status(404).json({ message: "Not found" });

    const cfg = proj.seoConfig as SeoConfig;
    if (!cfg || cfg.clusters.length === 0) return res.status(400).json({ message: "Run analyze first" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const send = (data: object) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
    };

    let aborted = false;
    let creditsDepleted = false;
    req.on("close", () => { aborted = true; });

    // Ensure site CSS is saved (themed)
    await storage.upsertProjectFile({ projectId: proj.id, filename: "assets/style.css", code: buildSiteCss(themeOf(cfg)) });

    let generated = 0;
    let articleIdx = 0;
    const allClusters = cfg.clusters;

    send({ type: "start", total: cfg.pagesTotal });

    for (const cluster of allClusters) {
      if (aborted || creditsDepleted) break;

      for (const kw of cluster.keywords) {
        if (aborted || creditsDepleted) break;
        const idx = articleIdx++;
        if (kw.status === "done") { generated++; continue; }

        const filename = `${cluster.slug}/${kw.slug}/index.html`;
        send({ type: "progress", keyword: kw.keyword, status: "generating", generated, total: cfg.pagesTotal });

        // ── Deduct credits ──
        const ikey = `seo-article-${proj.id}-${kw.id}`;
        const ded = await storage.deductCredits(userId, SEO_ARTICLE_COST, "seo-article", ikey);
        if (!ded.success) {
          // Write fallback so URL exists, save progress, then stop
          const fallback = buildFallbackArticle(kw, cluster, { ...cfg, clusters: allClusters });
          await storage.upsertProjectFile({ projectId: proj.id, filename, code: fallback });
          kw.status = "done"; kw.filename = filename;
          const progressCfg: SeoConfig = { ...cfg, clusters: allClusters, pagesGenerated: generated };
          await storage.updateProject(proj.id, { seoConfig: progressCfg } as any);
          send({ type: "error", message: "Недостаточно токенов — пополните баланс и нажмите «Продолжить»", generated, total: cfg.pagesTotal });
          creditsDepleted = true;
          break;
        }

        // ── Generate ONE cover image (non-fatal — graceful gradient fallback) ──
        let cover = "";
        if (!aborted) {
          try {
            const coverPrompt = `Premium editorial magazine cover image for the article "${kw.title}" about ${cluster.name}, ${cfg.niche}. Cinematic, photorealistic, high-end, 16:9, no text, no watermark.`;
            cover = (await generateImage(coverPrompt)) || "";
          } catch (imgErr: any) {
            console.warn(`[SEO] Cover image failed for "${kw.keyword}" (continuing):`, imgErr?.message);
          }
        }

        // ── Generate article HTML with 1 automatic retry ──
        let html = "";
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            html = await generateArticleHtml(kw, cluster, cfg, allClusters, cover, idx);
            if (html) break; // success
          } catch (artErr: any) {
            console.warn(`[SEO] Article attempt ${attempt} failed for "${kw.keyword}":`, artErr?.message);
            if (attempt === 2) html = ""; // give up after 2 tries
          }
        }

        if (!html) {
          // Refund credits, write fallback placeholder so URL always exists
          if (!ded.alreadyProcessed) { try { await storage.refundCredits(userId, SEO_ARTICLE_COST, ikey); } catch {} }
          const fallback = buildFallbackArticle(kw, cluster, { ...cfg, clusters: allClusters });
          await storage.upsertProjectFile({ projectId: proj.id, filename, code: fallback });
          kw.status = "done"; kw.filename = filename; // "done" so it's counted and site stays complete
          generated++;
          send({ type: "page_done", keyword: kw.keyword, status: "fallback", generated, total: cfg.pagesTotal });
        } else {
          await storage.upsertProjectFile({ projectId: proj.id, filename, code: html });
          kw.status = "done"; kw.filename = filename;
          if (cover) kw.image = cover;
          generated++;
          send({ type: "page_done", keyword: kw.keyword, status: "done", generated, total: cfg.pagesTotal });
        }

        // Save progress after every article (crash-safe)
        const progressCfg: SeoConfig = { ...cfg, clusters: allClusters, pagesGenerated: generated };
        await storage.updateProject(proj.id, { seoConfig: progressCfg } as any);
      }

      // Generate category index page
      if (!aborted) {
        const catHtml = buildCategoryPage(cluster, { ...cfg, clusters: allClusters });
        await storage.upsertProjectFile({ projectId: proj.id, filename: `${cluster.slug}/index.html`, code: catHtml });
      }
    }

    // Generate homepage + sitemap (even if some articles had fallbacks)
    if (!aborted) {
      const doneStatus = creditsDepleted ? "idle" : "done";
      const finalCfg: SeoConfig = { ...cfg, clusters: allClusters, pagesGenerated: generated, status: doneStatus };
      const homeHtml = buildHomePage(finalCfg);
      await storage.upsertProjectFile({ projectId: proj.id, filename: "index.html", code: homeHtml });
      await storage.upsertProjectFile({ projectId: proj.id, filename: "robots.txt", code: `User-agent: *\nAllow: /\nSitemap: /sitemap.xml` });
      await storage.updateProject(proj.id, { seoConfig: finalCfg, generatedCode: homeHtml } as any);
      if (creditsDepleted) {
        send({ type: "done", generated, total: cfg.pagesTotal, partial: true });
      } else {
        send({ type: "done", generated, total: cfg.pagesTotal });
      }
    }

    res.end();
  });

  // POST /api/seo/:id/publish — deploy to Yandex Cloud Object Storage (+ domain mirror)
  app.post("/api/seo/:id/publish", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const proj = await storage.getProject(parseInt(req.params.id));
    if (!proj || proj.userId !== userId) return res.status(404).json({ message: "Not found" });

    const files = await storage.getProjectFiles(proj.id);
    if (files.length === 0) return res.status(400).json({ message: "No pages generated yet" });

    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Пользователь не найден" });
    if (user.credits < DAILY_PUBLISH_COST) {
      return res.status(403).json({
        message: "Недостаточно токенов для публикации. Ежедневная стоимость хостинга — 35 токенов/сайт в день.",
      });
    }

    const alreadyLive =
      proj.publishStatus === "published" ||
      proj.publishStatus === "publishing" ||
      proj.publishStatus === "suspended";

    if (!alreadyLive) {
      const today = new Date().toISOString().slice(0, 10);
      const publishCharge = await storage.deductCredits(
        userId,
        DAILY_PUBLISH_COST,
        "daily_publish",
        `publish-start-${proj.id}-${today}`,
      );
      if (!publishCharge.success) {
        return res.status(403).json({
          message: "Недостаточно токенов для публикации. Ежедневная стоимость хостинга — 35 токенов/сайт в день.",
          newBalance: publishCharge.newBalance,
        });
      }
    }

    await storage.updateProject(proj.id, { publishStatus: "publishing" } as any);

    const cfg = proj.seoConfig as SeoConfig;
    const customDomain = ((proj as any).customDomain || "").replace(/^www\./, "").trim();
    const baseUrl = customDomain
      ? `https://${customDomain}`
      : `https://craft-ai-p${proj.id}.website.yandexcloud.net`;

    // Generate final sitemap before deploy (always refresh so custom domain URLs stay current)
    const sitemapContent = buildSitemap(cfg, baseUrl);
    await storage.upsertProjectFile({ projectId: proj.id, filename: "sitemap.xml", code: sitemapContent });

    const allFiles = await storage.getProjectFiles(proj.id);
    const deployFiles = allFiles
      .filter((f) => !isInternalAgentFile(f.filename))
      .map(f => ({ filename: f.filename, content: f.code }));

    try {
      // Deploys to the project bucket AND mirrors into the domain-named
      // bucket when a custom domain is attached (served by the Caddy proxy).
      const { url, yandexProjectId, ycStoragePoolId } = await deployToYandex(
        proj.id,
        deployFiles,
        (proj as any).customDomain,
        (proj as any).ycStoragePoolId,
      );
      const finalUrl = url;

      const updatedCfg: SeoConfig = { ...cfg, publishUrl: finalUrl };
      await storage.updateProject(proj.id, {
        publishedUrl: finalUrl,
        publishStatus: "published",
        vercelProjectId: yandexProjectId,
        ycStoragePoolId,
        seoConfig: updatedCfg,
      } as any);

      res.json({ url: finalUrl });
    } catch (e: any) {
      // Roll status back so the user can retry; first-day charge already taken
      // (same semantics as regular site publish).
      await storage.updateProject(proj.id, {
        publishStatus: alreadyLive ? "published" : "draft",
      } as any).catch(() => {});
      res.status(500).json({ message: e?.message || "Publish failed" });
    }
  });

  // POST /api/seo/:id/add-keywords — merge a new keyword pack into existing site
  app.post("/api/seo/:id/add-keywords", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const proj = await storage.getProject(parseInt(req.params.id));
    if (!proj || proj.userId !== userId) return res.status(404).json({ message: "Not found" });
    const cfg = proj.seoConfig as SeoConfig;
    if (!cfg?.clusters) return res.status(400).json({ message: "No existing structure. Run analyze first." });

    const { keywords }: { keywords: string[] } = req.body;
    if (!Array.isArray(keywords) || keywords.length === 0) return res.status(400).json({ message: "keywords required" });
    if (keywords.length > 500) return res.status(400).json({ message: "Max 500 keywords per pack" });

    const existingClusters = cfg.clusters.map(c => `- ${c.name} (${c.slug}): ${c.description}`).join("\n");

    const analyzePrompt = `You are an SEO architect merging new keywords into an existing website about "${cfg.niche}".

EXISTING CATEGORIES:
${existingClusters}

NEW KEYWORDS TO INTEGRATE:
${keywords.join("\n")}

RULES:
1. Map each keyword to the MOST RELEVANT existing category if it fits naturally
2. If a keyword doesn't fit any existing category well, create a NEW category (new slug, name, description)
3. For each keyword, generate: title (50-60 chars, SEO-optimized), slug (Latin, URL-safe), contentType (guide|tutorial|comparison|review|listicle), keyQuestions (3 real searcher questions)
4. Avoid duplicating existing keywords/slugs

Respond ONLY with valid JSON (no markdown):
{
  "assignments": [
    {
      "categorySlug": "existing-or-new-slug",
      "categoryName": "Category Name",
      "categoryDescription": "Description (required only for NEW categories)",
      "isNew": false,
      "keyword": "keyword text",
      "slug": "keyword-slug",
      "title": "SEO Article Title",
      "contentType": "guide",
      "keyQuestions": ["Q1?", "Q2?", "Q3?"]
    }
  ]
}`;

    let parsed: { assignments: any[] };
    try {
      const raw = await kieSync([
        { role: "system", content: "You are an SEO architect. Output only valid JSON, no markdown, no explanation." },
        { role: "user", content: analyzePrompt },
      ], 120000);
      const json = raw.replace(/```[a-zA-Z]*\n?/g, "").replace(/```\s*$/g, "").trim();
      parsed = JSON.parse(json);
    } catch (e: any) {
      return res.status(500).json({ message: `AI analysis failed: ${e.message}` });
    }

    if (!parsed?.assignments?.length) return res.status(400).json({ message: "No assignments returned from AI" });

    // Merge assignments into existing clusters
    const allClusters: SeoCluster[] = [...cfg.clusters];
    let added = 0;

    for (const a of parsed.assignments) {
      if (!a.keyword || !a.slug || !a.categorySlug) continue;

      // Find or create cluster
      let cluster = allClusters.find(c => c.slug === a.categorySlug);
      if (!cluster) {
        cluster = {
          id: crypto.randomUUID(),
          name: a.categoryName || a.categorySlug,
          slug: a.categorySlug,
          description: a.categoryDescription || "",
          keywords: [],
        };
        allClusters.push(cluster);
      }

      // Skip if slug already exists in this cluster
      if (cluster.keywords.some(k => k.slug === a.slug)) continue;

      cluster.keywords.push({
        id: crypto.randomUUID(),
        keyword: a.keyword,
        slug: a.slug,
        title: a.title || a.keyword,
        status: "pending",
        contentType: a.contentType,
        keyQuestions: Array.isArray(a.keyQuestions) ? a.keyQuestions : [],
      });
      added++;
    }

    const newTotal = cfg.pagesTotal + added;
    const updatedCfg: SeoConfig = { ...cfg, clusters: allClusters, pagesTotal: newTotal };
    await storage.updateProject(proj.id, { seoConfig: updatedCfg } as any);

    res.json({ ok: true, added, pagesTotal: newTotal, clusters: allClusters.length });
  });

  // POST /api/seo/:id/update-config — save edited structure
  app.post("/api/seo/:id/update-config", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const proj = await storage.getProject(parseInt(req.params.id));
    if (!proj || proj.userId !== userId) return res.status(404).json({ message: "Not found" });
    const { seoConfig } = req.body;
    if (!seoConfig) return res.status(400).json({ message: "seoConfig required" });
    await storage.updateProject(proj.id, { seoConfig } as any);
    res.json({ ok: true });
  });

  // GET /api/seo/:id/file — serve file content for preview
  app.get("/api/seo/:id/file", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const proj = await storage.getProject(parseInt(req.params.id));
    if (!proj || proj.userId !== userId) return res.status(404).json({ message: "Not found" });
    const { filename } = req.query as { filename: string };
    if (!filename) return res.status(400).json({ message: "filename required" });
    let file = await storage.getProjectFile(proj.id, filename);
    // Fallback: if style.css missing from DB (old project), save & return it now
    if (!file && filename === "assets/style.css") {
      const css = buildSiteCss(themeOf(proj.seoConfig as SeoConfig));
      await storage.upsertProjectFile({ projectId: proj.id, filename: "assets/style.css", code: css });
      file = { id: 0, projectId: proj.id, filename: "assets/style.css", code: css, createdAt: new Date() } as any;
    }
    if (!file) return res.status(404).json({ message: "File not found" });
    const ct = filename.endsWith(".css") ? "text/css" : filename.endsWith(".txt") ? "text/plain" : "text/html";
    res.type(ct).send(file.code);
  });
}
