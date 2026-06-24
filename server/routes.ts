import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { gemini } from "./gemini";
import { deployToNetlify, addCustomDomain, checkDomainStatus, unpublishFromNetlify } from "./netlify-deploy";
import { ObjectStorageService, objectStorageClient } from "./replit_integrations/object_storage";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { db } from "./db";
import { creditTransactions } from "@shared/schema";
import { rateLimit, userOrIpKey } from "./rate-limit";
import { assertPublicHttpUrl } from "./url-guard";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

// Rate limiters (in-memory, single-instance)
const leadIntakeLimiter = rateLimit("lead-intake", { windowMs: 60_000, max: 20, message: "Слишком много заявок. Попробуйте позже." });
const aiLimiter = rateLimit("ai", { windowMs: 60_000, max: 20, keyGenerator: userOrIpKey, message: "Слишком много запросов к ИИ. Подождите минуту." });
const proxyLimiter = rateLimit("proxy", { windowMs: 60_000, max: 60, keyGenerator: userOrIpKey });

const objectStorage = new ObjectStorageService();

async function uploadToObjectStorage(buffer: Buffer, mimeType: string, ext: string): Promise<string> {
  const objectId = crypto.randomUUID();
  const objectName = `uploads/${objectId}.${ext}`;
  const privateDir = objectStorage.getPrivateObjectDir();
  const fullPath = `${privateDir}/${objectName}`;
  const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
  const bucketName = parts[0];
  const objectKey = parts.slice(1).join("/");
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectKey);
  await file.save(buffer, { contentType: mimeType, resumable: false });
  return `/objects/${objectName}`;
}
async function extractTextFromFile(base64Data: string, mimeType: string): Promise<string | null> {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    if (mimeType === "application/pdf") {
      const pdfParse = (await import("pdf-parse")).default;
      const result = await pdfParse(buffer);
      return result.text?.trim() || null;
    }
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword"
    ) {
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.extractRawText({ buffer });
      return result.value?.trim() || null;
    }
    if (mimeType === "text/plain" || mimeType === "text/csv" || mimeType === "text/html" || mimeType === "text/markdown" || mimeType.startsWith("text/")) {
      return buffer.toString("utf-8").trim() || null;
    }
    return null;
  } catch (e) {
    console.error("Error extracting text from file:", e);
    return null;
  }
}

const KIE_API_KEY = process.env.KIE_API_KEY;
const NANO_BANANA_CREATE_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const NANO_BANANA_STATUS_URL = "https://api.kie.ai/api/v1/jobs/recordInfo";
const KIE_LLM_URL = "https://api.kie.ai/codex/v1/responses";
const KIE_LLM_MODEL = "gpt-5-5";
const KIE_GEMINI_URL = "https://api.kie.ai/gemini/v1/models/gemini-3-5-flash:streamGenerateContent";

const AUTO_IMAGE_COST = 15;
const MAX_AUTO_IMAGES = 6;

// ─────────────────────────── Scroll Animation (Интерактивный режим) ───────────────────────────
// Generate a short white-background video via KIE Kling, slice it into compressed WebP frames,
// store each frame in object storage, and build a self-contained scroll-bound Canvas animation
// block. Mirrors the {{GENIMG:...}} marker system with {{SCROLLANIM:videoPrompt|T::S||T::S}}.
const SCROLL_ANIM_COST = 120;
const SCROLL_FRAME_COUNT = 90;     // target frames extracted from a 5s clip (~18fps)
const SCROLL_FRAME_WIDTH = 1280;   // downscale width for web delivery
const SCROLL_VIDEO_DURATION = 5;   // seconds
const KLING_IMG2VID_MODEL = "kling/v3-turbo-image-to-video";

function csaEsc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let _ffmpegPathResolved = false;
async function ensureFfmpegPath(ffmpeg: any): Promise<void> {
  if (_ffmpegPathResolved) return;
  _ffmpegPathResolved = true;
  try {
    // Prefer bundled binary from ffmpeg-static (works in deployed env where PATH has no ffmpeg)
    const ffmpegStatic = await import("ffmpeg-static").catch(() => null);
    const staticPath: string | null = (ffmpegStatic as any)?.default ?? (ffmpegStatic as any) ?? null;
    if (staticPath && typeof staticPath === "string") {
      ffmpeg.setFfmpegPath(staticPath);
      console.log(`[SCROLLANIM] ffmpeg path (static): ${staticPath}`);
      return;
    }
  } catch {}
  try {
    // Fallback: find ffmpeg in PATH (dev environment)
    const { execSync } = await import("child_process");
    const p = execSync("which ffmpeg").toString().trim();
    if (p) { ffmpeg.setFfmpegPath(p); console.log(`[SCROLLANIM] ffmpeg path (which): ${p}`); }
  } catch {
    console.warn("[SCROLLANIM] ffmpeg binary not found via ffmpeg-static or which");
  }
}

// Step 0 helper: generate a cinematic still image for use as the video source frame.
// Returns the raw public CDN URL from KIE (NOT re-uploaded) so Kling can fetch it.
async function generateStillForVideo(
  scenePrompt: string,
  shouldStop: () => boolean = () => false,
): Promise<string | null> {
  if (!KIE_API_KEY) return null;
  const imagePrompt =
    `${scenePrompt.trim()}. Cinematic wide-angle still frame, photorealistic, beautiful dramatic ` +
    `composition, pure white seamless studio background, bright even lighting, no text, no watermark, ` +
    `ultra-high detail, 16:9 aspect ratio.`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (shouldStop()) return null;
    if (attempt > 0) await new Promise(r => setTimeout(r, 4000));
    let taskId: string | null = null;
    try {
      const resp = await fetch(NANO_BANANA_CREATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${KIE_API_KEY}` },
        body: JSON.stringify({ model: "nano-banana-2", input: { prompt: imagePrompt, aspect_ratio: "16:9", resolution: "2K" } }),
      });
      const body: any = await resp.json().catch(() => null);
      if (body?.code === 200 && body?.data?.taskId) taskId = body.data.taskId;
      else { console.warn("[SCROLLANIM] still-image create failed:", body?.msg); continue; }
    } catch (e: any) { console.warn("[SCROLLANIM] still-image create error:", e?.message); continue; }
    const imgDeadline = Date.now() + 180000; // 3 min per attempt
    while (Date.now() < imgDeadline) {
      if (shouldStop()) return null;
      await new Promise(r => setTimeout(r, 4000));
      try {
        const resp = await fetch(`${NANO_BANANA_STATUS_URL}?taskId=${taskId}`, {
          headers: { "Authorization": `Bearer ${KIE_API_KEY}` },
        });
        const body: any = await resp.json().catch(() => null);
        if (!body || body.code !== 200 || !body.data) continue;
        const state = body.data.state;
        if (state === "success") {
          const result = JSON.parse(body.data.resultJson || "{}");
          const url = (result.resultUrls || [])[0] || null;
          if (url) { console.log(`[SCROLLANIM] still image ready: ${url}`); return url; }
          break;
        }
        if (state === "fail" || state === "failed" || state === "error") {
          console.warn(`[SCROLLANIM] still-image task failed (attempt ${attempt + 1}):`, body.data?.failMsg);
          break;
        }
      } catch (e: any) { console.warn("[SCROLLANIM] still-image poll error:", e?.message); }
    }
  }
  console.warn("[SCROLLANIM] still-image generation failed after all attempts");
  return null;
}

// Create a 5s image-to-video on KIE Kling, poll until ready, slice into WebP frames,
// upload each to object storage. Returns ordered "/objects/..." URLs (or [] on failure).
// If referenceStillUrl is provided, it is used directly (skips nano-banana-2 still generation).
async function generateScrollFrames(
  videoPrompt: string,
  shouldStop: () => boolean = () => false,
  referenceStillUrl?: string,
): Promise<string[]> {
  if (!KIE_API_KEY) { console.warn("[SCROLLANIM] missing KIE_API_KEY"); return []; }

  // Step 0 — get a cinematic still image to anchor the video
  let stillUrl: string | null = null;
  if (referenceStillUrl) {
    stillUrl = referenceStillUrl;
    console.log(`[SCROLLANIM] using provided reference still: ${stillUrl}`);
  } else {
    stillUrl = await generateStillForVideo(videoPrompt, shouldStop);
  }
  if (!stillUrl) { console.warn("[SCROLLANIM] aborting: no still image"); return []; }
  if (shouldStop()) { console.warn("[SCROLLANIM] aborted by shouldStop() after still image"); return []; }

  const animPrompt =
    `${videoPrompt.trim()}. Smooth slow cinematic camera motion, gentle natural atmospheric movement, ` +
    `subtle depth and parallax, pure white background maintained, no text, no captions, no watermark.`;

  // Overall deadline shared across all retry attempts (still image time already consumed)
  const deadline = Date.now() + 2400000; // 40 min cap (Kling can take up to 35 min)
  const MAX_VIDEO_ATTEMPTS = 3; // retry on API failure (e.g. upstream timeout)
  let mp4Url: string | null = null;

  for (let videoAttempt = 0; videoAttempt < MAX_VIDEO_ATTEMPTS; videoAttempt++) {
    if (shouldStop() || Date.now() >= deadline) break;
    if (videoAttempt > 0) {
      console.log(`[SCROLLANIM] retrying video task (attempt ${videoAttempt + 1}/${MAX_VIDEO_ATTEMPTS})...`);
      await new Promise(r => setTimeout(r, 5000));
    }

    // Step 1 — create the image-to-video task
    let taskId: string | null = null;
    for (let attempt = 0; attempt < 3 && !taskId; attempt++) {
      if (shouldStop() || Date.now() >= deadline) break;
      if (attempt > 0) await new Promise(r => setTimeout(r, 3000));
      try {
        const resp = await fetch(NANO_BANANA_CREATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${KIE_API_KEY}` },
          body: JSON.stringify({
            model: KLING_IMG2VID_MODEL,
            input: { prompt: animPrompt, image_urls: [stillUrl], duration: SCROLL_VIDEO_DURATION, resolution: "1080p" },
          }),
        });
        const body: any = await resp.json().catch(() => null);
        if (body?.code === 200 && body?.data?.taskId) taskId = body.data.taskId;
        else console.warn("[SCROLLANIM] create task failed:", body?.msg || body?.code);
      } catch (e: any) {
        console.warn("[SCROLLANIM] create task network error:", e?.message);
      }
    }
    if (!taskId) continue; // next video attempt

    console.log(`[SCROLLANIM] video task created (attempt ${videoAttempt + 1}): ${taskId}`);

    // Step 2 — poll for completion (Kling video can take up to 35 min in queue)
    let taskFailed = false;
    let pollCount = 0;
    while (Date.now() < deadline) {
      if (shouldStop()) return [];
      await new Promise(r => setTimeout(r, 5000));
      pollCount++;
      try {
        const resp = await fetch(`${NANO_BANANA_STATUS_URL}?taskId=${taskId}`, {
          headers: { "Authorization": `Bearer ${KIE_API_KEY}` },
        });
        const body: any = await resp.json().catch(() => null);
        if (!body || body.code !== 200 || !body.data) { console.log(`[SCROLLANIM] poll #${pollCount}: no data`); continue; }
        const state = body.data.state;
        if (pollCount <= 3 || pollCount % 10 === 0) console.log(`[SCROLLANIM] poll #${pollCount} state=${state}`);
        if (state === "success") {
          console.log(`[SCROLLANIM] task success, resultJson=${JSON.stringify(body.data.resultJson)?.slice(0, 200)}`);
          let result: any = {};
          const rj = body.data.resultJson;
          try { result = typeof rj === "string" ? JSON.parse(rj) : (rj || {}); } catch (parseErr: any) {
            console.warn("[SCROLLANIM] resultJson parse error:", parseErr?.message, "raw:", String(rj).slice(0, 200));
          }
          mp4Url = (result.resultUrls || [])[0] || null;
          console.log(`[SCROLLANIM] mp4Url=${mp4Url}`);
          break;
        }
        if (state === "fail" || state === "failed" || state === "error") {
          console.warn(`[SCROLLANIM] video task failed (attempt ${videoAttempt + 1}):`, body.data.failMsg || body.data.failCode);
          taskFailed = true;
          break; // break poll loop → outer loop will retry
        }
      } catch (e: any) {
        console.warn("[SCROLLANIM] poll error:", e?.message);
      }
    }
    if (mp4Url) break;           // success — exit retry loop
    if (!taskFailed) break;      // timeout (deadline exceeded) — no point retrying
    // taskFailed === true → continue to next videoAttempt
  }

  if (!mp4Url) {
    console.warn("[SCROLLANIM] video generation failed after all attempts or deadline exceeded");
    return [];
  }

  // Step 3 — download mp4 to a temp dir
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrollanim-"));
  const videoPath = path.join(tmpDir, "src.mp4");
  const framesDir = path.join(tmpDir, "frames");
  try {
    console.log(`[SCROLLANIM] downloading mp4: ${mp4Url}`);
    const vresp = await fetch(mp4Url);
    if (!vresp.ok) throw new Error(`download HTTP ${vresp.status}`);
    const mp4Buf = Buffer.from(await vresp.arrayBuffer());
    fs.writeFileSync(videoPath, mp4Buf);
    fs.mkdirSync(framesDir, { recursive: true });
    console.log(`[SCROLLANIM] mp4 downloaded: ${mp4Buf.length} bytes → ${videoPath}`);
  } catch (e: any) {
    console.warn("[SCROLLANIM] mp4 download failed:", e?.message);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return [];
  }

  // Step 4 — extract frames with ffmpeg
  try {
    const ffmpeg = (await import("fluent-ffmpeg")).default as any;
    await ensureFfmpegPath(ffmpeg);
    const fps = Math.max(8, Math.round(SCROLL_FRAME_COUNT / SCROLL_VIDEO_DURATION));
    console.log(`[SCROLLANIM] starting ffmpeg: fps=${fps}, input=${videoPath}, output=${framesDir}/frame_%04d.jpg`);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          "-vf", `fps=${fps}`,
          "-q:v", "1",
        ])
        .output(path.join(framesDir, "frame_%04d.jpg"))
        .on("end", () => { console.log("[SCROLLANIM] ffmpeg done"); resolve(); })
        .on("error", (err: any) => reject(err))
        .run();
    });
    const frameFiles = fs.readdirSync(framesDir).filter(f => /\.jpg$/i.test(f));
    console.log(`[SCROLLANIM] ffmpeg extracted ${frameFiles.length} frames`);
  } catch (e: any) {
    console.warn("[SCROLLANIM] ffmpeg extraction failed:", e?.message);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return [];
  }

  // Step 5 — compress each frame to WebP and upload to object storage
  const urls: string[] = [];
  try {
    const sharp = (await import("sharp")).default as any;
    const files = fs.readdirSync(framesDir).filter(f => /\.jpg$/i.test(f)).sort();
    for (const f of files) {
      if (shouldStop()) break;
      const raw = fs.readFileSync(path.join(framesDir, f));
      const webp = await sharp(raw).webp({ quality: 92 }).toBuffer();
      const url = await uploadToObjectStorage(webp, "image/webp", "webp");
      urls.push(url);
    }
  } catch (e: any) {
    console.warn("[SCROLLANIM] frame processing failed:", e?.message);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`[SCROLLANIM] produced ${urls.length} frames`);
  return urls;
}

// Static, non-animated fallback so a page never ships a broken {{SCROLLANIM}} marker.
function scrollAnimFallbackHtml(texts: Array<{ title: string; sub: string }>): string {
  const blocks = texts.map(t => `
      <div style="max-width:680px;margin:0 auto 3.5rem;">
        ${t.title ? `<h2 style="font-size:clamp(2rem,5vw,3.5rem);font-weight:800;letter-spacing:-0.03em;color:#0a0a0a;margin:0 0 .5em;line-height:1.1;">${csaEsc(t.title)}</h2>` : ""}
        ${t.sub ? `<p style="font-size:clamp(1rem,2vw,1.25rem);line-height:1.7;color:#444;margin:0;">${csaEsc(t.sub)}</p>` : ""}
      </div>`).join("");
  return `<section style="background:#fff;padding:clamp(60px,12vw,160px) 6%;text-align:center;">${blocks}</section>`;
}

// Build a self-contained scroll-bound Canvas animation block (section + style + script).
// layout: "parallax" (default) — full-screen centered text; "split" — text on left, product on right.
function buildScrollAnimHtml(frames: string[], texts: Array<{ title: string; sub: string }>, layout: "parallax" | "split" = "parallax"): string {
  const cid = "csa" + Math.random().toString(36).slice(2, 8);
  const framesJson = JSON.stringify(frames).replace(/'/g, "&#39;");
  const isSplit = layout === "split";
  const layers = texts.map((t, i) => {
    const seg = 1 / Math.max(1, texts.length);
    const dIn = (i * seg + seg * 0.12).toFixed(3);
    const dOut = (i * seg + seg * 0.88).toFixed(3);
    return `      <div class="${cid}-text" data-in="${dIn}" data-out="${dOut}">
        ${t.title ? `<h2>${csaEsc(t.title)}</h2>` : ""}
        ${t.sub ? `<p>${csaEsc(t.sub)}</p>` : ""}
      </div>`;
  }).join("\n");
  const scrollVh = Math.max(300, Math.min(560, texts.length * 130 + 180));

  // ── Parallax (full-screen) layout ──────────────────────────────────────────
  if (!isSplit) {
    return `
<section class="${cid}-scroll" data-frames='${framesJson}' data-layout="parallax">
  <div class="${cid}-sticky">
    <canvas class="${cid}-canvas"></canvas>
    <div class="${cid}-veil"></div>
    <div class="${cid}-overlays">
${layers}
    </div>
  </div>
</section>
<style>
  .${cid}-scroll{position:relative;height:${scrollVh}vh;margin:0;padding:0;background:#000;}
  .${cid}-sticky{position:sticky;top:0;height:100vh;width:100%;overflow:hidden;background:#000;}
  .${cid}-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
  .${cid}-veil{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 78% 78% at 50% 50%,rgba(0,0,0,0) 42%,rgba(0,0,0,0.25) 100%);}
  .${cid}-overlays{position:absolute;inset:0;pointer-events:none;}
  .${cid}-text{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(860px,88vw);text-align:center;opacity:0;will-change:opacity,transform;}
  .${cid}-text::before{content:"";position:absolute;inset:-40% -30%;z-index:-1;background:radial-gradient(ellipse at center,rgba(0,0,0,0.55) 0%,rgba(0,0,0,0.25) 50%,rgba(0,0,0,0) 72%);filter:blur(12px);}
  .${cid}-text h2{margin:0 0 .4em;font-size:clamp(2.2rem,6vw,5rem);font-weight:800;letter-spacing:-0.03em;line-height:1.05;color:#fff;text-shadow:0 2px 32px rgba(0,0,0,0.5);}
  .${cid}-text p{margin:0 auto;max-width:640px;font-size:clamp(1rem,2.2vw,1.4rem);line-height:1.6;color:rgba(255,255,255,0.88);text-shadow:0 1px 16px rgba(0,0,0,0.4);}
</style>
<script>
(function(){
  var roots=document.querySelectorAll('.${cid}-scroll');
  roots.forEach(function(root){
    if(root.__csaInit)return; root.__csaInit=true;
    var frames; try{frames=JSON.parse(root.getAttribute('data-frames')||'[]');}catch(e){frames=[];}
    if(!frames.length)return;
    var sticky=root.querySelector('.${cid}-sticky');
    var canvas=root.querySelector('.${cid}-canvas');
    var ctx=canvas.getContext('2d');
    var texts=[].slice.call(root.querySelectorAll('.${cid}-text'));
    var imgs=new Array(frames.length),cur=-1;
    var dpr=Math.min(window.devicePixelRatio||1,2);
    function cover(img){var cw=sticky.clientWidth,ch=sticky.clientHeight,iw=img.naturalWidth,ih=img.naturalHeight;if(!iw||!ih)return;var s=Math.max(cw/iw,ch/ih),dw=iw*s,dh=ih*s,dx=(cw-dw)/2,dy=(ch-dh)/2;ctx.clearRect(0,0,cw,ch);ctx.drawImage(img,dx,dy,dw,dh);}
    function paint(i){i=Math.max(0,Math.min(frames.length-1,i));var im=imgs[i];if(im&&im.complete&&im.naturalWidth){cover(im);cur=i;}}
    function resize(){var w=sticky.clientWidth,h=sticky.clientHeight;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);paint(cur<0?0:cur);}
    frames.forEach(function(src,idx){var im=new Image();im.decoding='async';im.onload=function(){if(idx===0)paint(0);};im.onerror=function(){};im.src=src;imgs[idx]=im;});
    function prog(){var r=root.getBoundingClientRect();var t=root.offsetHeight-window.innerHeight;var p=t>0?(-r.top)/t:0;return p<0?0:p>1?1:p;}
    var ticking=false;
    function onScroll(){if(ticking)return;ticking=true;requestAnimationFrame(function(){var p=prog();var idx=Math.round(p*(frames.length-1));if(idx!==cur)paint(idx);texts.forEach(function(el){var a=parseFloat(el.getAttribute('data-in'))||0;var b=parseFloat(el.getAttribute('data-out'))||1;var mid=(a+b)/2,half=Math.max(0.0001,(b-a)/2);var d=Math.abs(p-mid);var op=d>half?0:1-d/half;op=Math.max(0,Math.min(1,op*1.5));el.style.opacity=op.toFixed(3);el.style.transform='translate(-50%,calc(-50% + '+((1-op)*34)+'px))';});ticking=false;});}
    window.addEventListener('scroll',onScroll,{passive:true});
    window.addEventListener('resize',resize);
    resize();onScroll();
  });
})();
</script>`;
  }

  // ── Split layout: video right, text left on solid background area ──────────
  return `
<section class="${cid}-scroll" data-frames='${framesJson}' data-layout="split">
  <div class="${cid}-sticky">
    <canvas class="${cid}-canvas"></canvas>
    <div class="${cid}-panel">
${layers}
    </div>
  </div>
</section>
<style>
  .${cid}-scroll{position:relative;height:${scrollVh}vh;margin:0;padding:0;background:#f8f7f4;}
  .${cid}-sticky{position:sticky;top:0;height:100vh;width:100%;overflow:hidden;background:#f8f7f4;}
  .${cid}-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
  .${cid}-panel{position:absolute;top:0;left:0;width:48%;height:100%;pointer-events:none;display:flex;align-items:center;padding:0 clamp(32px,5vw,80px);}
  .${cid}-text{position:absolute;left:clamp(32px,5vw,80px);top:50%;transform:translateY(-50%);width:min(46vw,560px);text-align:left;opacity:0;will-change:opacity,transform;}
  .${cid}-text h2{margin:0 0 .5em;font-size:clamp(1.8rem,4vw,3.8rem);font-weight:800;letter-spacing:-0.035em;line-height:1.05;color:#1D1D1F;}
  .${cid}-text p{margin:0;max-width:480px;font-size:clamp(0.9rem,1.8vw,1.2rem);line-height:1.65;color:#555;}
  @media(max-width:700px){.${cid}-panel{width:100%;background:linear-gradient(to top,rgba(248,247,244,0.95) 60%,rgba(248,247,244,0) 100%);bottom:0;top:auto;height:42%;align-items:flex-start;padding:16px 20px;} .${cid}-text{position:relative;top:auto;left:auto;transform:none;width:100%;text-align:center;} .${cid}-text h2{font-size:clamp(1.4rem,6vw,2rem);} .${cid}-text p{font-size:0.85rem;}}
</style>
<script>
(function(){
  var roots=document.querySelectorAll('.${cid}-scroll');
  roots.forEach(function(root){
    if(root.__csaInit)return; root.__csaInit=true;
    var frames; try{frames=JSON.parse(root.getAttribute('data-frames')||'[]');}catch(e){frames=[];}
    if(!frames.length)return;
    var sticky=root.querySelector('.${cid}-sticky');
    var canvas=root.querySelector('.${cid}-canvas');
    var ctx=canvas.getContext('2d');
    var texts=[].slice.call(root.querySelectorAll('.${cid}-text'));
    var imgs=new Array(frames.length),cur=-1;
    var dpr=Math.min(window.devicePixelRatio||1,2);
    function cover(img){var cw=sticky.clientWidth,ch=sticky.clientHeight,iw=img.naturalWidth,ih=img.naturalHeight;if(!iw||!ih)return;var s=Math.max(cw/iw,ch/ih),dw=iw*s,dh=ih*s,dx=(cw-dw)/2,dy=(ch-dh)/2;ctx.clearRect(0,0,cw,ch);ctx.drawImage(img,dx,dy,dw,dh);}
    function paint(i){i=Math.max(0,Math.min(frames.length-1,i));var im=imgs[i];if(im&&im.complete&&im.naturalWidth){cover(im);cur=i;}}
    function resize(){var w=sticky.clientWidth,h=sticky.clientHeight;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);paint(cur<0?0:cur);}
    frames.forEach(function(src,idx){var im=new Image();im.decoding='async';im.onload=function(){if(idx===0)paint(0);};im.onerror=function(){};im.src=src;imgs[idx]=im;});
    function prog(){var r=root.getBoundingClientRect();var t=root.offsetHeight-window.innerHeight;var p=t>0?(-r.top)/t:0;return p<0?0:p>1?1:p;}
    var ticking=false;
    function onScroll(){if(ticking)return;ticking=true;requestAnimationFrame(function(){var p=prog();var idx=Math.round(p*(frames.length-1));if(idx!==cur)paint(idx);texts.forEach(function(el){var a=parseFloat(el.getAttribute('data-in'))||0;var b=parseFloat(el.getAttribute('data-out'))||1;var mid=(a+b)/2,half=Math.max(0.0001,(b-a)/2);var d=Math.abs(p-mid);var op=d>half?0:1-d/half;op=Math.max(0,Math.min(1,op*1.5));el.style.opacity=op.toFixed(3);el.style.transform='translateY(calc(-50% + '+((1-op)*24)+'px))';});ticking=false;});}
    window.addEventListener('scroll',onScroll,{passive:true});
    window.addEventListener('resize',resize);
    resize();onScroll();
  });
})();
</script>`;
}

// Scan files for {{SCROLLANIM:...}} markers, generate the animation, and bake the result in.
// No marker ever survives — failures degrade to a static text section.
async function resolveScrollAnimMarkers(
  filesMap: Map<string, string>,
  projectId: number,
  userId: number | undefined,
  runKey: string,
  res: any,
  isAborted: () => boolean = () => false,
  productImageUrl?: string,
  interactiveStyle?: string,
): Promise<{ generated: number; creditsUsed: number }> {
  const RE = /\{\{SCROLLANIM:([\s\S]+?)\}\}/g;
  const markers = new Map<string, { videoPrompt: string; texts: Array<{ title: string; sub: string }> }>();
  for (const code of Array.from(filesMap.values())) {
    let m: RegExpExecArray | null; RE.lastIndex = 0;
    while ((m = RE.exec(code)) !== null) {
      const raw = m[1].trim();
      if (markers.has(raw)) continue;
      const pipe = raw.indexOf("|");
      const videoPrompt = (pipe === -1 ? raw : raw.slice(0, pipe)).trim();
      const textPart = pipe === -1 ? "" : raw.slice(pipe + 1);
      const texts = textPart.split("||").map(seg => {
        const [title, sub] = seg.split("::");
        return { title: (title || "").trim(), sub: (sub || "").trim() };
      }).filter(t => t.title || t.sub);
      if (texts.length === 0) texts.push({ title: "", sub: "" });
      markers.set(raw, { videoPrompt, texts });
    }
  }

  const replaceMap = new Map<string, string>();
  let generated = 0;
  let creditsUsed = 0;

  const finalize = () => {
    for (const [filename, code] of Array.from(filesMap.entries())) {
      const newCode = code.replace(/\{\{SCROLLANIM:([\s\S]+?)\}\}/g, (_full, inner) => {
        const key = String(inner).trim();
        return replaceMap.get(key) ?? scrollAnimFallbackHtml(markers.get(key)?.texts || []);
      });
      filesMap.set(filename, newCode);
    }
  };

  const entries = Array.from(markers.entries());
  if (entries.length === 0) { return { generated: 0, creditsUsed: 0 }; }

  const planned = entries.slice(0, 2); // at most 2 scroll blocks per site
  const phaseDeadline = Date.now() + 2520000; // 42 min total budget (Kling can take up to 35 min)

  for (const [raw, parsed] of planned) {
    if (isAborted() || Date.now() >= phaseDeadline) break;
    try { res.write(`data: ${JSON.stringify({ status: "Рендерю видео для анимации прокрутки (до 35 минут, зависит от очереди KIE)..." })}\n\n`); } catch {}

    let billed = false;
    if (userId) {
      const ikey = `scroll-anim-${projectId}-${runKey}-${crypto.createHash("md5").update(raw).digest("hex").slice(0, 8)}`;
      const ded = await storage.deductCredits(userId, SCROLL_ANIM_COST, "scroll-anim", ikey);
      if (!ded.success) break; // out of credits → leave for static fallback
      billed = !ded.alreadyProcessed;
    }

    // Keep the SSE connection alive with periodic status pings while video renders
    const keepAliveInterval = setInterval(() => {
      try { res.write(`data: ${JSON.stringify({ status: "Рендерю видео для анимации прокрутки (ожидаю результат от KIE)..." })}\n\n`); } catch {}
    }, 20000);

    let frames: string[] = [];
    try {
      frames = await generateScrollFrames(parsed.videoPrompt, () => isAborted() || Date.now() >= phaseDeadline, productImageUrl);
    } finally {
      clearInterval(keepAliveInterval);
    }

    const layout = interactiveStyle === "split" ? "split" : "parallax";
    if (frames.length >= 8) {
      replaceMap.set(raw, buildScrollAnimHtml(frames, parsed.texts, layout));
      generated++;
      if (billed) creditsUsed += SCROLL_ANIM_COST;
      try { res.write(`data: ${JSON.stringify({ status: `Анимация готова (${frames.length} кадров)` })}\n\n`); } catch {}
    } else if (billed && userId) {
      try { await storage.refundCredits(userId, SCROLL_ANIM_COST); } catch {}
    }
  }

  finalize();
  return { generated, creditsUsed };
}

// Low-level: create a GPT Image 2 task on KIE, poll until ready, download and
// store in object storage. Returns the "/objects/..." URL or null on failure.
// Retries the full attempt up to MAX_ATTEMPTS times on transient errors.
async function generateGptImage(
  prompt: string,
  aspectRatio: string,
  shouldStop: () => boolean = () => false,
): Promise<string | null> {
  // More attempts since explicit-fail retries are near-instant (2 s each)
  const MAX_ATTEMPTS = 7;
  // Used only after a timeout — API was busy, back off gradually
  const TIMEOUT_RETRY_DELAYS = [3000, 6000, 12000, 20000, 20000, 20000];
  // Used after an explicit API error — recreate the task quickly
  const FAIL_RETRY_DELAY = 2000;

  let lastFailedExplicitly = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (shouldStop()) return null;
    if (attempt > 0) {
      const delay = lastFailedExplicitly
        ? FAIL_RETRY_DELAY
        : (TIMEOUT_RETRY_DELAYS[attempt - 1] ?? 20000);
      const reason = lastFailedExplicitly ? "explicit fail → fast retry" : "timeout → backoff";
      console.log(`[GENIMG] attempt ${attempt + 1}/${MAX_ATTEMPTS} (${reason}), waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      if (shouldStop()) return null;
    }
    lastFailedExplicitly = false; // reset for this attempt

    try {
      // --- Step 1: create task (retry create up to 3x on 5xx/network err) ---
      let createBody: any = null;
      for (let cr = 0; cr < 3; cr++) {
        if (cr > 0) await new Promise((r) => setTimeout(r, 3000));
        try {
          const createResp = await fetch(NANO_BANANA_CREATE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${KIE_API_KEY}` },
            body: JSON.stringify({
              model: "gpt-image-2-text-to-image",
              input: { prompt, aspect_ratio: aspectRatio, resolution: "2K" },
            }),
          });
          if (createResp.status >= 500 && cr < 2) {
            console.warn(`[GENIMG] create HTTP ${createResp.status}, retrying create...`);
            continue;
          }
          createBody = await createResp.json();
          break;
        } catch (netErr: any) {
          console.warn(`[GENIMG] create network error (cr=${cr}):`, netErr?.message);
          if (cr >= 2) break;
        }
      }

      if (!createBody || createBody.code !== 200 || !createBody.data?.taskId) {
        console.warn(`[GENIMG] create failed (attempt ${attempt + 1}):`, createBody?.msg);
        lastFailedExplicitly = true; // create rejected → fast retry
        continue;
      }

      // --- Step 2: poll until done or 3-min per-task deadline ---
      const taskId = createBody.data.taskId;
      const deadline = Date.now() + 180000;
      let taskFailed = false;
      while (Date.now() < deadline) {
        if (shouldStop()) return null;
        await new Promise((r) => setTimeout(r, 3000));
        let statusBody: any = null;
        try {
          const statusResp = await fetch(`${NANO_BANANA_STATUS_URL}?taskId=${taskId}`, {
            headers: { "Authorization": `Bearer ${KIE_API_KEY}` },
          });
          statusBody = await statusResp.json();
        } catch (pollErr: any) {
          console.warn("[GENIMG] poll network error:", pollErr?.message);
          continue;
        }
        if (!statusBody || statusBody.code !== 200) continue;
        const state = statusBody.data?.state;
        if (state === "success") {
          const result = JSON.parse(statusBody.data.resultJson);
          const urls = result.resultUrls || [];
          if (!urls[0]) { taskFailed = true; lastFailedExplicitly = true; break; }
          const imgResp = await fetch(urls[0]);
          if (!imgResp.ok) { taskFailed = true; lastFailedExplicitly = true; break; }
          const buf = Buffer.from(await imgResp.arrayBuffer());
          return await uploadToObjectStorage(buf, "image/jpeg", "jpg");
        }
        if (state === "fail" || state === "failed" || state === "error") {
          // KIE returned explicit error — recreate task quickly
          console.warn(`[GENIMG] task failed (attempt ${attempt + 1}):`, statusBody.data?.failMsg);
          taskFailed = true;
          lastFailedExplicitly = true;
          break;
        }
      }
      if (!taskFailed) {
        // Deadline exceeded without a fail/success signal — API is slow, back off
        console.warn(`[GENIMG] task timed out (attempt ${attempt + 1})`);
        // lastFailedExplicitly stays false → TIMEOUT_RETRY_DELAYS applied next iteration
      }
      // fall through to next attempt
    } catch (e: any) {
      console.warn(`[GENIMG] error (attempt ${attempt + 1}):`, e?.message || e);
      lastFailedExplicitly = true; // unexpected exception → fast retry
    }
  }

  console.warn("[GENIMG] all attempts exhausted, using gradient placeholder");
  return null;
}

// Deterministic gradient SVG used as a graceful fallback when AI image
// generation fails or the per-request cap / credit balance is exceeded.
function gradientPlaceholderDataUri(seed: string): string {
  const palettes = [
    ["#6366f1", "#8b5cf6"], ["#0ea5e9", "#06b6d4"], ["#f59e0b", "#ef4444"],
    ["#10b981", "#14b8a6"], ["#ec4899", "#8b5cf6"], ["#3b82f6", "#22d3ee"],
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const [c1, c2] = palettes[h % palettes.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// Scan assembled page code for {{GENIMG:prompt|ratio}} markers, generate the
// images via GPT Image 2 (bounded concurrency + credit check per image), upload
// to object storage, save to the project library, and replace markers in-place.
async function resolveGenImgMarkers(
  filesMap: Map<string, string>,
  projectId: number,
  userId: number | undefined,
  runKey: string,
  res: any,
  isAborted: () => boolean = () => false,
): Promise<{ generated: number; creditsUsed: number }> {
  const GENIMG_RE = /\{\{GENIMG:([^}]+)\}\}/g;
  const markers = new Map<string, { prompt: string; ratio: string }>();
  for (const code of Array.from(filesMap.values())) {
    let m: RegExpExecArray | null;
    GENIMG_RE.lastIndex = 0;
    while ((m = GENIMG_RE.exec(code)) !== null) {
      const raw = m[1].trim();
      if (markers.has(raw)) continue;
      const parts = raw.split("|");
      const promptText = parts[0].trim();
      let ratio = (parts[1] || "").trim();
      if (!/^\d+:\d+$/.test(ratio)) ratio = "16:9";
      markers.set(raw, { prompt: promptText, ratio });
    }
  }
  // Always run the replacement pass below so no {{GENIMG:...}} marker can ever
  // survive into saved/deployed HTML, even if there are zero plannable markers.
  const entries = Array.from(markers.entries());
  const planned = entries.slice(0, MAX_AUTO_IMAGES);
  const urlMap = new Map<string, string>();
  let generated = 0;
  let creditsUsed = 0;
  let outOfCredits = false;
  const total = planned.length;
  // 7 minutes total budget for all images (all run in parallel)
  const phaseDeadline = Date.now() + 420000;

  const finalize = () => {
    for (const [filename, code] of Array.from(filesMap.entries())) {
      const newCode = code.replace(/\{\{GENIMG:([^}]+)\}\}/g, (_full, inner) => {
        const key = inner.trim();
        return urlMap.get(key) ?? gradientPlaceholderDataUri(key);
      });
      filesMap.set(filename, newCode);
    }
  };

  if (total === 0) { finalize(); return { generated: 0, creditsUsed: 0 }; }

  try { res.write(`data: ${JSON.stringify({ status: `Генерирую изображения (0/${total})...` })}\n\n`); } catch {}

  // Worker that processes an ordered list of (raw, parsed) entries
  const runWorkerBatch = async (
    batch: Array<[string, { prompt: string; ratio: string }]>,
    passLabel: string,
  ) => {
    let idx = 0;
    let done = 0;
    const worker = async () => {
      while (true) {
        const myIdx = idx++;
        if (myIdx >= batch.length) return;
        const [raw, parsed] = batch[myIdx];
        // Skip if already successfully resolved in a prior pass
        if (urlMap.has(raw) && !urlMap.get(raw)!.startsWith("data:")) return;
        let resolvedUrl: string | null = null;

        if (!outOfCredits && !isAborted() && Date.now() < phaseDeadline) {
          let billed = false;
          let proceed = true;
          if (userId) {
            const ikey = `auto-img-${projectId}-${runKey}-${crypto.createHash("md5").update(raw).digest("hex").slice(0, 8)}`;
            const ded = await storage.deductCredits(userId, AUTO_IMAGE_COST, "image", ikey);
            if (!ded.success) {
              outOfCredits = true;
              proceed = false;
            } else if (ded.alreadyProcessed) {
              billed = false; // already charged in a prior attempt — safe to retry generation
            } else {
              billed = true;
            }
          }
          if (proceed) {
            const url = await generateGptImage(parsed.prompt, parsed.ratio, () => isAborted() || Date.now() >= phaseDeadline);
            if (url) {
              resolvedUrl = url;
              generated++;
              if (billed) creditsUsed += AUTO_IMAGE_COST;
              try {
                const proj = await storage.getProject(projectId);
                const name = (parsed.prompt.trim().split(/\s+/).slice(0, 3).join("_").replace(/[^a-zA-Z0-9_а-яА-Я-]/g, "") || `img_${myIdx}`).slice(0, 40);
                await storage.createProjectImage({ projectId, userId: proj?.userId, name, url, prompt: parsed.prompt.substring(0, 200) });
              } catch (e) { /* library save is best-effort */ }
            } else if (billed && userId) {
              try { await storage.refundCredits(userId, AUTO_IMAGE_COST); } catch {}
            }
          }
        }

        urlMap.set(raw, resolvedUrl ?? gradientPlaceholderDataUri(raw));
        done++;
        const successSoFar = Array.from(urlMap.values()).filter(v => !v.startsWith("data:")).length;
        try { res.write(`data: ${JSON.stringify({ status: `${passLabel}: изображения (${successSoFar}/${total})...` })}\n\n`); } catch {}
      }
    };
    await Promise.all(Array.from({ length: batch.length }, () => worker()));
  };

  // Pass 1 — generate all images
  await runWorkerBatch(planned, "Генерирую изображения");

  // Pass 2 — retry any that failed (got a gradient placeholder), if time remains
  if (!isAborted() && Date.now() < phaseDeadline) {
    const failed = planned.filter(([raw]) => {
      const v = urlMap.get(raw);
      return !v || v.startsWith("data:"); // gradient SVG = failed
    });
    if (failed.length > 0) {
      console.log(`[GENIMG] retry pass: ${failed.length} failed image(s) — retrying...`);
      try { res.write(`data: ${JSON.stringify({ status: `Повторяю генерацию для ${failed.length} изображений...` })}\n\n`); } catch {}
      // Clear failed entries so worker will retry them
      for (const [raw] of failed) urlMap.delete(raw);
      await runWorkerBatch(failed, "Повтор изображений");
    }
  }

  finalize();
  return { generated, creditsUsed };
}

type KieContentItem =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

type KieMessage = { role: "user" | "assistant" | "developer" | "system"; content: KieContentItem[] };

async function kieGenerateSync(
  messages: KieMessage[],
  systemPrompt: string
): Promise<string> {
  const input: KieMessage[] = [
    { role: "developer", content: [{ type: "input_text", text: systemPrompt }] },
    ...messages,
  ];
  const resp = await fetch(KIE_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_API_KEY}` },
    body: JSON.stringify({ model: KIE_LLM_MODEL, stream: false, input, reasoning: { effort: "medium" } }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`KIE API error ${resp.status}: ${err}`);
  }
  const data = await resp.json() as any;
  for (const item of data.output || []) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === "output_text" && c.text) return c.text as string;
      }
    }
  }
  return "";
}

async function* kieGenerateStream(
  messages: KieMessage[],
  systemPrompt: string,
  reasoningEffort: "low" | "medium" | "high" | "xhigh" = "high"
): AsyncGenerator<string> {
  const input: KieMessage[] = [
    { role: "developer", content: [{ type: "input_text", text: systemPrompt }] },
    ...messages,
  ];
  const resp = await fetch(KIE_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_API_KEY}` },
    body: JSON.stringify({ model: KIE_LLM_MODEL, stream: true, input, reasoning: { effort: reasoningEffort } }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`KIE API error ${resp.status}: ${errText}`);
  }
  const reader = (resp.body as any).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventType = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") return;
        if (eventType === "response.output_text.delta") {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.delta) yield parsed.delta as string;
          } catch {}
        }
      } else if (line === "") {
        eventType = "";
      }
    }
  }
}

async function* geminiGenerateStream(
  messages: KieMessage[],
  systemPrompt: string
): AsyncGenerator<string> {
  const contents: any[] = [];
  for (const msg of messages) {
    if (msg.role === "developer" || msg.role === "system") continue;
    const role = msg.role === "assistant" ? "model" : "user";
    const parts = msg.content.map((c: any) => {
      if (c.type === "input_text") return { text: c.text };
      if (c.type === "input_image") return { text: `[Image URL: ${c.image_url}]` };
      return { text: "" };
    }).filter((p: any) => p.text);
    if (parts.length > 0) contents.push({ role, parts });
  }

  const body: any = {
    stream: true,
    contents,
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const resp = await fetch(KIE_GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${KIE_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini KIE error ${resp.status}: ${errText.slice(0, 400)}`);
  }

  const reader = (resp.body as any).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // KIE streams either as raw JSON lines or SSE "data: {...}"
      const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr);
        // Extract text from each streaming chunk
        for (const part of parsed?.candidates?.[0]?.content?.parts ?? []) {
          if (part.text) yield part.text as string;
        }
      } catch { /* incomplete chunk — buffered in next iteration */ }
    }
  }
  // Flush any remaining buffer
  if (buffer.trim()) {
    const jsonStr = buffer.trim().startsWith("data: ") ? buffer.trim().slice(6) : buffer.trim();
    try {
      const parsed = JSON.parse(jsonStr);
      for (const part of parsed?.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) yield part.text as string;
      }
    } catch {}
  }
}

const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
const WAVESPEED_3D_URL = "https://api.wavespeed.ai/api/v3/wavespeed-ai/hunyuan3d-v3/image-to-3d";
const MODEL_3D_COST = 100;

const PLAN_PUBLISH_LIMITS: Record<string, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 5,
  free: 0,
};

const DAILY_PUBLISH_COST = 20;

const SYSTEM_PROMPT = `Ты — креативный frontend-разработчик мирового уровня. Генерируй полные HTML-документы.

⚡ ГЛАВНОЕ ПРАВИЛО — СВОБОДА И УНИКАЛЬНОСТЬ:
Ты — опытный дизайнер с собственным вкусом. НЕ используй шаблоны и заготовки.
Для каждого сайта придумай дизайн с нуля: цвета, шрифты, структуру, стиль анимаций — всё сам, исходя из темы.
Доверяй своей творческой интуиции. Удиви.

ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ:
- Полный HTML: <!DOCTYPE html>, <head> с <style>, <body>, <script> перед </body>
- Чистый HTML/CSS/JS — БЕЗ внешних CDN и библиотек
- Мета-теги: description, viewport, charset, Open Graph

⚠️ ОБЯЗАТЕЛЬНАЯ МОБИЛЬНАЯ АДАПТИВНОСТЬ (КРИТИЧНО!):
- ВСЕГДА включай <meta name="viewport" content="width=device-width, initial-scale=1.0"> в <head>
- Mobile-first подход: сначала пиши стили для мобильных, потом @media (min-width: 768px) для tablet, @media (min-width: 1024px) для desktop
- Минимум 3 брейкпоинта: ≤640px (mobile), 641-1023px (tablet), ≥1024px (desktop)
- Все шрифты через clamp(): font-size: clamp(14px, 2.5vw, 18px) — никаких фиксированных px для текста
- Hero-заголовки: clamp(28px, 7vw, 72px) — чтобы помещались на мобильных без обрезания
- Контейнеры: max-width + padding в % или vw, никаких фиксированных width в px
- На мобильных (≤768px): grid и многоколоночные секции → grid-template-columns: 1fr (одна колонка)
- Навигация: на мобильных гамбургер-меню (работающее на JS) или вертикальный стек, никогда не оставляй desktop-навбар на телефоне
- Картинки: max-width: 100%; height: auto; для всех <img>
- Кнопки и интерактивные элементы: min-height: 44px на тач-устройствах
- Отступы секций: padding clamp(40px, 8vw, 120px) — чтобы на мобильных не было гигантских пустот
- НИКАКИХ горизонтальных скроллов на любом размере (overflow-x: hidden на body как страховка)
- Тестируй мысленно на 375px ширины — сайт ОБЯЗАН выглядеть отлично
- Все тексты на русском языке, если не указано иное
- НЕ используй lorem ipsum — пиши реальный контент по теме
- Код должен быть полным и production-ready, НЕ обрезай секции

⚠️ ТИПОГРАФИЯ И ЧИТАЕМОСТЬ (КРИТИЧНО — НАРУШЕНИЕ ЗАПРЕЩЕНО):
ЗАПРЕЩЁННЫЕ ПАТТЕРНЫ — НИКОГДА не делай следующее:
- ❌ Узкая "штора": тёмный полупрозрачный прямоугольник/панель с текстом, который занимает только 30-50% ширины hero — это убивает читаемость
- ❌ Текст внутри тёмной карточки поверх фонового фото на весь экран — текст не читается
- ❌ Один и тот же паттерн "текст слева 45% + фото справа 55%" на КАЖДОЙ секции — это однообразно и некрасиво
- ❌ Font-size для body/абзацев меньше 16px — мелкий текст нечитаем
- ❌ Line-height меньше 1.6 для абзацев — строки слипаются
- ❌ Max-width текстового блока больше 720px — слишком длинные строки трудно читать
- ❌ Белый или светлый текст на светлом фоне без достаточного контраста

ПРАВИЛЬНЫЕ ПАТТЕРНЫ — ВСЕГДА используй:
- ✅ HERO: полноширинный фон (фото/градиент/видео), текст по центру или слева с max-width 700px, padding достаточный, контрастный цвет текста относительно фона
- ✅ Если hero двухколоночный: левая колонка с текстом min 50%, font-size абзацев ≥ 16px, line-height 1.7
- ✅ СЕКЦИИ с текстом: контейнер max-width 1200px, padding 0 5%, текстовые блоки max-width 700px, шрифт ≥ 16px
- ✅ Чередуй layouts: одна секция — текст по центру на всю ширину; другая — 2 колонки; третья — карточки grid; не повторяй один шаблон подряд
- ✅ КОНТРАСТ: тёмный текст (#1a1a1a, #2d2d2d) на светлом фоне ИЛИ светлый (#f0f0f0, #fff) на тёмном — проверяй каждую секцию
- ✅ body/p: font-size: clamp(16px, 2vw, 18px); line-height: 1.7; color: наследуй от корневого
- ✅ h2 секций: font-size: clamp(28px, 4vw, 48px); margin-bottom: 1rem
- ✅ Абзацы: margin-bottom: 1.2em, max-width: 680px, не давай им занимать всю ширину без ограничения

СТРУКТУРА HERO — выбирай ОДИН из вариантов (не один и тот же каждый раз):
  Вариант A: Центрированный — текст по центру на весь экран, фоновый градиент или фото с overlay opacity ≤ 0.55
  Вариант B: Раздельный — левая часть (55%) чистый цветной/градиентный фон + текст, правая часть (45%) большая фотография
  Вариант C: Полноэкранное фото — текст сверху/снизу с широкой читаемой подложкой (blur + rgba), НЕ узкий прямоугольник

МНОГОСТРАНИЧНЫЕ САЙТЫ:
Если пользователь просит несколько страниц — создай ОТДЕЛЬНЫЕ HTML-файлы:
- Главная: index.html, доп. страницы: about.html, contacts.html и т.д.
- Каждая страница — полный HTML-документ с полным CSS

⚠️ КРИТИЧНО — ЕДИНЫЙ HEADER И FOOTER:
- Сначала создай index.html с полным <header>/<nav> и <footer>
- Затем ТОЧНО СКОПИРУЙ header и footer из index.html во ВСЕ остальные страницы — ПОБАЙТНО ИДЕНТИЧНЫЙ HTML-код
- Навбар должен содержать ОДИНАКОВЫЕ пункты меню, ОДИНАКОВЫЕ стили, ОДИНАКОВУЮ структуру на КАЖДОЙ странице
- Футер должен быть АБСОЛЮТНО ОДИНАКОВЫЙ на всех страницах
- Единственное отличие — класс активной ссылки (подсветка текущей страницы)
- Если на index.html есть кнопка "Бронь" в навбаре — она ОБЯЗАНА быть на ВСЕХ страницах
- НЕ упрощай и НЕ сокращай навбар/футер на вторичных страницах

- Формат ответа:
--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html><html>...</html>
\`\`\`
--- FILE: about.html ---
\`\`\`html
<!DOCTYPE html><html>...</html>
\`\`\`

При РЕДАКТИРОВАНИИ:
- Одна страница → только она с маркером --- FILE:
- Навбар/футер → все страницы с обновлениями

⚠️ ИЗОБРАЖЕНИЯ (КРИТИЧНО — НАРУШЕНИЕ ЗАПРЕЩЕНО):
- ВСЕГДА вставляй настоящие фото через <img src="URL"> — НИКОГДА не используй div/section с градиентом вместо фото.
- Все КОНТЕНТНЫЕ фото генерируй через маркер: {{GENIMG:<детальный промпт на английском>|<соотношение>}}

ПРАВИЛА СОСТАВЛЕНИЯ ПРОМПТА ДЛЯ {{GENIMG}} — КАЖДЫЙ ПРОМПТ ОБЯЗАН СОДЕРЖАТЬ ВСЕ 4 КОМПОНЕНТА:
  1. ТЕМА/ОБЪЕКТ: что конкретно изображено (должно точно соответствовать нише и смыслу секции)
     - hero ресторана → "elegant restaurant interior with dim lighting, fine dining table setting"
     - карточка IT-продукта → "developer working on code on modern laptop, clean desk setup"
     - hero стоматологии → "bright modern dental clinic reception, friendly dentist smiling"
  2. ВИЗУАЛЬНЫЙ СТИЛЬ (вытащи из дизайна сайта): тёмный/светлый, минимальный/насыщенный, luxury/tech/organic/etc.
     - тёмный сайт → добавь "dark moody atmosphere, deep shadows, cinematic lighting"
     - светлый минимализм → "bright airy, soft natural light, clean white background"
     - luxury → "premium, sophisticated, editorial quality"
  3. НАСТРОЕНИЕ + ОСВЕЩЕНИЕ: эмоция, цветовая температура, источник света
  4. КАЧЕСТВО: всегда добавляй "photorealistic, high resolution, professional photography"

  Примеры правильных промптов:
  - Герой для тёмного сайта спа: {{GENIMG:luxury spa treatment room, dark moody atmosphere, warm golden candlelight, premium black marble surfaces, serene calm mood, photorealistic, professional photography|16:9}}
  - Карточка юридической фирмы на светлом сайте: {{GENIMG:confident professional lawyer in modern bright office, natural light, clean minimal interior, trust and expertise mood, photorealistic, high resolution|1:1}}
  - Галерея строительной компании: {{GENIMG:modern residential building under construction, aerial view, sunny day, professional architecture photography, photorealistic|4:3}}

  Соотношение (после "|"): 16:9 (hero, баннеры, широкие секции), 1:1 (карточки, аватары, квадратные блоки), 4:3 (стандартные карточки), 3:4 (портретные), 9:16 (мобильный hero). По умолчанию 16:9.
  Ставь маркер прямо в src: <img src="{{GENIMG:...промпт...}}" alt="описание" style="width:100%;height:100%;object-fit:cover;display:block;">
  КРИТИЧНО — контейнер для GENIMG-изображения ОБЯЗАН иметь явные размеры через aspect-ratio. Соотношение в CSS = соотношению в {{GENIMG}}:
    16:9 → style="width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:..."
    1:1  → style="width:100%;aspect-ratio:1/1;overflow:hidden;..."
    4:3  → style="width:100%;aspect-ratio:4/3;overflow:hidden;..."
    3:4  → style="width:100%;aspect-ratio:3/4;overflow:hidden;..."
  Если контейнер имеет фиксированную высоту (height:300px) — НЕ используй aspect-ratio, используй height напрямую. Главное: img внутри ВСЕГДА имеет width:100%;height:100%;object-fit:cover.
  GPT Image 2 ХОРОШО рисует ТЕКСТ — можешь вписать нужный текст прямо в промпт ("poster with bold text 'SALE 50%'"). Используй текст в картинках УМЕРЕННО.

- ЛИМИТ: не больше 6 маркеров {{GENIMG:...}} на запрос — выбирай САМЫЕ важные визуалы (hero + 2-4 ключевые секции). Для остального используй CSS-градиенты и inline SVG.
- НИКОГДА не используй Picsum, Unsplash или другие внешние/сток URL — только {{GENIMG:...}} для фото.
- Для фото, которые ЗАГРУЗИЛ пользователь (URL вида /uploads/... или /objects/...) — используй URL напрямую, НЕ оборачивай в {{GENIMG}}.
- Если в библиотеке уже есть подходящее изображение — используй маркер {{IMG:имя}}.
- Для иконок/декора — inline SVG, НЕ img-теги.

SEO И ОБЪЁМ КОНТЕНТА (КРИТИЧНО ДЛЯ ПРОДВИЖЕНИЯ):
Каждый сайт ОБЯЗАН иметь достаточный объём текстового контента для успешного SEO.

МИНИМАЛЬНЫЕ ТРЕБОВАНИЯ К ТЕКСТУ:
- Главная страница: не менее 1500–2500 слов реального текста (не считая навбар и футер)
- Дополнительные страницы: не менее 800–1200 слов каждая
- Каждая секция должна содержать развёрнутые абзацы, а не только заголовки и короткие фразы

СТРУКТУРА КОНТЕНТА НА ГЛАВНОЙ:
1. Hero-секция: заголовок H1 + подзаголовок 2-3 предложения (суть предложения, ключевые выгоды)
2. О компании/О нас: 3-5 абзацев с историей, миссией, ценностями, опытом (150-250 слов)
3. Услуги/Преимущества: каждый пункт — заголовок H3 + 2-3 полных предложения с деталями (не просто "быстро и качественно")
4. Как мы работаем / Процесс: пошаговое описание, каждый шаг 2-3 предложения
5. Почему мы / Цифры: конкретные факты, статистика, достижения с пояснениями
6. FAQ: минимум 6-8 вопросов, каждый ответ 2-4 предложения — это МОЩНЫЙ SEO-инструмент
7. Финальный CTA-блок: убедительный текст 3-5 предложений + призыв к действию

ПРАВИЛА НАПИСАНИЯ SEO-ТЕКСТА:
- Пиши развёрнуто и информативно: пользователь должен получить РЕАЛЬНУЮ ПОЛЬЗУ от чтения
- НЕ используй только маркированные списки — чередуй абзацы и списки
- Описания услуг должны включать: что это, кому подходит, как работает, что получит клиент
- Упоминай ключевые слова темы естественно по всему тексту (2-3 раза на каждое)
- Цифры и факты делают текст убедительнее: "более 500 клиентов", "средний срок — 3 дня"
- FAQ раздел: вопросы должны быть реальными (что спрашивают клиенты), ответы — полными

МЕТА-ТЕГИ (ОБЯЗАТЕЛЬНО):
- <title>: уникальный, 50-60 символов, содержит главный ключевой запрос + название
- <meta name="description">: 150-160 символов, привлекательный, с призывом к действию
- <meta property="og:title"> и <meta property="og:description">: для соцсетей
- <meta name="keywords">: 8-12 ключевых слов через запятую
- Все страницы имеют РАЗНЫЕ мета-теги

ЗАГОЛОВОЧНАЯ ИЕРАРХИЯ:
- Один H1 на страницу (главный ключевой запрос)
- 3-6 H2 (основные разделы страницы)
- H3 внутри каждого H2 (подпункты, карточки услуг, FAQ-вопросы)
- Все заголовки — ключевые фразы, не просто "Наши услуги" а "Профессиональный ремонт квартир в Москве"

ТЕХНИЧЕСКОЕ SEO В HTML:
- Alt-тексты у всех изображений: описательные, 5-10 слов с ключевым словом
- Семантические теги: <main>, <article>, <section>, <aside>, <nav>, <footer>
- Хлебные крошки (breadcrumbs) на внутренних страницах
- Structured data (JSON-LD schema.org): добавляй <script type="application/ld+json"> с разметкой Organisation/LocalBusiness/Service — это даёт расширенные сниппеты в Google
- Canonical: <link rel="canonical" href="URL страницы"> в каждом <head>
- Язык: <html lang="ru">

ФОРМЫ:
Все формы отправляют данные на API:
document.querySelectorAll('form[data-lead-form]').forEach(form => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = { name: fd.get('name')||'', email: fd.get('email')||'', phone: fd.get('phone')||'', message: fd.get('message')||'', source: form.dataset.leadForm||'form' };
    try {
      const r = await fetch('https://craft-ai.ru/api/leads/' + (window.__PROJECT_ID__ || '0'), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      if(r.ok) { form.reset(); }
    } catch(err) { console.error(err); }
  });
});
Оборачивай формы в <form data-lead-form="имя_формы">.`;

const RESEARCH_AND_ENHANCE_PROMPT = `Ты выполняешь ДВЕ задачи одновременно:

ЗАДАЧА 1 — ИССЛЕДОВАНИЕ: Собери реальную информацию по теме из результатов поиска:
- Основная информация, ключевые особенности (5-7), преимущества
- Технические детали, факты и цифры, цитаты/отзывы
- Ценообразование, целевая аудитория
Пиши ТОЛЬКО факты из источников. НЕ придумывай.

ЗАДАЧА 2 — УЛУЧШЕНИЕ ПРОМПТА: На основе найденных фактов, создай детальный промпт для AI-генератора premium-сайта:
- Skeuomorphic UI (реалистичные тени, глубина, стеклянные эффекты)
- Кастомные inline SVG анимации по теме (минимум 2 штуки)
- Плавные CSS transitions и scroll-анимации через IntersectionObserver
- Многослойные тени (2-3 уровня), glassmorphism, noise-текстуры
- Микро-интеракции: hover с подъёмом, scale, сменой теней
- Морфинг навбара: прозрачный → стеклянный при скролле
- Цветовую палитру (4 цвета), типографику, скругления
- Hero (100dvh) + минимум 5-7 секций + Footer
- Интерактивные элементы (счётчики, слайдеры, мини-дашборды)
- Реальные тематические фото через маркер {{GENIMG:промпт на английском|соотношение}} (hero-фон, карточки, галерея)

ФОРМАТ ОТВЕТА (строго!):
===RESEARCH===
[Структурированная информация из исследования]
===PROMPT===
[Улучшенный промпт 300-500 слов, только дизайн и контент, без технических инструкций вроде "используй HTML/CSS"]

Отвечай на русском языке.`;

async function enhancePromptOnly(query: string): Promise<{ enhancedPrompt: string; success: boolean }> {
  try {
    console.log("Starting prompt enhancement for:", query);

    const enhancedPrompt = await kieGenerateSync(
      [{ role: "user", content: [{ type: "input_text", text: `Тема сайта пользователя: "${query}"

Инструкция для тебя:
Ты — Universal Creative Director & Adaptive UI Engineer. Твоя задача — не просто пересказать шаблон, а ВДОХНОВИТЬСЯ им для создания уникальной концепции под конкретную тему пользователя.

ШАБЛОН ТВОЕГО МЫШЛЕНИЯ (Используй как ориентир, но адаптируй):
1. Identity: Ты визионер. Твоя цель — сайт на миллион долларов. Никакого "дефолта".
2. Phase 1: Reasoning. Проанализируй "Душу бренда" пользователя. Если это кафе — это уют или хай-тек? Если сервис — это надежность или скорость? Выбери уникальную Visual DNA (цветовую палитру и шрифтовую пару), которая подходит ИМЕННО ЭТОЙ теме.
3. Phase 2: Design Bible. Обязательно внедри:
   - Стеклянные эффекты (Glassmorphism), адаптированные под стиль.
   - SVG-анимации, которые имеют смысл для этой темы (например, летящие искры для кузницы или плавающие пузыри для напитков).
   - Сложные многослойные тени и Bento-сетку.
4. Phase 3: Polish. Массивная типографика, много "воздуха", премиальный темный режим по умолчанию.

ТВОЯ ЗАДАЧА:
Напиши детальный, вдохновляющий промпт (300-500 слов на русском) для AI-генератора кода. 
Этот промпт должен описывать структуру, дизайн и контент сайта так, чтобы AI-кодер выдал шедевр.
- НЕ копируй текст инструкции в ответ.
- НЕ используй фразы "Phase 1", "Phase 2". 
- Пиши живым языком дизайнера: опиши атмосферу, конкретные цвета HEX, типы анимаций и структуру секций.
- Сфокусируйся на УНИКАЛЬНОСТИ под тему "${query}".` }] }],
      "Ты — творческий директор и UI/UX эксперт. Отвечай только на русском языке."
    );

    console.log("Enhanced prompt length:", enhancedPrompt.length);
    return { enhancedPrompt: enhancedPrompt.trim().length > 100 ? enhancedPrompt.trim() : query, success: true };
  } catch (err: any) {
    console.error("Enhancement error:", err.message);
    return { enhancedPrompt: query, success: false };
  }
}

async function deepResearch(query: string): Promise<{ research: string; success: boolean }> {
  try {
    console.log("Starting Deep Research for:", query);

    const interaction = await gemini.interactions.create({
      input: `Исследуй тему "${query}" для создания premium-веб-сайта. Собери:\n- Основная информация, ключевые особенности (5-7), преимущества\n- Технические детали, факты и цифры, цитаты/отзывы\n- Ценообразование, целевая аудитория\n- Конкуренты и рыночные тренды\nПиши ТОЛЬКО факты из источников на русском языке. НЕ придумывай.`,
      agent: "deep-research-pro-preview-12-2025",
      background: true,
    } as any);

    console.log("Deep Research started, interaction ID:", (interaction as any).id);

    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const result = await gemini.interactions.get((interaction as any).id) as any;
      console.log(`Deep Research poll ${i + 1}/${maxAttempts}, status: ${result.status}`);

      if (result.status === "completed") {
        const text = result.outputs?.[result.outputs.length - 1]?.text || "";
        console.log("Deep Research completed, length:", text.length);
        return { research: text, success: true };
      }
      if (result.status === "failed") {
        console.error("Deep Research failed:", result.error);
        return { research: "", success: false };
      }
    }

    console.error("Deep Research timed out after", maxAttempts * 5, "seconds");
    return { research: "", success: false };
  } catch (err: any) {
    console.error("Deep Research error:", err.message);
    return { research: "", success: false };
  }
}

function requireAuth(req: any, res: any, next: any) {
  if (typeof req.isAuthenticated !== "function" || !req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Не авторизован" });
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const express = (await import("express")).default;
  app.use("/uploads", express.static(uploadsDir));

  registerObjectStorageRoutes(app);

  const ALLOWED_UPLOAD_MIMES: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp",
    "image/gif": "gif", "image/svg+xml": "svg",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogg",
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/ogg": "ogg", "audio/webm": "weba", "audio/aac": "aac", "audio/mp4": "m4a",
    "audio/x-m4a": "m4a", "audio/flac": "flac",
    "model/gltf-binary": "glb", "model/gltf+json": "gltf",
    "application/octet-stream": "glb",
  };
  const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
  const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
  const MAX_AUDIO_SIZE = 30 * 1024 * 1024;
  const MAX_3D_SIZE = 50 * 1024 * 1024;

  app.post("/api/upload-image", requireAuth, async (req, res) => {
    try {
      const { base64, mimeType, name } = req.body;
      if (!base64) return res.status(400).json({ message: "Нет данных файла" });
      const mime = (mimeType || "image/png").toLowerCase();
      const ext = ALLOWED_UPLOAD_MIMES[mime];
      if (!ext) return res.status(400).json({ message: "Неподдерживаемый формат файла" });
      const buffer = Buffer.from(base64, "base64");
      const isVideo = mime.startsWith("video/");
      const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
      if (buffer.length > maxSize) {
        return res.status(400).json({ message: `Файл слишком большой. Максимум: ${Math.round(maxSize / 1024 / 1024)} МБ` });
      }
      const url = await uploadToObjectStorage(buffer, mime, ext);
      res.json({ url, filename: name || `${crypto.randomUUID()}.${ext}` });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ message: "Ошибка загрузки файла" });
    }
  });

  const multer = (await import("multer")).default;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.max(MAX_VIDEO_SIZE, MAX_3D_SIZE) } });

  app.post("/api/upload-file", requireAuth, upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ message: "Файл не прикреплён" });
      let mime = file.mimetype.toLowerCase();
      const originalName = (file.originalname || "").toLowerCase();

      // Detect 3D model by extension when browser sends application/octet-stream
      let ext = ALLOWED_UPLOAD_MIMES[mime];
      if (!ext || (mime === "application/octet-stream" && !originalName.endsWith(".glb"))) {
        if (originalName.endsWith(".glb")) { ext = "glb"; mime = "model/gltf-binary"; }
        else if (originalName.endsWith(".gltf")) { ext = "gltf"; mime = "model/gltf+json"; }
        else if (!ext) return res.status(400).json({ message: "Неподдерживаемый формат файла" });
      }

      const is3D = ext === "glb" || ext === "gltf";
      const isVideo = mime.startsWith("video/");
      const isAudio = mime.startsWith("audio/");
      const maxSize = is3D ? MAX_3D_SIZE : isVideo ? MAX_VIDEO_SIZE : isAudio ? MAX_AUDIO_SIZE : MAX_IMAGE_SIZE;
      if (file.size > maxSize) {
        return res.status(400).json({ message: `Файл слишком большой. Максимум: ${Math.round(maxSize / 1024 / 1024)} МБ` });
      }
      const url = await uploadToObjectStorage(file.buffer, mime, ext);
      res.json({ url, filename: file.originalname || `${crypto.randomUUID()}.${ext}`, fileType: is3D ? "3d" : isVideo ? "video" : isAudio ? "audio" : "image" });
    } catch (err) {
      console.error("Upload file error:", err);
      res.status(500).json({ message: "Ошибка загрузки файла" });
    }
  });

  app.get("/api/projects", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const userProjects = await storage.getProjectsByUser(user.id);
      res.json(userProjects);
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки проектов" });
    }
  });

  app.get("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) {
        return res.status(404).json({ message: "Проект не найден" });
      }
      const user = req.user as any;
      if (project.userId !== user.id) {
        return res.status(403).json({ message: "Доступ запрещён" });
      }
      res.json(project);
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки проекта" });
    }
  });

  app.post("/api/projects", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { title, description } = req.body;
      const project = await storage.createProject({
        userId: user.id,
        title: title || "Новый проект",
        description: description || null,
        generatedCode: "",
      });
      res.status(201).json(project);
    } catch (err) {
      res.status(500).json({ message: "Ошибка создания проекта" });
    }
  });

  app.delete("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) {
        return res.status(404).json({ message: "Проект не найден" });
      }
      const user = req.user as any;
      if (project.userId !== user.id) {
        return res.status(403).json({ message: "Доступ запрещён" });
      }
      await storage.deleteProject(project.id);
      res.json({ message: "Проект удалён" });
    } catch (err) {
      res.status(500).json({ message: "Ошибка удаления проекта" });
    }
  });

  app.post("/api/enhance-prompt", requireAuth, aiLimiter, async (req, res) => {
    try {
      const { prompt, idempotencyKey } = req.body;
      const user = req.user as any;
      if (!prompt || prompt.trim().length < 3) {
        return res.status(400).json({ message: "Введите описание для улучшения" });
      }
      const ENHANCE_COST = 5;
      const ikey = idempotencyKey || `enhance-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const deduction = await storage.deductCredits(user.id, ENHANCE_COST, "enhance", ikey);
      if (!deduction.success) {
        return res.status(402).json({ message: `Недостаточно токенов. Нужно ${ENHANCE_COST}, у вас ${deduction.newBalance}.`, newBalance: deduction.newBalance });
      }
      const result = await enhancePromptOnly(prompt);
      if (result.success) {
        res.json({ enhancedPrompt: result.enhancedPrompt, creditsUsed: ENHANCE_COST, newBalance: deduction.newBalance });
      } else {
        res.json({ enhancedPrompt: prompt, creditsUsed: 0, newBalance: deduction.newBalance, warning: "AI временно недоступен, использован оригинальный промпт" });
      }
    } catch (err: any) {
      console.error("Enhance prompt error:", err.message);
      res.status(500).json({ message: "Ошибка улучшения промпта" });
    }
  });

  app.post("/api/deep-research", requireAuth, aiLimiter, async (req, res) => {
    try {
      const { prompt, idempotencyKey } = req.body;
      const user = req.user as any;
      if (!prompt || prompt.trim().length < 3) {
        return res.status(400).json({ message: "Введите описание для исследования" });
      }
      const RESEARCH_COST = 10;
      const ikey = idempotencyKey || `research-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const deduction = await storage.deductCredits(user.id, RESEARCH_COST, "deep-research", ikey);
      if (!deduction.success) {
        return res.status(402).json({ message: `Недостаточно токенов. Нужно ${RESEARCH_COST}, у вас ${deduction.newBalance}.`, newBalance: deduction.newBalance });
      }
      const result = await deepResearch(prompt);
      if (result.success) {
        res.json({ research: result.research, creditsUsed: RESEARCH_COST, newBalance: deduction.newBalance });
      } else {
        res.json({ research: "", creditsUsed: 0, newBalance: deduction.newBalance, warning: "Deep Research временно недоступен" });
      }
    } catch (err: any) {
      console.error("Deep research error:", err.message);
      res.status(500).json({ message: "Ошибка Deep Research" });
    }
  });

  app.get("/api/projects/:id/messages", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) {
        return res.status(404).json({ message: "Проект не найден" });
      }
      const user = req.user as any;
      if (project.userId !== user.id) {
        return res.status(403).json({ message: "Доступ запрещён" });
      }
      const messages = await storage.getProjectMessages(project.id);
      res.json(messages);
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки сообщений" });
    }
  });

  app.post("/api/projects/:id/generate", requireAuth, aiLimiter, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) {
        return res.status(404).json({ message: "Проект не найден" });
      }
      const user = req.user as any;
      if (project.userId !== user.id) {
        return res.status(403).json({ message: "Доступ запрещён" });
      }

      let clientGone = false;
      req.on("close", () => { clientGone = true; });

      const GENERATION_COST = 100;

      const { prompt, images, imageBase64, imageMimeType, activeFile, skipEnhance, deepResearchData, idempotencyKey, multiPagesData, seoH1, seoH2s, mockupMode, imageUrls, videoUrls, modelUrls, audioUrls, leadForm, agentVersion, interactiveMode, interactiveStyle, interactiveProductImageUrl } = req.body;
      // Make product image URL absolute so external services (Kling) can fetch it
      let absoluteProductImageUrl: string | undefined = undefined;
      if (interactiveProductImageUrl && typeof interactiveProductImageUrl === "string") {
        if (interactiveProductImageUrl.startsWith("http")) {
          absoluteProductImageUrl = interactiveProductImageUrl;
        } else {
          const proto = req.protocol;
          const host = req.get("host") || "";
          absoluteProductImageUrl = `${proto}://${host}${interactiveProductImageUrl}`;
        }
      }
      const useGemini = agentVersion === "v2" || !!interactiveMode;
      const leadFormEnabled = leadForm !== false && leadForm !== "0" && leadForm !== 0;
      const imageArray: Array<{base64: string, mimeType: string, fileName?: string}> = 
        Array.isArray(images) && images.length > 0 ? images 
        : imageBase64 ? [{ base64: imageBase64, mimeType: imageMimeType || "image/png" }] 
        : [];
      if (!prompt) {
        return res.status(400).json({ message: "Запрос обязателен" });
      }

      await storage.createProjectMessage({
        projectId: project.id,
        role: "user",
        content: prompt,
      });

      const genIkey = idempotencyKey || `gen-${project.id}-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const genDeduction = await storage.deductCredits(user.id, GENERATION_COST, "generate", genIkey);
      if (!genDeduction.success) {
        return res.status(402).json({ message: `Не хватает токенов. Нужно ${GENERATION_COST}, у вас ${genDeduction.newBalance}.`, newBalance: genDeduction.newBalance });
      }

      const reqProto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
      const reqHost = req.get("host") || "";
      const baseUrl = process.env.APP_BASE_URL || (reqHost ? `${reqProto}://${reqHost}` : "https://craft-ai.ru");

      const projectImgs = await storage.getProjectImages(project.id);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let researchData = deepResearchData || "";
      const isNewSite = !project.generatedCode;

      let enhancedPrompt = prompt;

      if (isNewSite) {
        res.write(`data: ${JSON.stringify({ status: "Генерируем сайт..." })}\n\n`);
      }

      let systemContent = SYSTEM_PROMPT;
      if (researchData) {
        systemContent += `\n\n═══ РЕЗУЛЬТАТЫ DEEP RESEARCH ═══\nИспользуй следующие РЕАЛЬНЫЕ факты и данные из исследования при создании контента сайта:\n${researchData}\n═══ КОНЕЦ ИССЛЕДОВАНИЯ ═══\n`;
      }
      if (multiPagesData && typeof multiPagesData === "string" && multiPagesData.trim()) {
        const pageList = multiPagesData.split(",").map((p: string) => p.trim()).filter(Boolean);
        const fileNames = pageList.map((p: string) => {
          const slug = p.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
          return `${slug}.html (${p})`;
        });
        systemContent += `\n\n═══ СТРУКТУРА САЙТА ═══\nСоздай МНОГОСТРАНИЧНЫЙ сайт. ОБЯЗАТЕЛЬНО сгенерируй ВСЕ перечисленные страницы:\n- index.html (главная)\n- ${fileNames.join("\n- ")}\nКаждая страница — полный отдельный HTML-документ. В навигации всех страниц должны быть ссылки на ВСЕ страницы. Используй формат --- FILE: имя.html --- для каждого файла.\n\n⚠️ HEADER/FOOTER: Сначала создай полный <header> и <footer> для index.html, затем СКОПИРУЙ ИХ ДОСЛОВНО во все остальные файлы. Все кнопки, ссылки и стили навбара и футера должны быть ИДЕНТИЧНЫ на каждой странице. Отличается только класс/стиль активной ссылки.\n═══ КОНЕЦ СТРУКТУРЫ ═══\n`;
      } else {
        systemContent += `\n\n⚠️ ОДНОСТРАНИЧНЫЙ РЕЖИМ: Создай ОДИН файл index.html. ЗАПРЕЩЕНО использовать маркеры --- FILE: --- или разбивать на несколько файлов. Весь сайт — один HTML-документ.`;
      }
      if (interactiveMode && isNewSite) {
        const isSplitLayout = interactiveStyle === "split";
        const hasProductImage = !!absoluteProductImageUrl;
        if (isSplitLayout) {
          systemContent += `\n\n═══ РЕЖИМ «ИНТЕРАКТИВНЫЙ — СПЛИТ» — ПРОДУКТ СПРАВА + ТЕКСТ СЛЕВА ═══
Этот сайт использует кинематографичную Hero-анимацию «Сплит»: видео с продуктом СПРАВА, текст СЛЕВА на однотонном фоне.

ПРАВИЛА:
1. НЕ создавай отдельную Hero-секцию. Маркер SCROLLANIM — это И ЕСТЬ Hero (полноэкранный).
2. ПЕРВЫМ ЭЛЕМЕНТОМ после <header> вставь РОВНО ОДИН маркер:
   {{SCROLLANIM:<видео-промпт>|<Заголовок1>::<Подзаголовок1>||<Заголовок2>::<Подзаголовок2>||<Заголовок3>::<Подзаголовок3>}}
3. ВИДЕО-ПРОМПТ обязан описывать: ПРОДУКТ НА ПРАВОЙ СТОРОНЕ кадра, ЛЕВЫЕ 55% кадра — ЧИСТЫЙ ОДНОТОННЫЙ ФОН (белый/бежевый/пастельный в тон теме). Формат: "${hasProductImage ? "product displayed on right side of frame, rotating slowly" : "ОПИСАНИЕ ПРОДУКТА on right side of frame, rotating slowly"}, left side clean solid [COLOR] background, no shadows crossing into left side, soft studio lighting, cinematic, no text". Примеры:
   - Крем: "luxury skincare cream jar on right side, slow 360 rotation, left two-thirds pure ivory background, cinematic"
   - Часы: "elegant watch on right side of frame, gears detail, left area soft cream background, cinematic"
   - Кофе: "coffee cup with steam on right, coffee beans, left side warm beige solid background, cinematic"
4. Тексты (РОВНО 3 пары) — НА РУССКОМ, короткие и продающие. Появляются по очереди СЛЕВА на однотонном фоне по мере скролла.
5. ⚠️ НЕ пиши код canvas сам — маркер заменяется автоматически.
6. Секции ПОСЛЕ маркера: преимущества, отзывы, CTA, форма, футер.
═══ КОНЕЦ СПЛИТ-РЕЖИМА ═══\n`;
        } else {
          systemContent += `\n\n═══ РЕЖИМ «ИНТЕРАКТИВНЫЙ» — КИНЕМАТОГРАФИЧНАЯ СКРОЛЛ-АНИМАЦИЯ ═══
Этот сайт ОБЯЗАН начинаться с полноэкранной скролл-анимации ("3D Sexy Scroll"): объект/продукт по теме сайта плавно движется и трансформируется по мере прокрутки, поверх него появляются и исчезают текстовые блоки. Это ЯВЛЯЕТСЯ Hero-секцией сайта.

ПРАВИЛА:
1. НЕ создавай отдельную Hero-секцию с обычным текстом/изображением. Маркер SCROLLANIM — это И ЕСТЬ Hero.
2. ПЕРВЫМ ЭЛЕМЕНТОМ после <header> (или сразу после <body>, если нет header) вставь РОВНО ОДИН маркер на отдельной строке:
   {{SCROLLANIM:<видео-промпт НА АНГЛИЙСКОМ>|<Заголовок1>::<Подзаголовок1>||<Заголовок2>::<Подзаголовок2>||<Заголовок3>::<Подзаголовок3>}}
3. Видео-промпт (на английском) описывает кинематографичную сцену по теме сайта на ЧИСТОМ БЕЛОМ ФОНЕ для бесшовной интеграции. Примеры:
   - Часовой магазин: "luxury mechanical watch slowly rotating, exploded view of gears floating apart, macro detail, cinematic"
   - Кофейня: "elegant cup of coffee with swirling cream, slow 360 rotation, coffee beans floating, cinematic"
   - Авто: "sports car slowly rotating, sleek reflections, dramatic studio lighting, cinematic"
   НЕ упоминай фон/освещение — это добавится автоматически.
4. Тексты (РОВНО 3 пары "Заголовок::Подзаголовок") — НА РУССКОМ, короткие и продающие. Это главные тезисы сайта — они появляются и плавно исчезают по мере скролла поверх видео.
5. ⚠️ НЕ пиши код canvas/анимации/кадров сам — маркер автоматически заменяется готовым полноэкранным интерактивным блоком.
6. Секции ПОСЛЕ маркера: преимущества, отзывы, CTA, форма, футер — как обычно.
═══ КОНЕЦ ИНТЕРАКТИВНОГО РЕЖИМА ═══\n`;
        }
      }
      if (seoH1 && typeof seoH1 === "string" && seoH1.trim()) {
        const h2List = seoH2s && typeof seoH2s === "string"
          ? seoH2s.split(",").map((h: string) => h.trim()).filter(Boolean)
          : [];
        systemContent += `\n\n═══ SEO ЗАГОЛОВКИ ═══\nИСПОЛЬЗУЙ ТОЧНО эти заголовки на главной странице:\n- H1: "${seoH1.trim()}"${h2List.length > 0 ? `\n- H2: ${h2List.map((h: string) => `"${h}"`).join(", ")}` : ""}\nЭти заголовки должны присутствовать в HTML текстом (не изображением), в тегах <h1> и <h2> соответственно.\n═══ КОНЕЦ SEO ═══\n`;
      }
      if (!leadFormEnabled) {
        systemContent += `\n\n═══ ФОРМЫ ═══\nНЕ добавляй форму обратной связи, лид-форму, форму заявки или любую форму сбора контактов на сайт. Если нужен CTA-блок — сделай его с кнопкой (например, ссылкой на телефон/email), но БЕЗ формы.\n═══ КОНЕЦ ФОРМ ═══\n`;
      }
      if (projectImgs.length > 0) {
        systemContent += `\n\nДОСТУПНЫЕ ИЗОБРАЖЕНИЯ В БИБЛИОТЕКЕ ПОЛЬЗОВАТЕЛЯ:\n`;
        for (const img of projectImgs) {
          if (img.url.startsWith("/uploads/") || img.url.startsWith("/objects/")) {
            systemContent += `- "${img.name}" — ПРЯМОЙ URL: ${img.url} (описание: ${img.prompt})\n`;
          } else {
            systemContent += `- "${img.name}" — маркер: {{IMG:${img.name}}} (описание: ${img.prompt})\n`;
          }
        }
        systemContent += `\nДля загруженных фото (с URL /uploads/... или /objects/...) — используй URL напрямую: <img src="URL" />\nДля изображений из библиотеки выше — используй маркер {{IMG:имя}}: <img src="{{IMG:имя}}" />\nДля НОВЫХ фото по теме (которых нет в библиотеке) — генерируй через {{GENIMG:промпт на английском|соотношение}} (см. правила изображений выше).`;
      }

      const videoArray: Array<{url: string, fileName: string}> = Array.isArray(videoUrls) ? videoUrls : [];
      if (videoArray.length > 0) {
        systemContent += `\n\n═══ ЗАГРУЖЕННЫЕ ВИДЕО ПОЛЬЗОВАТЕЛЯ ═══\nПользователь прикрепил видеофайлы. ОБЯЗАТЕЛЬНО встрой их на сайт с помощью тега <video>:\n`;
        for (const vid of videoArray) {
          systemContent += `- "${vid.fileName}" — URL: ${vid.url}\n`;
        }
        systemContent += `\nИспользуй тег <video> с атрибутами controls, playsinline, и при необходимости autoplay muted loop:\n<video src="${videoArray[0].url}" controls playsinline style="width:100%; max-width:800px; border-radius:12px;"></video>\n\nМожно использовать видео как:\n- Фоновое видео секции (autoplay muted loop, без controls)\n- Видеоплеер в контенте (с controls)\n- Hero-видео с наложением текста\nВыбери подходящий вариант исходя из контекста запроса пользователя.\n═══ КОНЕЦ ВИДЕО ═══\n`;
      }

      const modelArray: Array<{url: string, fileName: string}> = Array.isArray(modelUrls) ? modelUrls : [];
      if (modelArray.length > 0) {
        systemContent += `\n\n═══ ЗАГРУЖЕННЫЕ 3D МОДЕЛИ ПОЛЬЗОВАТЕЛЯ ═══\nПользователь прикрепил 3D модели (.glb/.gltf). ОБЯЗАТЕЛЬНО встрой их на сайт используя Google Model Viewer:\n`;
        for (const mdl of modelArray) {
          systemContent += `- "${mdl.fileName}" — URL: ${mdl.url}\n`;
        }
        systemContent += `\nДобавь в <head> скрипт: <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>\nЗатем встрой модель через тег <model-viewer>:\n<model-viewer src="${modelArray[0].url}" alt="${modelArray[0].fileName}" auto-rotate camera-controls shadow-intensity="1" style="width:100%;height:500px;background:#f0f0f0;border-radius:16px;"></model-viewer>\n\nИспользуй 3D модель как:\n- Интерактивный 3D-просмотрщик продукта\n- Hero-элемент с вращающейся моделью\n- Демонстрационный блок с управлением камерой\nВыбери подходящий вариант исходя из контекста.\n═══ КОНЕЦ 3D МОДЕЛЕЙ ═══\n`;
      }

      const uploadedImageArray: Array<{url: string, fileName: string}> = Array.isArray(imageUrls) ? imageUrls.filter((i: any) => i && i.url) : [];
      if (uploadedImageArray.length > 0) {
        systemContent += `\n\n═══ ЗАГРУЖЕННЫЕ ФОТО ПОЛЬЗОВАТЕЛЯ (ВЫСШИЙ ПРИОРИТЕТ) ═══\nПользователь загрузил эти фотографии. ОБЯЗАТЕЛЬНО встрой ИМЕННО ЭТИ фото на сайт через <img src="URL"> с указанными URL. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО заменять их на Unsplash, Picsum или другие сток-фото — используй только эти точные URL:\n`;
        for (const im of uploadedImageArray) {
          systemContent += `- "${im.fileName}" — URL: ${im.url}\n`;
        }
        systemContent += `\nПример: <img src="${uploadedImageArray[0].url}" alt="${uploadedImageArray[0].fileName}" style="width:100%;height:100%;object-fit:cover;">\nРазмести каждое фото в подходящей по смыслу секции (hero, галерея, о нас, товар и т.д.) согласно запросу пользователя. Если фото несколько — используй их ВСЕ.\n═══ КОНЕЦ ФОТО ═══\n`;
      }

      const audioArray: Array<{url: string, fileName: string}> = Array.isArray(audioUrls) ? audioUrls.filter((a: any) => a && a.url) : [];
      if (audioArray.length > 0) {
        systemContent += `\n\n═══ ЗАГРУЖЕННЫЕ АУДИО ПОЛЬЗОВАТЕЛЯ ═══\nПользователь прикрепил аудиофайлы. ОБЯЗАТЕЛЬНО встрой их на сайт с помощью тега <audio> с указанными URL:\n`;
        for (const aud of audioArray) {
          systemContent += `- "${aud.fileName}" — URL: ${aud.url}\n`;
        }
        systemContent += `\nИспользуй тег <audio> с атрибутом controls:\n<audio src="${audioArray[0].url}" controls style="width:100%;max-width:500px;"></audio>\n\nМожно использовать аудио как:\n- Аудиоплеер в секции (с controls)\n- Подкаст-блок или плейлист\n- Фоновую музыку с кнопкой вкл/выкл (НЕ автозапуск со звуком — браузеры блокируют)\nВыбери подходящий вариант исходя из контекста запроса.\n═══ КОНЕЦ АУДИО ═══\n`;
      }

      const isEditMode = !!project.generatedCode;
      const existingFiles = await storage.getProjectFiles(project.id);

      const stripBase64 = (code: string): { stripped: string; map: Map<string, string> } => {
        const map = new Map<string, string>();
        let counter = 0;
        const stripped = code.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g, (match) => {
          const placeholder = `__B64_${counter++}__`;
          map.set(placeholder, match);
          return placeholder;
        });
        return { stripped, map };
      };

      const restoreBase64 = (code: string, map: Map<string, string>): string => {
        let result = code;
        for (const [placeholder, original] of map) {
          result = result.split(placeholder).join(original);
        }
        return result;
      };

      let base64Map = new Map<string, string>();

      if (isEditMode) {
        const editingFile = activeFile || "index.html";
        const editingFileCodeRaw = editingFile === "index.html" 
          ? project.generatedCode 
          : existingFiles.find(f => f.filename === editingFile)?.code || project.generatedCode;

        const { stripped: editingFileCode, map } = stripBase64(editingFileCodeRaw || "");
        base64Map = map;
        console.log(`Stripped ${map.size} base64 images from code. Original: ${(editingFileCodeRaw||"").length} chars, Stripped: ${editingFileCode.length} chars`);

        systemContent += `\n\n${"═".repeat(43)}\nРЕЖИМ РЕДАКТИРОВАНИЯ — АКТИВНЫЙ ФАЙЛ: ${editingFile}\n${"═".repeat(43)}\nПользователь РЕДАКТИРУЕТ файл "${editingFile}". Все изменения должны применяться К ЭТОМУ ФАЙЛУ.\n\n⚠️ КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА РЕДАКТИРОВАНИЯ:\n1. ОБЯЗАТЕЛЬНО сохрани <nav> (навбар) со ВСЕМИ ссылками навигации\n2. ОБЯЗАТЕЛЬНО сохрани <footer>\n3. Изменять ТОЛЬКО то, что явно просит пользователь\n4. НЕ удалять, НЕ упрощать существующий код\n5. Плейсхолдеры __B64_N__ — это изображения. НЕ трогай и НЕ меняй их.\n\n🔧 ФОРМАТ ОТВЕТА — ИСПОЛЬЗУЙ DIFF-ПАТЧИ (НЕ полный код!):\n- Сначала 1-3 предложения о внесённых изменениях\n- Затем используй блоки SEARCH/REPLACE для каждого изменения:\n\n\`\`\`diff\n<<<<<<< SEARCH\nточный фрагмент существующего кода который нужно найти\n=======\nновый код на замену\n>>>>>>> REPLACE\n\`\`\`\n\nПравила SEARCH/REPLACE:\n- SEARCH блок должен ТОЧНО совпадать с фрагментом существующего кода (включая пробелы и отступы)\n- Включай достаточно контекста (5-15 строк) чтобы фрагмент был уникальным\n- Используй несколько блоков SEARCH/REPLACE для нескольких изменений\n- Для УДАЛЕНИЯ блока — оставь REPLACE пустым\n- Для ДОБАВЛЕНИЯ нового кода — в SEARCH укажи соседний существующий блок, в REPLACE — его же + новый код\n\n⚠️ ИСКЛЮЧЕНИЕ — используй ПОЛНЫЙ HTML (блок \`\`\`html) ТОЛЬКО если:\n- Пользователь просит переделать/переписать ВЕСЬ дизайн\n- Изменения затрагивают >50% файла\n- Пользователь просит изменить ВСЕ страницы (тогда используй маркеры --- FILE: имя.html ---)\n\n`;

        systemContent += `ТЕКУЩИЙ КОД РЕДАКТИРУЕМОГО ФАЙЛА (${editingFile}):\n\`\`\`html\n${editingFileCode}\n\`\`\`\n`;

        if (existingFiles.length > 0) {
          const otherFiles = editingFile === "index.html" 
            ? existingFiles 
            : [{ filename: "index.html", code: project.generatedCode }, ...existingFiles.filter(f => f.filename !== editingFile)];
          if (otherFiles.length > 0) {
            systemContent += `\nДРУГИЕ ФАЙЛЫ ПРОЕКТА (для справки, НЕ редактируй их без запроса):\n`;
            for (const f of otherFiles) {
              const code = 'code' in f ? f.code : '';
              systemContent += `- ${f.filename} (${(code || '').length} символов)\n`;
            }
          }
        }
      }

      const inputContent: any[] = [];
      const savedImageUrls: string[] = [];

      if (imageArray.length > 0) {
        for (const imgData of imageArray) {
          const mime = imgData.mimeType || "image/png";
          const isImage = mime.startsWith("image/");
          if (isImage) {
            const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "jpg";
            const buffer = Buffer.from(imgData.base64, "base64");
            const imageUrl = await uploadToObjectStorage(buffer, mime, ext);
            savedImageUrls.push(imageUrl);

            const imgName = imgData.fileName?.replace(/\.[^.]+$/, '').replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_') || `photo_${Date.now()}`;
            await storage.createProjectImage({
              projectId: project.id,
              userId: project.userId,
              name: imgName,
              url: imageUrl,
              prompt: prompt.substring(0, 200),
            });
            projectImgs.push({ id: 0, projectId: project.id, name: imgName, url: imageUrl, prompt: prompt.substring(0, 200), createdAt: new Date() } as any);
          }
        }

        let textPart = isEditMode ? prompt : enhancedPrompt;
        
        if (mockupMode && savedImageUrls.length > 0) {
          // ═══ ДВУХЭТАПНЫЙ ПРОЦЕСС: МАКЕТ → КОД ═══
          res.write(`data: ${JSON.stringify({ status: "Этап 1/2 — Анализ макета..." })}\n\n`);

          const analysisParts: any[] = [
            { text: `Ты — эксперт по UI/UX анализу. Проанализируй прикреплённый скриншот/макет дизайна сайта и создай ДЕТАЛЬНОЕ структурированное описание.

ФОРМАТ ОТВЕТА — строго JSON:
{
  "page_type": "landing / portfolio / ecommerce / blog / corporate / другое",
  "layout": {
    "structure": "описание общей структуры страницы (header, hero, секции, footer)",
    "grid": "тип сетки (одна колонка, 2-3 колонки, bento grid и т.д.)",
    "max_width": "примерная максимальная ширина контента в px"
  },
  "color_palette": {
    "background": "#hex основного фона",
    "text_primary": "#hex основного текста",
    "text_secondary": "#hex вторичного текста",
    "accent": "#hex акцентного цвета (кнопки, ссылки)",
    "accent_secondary": "#hex второго акцента если есть",
    "card_bg": "#hex фона карточек/блоков",
    "additional": ["#hex", "#hex"]
  },
  "typography": {
    "heading_font": "предполагаемый шрифт заголовков (serif/sans-serif/mono + конкретное предположение)",
    "body_font": "предполагаемый шрифт текста",
    "h1_size": "размер в px",
    "h2_size": "размер в px",
    "body_size": "размер в px",
    "heading_weight": "700/800/900",
    "letter_spacing": "нормальный / сжатый (-0.02em) / разрежённый"
  },
  "sections": [
    {
      "type": "header / hero / features / gallery / testimonials / pricing / cta / footer / другое",
      "description": "подробное описание секции",
      "elements": ["навбар с логотипом слева и меню справа", "заголовок H1 крупный по центру", "подзаголовок", "2 кнопки CTA"],
      "background": "тип фона (сплошной цвет, градиент, изображение, паттерн)",
      "layout_details": "flex row, grid 3 колонки, центрирование и т.д.",
      "spacing": "padding примерный в px"
    }
  ],
  "effects": {
    "shadows": "тип теней (нет, лёгкие, глубокие, цветные)",
    "border_radius": "скругления в px (0, 8, 16, 24, полные)",
    "glassmorphism": true/false,
    "gradients": "описание градиентов если есть",
    "animations": "описание анимаций если видны (hover эффекты и т.д.)"
  },
  "images": [
    {
      "location": "в какой секции",
      "type": "фото / иллюстрация / иконка / фон",
      "aspect_ratio": "16:9 / 1:1 / 4:3",
      "description": "что изображено"
    }
  ],
  "texts": {
    "headings": ["точный текст заголовка 1", "точный текст заголовка 2"],
    "paragraphs": ["точный текст параграфа 1"],
    "buttons": ["текст кнопки 1", "текст кнопки 2"],
    "nav_items": ["пункт меню 1", "пункт меню 2"]
  }
}

ВАЖНО:
- Определяй цвета МАКСИМАЛЬНО ТОЧНО по пикселям
- Извлекай ВСЕ тексты со скриншота (заголовки, абзацы, кнопки, меню)
- Описывай КАЖДУЮ секцию отдельно
- Указывай точные размеры и отступы где можно определить
- Если видно шрифт — попробуй определить его (Inter, Montserrat, Roboto, etc.)
- Верни ТОЛЬКО JSON, без пояснений` },
          ];

          for (const imgData of imageArray) {
            const mime = imgData.mimeType || "image/png";
            if (mime.startsWith("image/")) {
              analysisParts.push({ inlineData: { data: imgData.base64, mimeType: mime } });
            }
          }

          let designAnalysis = "";
          let analysisValid = false;
          try {
            const analysisImageContent: KieContentItem[] = analysisParts
              .filter((p: any) => p.inlineData)
              .map((_p: any, idx: number) => ({
                type: "input_image" as const,
                image_url: savedImageUrls[idx] ? `${baseUrl}${savedImageUrls[idx]}` : "",
              }))
              .filter((c: KieContentItem) => (c as any).image_url);
            console.log(`[KIE Mockup] Analyzing ${analysisImageContent.length} image(s):`, analysisImageContent.map((c: any) => c.image_url));
            const analysisTextContent: KieContentItem = {
              type: "input_text",
              text: (analysisParts.find((p: any) => p.text) as any)?.text || "",
            };
            const rawAnalysis = (await kieGenerateSync(
              [{ role: "user", content: [analysisTextContent, ...analysisImageContent] }],
              "Ты — эксперт по UI/UX анализу. Отвечай строго JSON без пояснений."
            )).trim();
            // Validate JSON
            try {
              JSON.parse(rawAnalysis);
              designAnalysis = rawAnalysis;
              analysisValid = true;
            } catch {
              // Try extracting JSON from markdown code block
              const jsonMatch = rawAnalysis.match(/```(?:json)?\s*([\s\S]*?)```/);
              if (jsonMatch) {
                JSON.parse(jsonMatch[1].trim());
                designAnalysis = jsonMatch[1].trim();
                analysisValid = true;
              } else {
                designAnalysis = rawAnalysis;
                analysisValid = false;
              }
            }
            // Truncate if too large (keep under 6000 chars to leave room for generation prompt)
            if (designAnalysis.length > 6000) {
              designAnalysis = designAnalysis.substring(0, 6000) + "\n...[обрезано]";
            }
            console.log("Mockup analysis completed, length:", designAnalysis.length, "valid JSON:", analysisValid);
          } catch (analysisError) {
            console.error("Mockup analysis failed:", analysisError);
            analysisValid = false;
          }

          res.write(`data: ${JSON.stringify({ status: "Этап 2/2 — Генерация кода..." })}\n\n`);

          if (analysisValid && designAnalysis) {
            textPart += `\n\n═══ РЕЖИМ "МАКЕТ → КОД" (Design-to-Code) — ДВУХЭТАПНЫЙ ═══

ЗАДАЧА: Воссоздай дизайн с прикреплённого скриншота как точный HTML/CSS/JS код.

СТРУКТУРИРОВАННЫЙ АНАЛИЗ МАКЕТА (JSON):
${designAnalysis}

КРИТИЧЕСКИЕ ПРАВИЛА ГЕНЕРАЦИИ:
1. НЕ вставляй скриншот как <img> — это МАКЕТ для воссоздания, а не контент
2. Используй ТОЧНЫЕ цвета из анализа (HEX-значения из color_palette)
3. Используй ТОЧНЫЕ тексты из анализа (все заголовки, параграфы, кнопки — как на макете)
4. Воссоздай ТОЧНУЮ структуру секций в правильном порядке
5. Соблюдай типографику: размеры, жирность, межбуквенное расстояние
6. Соблюдай отступы и пропорции как на макете
7. Для фотографий/иллюстраций из макета — генерируй через {{GENIMG:<промпт на английском>|<соотношение>}}: в промпт включи точную ТЕМУ ФОТО (что изображено + ниша сайта) + ВИЗУАЛЬНЫЙ СТИЛЬ из анализа (тёмный/светлый, luxury/minimal/tech) + настроение + "photorealistic, professional photography". НЕ div-placeholder, НЕ Picsum
8. Все интерактивные элементы (кнопки, ссылки, формы) должны быть функциональными
9. CSS: flexbox, grid, custom properties, hover-анимации, transitions
10. ⚠️ ОБЯЗАТЕЛЬНАЯ МОБИЛЬНАЯ АДАПТИВНОСТЬ: viewport meta, mobile-first @media, шрифты через clamp(), на ≤768px все grid → 1 колонка, навбар → гамбургер, картинки max-width:100%, кнопки min-height:44px, никаких горизонтальных скроллов. Сайт ОБЯЗАН отлично выглядеть на 375px ширины
11. Применяй все визуальные эффекты из анализа (тени, скругления, градиенты, glassmorphism)

Результат — полностью рабочий HTML/CSS/JS, ПИКСЕЛЬ В ПИКСЕЛЬ повторяющий макет.
═══ КОНЕЦ РЕЖИМА МАКЕТ → КОД ═══`;
          } else {
            // Fallback: single-step vision mode (analysis failed or invalid)
            textPart += `\n\n═══ РЕЖИМ "МАКЕТ → КОД" (Design-to-Code) ═══
ПОЛЬЗОВАТЕЛЬ ЗАГРУЗИЛ СКРИНШОТ/МАКЕТ ДИЗАЙНА САЙТА. Проанализируй визуальный дизайн на изображении и воссоздай его как точный HTML/CSS/JS код.

ПРАВИЛА:
1. НЕ вставляй загруженное изображение как <img> — это МАКЕТ, а не контент
2. АНАЛИЗИРУЙ каждый элемент: layout, цвета (#HEX), шрифты, отступы, тени, скругления
3. Извлеки ВСЕ тексты (заголовки, параграфы, кнопки, меню) и используй их ТОЧНО
4. ВОССОЗДАЙ структуру: навигацию, секции, карточки, кнопки, формы, футер
5. Для фотографий из макета — генерируй через {{GENIMG:<промпт на английском>|<соотношение>}}: промпт = тема фото (что изображено + ниша сайта) + визуальный стиль дизайна (тёмный/светлый/luxury/minimal) + настроение + "photorealistic, professional photography" (НЕ Picsum)
6. Интерактивные элементы должны быть функциональными
7. Современный CSS: flexbox, grid, custom properties, hover-эффекты
8. ⚠️ ОБЯЗАТЕЛЬНАЯ МОБИЛЬНАЯ АДАПТИВНОСТЬ: viewport meta, mobile-first @media, шрифты через clamp(), на ≤768px все grid → 1 колонка, навбар → гамбургер, картинки max-width:100%, кнопки min-height:44px, никаких горизонтальных скроллов. Сайт ОБЯЗАН отлично выглядеть на 375px ширины

Результат — полностью рабочий HTML/CSS/JS сайт, визуально ИДЕНТИЧНЫЙ загруженному макету.
═══ КОНЕЦ РЕЖИМА МАКЕТ → КОД ═══`;
          }
        } else if (savedImageUrls.length > 0) {
          textPart += `\n\nПОЛЬЗОВАТЕЛЬ ПРИКРЕПИЛ ${savedImageUrls.length} ФОТО. URL фото:\n`;
          savedImageUrls.forEach((url, i) => {
            textPart += `${i + 1}. ${url}\n`;
          });
          textPart += `\nОБЯЗАТЕЛЬНО используй эти URL напрямую в src изображений: <img src="${savedImageUrls[0]}" />. НЕ используй маркер {{IMG:...}} для этих фото — используй URL напрямую. Размести фото по сайту согласно запросу пользователя.`;
        }
        inputContent.push({ type: "text", text: textPart });

        for (const imgData of imageArray) {
          const mime = imgData.mimeType || "image/png";
          if (mime.startsWith("image/")) {
            inputContent.push({ type: "image", data: imgData.base64, mime_type: mime });
          } else {
            const extractedText = await extractTextFromFile(imgData.base64, mime);
            if (extractedText) {
              const truncated = extractedText.length > 15000 ? extractedText.substring(0, 15000) + "\n...[текст обрезан]" : extractedText;
              inputContent.push({ type: "text", text: `\n\nСОДЕРЖИМОЕ ПРИКРЕПЛЁННОГО ДОКУМЕНТА (${mime}):\n---\n${truncated}\n---\n\nИспользуй этот текст из документа при создании/редактировании сайта.` });
            } else {
              inputContent.push({ type: "text", text: `[Прикреплён файл формата ${mime}, но его содержимое не удалось извлечь.]` });
            }
          }
        }
      } else if (isEditMode) {
        inputContent.push({ type: "text", text: prompt });
      } else {
        inputContent.push({ type: "text", text: enhancedPrompt });
      }

      let fullResponse = "";

      const messages = await storage.getProjectMessages(project.id);
      const conversationHistory: KieMessage[] = [];

      for (const msg of messages.slice(-10)) {
        if (msg.role === "user") {
          conversationHistory.push({ role: "user", content: [{ type: "input_text", text: msg.content }] });
        } else if (msg.role === "assistant") {
          const truncated = msg.content.length > 2000 ? msg.content.substring(0, 2000) + "...[обрезано]" : msg.content;
          conversationHistory.push({ role: "assistant", content: [{ type: "input_text", text: truncated }] });
        }
      }

      const userContent: KieContentItem[] = [];
      for (const item of inputContent) {
        if ((item as any).type === "text") {
          userContent.push({ type: "input_text", text: (item as any).text });
        } else if ((item as any).type === "image") {
          const relUrl = savedImageUrls[userContent.filter(c => c.type === "input_image").length] || "";
          if (relUrl) {
            userContent.push({ type: "input_image", image_url: `${baseUrl}${relUrl}` });
          }
        }
      }

      conversationHistory.push({ role: "user", content: userContent });

      console.log(`[KIE] Generate call. Agent: ${useGemini ? "v2/Gemini-Flash" : "v1/GPT-5.5"}, History: ${conversationHistory.length}, Edit: ${isEditMode}`);

      const MAX_RETRIES = 3;
      let lastError: any = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const streamGen = useGemini
            ? geminiGenerateStream(conversationHistory, systemContent)
            : kieGenerateStream(conversationHistory, systemContent, "high");
          for await (const chunk of streamGen) {
            fullResponse += chunk;
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
          }
          lastError = null;
          break;
        } catch (retryErr: any) {
          lastError = retryErr;
          const msg = String(retryErr?.message || "");
          const status = retryErr?.status || retryErr?.code;
          if ((status === 503 || status === 429 || msg.includes("429") || msg.includes("503")) && attempt < MAX_RETRIES - 1) {
            const delay = (attempt + 1) * 3000;
            console.log(`[KIE] ${status || "rate-limit"} error, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
            res.write(`data: ${JSON.stringify({ content: `\n\n⏳ Сервер перегружен, повторяю запрос (${attempt + 2}/${MAX_RETRIES})...\n\n` })}\n\n`);
            await new Promise(r => setTimeout(r, delay));
            fullResponse = "";
            continue;
          }
          throw retryErr;
        }
      }
      if (lastError) throw lastError;

      console.log("Total response length:", fullResponse.length);
      console.log("Response preview:", fullResponse.substring(0, 200));

      // Gemini Flash via KIE sometimes returns shell-command JSON lines:
      //   {"cmd":"cat > index.html <<'EOF'\n...HTML...\nEOF","workdir":""}  {"end":""}
      // Strip these so they don't bleed into the preview.
      if (fullResponse.includes('"cmd"') && fullResponse.includes('"workdir"')) {
        console.log("[PARSE] Detected Gemini shell-command JSON format — sanitizing");
        // 1) Try to extract HTML from heredoc patterns inside cmd values
        // Matches: cat > *.html <<'EOF'\n(content)\nEOF
        const heredocRegex = /cat\s*>\s*[\w.-]+\.html\s*<<['"]?EOF['"]?\n([\s\S]*?)\nEOF/g;
        const extractedFiles: string[] = [];
        let hm;
        while ((hm = heredocRegex.exec(fullResponse)) !== null) {
          const content = hm[1].trim();
          if (content.includes("<") && content.length > 100) {
            extractedFiles.push(content);
          }
        }
        if (extractedFiles.length > 0) {
          // Re-assemble as ```html blocks so the existing parser picks them up
          fullResponse = extractedFiles.map(c => "```html\n" + c + "\n```").join("\n");
          console.log("[PARSE] Extracted", extractedFiles.length, "file(s) from heredoc");
        } else {
          // 2) Fallback: strip all JSON cmd/workdir/end lines, keep the rest
          fullResponse = fullResponse
            .split("\n")
            .filter(line => {
              const t = line.trim();
              if (!t.startsWith("{")) return true;
              try {
                const obj = JSON.parse(t);
                if ("cmd" in obj || "workdir" in obj || "end" in obj) return false;
              } catch {}
              return true;
            })
            .join("\n");
          console.log("[PARSE] Stripped JSON command lines, remaining length:", fullResponse.length);
        }
      }

      const replaceImgMarkers = (code: string) => {
        const imgMarkerRegex = /\{\{IMG:([^}]+)\}\}/g;
        let m;
        let result = code;
        while ((m = imgMarkerRegex.exec(code)) !== null) {
          const imgName = m[1].trim().toLowerCase();
          const found = projectImgs.find(img => img.name.toLowerCase() === imgName);
          if (found) result = result.replace(m[0], found.url);
        }
        return result;
      };

      // If single-page mode but model still emitted FILE markers, strip them
      // so they don't leak into the HTML or trigger multi-file parsing.
      if (!multiPagesData && fullResponse.includes("--- FILE:")) {
        fullResponse = fullResponse.replace(/---\s*FILE:\s*[^\s\-]+\.html\s*---\s*\n?/gi, "");
        console.log("[PARSE] Stripped rogue FILE markers (single-page mode)");
      }

      const hasDiffBlocks = fullResponse.includes("<<<<<<< SEARCH");
      const hasFileMarkers = fullResponse.includes("--- FILE:");
      const htmlBlockCount = (fullResponse.match(/```html/g) || []).length;
      const diffBlockCount = (fullResponse.match(/```diff/g) || []).length;
      console.log("Full response length:", fullResponse.length, "Has FILE markers:", hasFileMarkers, "HTML blocks:", htmlBlockCount, "Diff blocks:", diffBlockCount, "Has SEARCH/REPLACE:", hasDiffBlocks);

      const applyDiffPatches = (originalCode: string, response: string): string => {
        const diffRegex = /```diff\s*\n([\s\S]*?)```/g;
        let patchedCode = originalCode;
        let patchCount = 0;
        let dm;
        while ((dm = diffRegex.exec(response)) !== null) {
          const diffContent = dm[1];
          const searchReplaceRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
          let sr;
          while ((sr = searchReplaceRegex.exec(diffContent)) !== null) {
            const searchBlock = sr[1];
            const replaceBlock = sr[2];
            if (patchedCode.includes(searchBlock)) {
              patchedCode = patchedCode.replace(searchBlock, replaceBlock);
              patchCount++;
            } else {
              const trimmedSearch = searchBlock.replace(/^\s+/gm, (m) => m.replace(/ /g, ' ')).trim();
              const trimmedCode = patchedCode.replace(/^\s+/gm, (m) => m.replace(/ /g, ' '));
              if (trimmedCode.includes(trimmedSearch)) {
                const idx = trimmedCode.indexOf(trimmedSearch);
                const before = patchedCode.substring(0, idx);
                const after = patchedCode.substring(idx + trimmedSearch.length);
                patchedCode = before + replaceBlock + after;
                patchCount++;
              } else {
                console.warn("SEARCH block not found in code, skipping patch. First 80 chars:", searchBlock.substring(0, 80));
              }
            }
          }
        }
        console.log(`Applied ${patchCount} diff patches`);
        return patchedCode;
      };

      let aiTextReply = "";
      const firstHtmlIdx = fullResponse.indexOf("```html");
      const firstDiffIdx = fullResponse.indexOf("```diff");
      const firstFileMarkerIdx = fullResponse.indexOf("--- FILE:");
      const firstCodeIdx = firstHtmlIdx !== -1 && firstDiffIdx !== -1 
        ? Math.min(firstHtmlIdx, firstDiffIdx) 
        : firstHtmlIdx !== -1 ? firstHtmlIdx : firstDiffIdx;
      if (firstCodeIdx > 0) {
        const textEnd = firstFileMarkerIdx !== -1 && firstFileMarkerIdx < firstCodeIdx ? firstFileMarkerIdx : firstCodeIdx;
        aiTextReply = fullResponse.substring(0, textEnd).trim();
      } else if (firstFileMarkerIdx > 0) {
        aiTextReply = fullResponse.substring(0, firstFileMarkerIdx).trim();
      }

      const editingFile = activeFile || "index.html";
      let mainHtmlCode: string;

      if (hasDiffBlocks && diffBlockCount > 0) {
        const editingFileCodeRaw = editingFile === "index.html"
          ? project.generatedCode || ""
          : existingFiles.find(f => f.filename === editingFile)?.code || project.generatedCode || "";

        const { stripped: editingFileCode } = stripBase64(editingFileCodeRaw);
        const patchedStripped = applyDiffPatches(editingFileCode, fullResponse);
        const patchedCode = replaceImgMarkers(restoreBase64(patchedStripped, base64Map));

        if (editingFile !== "index.html") {
          await storage.upsertProjectFile({ projectId: project.id, filename: editingFile, code: patchedCode });
          mainHtmlCode = project.generatedCode || "";
        } else {
          mainHtmlCode = patchedCode;
        }
      } else {
        const fileMarkerRegex = /---\s*FILE:\s*([^\s\-]+\.html)\s*---\s*\n?\s*```html\s*\n?([\s\S]*?)```/gi;
        const parsedFiles: { filename: string; code: string }[] = [];
        let fm;
        while ((fm = fileMarkerRegex.exec(fullResponse)) !== null) {
          parsedFiles.push({ filename: fm[1].trim().toLowerCase(), code: replaceImgMarkers(fm[2].trim()) });
        }

        if (parsedFiles.length === 0) {
          // Fallback 2: bold/starred FILE markers with ```html blocks
          const altMarkerRegex = /\*{0,2}\s*FILE:\s*([^\s*]+\.html)\s*\*{0,2}\s*\n?\s*```html\s*\n?([\s\S]*?)```/gi;
          let altM;
          while ((altM = altMarkerRegex.exec(fullResponse)) !== null) {
            parsedFiles.push({ filename: altM[1].trim().toLowerCase(), code: replaceImgMarkers(altM[2].trim()) });
          }
        }

        if (parsedFiles.length === 0 && hasFileMarkers) {
          // Fallback 3: raw HTML without ```html wrappers (Gemini Flash style)
          // Splits on --- FILE: name.html --- and captures everything until the next marker or end
          const rawMarkerRegex = /---\s*FILE:\s*([^\s\-]+\.html)\s*---\s*\n([\s\S]*?)(?=\s*---\s*FILE:|$)/gi;
          let rm;
          while ((rm = rawMarkerRegex.exec(fullResponse)) !== null) {
            const rawCode = rm[2].trim();
            // Only accept if it looks like HTML
            if (rawCode.includes("<") && rawCode.length > 50) {
              parsedFiles.push({ filename: rm[1].trim().toLowerCase(), code: replaceImgMarkers(rawCode) });
            }
          }
          if (parsedFiles.length > 0) {
            console.log("[PARSE] Used raw fallback (no code blocks), parsed files:", parsedFiles.map(f => f.filename));
          }
        }

        console.log("Parsed files count:", parsedFiles.length, parsedFiles.map(f => f.filename));

        if (parsedFiles.length > 0) {
          const indexFile = parsedFiles.find(f => f.filename === "index.html");
          if (indexFile) {
            mainHtmlCode = indexFile.code;
          } else if (parsedFiles.find(f => f.filename === editingFile)) {
            mainHtmlCode = project.generatedCode || parsedFiles[0].code;
          } else {
            mainHtmlCode = parsedFiles[0].code;
          }
          const indexCode = indexFile?.code || mainHtmlCode;
          const headerMatch = indexCode.match(/<header[\s\S]*?<\/header>/i);
          const footerMatch = indexCode.match(/<footer[\s\S]*?<\/footer>/i);

          for (const pf of parsedFiles) {
            if (pf.filename !== "index.html") {
              let code = pf.code;
              if (headerMatch) {
                code = code.replace(/<header[\s\S]*?<\/header>/i, headerMatch[0]);
              }
              if (footerMatch) {
                code = code.replace(/<footer[\s\S]*?<\/footer>/i, footerMatch[0]);
              }
              pf.code = code;
              await storage.upsertProjectFile({ projectId: project.id, filename: pf.filename, code });
            }
          }
        } else {
          const singleMatch = fullResponse.match(/```html\n?([\s\S]*?)```/);
          let parsedCode: string | null = null;
          if (singleMatch) {
            parsedCode = replaceImgMarkers(singleMatch[1].trim());
          } else if (fullResponse.includes("<!DOCTYPE") || fullResponse.includes("<html")) {
            parsedCode = replaceImgMarkers(fullResponse.trim());
          }

          if (parsedCode && isEditMode && editingFile !== "index.html") {
            await storage.upsertProjectFile({ projectId: project.id, filename: editingFile, code: parsedCode });
            mainHtmlCode = project.generatedCode || "";
          } else if (parsedCode) {
            mainHtmlCode = parsedCode;
          } else {
            mainHtmlCode = project.generatedCode || "";
          }
        }
      }

      // Generate on-theme photos for any {{GENIMG:...}} markers and bake the
      // resulting /objects/ URLs into the main page + all secondary files BEFORE
      // persisting, so preview, version history, deploy and ZIP all ship them.
      const genFilesMap = new Map<string, string>();
      genFilesMap.set("index.html", mainHtmlCode);
      const secondaryForGen = await storage.getProjectFiles(project.id);
      for (const f of secondaryForGen) {
        if (f.filename !== "index.html") genFilesMap.set(f.filename, f.code);
      }
      const genRunKey = idempotencyKey || `gen-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const genImgResult = await resolveGenImgMarkers(genFilesMap, project.id, user?.id, genRunKey, res, () => clientGone);
      // Generate scroll-bound animations for any {{SCROLLANIM:...}} markers (Интерактивный режим)
      // NOTE: intentionally NOT passing clientGone — animation must complete and be saved even if
      // the SSE connection drops mid-generation (proxy timeout, browser close).
      // The phaseDeadline inside resolveScrollAnimMarkers provides the hard time limit.
      const scrollResult = await resolveScrollAnimMarkers(genFilesMap, project.id, user?.id, genRunKey, res, () => false, absoluteProductImageUrl, interactiveStyle);
      mainHtmlCode = genFilesMap.get("index.html") ?? mainHtmlCode;
      for (const f of secondaryForGen) {
        if (f.filename === "index.html") continue;
        const updatedCode = genFilesMap.get(f.filename);
        if (updatedCode !== undefined && updatedCode !== f.code) {
          await storage.upsertProjectFile({ projectId: project.id, filename: f.filename, code: updatedCode });
        }
      }

      if (project.generatedCode && project.generatedCode.trim()) {
        const currentFiles = await storage.getProjectFiles(project.id);
        const filesSnapshot = currentFiles.map(f => ({ filename: f.filename, code: f.code }));
        await storage.createProjectVersion({
          projectId: project.id,
          code: project.generatedCode,
          label: `До: "${prompt.substring(0, 50)}${prompt.length > 50 ? "..." : ""}"`,
          files: filesSnapshot.length > 0 ? filesSnapshot : null,
        });
      }

      await storage.updateProject(project.id, { generatedCode: mainHtmlCode });
      await storage.createProjectMessage({
        projectId: project.id,
        role: "model",
        content: aiTextReply || "Сайт обновлён",
      });

      const allFiles = await storage.getProjectFiles(project.id);
      const editedFileCode = editingFile !== "index.html" ? allFiles.find(f => f.filename === editingFile)?.code : mainHtmlCode;
      const totalCreditsUsed = GENERATION_COST + genImgResult.creditsUsed + scrollResult.creditsUsed;
      const freshUser = user?.id ? await storage.getUser(user.id) : null;
      const finalBalance = freshUser?.credits ?? (genDeduction.newBalance - genImgResult.creditsUsed - scrollResult.creditsUsed);
      res.write(`data: ${JSON.stringify({ done: true, code: mainHtmlCode, editedFile: editingFile, editedCode: editedFileCode || mainHtmlCode, reply: aiTextReply, files: allFiles.map(f => ({ filename: f.filename, id: f.id })), imagesGenerated: genImgResult.generated, creditsUsed: totalCreditsUsed, newBalance: finalBalance })}\n\n`);
      res.end();
    } catch (err: any) {
      console.error("Generation error:", err?.message || err);
      const errMsg = (err?.message?.includes("503") || err?.message?.includes("UNAVAILABLE") || err?.message?.includes("high demand"))
        ? "Сервер ИИ временно перегружен. Попробуйте через 30 секунд — мы уже сделали 3 попытки."
        : (err?.message?.includes("RATE_LIMIT") || err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED") || err?.message?.includes("quota"))
        ? "Превышен лимит запросов к Gemini API. Подождите 1-2 минуты и попробуйте снова."
        : err?.message?.includes("RECITATION") 
        ? "Ответ ИИ заблокирован из-за слишком похожего контента. Попробуйте переформулировать запрос."
        : err?.message?.includes("SAFETY") 
        ? "Ответ ИИ заблокирован фильтром безопасности. Попробуйте другой запрос."
        : err?.message?.includes("too long") || err?.message?.includes("token")
        ? "Ответ ИИ слишком длинный. Попробуйте более конкретный запрос для одной страницы."
        : `Ошибка генерации: ${err?.message?.substring(0, 150) || "неизвестная ошибка"}`;
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ message: errMsg });
      }
    }
  });

  // Standalone scroll-animation generator (Интерактивный режим): renders a white-bg
  // video, slices it into WebP frames in object storage, returns the ordered frame URLs.
  app.post("/api/generate-scroll-assets", requireAuth, aiLimiter, async (req, res) => {
    try {
      const user = req.user as any;
      const { prompt, idempotencyKey } = req.body;
      if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({ message: "Промпт обязателен" });
      }

      const saIkey = idempotencyKey || `scroll-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const deduction = await storage.deductCredits(user.id, SCROLL_ANIM_COST, "scroll-anim", saIkey);
      if (!deduction.success) {
        return res.status(402).json({ message: `Недостаточно токенов. Нужно ${SCROLL_ANIM_COST}, у вас ${deduction.newBalance}`, newBalance: deduction.newBalance });
      }
      // Only credits actually deducted this request may be refunded; an idempotent
      // replay (alreadyProcessed) charged nothing, so it must never trigger a refund.
      const billed = !deduction.alreadyProcessed;

      let clientGone = false;
      req.on("close", () => { clientGone = true; });

      let frames: string[] = [];
      try {
        frames = await generateScrollFrames(prompt, () => clientGone);
      } catch (genErr: any) {
        if (billed) { try { await storage.refundCredits(user.id, SCROLL_ANIM_COST); } catch {} }
        console.error("Scroll frame generation error:", genErr?.message || genErr);
        return res.status(502).json({ message: "Не удалось сгенерировать анимацию. Токены возвращены." });
      }
      if (frames.length < 8) {
        if (billed) { try { await storage.refundCredits(user.id, SCROLL_ANIM_COST); } catch {} }
        return res.status(502).json({ message: "Не удалось сгенерировать анимацию. Токены возвращены." });
      }

      const freshUser = await storage.getUser(user.id);
      res.json({ frames, count: frames.length, creditsUsed: billed ? SCROLL_ANIM_COST : 0, newBalance: freshUser?.credits ?? deduction.newBalance });
    } catch (err: any) {
      console.error("Scroll assets error:", err?.message || err);
      res.status(500).json({ message: `Ошибка генерации анимации: ${err?.message?.substring(0, 150) || "неизвестная ошибка"}` });
    }
  });

  app.post("/api/images/generate", requireAuth, aiLimiter, async (req, res) => {
    try {
      const IMAGE_COST = 15;
      const user = req.user as any;

      const { prompt, aspectRatio = "16:9", outputFormat = "jpg", idempotencyKey, referenceImageUrls } = req.body;
      if (!prompt) {
        return res.status(400).json({ message: "Промпт обязателен" });
      }

      const imgIkey = idempotencyKey || `img-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const deduction = await storage.deductCredits(user.id, IMAGE_COST, "image", imgIkey);
      if (!deduction.success) {
        return res.status(402).json({ message: `Недостаточно токенов. Нужно ${IMAGE_COST}, у вас ${deduction.newBalance}`, newBalance: deduction.newBalance });
      }

      const hasRefImages = referenceImageUrls && Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0;
      const refUrlsFull = hasRefImages
        ? referenceImageUrls.slice(0, 14).map((u: string) =>
            u.startsWith("http") ? u : `https://${req.headers.host}${u}`
          )
        : [];

      let createBody: any = null;
      let usedModel = "";

      // Try GPT Image-2 first (text-to-image only, no reference images support)
      if (!hasRefImages) {
        try {
          const gptResolution = aspectRatio === "auto" || aspectRatio === "1:1" ? "2K" : "2K";
          const gptInput: any = {
            prompt,
            aspect_ratio: aspectRatio === "auto" ? "1:1" : aspectRatio,
            resolution: gptResolution,
          };
          const gptResp = await fetch(NANO_BANANA_CREATE_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${KIE_API_KEY}`,
            },
            body: JSON.stringify({
              model: "gpt-image-2-text-to-image",
              input: gptInput,
            }),
          });
          const gptBody = await gptResp.json();
          console.log("GPT Image-2 create response:", JSON.stringify(gptBody));
          if (gptBody.code === 200 && gptBody.data?.taskId) {
            createBody = gptBody;
            usedModel = "gpt-image-2";
          } else {
            console.warn("GPT Image-2 failed, falling back to Nano Banana 2:", gptBody.msg);
          }
        } catch (gptErr: any) {
          console.warn("GPT Image-2 error, falling back to Nano Banana 2:", gptErr.message);
        }
      }

      // Fallback to Nano Banana 2 (or use it directly when reference images provided)
      if (!createBody) {
        const nbInput: any = {
          prompt,
          output_format: outputFormat,
          aspect_ratio: aspectRatio,
          resolution: "2K",
        };
        if (hasRefImages) nbInput.image_url = refUrlsFull;

        const nbResp = await fetch(NANO_BANANA_CREATE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${KIE_API_KEY}`,
          },
          body: JSON.stringify({
            model: "nano-banana-2",
            input: nbInput,
          }),
        });
        createBody = await nbResp.json();
        usedModel = "nano-banana-2";
        console.log("Nano Banana create response:", JSON.stringify(createBody));
      }

      if (createBody.code !== 200 || !createBody.data?.taskId) {
        return res.status(500).json({ message: createBody.msg || "Ошибка создания задачи" });
      }

      console.log(`[Image] Task created with ${usedModel}, taskId=${createBody.data.taskId}`);
      res.json({ taskId: createBody.data.taskId, model: usedModel, newBalance: deduction.newBalance });
    } catch (err: any) {
      console.error("Image generation error:", err);
      res.status(500).json({ message: "Ошибка генерации изображения" });
    }
  });

  app.get("/api/images/status/:taskId", requireAuth, async (req, res) => {
    try {
      const { taskId } = req.params;
      const resp = await fetch(`${NANO_BANANA_STATUS_URL}?taskId=${taskId}`, {
        headers: { "Authorization": `Bearer ${KIE_API_KEY}` },
      });
      const body = await resp.json();
      console.log("Nano Banana status:", JSON.stringify(body).substring(0, 500));

      if (body.code !== 200) {
        return res.status(500).json({ message: body.msg || "Ошибка проверки статуса" });
      }

      const state = body.data?.state;
      if (state === "success") {
        const result = JSON.parse(body.data.resultJson);
        const externalUrls = result.resultUrls || [];
        const localUrls: string[] = [];
        const projectIdParam = parseInt(req.query.projectId as string) || 0;
        const promptParam = (req.query.prompt as string) || "";
        for (const extUrl of externalUrls) {
          try {
            const imgResp = await fetch(extUrl);
            if (imgResp.ok) {
              const buf = Buffer.from(await imgResp.arrayBuffer());
              const localUrl = await uploadToObjectStorage(buf, "image/jpeg", "jpg");
              localUrls.push(localUrl);
              if (projectIdParam > 0) {
                const autoName = promptParam.trim().split(/\s+/).slice(0, 3).join("_") || `img_${Date.now()}`;
                const imgProject = await storage.getProject(projectIdParam);
                if (imgProject && imgProject.userId === (req.user as any).id) {
                  await storage.createProjectImage({ projectId: projectIdParam, userId: imgProject.userId, name: autoName, url: localUrl, prompt: promptParam.substring(0, 200) });
                }
              }
            } else {
              localUrls.push(extUrl);
            }
          } catch {
            localUrls.push(extUrl);
          }
        }
        return res.json({ state: "success", urls: localUrls });
      }
      if (state === "fail") {
        return res.json({ state: "fail", error: body.data.failMsg || "Ошибка генерации" });
      }
      return res.json({ state: "waiting" });
    } catch (err: any) {
      console.error("Image status error:", err);
      res.status(500).json({ message: "Ошибка проверки статуса" });
    }
  });

  app.post("/api/images/proxy-base64", requireAuth, proxyLimiter, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string") return res.status(400).json({ message: "URL обязателен" });
      try {
        await assertPublicHttpUrl(url);
      } catch (e: any) {
        return res.status(400).json({ message: e?.message || "Недопустимый URL" });
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let mimeType = "image/jpeg";
      let buffer: Buffer;
      try {
        const r = await fetch(url, { redirect: "error", signal: controller.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        mimeType = r.headers.get("content-type") || "image/jpeg";
        if (!mimeType.startsWith("image/")) {
          return res.status(400).json({ message: "URL не является изображением" });
        }
        buffer = Buffer.from(await r.arrayBuffer());
      } finally {
        clearTimeout(timeout);
      }
      if (buffer.length > 15 * 1024 * 1024) {
        return res.status(413).json({ message: "Изображение слишком большое" });
      }
      const base64 = buffer.toString("base64");
      res.json({ base64, mimeType });
    } catch (err: any) {
      console.error("Proxy base64 error:", err);
      res.status(500).json({ message: "Ошибка загрузки изображения" });
    }
  });

  // WaveSpeed 3D model generation
  app.post("/api/3d/generate", requireAuth, aiLimiter, async (req, res) => {
    try {
      const user = req.user as any;
      const { imageUrl, enablePbr = false, generateType = "Normal", faceCount = 500000, idempotencyKey } = req.body;
      if (!imageUrl) {
        return res.status(400).json({ message: "URL изображения обязателен" });
      }
      if (!WAVESPEED_API_KEY) {
        return res.status(500).json({ message: "WAVESPEED_API_KEY не настроен" });
      }

      const ikey = idempotencyKey || `3d-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const deduction = await storage.deductCredits(user.id, MODEL_3D_COST, "3d", ikey);
      if (!deduction.success) {
        return res.status(402).json({ message: `Недостаточно токенов. Нужно ${MODEL_3D_COST}, у вас ${deduction.newBalance}`, newBalance: deduction.newBalance });
      }

      let fullImageUrl = imageUrl;
      if (imageUrl.startsWith("/")) {
        fullImageUrl = `https://${req.headers.host}${imageUrl}`;
      }

      const payload: any = {
        image: fullImageUrl,
        enable_pbr: enablePbr,
        generate_type: generateType,
        face_count: faceCount,
      };

      const createResp = await fetch(WAVESPEED_3D_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${WAVESPEED_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      const createBody = await createResp.json() as any;
      console.log("[WaveSpeed 3D] create response:", JSON.stringify(createBody).substring(0, 500));

      const taskData = createBody.data || createBody;
      const taskId = taskData.id;
      if (!createResp.ok || !taskId) {
        await storage.refundCredits(user.id, MODEL_3D_COST);
        return res.status(500).json({ message: createBody?.error?.message || createBody?.detail || createBody?.message || "Ошибка создания 3D задачи" });
      }

      res.json({
        taskId,
        statusUrl: taskData.urls?.get || `${WAVESPEED_3D_URL}/${taskId}`,
        newBalance: deduction.newBalance,
      });
    } catch (err: any) {
      console.error("[WaveSpeed 3D] generate error:", err);
      res.status(500).json({ message: "Ошибка генерации 3D модели" });
    }
  });

  app.get("/api/3d/status/:taskId", requireAuth, async (req, res) => {
    try {
      if (!WAVESPEED_API_KEY) {
        return res.status(500).json({ message: "WAVESPEED_API_KEY не настроен" });
      }
      const { taskId } = req.params;
      let statusUrl = req.query.statusUrl as string || "";
      if (!statusUrl || !statusUrl.startsWith("https://api.wavespeed.ai/")) {
        statusUrl = `${WAVESPEED_3D_URL}/${taskId}`;
      }

      const resp = await fetch(statusUrl, {
        headers: { "Authorization": `Bearer ${WAVESPEED_API_KEY}` },
      });
      const rawBody = await resp.json() as any;
      const body = rawBody.data || rawBody;
      console.log("[WaveSpeed 3D] status:", JSON.stringify(rawBody).substring(0, 500));

      if (body.status === "completed") {
        return res.json({ state: "success", outputs: body.outputs || body.output || [] });
      }
      if (body.status === "failed") {
        return res.json({ state: "fail", error: body.error || "Ошибка генерации 3D" });
      }
      return res.json({ state: "waiting", status: body.status });
    } catch (err: any) {
      console.error("[WaveSpeed 3D] status error:", err);
      res.status(500).json({ message: "Ошибка проверки статуса 3D" });
    }
  });

  app.post("/api/3d/download", requireAuth, async (req, res) => {
    try {
      const { url, projectId } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ message: "URL обязателен" });
      }
      const allowed = url.startsWith("https://d1q70pf5vjeyhc.cloudfront.net/") || url.startsWith("https://api.wavespeed.ai/");
      if (!allowed) {
        return res.status(400).json({ message: "Недопустимый URL" });
      }
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Failed to download GLB");
      const arrayBuf = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const localUrl = await uploadToObjectStorage(buffer, "model/gltf-binary", "glb");
      if (projectId) {
        const pid = parseInt(projectId);
        if (pid > 0) {
          const dlProject = await storage.getProject(pid);
          if (dlProject && dlProject.userId === (req.user as any).id) {
            await storage.createProjectImage({ projectId: pid, userId: dlProject.userId, name: `3d_model_${Date.now()}`, url: localUrl, prompt: "3D модель" });
          }
        }
      }
      res.json({ url: localUrl });
    } catch (err: any) {
      console.error("[3D download] error:", err);
      res.status(500).json({ message: "Ошибка загрузки 3D модели" });
    }
  });

  app.get("/api/projects/:id/images", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      const images = await storage.getProjectImages(project.id);
      res.json(images);
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки изображений" });
    }
  });

  app.post("/api/projects/:id/images", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      const { name, url, prompt } = req.body;
      if (!name || !url) return res.status(400).json({ message: "Имя и URL обязательны" });
      const image = await storage.createProjectImage({ projectId: project.id, userId: user.id, name, url, prompt: prompt || "" });
      res.status(201).json(image);
    } catch (err) {
      res.status(500).json({ message: "Ошибка сохранения изображения" });
    }
  });

  app.delete("/api/projects/:id/images/:imageId", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      const imageId = parseInt(req.params.imageId);
      const projImages = await storage.getProjectImages(project.id);
      if (!projImages.some((img) => img.id === imageId)) {
        return res.status(404).json({ message: "Изображение не найдено" });
      }
      await storage.deleteProjectImage(imageId);
      res.json({ message: "Изображение удалено" });
    } catch (err) {
      res.status(500).json({ message: "Ошибка удаления изображения" });
    }
  });

  app.put("/api/projects/:id/code", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) {
        return res.status(404).json({ message: "Проект не найден" });
      }
      const user = req.user as any;
      if (project.userId !== user.id) {
        return res.status(403).json({ message: "Доступ запрещён" });
      }
      const { generatedCode } = req.body;
      const updated = await storage.updateProject(project.id, { generatedCode });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Ошибка обновления кода" });
    }
  });

  app.get("/api/projects/:id/versions", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      const versions = await storage.getProjectVersions(project.id);
      res.json(versions);
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки версий" });
    }
  });

  app.post("/api/projects/:id/versions", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      if (!project.generatedCode?.trim()) return res.status(400).json({ message: "Нет кода для сохранения" });
      const { label } = req.body;
      const currentFiles = await storage.getProjectFiles(project.id);
      const filesSnapshot = currentFiles.map(f => ({ filename: f.filename, code: f.code }));
      const version = await storage.createProjectVersion({
        projectId: project.id,
        code: project.generatedCode,
        label: label || "Ручной чекпоинт",
        files: filesSnapshot.length > 0 ? filesSnapshot : null,
      });
      res.status(201).json(version);
    } catch (err) {
      res.status(500).json({ message: "Ошибка сохранения версии" });
    }
  });

  app.post("/api/projects/:id/versions/:versionId/restore", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });

      const versions = await storage.getProjectVersions(project.id);
      const version = versions.find(v => v.id === parseInt(req.params.versionId));
      if (!version) return res.status(404).json({ message: "Версия не найдена" });

      if (project.generatedCode?.trim()) {
        const currentFiles = await storage.getProjectFiles(project.id);
        const filesSnapshot = currentFiles.map(f => ({ filename: f.filename, code: f.code }));
        await storage.createProjectVersion({
          projectId: project.id,
          code: project.generatedCode,
          label: "До отката",
          files: filesSnapshot.length > 0 ? filesSnapshot : null,
        });
      }

      const updated = await storage.updateProject(project.id, { generatedCode: version.code });

      if (version.files && Array.isArray(version.files)) {
        await storage.deleteProjectFilesByProject(project.id);
        for (const f of version.files) {
          await storage.upsertProjectFile({ projectId: project.id, filename: f.filename, code: f.code });
        }
      }

      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Ошибка восстановления версии" });
    }
  });

  // ═══ PROJECT FILES API ═══

  app.get("/api/projects/:id/files", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      const files = await storage.getProjectFiles(project.id);
      res.json(files);
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки файлов" });
    }
  });

  app.put("/api/projects/:id/files/:filename", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      const { code } = req.body;
      const file = await storage.upsertProjectFile({
        projectId: project.id,
        filename: req.params.filename,
        code: code || "",
      });
      res.json(file);
    } catch (err) {
      res.status(500).json({ message: "Ошибка сохранения файла" });
    }
  });

  app.post("/api/projects/:id/sync-nav", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });

      const files = await storage.getProjectFiles(project.id);
      const allPages = [
        { filename: "index.html", code: project.generatedCode || "" },
        ...files.filter(f => f.filename !== "index.html"),
      ];

      const indexCode = project.generatedCode || "";
      const navMatch = indexCode.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
      if (!navMatch) return res.json({ success: true, message: "Nav not found" });

      const existingNav = navMatch[0];

      const existingLinks: { href: string; text: string; full: string }[] = [];
      const linkRegex = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = linkRegex.exec(existingNav)) !== null) {
        existingLinks.push({ href: m[1], text: m[2], full: m[0] });
      }

      const pageTitles: Record<string, string> = req.body?.pageTitles || {};

      const missingPages = allPages.filter(
        p => !existingLinks.some(l => l.href === p.filename)
      );

      if (missingPages.length === 0) return res.json({ success: true, message: "Already synced" });

      let newNavLinks = "";
      for (const mp of missingPages) {
        const label = mp.filename.replace(".html", "");
        const displayName = pageTitles[mp.filename] || label.charAt(0).toUpperCase() + label.slice(1);
        if (existingLinks.length > 0) {
          const sample = existingLinks[existingLinks.length - 1].full;
          const newLink = sample.replace(/href="[^"]*"/, `href="${mp.filename}"`).replace(/>[\s\S]*?<\/a>/, `>${displayName}</a>`);
          newNavLinks += "\n                " + newLink;
        } else {
          newNavLinks += `\n                <a href="${mp.filename}">${displayName}</a>`;
        }
      }

      const lastLinkIdx = existingNav.lastIndexOf("</a>");
      if (lastLinkIdx === -1) return res.json({ success: true, message: "No links found in nav" });

      const insertPos = lastLinkIdx + 4;
      const updatedNav = existingNav.substring(0, insertPos) + newNavLinks + existingNav.substring(insertPos);

      for (const page of allPages) {
        const pageNavMatch = page.code.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
        if (!pageNavMatch) continue;
        const updatedCode = page.code.replace(pageNavMatch[0], updatedNav);
        if (updatedCode === page.code) continue;

        if (page.filename === "index.html") {
          await storage.updateProject(project.id, { generatedCode: updatedCode });
        } else {
          await storage.upsertProjectFile({
            projectId: project.id,
            filename: page.filename,
            code: updatedCode,
          });
        }
      }

      res.json({ success: true, updated: allPages.length });
    } catch (err) {
      console.error("Sync nav error:", err);
      res.status(500).json({ message: "Ошибка синхронизации навигации" });
    }
  });

  app.delete("/api/projects/:id/files/:fileId", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      const fileId = parseInt(req.params.fileId);
      const projFiles = await storage.getProjectFiles(project.id);
      if (!projFiles.some((f) => f.id === fileId)) {
        return res.status(404).json({ message: "Файл не найден" });
      }
      await storage.deleteProjectFile(fileId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Ошибка удаления файла" });
    }
  });

  // ═══ PUBLISH API (Vercel) ═══

  app.post("/api/projects/:id/publish", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Не авторизован" });
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      if (project.userId !== (req.user as any).id) return res.status(403).json({ message: "Нет доступа" });
      if (!project.generatedCode) return res.status(400).json({ message: "Сначала сгенерируйте сайт" });

      const user = await storage.getUser((req.user as any).id);
      if (!user) return res.status(401).json({ message: "Пользователь не найден" });


      if (user.credits < DAILY_PUBLISH_COST) {
        return res.status(403).json({ message: "Недостаточно токенов для публикации. Ежедневная стоимость хостинга — 20 токенов/сайт." });
      }

      await storage.updateProject(projectId, { publishStatus: "publishing" });

      const extraFiles = await storage.getProjectFiles(projectId);
      const projectImages = await storage.getProjectImages(projectId);

      const files: Array<{ filename: string; content?: string; contentBuffer?: Buffer }> = [];

      const LEADS_API_BASE = "https://craft-ai.ru";
      const leadsScript = `<script>window.__PROJECT_ID__=${projectId};
(function(){
  var API='${LEADS_API_BASE}/api/leads/${projectId}';
  document.querySelectorAll('form[data-lead-form]').forEach(function(form){
    form.addEventListener('submit',function(e){
      e.preventDefault();
      var fd=new FormData(form);
      var data={name:fd.get('name')||'',email:fd.get('email')||'',phone:fd.get('phone')||'',message:fd.get('message')||'',source:form.dataset.leadForm||'form'};
      var btn=form.querySelector('button[type="submit"],input[type="submit"],button:not([type])');
      var origText=btn?btn.textContent:'';
      if(btn){btn.textContent='Отправляем...';btn.disabled=true}
      fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
        .then(function(r){if(!r.ok)throw new Error(r.status);return r.json()})
        .then(function(){form.reset();if(btn){btn.textContent='Отправлено ✓';btn.style.background='#22c55e';setTimeout(function(){btn.textContent=origText;btn.disabled=false;btn.style.background=''},3000)}})
        .catch(function(){if(btn){btn.textContent='Ошибка, попробуйте ещё';btn.disabled=false;setTimeout(function(){btn.textContent=origText},3000)}});
    });
  });
})();<\/script>`;

      function injectLeadsScript(html: string): string {
        let result = html;
        result = result.replace(/<script[^>]*data-nz-leads[^>]*>[\s\S]*?<\/script>/gi, "");
        result = result.replace(/<script[^>]*data-nz-editor[^>]*>[\s\S]*?<\/script>/gi, "");
        result = result.replace(/<style[^>]*data-nz-editor[^>]*>[\s\S]*?<\/style>/gi, "");
        result = result.replace(/<script[^>]*data-nz-selector[^>]*>[\s\S]*?<\/script>/gi, "");
        result = result.replace(/<style[^>]*data-nz-selector[^>]*>[\s\S]*?<\/style>/gi, "");
        result = result.replace(/<!--NZ_EDITOR_START-->|<!--NZ_EDITOR_END-->/g, "");
        result = result.replace(/<script[^>]*>\s*document\.querySelectorAll\(['"]form\[data-lead-form\]['"]\)[\s\S]*?<\/script>/gi, "");
        if (result.includes("</body>")) {
          result = result.replace("</body>", leadsScript + "</body>");
        } else {
          result += leadsScript;
        }
        return result;
      }

      let mainHtml = project.generatedCode;
      for (const img of projectImages) {
        mainHtml = mainHtml.replace(new RegExp(`\\{\\{IMG:${img.name}\\}\\}`, "g"), img.url);
      }
      mainHtml = injectLeadsScript(mainHtml);
      files.push({ filename: "index.html", content: mainHtml });

      for (const f of extraFiles) {
        if (f.filename === "index.html") continue;
        let code = f.code;
        for (const img of projectImages) {
          code = code.replace(new RegExp(`\\{\\{IMG:${img.name}\\}\\}`, "g"), img.url);
        }
        code = injectLeadsScript(code);
        files.push({ filename: f.filename, content: code });
      }

      // Download and bundle ALL locally-hosted media (images, video, audio, 3D models)
      // referenced via /objects/... or /uploads/... so they work on the deployed site.
      const allHtmlForScan = files.map(f => f.content || "").join("\n");
      const localMediaUrls = new Set<string>();
      const mediaRegexes = [
        /(?:src|href|poster)\s*=\s*["'](\/(?:objects|uploads)\/[^"']+)["']/gi,
        /url\(\s*['"]?(\/(?:objects|uploads)\/[^"')]+?)['"]?\s*\)/gi,
        // Bare media URLs anywhere (e.g. scroll-animation frame arrays in data-frames / JS)
        /(\/(?:objects|uploads)\/[A-Za-z0-9._\/-]+?\.(?:webp|jpe?g|png|gif|avif|svg|mp4|webm|mov|ogg|glb|gltf))/gi,
      ];
      for (const rx of mediaRegexes) {
        let mm: RegExpExecArray | null;
        while ((mm = rx.exec(allHtmlForScan)) !== null) {
          localMediaUrls.add(mm[1]);
        }
      }
      if (localMediaUrls.size > 0) {
        const mediaMap = new Map<string, string>();
        const usedNames = new Set<string>();
        let counter = 0;
        const publishObjStorage = new ObjectStorageService();
        for (const mediaUrl of Array.from(localMediaUrls)) {
          try {
            let buffer: Buffer;
            if (mediaUrl.startsWith("/objects/")) {
              // Direct GCS SDK download — works in both dev and prod, no localhost dependency
              try {
                const gcsFile = await publishObjStorage.getObjectEntityFile(mediaUrl);
                const [fileContent] = await gcsFile.download();
                buffer = fileContent as Buffer;
                console.log(`[Publish] Object storage download OK: ${mediaUrl} (${buffer.length} bytes)`);
              } catch (sdkErr: any) {
                console.warn(`[Publish] Object storage SDK failed for ${mediaUrl}: ${sdkErr?.message || sdkErr}`);
                continue;
              }
            } else {
              // Legacy /uploads/ static path — use localhost fetch
              const fetchUrl = `http://localhost:${process.env.PORT || 5000}${mediaUrl}`;
              const mediaResp = await fetch(fetchUrl);
              if (!mediaResp.ok) {
                console.warn(`[Publish] Media fetch ${mediaUrl} returned ${mediaResp.status}`);
                continue;
              }
              buffer = Buffer.from(await mediaResp.arrayBuffer());
            }
            let base = (mediaUrl.split("/").pop() || "").split("?")[0].replace(/[^a-zA-Z0-9._-]/g, "_");
            if (!base || base === "_") base = `asset_${counter}`;
            let fileName = base;
            while (usedNames.has(fileName)) { fileName = `${counter}_${base}`; counter++; }
            usedNames.add(fileName);
            counter++;
            const localPath = `assets/${fileName}`;
            files.push({ filename: localPath, contentBuffer: buffer });
            mediaMap.set(mediaUrl, localPath);
          } catch (err) {
            console.warn(`[Publish] Could not bundle media ${mediaUrl}:`, err);
          }
        }
        // Rewrite references in ALL html pages to the bundled local paths
        for (const f of files) {
          if (!f.content) continue;
          for (const [remoteUrl, localPath] of Array.from(mediaMap.entries())) {
            f.content = f.content.split(remoteUrl).join(localPath);
          }
        }
      }

      const { url, netlifyProjectId } = await deployToNetlify(projectId, files);

      await storage.updateProject(projectId, {
        publishStatus: "published",
        publishedUrl: url,
        vercelProjectId: netlifyProjectId,
      });

      res.json({ url });
    } catch (err: any) {
      await storage.updateProject(parseInt(req.params.id), { publishStatus: "error" });
      res.status(500).json({ message: err.message || "Ошибка публикации" });
    }
  });

  app.post("/api/projects/:id/favicon", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Не авторизован" });
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      if (project.userId !== (req.user as any).id) return res.status(403).json({ message: "Нет доступа" });
      const { dataUrl, mimeType } = req.body;
      if (!dataUrl) return res.status(400).json({ message: "dataUrl обязателен" });

      const faviconTag = `<link rel="icon" type="${mimeType || "image/png"}" href="${dataUrl}">`;
      const injectFavicon = (html: string): string => {
        const existing = /<link[^>]+rel=["']icon["'][^>]*>/i;
        if (existing.test(html)) return html.replace(existing, faviconTag);
        return html.replace(/<\/head>/i, `  ${faviconTag}\n</head>`);
      };

      const updatedCode = injectFavicon(project.generatedCode);
      await storage.updateProject(projectId, { generatedCode: updatedCode });

      const files = await storage.getProjectFiles(projectId);
      for (const f of files) {
        if (f.filename.endsWith(".html")) {
          await storage.upsertProjectFile({ projectId, filename: f.filename, code: injectFavicon(f.code) });
        }
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Ошибка загрузки фавикона" });
    }
  });

  app.post("/api/projects/:id/legal-audit", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Не авторизован" });
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      if (project.userId !== (req.user as any).id) return res.status(403).json({ message: "Нет доступа" });

      const html = (project.generatedCode || "").slice(0, 25000);
      if (!html || html.length < 50) return res.status(400).json({ message: "Сайт ещё не создан" });

      // Also grab secondary files for multi-page analysis
      const extraFiles = await storage.getProjectFiles(projectId);
      const extraHtml = extraFiles.map(f => f.code).join("\n").slice(0, 8000);
      const fullHtml = html + (extraHtml ? "\n<!-- ADDITIONAL PAGES -->\n" + extraHtml : "");

      const AUDIT_SYSTEM = `Ты эксперт по юридическому соответствию российских сайтов (152-ФЗ, ГК РФ). Отвечай ТОЛЬКО валидным JSON без markdown и без пояснений.`;

      const AUDIT_PROMPT = `Проверь HTML сайта на 6 юридических требований. Верни ТОЛЬКО JSON:

{
  "checks": [
    {"id":"cookie_consent","name":"Согласие с куки","status":"ok","note":"пояснение"},
    {"id":"privacy_policy","name":"Политика конфиденциальности","status":"missing","note":"пояснение"},
    {"id":"form_consent","name":"Флажок согласия в формах","status":"partial","note":"пояснение"},
    {"id":"public_offer","name":"Публичная оферта","status":"missing","note":"пояснение"},
    {"id":"payment_terms","name":"Условия оплаты / доставки / возврата","status":"missing","note":"пояснение"},
    {"id":"legal_contacts","name":"Реквизиты организации (ИНН/ОГРН)","status":"missing","note":"пояснение"}
  ],
  "hasIssues": true
}

Статусы: "ok" = присутствует и корректен, "partial" = есть но неполный, "missing" = отсутствует.

Критерии:
- cookie_consent: баннер/уведомление о куки с кнопкой принятия (ищи слова куки/cookie, согласие, баннер с accept/принять)
- privacy_policy: страница/раздел политики конфиденциальности с реквизитами оператора и описанием обработки ПД; ссылка в футере
- form_consent: в каждой форме сбора данных (заявка/подписка) есть checkbox согласия с текстом и ссылкой на политику
- public_offer: публичная оферта с условиями оплаты, доставки, возврата, ответственности
- payment_terms: явные условия оплаты, доставки, возврата (в оферте или отдельном разделе)
- legal_contacts: в футере/контактах — название организации, ИНН, ОГРН/ОГРНИП, адрес, телефон, email

HTML:
${fullHtml}`;

      const rawResp = await kieGenerateSync(
        [{ role: "user", content: [{ type: "input_text", text: AUDIT_PROMPT }] }],
        AUDIT_SYSTEM
      );

      let result: any = null;
      const jsonMatch = rawResp.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { result = JSON.parse(jsonMatch[0]); } catch {}
      }
      if (!result?.checks) return res.status(500).json({ message: "Не удалось разобрать ответ ИИ" });

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Ошибка аудита" });
    }
  });

  app.post("/api/projects/:id/yandex", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Не авторизован" });
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      if (project.userId !== (req.user as any).id) return res.status(403).json({ message: "Нет доступа" });

      const { metrika, webmaster } = req.body;

      let metrikaBlock = "";
      if (metrika && metrika.trim()) {
        const trimmed = metrika.trim();
        if (/^\d+$/.test(trimmed)) {
          metrikaBlock = `<!-- Yandex.Metrika counter -->\n<script type="text/javascript">\n  (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};\n  m[i].l=1*new Date();\n  for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}\n  k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)\n  })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');\n  ym(${trimmed}, 'init', {\n    clickmap: true,\n    trackLinks: true,\n    accurateTrackBounce: true,\n    webvisor: true\n  });\n</script>\n<noscript><div><img src="https://mc.yandex.ru/watch/${trimmed}" style="position:absolute; left:-9999px;" alt="" /></div></noscript>\n<!-- /Yandex.Metrika counter -->`;
        } else {
          metrikaBlock = trimmed.replace(/\bssr\s*:\s*(true|false)\s*,?\s*/g, "").replace(/,(\s*})/g, "$1");
        }
      }

      let webmasterMeta = "";
      if (webmaster && webmaster.trim()) {
        const trimmed = webmaster.trim();
        if (trimmed.startsWith("<")) {
          webmasterMeta = trimmed;
        } else {
          webmasterMeta = `<meta name="yandex-verification" content="${trimmed}" />`;
        }
      }

      const injectYandex = (html: string): string => {
        let result = html;
        result = result.replace(/<!-- Yandex\.Metrika counter -->[\s\S]*?<!-- \/Yandex\.Metrika counter -->/gi, "");
        result = result.replace(/<script[^>]*>[\s\S]*?mc\.yandex\.ru\/metrika[\s\S]*?<\/script>/gi, "");
        result = result.replace(/<noscript[^>]*>[\s\S]*?mc\.yandex\.ru\/watch[\s\S]*?<\/noscript>/gi, "");
        result = result.replace(/<meta[^>]+name=["']yandex-verification["'][^>]*\/?>/gi, "");
        const toInject = [webmasterMeta, metrikaBlock].filter(Boolean).join("\n");
        if (toInject) {
          if (result.includes("</head>")) {
            result = result.replace("</head>", `${toInject}\n</head>`);
          } else {
            result = toInject + "\n" + result;
          }
        }
        return result;
      };

      const updatedCode = injectYandex(project.generatedCode);
      await storage.updateProject(projectId, { generatedCode: updatedCode });

      const files = await storage.getProjectFiles(projectId);
      for (const f of files) {
        if (f.filename.endsWith(".html")) {
          await storage.upsertProjectFile({ projectId, filename: f.filename, code: injectYandex(f.code) });
        }
      }

      res.json({ success: true, code: updatedCode });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Ошибка сохранения" });
    }
  });

  app.post("/api/projects/:id/domain", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Не авторизован" });
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      if (project.userId !== (req.user as any).id) return res.status(403).json({ message: "Нет доступа" });
      const { domain } = req.body;
      if (!domain) return res.status(400).json({ message: "Домен обязателен" });
      if (!project.vercelProjectId) return res.status(400).json({ message: "Сначала опубликуйте сайт" });

      try {
        const result = await addCustomDomain(project.vercelProjectId, domain);
        await storage.updateProject(projectId, { customDomain: domain });
        res.json(result);
      } catch (domainErr: any) {
        if (domainErr.message?.includes("already in use") || domainErr.message?.includes("already exists")) {
          await storage.updateProject(projectId, { customDomain: domain });
          // Fetch existing DNS zone nameservers for this domain
          let nameservers: string[] = [];
          try {
            const apex = domain.replace(/^www\./, "");
            const listRes = await fetch("https://api.netlify.com/api/v1/dns_zones", {
              headers: { Authorization: `Bearer ${process.env.NETLIFY_TOKEN}`, "Content-Type": "application/json" },
            });
            if (listRes.ok) {
              const zones = await listRes.json() as any[];
              const zone = zones.find((z: any) => z.name === apex);
              if (zone?.dns_servers?.length) nameservers = zone.dns_servers;
            }
          } catch {}
          res.json({ verified: false, cname: `craft-ai-p${projectId}.netlify.app`, alreadyAdded: true, nameservers });
        } else {
          throw domainErr;
        }
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Ошибка добавления домена" });
    }
  });

  app.get("/api/projects/:id/domain/status", requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      if (project.userId !== (req.user as any).id) return res.status(403).json({ message: "Доступ запрещён" });
      if (!project.vercelProjectId) return res.json({ verified: false });
      const { domain } = req.query as { domain: string };
      if (!domain) return res.status(400).json({ message: "Домен обязателен" });
      const result = await checkDomainStatus(project.vercelProjectId, domain as string);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ═══ LEADS API ═══

  app.options("/api/leads/:projectId", (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(204);
  });

  app.post("/api/leads/:projectId", leadIntakeLimiter, async (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    try {
      const projectId = parseInt(req.params.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        return res.status(400).json({ message: "Некорректный проект" });
      }
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Проект не найден" });

      const clean = (v: any, max: number) =>
        (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max).trim();
      const name = clean(req.body?.name, 100);
      const email = clean(req.body?.email, 254);
      const phone = clean(req.body?.phone, 40);
      const message = clean(req.body?.message, 2000);
      const source = clean(req.body?.source, 100) || "form";

      if (!name && !email && !phone && !message) {
        return res.status(400).json({ message: "Пустая заявка" });
      }

      const lead = await storage.createLead({ projectId, name, email, phone, message, source });
      res.json({ success: true, id: lead.id });
    } catch (err) {
      res.status(500).json({ message: "Ошибка сохранения заявки" });
    }
  });

  app.get("/api/generations", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id || 1;
      const images = await storage.getImagesByUser(userId);
      res.json(images);
    } catch (err) {
      res.status(500).json({ message: "Ошибка получения генераций" });
    }
  });

  app.get("/api/leads", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id || 1;
      const allLeads = await storage.getLeadsByUser(userId);
      res.json(allLeads);
    } catch (err) {
      res.status(500).json({ message: "Ошибка получения заявок" });
    }
  });

  app.get("/api/leads/unread-count", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id || 1;
      const count = await storage.getUnreadLeadCount(userId);
      res.json({ count });
    } catch (err) {
      res.json({ count: 0 });
    }
  });

  app.patch("/api/leads/:id/read", requireAuth, async (req, res) => {
    try {
      const leadId = parseInt(req.params.id);
      const existing = await storage.getLead(leadId);
      if (!existing) return res.status(404).json({ message: "Заявка не найдена" });
      const proj = await storage.getProject(existing.projectId);
      if (!proj || proj.userId !== (req.user as any).id) {
        return res.status(403).json({ message: "Доступ запрещён" });
      }
      const lead = await storage.markLeadRead(leadId);
      res.json(lead);
    } catch (err) {
      res.status(500).json({ message: "Ошибка" });
    }
  });

  app.delete("/api/leads/:id", requireAuth, async (req, res) => {
    try {
      const leadId = parseInt(req.params.id);
      const existing = await storage.getLead(leadId);
      if (!existing) return res.status(404).json({ message: "Заявка не найдена" });
      const proj = await storage.getProject(existing.projectId);
      if (!proj || proj.userId !== (req.user as any).id) {
        return res.status(403).json({ message: "Доступ запрещён" });
      }
      await storage.deleteLead(leadId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Ошибка удаления" });
    }
  });

  app.get("/api/proxy-image", requireAuth, proxyLimiter, async (req, res) => {
    try {
      const imageUrl = req.query.url as string;
      if (!imageUrl) return res.status(400).json({ message: "URL обязателен" });
      try {
        await assertPublicHttpUrl(imageUrl);
      } catch (e: any) {
        return res.status(400).json({ message: e?.message || "Недопустимый URL" });
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let contentType = "application/octet-stream";
      let buffer: Buffer;
      try {
        const response = await fetch(imageUrl, { redirect: "error", signal: controller.signal });
        if (!response.ok) throw new Error("Не удалось загрузить изображение");
        contentType = response.headers.get("content-type") || "application/octet-stream";
        if (!contentType.startsWith("image/")) {
          return res.status(400).json({ message: "URL не является изображением" });
        }
        buffer = Buffer.from(await response.arrayBuffer());
      } finally {
        clearTimeout(timeout);
      }
      if (buffer.length > 15 * 1024 * 1024) {
        return res.status(413).json({ message: "Изображение слишком большое" });
      }
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки изображения" });
    }
  });

  app.post("/api/projects/:id/unpublish", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Не авторизован" });
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      if (project.userId !== (req.user as any).id) return res.status(403).json({ message: "Нет доступа" });
      if (project.publishStatus !== "published") return res.status(400).json({ message: "Проект не опубликован" });

      await unpublishFromNetlify(projectId);
      await storage.updateProject(projectId, { publishStatus: "suspended" });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Ошибка снятия с публикации" });
    }
  });

  // ========== PAYMENT (1payment SBP) ==========
  const PAYMENT_PACKAGES = [
    { price: 990, tokens: 1000, label: "Старт" },
    { price: 1690, tokens: 1900, label: "Базовый" },
    { price: 3990, tokens: 4500, label: "Профи" },
    { price: 9990, tokens: 10000, label: "Ультра" },
  ];

  function make1paymentSign(params: Record<string, string>, apiKey: string): string {
    const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
    const raw = `init_form${sorted}${apiKey}`;
    return crypto.createHash("md5").update(raw).digest("hex");
  }

  app.post("/api/payments/create", async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Не авторизован" });
      const userId = (req.user as any).id;
      const { price } = req.body;

      const pack = PAYMENT_PACKAGES.find(p => p.price === price);
      if (!pack) return res.status(400).json({ message: "Неверный тариф" });

      const partnerId = process.env.ONEPAYMENT_PARTNER_ID;
      const projectId = process.env.ONEPAYMENT_PROJECT_ID;
      const apiKey = process.env.ONEPAYMENT_API_KEY;
      if (!partnerId || !projectId || !apiKey) {
        return res.status(500).json({ message: "Платежная система не настроена" });
      }

      const order = await storage.createPaymentOrder({
        userId,
        amount: pack.price,
        tokens: pack.tokens,
      });

      const baseUrl = req.headers.origin || `https://${req.headers.host}`;
      const verifyHash = crypto.createHash("md5").update(`${order.id}:${userId}:${apiKey}`).digest("hex");
      const userData = JSON.stringify({ orderId: order.id, userId, v: verifyHash });

      const user = req.user as any;
      const paymentUserId = user.telegramId || user.yandexId || String(user.id);

      const params: Record<string, string> = {
        partner_id: partnerId,
        project_id: projectId,
        amount: String(pack.price),
        description: `Craft AI: ${pack.tokens} токенов (${pack.label})`,
        success_url: `${baseUrl}/dashboard?payment=success`,
        failure_url: `${baseUrl}/dashboard?payment=failed`,
        shop_url: "https://craft-ai.ru",
        user_id: paymentUserId,
        user_data: userData,
      };

      const sign = make1paymentSign(params, apiKey);
      params.sign = sign;

      const response = await fetch("https://api.1payment.com/init_form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const data = await response.json() as any;
      if (!data.url) {
        console.error("1payment error:", data);
        return res.status(500).json({ message: "Ошибка создания платежа" });
      }

      await storage.updatePaymentOrderStatus(order.id, "created", data.order_id || undefined, undefined);

      res.json({ url: data.url, orderId: order.id });
    } catch (err: any) {
      console.error("Payment create error:", err);
      res.status(500).json({ message: "Ошибка создания платежа" });
    }
  });

  app.post("/api/payments/webhook", async (req, res) => {
    try {
      const { order_id, status, user_data, merchant_price, test } = req.body;
      console.log("[Payment Webhook]", JSON.stringify(req.body));

      let parsed: { orderId: number; userId: number; v?: string };
      try {
        parsed = JSON.parse(user_data);
      } catch {
        console.error("Invalid user_data in webhook:", user_data);
        return res.json({ status: "ok" });
      }

      const order = await storage.getPaymentOrderById(parsed.orderId);
      if (!order) {
        console.error("Payment order not found:", parsed.orderId);
        return res.json({ status: "ok" });
      }

      const apiKey = process.env.ONEPAYMENT_API_KEY || "";
      const expectedHash = crypto.createHash("md5").update(`${parsed.orderId}:${parsed.userId}:${apiKey}`).digest("hex");
      if (parsed.v !== expectedHash) {
        console.error("Payment webhook signature mismatch for order:", parsed.orderId);
        return res.json({ status: "ok" });
      }

      if (order.status === "paid") {
        return res.json({ status: "ok" });
      }

      if (Number(status) === 3) {
        await storage.updatePaymentOrderStatus(order.id, "paid", order_id, new Date());

        const user = await storage.getUser(order.userId);
        if (user) {
          await storage.updateUserCredits(order.userId, user.credits + order.tokens);

          const idempotencyKey = `payment_${order.id}`;
          await db.insert(creditTransactions).values({
            userId: order.userId,
            amount: order.tokens,
            type: "credit",
            operation: "payment",
            note: `Оплата ${order.amount}₽ — ${order.tokens} токенов`,
            idempotencyKey,
          }).onConflictDoNothing();
        }

        console.log(`[Payment] User ${order.userId} credited ${order.tokens} tokens (order ${order.id})`);
      } else if (Number(status) === 4) {
        await storage.updatePaymentOrderStatus(order.id, "failed", order_id);
        console.log(`[Payment] Order ${order.id} failed`);
      }

      res.json({ status: "ok" });
    } catch (err: any) {
      console.error("Payment webhook error:", err);
      res.json({ status: "ok" });
    }
  });

  app.get("/api/payments/history", async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Не авторизован" });
      const orders = await storage.getPaymentOrdersByUser((req.user as any).id);
      res.json(orders);
    } catch (err: any) {
      res.status(500).json({ message: "Ошибка загрузки истории" });
    }
  });

  function make1paymentStatusSign(params: Record<string, string>, apiKey: string): string {
    const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
    const raw = `status_payment${sorted}${apiKey}`;
    return crypto.createHash("md5").update(raw).digest("hex");
  }

  app.post("/api/payments/check-status", async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Не авторизован" });
      const { orderId } = req.body;

      const order = await storage.getPaymentOrderById(orderId);
      if (!order) return res.status(404).json({ message: "Заказ не найден" });
      if (order.userId !== (req.user as any).id) return res.status(403).json({ message: "Forbidden" });
      if (order.status === "paid") return res.json({ status: "paid", tokens: order.tokens });

      const partnerId = process.env.ONEPAYMENT_PARTNER_ID;
      const projectId = process.env.ONEPAYMENT_PROJECT_ID;
      const apiKey = process.env.ONEPAYMENT_API_KEY;
      if (!partnerId || !projectId || !apiKey || !order.orderId) {
        return res.json({ status: order.status });
      }

      const params: Record<string, string> = {
        partner_id: partnerId,
        project_id: projectId,
        order_id: order.orderId,
      };
      params.sign = make1paymentStatusSign(params, apiKey);

      const response = await fetch("https://api.1payment.com/status_payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await response.json() as any;
      console.log("[Payment Status Check]", JSON.stringify(data));

      if (Number(data.status) === 3 && order.status !== "paid") {
        await storage.updatePaymentOrderStatus(order.id, "paid", order.orderId, new Date());
        const user = await storage.getUser(order.userId);
        if (user) {
          await storage.updateUserCredits(order.userId, user.credits + order.tokens);
          const idempotencyKey = `payment_${order.id}`;
          await db.insert(creditTransactions).values({
            userId: order.userId,
            amount: order.tokens,
            type: "credit",
            operation: "payment",
            note: `Оплата ${order.amount}₽ — ${order.tokens} токенов`,
            idempotencyKey,
          }).onConflictDoNothing();
        }
        return res.json({ status: "paid", tokens: order.tokens });
      } else if (Number(data.status) === 4) {
        await storage.updatePaymentOrderStatus(order.id, "failed", order.orderId);
        return res.json({ status: "failed" });
      }

      res.json({ status: data.status_description || order.status });
    } catch (err: any) {
      console.error("Payment status check error:", err);
      res.status(500).json({ message: "Ошибка проверки статуса" });
    }
  });

  const ADMIN_TELEGRAM_ID = "661325490";
  const adminOnly = (req: any, res: any, next: any) => {
    if (!req.user) return res.status(403).json({ message: "Forbidden" });
    const isAdmin = req.user.id === 1 || req.user.telegramId === ADMIN_TELEGRAM_ID;
    if (!isAdmin) return res.status(403).json({ message: "Forbidden" });
    next();
  };

  app.get("/api/admin/stats", adminOnly, async (req, res) => {
    try {
      const stats = await storage.adminGetStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/users", adminOnly, async (req, res) => {
    try {
      const allUsers = await storage.adminGetAllUsers();
      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/users/:userId", adminOnly, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(user);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/users/:userId/transactions", adminOnly, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const txns = await storage.adminGetUserTransactions(userId);
      res.json(txns);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/users/:userId/projects", adminOnly, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const userProjects = await storage.adminGetUserProjects(userId);
      res.json(userProjects);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/users/:userId/adjust-credits", adminOnly, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { amount, type, note } = req.body;
      if (!amount || !type || !["credit", "debit"].includes(type)) {
        return res.status(400).json({ message: "amount, type (credit|debit) required" });
      }
      const user = await storage.adminAdjustCredits(userId, Number(amount), type, type === "credit" ? "admin_add" : "admin_deduct", note || "");
      res.json({ success: true, user });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  async function runDailyPublishBilling() {
    const today = new Date().toISOString().slice(0, 10);
    console.log(`[Billing] Starting daily publish billing for ${today}...`);
    try {
      const usersWithSites = await storage.getAllUsersWithPublishedSites();

      for (const { userId, publishedCount } of usersWithSites) {
        const user = await storage.getUser(userId);
        if (!user) continue;

        const userProjects = await storage.getProjectsByUser(userId);
        const publishedProjects = userProjects.filter(p => p.publishStatus === "published");

        for (const proj of publishedProjects) {
          const idempotencyKey = `daily-publish-${proj.id}-${today}`;
          const result = await storage.deductCredits(userId, DAILY_PUBLISH_COST, "daily_publish", idempotencyKey);

          if (result.alreadyProcessed) {
            continue;
          }

          if (result.success) {
            console.log(`[Billing] User ${userId}: charged ${DAILY_PUBLISH_COST} tokens for project ${proj.id} (${proj.title}). Balance: ${result.newBalance}`);
          } else {
            await unpublishFromNetlify(proj.id);
            await storage.updateProject(proj.id, { publishStatus: "suspended" });
            console.log(`[Billing] User ${userId}: suspended project ${proj.id} (${proj.title}) — insufficient balance (${result.newBalance} tokens)`);
          }
        }
      }

      console.log("[Billing] Daily publish billing completed.");
    } catch (err) {
      console.error("[Billing] Error during daily billing:", err);
    }
  }

  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(3, 0, 0, 0);
  if (nextMidnight <= now) nextMidnight.setDate(nextMidnight.getDate() + 1);
  const msUntilFirstRun = nextMidnight.getTime() - now.getTime();
  setTimeout(() => {
    runDailyPublishBilling();
    setInterval(runDailyPublishBilling, 24 * 60 * 60 * 1000);
  }, msUntilFirstRun);
  console.log(`[Billing] Next daily billing scheduled in ${Math.round(msUntilFirstRun / 1000 / 60)} minutes (at 03:00)`);

  return httpServer;
}
