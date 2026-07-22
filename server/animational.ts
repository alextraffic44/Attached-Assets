import {
  withKieCallback,
  waitForKieJob,
  kieResultUrl,
} from "./kie-jobs";

/**
 * «Анимационный» mode — award-style motion sites (Viktor Oddy / Awwwards DNA).
 *
 * Own pipeline (not SCROLLANIM / not master SYSTEM_PROMPT):
 *   structured {{ANIMATIONAL:...}} marker
 *   → parallel KIE stills (nano-banana-2)
 *   → self-contained HTML (loader, dual-hero morph, marquee, sticky chapters,
 *      horizontal gallery, magnetic CTA, custom cursor, smooth scroll)
 */
export const SCROLL_ANIMATIONAL_COST = 180;

export type AniText = { title: string; sub: string; imagePrompt?: string };

export type AnimationalBrief = {
  brand: string;
  tagline: string;
  accent: string;
  bg: string;
  ink: string;
  heroBase: string;
  heroReveal: string;
  marquee: string[];
  chapters: AniText[];
  cta: string;
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
};

const STILL_MODEL = "nano-banana-2";
const STILL_DEADLINE_MS = 3 * 60 * 1000;
const MAX_STILL_ATTEMPTS = 3;

/** Dedicated system prompt — replaces master SYSTEM_PROMPT entirely. */
export const ANIMATIONAL_SYSTEM_PROMPT = `Ты — креативный директор премиальных анимационных сайтов (уровень Awwwards / Viktor Oddy).
Твоя задача: по запросу пользователя собрать ОДИН маркер {{ANIMATIONAL:...}} и обернуть его в минимальный валидный HTML.

⛔ ЗАПРЕЩЕНО:
- Писать hero / секции / canvas / CSS-анимации вручную
- Использовать {{SCROLLANIM:}} или {{GENIMG:}}
- Копировать «стандартный» лендинг с карточками услуг
- Добавлять фиолетовые градиенты, Inter/Roboto/Arial, emoji

✅ ОБЯЗАТЕЛЬНО:
Сразу после <body> (или после пустого <header> только с логотипом бренда) одна строка:

{{ANIMATIONAL:BRAND|TAGLINE_RU|ACCENT_HEX|BG_HEX|INK_HEX|HERO_BASE_EN /// HERO_REVEAL_EN|MQ1_EN,MQ2_EN,MQ3_EN,MQ4_EN,MQ5_EN,MQ6_EN|CH1_TITLE::CH1_BODY::CH1_IMG_EN||CH2_TITLE::CH2_BODY::CH2_IMG_EN||CH3_TITLE::CH3_BODY::CH3_IMG_EN||CH4_TITLE::CH4_BODY::CH4_IMG_EN|CTA_RU}}

Правила полей:
- BRAND — короткое имя бренда
- TAGLINE_RU — одна мощная фраза на русском
- ACCENT_HEX / BG_HEX / INK_HEX — цвета (#rrggbb), контрастная палитра под нишу (НЕ фиолетовый дефолт)
- HERO_BASE_EN /// HERO_REVEAL_EN — две АНГЛИЙСКИЕ сцены одной композиции (Ч/Б или night → цветной day / metamorphosis). Разделитель строго " /// "
- MQ1…MQ6 — 6 коротких EN-промптов для бесконечного марquee (атмосфера ниши)
- 4 главы: Заголовок::текст на русском::EN image prompt (кинематографичный кадр главы)
- CTA_RU — текст кнопки

После маркера — только </body></html>. Никакого другого контента.

Примеры настроения (адаптируй под нишу пользователя):
- Кофейня: bg #12100E, ink #F2EDE6, accent #D4A574
- Архитектура: bg #0B0B0C, ink #F5F2EC, accent #A8B5C4
- Фитнес: bg #0A0A0A, ink #FFFFFF, accent #E8FF47
- Клиника: bg #0F1412, ink #E8F0ED, accent #3DDC97
- Недвижимость: bg #0C0E12, ink #F4F1EC, accent #C9A227

Вывод — один файл index.html:
--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>BRAND</title></head>
<body>
<header style="display:none" aria-hidden="true">BRAND</header>
{{ANIMATIONAL:...}}
</body>
</html>
\`\`\`
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

function hexOr(v: string, fallback: string): string {
  const m = String(v || "").trim().match(/^#?[0-9a-fA-F]{6}$/);
  if (!m) return fallback;
  return m[0].startsWith("#") ? m[0] : `#${m[0]}`;
}

export function parseAnimationalMarker(inner: string): AnimationalBrief {
  const parts = inner.split("|").map((p) => p.trim());
  const brand = parts[0] || "Studio";
  const tagline = parts[1] || "Создаём впечатления";
  const accent = hexOr(parts[2], "#E8FF47");
  const bg = hexOr(parts[3], "#0B0B0C");
  const ink = hexOr(parts[4], "#F5F2EC");
  const heroRaw = parts[5] || "cinematic brand hero, centered /// same scene in vivid color reveal";
  let heroBase = heroRaw;
  let heroReveal = heroRaw;
  for (const sep of [" /// ", " ::: ", " → ", " -> "]) {
    const i = heroRaw.indexOf(sep);
    if (i > 8) {
      heroBase = heroRaw.slice(0, i).trim();
      heroReveal = heroRaw.slice(i + sep.length).trim();
      break;
    }
  }
  const marquee = (parts[6] || "")
    .split(",")
    .map((s) => cleanEn(s))
    .filter((s) => s.length > 6)
    .slice(0, 6);
  while (marquee.length < 4) {
    marquee.push(`premium atmospheric ${cleanEn(brand) || "brand"} scene ${marquee.length + 1}, cinematic still`);
  }
  const chapters: AniText[] = (parts[7] || "")
    .split("||")
    .map((seg) => {
      const [title, sub, imagePrompt] = seg.split("::");
      return {
        title: (title || "").trim(),
        sub: (sub || "").trim(),
        imagePrompt: cleanEn(imagePrompt || "") || undefined,
      };
    })
    .filter((c) => c.title || c.sub)
    .slice(0, 4);
  while (chapters.length < 3) {
    chapters.push({
      title: ["Атмосфера", "Детали", "Результат", "Ваш ход"][chapters.length],
      sub: tagline,
      imagePrompt: `cinematic ${cleanEn(brand)} chapter ${chapters.length + 1}, editorial photography`,
    });
  }
  const cta = parts[8] || "Обсудить проект";
  return {
    brand,
    tagline,
    accent,
    bg,
    ink,
    heroBase: cleanEn(heroBase) || "cinematic brand hero subject, editorial still",
    heroReveal: cleanEn(heroReveal) || "same composition vivid color metamorphosis reveal",
    marquee,
    chapters,
    cta,
  };
}

async function reuploadStable(deps: GenerateAnimationalDeps, cdnUrl: string): Promise<string> {
  try {
    const imgResp = await fetch(cdnUrl, { signal: AbortSignal.timeout(25000) });
    if (imgResp.ok) {
      const imgBuf = Buffer.from(await imgResp.arrayBuffer());
      const relUrl = await deps.uploadToObjectStorage(imgBuf, "image/jpeg", "jpg");
      return `${deps.appBaseUrl}${relUrl}`;
    }
  } catch (e: any) {
    console.warn("[ANI] re-upload failed:", e?.message);
  }
  return cdnUrl;
}

async function createStill(
  deps: GenerateAnimationalDeps,
  prompt: string,
  label: string,
): Promise<string | null> {
  if (!deps.kieApiKey) return null;
  for (let attempt = 0; attempt < MAX_STILL_ATTEMPTS; attempt++) {
    if (deps.shouldStop()) return null;
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3500));
    const createBody: any = await deps.kieRequestJson(
      deps.createUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deps.kieApiKey}`,
        },
        body: JSON.stringify(withKieCallback({
          model: STILL_MODEL,
          input: {
            prompt: `${prompt}. Ultra premium commercial photography, photorealistic, no text, no watermark, no logos, 8K, 16:9`,
            aspect_ratio: "16:9",
            resolution: "2K",
          },
        })),
      },
      { label: `${label}-create`, retries: 3, shouldStop: deps.shouldStop },
    );
    if (createBody?.code !== 200 || !createBody?.data?.taskId) {
      console.warn(`[ANI] ${label} create failed:`, createBody?.msg);
      continue;
    }
    const taskId = createBody.data.taskId;
    const terminal = await waitForKieJob(taskId, {
      deadlineMs: STILL_DEADLINE_MS,
      shouldStop: deps.shouldStop,
      pollIntervalMs: 4000,
      label: `ANI ${label}`,
      pollOnce: async () => {
        const body: any = await deps.kieRequestJson(
          `${deps.statusUrl}?taskId=${taskId}`,
          { headers: { Authorization: `Bearer ${deps.kieApiKey}` } },
          { label: `${label}-poll`, retries: 2, shouldStop: () => deps.shouldStop() || false },
        );
        if (!body || body.code !== 200 || !body.data) return null;
        return body.data;
      },
    });
    if (terminal.ok) {
      const cdnUrl = kieResultUrl(terminal.data);
      if (cdnUrl) return reuploadStable(deps, cdnUrl);
    } else if (terminal.reason === "fail") {
      console.warn(`[ANI] ${label} failed:`, terminal.data?.failMsg);
    }
    // timeout / fail → retry create
  }
  return null;
}

export async function generateAnimationalSite(opts: {
  markerInner: string;
  deps: GenerateAnimationalDeps;
}): Promise<{ html: string } | null> {
  const brief = parseAnimationalMarker(opts.markerInner);
  const { deps } = opts;

  deps.onStatus?.("Анимационный: генерирую hero-пару кадров…");
  const [heroBase, heroReveal] = await Promise.all([
    createStill(deps, `${brief.heroBase}. High-contrast editorial hero, dramatic light`, "ANI hero-base"),
    createStill(deps, `${brief.heroReveal}. Vivid color brand metamorphosis, same framing`, "ANI hero-rev"),
  ]);
  if (!heroBase || !heroReveal) {
    console.warn("[ANI] hero pair failed");
    return null;
  }

  deps.onStatus?.("Анимационный: генерирую marquee и главы…");
  const mqPrompts = brief.marquee.slice(0, 6);
  const chPrompts = brief.chapters.map(
    (c, i) => c.imagePrompt || `cinematic brand chapter ${i + 1} for ${brief.brand}, editorial`,
  );

  const mqUrls: string[] = [];
  const chUrls: string[] = [];

  // Sequential batches to avoid hammering KIE (2 parallel)
  const allJobs: Array<{ kind: "mq" | "ch"; i: number; prompt: string }> = [
    ...mqPrompts.map((prompt, i) => ({ kind: "mq" as const, i, prompt })),
    ...chPrompts.map((prompt, i) => ({ kind: "ch" as const, i, prompt })),
  ];
  for (let i = 0; i < allJobs.length; i += 2) {
    if (deps.shouldStop()) return null;
    const batch = allJobs.slice(i, i + 2);
    deps.onStatus?.(`Анимационный: кадры ${i + 1}–${Math.min(i + 2, allJobs.length)} из ${allJobs.length}…`);
    const results = await Promise.all(
      batch.map((j) => createStill(deps, j.prompt, `ANI ${j.kind}${j.i}`)),
    );
    results.forEach((url, idx) => {
      const j = batch[idx];
      if (!url) return;
      if (j.kind === "mq") mqUrls[j.i] = url;
      else chUrls[j.i] = url;
    });
  }

  // Fallbacks: reuse hero if some stills failed
  for (let i = 0; i < mqPrompts.length; i++) if (!mqUrls[i]) mqUrls[i] = i % 2 ? heroReveal : heroBase;
  for (let i = 0; i < brief.chapters.length; i++) if (!chUrls[i]) chUrls[i] = heroReveal;

  const html = buildAnimationalHtml(brief, heroBase, heroReveal, mqUrls, chUrls);
  return { html };
}

export function buildAnimationalPendingHtml(brandHint?: string, markerInner?: string): string {
  const brand = esc(brandHint || "Craft AI");
  const styleAttr = ` data-scroll-anim-style="${encodeURIComponent("animational")}"`;
  const promptAttr = markerInner
    ? ` data-scroll-anim-prompt="${encodeURIComponent(markerInner.slice(0, 3500))}"`
    : "";
  return `<section data-scroll-anim-pending="1" data-animational-pending="1" data-craft-scrollanim="1" data-layout="animational"${styleAttr}${promptAttr} style="min-height:100vh;display:grid;place-items:center;background:#0B0B0C;color:#F5F2EC;font-family:system-ui,sans-serif;text-align:center;padding:40px 24px">
  <div>
    <div style="width:42px;height:42px;border:2.5px solid rgba(255,255,255,.12);border-top-color:#E8FF47;border-radius:50%;margin:0 auto 18px;animation:aniSpin .85s linear infinite"></div>
    <style>@keyframes aniSpin{to{transform:rotate(360deg)}}</style>
    <div style="font-size:.7rem;letter-spacing:.22em;text-transform:uppercase;opacity:.5;margin-bottom:10px">${brand}</div>
    <h1 style="margin:0 0 .4em;font-size:clamp(1.4rem,3.5vw,2rem);font-weight:700;letter-spacing:-.03em">Собираем анимационный сайт</h1>
    <p style="margin:0;opacity:.55;font-size:.95rem;line-height:1.5">Кадры через KIE · обычно 2–6 минут<br/>Можно закрыть вкладку — результат сохранится</p>
  </div>
</section>`;
}

/** Static fallback if KIE stills fail after retries. */
export function buildAnimationalFallbackHtml(markerInner?: string): string {
  const brief = parseAnimationalMarker(markerInner || "Studio|Создаём впечатления|#E8FF47|#0B0B0C|#F5F2EC|cinematic hero /// vivid reveal|a,b,c,d|Атмосфера::Сила в деталях::||Детали::Каждый кадр важен::||Результат::Ваш момент::|Начать");
  const brand = esc(brief.brand);
  const tagline = esc(brief.tagline);
  const accent = esc(brief.accent);
  const bg = esc(brief.bg);
  const ink = esc(brief.ink);
  const cta = esc(brief.cta);
  return `<section data-craft-scrollanim="1" data-layout="animational" data-animational="1" style="min-height:100vh;background:${bg};color:${ink};font-family:system-ui,sans-serif;display:grid;place-items:center;text-align:center;padding:48px 24px">
  <div style="max-width:640px">
    <p style="letter-spacing:.22em;text-transform:uppercase;font-size:.7rem;opacity:.5;margin:0 0 1rem">${brand}</p>
    <h1 style="margin:0 0 1rem;font-size:clamp(2rem,6vw,3.4rem);font-weight:800;letter-spacing:-.04em;line-height:1.05">${tagline}</h1>
    <p style="opacity:.6;margin:0 0 2rem;line-height:1.5">Анимация собирается. Обновите страницу или нажмите «Создать видео» ещё раз.</p>
    <a href="#contact" style="display:inline-block;padding:14px 28px;border-radius:999px;background:${accent};color:${bg};text-decoration:none;font-weight:700">${cta}</a>
  </div>
</section>`;
}

export function buildAnimationalHtml(
  brief: AnimationalBrief,
  heroBase: string,
  heroReveal: string,
  marqueeUrls: string[],
  chapterUrls: string[],
): string {
  const cid = "ani" + Math.random().toString(36).slice(2, 8);
  const brand = esc(brief.brand);
  const tagline = esc(brief.tagline);
  const accent = esc(brief.accent);
  const bg = esc(brief.bg);
  const ink = esc(brief.ink);
  const cta = esc(brief.cta);
  const hb = esc(heroBase);
  const hr = esc(heroReveal);

  const mq = [...marqueeUrls, ...marqueeUrls]
    .map((u) => `<div class="${cid}-mq__item"><img src="${esc(u)}" alt="" loading="lazy" decoding="async"/></div>`)
    .join("");

  const chapters = brief.chapters
    .map((c, i) => {
      const img = esc(chapterUrls[i] || heroReveal);
      const num = String(i + 1).padStart(2, "0");
      return `<article class="${cid}-ch" data-ch="${i}">
  <div class="${cid}-ch__media"><img src="${img}" alt="" loading="lazy"/></div>
  <div class="${cid}-ch__copy">
    <span class="${cid}-ch__num">${num}</span>
    <h2 class="${cid}-split">${esc(c.title)}</h2>
    <p>${esc(c.sub)}</p>
  </div>
</article>`;
    })
    .join("\n");

  return `
<section class="${cid}-root" data-craft-scrollanim="1" data-layout="animational" data-animational="1"
  style="--ani-bg:${bg};--ani-ink:${ink};--ani-accent:${accent}">
  <div class="${cid}-loader" aria-live="polite"><span class="${cid}-loader__n">0</span><span class="${cid}-loader__l">LOADING</span></div>
  <div class="${cid}-cursor" aria-hidden="true"></div>
  <nav class="${cid}-nav">
    <div class="${cid}-nav__brand">${brand}</div>
    <a class="${cid}-nav__cta" href="#${cid}-end">${cta}</a>
  </nav>

  <header class="${cid}-hero">
    <canvas class="${cid}-hero__canvas" aria-hidden="true"></canvas>
    <div class="${cid}-hero__veil"></div>
    <div class="${cid}-hero__copy">
      <p class="${cid}-hero__eye">${brand}</p>
      <h1 class="${cid}-split ${cid}-hero__h">${tagline}</h1>
      <p class="${cid}-hero__hint">скролл · наведение</p>
    </div>
  </header>

  <div class="${cid}-mq" aria-hidden="true"><div class="${cid}-mq__track">${mq}</div></div>

  <div class="${cid}-chapters">
${chapters}
  </div>

  <section class="${cid}-horiz" aria-label="Галерея">
    <div class="${cid}-horiz__sticky">
      <div class="${cid}-horiz__rail">
        ${chapterUrls.map((u, i) => `<figure class="${cid}-horiz__card"><img src="${esc(u)}" alt=""/><figcaption>${esc(brief.chapters[i]?.title || "")}</figcaption></figure>`).join("")}
      </div>
    </div>
  </section>

  <footer class="${cid}-end" id="${cid}-end">
    <h2 class="${cid}-split">${tagline}</h2>
    <a class="${cid}-magnet" href="#${cid}-end"><span>${cta}</span></a>
    <p class="${cid}-end__brand">${brand}</p>
  </footer>
</section>
<style>
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Instrument+Sans:wght@400;500;600&display=swap');
.${cid}-root{--ani-bg:${bg};--ani-ink:${ink};--ani-accent:${accent};background:var(--ani-bg);color:var(--ani-ink);font-family:'Instrument Sans',system-ui,sans-serif;position:relative;overflow-x:clip;}
.${cid}-root *{box-sizing:border-box}
.${cid}-loader{position:fixed;inset:0;z-index:90;background:var(--ani-bg);display:grid;place-items:center;transition:opacity .7s,visibility .7s}
.${cid}-loader.is-done{opacity:0;visibility:hidden;pointer-events:none}
.${cid}-loader__n{font-family:'Syne',sans-serif;font-weight:800;font-size:clamp(3.5rem,12vw,7rem);letter-spacing:-.06em;line-height:1}
.${cid}-loader__l{position:absolute;bottom:12vh;font-size:.68rem;letter-spacing:.28em;opacity:.45}
.${cid}-cursor{position:fixed;width:14px;height:14px;border-radius:50%;background:var(--ani-accent);pointer-events:none;z-index:80;mix-blend-mode:difference;transform:translate(-50%,-50%);transition:width .25s,height .25s,opacity .25s;opacity:0}
.${cid}-root.is-ready .${cid}-cursor{opacity:1}
.${cid}-cursor.is-hot{width:42px;height:42px}
.${cid}-nav{position:fixed;top:0;left:0;right:0;z-index:40;display:flex;justify-content:space-between;align-items:center;padding:1.1rem clamp(1rem,4vw,2.5rem);mix-blend-mode:difference;color:#fff;pointer-events:none}
.${cid}-nav__brand{font-family:'Syne',sans-serif;font-weight:700;letter-spacing:-.02em;font-size:.95rem}
.${cid}-nav__cta{pointer-events:auto;font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;text-decoration:none;color:inherit;border-bottom:1px solid currentColor;padding-bottom:2px}
.${cid}-hero{position:relative;height:100vh;min-height:560px;display:grid;place-items:center;overflow:hidden}
.${cid}-hero__canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.${cid}-hero__veil{position:absolute;inset:0;background:radial-gradient(ellipse 70% 55% at 50% 45%,transparent 0%,rgba(0,0,0,.35) 70%,rgba(0,0,0,.65) 100%);pointer-events:none}
.${cid}-hero__copy{position:relative;z-index:2;text-align:center;padding:0 6%;max-width:920px;color:#fff}
.${cid}-hero__eye{margin:0 0 1rem;font-size:.7rem;letter-spacing:.28em;text-transform:uppercase;opacity:.7}
.${cid}-hero__h{margin:0;font-family:'Syne',sans-serif;font-weight:800;font-size:clamp(2.4rem,7vw,5.2rem);line-height:.98;letter-spacing:-.04em}
.${cid}-hero__hint{margin:1.4rem 0 0;font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;opacity:.45}
.${cid}-mq{overflow:hidden;border-block:1px solid color-mix(in srgb,var(--ani-ink) 12%,transparent);padding:1.1rem 0;background:color-mix(in srgb,var(--ani-ink) 4%,var(--ani-bg))}
.${cid}-mq__track{display:flex;gap:1rem;width:max-content;animation:${cid}-marquee 38s linear infinite}
.${cid}-mq__item{width:min(42vw,280px);aspect-ratio:16/10;overflow:hidden;border-radius:10px;flex-shrink:0}
.${cid}-mq__item img{width:100%;height:100%;object-fit:cover;display:block;filter:grayscale(.15)}
@keyframes ${cid}-marquee{to{transform:translateX(-50%)}}
.${cid}-chapters{padding:12vh 0 4vh}
.${cid}-ch{display:grid;grid-template-columns:1.1fr 1fr;gap:clamp(1.5rem,4vw,3.5rem);align-items:center;min-height:85vh;padding:8vh clamp(1.2rem,5vw,4rem);opacity:.22;transform:translateY(28px);transition:opacity .7s,transform .7s}
.${cid}-ch.is-in{opacity:1;transform:none}
.${cid}-ch:nth-child(even){grid-template-columns:1fr 1.1fr}
.${cid}-ch:nth-child(even) .${cid}-ch__media{order:2}
.${cid}-ch__media{overflow:hidden;border-radius:18px;aspect-ratio:4/5;background:#111}
.${cid}-ch__media img{width:100%;height:100%;object-fit:cover;display:block;transform:scale(1.08);transition:transform 1.2s cubic-bezier(.16,1,.3,1)}
.${cid}-ch.is-in .${cid}-ch__media img{transform:scale(1)}
.${cid}-ch__num{display:block;font-family:ui-monospace,Menlo,monospace;font-size:.72rem;letter-spacing:.18em;opacity:.5;margin-bottom:1rem;color:var(--ani-accent)}
.${cid}-ch__copy h2{margin:0;font-family:'Syne',sans-serif;font-weight:800;font-size:clamp(1.8rem,4vw,3.2rem);letter-spacing:-.03em;line-height:1.05}
.${cid}-ch__copy p{margin:1rem 0 0;font-size:clamp(.98rem,1.4vw,1.15rem);line-height:1.6;opacity:.78;max-width:34ch}
.${cid}-horiz{height:280vh;position:relative}
.${cid}-horiz__sticky{position:sticky;top:0;height:100vh;overflow:hidden;display:flex;align-items:center}
.${cid}-horiz__rail{display:flex;gap:1.25rem;padding:0 8vw;will-change:transform}
.${cid}-horiz__card{flex:0 0 min(72vw,520px);margin:0}
.${cid}-horiz__card img{width:100%;aspect-ratio:16/11;object-fit:cover;border-radius:16px;display:block}
.${cid}-horiz__card figcaption{margin-top:.75rem;font-family:'Syne',sans-serif;font-weight:700;font-size:1.05rem;letter-spacing:-.02em}
.${cid}-end{min-height:80vh;display:grid;place-items:center;text-align:center;padding:12vh 6%;position:relative}
.${cid}-end h2{margin:0 0 2rem;font-family:'Syne',sans-serif;font-weight:800;font-size:clamp(2rem,5.5vw,4rem);letter-spacing:-.04em;max-width:14ch;line-height:1.02}
.${cid}-magnet{display:inline-flex;align-items:center;justify-content:center;min-width:200px;min-height:200px;border-radius:50%;background:var(--ani-accent);color:var(--ani-bg);text-decoration:none;font-family:'Syne',sans-serif;font-weight:700;font-size:1.05rem;letter-spacing:-.02em;transition:transform .15s}
.${cid}-end__brand{position:absolute;bottom:2rem;left:0;right:0;font-size:.68rem;letter-spacing:.22em;text-transform:uppercase;opacity:.4}
.${cid}-split .${cid}-c{display:inline-block;opacity:0;transform:translateY(120%);transition:none}
.${cid}-split.is-on .${cid}-c{animation:${cid}-up .85s cubic-bezier(.16,1,.3,1) forwards}
@keyframes ${cid}-up{to{opacity:1;transform:none}}
@media (max-width:800px){
  .${cid}-ch,.${cid}-ch:nth-child(even){grid-template-columns:1fr;min-height:auto;padding:6vh 1.1rem}
  .${cid}-ch:nth-child(even) .${cid}-ch__media{order:0}
  .${cid}-ch__media{aspect-ratio:16/11}
  .${cid}-cursor{display:none}
  .${cid}-magnet{min-width:140px;min-height:140px}
}
@media (prefers-reduced-motion:reduce){
  .${cid}-mq__track{animation:none}
  .${cid}-ch{opacity:1;transform:none}
}
</style>
<script>
(function(){
  var root=document.querySelector('.${cid}-root');
  if(!root||root.__ani)return;root.__ani=true;
  var loader=root.querySelector('.${cid}-loader');
  var loaderN=root.querySelector('.${cid}-loader__n');
  var canvas=root.querySelector('.${cid}-hero__canvas');
  var cursor=root.querySelector('.${cid}-cursor');
  var magnet=root.querySelector('.${cid}-magnet');
  var rail=root.querySelector('.${cid}-horiz__rail');
  var horiz=root.querySelector('.${cid}-horiz');
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var touch=('ontouchstart' in window)||navigator.maxTouchPoints>0;

  // ── Loader ──
  var n=0, target=100;
  var imgs=[].slice.call(root.querySelectorAll('img'));
  var left=imgs.length||1;
  function tickLoad(){
    n+=(target-n)*0.08;
    if(loaderN)loaderN.textContent=String(Math.round(n));
    if(n>99.2){if(loader)loader.classList.add('is-done');root.classList.add('is-ready');splitAll();return;}
    requestAnimationFrame(tickLoad);
  }
  imgs.forEach(function(im){
    if(im.complete){left--;return;}
    im.addEventListener('load',function(){left=Math.max(0,left-1);if(left===0)target=100;});
    im.addEventListener('error',function(){left=Math.max(0,left-1);if(left===0)target=100;});
  });
  setTimeout(function(){target=100;},8000);
  requestAnimationFrame(tickLoad);

  // ── Split text ──
  function splitAll(){
    root.querySelectorAll('.${cid}-split').forEach(function(el,idx){
      if(el.dataset.split)return;el.dataset.split='1';
      var text=el.textContent||'';el.textContent='';
      text.split('').forEach(function(ch,i){
        var s=document.createElement('span');
        s.className='${cid}-c';
        s.textContent=ch===' '?'\\u00a0':ch;
        s.style.animationDelay=(0.02*i+0.04*idx)+'s';
        el.appendChild(s);
      });
      var io=new IntersectionObserver(function(ents){
        ents.forEach(function(e){if(e.isIntersecting){el.classList.add('is-on');io.disconnect();}});
      },{threshold:0.35});
      io.observe(el);
    });
  }

  // ── Hero dual morph (WebGL trail or canvas fallback) ──
  (function(){
    if(!canvas)return;
    var gl=canvas.getContext('webgl')||canvas.getContext('experimental-webgl');
    var baseImg=new Image(),revImg=new Image();
    baseImg.crossOrigin='anonymous';revImg.crossOrigin='anonymous';
    var loaded=0;
    function ready(){loaded++;if(loaded>=2)start();}
    baseImg.onload=ready;revImg.onload=ready;baseImg.onerror=ready;revImg.onerror=ready;
    baseImg.src='${hb}';revImg.src='${hr}';

    function start(){
      if(!gl||!baseImg.naturalWidth||!revImg.naturalWidth){
        // CSS fallback morph via mask
        var hero=root.querySelector('.${cid}-hero');
        if(hero){
          hero.style.background='url(${hb}) center/cover no-repeat';
          var top=document.createElement('div');
          top.style.cssText='position:absolute;inset:0;background:url(${hr}) center/cover no-repeat;mask-image:radial-gradient(circle 140px at 50% 45%,#000 0%,transparent 70%);-webkit-mask-image:radial-gradient(circle 140px at 50% 45%,#000 0%,transparent 70%);pointer-events:none;transition:mask-position .05s';
          hero.insertBefore(top,hero.firstChild);
          hero.addEventListener('pointermove',function(e){
            var r=hero.getBoundingClientRect();
            var x=((e.clientX-r.left)/r.width*100).toFixed(1)+'%';
            var y=((e.clientY-r.top)/r.height*100).toFixed(1)+'%';
            top.style.webkitMaskImage='radial-gradient(circle 160px at '+x+' '+y+',#000 0%,transparent 70%)';
            top.style.maskImage=top.style.webkitMaskImage;
          });
        }
        return;
      }
      function sh(t,src){var s=gl.createShader(t);gl.shaderSource(s,src);gl.compileShader(s);return s;}
      var vs=sh(gl.VERTEX_SHADER,'attribute vec2 a;varying vec2 v;void main(){v=.5*a+.5;gl_Position=vec4(a,0.,1.);}');
      var fs=sh(gl.FRAGMENT_SHADER,[
        'precision mediump float;varying vec2 v;uniform sampler2D uB,uR,uM;uniform vec2 uRes,uBs,uRs;',
        'vec2 cover(vec2 uv,vec2 res,vec2 tex){float ar=res.x/max(res.y,.001),tr=tex.x/max(tex.y,.001);vec2 s=ar>tr?vec2(tr/ar,1.):vec2(1.,ar/tr);return clamp((uv-.5)/s+.5,0.,1.);}',
        'void main(){float m=texture2D(uM,v).r;vec2 bu=cover(v,uRes,uBs),ru=cover(v,uRes,uRs);',
        'float edge=smoothstep(.05,.5,m)*smoothstep(.95,.45,m);float ca=edge*.004;',
        'vec3 b=texture2D(uB,bu).rgb;vec3 r=vec3(texture2D(uR,ru+vec2(ca,0.)).r,texture2D(uR,ru).g,texture2D(uR,ru-vec2(ca,0.)).b);',
        'gl_FragColor=vec4(mix(b,r,smoothstep(.08,.7,m)),1.);}'
      ].join(''));
      var trailFs=sh(gl.FRAGMENT_SHADER,'precision mediump float;varying vec2 v;uniform sampler2D uP;uniform vec2 uM;uniform float uD,uR,uF;void main(){float p=texture2D(uP,v).r;float d=distance(v,uM);float a=max(p*uF,uD*smoothstep(uR,uR*.35,d));gl_FragColor=vec4(a,a,a,1.);}');
      var prog=gl.createProgram();gl.attachShader(prog,vs);gl.attachShader(prog,fs);gl.linkProgram(prog);
      var tProg=gl.createProgram();gl.attachShader(tProg,vs);gl.attachShader(tProg,trailFs);gl.linkProgram(tProg);
      var buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
      function tex(filter){var t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);return t;}
      var tB=tex(gl.LINEAR),tR=tex(gl.LINEAR),tA=tex(gl.LINEAR),tB2=tex(gl.LINEAR),fbo=gl.createFramebuffer();
      function up(t,im){gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);}
      up(tB,baseImg);up(tR,revImg);
      var tw=1,th=1,flip=false,mx=.5,my=.5,drawing=0,has=0,auto=0;
      function alloc(w,h){tw=w;th=h;[tA,tB2].forEach(function(t){gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,tw,th,0,gl.RGBA,gl.UNSIGNED_BYTE,null);});}
      function resize(){var w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);alloc(Math.max(1,Math.round(w*.5)),Math.max(1,Math.round(h*.5)));}
      canvas.addEventListener('pointermove',function(e){var r=canvas.getBoundingClientRect();mx=(e.clientX-r.left)/r.width;my=1-(e.clientY-r.top)/r.height;drawing=1;has=1;});
      window.addEventListener('pointerup',function(){drawing=0;});
      function bind(p){var loc=gl.getAttribLocation(p,'a');gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);}
      function loop(){
        var dt=.016;auto+=dt;
        var read=flip?tB2:tA,write=flip?tA:tB2;
        gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,write,0);gl.viewport(0,0,tw,th);
        gl.useProgram(tProg);bind(tProg);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,read);gl.uniform1i(gl.getUniformLocation(tProg,'uP'),0);
        var x=mx,y=my;if(!has&&!reduce){x=.5+Math.sin(auto*.55)*.2;y=.48+Math.cos(auto*.4)*.14;}
        gl.uniform2f(gl.getUniformLocation(tProg,'uM'),x,y);gl.uniform1f(gl.getUniformLocation(tProg,'uD'),(drawing||!has)?1:0);gl.uniform1f(gl.getUniformLocation(tProg,'uR'),.14);gl.uniform1f(gl.getUniformLocation(tProg,'uF'),.97);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);flip=!flip;
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);gl.useProgram(prog);bind(prog);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tB);gl.uniform1i(gl.getUniformLocation(prog,'uB'),0);
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,tR);gl.uniform1i(gl.getUniformLocation(prog,'uR'),1);
        gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,flip?tA:tB2);gl.uniform1i(gl.getUniformLocation(prog,'uM'),2);
        gl.uniform2f(gl.getUniformLocation(prog,'uRes'),canvas.width,canvas.height);
        gl.uniform2f(gl.getUniformLocation(prog,'uBs'),baseImg.naturalWidth,baseImg.naturalHeight);
        gl.uniform2f(gl.getUniformLocation(prog,'uRs'),revImg.naturalWidth,revImg.naturalHeight);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        requestAnimationFrame(loop);
      }
      window.addEventListener('resize',resize);resize();loop();
    }
  })();

  // ── Chapters IO ──
  var chIO=new IntersectionObserver(function(ents){ents.forEach(function(e){if(e.isIntersecting)e.target.classList.add('is-in');});},{threshold:0.28});
  root.querySelectorAll('.${cid}-ch').forEach(function(el){chIO.observe(el);});

  // ── Horizontal scrub ──
  function syncHoriz(){
    if(!rail||!horiz)return;
    var r=horiz.getBoundingClientRect();
    var total=Math.max(1,horiz.offsetHeight-window.innerHeight);
    var p=Math.max(0,Math.min(1,(-r.top)/total));
    var maxX=Math.max(0,rail.scrollWidth-window.innerWidth);
    rail.style.transform='translate3d('+(-p*maxX).toFixed(1)+'px,0,0)';
  }
  window.addEventListener('scroll',syncHoriz,{passive:true});
  window.addEventListener('resize',syncHoriz);

  // ── Cursor + magnetic CTA ──
  if(!touch&&cursor){
    window.addEventListener('pointermove',function(e){
      cursor.style.left=e.clientX+'px';cursor.style.top=e.clientY+'px';
      var hot=e.target.closest&&e.target.closest('a,button,.${cid}-magnet');
      cursor.classList.toggle('is-hot',!!hot);
      if(magnet&&!reduce){
        var b=magnet.getBoundingClientRect();
        var cx=b.left+b.width/2,cy=b.top+b.height/2;
        var dx=e.clientX-cx,dy=e.clientY-cy,dist=Math.hypot(dx,dy);
        if(dist<140){magnet.style.transform='translate('+(dx*.22).toFixed(1)+'px,'+(dy*.22).toFixed(1)+'px)';}
        else magnet.style.transform='';
      }
    });
  }

  try{window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){}
})();
</script>
`;
}
