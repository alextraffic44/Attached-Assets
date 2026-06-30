import { type Express } from "express";
import type { IStorage } from "./storage";
import { deployToNetlify } from "./netlify-deploy";
import type { SeoConfig, SeoCluster, SeoKeyword } from "@shared/schema";
import crypto from "crypto";

const KIE_API_KEY = process.env.KIE_API_KEY || "";
const KIE_BASE = "https://api.kie.ai/codex/v1";
const KIE_TASKS_URL = `${KIE_BASE}/tasks`;
const KIE_GEMINI_MODEL = "gemini-3-5-flash";
const KIE_GEMINI_URL = `https://api.kie.ai/gemini/v1/models/${KIE_GEMINI_MODEL}:generateContent`;

const SEO_ARTICLE_COST = 70;
const IMG_PER_ARTICLE = 3;
const IMG_COST = 10;

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

async function generateImage(prompt: string, timeout = 120000): Promise<string | null> {
  if (!KIE_API_KEY) return null;
  try {
    const createRes = await fetch(KIE_TASKS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_API_KEY}` },
      body: JSON.stringify({ model: "nano-banana-2", input: { prompt, imageSize: "1536x1024", outputFormat: "jpg" } }),
    });
    const createData = await createRes.json() as any;
    const taskId = createData?.data?.taskId;
    if (!taskId) return null;

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 6000));
      const pollRes = await fetch(`${KIE_TASKS_URL}?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
      });
      const pollData = await pollRes.json() as any;
      const state = pollData?.data?.state;
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

const SITE_CSS = `/* Craft AI SEO Magazine */
:root{--brand:#4f46e5;--brand-light:#6366f1;--text:#111827;--text2:#4b5563;--muted:#9ca3af;--bg:#fff;--bg2:#f9fafb;--bg3:#f3f4f6;--border:#e5e7eb;--nav:#0c0c14;--shadow:0 1px 8px rgba(0,0,0,.08);--shadow-lg:0 4px 24px rgba(0,0,0,.14);--r:8px;--w:1200px;--nh:58px}
*{margin:0;padding:0;box-sizing:border-box}html{scroll-behavior:smooth}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.7}
a{color:inherit;text-decoration:none}img{max-width:100%;height:auto;display:block}
nav{background:var(--nav);height:var(--nh);position:sticky;top:0;z-index:100;box-shadow:0 2px 20px rgba(0,0,0,.4)}
.nav-inner{max-width:var(--w);margin:0 auto;padding:0 1.5rem;display:flex;align-items:center;gap:1rem;height:100%}
.nav-logo{font-weight:900;font-size:1.1rem;color:#fff;letter-spacing:-.03em;flex-shrink:0}
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
.hot-chip:hover{border-color:var(--brand);color:var(--brand);background:#f0f0ff}
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
.cat-header{padding:2.25rem 0;margin-bottom:1.75rem;background:linear-gradient(135deg,var(--brand),#7c3aed)}
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
.article-body{font-size:1.025rem;line-height:1.85}
.article-body h2{font-size:1.25rem;font-weight:800;letter-spacing:-.025em;margin:2.25rem 0 .875rem;padding-top:.4rem;border-top:1px solid var(--border);line-height:1.25}
.article-body h3{font-size:1.025rem;font-weight:700;margin:1.75rem 0 .6rem}
.article-body p{margin-bottom:1.2rem;color:var(--text2)}
.article-body ul,.article-body ol{margin:1rem 0 1.4rem 1.5rem;color:var(--text2)}
.article-body li{margin-bottom:.4rem}
.article-body strong{color:var(--text);font-weight:600}
.article-body blockquote{border-left:4px solid var(--brand);padding:.875rem 1.4rem;background:var(--bg2);border-radius:0 8px 8px 0;margin:1.75rem 0;font-style:italic;color:var(--text2)}
.article-img{width:100%;border-radius:var(--r);margin:1.75rem 0;max-height:400px;object-fit:cover;box-shadow:var(--shadow)}
.reading-time{font-size:.7rem;color:var(--muted)}
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
.footer-logo{font-weight:900;font-size:.975rem;color:#fff;margin-bottom:.35rem;letter-spacing:-.02em}
.footer-desc{font-size:.76rem;opacity:.5;line-height:1.6}
.footer-col h4{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.35);margin-bottom:.75rem}
.footer-col ul{list-style:none}.footer-col li{margin-bottom:.35rem}
.footer-col a{font-size:.78rem;color:rgba(255,255,255,.5)}.footer-col a:hover{color:#fff}
.footer-bottom{max-width:var(--w);margin:1.5rem auto 0;padding-top:1.1rem;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;font-size:.7rem;color:rgba(255,255,255,.28);flex-wrap:wrap;gap:.4rem}
/* ── SEO CONTENT ELEMENTS ── */
.key-takeaways{background:#eff0ff;border-left:4px solid var(--brand);border-radius:0 8px 8px 0;padding:1.1rem 1.4rem;margin:1.5rem 0}
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
.author-avatar{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--brand),#7c3aed);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.95rem;flex-shrink:0}
.author-info .author-name{font-weight:700;font-size:.84rem;color:var(--text)}
.author-info .author-bio{font-size:.73rem;color:var(--muted);line-height:1.5;margin-top:.1rem}
.verdict-box{background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0 8px 8px 0;padding:1rem 1.4rem;margin:1.5rem 0}
.verdict-box h3{font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#16a34a;margin-bottom:.45rem}
.verdict-box p{color:var(--text2);margin:0;font-size:.9rem}
.highlight-box{background:linear-gradient(135deg,#f5f3ff,#eef2ff);border:1px solid #c7d2fe;border-radius:var(--r);padding:1.1rem 1.4rem;margin:1.5rem 0}
@media(max-width:1024px){.article-layout{grid-template-columns:1fr}.sidebar{position:static}.articles-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:768px){.hero-grid{grid-template-columns:1fr}.hero-side{display:none}.footer-inner{grid-template-columns:1fr 1fr}.articles-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.articles-grid{grid-template-columns:1fr}.footer-inner{grid-template-columns:1fr}.nav-links{display:none}.pros-cons{grid-template-columns:1fr}.step-box{flex-direction:column;gap:.6rem}.comparison-table{font-size:.75rem}}
`;

const CARD_GRADS = [
  "linear-gradient(135deg,#4f46e5,#7c3aed)",
  "linear-gradient(135deg,#0891b2,#0e7490)",
  "linear-gradient(135deg,#059669,#16a34a)",
  "linear-gradient(135deg,#dc2626,#b91c1c)",
  "linear-gradient(135deg,#d97706,#b45309)",
  "linear-gradient(135deg,#7c3aed,#4f46e5)",
  "linear-gradient(135deg,#0e7490,#0891b2)",
];

function buildNav(siteTitle: string, clusters: SeoCluster[], rootPath = "/"): string {
  const links = clusters.slice(0, 7).map(c =>
    `<a href="/${c.slug}/">${c.name}</a>`
  ).join("");
  return `<nav>
  <div class="nav-inner">
    <a href="${rootPath}" class="nav-logo">${siteTitle}</a>
    <div class="nav-links">${links}</div>
  </div>
</nav>`;
}

function buildFooter(siteTitle: string, siteDescription: string, clusters: SeoCluster[]): string {
  const catLinks = clusters.slice(0, 6).map(c =>
    `<li><a href="/${c.slug}/">${c.name}</a></li>`
  ).join("\n");
  return `<footer>
  <div class="footer-inner">
    <div>
      <div class="footer-logo">${siteTitle}</div>
      <p class="footer-desc">${siteDescription}</p>
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
    <span>© ${new Date().getFullYear()} ${siteTitle}. Все права защищены.</span>
    <span>Создано с Craft AI</span>
  </div>
</footer>`;
}

function buildHomePage(cfg: SeoConfig): string {
  const nav = buildNav(cfg.siteTitle, cfg.clusters);
  const footer = buildFooter(cfg.siteTitle, cfg.siteDescription, cfg.clusters);

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
    <div class="hero-grad" style="background:${CARD_GRADS[0]};position:absolute;inset:0"></div>
    <div class="hero-overlay"></div>
    <div class="hero-content">
      <span class="cat-chip">${h[0].cluster.name}</span>
      <div class="hero-title">${h[0].kw.title}</div>
    </div>
  </a>` : `<div class="hero-main"><div class="hero-grad" style="background:${CARD_GRADS[0]};position:absolute;inset:0"></div><div class="hero-overlay"></div><div class="hero-content"><div class="hero-title">${cfg.siteTitle}</div></div></div>`;

  const heroSideItems = (h.length > 1 ? h.slice(1, 4) : cfg.clusters.slice(0, 3).map((c, i) => ({ kw: null as any, cluster: c, idx: i }))).map((a, i) =>
    a.kw
      ? `<a href="/${a.cluster.slug}/${a.kw.slug}/" class="hero-side-item">
          <div class="hero-grad" style="background:${CARD_GRADS[(i+1)%CARD_GRADS.length]};position:absolute;inset:0"></div>
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
      <div class="ac-img-grad" style="background:${CARD_GRADS[i%CARD_GRADS.length]};width:100%;height:100%"></div>
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
  const nav = buildNav(cfg.siteTitle, cfg.clusters);
  const footer = buildFooter(cfg.siteTitle, cfg.siteDescription, cfg.clusters);
  const done = cluster.keywords.filter(k => k.status === "done");

  const cards = done.map((k, i) => `<a href="/${cluster.slug}/${k.slug}/" class="article-card">
    <div class="ac-img-wrap">
      <div class="ac-img-grad" style="background:${CARD_GRADS[i % CARD_GRADS.length]};width:100%;height:100%"></div>
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
  const nav = buildNav(cfg.siteTitle, cfg.clusters);
  const footer = buildFooter(cfg.siteTitle, cfg.siteDescription, cfg.clusters);
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
  images: string[],
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

  const prompt = `You are a world-class SEO content writer. Write ONLY the inner article HTML fragment — NO <!DOCTYPE>, NO <html>, NO <head>, NO <nav>, NO <footer>, NO <body>.

KEYWORD: "${kw.keyword}"
TITLE (H1): "${kw.title}"
CATEGORY: "${cluster.name}"
SITE: "${cfg.siteTitle}" — ${cfg.siteDescription}

${contentTypeBlock}

CONTENT QUALITY (write in the same language as the keyword):
- 2000-2800 genuinely informative words — no filler, every sentence adds real value
- Hook from sentence one: surprising fact, bold statement, or relatable problem
- Real statistics, concrete examples, named tools/brands where relevant
- Write with authority and warmth — expert talking to a smart friend
- Exactly 3 images: <img src="IMG_PLACEHOLDER_1" alt="[vivid, keyword-rich description]" class="article-img" loading="lazy"> (also IMG_PLACEHOLDER_2 and IMG_PLACEHOLDER_3 placed naturally in article body)
- 5 FAQ pairs in collapsible structure

INTERNAL LINKS (use naturally in body text):
${relatedLinks || "(none yet)"}

OUTPUT EXACTLY THIS STRUCTURE (no outer wrappers, no page-level tags):
<div class="article-header">
  <h1>${kw.title}</h1>
  <div class="article-meta">
    <span class="tag">${cluster.name}</span>
    <span class="reading-time">⏱ ~[N] мин чтения</span>
    <span>Обновлено: ${today}</span>
  </div>
</div>
<img src="IMG_PLACEHOLDER_1" alt="[hero description]" class="hero-article-img" loading="lazy">
[key-takeaways box if applicable]
[toc if guide/tutorial/listicle]
<div class="article-body">
  [full content with h2 sections, blockquotes, IMG_PLACEHOLDER_2 and IMG_PLACEHOLDER_3 placed naturally; link to internal URLs where relevant]
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

Output ONLY the HTML fragment above — no markdown, no explanations, no page-level tags.`;

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

  // Replace image placeholders with real URLs
  if (images[0]) articleContent = articleContent.replace(/IMG_PLACEHOLDER_1/g, images[0]);
  if (images[1]) articleContent = articleContent.replace(/IMG_PLACEHOLDER_2/g, images[1]);
  if (images[2]) articleContent = articleContent.replace(/IMG_PLACEHOLDER_3/g, images[2] || images[0]);
  // Fallback for any remaining placeholders
  articleContent = articleContent.replace(/IMG_PLACEHOLDER_\d+/g, "https://placehold.co/800x450/e5e7eb/6b7280?text=Image");

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

  const nav = buildNav(cfg.siteTitle, cfg.clusters);
  const footer = buildFooter(cfg.siteTitle, cfg.siteDescription, cfg.clusters);
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

    const { keywords, niche } = req.body as { keywords: string[]; niche?: string };
    if (!keywords || keywords.length === 0) return res.status(400).json({ message: "keywords required" });

    const limited = keywords.slice(0, 1000).map(k => k.trim()).filter(Boolean);
    const siteNiche = niche || (proj.seoConfig?.niche) || proj.title;

    await storage.updateProject(proj.id, {
      seoConfig: { ...(proj.seoConfig as SeoConfig), status: "analyzing", rawKeywords: limited, niche: siteNiche },
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
      const updatedConfig: SeoConfig = {
        niche: siteNiche,
        rawKeywords: limited,
        clusters,
        siteTitle: parsed.siteTitle || proj.title,
        siteDescription: parsed.siteDescription || siteNiche,
        status: "idle",
        pagesTotal: totalPages,
        pagesGenerated: 0,
      };

      await storage.updateProject(proj.id, { seoConfig: updatedConfig } as any);
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

    // Ensure site CSS is saved
    await storage.upsertProjectFile({ projectId: proj.id, filename: "assets/style.css", code: SITE_CSS });

    let generated = 0;
    const allClusters = cfg.clusters;

    send({ type: "start", total: cfg.pagesTotal });

    for (const cluster of allClusters) {
      if (aborted || creditsDepleted) break;

      for (const kw of cluster.keywords) {
        if (aborted || creditsDepleted) break;
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

        // ── Generate images (non-fatal — fallback to empty) ──
        let images: string[] = ["", "", ""];
        try {
          const imgPrompt = (i: number) =>
            `Professional photo for article "${kw.title}" about ${cluster.name}, ${cfg.niche}, image ${i + 1} of 3, photorealistic`;
          const [img1, img2, img3] = await Promise.all([
            generateImage(imgPrompt(0)),
            generateImage(imgPrompt(1)),
            generateImage(imgPrompt(2)),
          ]);
          images = [img1 || "", img2 || "", img3 || ""];
        } catch (imgErr: any) {
          console.warn(`[SEO] Images failed for "${kw.keyword}" (continuing):`, imgErr?.message);
        }

        // ── Generate article HTML with 1 automatic retry ──
        let html = "";
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            html = await generateArticleHtml(kw, cluster, cfg, allClusters, images);
            if (html) break; // success
          } catch (artErr: any) {
            console.warn(`[SEO] Article attempt ${attempt} failed for "${kw.keyword}":`, artErr?.message);
            if (attempt === 2) html = ""; // give up after 2 tries
          }
        }

        if (!html) {
          // Refund credits, write fallback placeholder so URL always exists
          if (!ded.alreadyProcessed) { try { await storage.refundCredits(userId, SEO_ARTICLE_COST); } catch {} }
          const fallback = buildFallbackArticle(kw, cluster, { ...cfg, clusters: allClusters });
          await storage.upsertProjectFile({ projectId: proj.id, filename, code: fallback });
          kw.status = "done"; kw.filename = filename; // "done" so it's counted and site stays complete
          generated++;
          send({ type: "page_done", keyword: kw.keyword, status: "fallback", generated, total: cfg.pagesTotal });
        } else {
          await storage.upsertProjectFile({ projectId: proj.id, filename, code: html });
          kw.status = "done"; kw.filename = filename;
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

  // POST /api/seo/:id/publish — deploy to Netlify
  app.post("/api/seo/:id/publish", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const proj = await storage.getProject(parseInt(req.params.id));
    if (!proj || proj.userId !== userId) return res.status(404).json({ message: "Not found" });

    const files = await storage.getProjectFiles(proj.id);
    if (files.length === 0) return res.status(400).json({ message: "No pages generated yet" });

    const cfg = proj.seoConfig as SeoConfig;
    const baseUrl = `https://craft-ai-seo-${proj.id}.netlify.app`;

    // Generate final sitemap before deploy
    const sitemapContent = buildSitemap(cfg, baseUrl);
    const sitemapFile = files.find(f => f.filename === "sitemap.xml");
    if (!sitemapFile) {
      await storage.upsertProjectFile({ projectId: proj.id, filename: "sitemap.xml", code: sitemapContent });
    }

    const allFiles = await storage.getProjectFiles(proj.id);
    const deployFiles = allFiles.map(f => ({ filename: f.filename, content: f.code }));

    try {
      const { url, netlifyProjectId } = await deployToNetlify(proj.id, deployFiles);
      const finalUrl = url;

      const updatedCfg: SeoConfig = { ...cfg, publishUrl: finalUrl };
      await storage.updateProject(proj.id, {
        publishedUrl: finalUrl,
        publishStatus: "published",
        vercelProjectId: netlifyProjectId,
        seoConfig: updatedCfg,
      } as any);

      res.json({ url: finalUrl });
    } catch (e: any) {
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
    const file = await storage.getProjectFile(proj.id, filename);
    if (!file) return res.status(404).json({ message: "File not found" });
    const ct = filename.endsWith(".css") ? "text/css" : filename.endsWith(".txt") ? "text/plain" : "text/html";
    res.type(ct).send(file.code);
  });
}
