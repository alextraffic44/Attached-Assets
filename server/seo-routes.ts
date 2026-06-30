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

const SITE_CSS = `/* Craft AI SEO — Generated Site */
:root{--brand:#4f46e5;--brand-light:#6366f1;--text:#1a1a2e;--text2:#4a4a6a;--muted:#8888aa;--bg:#fff;--bg2:#f8f8fc;--border:#e8e8f0;--shadow:0 2px 12px rgba(0,0,0,.08);--r:12px;--w:820px;--nh:64px}
*{margin:0;padding:0;box-sizing:border-box}html{scroll-behavior:smooth}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.8}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
img{max-width:100%;height:auto;border-radius:var(--r)}
nav{position:sticky;top:0;z-index:100;background:rgba(255,255,255,.95);backdrop-filter:blur(8px);border-bottom:1px solid var(--border);height:var(--nh);display:flex;align-items:center}
.nav-inner{max-width:var(--w);margin:0 auto;padding:0 1.5rem;width:100%;display:flex;align-items:center;gap:1.5rem}
.nav-logo{font-weight:700;font-size:1.1rem;color:var(--text);text-decoration:none}
.nav-links{display:flex;gap:1.25rem;flex-wrap:wrap;margin-left:auto}
.nav-links a{font-size:.875rem;color:var(--text2);font-weight:500}
.breadcrumb{max-width:var(--w);margin:1.25rem auto 0;padding:0 1.5rem;display:flex;gap:.5rem;align-items:center;font-size:.8rem;color:var(--muted);flex-wrap:wrap}
.breadcrumb a{color:var(--muted)}.breadcrumb .sep{opacity:.5}.breadcrumb .cur{color:var(--text2)}
.article-container{max-width:var(--w);margin:0 auto;padding:2rem 1.5rem 4rem}
.article-header{margin-bottom:2rem}
.article-header h1{font-size:clamp(1.75rem,4vw,2.4rem);font-weight:800;letter-spacing:-.03em;line-height:1.25;margin-bottom:.75rem}
.article-meta{font-size:.85rem;color:var(--muted);display:flex;gap:1.25rem;align-items:center;flex-wrap:wrap}
.article-meta .tag{background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:.2rem .75rem;color:var(--brand);font-weight:600;font-size:.78rem}
.article-body{font-size:1.0625rem}
.article-body h2{font-size:1.45rem;font-weight:700;letter-spacing:-.02em;margin:2.5rem 0 1rem;line-height:1.3}
.article-body h3{font-size:1.15rem;font-weight:600;margin:1.75rem 0 .75rem}
.article-body p{margin-bottom:1.25rem;color:var(--text2)}
.article-body ul,.article-body ol{margin:1rem 0 1.5rem 1.5rem;color:var(--text2)}
.article-body li{margin-bottom:.5rem}
.article-body strong{color:var(--text);font-weight:600}
.article-body blockquote{border-left:3px solid var(--brand);padding:1rem 1.5rem;background:var(--bg2);border-radius:0 var(--r) var(--r) 0;margin:1.5rem 0;color:var(--text2);font-style:italic}
.article-img{width:100%;border-radius:var(--r);margin:1.75rem 0;box-shadow:var(--shadow);display:block;object-fit:cover;max-height:460px}
.highlight-box{background:linear-gradient(135deg,#f0f0ff,#e8f0ff);border:1px solid #d0d8ff;border-radius:var(--r);padding:1.5rem;margin:2rem 0}
.faq-section{margin-top:3rem;padding-top:2rem;border-top:1px solid var(--border)}
.faq-section>h2{font-size:1.5rem;font-weight:700;margin-bottom:1.5rem}
.faq-item{border:1px solid var(--border);border-radius:var(--r);margin-bottom:.75rem;overflow:hidden}
.faq-question{padding:1rem 1.25rem;font-weight:600;font-size:1rem;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:var(--bg2);color:var(--text)}
.faq-question:hover{background:#f0f0f8}.faq-answer{padding:1rem 1.25rem;color:var(--text2);line-height:1.7;border-top:1px solid var(--border)}
.related-articles{margin-top:3rem;padding-top:2rem;border-top:1px solid var(--border)}
.related-articles>h2{font-size:1.35rem;font-weight:700;margin-bottom:1.25rem}
.related-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem}
.related-card{border:1px solid var(--border);border-radius:var(--r);padding:1.25rem;transition:all .2s;color:var(--text);background:var(--bg);display:block}
.related-card:hover{border-color:var(--brand-light);box-shadow:var(--shadow);transform:translateY(-2px);text-decoration:none}
.related-card .rc-cat{font-size:.75rem;color:var(--brand);font-weight:600;margin-bottom:.4rem;text-transform:uppercase;letter-spacing:.05em}
.related-card .rc-title{font-size:.95rem;font-weight:600;line-height:1.4}
.articles-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.25rem}
.article-card{border:1px solid var(--border);border-radius:var(--r);padding:1.5rem;transition:all .2s;display:block;color:var(--text);background:var(--bg)}
.article-card:hover{border-color:var(--brand-light);box-shadow:var(--shadow);transform:translateY(-2px);text-decoration:none}
.article-card .ac-cat{font-size:.75rem;color:var(--brand);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem}
.article-card h2{font-size:1.1rem;font-weight:700;line-height:1.35;margin-bottom:.6rem}
.article-card p{font-size:.875rem;color:var(--text2);line-height:1.5}
.article-card .ac-read{margin-top:1rem;font-size:.8rem;font-weight:600;color:var(--brand)}
.home-hero{padding:4rem 1.5rem 3rem;text-align:center;background:linear-gradient(180deg,var(--bg),var(--bg2))}
.home-hero h1{font-size:clamp(2rem,5vw,3rem);font-weight:900;letter-spacing:-.04em;margin-bottom:1rem}
.home-hero p{font-size:1.15rem;color:var(--text2);max-width:520px;margin:0 auto 2.5rem}
.categories-grid{max-width:900px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.25rem}
.category-card{border:1px solid var(--border);border-radius:var(--r);padding:1.75rem 1.5rem;transition:all .2s;display:block;color:var(--text);background:var(--bg)}
.category-card:hover{border-color:var(--brand-light);box-shadow:var(--shadow);transform:translateY(-2px);text-decoration:none}
.category-card .cc-icon{font-size:1.75rem;margin-bottom:.75rem}
.category-card h2{font-size:1.15rem;font-weight:700;margin-bottom:.4rem}
.category-card p{font-size:.875rem;color:var(--text2);line-height:1.5}
.category-card .cc-count{margin-top:.75rem;font-size:.8rem;color:var(--brand);font-weight:600}
.page-container{max-width:var(--w);margin:0 auto;padding:2rem 1.5rem 4rem}
.page-header{margin-bottom:2.5rem}.page-header h1{font-size:clamp(1.75rem,4vw,2.4rem);font-weight:800;letter-spacing:-.03em;margin-bottom:.75rem}
.page-header p{font-size:1.05rem;color:var(--text2);max-width:600px}
footer{background:var(--bg2);border-top:1px solid var(--border);padding:3rem 1.5rem;margin-top:4rem}
.footer-inner{max-width:var(--w);margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr;gap:2rem}
.footer-logo{font-weight:800;font-size:1.1rem;color:var(--text);margin-bottom:.5rem}
.footer-desc{font-size:.875rem;color:var(--muted);line-height:1.6}
.footer-col h4{font-size:.875rem;font-weight:700;margin-bottom:1rem}
.footer-col ul{list-style:none}.footer-col li{margin-bottom:.5rem}
.footer-col a{font-size:.875rem;color:var(--muted)}.footer-col a:hover{color:var(--brand)}
.footer-bottom{max-width:var(--w);margin:2rem auto 0;padding-top:1.5rem;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem}
.footer-bottom p{font-size:.8rem;color:var(--muted)}
@media(max-width:640px){.footer-inner{grid-template-columns:1fr}.nav-links{display:none}.article-body h2{font-size:1.25rem}.home-hero h1{font-size:1.75rem}}
/* ── Key Takeaways / TL;DR ── */
.key-takeaways{background:linear-gradient(135deg,#f0f0ff,#eaf0ff);border:1px solid #c8d0ff;border-left:4px solid var(--brand);border-radius:var(--r);padding:1.5rem 1.75rem;margin:1.75rem 0}
.key-takeaways h3{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--brand);margin-bottom:.875rem}
.key-takeaways ul{margin:0;padding-left:1.25rem;color:var(--text2)}.key-takeaways li{margin-bottom:.5rem;font-size:.975rem}
/* ── Table of Contents ── */
.toc{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:1.25rem 1.5rem;margin:1.75rem 0}
.toc-title{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:.875rem}
.toc ol{margin:0;padding-left:1.25rem;counter-reset:none}.toc li{margin-bottom:.4rem}
.toc a{font-size:.925rem;color:var(--text2);text-decoration:none;font-weight:500}.toc a:hover{color:var(--brand)}
/* ── Reading time ── */
.reading-time{display:inline-flex;align-items:center;gap:.35rem;font-size:.8rem;color:var(--muted);font-weight:500}
/* ── Step boxes (tutorials) ── */
.step-box{display:flex;gap:1.25rem;margin:2rem 0;padding:1.5rem;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r)}
.step-num{flex-shrink:0;width:2rem;height:2rem;border-radius:50%;background:var(--brand);color:#fff;font-weight:800;font-size:.9rem;display:flex;align-items:center;justify-content:center}
.step-content h3{font-size:1.05rem;font-weight:700;margin-bottom:.5rem;color:var(--text)}.step-content p{color:var(--text2);margin:0}
/* ── Comparison table ── */
.comparison-table{width:100%;border-collapse:collapse;margin:2rem 0;font-size:.9rem;border-radius:var(--r);overflow:hidden;box-shadow:var(--shadow)}
.comparison-table th{background:var(--brand);color:#fff;padding:.875rem 1rem;text-align:left;font-weight:700}
.comparison-table td{padding:.75rem 1rem;border-bottom:1px solid var(--border)}.comparison-table tr:last-child td{border-bottom:none}
.comparison-table tr:nth-child(even) td{background:var(--bg2)}.comparison-table .ct-winner{color:var(--brand);font-weight:700}
/* ── Pros / Cons ── */
.pros-cons{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:2rem 0}
.pros-cons .pros,.pros-cons .cons{padding:1.25rem 1.5rem;border-radius:var(--r)}.pros-cons .pros{background:#f0fff8;border:1px solid #b6e8ce}
.pros-cons .cons{background:#fff5f5;border:1px solid #f5c5c5}
.pros-cons h4{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.75rem}
.pros-cons .pros h4{color:#087f5b}.pros-cons .cons h4{color:#c92a2a}
.pros-cons ul{margin:0;padding-left:1.1rem;font-size:.9rem;color:var(--text2)}.pros-cons li{margin-bottom:.4rem}
/* ── Author box (E-E-A-T) ── */
.author-box{display:flex;gap:1.25rem;align-items:center;margin:3rem 0 1.5rem;padding:1.5rem;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r)}
.author-avatar{width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--brand),#7c3aed);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.25rem;flex-shrink:0}
.author-info .author-name{font-weight:700;font-size:.95rem;color:var(--text);margin-bottom:.25rem}
.author-info .author-bio{font-size:.8rem;color:var(--muted);line-height:1.5}
/* ── Verdict box ── */
.verdict-box{background:linear-gradient(135deg,#fafafa,#f5f5ff);border:1px solid var(--border);border-left:4px solid #22c55e;border-radius:var(--r);padding:1.5rem 1.75rem;margin:2rem 0}
.verdict-box h3{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#16a34a;margin-bottom:.75rem}
@media(max-width:640px){.pros-cons{grid-template-columns:1fr}.step-box{flex-direction:column;gap:.75rem}.comparison-table{font-size:.8rem}}
`;

function buildNav(siteTitle: string, clusters: SeoCluster[], rootPath = "/"): string {
  const links = clusters.slice(0, 5).map(c =>
    `<a href="/${c.slug}/">${c.name}</a>`
  ).join("\n        ");
  return `<nav>
  <div class="nav-inner">
    <a href="${rootPath}" class="nav-logo">${siteTitle}</a>
    <div class="nav-links">${links}</div>
  </div>
</nav>`;
}

function buildFooter(siteTitle: string, siteDescription: string, clusters: SeoCluster[]): string {
  const catLinks = clusters.slice(0, 5).map(c =>
    `<li><a href="/${c.slug}/">${c.name}</a></li>`
  ).join("\n        ");
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
    <p>© ${new Date().getFullYear()} ${siteTitle}. Все права защищены.</p>
  </div>
</footer>`;
}

function buildHomePage(cfg: SeoConfig): string {
  const nav = buildNav(cfg.siteTitle, cfg.clusters);
  const footer = buildFooter(cfg.siteTitle, cfg.siteDescription, cfg.clusters);
  const cards = cfg.clusters.map(c => {
    const count = c.keywords.filter(k => k.status === "done").length;
    const icon = "📄";
    return `<a href="/${c.slug}/" class="category-card">
      <div class="cc-icon">${icon}</div>
      <h2>${c.name}</h2>
      <p>${c.description}</p>
      <div class="cc-count">${count} статей</div>
    </a>`;
  }).join("\n    ");

  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: cfg.siteTitle,
    description: cfg.siteDescription,
  });

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${cfg.siteTitle}</title>
<meta name="description" content="${cfg.siteDescription}">
<meta property="og:title" content="${cfg.siteTitle}">
<meta property="og:description" content="${cfg.siteDescription}">
<link rel="stylesheet" href="/assets/style.css">
<script type="application/ld+json">${schema}</script>
</head>
<body>
${nav}
<section class="home-hero">
  <h1>${cfg.siteTitle}</h1>
  <p>${cfg.siteDescription}</p>
</section>
<div style="padding:0 1.5rem 4rem">
  <div class="categories-grid">
    ${cards}
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
  const cards = done.map(k => `<a href="/${cluster.slug}/${k.slug}/" class="article-card">
      <div class="ac-cat">${cluster.name}</div>
      <h2>${k.title}</h2>
      <div class="ac-read">Читать →</div>
    </a>`).join("\n    ");

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

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${cluster.name} | ${cfg.siteTitle}</title>
<meta name="description" content="${cluster.description}">
<link rel="stylesheet" href="/assets/style.css">
<link rel="canonical" href="/${cluster.slug}/">
<script type="application/ld+json">${schema}</script>
</head>
<body>
${nav}
<div class="breadcrumb">
  <a href="/">Главная</a><span class="sep">›</span><span class="cur">${cluster.name}</span>
</div>
<div class="page-container">
  <div class="page-header">
    <h1>${cluster.name}</h1>
    <p>${cluster.description}</p>
  </div>
  <div class="articles-grid">
    ${cards}
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
  const relatedLinks = allClusters
    .flatMap(c => c.keywords.filter(k => k.slug !== kw.slug && k.status === "done").slice(0, 3).map(k => `/${c.slug}/${k.slug}/ — ${k.title}`))
    .slice(0, 6)
    .join("\n");

  const contentTypeBlock = getContentTypeInstructions(kw.contentType, kw.keyQuestions);

  const prompt = `You are a world-class SEO content writer. Write an engaging, deeply informative HTML article.

KEYWORD: "${kw.keyword}"
TITLE (H1): "${kw.title}"
CATEGORY: "${cluster.name}"
SITE: "${cfg.siteTitle}" — ${cfg.siteDescription}

${contentTypeBlock}

CONTENT QUALITY RULES (write in the same language as the keyword):
- 2000-2800 genuinely informative words — NO filler, every sentence adds value
- Hook readers from sentence one: surprising fact, bold statement, or relatable problem
- Use real statistics, named examples, and concrete numbers where possible
- Write with authority and warmth — like an expert explaining to a smart friend
- Use <span class="reading-time">⏱ ~X min read</span> in article-meta (estimate from word count)
- Include exactly 3 image tags at natural positions: <img src="IMG_PLACEHOLDER_1" alt="[vivid, keyword-rich description]" class="article-img"> (also IMG_PLACEHOLDER_2 and IMG_PLACEHOLDER_3)
- FAQ section with 5 question-answer pairs (collapsible .faq-item structure)

INTERNAL LINKS (use these hrefs naturally within body text):
${relatedLinks || "(none yet — site is new)"}

REQUIRED HTML STRUCTURE (output complete <!DOCTYPE html>, NO markdown fences):
<head>: charset, viewport, canonical, <title>${kw.title} | ${cfg.siteTitle}</title>, <meta name="description" content="[150-160 chars, compelling]">, OG/Twitter tags, <link rel="stylesheet" href="/assets/style.css">
Schema.org JSON-LD: Article (with author, datePublished) + FAQPage + BreadcrumbList
<body>:
  <nav> with site logo + category links
  <div class="breadcrumb">… › ${cluster.name} › ${kw.title}</div>
  <div class="article-container">
    <article>
      <div class="article-header">
        <h1>${kw.title}</h1>
        <div class="article-meta">
          <span class="tag">${cluster.name}</span>
          <span class="reading-time">⏱ ~X min read</span>
          <span>Updated: ${new Date().toLocaleDateString("ru-RU")}</span>
        </div>
      </div>
      [key-takeaways box, toc if applicable]
      <div class="article-body">[main content]</div>
      [author-box]
      <div class="faq-section">…</div>
      <div class="related-articles"><div class="related-grid">…</div></div>
    </article>
  </div>
  <footer>…</footer>
  <script>FAQ toggle + smooth scroll for TOC links</script>

Output ONLY clean HTML — no markdown, no explanation text.`;

  let html = "";
  try {
    html = await kieSync([
      { role: "system", content: "You are an expert SEO content writer. Output only clean HTML without any markdown fences or explanation." },
      { role: "user", content: prompt },
    ], 240000);
    html = cleanHtml(html);
  } catch (e: any) {
    console.warn(`[SEO] Article gen failed for ${kw.keyword}:`, e?.message);
    return "";
  }

  // Replace image placeholders with actual URLs
  images.forEach((url, i) => {
    if (url) html = html.replace(`IMG_PLACEHOLDER_${i + 1}`, url);
  });
  // Remove unfilled placeholders
  html = html.replace(/IMG_PLACEHOLDER_\d+/g, "https://placehold.co/820x460/e8e8f0/4a4a6a?text=Image");

  return html;
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
      ], 240000);

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
    req.on("close", () => { aborted = true; });

    // Ensure site CSS is saved
    await storage.upsertProjectFile({ projectId: proj.id, filename: "assets/style.css", code: SITE_CSS });

    let generated = 0;
    const allClusters = cfg.clusters;

    send({ type: "start", total: cfg.pagesTotal });

    for (const cluster of allClusters) {
      if (aborted) break;
      for (const kw of cluster.keywords) {
        if (aborted) break;
        if (kw.status === "done") { generated++; continue; }

        send({ type: "progress", keyword: kw.keyword, status: "generating", generated, total: cfg.pagesTotal });

        // Deduct credits
        const ikey = `seo-article-${proj.id}-${kw.id}`;
        const ded = await storage.deductCredits(userId, SEO_ARTICLE_COST, "seo-article", ikey);
        if (!ded.success) {
          send({ type: "error", message: "Недостаточно токенов", generated, total: cfg.pagesTotal });
          kw.status = "failed";
          break;
        }

        try {
          // Generate 3 images in parallel
          const imgPrompt = (i: number) =>
            `High quality professional photo for article "${kw.title}" about ${cluster.name}, ${cfg.niche}, image ${i + 1} of 3, photorealistic, clean, modern`;
          const [img1, img2, img3] = await Promise.all([
            generateImage(imgPrompt(0)),
            generateImage(imgPrompt(1)),
            generateImage(imgPrompt(2)),
          ]);
          const images = [img1 || "", img2 || "", img3 || ""];

          // Generate article HTML
          const html = await generateArticleHtml(kw, cluster, cfg, allClusters, images);
          if (!html) {
            if (!ded.alreadyProcessed) await storage.refundCredits(userId, SEO_ARTICLE_COST);
            kw.status = "failed";
            send({ type: "page_done", keyword: kw.keyword, status: "failed", generated, total: cfg.pagesTotal });
            continue;
          }

          const filename = `${cluster.slug}/${kw.slug}/index.html`;
          await storage.upsertProjectFile({ projectId: proj.id, filename, code: html });

          kw.status = "done";
          kw.filename = filename;
          generated++;
        } catch (e: any) {
          console.warn(`[SEO] Failed article ${kw.keyword}:`, e?.message);
          if (!ded.alreadyProcessed) {
            try { await storage.refundCredits(userId, SEO_ARTICLE_COST); } catch {}
          }
          kw.status = "failed";
        }

        // Update config in DB after each page
        const updatedCfg: SeoConfig = { ...cfg, clusters: allClusters, pagesGenerated: generated };
        await storage.updateProject(proj.id, { seoConfig: updatedCfg } as any);

        send({ type: "page_done", keyword: kw.keyword, status: kw.status, generated, total: cfg.pagesTotal });
      }

      // Generate category page after all articles in cluster are done
      if (!aborted) {
        const catHtml = buildCategoryPage(cluster, { ...cfg, clusters: allClusters });
        await storage.upsertProjectFile({ projectId: proj.id, filename: `${cluster.slug}/index.html`, code: catHtml });
      }
    }

    // Generate homepage + sitemap
    if (!aborted) {
      const finalCfg: SeoConfig = { ...cfg, clusters: allClusters, pagesGenerated: generated, status: "done" };
      const homeHtml = buildHomePage(finalCfg);
      await storage.upsertProjectFile({ projectId: proj.id, filename: "index.html", code: homeHtml });
      await storage.upsertProjectFile({ projectId: proj.id, filename: "robots.txt", code: `User-agent: *\nAllow: /\nSitemap: /sitemap.xml` });
      await storage.updateProject(proj.id, { seoConfig: finalCfg, generatedCode: homeHtml } as any);
      send({ type: "done", generated, total: cfg.pagesTotal });
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
    res.type("text/html").send(file.code);
  });
}
