/**
 * Scroll-world immersion pipeline (architecture B: dive-in + aerial connectors).
 *
 * N scene stills (nano-banana-2) → N dive clips (Kling 3.0) → N−1 connector clips
 * joined by ffmpeg-extracted boundary frames → self-contained HTML that mounts
 * the portable scrub engine (inlined — published sites cannot load craft-ai.ru assets).
 *
 * Spec mirrors https://github.com/oso95/scroll-world (Kling tier via KIE API).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

// ─── Constants ───────────────────────────────────────────────────────────────

export const SCROLL_IMMERSION_COST = 550;
export const SW_SCENE_COUNT = 5;
export const SW_DIVE_DURATION = 10;
export const SW_CONN_DURATION = 5;

const KLING_MODEL = "kling-3.0/video";
const STILL_MODEL = "nano-banana-2";
const POLL_INTERVAL_MS = 5000;
const CLIP_DEADLINE_MS = 35 * 60 * 1000; // ~35 min per clip (Kling queue)
const STILL_DEADLINE_MS = 3 * 60 * 1000;
const MAX_CLIP_ATTEMPTS = 3;
const MAX_STILL_ATTEMPTS = 4;
const PROMPT_MAX = 2500;

/** Neutral luxury theme — matches scroll-world professional landing pages. */
const SW_BG = "#F4F0EA";
const SW_INK = "#1a1510";
const SW_INK_SOFT = "#6a6258";
const SW_ACCENT_DEFAULT = "#8B7355";

const SECTION_ACCENTS = [
  "#8B7355", // warm gold
  "#6B7C8F", // slate blue
  "#9A7B6A", // terracotta
  "#5C6B5A", // sage
  "#7A6B8F", // muted plum
  "#A6896B", // caramel
  "#4A5568", // charcoal blue
];

/** Byte-identical style preamble across all stills — photorealistic cinematic. */
const STYLE_PREAMBLE =
  `Ultra high-end commercial photography, photorealistic cinematic film still, ` +
  `shallow depth of field, soft natural lighting with gentle volumetric haze, ` +
  `premium luxury brand aesthetic, immaculate composition, rich textures, ` +
  `editorial quality, 8K detail. Absolutely no text, no letters, no numbers, no logos.`;

const STYLE_TAIL =
  `photorealistic cinematic commercial photography, shallow depth of field, ` +
  `premium luxury lighting, editorial film still`;

// ─── Types ───────────────────────────────────────────────────────────────────

export type SwText = { title: string; sub: string };

export type GenerateScrollWorldDeps = {
  kieApiKey: string;
  createUrl: string;
  statusUrl: string;
  kieRequestJson: (url: string, init: any, opts: any) => Promise<any>;
  uploadToObjectStorage: (buf: Buffer, mime: string, ext: string) => Promise<string>;
  getFfmpegBin: () => Promise<string | null>;
  appBaseUrl: string;
  shouldStop: () => boolean;
  onStatus?: (msg: string) => void;
};

type ScenePlan = {
  id: string;
  label: string;
  eyebrow: string;
  title: string;
  body: string;
  subject: string;
  accent: string;
  isFinale: boolean;
};

type KieTaskResult = {
  taskId: string;
  mp4Url: string | null;
  failMsg?: string;
  failCode?: string;
  moderation?: boolean;
};

// ─── Scrub engine (inlined into published HTML) ──────────────────────────────

function loadScrubEngineJs(): string {
  const candidates = [
    path.resolve(process.cwd(), "client/public/scroll-world-engine.js"),
    "/workspace/client/public/scroll-world-engine.js",
    "/tmp/scroll-world/scrub-engine.js",
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const src = fs.readFileSync(p, "utf8");
        if (src.includes("mountScrollWorld")) {
          console.log(`[SCROLLWORLD] loaded scrub engine from ${p} (${src.length} bytes)`);
          return src;
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[SCROLLWORLD] failed reading engine at ${p}: ${msg}`);
    }
  }
  throw new Error(
    "[SCROLLWORLD] scrub engine not found — expected " +
      "client/public/scroll-world-engine.js or /tmp/scroll-world/scrub-engine.js",
  );
}

const SCRUB_ENGINE_JS: string = loadScrubEngineJs();

// ─── Small helpers ───────────────────────────────────────────────────────────

function log(msg: string, ...rest: unknown[]): void {
  console.log(`[SCROLLWORLD] ${msg}`, ...rest);
}

function warn(msg: string, ...rest: unknown[]): void {
  console.warn(`[SCROLLWORLD] ${msg}`, ...rest);
}

function status(deps: GenerateScrollWorldDeps, msg: string): void {
  log(msg);
  try {
    deps.onStatus?.(msg);
  } catch {
    /* ignore status callback errors */
  }
}

function absUrl(appBaseUrl: string, rel: string): string {
  if (!rel) return rel;
  if (rel.startsWith("http://") || rel.startsWith("https://")) return rel;
  const base = appBaseUrl.replace(/\/$/, "");
  return rel.startsWith("/") ? `${base}${rel}` : `${base}/${rel}`;
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripCyrillic(p: string): string {
  return p
    .replace(/[\u0400-\u04FF][\u0400-\u04FF\s,;:!?—–-]*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s.,;:]+|[\s.,;:]+$/g, "")
    .trim();
}

function isModerationError(failMsg?: string, failCode?: string | number): boolean {
  const s = `${failMsg || ""} ${failCode || ""}`.toLowerCase();
  return (
    s.includes("community") ||
    s.includes("guideline") ||
    s.includes("violat") ||
    s.includes("moderat") ||
    s.includes("inappropriate") ||
    s.includes("content policy") ||
    s.includes("nsfw") ||
    /\b400\b/.test(s)
  );
}

function sanitizePrompt(p: string): string {
  const stripped = p
    .replace(
      /\b(blood|gore|violence|weapon|gun|knife|nude|naked|sexy|erotic|adult|death|kill|war|combat|fight|crash|explosion|fire|smoke|burn|destroy|brutal|horror|terror|fear)\b/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
  const base =
    stripped.length > 20
      ? stripped
      : "premium cinematic commercial environment, soft natural lighting, photorealistic";
  return `${base}, clean family-friendly commercial photography, safe for work, photorealistic cinematic`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function synthesizeEyebrow(_title: string, _sub: string, sceneIndex: number): string {
  return `SCENE ${String(sceneIndex + 1).padStart(2, "0")}`;
}

function synthesizeSubject(title: string, sub: string, worldHint: string, isFinale: boolean): string {
  const core = [title, sub].filter(Boolean).join(". ").trim();
  if (isFinale) {
    return (
      `Hero finale shot` +
      (core ? `: ${core}` : "") +
      (worldHint ? `. Brand world: ${worldHint}` : "") +
      `. A single stunning hero product or signature moment in a luxurious setting, ` +
      `soft bokeh background, premium commercial photography.`
    );
  }
  return (
    (core || "A cinematic scene from the brand journey") +
    (worldHint ? `. Part of a connected brand world: ${worldHint}` : "") +
    `. Show a real architectural space or environment with rich detail, ` +
    `professional lighting, and concrete props that signal this stage of the journey.`
  );
}

function mapTextsToScenes(texts: SwText[], worldHint: string): ScenePlan[] {
  const padded: SwText[] = [];
  for (let i = 0; i < SW_SCENE_COUNT; i++) {
    if (i < texts.length && (texts[i].title || texts[i].sub)) {
      padded.push({ title: texts[i].title || "", sub: texts[i].sub || "" });
    } else if (texts.length > 0) {
      // Pad by cycling last known text with a stage suffix, then fall back to world hint.
      const src = texts[Math.min(i, texts.length - 1)];
      padded.push({
        title: src.title ? `${src.title}` : `Scene ${i + 1}`,
        sub: src.sub || worldHint.slice(0, 120) || "",
      });
    } else {
      padded.push({
        title: `Scene ${i + 1}`,
        sub: worldHint.slice(0, 140) || "A stop along the miniature journey",
      });
    }
  }
  // If caller sent more than N, keep the first N−1 and the last (finale).
  if (texts.length > SW_SCENE_COUNT) {
    const head = texts.slice(0, SW_SCENE_COUNT - 1);
    const last = texts[texts.length - 1];
    for (let i = 0; i < SW_SCENE_COUNT - 1; i++) {
      padded[i] = { title: head[i].title || "", sub: head[i].sub || "" };
    }
    padded[SW_SCENE_COUNT - 1] = { title: last.title || "", sub: last.sub || "" };
  }

  return padded.map((t, i) => {
    const isFinale = i === SW_SCENE_COUNT - 1;
    const title = t.title || `Scene ${i + 1}`;
    const body = t.sub || "";
    const eyebrow = synthesizeEyebrow(title, body, i);
    const id = `sw${i + 1}-${title
      .toLowerCase()
      .replace(/[^a-z0-9\u0400-\u04FF]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || i + 1}`;
    return {
      id,
      label: title.slice(0, 28) || `Scene ${i + 1}`,
      eyebrow,
      title,
      body,
      subject: synthesizeSubject(title, body, worldHint, isFinale),
      accent: SECTION_ACCENTS[i % SECTION_ACCENTS.length],
      isFinale,
    };
  });
}

function stillPromptFor(scene: ScenePlan): string {
  if (scene.isFinale) {
    return (
      `${STYLE_PREAMBLE} ` +
      `Finale hero shot: ${scene.subject} ` +
      `Luxurious setting, soft bokeh, premium commercial photography. ` +
      `Absolutely no text, no letters, no logos.`
    );
  }
  return `${STYLE_PREAMBLE}\nSubject: ${scene.subject}`;
}

function divePromptFor(scene: ScenePlan): string {
  const focal = scene.title || "the heart of the scene";
  const revealClause = scene.isFinale
    ? `the camera glides in close until the hero product or centerpiece fills the frame with dramatic beauty`
    : `As the camera pushes forward, doors open or the space reveals its interior with warm inviting light`;
  return (
    `Single continuous cinematic camera move, no cuts. Begin with a wide establishing shot of ` +
    `${scene.subject}. The camera slowly glides forward and descends toward ${focal}, ` +
    `as if flying into the scene. ${revealClause}. ` +
    `${STYLE_TAIL}. Smooth, graceful, slow motion, subtle parallax, IMAX-quality. No text, no captions.`
  ).slice(0, PROMPT_MAX);
}

function connectorPromptFor(from: ScenePlan, to: ScenePlan): string {
  if (to.isFinale) {
    return (
      `Single continuous cinematic camera move, no cuts. The camera smoothly pulls up and back ` +
      `out of ${from.title || from.subject}, rising gracefully, then glides forward through ` +
      `atmospheric haze toward the hero finale (${to.title || to.subject}), arriving in front of it. ` +
      `One connected brand world, seamless flowing aerial transition. ` +
      `${STYLE_TAIL}. Smooth graceful slow motion. No text, no captions.`
    ).slice(0, PROMPT_MAX);
  }
  return (
    `Single continuous cinematic camera move, no cuts. The camera smoothly pulls up and back ` +
    `out of ${from.title || from.subject}, rising into the sky, then glides forward across ` +
    `the landscape and arrives above ${to.title || to.subject}, beginning to descend toward it. ` +
    `One connected brand world, seamless flowing aerial transition. ` +
    `${STYLE_TAIL}. Smooth graceful slow motion. No text, no captions.`
  ).slice(0, PROMPT_MAX);
}

// ─── FFmpeg helpers ──────────────────────────────────────────────────────────

async function spawnFfmpeg(
  bin: string,
  args: string[],
  label: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "ignore"] });
    proc.on("error", reject);
    proc.on("close", (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`${label}: ffmpeg exited ${code}`));
    });
  });
}

/** Extract first frame (-ss 0) and last frame (-sseof -0.15) as JPEGs. */
async function extractBoundaryFrames(
  ffmpegBin: string,
  mp4Path: string,
  firstOut: string,
  lastOut: string,
): Promise<void> {
  await spawnFfmpeg(
    ffmpegBin,
    ["-y", "-v", "error", "-ss", "0", "-i", mp4Path, "-frames:v", "1", "-q:v", "2", firstOut],
    "first-frame",
  );
  await spawnFfmpeg(
    ffmpegBin,
    ["-y", "-v", "error", "-sseof", "-0.15", "-i", mp4Path, "-frames:v", "1", "-q:v", "2", lastOut],
    "last-frame",
  );
}

/** Scrub-friendly re-encode: no audio, GOP 8, faststart, light sharpen (pipeline.md §5). */
async function encodeForScrub(
  ffmpegBin: string,
  inPath: string,
  outPath: string,
): Promise<void> {
  await spawnFfmpeg(
    ffmpegBin,
    [
      "-y", "-v", "error", "-i", inPath,
      "-an",
      "-vf", "unsharp=5:5:0.8:5:5:0.0",
      "-c:v", "libx264", "-preset", "fast", "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-g", "8", "-keyint_min", "8", "-sc_threshold", "0",
      "-movflags", "+faststart",
      outPath,
    ],
    "scrub-encode",
  );
}

async function downloadToFile(url: string, dest: string, label: string): Promise<Buffer> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(8000);
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 1000) throw new Error(`file too small: ${buf.length}`);
      fs.writeFileSync(dest, buf);
      log(`${label} downloaded ${buf.length} bytes → ${dest}`);
      return buf;
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      warn(`${label} download attempt ${attempt + 1} failed: ${lastErr.message}`);
    }
  }
  throw lastErr || new Error(`${label} download failed`);
}

async function uploadBuffer(
  deps: GenerateScrollWorldDeps,
  buf: Buffer,
  mime: string,
  ext: string,
): Promise<string> {
  const rel = await deps.uploadToObjectStorage(buf, mime, ext);
  return absUrl(deps.appBaseUrl, rel);
}

// ─── KIE still generation ────────────────────────────────────────────────────

async function generateStill(
  prompt: string,
  deps: GenerateScrollWorldDeps,
  label: string,
): Promise<string | null> {
  const { kieApiKey, createUrl, statusUrl, kieRequestJson, shouldStop } = deps;

  for (let attempt = 0; attempt < MAX_STILL_ATTEMPTS; attempt++) {
    if (shouldStop()) return null;
    if (attempt > 0) await sleep(4000);

    const createBody = await kieRequestJson(
      createUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${kieApiKey}`,
        },
        body: JSON.stringify({
          model: STILL_MODEL,
          input: {
            prompt: prompt.slice(0, PROMPT_MAX),
            aspect_ratio: "16:9",
            resolution: "2K",
          },
        }),
      },
      { label: `SCROLLWORLD ${label}-create`, retries: 4, shouldStop },
    );

    const taskId: string | undefined = createBody?.data?.taskId;
    if (createBody?.code !== 200 || !taskId) {
      warn(`${label} still-create failed:`, createBody?.msg || createBody?.code);
      continue;
    }
    log(`${label} still task ${taskId}`);

    const deadline = Date.now() + STILL_DEADLINE_MS;
    while (Date.now() < deadline) {
      if (shouldStop()) return null;
      await sleep(4000);
      const body = await kieRequestJson(
        `${statusUrl}?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${kieApiKey}` } },
        {
          label: `SCROLLWORLD ${label}-poll`,
          retries: 2,
          shouldStop: () => shouldStop() || Date.now() >= deadline,
        },
      );
      if (!body || body.code !== 200 || !body.data) continue;
      const state: string = body.data.state;
      if (state === "success") {
        let result: { resultUrls?: string[] } = {};
        try {
          const rj = body.data.resultJson;
          result = typeof rj === "string" ? JSON.parse(rj) : rj || {};
        } catch {
          /* ignore */
        }
        const cdnUrl = (result.resultUrls || [])[0] || null;
        if (!cdnUrl) break;
        try {
          const imgResp = await fetch(cdnUrl, { signal: AbortSignal.timeout(25000) });
          if (imgResp.ok) {
            const imgBuf = Buffer.from(await imgResp.arrayBuffer());
            const stable = await uploadBuffer(deps, imgBuf, "image/jpeg", "jpg");
            log(`${label} still re-uploaded → ${stable}`);
            return stable;
          }
        } catch (upErr: unknown) {
          const msg = upErr instanceof Error ? upErr.message : String(upErr);
          warn(`${label} still re-upload failed, using CDN: ${msg}`);
        }
        return absUrl(deps.appBaseUrl, cdnUrl);
      }
      if (state === "fail" || state === "failed" || state === "error") {
        warn(`${label} still failed (attempt ${attempt + 1}):`, body.data?.failMsg);
        break;
      }
    }
  }
  warn(`${label} still generation exhausted`);
  return null;
}

// ─── KIE Kling video ─────────────────────────────────────────────────────────

async function createAndPollKling(opts: {
  prompt: string;
  imageUrls: string[];
  duration: string;
  deps: GenerateScrollWorldDeps;
  label: string;
}): Promise<KieTaskResult | null> {
  const { prompt, imageUrls, duration, deps, label } = opts;
  const { kieApiKey, createUrl, statusUrl, kieRequestJson, shouldStop } = deps;

  const createBody = await kieRequestJson(
    createUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${kieApiKey}`,
      },
      body: JSON.stringify({
        model: KLING_MODEL,
        input: {
          prompt: prompt.slice(0, PROMPT_MAX),
          image_urls: imageUrls,
          sound: false,
          duration,
          aspect_ratio: "16:9",
          mode: "std",
          multi_shots: false,
        },
      }),
    },
    {
      label: `SCROLLWORLD ${label}-create`,
      retries: 4,
      shouldStop,
    },
  );

  const taskId: string | undefined = createBody?.data?.taskId;
  if (createBody?.code !== 200 || !taskId) {
    warn(`${label} create failed:`, createBody?.msg || createBody?.code);
    return null;
  }
  log(`${label} task created: ${taskId} (dur=${duration}, frames=${imageUrls.length})`);

  const deadline = Date.now() + CLIP_DEADLINE_MS;
  let pollCount = 0;
  while (Date.now() < deadline) {
    if (shouldStop()) return null;
    await sleep(POLL_INTERVAL_MS);
    pollCount++;
    const body = await kieRequestJson(
      `${statusUrl}?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${kieApiKey}` } },
      {
        label: `SCROLLWORLD ${label}-poll`,
        retries: 2,
        shouldStop: () => shouldStop() || Date.now() >= deadline,
      },
    );
    if (!body || body.code !== 200 || !body.data) {
      if (pollCount <= 3 || pollCount % 10 === 0) log(`${label} poll #${pollCount}: no data`);
      continue;
    }
    const state: string = body.data.state;
    if (pollCount <= 3 || pollCount % 10 === 0) log(`${label} poll #${pollCount} state=${state}`);

    if (state === "success") {
      let result: { resultUrls?: string[] } = {};
      try {
        const rj = body.data.resultJson;
        result = typeof rj === "string" ? JSON.parse(rj) : rj || {};
      } catch (parseErr: unknown) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        warn(`${label} resultJson parse error: ${msg}`);
      }
      const mp4Url = (result.resultUrls || [])[0] || null;
      log(`${label} success mp4=${mp4Url}`);
      return { taskId, mp4Url };
    }

    if (state === "fail" || state === "failed" || state === "error") {
      const failMsg: string = body.data.failMsg || "";
      const failCode: string = String(body.data.failCode || "");
      warn(`${label} failed: failMsg="${failMsg}" failCode="${failCode}"`);
      return {
        taskId,
        mp4Url: null,
        failMsg,
        failCode,
        moderation: isModerationError(failMsg, failCode),
      };
    }
  }
  warn(`${label} timed out after ~${CLIP_DEADLINE_MS / 60000} min`);
  return { taskId, mp4Url: null };
}

async function generateClipWithRetries(opts: {
  prompt: string;
  imageUrls: string[];
  duration: string;
  deps: GenerateScrollWorldDeps;
  label: string;
  /** Called on moderation failure so caller can swap stills if needed. */
  onModeration?: (prompt: string) => string;
}): Promise<string | null> {
  let prompt = opts.prompt;
  let imageUrls = opts.imageUrls;

  for (let attempt = 0; attempt < MAX_CLIP_ATTEMPTS; attempt++) {
    if (opts.deps.shouldStop()) return null;
    if (attempt > 0) {
      log(`${opts.label} retry ${attempt + 1}/${MAX_CLIP_ATTEMPTS}`);
      await sleep(5000);
    }
    const result = await createAndPollKling({
      prompt,
      imageUrls,
      duration: opts.duration,
      deps: opts.deps,
      label: `${opts.label}#${attempt + 1}`,
    });
    if (!result) continue;
    if (result.mp4Url) return result.mp4Url;
    if (result.moderation) {
      prompt = (opts.onModeration || sanitizePrompt)(prompt);
      log(`${opts.label} sanitized prompt after moderation: "${prompt.slice(0, 100)}"`);
    }
  }
  return null;
}

async function downloadEncodeUploadMp4(
  deps: GenerateScrollWorldDeps,
  ffmpegBin: string | null,
  cdnMp4Url: string,
  workDir: string,
  basename: string,
): Promise<string | null> {
  const rawPath = path.join(workDir, `${basename}-raw.mp4`);
  const encPath = path.join(workDir, `${basename}.mp4`);
  try {
    await downloadToFile(cdnMp4Url, rawPath, basename);
  } catch {
    return null;
  }

  let uploadPath = rawPath;
  if (ffmpegBin) {
    try {
      await encodeForScrub(ffmpegBin, rawPath, encPath);
      uploadPath = encPath;
      log(`${basename} scrub-encoded`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      warn(`${basename} encode failed, uploading raw: ${msg}`);
    }
  }

  try {
    const buf = fs.readFileSync(uploadPath);
    const url = await uploadBuffer(deps, buf, "video/mp4", "mp4");
    log(`${basename} uploaded → ${url}`);
    return url;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    warn(`${basename} upload failed: ${msg}`);
    return null;
  }
}

// ─── Immersion nav controller (hide site header during scroll-world) ───────────

const IMMERSION_NAV_CTL = `
<style>
header{transition:background .45s ease,background-color .45s ease,backdrop-filter .45s ease,-webkit-backdrop-filter .45s ease,border-color .45s ease,box-shadow .45s ease,opacity .45s ease,visibility .45s ease;}
body:not(.craft-anim-passed) header{visibility:hidden!important;opacity:0!important;pointer-events:none!important;background:transparent!important;background-color:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;border-color:transparent!important;box-shadow:none!important;}
#craft-scroll-world-pending{display:none!important;}
</style>
<script>(function(){if(window.__craftNavCtl)return;window.__craftNavCtl=true;function fixSticky(){var s=document.querySelectorAll('[data-craft-scrollanim]');if(!s.length)return;for(var i=0;i<s.length;i++){var el=s[i];while(el&&el.nodeType===1&&el!==document.documentElement){var cs=getComputedStyle(el);if(cs.overflowX==='hidden')el.style.overflowX='clip';if(cs.overflowY==='hidden')el.style.overflowY='clip';el=el.parentElement;}}var de=document.documentElement,b=document.body;[de,b].forEach(function(n){if(!n)return;var c=getComputedStyle(n);if(c.overflowX==='hidden')n.style.overflowX='clip';if(c.overflowY==='hidden')n.style.overflowY='clip';});}function u(){var s=document.querySelectorAll('[data-craft-scrollanim]');if(!s.length)return;var h=document.querySelector('header');var th=h?h.offsetHeight:64;var passed=true;for(var i=0;i<s.length;i++){if(s[i].getBoundingClientRect().bottom>th){passed=false;break;}}document.body.classList.toggle('craft-anim-passed',passed);}window.addEventListener('scroll',u,{passive:true});window.addEventListener('resize',u);if(document.readyState!=='loading'){fixSticky();u();}else{document.addEventListener('DOMContentLoaded',function(){fixSticky();u();});}fixSticky();u();})();</script>`;

// ─── HTML builders ───────────────────────────────────────────────────────────

export function buildImmersionPendingHtml(
  videoPrompt: string,
  texts: SwText[],
): string {
  const tid = "swp" + Math.random().toString(36).slice(2, 8);
  const _pa = videoPrompt
    ? ` data-scroll-anim-prompt="${encodeURIComponent(videoPrompt)}"`
    : "";
  const _sa = ` data-scroll-anim-style="${encodeURIComponent("immersion")}"`;
  const _ta = texts.length
    ? ` data-scroll-anim-texts="${encodeURIComponent(
        texts.map((t) => `${t.title}::${t.sub}`).join("||"),
      )}"`
    : "";

  return `<section id="craft-scroll-world-pending" data-scroll-anim-pending="1" data-craft-scrollanim="1" data-layout="immersion"${_pa}${_sa}${_ta} style="position:relative;height:100vh;min-height:600px;background:linear-gradient(145deg,#1a1510 0%,#2a2218 40%,#16213e 100%);display:flex;align-items:center;justify-content:center;overflow:hidden;">
<style>
@keyframes ${tid}-spin{to{transform:rotate(360deg)}}
@keyframes ${tid}-pulse{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes ${tid}-bar{0%{width:0%}100%{width:82%}}
@keyframes ${tid}-fade{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes ${tid}-drift{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
</style>
<div style="text-align:center;color:#F4F0EA;z-index:2;padding:40px;max-width:580px;animation:${tid}-fade .7s ease both;">
  <div style="display:inline-flex;align-items:center;gap:14px;background:rgba(244,240,234,.06);border:1px solid rgba(244,240,234,.12);border-radius:16px;padding:18px 28px;margin-bottom:1.4rem;animation:${tid}-drift 3.2s ease-in-out infinite;">
    <div style="width:36px;height:36px;border:2.5px solid rgba(244,240,234,.12);border-top-color:#8B7355;border-radius:50%;flex-shrink:0;animation:${tid}-spin .95s linear infinite;"></div>
    <div style="text-align:left;">
      <div style="font-size:.95rem;font-weight:600;color:#F4F0EA;margin-bottom:2px;">Собираем сцены…</div>
      <div style="font-size:.8rem;color:rgba(244,240,234,.5);">Кинематографичные кадры и полёты — обычно 15–40 минут</div>
    </div>
  </div>
  <div style="width:240px;height:3px;background:rgba(244,240,234,.08);border-radius:99px;margin:0 auto 1.4rem;overflow:hidden;">
    <div style="height:100%;background:linear-gradient(90deg,#8B7355,#6B7C8F);border-radius:99px;animation:${tid}-bar 18s cubic-bezier(.4,0,.2,1) forwards;"></div>
  </div>
  <div style="font-size:.78rem;color:rgba(244,240,234,.32);line-height:1.6;animation:${tid}-pulse 2.6s ease-in-out infinite;">Страница обновится автоматически.<br>Остальные секции уже готовы — прокрутите вниз ↓</div>
</div>
${IMMERSION_NAV_CTL}
</section>`;
}

function buildImmersionHtml(opts: {
  scenes: ScenePlan[];
  stillUrls: string[];
  diveUrls: string[];
  connectorUrls: Array<string | null>;
}): string {
  const { scenes, stillUrls, diveUrls, connectorUrls } = opts;

  const sections = scenes.map((s, i) => ({
    id: s.id,
    label: s.label,
    still: stillUrls[i],
    clip: diveUrls[i],
    accent: s.accent,
    eyebrow: s.eyebrow,
    title: s.title,
    body: s.body,
    tags: [] as string[],
    ...(s.isFinale
      ? {
          cta: {
            primary: { label: "Начать", href: "#contact" },
            secondary: { label: "Ещё", href: "#top" },
          },
        }
      : {}),
  }));

  const config = {
    hint: "листайте, чтобы полететь · scroll to fly in",
    diveScroll: 1.3,
    connScroll: 0.9,
    crossfade: 0.12,
    atmosphere: true,
    nav: true,
    brand: { name: "Craft AI", href: "#top" },
    sections,
    connectors: connectorUrls,
  };

  // Escape </script> so an inlined engine never prematurely closes the tag.
  const engineSrc = SCRUB_ENGINE_JS.replace(/<\/script>/gi, "<\\/script>");
  const configJson = JSON.stringify(config)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/<\/script/gi, "<\\/script");

  return `<section id="craft-scroll-world-root" data-craft-scrollanim="1" data-layout="immersion" style="position:relative;width:100%;isolation:isolate;--sw-bg:${SW_BG};--sw-ink:${SW_INK};--sw-ink-soft:${SW_INK_SOFT};--sw-accent:${SW_ACCENT_DEFAULT};background:${SW_BG};color:${SW_INK};">
<div id="craft-scroll-world" style="width:100%;"></div>
<style>
#craft-scroll-world-root, #craft-scroll-world-root .sw-root {
  --sw-bg: ${SW_BG};
  --sw-ink: ${SW_INK};
  --sw-ink-soft: ${SW_INK_SOFT};
  --sw-accent: ${SW_ACCENT_DEFAULT};
}
#craft-scroll-world-root .sw-root { background: var(--sw-bg); }
#craft-scroll-world-root .sw-topbar { justify-content: center; }
#craft-scroll-world-root .sw-nav { display: none; }
#craft-scroll-world-root .sw-brand { margin: 0 auto; }
</style>
<script data-craft-scroll-world-engine>
${engineSrc}
</script>
<script data-craft-scroll-world-mount>
(function(){
  var el = document.getElementById('craft-scroll-world');
  if (!el || typeof mountScrollWorld !== 'function') return;
  var cfg = ${configJson};
  mountScrollWorld(el, cfg);
  try {
  var pending = document.getElementById('craft-scroll-world-pending');
  if (pending) pending.style.display = 'none';
  window.dispatchEvent(new Event('craft:frames-ready'));
  } catch(e) {}
})();
</script>${IMMERSION_NAV_CTL}
</section>`;
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

export async function generateScrollWorld(opts: {
  videoPrompt: string;
  texts: SwText[];
  deps: GenerateScrollWorldDeps;
}): Promise<{ html: string; mp4Urls: string[]; stillUrls: string[] } | null> {
  const { deps } = opts;
  const { shouldStop } = deps;

  if (!deps.kieApiKey) {
    warn("missing kieApiKey");
    return null;
  }

  const cleanedWorld = stripCyrillic(opts.videoPrompt || "");
  const worldHint =
    cleanedWorld.length > 15
      ? cleanedWorld
      : "a cohesive premium cinematic brand world, photorealistic commercial photography";

  const scenes = mapTextsToScenes(opts.texts || [], worldHint);
  log(
    `start N=${SW_SCENE_COUNT} dives=${SW_SCENE_COUNT} connectors=${SW_SCENE_COUNT - 1} ` +
      `totalVideos=${2 * SW_SCENE_COUNT - 1} world="${worldHint.slice(0, 80)}"`,
  );

  const ffmpegBin = await deps.getFfmpegBin();
  if (!ffmpegBin) {
    warn("ffmpeg binary not available — boundary frames / scrub encode required");
    return null;
  }
  log(`ffmpeg: ${ffmpegBin}`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrollworld-"));
  log(`workDir ${workDir}`);

  try {
    // ── 1. Scene stills (parallel) ─────────────────────────────────────────
    status(deps, "Рисуем сцены мира…");
    const stillResults = await Promise.all(
      scenes.map((scene, i) =>
        generateStill(stillPromptFor(scene), deps, `still${i + 1}`),
      ),
    );
    if (shouldStop()) return null;

    const stillUrls = stillResults.filter((u): u is string => !!u);
    if (stillUrls.length < SW_SCENE_COUNT) {
      warn(`only ${stillUrls.length}/${SW_SCENE_COUNT} stills — aborting`);
      return null;
    }
    log(`all ${SW_SCENE_COUNT} stills ready`);

    // ── 2. Dive clips (parallel) ───────────────────────────────────────────
    status(deps, "Снимаем погружения в сцены…");
    const diveCdnUrls = await Promise.all(
      scenes.map((scene, i) =>
        generateClipWithRetries({
          prompt: divePromptFor(scene),
          imageUrls: [stillUrls[i]],
          duration: String(SW_DIVE_DURATION),
          deps,
          label: `dive${i + 1}`,
          onModeration: (p) => sanitizePrompt(p),
        }),
      ),
    );
    if (shouldStop()) return null;

    if (diveCdnUrls.some((u) => !u)) {
      warn(
        `dives incomplete: ${diveCdnUrls.map((u, i) => (u ? "ok" : `fail#${i}`)).join(",")}`,
      );
      return null;
    }

    // Download + encode + upload dives; keep local paths for frame extraction
    status(deps, "Сохраняем клипы погружения…");
    const diveUrls: string[] = [];
    const diveLocalPaths: string[] = [];
    for (let i = 0; i < SW_SCENE_COUNT; i++) {
      if (shouldStop()) return null;
      const localEnc = path.join(workDir, `dive${i + 1}.mp4`);
      const rawPath = path.join(workDir, `dive${i + 1}-raw.mp4`);
      try {
        await downloadToFile(diveCdnUrls[i]!, rawPath, `dive${i + 1}`);
        try {
          await encodeForScrub(ffmpegBin, rawPath, localEnc);
        } catch {
          fs.copyFileSync(rawPath, localEnc);
        }
        diveLocalPaths.push(localEnc);
        const buf = fs.readFileSync(localEnc);
        const url = await uploadBuffer(deps, buf, "video/mp4", "mp4");
        diveUrls.push(url);
        log(`dive${i + 1} ready ${url}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        warn(`dive${i + 1} persist failed: ${msg}`);
        return null;
      }
    }

    // ── 3. Boundary frames ─────────────────────────────────────────────────
    status(deps, "Сшиваем стыки между сценами…");
    const firstFrameUrls: string[] = [];
    const lastFrameUrls: string[] = [];
    for (let i = 0; i < SW_SCENE_COUNT; i++) {
      if (shouldStop()) return null;
      const firstPath = path.join(workDir, `first_${i + 1}.jpg`);
      const lastPath = path.join(workDir, `last_${i + 1}.jpg`);
      try {
        await extractBoundaryFrames(ffmpegBin, diveLocalPaths[i], firstPath, lastPath);
        const firstUrl = await uploadBuffer(
          deps,
          fs.readFileSync(firstPath),
          "image/jpeg",
          "jpg",
        );
        const lastUrl = await uploadBuffer(
          deps,
          fs.readFileSync(lastPath),
          "image/jpeg",
          "jpg",
        );
        firstFrameUrls.push(firstUrl);
        lastFrameUrls.push(lastUrl);
        log(`boundary dive${i + 1}: first=${firstUrl.slice(-40)} last=${lastUrl.slice(-40)}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        warn(`boundary extract dive${i + 1} failed: ${msg}`);
        return null;
      }
    }

    // ── 4. Connector clips (after all dives — need boundary frames) ────────
    status(deps, "Снимаем перелёты между сценами…");
    const connectorCdn = await Promise.all(
      Array.from({ length: SW_SCENE_COUNT - 1 }, (_, i) =>
        generateClipWithRetries({
          prompt: connectorPromptFor(scenes[i], scenes[i + 1]),
          imageUrls: [lastFrameUrls[i], firstFrameUrls[i + 1]],
          duration: String(SW_CONN_DURATION),
          deps,
          label: `conn${i + 1}`,
          onModeration: (p) => sanitizePrompt(p),
        }),
      ),
    );
    if (shouldStop()) return null;

    // Connectors may be null — engine crossfades when missing
    const connectorUrls: Array<string | null> = [];
    for (let i = 0; i < SW_SCENE_COUNT - 1; i++) {
      if (shouldStop()) return null;
      const cdn = connectorCdn[i];
      if (!cdn) {
        warn(`conn${i + 1} failed after retries — leaving null (crossfade fallback)`);
        connectorUrls.push(null);
        continue;
      }
      const url = await downloadEncodeUploadMp4(
        deps,
        ffmpegBin,
        cdn,
        workDir,
        `conn${i + 1}`,
      );
      if (!url) {
        warn(`conn${i + 1} upload failed — leaving null`);
        connectorUrls.push(null);
      } else {
        connectorUrls.push(url);
      }
    }

    // ── 5. Build HTML ──────────────────────────────────────────────────────
    status(deps, "Собираем полётный HTML…");
    const html = buildImmersionHtml({
      scenes,
      stillUrls,
      diveUrls,
      connectorUrls,
    });

    const mp4Urls = [
      ...diveUrls,
      ...connectorUrls.filter((u): u is string => !!u),
    ];

    log(
      `done stills=${stillUrls.length} dives=${diveUrls.length} ` +
        `connectors=${connectorUrls.filter(Boolean).length}/${SW_SCENE_COUNT - 1} ` +
        `html=${html.length}b`,
    );

    return { html, mp4Urls, stillUrls };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    warn(`pipeline error: ${msg}`);
    return null;
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup */
    }
  }
}
