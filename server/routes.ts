import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { buildSite3dAnimHtml, buildSite3dPendingHtml } from "./site3d-anim";
import {
  buildImmersionGlassHtml,
  buildImmersionGlassPendingHtml,
} from "./immersion-glass";
import {
  SCROLL_MOTION_COST,
  generateMotionRevealPair,
  buildMotionRevealHtml,
  type GenerateMotionRevealDeps,
} from "./motion-reveal";
import {
  SCROLL_ANIMATIONAL_COST,
  ANIMATIONAL_SYSTEM_PROMPT,
  generateAnimationalSite,
  buildAnimationalPendingHtml,
  buildAnimationalFallbackHtml,
  parseAnimationalMarker,
  type GenerateAnimationalDeps,
} from "./animational";
import { setupAuth } from "./auth";
import { gemini } from "./gemini";
import { deployToYandex, addCustomDomain, removeCustomDomain, checkDomainStatus, unpublishFromYandex, deleteProjectFromYandex, getDomainProxyIp } from "./yandex-deploy";
import { registerSeoRoutes } from "./seo-routes";
import { ObjectStorageService, objectStorageClient } from "./replit_integrations/object_storage";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { rateLimit, userOrIpKey } from "./rate-limit";
import { assertPublicHttpUrl, safeFetch } from "./url-guard";
import { isPublishableProjectFile } from "@shared/project-files";
import { domainToASCII } from "node:url";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import {
  CRAFT_MD_FILENAME,
  ensureCraftMd,
  refreshCraftMdPages,
  buildMultipageEditSystemPrompt,
  runToolCallingAgent,
  parseMultipageEditResponse,
  applyDiffPatchesToCode,
  isHtmlPage,
  type SitePage,
} from "./agent-runtime";
import {
  KieApiError,
  isConfirmedKieApiFailure,
  isConfirmedKieJobBodyFailure,
  isKieModerationFailure,
  isKieTaskInfraFailure,
  kieHttpError,
} from "./kie-errors";

/** Refund only when billed AND we are 100% sure KIE API failed. */
async function refundIfConfirmedKie(
  billed: boolean,
  userId: number | undefined | null,
  amount: number,
  ikey: string | undefined,
  errOrFlag: unknown,
  label: string,
): Promise<boolean> {
  if (!billed || !userId || amount <= 0) return false;
  const ok =
    errOrFlag === true ||
    (typeof errOrFlag === "boolean" ? errOrFlag : isConfirmedKieApiFailure(errOrFlag));
  if (!ok) {
    console.log(`[REFUND-SKIP] ${label}: not a confirmed KIE failure — keeping charge`);
    return false;
  }
  try {
    await storage.refundCredits(userId, amount, ikey);
    console.log(`[REFUND] ${label}: +${amount} tokens (confirmed KIE failure)`);
    return true;
  } catch (e: any) {
    console.warn(`[REFUND] ${label} failed:`, e?.message || e);
    return false;
  }
}

/** Pending manual image charges keyed by KIE taskId — refunded only on confirmed infra fail. */
type PendingImageCharge = { userId: number; amount: number; ikey: string; createdAt: number };
const pendingImageCharges = new Map<string, PendingImageCharge>();
setInterval(() => {
  const cutoff = Date.now() - 45 * 60 * 1000;
  for (const [k, v] of Array.from(pendingImageCharges.entries())) {
    if (v.createdAt < cutoff) pendingImageCharges.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

// Rate limiters (in-memory, single-instance)
const leadIntakeLimiter = rateLimit("lead-intake", { windowMs: 60_000, max: 20, message: "Слишком много заявок. Попробуйте позже." });
const aiLimiter = rateLimit("ai", { windowMs: 60_000, max: 20, keyGenerator: userOrIpKey, message: "Слишком много запросов к ИИ. Подождите минуту." });
const proxyLimiter = rateLimit("proxy", { windowMs: 60_000, max: 60, keyGenerator: userOrIpKey });

const objectStorage = new ObjectStorageService();

async function uploadToObjectStorage(buffer: Buffer, mimeType: string, ext: string): Promise<string> {
  // Auto-detect actual image format from magic bytes so PNG data never gets saved
  // with a .jpg extension (Nano Banana often returns PNG regardless of outputFormat).
  // Object Storage serves files with Content-Type based on extension, so a wrong extension
  // causes strict browsers (Yandex, Safari) to reject the image as invalid.
  if (buffer.length >= 12) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      mimeType = "image/png"; ext = "png";
    } else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      mimeType = "image/jpeg"; ext = "jpg";
    } else if (buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") {
      mimeType = "image/webp"; ext = "webp";
    } else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      mimeType = "image/gif"; ext = "gif";
    }
  }
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

// Compress a raster image for publishing so it lands around 150-300KB while staying
// visually lossless. Photos (no transparency) → mozjpeg; images with an alpha channel
// → WebP (preserves transparency at a fraction of PNG size). Returns the original
// buffer unchanged when it's already small, isn't a raster image, or can't be processed.
// Animation frames are NEVER passed here — they are bundled at full quality (no compression).
async function compressImageForPublish(buffer: Buffer): Promise<Buffer> {
  const TARGET_MAX = 300 * 1024;
  if (buffer.length <= TARGET_MAX) return buffer; // already light enough — keep as-is
  try {
    const sharpMod = (await import("sharp")).default;
    const meta = await sharpMod(buffer).metadata();
    if (!meta.width || !meta.height) return buffer;
    const MAX_DIM = 1920; // full-width heroes never need more than this on the web
    const resizeOpts = (meta.width > MAX_DIM || meta.height > MAX_DIM)
      ? { width: MAX_DIM, height: MAX_DIM, fit: "inside" as const, withoutEnlargement: true }
      : undefined;
    const mk = () => { let p = sharpMod(buffer).rotate(); if (resizeOpts) p = p.resize(resizeOpts); return p; };
    let out: Buffer;
    if (meta.hasAlpha) {
      let q = 86;
      out = await mk().webp({ quality: q }).toBuffer();
      while (out.length > TARGET_MAX && q > 50) { q -= 8; out = await mk().webp({ quality: q }).toBuffer(); }
    } else {
      let q = 86;
      out = await mk().jpeg({ quality: q, mozjpeg: true }).toBuffer();
      while (out.length > TARGET_MAX && q > 55) { q -= 7; out = await mk().jpeg({ quality: q, mozjpeg: true }).toBuffer(); }
      if (out.length > TARGET_MAX) {
        // Last resort: downscale harder to guarantee a reasonable weight
        out = await sharpMod(buffer).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
      }
    }
    return out.length < buffer.length ? out : buffer; // never grow the file
  } catch (e: any) {
    console.warn(`[Publish] Image compression skipped (using original):`, e?.message || e);
    return buffer;
  }
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
// Agent v1 = Claude Sonnet 5 via KIE's Anthropic-style Messages API proxy.
const KIE_LLM_URL = "https://api.kie.ai/claude/v1/messages";
const KIE_LLM_MODEL = "claude-sonnet-5";
const KIE_LLM_MAX_TOKENS = 64000;
const KIE_GEMINI_URL = "https://api.kie.ai/gemini/v1/models/gemini-3-5-flash:streamGenerateContent";

const AUTO_IMAGE_COST = 15;
// Hard ceiling. The model decides how many images a site actually needs; this is just
// the upper bound it can never exceed (markers past it become gradient placeholders).
const MAX_AUTO_IMAGES = 10;
// Cap simultaneous KIE image generations. Firing all of them at once spikes 429
// rate-limits (failed images fall back to a gradient placeholder, which reintroduces
// broken-looking mixed grids). 6 is the concurrency level that already ran reliably;
// 10 images resolve in ~2 waves.
const MAX_AUTO_IMAGE_CONCURRENCY = 6;

// ─────────────────────────── Scroll Animation (Интерактивный режим) ───────────────────────────
// Generate a short white-background video via KIE Kling, slice it into compressed WebP frames,
// store each frame in object storage, and build a self-contained scroll-bound Canvas animation
// block. Mirrors the {{GENIMG:...}} marker system with {{SCROLLANIM:videoPrompt|T::S||T::S}}.
const SCROLL_ANIM_COST = 120;
const SCROLL_FRAME_COUNT = 90;     // target frames extracted from a 5s clip
const SCROLL_VIDEO_DURATION = 5;   // seconds
// "Экшн" (action / Hollywood-blockbuster) mode: longer clip + more sliced frames for a
// richer, smoother slow-motion / bullet-time scrub.
const SCROLL_ACTION_VIDEO_DURATION = 6;  // seconds (blockbuster shot length)
const SCROLL_ACTION_FRAME_COUNT = 96;    // sliced frames for the clip (matches ~16fps density used at 10s)
type ScrollAnimLayout = "parallax" | "split" | "action" | "immersion" | "site3d" | "motion" | "animational";

function resolveScrollAnimLayout(style?: string | null): ScrollAnimLayout {
  if (style === "split") return "split";
  if (style === "action") return "action";
  if (style === "immersion") return "immersion";
  if (style === "site3d") return "site3d";
  if (style === "motion") return "motion";
  if (style === "animational") return "animational";
  return "parallax";
}
const KLING_IMG2VID_MODEL = "kling/v3-turbo-image-to-video";

function csaEsc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let _ffmpegStaticPath: string | null | undefined = undefined;
let _ffmpegTmpPath: string | null = null;

// Resolve (and cache) a path to an executable ffmpeg binary. Prefer the bundled
// ffmpeg-static binary (works in the deployed env where PATH has no ffmpeg); fall
// back to a system ffmpeg discovered via `which` (dev environment).
async function getFfmpegStaticPath(): Promise<string | null> {
  if (_ffmpegStaticPath !== undefined) return _ffmpegStaticPath;
  let p: string | null = null;
  try {
    const m: any = await import("ffmpeg-static").catch(() => null);
    const sp = m?.default ?? m ?? null;
    if (typeof sp === "string" && sp) p = sp;
  } catch {}
  if (!p) {
    try {
      const { execSync } = await import("child_process");
      const w = execSync("which ffmpeg").toString().trim();
      if (w) p = w;
    } catch {}
  }
  _ffmpegStaticPath = p;
  console.log(p ? `[FFMPEG] binary: ${p}` : "[FFMPEG] binary NOT found via ffmpeg-static or PATH");
  return p;
}

// Some deploy filesystems (read-only / overlay layers) throw EIO/ETXTBSY when the
// ffmpeg-static binary is exec'd straight out of node_modules. As a fallback we copy
// it once into a writable tmp dir (chmod +x) and exec from there instead.
async function getFfmpegBinary(forceTmpCopy = false): Promise<string | null> {
  const base = await getFfmpegStaticPath();
  if (!base) return null;
  if (!forceTmpCopy) return base;
  if (_ffmpegTmpPath && fs.existsSync(_ffmpegTmpPath)) return _ffmpegTmpPath;
  try {
    const dest = path.join(os.tmpdir(), `craft-ffmpeg-${process.pid}`);
    fs.copyFileSync(base, dest);
    fs.chmodSync(dest, 0o755);
    _ffmpegTmpPath = dest;
    console.log(`[FFMPEG] copied binary to writable tmp: ${dest}`);
    return dest;
  } catch (e: any) {
    console.warn(`[FFMPEG] tmp-copy failed: ${e?.message}`);
    return base;
  }
}

// Extract JPEG frames from a video into framesDir/frame_%04d.jpg, returning the
// frame count. Uses a DIRECT child_process spawn with stdio FULLY ignored instead of
// fluent-ffmpeg: fluent-ffmpeg drains the ffmpeg stderr pipe, and in the deployed
// (restricted) filesystem that pipe read intermittently throws "EIO: i/o error, read",
// which killed the whole animation even though the mp4 had downloaded fine. No pipes =
// no pipe-read EIO. Success = exit code 0 AND >0 frames; on failure we retry (with the
// binary copied to writable tmp) so a transient EIO or an exec-from-node_modules EIO
// never wastes the already-rendered, already-billed video.
async function extractFramesWithFfmpeg(
  videoPath: string,
  framesDir: string,
  fps: number,
  shouldStop: () => boolean = () => false,
): Promise<number> {
  const { spawn } = await import("child_process");
  // Extract frames at full resolution and max mjpeg quality (-q:v 1). Frames are NOT
  // downscaled or recompressed — per user request, any frame compression visibly
  // degraded the scroll animation. (Heavy product photos are still compressed at
  // publish; only the animation frames are kept lossless.)
  const args = ["-y", "-i", videoPath, "-vf", `fps=${fps}`, "-q:v", "1", path.join(framesDir, "frame_%04d.jpg")];
  const MAX_TRIES = 3;
  let lastErr: any = null;
  for (let t = 0; t < MAX_TRIES; t++) {
    if (shouldStop()) break;
    const bin = await getFfmpegBinary(t > 0); // after the first failure, exec a tmp-copied binary
    if (!bin) throw new Error("ffmpeg binary not found");
    // clear any partial frames left by a previous failed attempt
    try { for (const f of fs.readdirSync(framesDir)) fs.rmSync(path.join(framesDir, f), { force: true }); } catch {}
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "ignore"] });
        proc.on("error", reject);
        proc.on("close", (code: number) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
      });
      const n = fs.readdirSync(framesDir).filter(f => /\.jpg$/i.test(f)).length;
      if (n > 0) { console.log(`[FFMPEG] extracted ${n} frames (try ${t + 1}, bin=${bin})`); return n; }
      lastErr = new Error("ffmpeg produced 0 frames");
    } catch (err: any) {
      lastErr = err;
      console.warn(`[FFMPEG] extract try ${t + 1}/${MAX_TRIES} failed: ${err?.message}`);
    }
    if (t < MAX_TRIES - 1) await new Promise(r => setTimeout(r, 1500));
  }
  throw lastErr || new Error("ffmpeg extraction failed");
}

// Set fluent-ffmpeg's binary path (still used by the user-video ffprobe duration probe).
async function ensureFfmpegPath(ffmpeg: any): Promise<void> {
  const p = await getFfmpegStaticPath();
  if (p) { try { ffmpeg.setFfmpegPath(p); } catch {} }
}

// Robust KIE request wrapper. KIE frequently returns transient server errors
// (HTTP 429/5xx, empty bodies, or an in-body error `code`) — any one of which can
// otherwise abort a whole generation. This retries with exponential backoff so a
// single KIE hiccup never kills the animation/image pipeline. Returns the parsed
// JSON body (or the last error body / null when every attempt failed).
async function kieRequestJson(
  url: string,
  init: RequestInit,
  opts: { label?: string; retries?: number; shouldStop?: () => boolean; timeoutMs?: number } = {},
): Promise<any | null> {
  const retries = opts.retries ?? 4;
  const shouldStop = opts.shouldStop ?? (() => false);
  const label = opts.label ?? "KIE";
  const timeoutMs = opts.timeoutMs ?? 30000; // hard per-request cap so a hung fetch can't bust budgets
  let last: any = null;
  for (let i = 0; i <= retries; i++) {
    if (shouldStop()) return last;
    if (i > 0) {
      const delay = Math.min(2000 * 2 ** (i - 1), 16000); // 2s,4s,8s,16s,16s...
      await new Promise((r) => setTimeout(r, delay));
      if (shouldStop()) return last;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...init, signal: ctrl.signal });
      if (resp.status === 429 || resp.status >= 500) {
        console.warn(`[KIE-RETRY] ${label}: HTTP ${resp.status} (try ${i + 1}/${retries + 1})`);
        continue;
      }
      const body: any = await resp.json().catch(() => null);
      if (body == null) {
        console.warn(`[KIE-RETRY] ${label}: empty/non-JSON body (try ${i + 1}/${retries + 1})`);
        continue;
      }
      // KIE sometimes signals a transient failure via an in-body code (rate limit / 5xx)
      if (typeof body.code === "number" && (body.code === 429 || body.code >= 500)) {
        console.warn(`[KIE-RETRY] ${label}: body.code ${body.code} (try ${i + 1}/${retries + 1}) ${body.msg || ""}`);
        last = body;
        continue;
      }
      return body;
    } catch (e: any) {
      console.warn(`[KIE-RETRY] ${label}: network error (try ${i + 1}/${retries + 1}): ${e?.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

// Step 0 helper: generate a cinematic still image for use as the video source frame.
// Returns the raw public CDN URL from KIE (NOT re-uploaded) so Kling can fetch it.
async function generateStillForVideo(
  scenePrompt: string,
  shouldStop: () => boolean = () => false,
  layout: ScrollAnimLayout = "parallax",
): Promise<string | null> {
  if (!KIE_API_KEY) return null;
  const imagePrompt = layout === "action"
    ? `${scenePrompt.trim()}. Freeze-frame the PEAK moment of the action already in full swing — debris, shards, sparks, dust, splashes ` +
      `or particles described in the scene must be VISIBLY ALREADY suspended/exploding/shattering in this exact frame (not implied, not about ` +
      `to happen — physically present and mid-motion right now), so the shot reads as a paused instant of a Hollywood action sequence, not a calm ` +
      `product photo. A complete immersive cinematic SCENE with a real environment and layered depth (NOT a plain solid backdrop). ` +
      `Ultra-cinematic widescreen film still, shot on ARRI Alexa with an anamorphic lens, photorealistic, breathtaking dramatic ` +
      `composition that draws the eye deep into the scene, with a slightly calmer focal area where large overlay text can stay legible. ` +
      `Bold directional key light with soft volumetric god rays, rich filmic color grading, deep elegant shadows and luminous ` +
      `highlights, gentle atmospheric haze for depth, immersive premium Hollywood blockbuster mood, IMAX-grade spectacle. ` +
      `No text, no watermark, no logos, ultra-high detail, 8K, 16:9 aspect ratio.`
    : layout === "site3d"
    ? `${scenePrompt.trim()}. Premium PRODUCT-HERO commercial still on a PURE BLACK void — no room, no floor, no environment set. ` +
      `The product is centered and is the only subject. Studio rim light, strong key light, deep elegant shadows, rich glossy reflections, ` +
      `photorealistic, ultra-high detail, 8K, 16:9. No text, no watermark, no logos.`
    : layout === "immersion"
    ? `${scenePrompt.trim()}. Freeze the OPENING THRESHOLD of an immersion fly-through: the viewer is looking through a portal ` +
      `(window, doorway, arch, glass facade, tunnel mouth, balcony frame — matching the scene), about to fly through it. ` +
      `Strong depth beyond the threshold, volumetric light, photorealistic cinematic still, 8K, 16:9. No text, no watermark, no logos.`
    : `${scenePrompt.trim()}. A complete immersive cinematic SCENE with a real environment and layered depth (NOT a plain solid backdrop). ` +
      `Ultra-cinematic widescreen film still, shot on ARRI Alexa with an anamorphic lens, photorealistic, breathtaking dramatic ` +
      `composition that draws the eye deep into the scene, with a slightly calmer focal area where large overlay text can stay legible. ` +
      `Bold directional key light with soft volumetric god rays, rich filmic color grading, deep elegant shadows and luminous ` +
      `highlights, gentle atmospheric haze for depth, immersive premium Hollywood mood. No text, no watermark, no logos, ultra-high detail, 8K, 16:9 aspect ratio.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (shouldStop()) return null;
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
    let taskId: string | null = null;
    const createBody: any = await kieRequestJson(
      NANO_BANANA_CREATE_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${KIE_API_KEY}` },
        body: JSON.stringify({
          model: "nano-banana-2",
          input: {
            prompt: imagePrompt,
            aspect_ratio: "16:9",
            resolution: "1K",
            output_format: "jpg",
          },
        }),
      },
      { label: "SCROLLANIM still-create", retries: 2, shouldStop },
    );
    if (createBody?.code === 200 && createBody?.data?.taskId) taskId = createBody.data.taskId;
    else { console.warn("[SCROLLANIM] still-image create failed:", createBody?.msg); continue; }
    const imgDeadline = Date.now() + 90000; // 90s per attempt — nano-banana 1K is usually <20s
    let pollWait = 1500;
    while (Date.now() < imgDeadline) {
      if (shouldStop()) return null;
      await new Promise(r => setTimeout(r, pollWait));
      pollWait = 1500;
      const body: any = await kieRequestJson(
        `${NANO_BANANA_STATUS_URL}?taskId=${taskId}`,
        { headers: { "Authorization": `Bearer ${KIE_API_KEY}` } },
        { label: "SCROLLANIM still-poll", retries: 1, shouldStop: () => shouldStop() || Date.now() >= imgDeadline },
      );
      if (!body || body.code !== 200 || !body.data) continue;
      const state = body.data.state;
      if (state === "success") {
        const result = JSON.parse(body.data.resultJson || "{}");
        const cdnUrl = (result.resultUrls || [])[0] || null;
        if (cdnUrl) {
          // Re-upload to Object Storage → stable permanent URL Kling can always fetch
          // (KIE CDN URLs may expire before Kling dequeues the task, causing video-create to fail)
          try {
            const imgResp = await fetch(cdnUrl, { signal: AbortSignal.timeout(25000) });
            if (imgResp.ok) {
              const imgBuf = Buffer.from(await imgResp.arrayBuffer());
              const relUrl = await uploadToObjectStorage(imgBuf, "image/jpeg", "jpg");
              const appBase = process.env.APP_BASE_URL || "https://craft-ai.ru";
              const stableUrl = `${appBase}${relUrl}`;
              console.log(`[SCROLLANIM] still re-uploaded → stable URL: ${stableUrl}`);
              return stableUrl;
            }
          } catch (upErr: any) {
            console.warn("[SCROLLANIM] still re-upload failed, using raw CDN URL:", upErr?.message);
          }
          console.log(`[SCROLLANIM] still image ready (CDN fallback): ${cdnUrl}`);
          return cdnUrl;
        }
        break;
      }
      if (state === "fail" || state === "failed" || state === "error") {
        console.warn(`[SCROLLANIM] still-image task failed (attempt ${attempt + 1}):`, body.data?.failMsg);
        break;
      }
    }
  }
  console.warn("[SCROLLANIM] still-image generation failed after all attempts");
  return null;
}

// A product-aware creative concept for the scroll video: a small static element to
// bake into the still (via image-to-image) plus the matching motion to animate it.
type CreativeProductConcept = {
  stillAddition: string; // extra static accent to composite into the still
  motionPrompt: string;  // image-to-video motion that animates the scene
  productSummary?: string;
};

// Load product-image bytes for vision analysis. We ONLY read images we host
// ourselves under "/objects/..." (the path uploaded product photos always use),
// reading straight from object storage by entity id. We deliberately never
// server-fetch an arbitrary external URL here — that avoids SSRF / redirect / DNS
// rebinding risk entirely. Anything that isn't an own object path is skipped (the
// caller then falls back to the generic, non-vision video prompt).
async function fetchProductImageForVision(
  productImageUrl: string,
): Promise<{ base64: string; mimeType: string } | null> {
  const MAX_BYTES = 12 * 1024 * 1024; // 12 MB
  let pathname = "";
  try { pathname = new URL(productImageUrl).pathname; } catch { pathname = productImageUrl; }
  if (!pathname.startsWith("/objects/")) return null; // never fetch external URLs
  try {
    const file = await objectStorage.getObjectEntityFile(pathname);
    const [meta] = await file.getMetadata();
    const mimeType = (meta.contentType as string) || "image/png";
    if (!mimeType.startsWith("image/")) return null;
    if (Number(meta.size || 0) > MAX_BYTES) {
      console.warn("[SCROLLANIM] product image too large for vision:", meta.size);
      return null;
    }
    const [buf] = await file.download();
    if (!buf?.length || buf.length > MAX_BYTES) return null;
    return { base64: buf.toString("base64"), mimeType };
  } catch (e: any) {
    console.warn("[SCROLLANIM] vision image read failed:", e?.message);
    return null;
  }
}

// Analyze the uploaded product photo with Gemini vision and invent ONE tasteful,
// product-aware cinematic concept (e.g. a butterfly landing on a cream, petals
// drifting) instead of a plain 360 rotation. Returns null on any failure/timeout so
// the caller falls back to the generic video prompt and the pipeline never breaks.
async function generateCreativeConcept(
  productImageUrl: string,
  layout: ScrollAnimLayout,
  shouldStop: () => boolean = () => false,
): Promise<CreativeProductConcept | null> {
  if (shouldStop()) return null;
  const img = await fetchProductImageForVision(productImageUrl);
  if (!img || shouldStop()) return null;

  const placementNote = layout === "split"
    ? "The product sits on the RIGHT third of the frame and the LEFT half stays clean empty space for text, so keep any added element on or near the product on the right and never fill the left half."
    : "The product is centered, so keep any added element close around the product.";

  const isAction = layout === "action";
  const durSec = isAction ? "10-second" : "5-second";
  const conceptLine = isAction
    ? "Design ONE explosive HOLLYWOOD-BLOCKBUSTER action concept for a 10-second scroll-bound hero video that delivers an instant WOW — the most spectacular shot of an action film built around THIS product, NOT a calm product ad and NOT a boring 360 rotation."
    : "Design ONE spectacular, premium cinematic concept for a 5-second scroll-bound hero video that delivers an instant WOW. NOT a boring 360 rotation.";
  const motionLine = isAction
    ? "The motion MUST be powerful, clearly visible and build dramatically across the 10 seconds (the viewer scrubs it by scrolling — subtle motion looks broken and dull). Combine a bold SLOW-MOTION camera ORBIT/ARC that flies AROUND the product (bullet-time feel) with ONE explosive signature effect — a splash, liquid, powder, petals, sparks or glittering shards bursting outward and hanging FROZEN in mid-air around the product."
    : "The motion MUST be clearly visible and evolve dramatically across the 5 seconds (the viewer scrubs it by scrolling — subtle or imperceptible motion looks broken and dull). Always combine a slow cinematic camera PUSH-IN with ONE bold signature effect that genuinely moves.";
  const focalRule = isAction
    ? "- ONE explosive focal effect (a suspended burst) + a slow-motion camera orbit/arc — both already plausible from the composed still;"
    : "- ONE bold focal effect + the slow camera push-in — both already plausible from the composed still;";
  const criticalBlock = isAction
    ? `CRITICAL for motionPrompt:
The Kling video model gets the RENDERED STILL as frame 1 — the explosive burst (suspended splash / shards / particles) is ALREADY composed and frozen in the still. Animate that suspended burst drifting in slow motion PLUS a slow-motion camera ORBIT/ARC sweeping around the product. Keep the REAL product and its label perfectly intact. Do NOT spawn brand-new objects from off-screen, and never make the motion so subtle it looks frozen.
✓ CORRECT: "the camera arcs slowly around the bottle in bullet-time as the suspended splash droplets drift and bright glints sweep across the glass"
✗ WRONG:   "a car drives in from the left" (it wasn't in the still) / "the product barely shimmers" (too subtle, looks static)`
    : `CRITICAL for motionPrompt:
The Kling video model gets the RENDERED STILL as frame 1 — the scene is already composed.
Animate ONLY what is already visible (light, shadow, mist, liquid, particles, reflections, texture) PLUS a slow camera push-in. Do NOT introduce new objects flying in, and never make the motion so subtle it looks frozen.
✓ CORRECT: "a hard spotlight beam sweeps boldly left-to-right across the metallic lid while the camera pushes in slowly and the shadow glides across the surface"
✗ WRONG:   "a spark flies in from the left" (it wasn't in the still) / "the lid barely shimmers" (too subtle, looks static)`;
  const guardrailLine = layout === "split"
    ? "SPLIT GUARDRAIL: keep the product on the right third and keep the LEFT half calmer, softer and uncluttered (simpler or gently out of focus) so overlay text stays readable; the camera push-in must be gentle (about 5-8 percent) with NO pan, NO tilt, NO pull-back and NO frame-edge reveal; keep ALL effects on or around the product on the right, never over the left text area."
    : isAction
    ? "ACTION: the camera may ORBIT/ARC around the product (bullet-time) but must keep the real product centered, intact and faithful — no warping and no frame-edge glitches."
    : "Keep the camera push-in smooth and centered with no frame-edge reveal.";
  const stillAddHint = isAction
    ? "the dramatic STATIC accent already composed in the still — e.g. a frozen splash / suspended shards / particles bursting around the product"
    : "the dramatic STATIC accent/lighting already composed in the still";
  const motionHint = isAction
    ? "a slow-motion camera orbit/arc around the product plus the suspended burst drifting — dramatic, premium, stunning"
    : "bold VISIBLE motion of the already-present elements plus a slow camera push-in — dramatic, premium, stunning";

  const instruction =
`You are the creative director of the world's most celebrated product-commercial studio (Apple launch films, Tom Ford, Chanel No.5).
Study the product in the image carefully — brand, category, texture, mood, color palette, material.
${conceptLine}

${motionLine}

Pick the most striking idea for this product category:
- men's grooming (clay, wax, pomade): a hard spotlight beam sweeps boldly across the metallic lid while its shadow glides; OR dark matte dust swirls and settles around the tin as the light intensifies;
- skincare / face cream: a glistening serum drop swells and slides down the jar in rich macro while luminous light rays bloom and brighten; OR golden light sweeps across the dewy texture;
- perfume / cologne: a translucent mist cloud rolls and curls around the bottle as a rainbow prism light band sweeps across the glass;
- watch / jewellery: a beam of light sweeps across the dial igniting travelling micro-sparkles, reflections dancing over the metal;
- drink / beverage: condensation beads form and run down the cold glass while a gentle splash leaps up or bubbles rise and catch the light;
- food / coffee: ribbons of aromatic steam rise and curl while warm light shifts across the surface;
- hair care: light refracts and travels through the glossy product texture, strands flowing in air currents.
Hard rules:
- preserve the REAL product and its label exactly (same shape, text, colors, proportions);
- background may be a clean dramatic backdrop OR a tasteful softly-out-of-focus premium environment that suits the product (no clutter, no competing objects), with dramatic directional lighting (a luminous glow, a soft falloff, a moving highlight) — the product stays the clear faithful hero;
${focalRule}
- no humans, no hands, no invented logos; cinematic, premium and dynamic;
- the effect must be PHOTOREALISTIC and achievable from a single still + ${durSec} video.
${placementNote}

${criticalBlock}
${guardrailLine}

Return STRICT JSON only (no markdown, no commentary):
{"productSummary":"<3-5 words: exact product name + category>","stillAddition":"<one vivid English phrase: ${stillAddHint}>","motionPrompt":"<one precise cinematic sentence: ${motionHint}>"}`;

  // Hard 20s bound: the AbortController aborts the underlying request (if the SDK
  // honors it) and the Promise.race guarantees we never wait longer regardless.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const callP = gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [
          { inlineData: { data: img.base64, mimeType: img.mimeType } },
          { text: instruction },
        ] },
      ],
      config: { abortSignal: controller.signal },
    });
    const timeoutP = new Promise<null>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 20000); });
    const result: any = await Promise.race([callP, timeoutP]);
    if (!result) { console.warn("[SCROLLANIM] creative-concept vision timed out"); return null; }
    const text: string =
      result?.text ??
      result?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("") ??
      "";
    if (!text) return null;
    const jsonStr = (text.match(/\{[\s\S]*\}/) || [text])[0];
    const parsed = JSON.parse(jsonStr);
    const stillAddition = typeof parsed.stillAddition === "string" ? parsed.stillAddition.trim() : "";
    const motionPrompt = typeof parsed.motionPrompt === "string" ? parsed.motionPrompt.trim() : "";
    if (!stillAddition && !motionPrompt) return null;
    console.log(`[SCROLLANIM] creative concept (${parsed.productSummary || "?"}) → still: "${stillAddition.slice(0, 90)}" | motion: "${motionPrompt.slice(0, 90)}"`);
    return { stillAddition, motionPrompt, productSummary: typeof parsed.productSummary === "string" ? parsed.productSummary : undefined };
  } catch (e: any) {
    console.warn("[SCROLLANIM] creative-concept generation failed:", e?.message);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// After GPT Image 2 renders the product still, analyze the ACTUAL output image with
// Gemini vision to write a precise Kling motion prompt based on what's really there —
// instead of trusting a pre-planned prompt written before seeing the final rendering.
// Falls back gracefully (returns null) so the caller can use the pre-planned motionPrompt.
async function generateMotionPromptFromStill(
  stillUrl: string,
  layout: ScrollAnimLayout,
  shouldStop: () => boolean = () => false,
): Promise<string | null> {
  if (shouldStop()) return null;

  // Download the still from KIE CDN (external URL, no SSRF risk — we just generated it)
  let base64: string;
  let mimeType: string;
  try {
    const ctrl = new AbortController();
    const tId = setTimeout(() => ctrl.abort(), 30000);
    const resp = await fetch(stillUrl, { signal: ctrl.signal });
    clearTimeout(tId);
    if (!resp.ok) { console.warn(`[SCROLLANIM] still download failed (${resp.status})`); return null; }
    const ct = resp.headers.get("content-type") || "image/jpeg";
    mimeType = ct.split(";")[0].trim();
    if (!mimeType.startsWith("image/")) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length || buf.length > 15 * 1024 * 1024) return null;
    base64 = buf.toString("base64");
  } catch (e: any) {
    console.warn("[SCROLLANIM] still download error:", e?.message);
    return null;
  }
  if (shouldStop()) return null;

  const isAction = layout === "action";
  const isSite3d = layout === "site3d";
  const placementHint = layout === "split"
    ? "The product is on the RIGHT side and the left half is an empty solid text area — keep every effect on or around the product on the right, keep the camera push-in gentle (about 5-8 percent) and never let motion spill into or change the left half."
    : isAction
    ? "The product is centered — the camera may orbit/arc around it (bullet-time) but keep the real product intact and faithful."
    : isSite3d
    ? "The product sits on a pure black void — orbit/push-in around it; second half MUST have a clear scroll payoff (crack, rotate, layer separate, light sweep)."
    : "The product is centered — keep the push-in smooth and centered.";

  const instruction = isAction
    ? `You are a world-class action-film cinematographer directing a 10-second HOLLYWOOD-BLOCKBUSTER product shot for Kling AI.
Look at this RENDERED PRODUCT STILL very carefully — examine every element, lighting, texture, suspended particle and visual accent present.

Your task: write ONE precise cinematic motion sentence that Kling will follow to animate this exact still into a jaw-dropping blockbuster moment.

Rules:
1. Describe ONLY what is visibly present in this still — do NOT invent objects that aren't there.
2. The motion must be POWERFUL and clearly visible and build across the 10 seconds (the viewer scrubs it by scrolling — subtle motion looks broken). Make it epic, premium and dramatic.
3. Always combine TWO things: a bold SLOW-MOTION camera ORBIT/ARC flying AROUND the product (bullet-time), plus the suspended burst already in the frame (splash, shards, particles, sparks, mist, light streaks) drifting in slow motion.
4. Keep the product coherent and undistorted (do not warp, melt or recolor it) — the real product and its label stay perfectly intact.
5. Blockbuster cinematic energy — graceful but unmistakable slow-motion movement, never a frozen image.
6. ${placementHint}
7. No camera shake that breaks the product, no text, no human hands.

Examples of great action motion prompts (adapt to what's actually in THIS still):
- "The camera arcs slowly around the bottle in bullet-time as suspended splash droplets drift through the air and bright glints sweep across the glass"
- "A sweeping slow-motion orbit circles the watch as glittering shards hang frozen mid-air and light beams travel across the dial"
- "The camera flies around the jar in dramatic slow motion while a frozen powder burst drifts outward and anamorphic flares streak past"

Respond with ONLY the motion prompt sentence — no JSON, no explanation, no quotes.`
    : isSite3d
    ? `You are a world-class product commercial director writing a 12-second Kling motion prompt for a PRODUCT-HERO scroll site.
Look at this RENDERED PRODUCT STILL carefully.

Write ONE precise motion sentence:
1. Describe ONLY what is in the still.
2. Pure black void stays black — do not invent a room or landscape.
3. Combine a cinematic ORBIT or push-in around the product with a SECOND-HALF scroll payoff (ice cracks, layers separate, product rotates, material light-sweep).
4. Keep the product undistorted and label intact.
5. ${placementHint}
6. No text, no hands, no camera shake.

Examples:
- "Slow cinematic orbit around the iced can on black as rim light travels, then ice fractures and refracts in the second half"
- "Gentle push-in on the bottle on pure black, then a bold light sweep reveals material and a soft rotation payoff"

Respond with ONLY the motion prompt sentence — no JSON, no explanation, no quotes.`
    : `You are a world-class cinematographer directing a 5-second luxury product video for Kling AI.
Look at this RENDERED PRODUCT STILL very carefully — examine every element, lighting, texture, and visual accent present.

Your task: write ONE precise cinematic motion sentence that Kling will follow to animate this exact still into an instant WOW.

Rules:
1. Describe ONLY what is visibly present in this still — do NOT invent elements that aren't there.
2. The motion must be CLEARLY VISIBLE and evolve across the 5 seconds (the viewer scrubs it by scrolling — subtle or imperceptible motion looks broken and dull). Make it bold, premium and dramatic.
3. Always combine TWO things: a slow cinematic camera PUSH-IN, plus visible motion of the light, shadow, particles, mist, liquid, reflections or texture that are actually in the frame.
4. Keep the background coherent and undistorted (do not warp, melt or recolor it) and never reveal the frame edges — push-in only, no pan, no tilt, no pull-back.
5. Cinematic high-end commercial energy — graceful but unmistakable movement, never a frozen image.
6. ${placementHint}
7. No camera shake, no warping of the product, no text, no human hands.

Examples of great motion prompts (adapt to what's actually in THIS still):
- "A hard spotlight beam sweeps boldly across the metallic tin lid from left to right while the camera pushes in slowly and the shadow glides across the surface"
- "Glistening dewdrops swell and run down the jar surface in rich macro as luminous light rays bloom and the camera eases in"
- "A translucent mist cloud rolls and curls around the bottle, a rainbow prism band sweeping across the glass while the camera pushes in"
- "Reflections travel across the watch dial igniting moving micro-sparkles while the camera slowly closes in"

Respond with ONLY the motion prompt sentence — no JSON, no explanation, no quotes.`;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const callP = gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [
        { inlineData: { data: base64, mimeType } },
        { text: instruction },
      ]}],
      config: { abortSignal: controller.signal },
    });
    const timeoutP = new Promise<null>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 25000); });
    const result: any = await Promise.race([callP, timeoutP]);
    if (!result) { console.warn("[SCROLLANIM] motion-from-still timed out"); return null; }
    const text: string =
      result?.text ??
      result?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("") ??
      "";
    if (!text || text.trim().length < 15) return null;
    const prompt = text.trim().replace(/^["']+|["']+$/g, "");
    console.log(`[SCROLLANIM] vision motion prompt (from actual still): "${prompt.slice(0, 150)}"`);
    return prompt;
  } catch (e: any) {
    console.warn("[SCROLLANIM] motion-from-still generation failed:", e?.message);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Regenerate an uploaded product photo onto a CLEAN SOLID (monochrome) background
// with the product positioned for the chosen layout (right for "split", centered for
// "parallax"), then return the raw KIE CDN URL so Kling can use it as the video source.
// Uses gpt-image-2-image-to-image (KIE) with input_urls so the model EDITS the user's
// actual product photo (preserving the real product) rather than inventing a new one.
// When stillAddition is given, a small tasteful creative accent is baked into the scene.
async function generateProductStill(
  productImageUrl: string,
  layout: ScrollAnimLayout,
  shouldStop: () => boolean = () => false,
  stillAddition?: string,
): Promise<string | null> {
  if (!KIE_API_KEY) return null;
  const placement = layout === "split"
    ? "Position the product on the RIGHT third of the frame; keep the LEFT half calmer, softer and uncluttered (clean negative space) so overlay text stays readable."
    : "Position the product centered in the frame.";
  const bgGuard = layout === "split"
    ? `Keep the LEFT half calmer, softer and less detailed (simpler or gently out of focus) so overlay text stays readable, and concentrate the product, the sharp detail and any glow on the RIGHT. `
    : layout === "site3d"
    ? `PURE BLACK void background only — no floor, no wall, no room, no props set. Soft falloff around the product, deep shadows. `
    : `Keep the product the clear hero with the focus and glow on it, and the surrounding environment softer and uncluttered. `;
  const hasAddition = !!(stillAddition && stillAddition.trim());
  const noProps = hasAddition
    ? `keep it tasteful and uncluttered with no competing objects, the product as the clear hero. `
    : `keep it tasteful and uncluttered with no competing objects or busy patterns, the product as the clear hero. `;
  const creative = hasAddition
    ? `As a tasteful cinematic accent you MAY add: ${stillAddition!.trim()} — placed beside or around the product only, small and elegant, NEVER covering, replacing or altering the product or its label, and keep the surroundings soft and uncluttered. `
    : "";
  const prompt = layout === "site3d"
    ? `Take the exact product from the reference image and keep it perfectly identical ` +
      `(same shape, label, text, colors and proportions) — the product is the untouchable hero. Place it centered on a ` +
      `PURE BLACK void (no environment, no floor, no studio set dressing), floating or with a subtle contact shadow only. ` +
      `${placement} Dramatic studio rim light and a strong key light like a luxury product commercial, deep elegant shadows, ` +
      `rich glossy reflections, photorealistic, ultra-high detail, 8K, 16:9 aspect ratio. ${bgGuard}` +
      `${creative}Keep the product's own label and text exactly intact; add no extra text, captions or watermark.`
    : `Take the exact product from the reference image and keep it perfectly identical ` +
    `(same shape, label, text, colors and proportions) — the product is the untouchable hero. Place it in a high-end ` +
    `cinematic product-commercial setting: choose whatever looks most premium for this product — either a clean dramatic ` +
    `studio backdrop OR a tasteful, softly out-of-focus contextual environment (elegant surface, soft bokeh, atmospheric depth), ` +
    `${noProps}` +
    `${placement} Dramatic premium lighting like a luxury magazine ad (not flat catalog lighting): a strong directional ` +
    `key light and a crisp rim/edge highlight that separate the product, a soft halo of light only around the product, ` +
    `deep elegant shadows and rich glossy reflections for real depth. ${bgGuard}` +
    `A subtle realistic contact shadow under the product, photorealistic, ultra-high detail, 8K, 16:9 aspect ratio. ` +
    `${creative}Keep the product's own label and text exactly intact; add no extra text, captions or watermark.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (shouldStop()) return null;
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
    let taskId: string | null = null;
    // nano-banana-2 + image_input is much faster than gpt-image-2-image-to-image queue
    const createBody: any = await kieRequestJson(
      NANO_BANANA_CREATE_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${KIE_API_KEY}` },
        body: JSON.stringify({
          model: "nano-banana-2",
          input: {
            prompt,
            image_input: [productImageUrl],
            aspect_ratio: "16:9",
            resolution: "1K",
            output_format: "jpg",
          },
        }),
      },
      { label: "SCROLLANIM product-create", retries: 2, shouldStop },
    );
    if (createBody?.code === 200 && createBody?.data?.taskId) taskId = createBody.data.taskId;
    else { console.warn("[SCROLLANIM] product-still create failed:", createBody?.msg); continue; }
    const imgDeadline = Date.now() + 90000;
    let pollWait = 1500;
    while (Date.now() < imgDeadline) {
      if (shouldStop()) return null;
      await new Promise(r => setTimeout(r, pollWait));
      pollWait = 1500;
      const body: any = await kieRequestJson(
        `${NANO_BANANA_STATUS_URL}?taskId=${taskId}`,
        { headers: { "Authorization": `Bearer ${KIE_API_KEY}` } },
        { label: "SCROLLANIM product-poll", retries: 1, shouldStop: () => shouldStop() || Date.now() >= imgDeadline },
      );
      if (!body || body.code !== 200 || !body.data) continue;
      const state = body.data.state;
      if (state === "success") {
        const result = JSON.parse(body.data.resultJson || "{}");
        const cdnUrl = (result.resultUrls || [])[0] || null;
        if (cdnUrl) {
          // Re-upload to Object Storage for a stable non-expiring URL
          try {
            const imgResp = await fetch(cdnUrl, { signal: AbortSignal.timeout(25000) });
            if (imgResp.ok) {
              const imgBuf = Buffer.from(await imgResp.arrayBuffer());
              const relUrl = await uploadToObjectStorage(imgBuf, "image/jpeg", "jpg");
              const appBase = process.env.APP_BASE_URL || "https://craft-ai.ru";
              const stableUrl = `${appBase}${relUrl}`;
              console.log(`[SCROLLANIM] product still re-uploaded → stable URL: ${stableUrl}`);
              return stableUrl;
            }
          } catch (upErr: any) {
            console.warn("[SCROLLANIM] product still re-upload failed, using CDN URL:", upErr?.message);
          }
          console.log(`[SCROLLANIM] product still ready (CDN fallback): ${cdnUrl}`);
          return cdnUrl;
        }
        break;
      }
      if (state === "fail" || state === "failed" || state === "error") {
        console.warn(`[SCROLLANIM] product-still task failed (attempt ${attempt + 1}):`, body.data?.failMsg);
        break;
      }
    }
  }
  console.warn("[SCROLLANIM] product-still generation failed after all attempts");
  return null;
}

// Create a 5s image-to-video on KIE Kling, poll until ready, slice into WebP frames,
// upload each to object storage. Returns ordered "/objects/..." URLs (or [] on failure).
// If referenceStillUrl is provided, it is used directly (skips nano-banana-2 still generation).
// confirmedKieFailure is true ONLY when KIE API itself failed (not moderation / local ffmpeg).
async function generateScrollFrames(
  videoPrompt: string,
  shouldStop: () => boolean = () => false,
  referenceStillUrl?: string,
  layout: ScrollAnimLayout = "parallax",
  onTaskCreated?: (taskId: string) => void,
  existingTaskId?: string,
): Promise<{ frames: string[]; videoUrl?: string; confirmedKieFailure: boolean }> {
  if (!KIE_API_KEY) { console.warn("[SCROLLANIM] missing KIE_API_KEY"); return { frames: [], confirmedKieFailure: false }; }

  let confirmedKieFailure = false;
  const markKieFail = () => { confirmedKieFailure = true; };

  // Step 0 — get a cinematic still image to anchor the video
  let stillUrl: string | null = null;
  if (referenceStillUrl) {
    stillUrl = referenceStillUrl;
    console.log(`[SCROLLANIM] using provided reference still: ${stillUrl}`);
  } else {
    stillUrl = await generateStillForVideo(videoPrompt, shouldStop, layout);
  }
  if (!stillUrl) {
    console.warn("[SCROLLANIM] aborting: no still image");
    // Still generation talks to KIE image jobs — failure after retries is a KIE outage.
    return { frames: [], confirmedKieFailure: true };
  }
  if (shouldStop()) { console.warn("[SCROLLANIM] aborted by shouldStop() after still image"); return { frames: [], confirmedKieFailure: false }; }

  // Strip Cyrillic text from videoPrompt — the AI sometimes copies the user's Russian
  // site description into the SCROLLANIM marker instead of writing an English cinematic prompt.
  // We remove all Cyrillic word-clusters and collapse extra whitespace; if nothing is left
  // we fall back to a generic cinematic description so Kling always gets English-only input.
  const cleanVideoPrompt = videoPrompt
    .replace(/[\u0400-\u04FF][\u0400-\u04FF\s,;:!?—–-]*/g, " ")  // strip Cyrillic runs + trailing punctuation
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s.,;:]+|[\s.,;:]+$/g, "")
    .trim();
  let safeVideoPrompt = cleanVideoPrompt.length > 15
    ? cleanVideoPrompt
    : "breathtaking cinematic scene with atmospheric depth, volumetric lighting, photorealistic";
  if (cleanVideoPrompt !== videoPrompt.trim()) {
    console.log(`[SCROLLANIM] stripped Cyrillic from videoPrompt → "${safeVideoPrompt.slice(0, 120)}"`);
  }

  // Append cinematic production guidance so the scrubbed frames show real, visible
  // motion (the prior "ultra-slow"/"imperceptible" wording made the animation read as
  // a static image). For scene/parallax we allow bold immersive forward camera travel
  // that reveals depth; for split (product) we keep a gentle push-in to protect product
  // fidelity. Additive — never overrides the creative motion already in videoPrompt.
  const cameraGuidance = layout === "split"
    ? `with an elegant slow cinematic camera push-in only — no pan, no tilt, no pull-back, no frame-edge reveal — keeping the product perfectly intact and the left side calm for text`
    : layout === "action"
    ? `the debris, shards, sparks, dust or particles already visible in the frame must keep physically moving and evolving throughout the whole clip — drifting, spinning, falling, colliding or scattering further in slow motion (the scene action must be the main event, not just the camera), combined with a bold Hollywood-blockbuster camera move — a dramatic slow-motion orbit/arc that flies AROUND the subject (bullet-time feel) or an explosive dynamic push-in, sweeping anamorphic lens flares, motion-blur streaks and deep dramatic contrast — epic, powerful and fluid, never shaky, camera movement alone is NOT enough`
    : layout === "immersion"
    ? `IMMERSION fly-through: the FIRST frames must establish a clear THRESHOLD / PORTAL the viewer is looking through or into (airplane window, doorway, arch, glass facade, tunnel mouth, elevator doors, shop window, cave mouth, balcony frame — choose what fits the niche). Then the camera CONTINUOUSLY flies FORWARD THROUGH that threshold into the expanding world beyond (clouds, interiors, landscapes, brand spaces), with deep parallax, evolving light and a sense of falling into the scene — never a static orbit, never a product-on-black still life. The journey must clearly progress start→finish for scroll-scrub`
    : layout === "site3d"
    ? `hero product centered on a pure black void, photorealistic commercial, bold camera orbit or push-in around the product, second half MUST deliver a clear scroll payoff (ice crack / layers separate / product rotate / material reveal / light sweep transforming the hero), deep shadows, studio rim light, no environment set dressing that fills the frame, graceful and steady, never shaky`
    : `with bold immersive cinematic camera movement that pulls the viewer INTO the scene — a smooth forward dolly / push-in that glides deeper and naturally reveals depth and detail (e.g. gliding toward a doorway or through the space) — graceful and steady, never shaky`;
  const styleLead = layout === "action"
    ? `Render as an epic Hollywood blockbuster action sequence in dramatic slow motion (bullet-time): powerful, clearly visible motion that builds across the whole clip, IMAX-grade cinematic spectacle`
    : layout === "site3d"
    ? `Render as a premium product-hero commercial on pure black: the product is the only subject, clearly evolving motion with a second-half payoff designed for scroll-scrub`
    : layout === "immersion"
    ? `Render as a continuous POV immersion flight: start behind/at a threshold, then pass through into the world — one unbroken cinematic camera move designed for scroll-scrub`
    : `Render as a high-end Hollywood-grade cinematic shot: smooth, graceful but clearly visible motion (the scene must noticeably evolve and feel alive from start to finish)`;
  let animPrompt =
    `${safeVideoPrompt}. ${styleLead}, ${cameraGuidance}, premium dramatic lighting ` +
    `and rich filmic color grading. Do not warp, melt or distort the main subject or any architecture, ` +
    `no text, no captions, no watermark, no camera shake, no flicker, no jump cuts.`;

  // Per-mode clip length + sliced-frame budget.
  // immersion/site3d: MP4 scrub (no ffmpeg). Both use 12s for richer scroll payoff.
  const videoDuration = layout === "action"
    ? SCROLL_ACTION_VIDEO_DURATION
    : layout === "immersion" || layout === "site3d"
    ? 12
    : SCROLL_VIDEO_DURATION;
  const targetFrameCount = layout === "action"
    ? SCROLL_ACTION_FRAME_COUNT
    : layout === "site3d" || layout === "immersion"
    ? 90
    : SCROLL_FRAME_COUNT;
  const videoResolution = "1080p";
  const useVideoScrub = layout === "site3d" || layout === "immersion"; // skip ffmpeg + 90 uploads

  // Overall deadline shared across all retry attempts (still image time already consumed).
  // site3d/parallax: keep a generous Kling budget, but fewer create retries so we fail fast
  // and let the BG soft-retry / task-id resume finish the job instead of stacking 4×35min.
  const deadline = Date.now() + (layout === "site3d" || layout === "immersion" ? 1800000 : 2400000);
  const MAX_VIDEO_ATTEMPTS = layout === "site3d" || layout === "immersion" || layout === "parallax" || layout === "split" ? 2 : 4;
  let mp4Url: string | null = null;

  // Detects Kling content-moderation failures (error 400 "community guidelines")
  function isModerationError(failMsg?: string, failCode?: string | number): boolean {
    return isKieModerationFailure(failMsg, failCode);
  }

  // Returns a safe commercial-grade rewrite of the prompt for moderation retries
  function sanitizeVideoPrompt(p: string): string {
    // Strip any potentially problematic words and rephrase as generic commercial scene
    const stripped = p
      .replace(/\b(blood|gore|violence|weapon|gun|knife|nude|naked|sexy|erotic|adult|death|kill|war|combat|fight|crash|explosion|fire|smoke|burn|destroy|brutal|brutal|horror|terror|fear)\b/gi, "")
      .replace(/\s{2,}/g, " ").trim();
    const base = stripped.length > 20 ? stripped : "modern professional product brand lifestyle";
    return `${base}, clean professional commercial advertising photography, safe for work, bright modern studio environment, brand lifestyle scene`;
  }

  // Mutable working still URL — may be replaced on moderation retry
  let currentStillUrl = stillUrl;

  // If caller already has a completed/running task ID, skip video creation entirely
  // and jump straight to polling that specific task (one attempt only).
  if (existingTaskId) {
    console.log(`[SCROLLANIM] resuming from existing task ID: ${existingTaskId}`);
    if (onTaskCreated) { try { onTaskCreated(existingTaskId); } catch {} }
    let taskFailed = false;
    let pollCount = 0;
    while (Date.now() < deadline) {
      if (shouldStop()) return { frames: [], confirmedKieFailure: false };
      await new Promise(r => setTimeout(r, 5000));
      pollCount++;
      try {
        const body: any = await kieRequestJson(
          `${NANO_BANANA_STATUS_URL}?taskId=${existingTaskId}`,
          { headers: { "Authorization": `Bearer ${KIE_API_KEY}` } },
          { label: "SCROLLANIM resume-poll", retries: 2, shouldStop: () => shouldStop() || Date.now() >= deadline },
        );
        if (!body || body.code !== 200 || !body.data) { console.log(`[SCROLLANIM] resume poll #${pollCount}: no data`); continue; }
        const state = body.data.state;
        if (pollCount <= 3 || pollCount % 10 === 0) console.log(`[SCROLLANIM] resume poll #${pollCount} state=${state}`);
        if (state === "success") {
          let result: any = {};
          try { result = typeof body.data.resultJson === "string" ? JSON.parse(body.data.resultJson) : (body.data.resultJson || {}); } catch {}
          mp4Url = (result.resultUrls || [])[0] || null;
          console.log(`[SCROLLANIM] resume success, mp4Url=${mp4Url}`);
          break;
        }
        if (state === "fail" || state === "failed" || state === "error") {
          console.warn(`[SCROLLANIM] resumed task ${existingTaskId} reported failure:`, body.data.failMsg || body.data.failCode);
          taskFailed = true;
          if (isKieTaskInfraFailure(body.data.failMsg, body.data.failCode)) markKieFail();
          break;
        }
      } catch (e: any) {
        console.warn("[SCROLLANIM] resume poll error:", e?.message);
      }
    }
    if (!mp4Url) {
      console.warn(`[SCROLLANIM] resume failed or timed out for task ${existingTaskId}`);
      // Timeout without explicit fail → KIE didn't deliver. Explicit fail already
      // set confirmedKieFailure only for infra (not moderation).
      if (!taskFailed) markKieFail();
      return { frames: [], confirmedKieFailure };
    }
    // Skip the frame-extraction block below by jumping past the for-loop via a synthetic mp4Url
  } else {

  for (let videoAttempt = 0; videoAttempt < MAX_VIDEO_ATTEMPTS; videoAttempt++) {
    if (shouldStop() || Date.now() >= deadline) break;
    if (videoAttempt > 0) {
      console.log(`[SCROLLANIM] retrying video task (attempt ${videoAttempt + 1}/${MAX_VIDEO_ATTEMPTS})...`);
      await new Promise(r => setTimeout(r, 5000));
    }

    // Step 1 — create the image-to-video task (kieRequestJson retries 5xx/429/network)
    let taskId: string | null = null;
    const createBody: any = await kieRequestJson(
      NANO_BANANA_CREATE_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${KIE_API_KEY}` },
        body: JSON.stringify({
          model: KLING_IMG2VID_MODEL,
          input: {
            prompt: animPrompt.slice(0, 2500),
            image_urls: [currentStillUrl],
            duration: String(videoDuration),
            resolution: videoResolution,
          },
        }),
      },
      { label: "SCROLLANIM video-create", retries: 4, shouldStop: () => shouldStop() || Date.now() >= deadline },
    );
    if (createBody?.code === 200 && createBody?.data?.taskId) taskId = createBody.data.taskId;
    else {
      console.warn("[SCROLLANIM] create task failed:", createBody?.msg || createBody?.code);
      if (isConfirmedKieJobBodyFailure(createBody)) markKieFail();
    }
    if (!taskId) continue; // next video attempt

    console.log(`[SCROLLANIM] video task created (attempt ${videoAttempt + 1}): ${taskId}`);
    if (onTaskCreated) { try { onTaskCreated(taskId); } catch {} }

    // Step 2 — poll for completion (Kling video can take up to 35 min in queue)
    let taskFailed = false;
    let moderationFailed = false;
    let pollCount = 0;
    while (Date.now() < deadline) {
      if (shouldStop()) return { frames: [], confirmedKieFailure: false };
      await new Promise(r => setTimeout(r, layout === "site3d" ? 3000 : 5000));
      pollCount++;
      try {
        const body: any = await kieRequestJson(
          `${NANO_BANANA_STATUS_URL}?taskId=${taskId}`,
          { headers: { "Authorization": `Bearer ${KIE_API_KEY}` } },
          { label: "SCROLLANIM video-poll", retries: 1, shouldStop: () => shouldStop() || Date.now() >= deadline },
        );
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
          const failMsg: string = body.data.failMsg || "";
          const failCode: string = String(body.data.failCode || "");
          console.warn(`[SCROLLANIM] video task failed (attempt ${videoAttempt + 1}): failMsg="${failMsg}" failCode="${failCode}"`);
          taskFailed = true;
          if (isModerationError(failMsg, failCode)) {
            moderationFailed = true;
            console.warn("[SCROLLANIM] content moderation failure detected — will sanitize prompt and regenerate still for next attempt");
          } else if (isKieTaskInfraFailure(failMsg, failCode)) {
            markKieFail();
          } else {
            // Unknown fail reason — do NOT mark as confirmed KIE (not 100% sure)
            console.warn("[SCROLLANIM] task fail with unclassified reason — no auto-refund flag");
          }
          break; // break poll loop → outer loop will retry
        }
      } catch (e: any) {
        console.warn("[SCROLLANIM] poll error:", e?.message);
      }
    }
    if (mp4Url) break;           // success — exit retry loop
    if (!taskFailed) {
      // Deadline exceeded while waiting on KIE — confirmed infra/queue issue
      markKieFail();
      break;
    }

    // On content moderation failure: sanitize the prompt and regenerate a new safe still
    // so the next attempt doesn't hit the same moderation block
    if (moderationFailed && videoAttempt + 1 < MAX_VIDEO_ATTEMPTS) {
      console.log("[SCROLLANIM] sanitizing prompt and regenerating still for moderation retry...");
      safeVideoPrompt = sanitizeVideoPrompt(safeVideoPrompt);
      animPrompt =
        `${safeVideoPrompt}. ${styleLead}, ${cameraGuidance}, premium dramatic lighting ` +
        `and rich filmic color grading. Do not warp, melt or distort the main subject or any architecture, ` +
        `no text, no captions, no watermark, no camera shake, no flicker, no jump cuts.`;
      console.log(`[SCROLLANIM] sanitized prompt: "${safeVideoPrompt.slice(0, 120)}"`);
      // Regenerate the still image with the safer prompt (always use parallax/text-to-image, not the original ref)
      const newStill = await generateStillForVideo(safeVideoPrompt, shouldStop, "parallax");
      if (newStill) {
        currentStillUrl = newStill;
        console.log("[SCROLLANIM] regenerated still for moderation retry:", currentStillUrl);
      } else {
        console.warn("[SCROLLANIM] still regeneration failed, reusing previous still");
      }
    }
    // taskFailed === true → continue to next videoAttempt
  }

  if (!mp4Url) {
    console.warn("[SCROLLANIM] video generation failed after all attempts or deadline exceeded");
    // If we never saw a confirmed infra fail but also never got video after create attempts,
    // and create always failed with body 5xx — already marked. Pure moderation → leave false.
    return { frames: [], confirmedKieFailure };
  }

  } // end else (existingTaskId branch already set mp4Url or returned [])

  // Step 3 — download mp4 to a temp dir (3 attempts with back-off)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrollanim-"));
  const videoPath = path.join(tmpDir, "src.mp4");
  const framesDir = path.join(tmpDir, "frames");
  let mp4Downloaded = false;
  let mp4Buf: Buffer | null = null;
  for (let dlAttempt = 0; dlAttempt < 3 && !mp4Downloaded; dlAttempt++) {
    if (dlAttempt > 0) {
      console.log(`[SCROLLANIM] mp4 download retry ${dlAttempt + 1}/3 in 10s…`);
      await new Promise(r => setTimeout(r, 10000));
    }
    try {
      console.log(`[SCROLLANIM] downloading mp4 (attempt ${dlAttempt + 1}): ${mp4Url}`);
      const vresp = await fetch(mp4Url!);
      if (!vresp.ok) throw new Error(`HTTP ${vresp.status}`);
      mp4Buf = Buffer.from(await vresp.arrayBuffer());
      if (mp4Buf.length < 10000) throw new Error(`file too small: ${mp4Buf.length} bytes`);
      fs.writeFileSync(videoPath, mp4Buf);
      fs.mkdirSync(framesDir, { recursive: true });
      console.log(`[SCROLLANIM] mp4 downloaded: ${mp4Buf.length} bytes → ${videoPath}`);
      mp4Downloaded = true;
    } catch (e: any) {
      console.warn(`[SCROLLANIM] mp4 download attempt ${dlAttempt + 1} failed:`, e?.message);
    }
  }
  if (!mp4Downloaded || !mp4Buf) {
    console.warn("[SCROLLANIM] all mp4 download attempts failed — giving up");
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return { frames: [], confirmedKieFailure: true };
  }

  // site3d fast path: upload ONE mp4 and scrub it in the browser — skip ffmpeg + N uploads.
  if (useVideoScrub) {
    try {
      const relUrl = await uploadToObjectStorage(mp4Buf, "video/mp4", "mp4");
      const appBase = process.env.APP_BASE_URL || "https://craft-ai.ru";
      const stableVideo = `${appBase}${relUrl}`;
      console.log(`[SCROLLANIM] site3d video scrub ready: ${stableVideo} (${mp4Buf.length} bytes)`);
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return { frames: [], videoUrl: stableVideo, confirmedKieFailure: false };
    } catch (upErr: any) {
      console.warn("[SCROLLANIM] site3d mp4 upload failed, falling back to frame extract:", upErr?.message);
      // fall through to ffmpeg path
    }
  }

  // Step 4 — extract frames with ffmpeg (direct spawn + retry; see extractFramesWithFfmpeg)
  try {
    const fps = Math.max(8, Math.round(targetFrameCount / videoDuration));
    console.log(`[SCROLLANIM] starting ffmpeg: fps=${fps}, input=${videoPath}, output=${framesDir}/frame_%04d.jpg`);
    await extractFramesWithFfmpeg(videoPath, framesDir, fps, shouldStop);
  } catch (e: any) {
    console.warn("[SCROLLANIM] ffmpeg extraction failed:", e?.message);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return { frames: [], confirmedKieFailure: false };
  }

  // Step 5 — upload frames in parallel batches (was sequential — slow for 90 files)
  const urls: string[] = [];
  try {
    const files = fs.readdirSync(framesDir).filter(f => /\.jpg$/i.test(f)).sort();
    const BATCH = 8;
    for (let i = 0; i < files.length; i += BATCH) {
      if (shouldStop()) break;
      const slice = files.slice(i, i + BATCH);
      const batchUrls = await Promise.all(slice.map(async (f) => {
        const raw = fs.readFileSync(path.join(framesDir, f));
        return uploadToObjectStorage(raw, "image/jpeg", "jpg");
      }));
      urls.push(...batchUrls);
    }
  } catch (e: any) {
    console.warn("[SCROLLANIM] frame upload failed:", e?.message);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`[SCROLLANIM] produced ${urls.length} frames`);
  return { frames: urls, confirmedKieFailure: false };
}

// Ensure a video-anim site has a preloader (covers the page until the scroll
// frames are actually painted) and ALWAYS attach the reliable hide script.
// If the AI already authored a bespoke, on-brand preloader (id="site-preloader"),
// we keep its visuals and only wire up hiding. Otherwise we inject a neutral,
// palette-adaptive fallback so a loader is never missing.
// Strip conversational preamble and markdown code fences that the model
// sometimes wraps around the HTML document. Robust to an UNCLOSED ```html
// fence (streaming truncation / model omitting the closing fence), which is
// the common cause of "код файла `index.html`: ```html" leaking into the
// saved site. Idempotent and safe on already-clean HTML.
function cleanHtmlDoc(raw: string): string {
  if (!raw) return raw;
  let c = raw.replace(/^\uFEFF/, "");
  // Remove a leading opening fence (```html / ``` ...), even if preamble text
  // came before it — slice from the fence first, then re-trim.
  const openFence = c.match(/```[a-zA-Z]*[ \t]*\r?\n?/);
  if (openFence && openFence.index !== undefined) {
    const afterFence = c.slice(openFence.index + openFence[0].length);
    // Only treat it as a code fence wrapper if real HTML follows it.
    if (/<!DOCTYPE\s+html|<html[\s>]/i.test(afterFence)) c = afterFence;
  }
  // Drop any conversational preamble before the actual document start.
  const di = c.search(/<!DOCTYPE\s+html/i);
  const hi = c.search(/<html[\s>]/i);
  let start = -1;
  if (di !== -1 && hi !== -1) start = Math.min(di, hi);
  else start = di !== -1 ? di : hi;
  if (start > 0) c = c.slice(start);
  // Strip a trailing closing fence if present.
  c = c.replace(/\r?\n?```[ \t]*\r?\n?\s*$/, "");
  return c.trim();
}

function injectLoadingOverlay(html: string): string {
  // Only inject into HTML documents (some AI outputs omit a closing </body>,
  // so we tolerate that and fall back to </html> / end-of-doc on insertion).
  if (!html.includes('<body')) return html;
  // Skip if our hide script is already present
  if (html.includes('__craft_loader_hide__')) return html;

  const hasCustom = /id\s*=\s*["'](?:site-preloader|preloader|loader|loading)["']|data-preloader|class\s*=\s*["'][^"']*\b(?:site-preloader|preloader|loader-overlay|loading-screen)\b/i.test(html);

  let visual = '';
  if (!hasCustom) {
    // Neutral fallback loader (only used when the AI omitted a custom one)
    const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const siteTitle = titleM ? titleM[1].replace(/<[^>]+>/g, '').trim().slice(0, 50) : '';
    visual = `
<style id="__craft_loader_style__">
#site-preloader{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;background:#0b0f19;transition:opacity .55s cubic-bezier(.4,0,.2,1),visibility .55s;}
#site-preloader .ldr-title{font-family:system-ui,-apple-system,sans-serif;font-size:13px;letter-spacing:.08em;opacity:.45;color:rgba(255,255,255,.5);user-select:none;}
</style>
<div id="site-preloader" role="progressbar" aria-label="Загрузка страницы" aria-hidden="true">
  <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="36" cy="36" r="30" stroke="var(--ldr,#6366f1)" stroke-opacity=".15" stroke-width="3.5"/>
    <path d="M36 6 A30 30 0 0 1 62.39 51" stroke="var(--ldr,#6366f1)" stroke-width="3.5" stroke-linecap="round" opacity=".9"><animateTransform attributeName="transform" type="rotate" from="0 36 36" to="360 36 36" dur="1.15s" repeatCount="indefinite"/></path>
    <circle cx="36" cy="36" r="4.5" fill="var(--ldr,#6366f1)" opacity=".85"><animate attributeName="r" values="3.5;6;3.5" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".55;1;.55" dur="1.4s" repeatCount="indefinite"/></circle>
  </svg>
  ${siteTitle ? `<span class="ldr-title">${siteTitle.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>` : ''}
</div>
<script id="__craft_loader_adapt__">(function(){
  var el=document.getElementById('site-preloader');if(!el)return;
  function adapt(){try{var rs=getComputedStyle(document.documentElement);var bs=getComputedStyle(document.body);var cc=['--primary','--color-primary','--accent','--brand','--brand-color','--main-color','--theme-color'];var ldrColor='';for(var i=0;i<cc.length;i++){var v=rs.getPropertyValue(cc[i]).trim();if(v&&v.length>2){ldrColor=v;break;}}if(ldrColor)el.style.setProperty('--ldr',ldrColor);var bg=bs.backgroundColor;if(bg&&bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent'){el.style.background=bg;var rgb=bg.match(/\\d+/g);if(rgb&&rgb.length>=3){var lum=(parseInt(rgb[0])*299+parseInt(rgb[1])*587+parseInt(rgb[2])*114)/1000;var titleEl=el.querySelector('.ldr-title');if(lum>=128){if(!ldrColor)el.style.setProperty('--ldr','#111');if(titleEl)titleEl.style.color='rgba(0,0,0,.45)';}}}}catch(e){}}
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',adapt);}else{adapt();}
})();</script>`;
  }

  // Backstop hide — the generated site already self-hides #site-preloader after 5 s,
  // but we re-assert it here so the loader still reveals at 5 s even if the model
  // omitted or broke its own script. Fixed 5 s, no early reveal, so all content has
  // the full window to load. The element is looked up by the canonical id AND common
  // alternates (fullscreen-guarded) because the model occasionally names its splash
  // differently (#preloader / .loader / a separate intro screen) — when that happened
  // the strict id matched nothing and the splash covered the site forever.
  const hideScript = `
<script id="__craft_loader_hide__">(function(){
  var el=document.getElementById('site-preloader');
  if(!el){var cands=document.querySelectorAll('[data-preloader],#preloader,#loader,#loading,.site-preloader,.preloader,.loader-overlay,.loading-screen');for(var i=0;i<cands.length;i++){var c=cands[i];try{var cs=getComputedStyle(c);var r=c.getBoundingClientRect();if((cs.position==='fixed'||cs.position==='absolute')&&r.width>=window.innerWidth*0.9&&r.height>=window.innerHeight*0.9){el=c;break;}}catch(e){}}}
  if(!el)return;
  var done=false;
  function hide(){if(done)return;done=true;if(!el.style.transition)el.style.transition='opacity .65s ease,visibility .65s';el.style.opacity='0';el.style.visibility='hidden';el.style.pointerEvents='none';setTimeout(function(){try{if(el.parentNode)el.parentNode.removeChild(el);}catch(e){}var s=document.getElementById('__craft_loader_style__');try{if(s&&s.parentNode)s.parentNode.removeChild(s);}catch(e){}},750);}
  var hasAnim=!!document.querySelector('[data-craft-scrollanim]');
  if(hasAnim){var t=setTimeout(hide,20000);window.addEventListener('craft:frames-ready',function(){clearTimeout(t);setTimeout(hide,300);},{once:true});}else{setTimeout(hide,5000);}
})();</script>`;

  const inject = visual + hideScript;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, inject + '\n</body>');
  if (/<\/html>/i.test(html)) return html.replace(/<\/html>/i, inject + '\n</html>');
  return html + '\n' + inject;
}

/** True while a new-site generation is still running server-side (client may have disconnected). */
function isCraftGeneratingHtml(code?: string | null): boolean {
  return !!(code && code.includes('data-craft-generating="1"'));
}

function isStaleCraftGenerating(project: { generatedCode?: string | null; updatedAt?: Date | string | null }): boolean {
  if (!isCraftGeneratingHtml(project.generatedCode)) return false;
  const t = project.updatedAt ? new Date(project.updatedAt as any).getTime() : 0;
  return !t || Date.now() - t > 45 * 60 * 1000;
}

/** Lightweight HTML saved immediately so reconnect/reload can poll until the real site is ready. */
function craftGeneratingPlaceholderHtml(promptHint?: string): string {
  const hint = String(promptHint || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .slice(0, 120);
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Генерация…</title>
<style>
html,body{margin:0;height:100%;background:#07070c;color:#fff;font-family:system-ui,sans-serif}
.wrap{min-height:100vh;display:grid;place-items:center;text-align:center;padding:40px 24px}
.spin{width:42px;height:42px;border:3px solid rgba(255,255,255,.12);border-top-color:#7c9cff;border-radius:50%;margin:0 auto 18px;animation:s .9s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
h1{margin:0 0 .4em;font-size:clamp(1.2rem,3vw,1.7rem);font-weight:700}
p{margin:0;opacity:.55;font-size:.95rem;line-height:1.5}
</style>
</head>
<body>
<section data-craft-generating="1" class="wrap">
  <div>
    <div class="spin" aria-hidden="true"></div>
    <h1>Генерируем сайт…</h1>
    <p>Можно закрыть вкладку — сайт сохранится автоматически.${hint ? `<br/><span style="opacity:.7">${hint}</span>` : ""}</p>
  </div>
</section>
</body>
</html>`;
}

/**
 * Safely replace the `data-scroll-anim-pending="1"` section in an HTML string
 * without using a regex with [\s\S]*? (catastrophic backtracking risk on large files).
 * Finds the opening <section> tag by searching backward from the marker, then
 * locates the matching </section> by tracking nesting depth.
 */
function safeReplaceScrollAnimPending(html: string, replacement: string): string {
  const MARKER = 'data-scroll-anim-pending="1"';
  const OPEN = '<section';
  const CLOSE = '</section>';
  let result = html;
  // Replace all occurrences (there can be up to 2 per site)
  for (let iteration = 0; iteration < 3; iteration++) {
    const markerIdx = result.indexOf(MARKER);
    if (markerIdx === -1) break;
    // Find the <section tag that owns this marker (search backwards from marker)
    const sectionStart = result.lastIndexOf(OPEN, markerIdx);
    if (sectionStart === -1) break;
    // Find matching </section> by tracking nesting depth
    let depth = 0;
    let pos = sectionStart;
    let sectionEnd = -1;
    while (pos < result.length) {
      const nextOpen = result.indexOf(OPEN, pos + 1);
      const nextClose = result.indexOf(CLOSE, pos + 1);
      if (nextClose === -1) break; // malformed HTML
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen;
      } else {
        if (depth === 0) {
          sectionEnd = nextClose + CLOSE.length;
          break;
        }
        depth--;
        pos = nextClose;
      }
    }
    if (sectionEnd === -1) break; // couldn't find closing tag — stop
    result = result.slice(0, sectionStart) + replacement + result.slice(sectionEnd);
  }
  return result;
}

/**
 * Extract finished scroll-anim blocks including the trailing <style>/<script>
 * siblings that carry height CSS and the canvas/WebGL engine.
 * Immersion/site3d also emit a fixed video layer BEFORE the section — wrapped in
 * <!--craft-scrollanim-full-->…<!--/craft-scrollanim-full--> so merge keeps the video.
 * Fallback: pull preceding #craft-immersion-bg / #craft-site3d-bg (+ giant) if comments missing.
 */
function extractCraftScrollAnimBlocks(html: string): string[] {
  const blocks: string[] = [];

  // Prefer explicit full-block markers (immersion / site3d video layers + hero + engine).
  const FULL_OPEN = "<!--craft-scrollanim-full-->";
  const FULL_CLOSE = "<!--/craft-scrollanim-full-->";
  let fullSearchFrom = 0;
  while (fullSearchFrom < html.length) {
    const a = html.indexOf(FULL_OPEN, fullSearchFrom);
    if (a === -1) break;
    const b = html.indexOf(FULL_CLOSE, a + FULL_OPEN.length);
    if (b === -1) break;
    blocks.push(html.slice(a + FULL_OPEN.length, b).trim());
    fullSearchFrom = b + FULL_CLOSE.length;
  }
  if (blocks.length) return blocks;

  const openRe = /<section\b[^>]*data-craft-scrollanim[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html)) !== null) {
    let start = m.index;
    // Include fixed bg layers that sit immediately before the section (legacy immersion/site3d).
    const before = html.slice(0, start);
    const bgOpen =
      before.lastIndexOf('id="craft-immersion-bg"') >= 0
        ? before.lastIndexOf('id="craft-immersion-bg"')
        : before.lastIndexOf("id='craft-immersion-bg'") >= 0
        ? before.lastIndexOf("id='craft-immersion-bg'")
        : before.lastIndexOf('id="craft-site3d-bg"') >= 0
        ? before.lastIndexOf('id="craft-site3d-bg"')
        : before.lastIndexOf("id='craft-site3d-bg'");
    if (bgOpen !== -1) {
      const divStart = before.lastIndexOf("<div", bgOpen);
      if (divStart !== -1 && start - divStart < 12000) {
        start = divStart;
        // If a giant-type div sits between bg and section, start already covers from bg;
        // giant is after bg closing — ensure we don't skip it: start is bg, section is later, giant is in between.
      }
    }
    let depth = 0;
    let pos = m.index;
    let end = -1;
    while (pos < html.length) {
      const nextOpen = html.indexOf("<section", pos + 1);
      const nextClose = html.indexOf("</section>", pos + 1);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen;
      } else {
        if (depth === 0) {
          end = nextClose + "</section>".length;
          break;
        }
        depth--;
        pos = nextClose;
      }
    }
    if (end === -1) continue;
    let cursor = end;
    // Pull contiguous style/script engine + navCtl that follow the section.
    for (;;) {
      const wsMatch = html.slice(cursor).match(/^\s*/);
      cursor += wsMatch ? wsMatch[0].length : 0;
      const rest = html.slice(cursor);
      const lower = rest.slice(0, 16).toLowerCase();
      if (lower.startsWith("<style")) {
        const close = html.indexOf("</style>", cursor);
        if (close === -1) break;
        cursor = close + "</style>".length;
        continue;
      }
      if (lower.startsWith("<script")) {
        const close = html.indexOf("</script>", cursor);
        if (close === -1) break;
        cursor = close + "</script>".length;
        continue;
      }
      break;
    }
    blocks.push(html.slice(start, cursor));
  }
  return blocks;
}

/** True when a craft-scrollanim section exists but its engine CSS/JS was stripped. */
function isHollowCraftScrollAnim(html: string): boolean {
  if (!html.includes("data-craft-scrollanim")) return false;
  const blocks = extractCraftScrollAnimBlocks(html);
  if (!blocks.length) return true;
  return blocks.some((b) => {
    const hasEngine = /<script[\s>]/i.test(b);
    const hasCss = /<style[\s>]/i.test(b) || /\bstyle\s*=\s*["'][^"']*height\s*:/i.test(b);
    return !hasEngine || !hasCss;
  });
}

/**
 * Replace hollow (CSS/JS-stripped) craft-scrollanim section(s) with full blocks.
 */
function replaceHollowCraftScrollAnim(html: string, fullBlocks: string[]): string {
  if (!fullBlocks.length) return html;
  let result = html;
  const openRe = /<section\b[^>]*data-craft-scrollanim[^>]*>/i;
  for (const block of fullBlocks) {
    const m = openRe.exec(result);
    if (!m) break;
    const start = m.index;
    let depth = 0;
    let pos = start;
    let end = -1;
    while (pos < result.length) {
      const nextOpen = result.indexOf("<section", pos + 1);
      const nextClose = result.indexOf("</section>", pos + 1);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen;
      } else {
        if (depth === 0) {
          end = nextClose + "</section>".length;
          break;
        }
        depth--;
        pos = nextClose;
      }
    }
    if (end === -1) break;
    // Also drop any leftover orphan style/script that belonged to a prior hollow bake
    let cursor = end;
    for (;;) {
      const wsMatch = result.slice(cursor).match(/^\s*/);
      cursor += wsMatch ? wsMatch[0].length : 0;
      const lower = result.slice(cursor, cursor + 16).toLowerCase();
      if (lower.startsWith("<style")) {
        const close = result.indexOf("</style>", cursor);
        if (close === -1) break;
        cursor = close + "</style>".length;
        continue;
      }
      if (lower.startsWith("<script")) {
        const close = result.indexOf("</script>", cursor);
        if (close === -1) break;
        cursor = close + "</script>".length;
        continue;
      }
      break;
    }
    result = result.slice(0, start) + block + result.slice(cursor);
  }
  return result;
}

function scrollAnimPendingHtml(texts: Array<{ title: string; sub: string }>, videoPrompt?: string, style?: string): string {
  if (style === "immersion") {
    return buildImmersionGlassPendingHtml(videoPrompt || "", texts);
  }
  if (style === "site3d") {
    return buildSite3dPendingHtml(videoPrompt || "", texts);
  }
  if (style === "animational") {
    const brandHint = texts[0]?.title || undefined;
    return buildAnimationalPendingHtml(brandHint, videoPrompt);
  }
  const isMotion = style === "motion";
  const first = texts[0] || { title: "", sub: "" };
  const tid = "pnd" + Math.random().toString(36).slice(2, 8);
  const _pa = videoPrompt ? ` data-scroll-anim-prompt="${encodeURIComponent(videoPrompt)}"` : "";
  const _sa = style ? ` data-scroll-anim-style="${encodeURIComponent(style)}"` : "";
  const _ta = texts.length ? ` data-scroll-anim-texts="${encodeURIComponent(texts.map(t => `${t.title}::${t.sub}`).join("||"))}"` : "";
  const pendingTitle = isMotion ? "Генерация моушн-эффекта" : "Генерация видеоанимации";
  const pendingSub = isMotion
    ? "Обычно 30–90 секунд (2 кадра параллельно)"
    : "Обычно 3–12 минут (видео Kling)";
  const barSecs = isMotion ? 45 : 180;
  return `<section data-scroll-anim-pending="1"${_pa}${_sa}${_ta} style="position:relative;height:100vh;min-height:600px;background:linear-gradient(135deg,#0a0a0a 0%,#16213e 50%,#0a0a0a 100%);display:flex;align-items:center;justify-content:center;overflow:hidden;">
<style>
@keyframes ${tid}-spin{to{transform:rotate(360deg)}}
@keyframes ${tid}-pulse{0%,100%{opacity:.5}50%{opacity:1}}
@keyframes ${tid}-bar{0%{width:0%}100%{width:85%}}
@keyframes ${tid}-fade{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
</style>
<div style="text-align:center;color:#fff;z-index:2;padding:40px;max-width:560px;animation:${tid}-fade .6s ease both;">
  ${first.title ? `<div style="font-size:clamp(1.6rem,4vw,2.8rem);font-weight:800;margin:0 0 .3em;opacity:.9;letter-spacing:-0.02em;line-height:1.1;">${csaEsc(first.title)}</div>` : ""}
  ${first.sub ? `<div style="font-size:clamp(.95rem,2vw,1.15rem);color:rgba(255,255,255,.5);margin:0 0 2.5rem;line-height:1.5;">${csaEsc(first.sub)}</div>` : ""}
  <div style="display:inline-flex;align-items:center;gap:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:18px 28px;margin-bottom:1.5rem;">
    <div style="width:36px;height:36px;border:2.5px solid rgba(255,255,255,.1);border-top-color:#a78bfa;border-radius:50%;flex-shrink:0;animation:${tid}-spin .9s linear infinite;"></div>
    <div style="text-align:left;">
      <div style="font-size:.95rem;font-weight:600;color:#fff;margin-bottom:2px;">${pendingTitle}</div>
      <div style="font-size:.8rem;color:rgba(255,255,255,.5);">${pendingSub}</div>
    </div>
  </div>
  <div style="width:220px;height:3px;background:rgba(255,255,255,.08);border-radius:99px;margin:0 auto 1.5rem;overflow:hidden;">
    <div style="height:100%;background:linear-gradient(90deg,#a78bfa,#60a5fa);border-radius:99px;animation:${tid}-bar ${barSecs}s cubic-bezier(.4,0,.2,1) forwards;"></div>
  </div>
  <div style="font-size:.78rem;color:rgba(255,255,255,.3);line-height:1.6;animation:${tid}-pulse 2.5s ease-in-out infinite;">Страница обновится автоматически.<br>Остальные секции сайта уже готовы — прокрутите вниз ↓</div>
</div>
</section>`;
}

function scrollAnimFallbackHtml(
  texts: Array<{ title: string; sub: string }>,
  videoPrompt?: string,
  style?: string,
  taskId?: string,
): string {
  const blocks = texts.map(t => `
      <div style="max-width:680px;margin:0 auto 3.5rem;">
        ${t.title ? `<h2 style="font-size:clamp(2rem,5vw,3.5rem);font-weight:800;letter-spacing:-0.03em;color:#0a0a0a;margin:0 0 .5em;line-height:1.1;">${csaEsc(t.title)}</h2>` : ""}
        ${t.sub ? `<p style="font-size:clamp(1rem,2vw,1.25rem);line-height:1.7;color:#444;margin:0;">${csaEsc(t.sub)}</p>` : ""}
      </div>`).join("");
  // Embed the original video prompt + style + task ID so the retry endpoint can reconstruct
  // the marker and — if the video already completed on KIE — skip re-generation entirely.
  const promptAttr = videoPrompt
    ? ` data-scroll-anim-prompt="${encodeURIComponent(videoPrompt)}" data-scroll-anim-style="${encodeURIComponent(style || "parallax")}"`
    : "";
  const taskAttr = taskId ? ` data-scroll-anim-task-id="${encodeURIComponent(taskId)}"` : "";
  return `<section data-scroll-anim-fallback="1"${promptAttr}${taskAttr} style="background:#fff;padding:clamp(60px,12vw,160px) 6%;text-align:center;">${blocks}</section>`;
}

// Build a self-contained scroll-bound Canvas animation block (section + style + script).
// layout: "parallax" — full-screen text; "split" — text left; "site3d" — stacked 3D cards over video.
function buildScrollAnimHtml(
  frames: string[],
  texts: Array<{ title: string; sub: string }>,
  layout: ScrollAnimLayout = "parallax",
  videoUrl?: string,
): string {
  const cid = "csa" + Math.random().toString(36).slice(2, 8);
  const framesJson = JSON.stringify(frames).replace(/'/g, "&#39;");
  const isSplit = layout === "split";
  const n = Math.max(1, texts.length);
  const layers = texts.map((t, i) => {
    const segStart = i / n, segEnd = (i + 1) / n, fade = (1 / n) * 0.22;
    // First block is fully visible at scroll=0 (no fade-in); last block stays until the end (no fade-out).
    const fi = (i === 0 ? -1 : segStart).toFixed(3);
    const fis = (i === 0 ? 0 : segStart + fade).toFixed(3);
    const fos = (i === n - 1 ? 2 : segEnd - fade).toFixed(3);
    const fo = (i === n - 1 ? 2 : segEnd).toFixed(3);
    return `      <div class="${cid}-text" data-fi="${fi}" data-fis="${fis}" data-fos="${fos}" data-fo="${fo}">
        ${t.title ? `<h2>${csaEsc(t.title)}</h2>` : ""}
        ${t.sub ? `<p>${csaEsc(t.sub)}</p>` : ""}
      </div>`;
  }).join("\n");
  const scrollVh = Math.max(300, Math.min(560, texts.length * 130 + 180));

  // Global nav controller + enforcement (injected once, guarded).
  // 1) CSS: while the animation is on screen (body WITHOUT `craft-anim-passed`)
  //    the site <header> is FORCED fully transparent with !important — so the
  //    menu never shows a plate/blur over the animation, even if the generated
  //    CSS hardcodes an opaque header. Once the animation is fully scrolled past
  //    (`craft-anim-passed` added) the override stops and whatever header styles
  //    the site defines (colored/solid) take over.
  // 2) JS: toggles `craft-anim-passed` on <body> once EVERY scroll-animation
  //    section (marked with data-craft-scrollanim) has scrolled above the header.
  //    Uses a dedicated attribute (not the generic data-frames) to avoid clashes,
  //    and a header-height-aware threshold instead of a magic number.
  const navCtl = `\n<style>header{transition:background .45s ease,background-color .45s ease,backdrop-filter .45s ease,-webkit-backdrop-filter .45s ease,border-color .45s ease,box-shadow .45s ease;}body:not(.craft-anim-passed) header{background:transparent!important;background-color:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;border-color:transparent!important;box-shadow:none!important;}</style>\n<script>(function(){if(window.__craftNavCtl)return;window.__craftNavCtl=true;function fixSticky(){var s=document.querySelectorAll('[data-craft-scrollanim]');if(!s.length)return;for(var i=0;i<s.length;i++){var el=s[i];while(el&&el.nodeType===1&&el!==document.documentElement){var cs=getComputedStyle(el);if(cs.overflowX==='hidden')el.style.overflowX='clip';if(cs.overflowY==='hidden')el.style.overflowY='clip';el=el.parentElement;}}var de=document.documentElement,b=document.body;[de,b].forEach(function(n){if(!n)return;var c=getComputedStyle(n);if(c.overflowX==='hidden')n.style.overflowX='clip';if(c.overflowY==='hidden')n.style.overflowY='clip';});}function u(){var s=document.querySelectorAll('[data-craft-scrollanim]');if(!s.length)return;var h=document.querySelector('header');var th=h?h.offsetHeight:64;var passed=true;for(var i=0;i<s.length;i++){if(s[i].getBoundingClientRect().bottom>th){passed=false;break;}}document.body.classList.toggle('craft-anim-passed',passed);}window.addEventListener('scroll',u,{passive:true});window.addEventListener('resize',u);if(document.readyState!=='loading'){fixSticky();u();}else{document.addEventListener('DOMContentLoaded',function(){fixSticky();u();});}fixSticky();u();})();</script>`;

  if (layout === "immersion") {
    return buildImmersionGlassHtml(videoUrl || "", texts, navCtl, csaEsc);
  }
  if (layout === "site3d") {
    return buildSite3dAnimHtml(frames, texts, navCtl, csaEsc, videoUrl);
  }
  // motion layout is built via buildMotionRevealHtml (image pair), not video frames.

  // ── Parallax (full-screen) layout ──────────────────────────────────────────
  if (!isSplit) {
    return `
<section class="${cid}-scroll" data-frames='${framesJson}' data-layout="parallax" data-craft-scrollanim="1">
  <div class="${cid}-sticky">
    <canvas class="${cid}-canvas"></canvas>
    <div class="${cid}-veil"></div>
    <div class="${cid}-overlays">
${layers}
    </div>
  </div>
</section>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800&family=Manrope:wght@400;500;600&display=swap');
  .${cid}-scroll{position:relative;height:${scrollVh}vh;margin:0;padding:0;}
  .${cid}-sticky{position:sticky;top:0;height:100vh;width:100%;overflow:hidden;background:#000;}
  .${cid}-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
  .${cid}-veil{position:absolute;inset:0;pointer-events:none;background:linear-gradient(to top,rgba(0,0,0,0.62) 0%,rgba(0,0,0,0.18) 38%,rgba(0,0,0,0) 65%);}
  .${cid}-overlays{position:absolute;inset:0;pointer-events:none;}
  .${cid}-text{position:absolute;left:clamp(36px,5.5vw,96px);bottom:clamp(56px,8vh,108px);top:auto;transform:none;width:min(680px,86vw);text-align:left;opacity:0;will-change:opacity,transform;}
  .${cid}-text::before{content:"";position:absolute;inset:-60% -30% -30% -20%;z-index:-1;background:radial-gradient(ellipse at 20% 80%,rgba(0,0,0,0.48) 0%,rgba(0,0,0,0.18) 55%,rgba(0,0,0,0) 78%);filter:blur(18px);}
  .${cid}-text h2{margin:0 0 .25em;font-family:'Unbounded',system-ui,sans-serif;font-size:clamp(1.6rem,3.8vw,3.8rem);font-weight:800;letter-spacing:-0.02em;line-height:1.05;color:#fff;text-shadow:0 2px 24px rgba(0,0,0,0.6);}
  .${cid}-text p{margin:.18em 0 0;max-width:520px;font-family:'Manrope',system-ui,sans-serif;font-size:clamp(0.9rem,1.7vw,1.25rem);font-weight:500;line-height:1.55;color:rgba(255,255,255,0.88);text-shadow:0 1px 14px rgba(0,0,0,0.5);}
</style>
<script>
(function(){
  var roots=document.querySelectorAll('.${cid}-scroll');
  roots.forEach(function(root){
    if(root.__csaInit)return;root.__csaInit=true;
    var frames;try{frames=JSON.parse(root.getAttribute('data-frames')||'[]');}catch(e){frames=[];}
    if(!frames.length)return;
    var sticky=root.querySelector('.${cid}-sticky');
    var canvas=root.querySelector('.${cid}-canvas');
    var ctx=canvas.getContext('2d');
    var texts=[].slice.call(root.querySelectorAll('.${cid}-text'));
    var imgs=new Array(frames.length),started=new Array(frames.length),cur=-1;
    var dpr=Math.min(window.devicePixelRatio||1,2);
    function cover(img){var cw=sticky.clientWidth,ch=sticky.clientHeight,iw=img.naturalWidth,ih=img.naturalHeight;if(!iw||!ih)return;var s=Math.max(cw/iw,ch/ih),dw=iw*s,dh=ih*s,dx=(cw-dw)/2,dy=(ch-dh)/2;ctx.clearRect(0,0,cw,ch);ctx.drawImage(img,dx,dy,dw,dh);}
    function nearest(i){if(imgs[i]&&imgs[i].complete&&imgs[i].naturalWidth)return i;for(var d=1;d<frames.length;d++){var a=i-d,b=i+d;if(a>=0&&imgs[a]&&imgs[a].complete&&imgs[a].naturalWidth)return a;if(b<frames.length&&imgs[b]&&imgs[b].complete&&imgs[b].naturalWidth)return b;}return -1;}
    function paint(i){i=Math.max(0,Math.min(frames.length-1,i));cur=i;var use=nearest(i);if(use!==-1)cover(imgs[use]);ensure(i);}
    function resize(){var w=sticky.clientWidth,h=sticky.clientHeight;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);paint(cur<0?0:cur);}
    function signalReady(){try{window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){}}
    // Priority loader: frames near the CURRENT scroll target load first (ensure()), jumping
    // ahead of the plain sequential queue — a fast scroller no longer freezes waiting for a
    // strict index-order backlog to catch up. paint() also falls back to the nearest already-
    // loaded frame instead of leaving the canvas stuck on a stale one while the exact target
    // streams in. signalReady() still fires once every frame has settled (loaded or failed).
    var loadedCount=0,total=frames.length,activeCount=0,MAXP=6,nextSeq=0;
    function startLoad(idx){if(started[idx])return;started[idx]=true;activeCount++;var im=new Image(),settled=false;function _done(){if(settled)return;settled=true;activeCount--;loadedCount++;if(loadedCount>=total)signalReady();if(idx===cur||nearest(cur)===idx)paint(cur<0?0:cur);pump();}im.decoding='async';imgs[idx]=im;im.onload=_done;im.onerror=_done;setTimeout(_done,12000);im.src=frames[idx];}
    function pump(){while(activeCount<MAXP&&nextSeq<total){if(started[nextSeq]){nextSeq++;continue;}startLoad(nextSeq++);}}
    function ensure(i){var lo=Math.max(0,i-2),hi=Math.min(total-1,i+8);for(var k=lo;k<=hi;k++){if(!started[k])startLoad(k);}}
    startLoad(0);pump();
    function setP(p){
      p=Math.max(0,Math.min(1,p));
      var idx=Math.round(p*(frames.length-1));if(idx!==cur)paint(idx);
      texts.forEach(function(el){var fi=parseFloat(el.getAttribute('data-fi')),fis=parseFloat(el.getAttribute('data-fis')),fos=parseFloat(el.getAttribute('data-fos')),fo=parseFloat(el.getAttribute('data-fo'));var op=0;if(!isNaN(fi)&&p>=fi&&p<=fo){op=p<fis?(fis>fi?(p-fi)/(fis-fi):1):(p<=fos?1:(fo>fos?1-(p-fos)/(fo-fos):1));}op=Math.max(0,Math.min(1,op));el.style.opacity=op.toFixed(3);el.style.transform='translateY('+((1-op)*22)+'px)';});
    }
    // ── Passive scroll-driven progress (no scroll-jacking) ──
    function secTop(){return root.getBoundingClientRect().top+(window.pageYOffset||document.documentElement.scrollTop);}
    function totH(){return Math.max(1,root.offsetHeight-window.innerHeight);}
    function syncScroll(){var s=secTop(),t=totH(),top=window.pageYOffset||document.documentElement.scrollTop;setP((top-s)/t);}
    window.addEventListener('scroll',syncScroll,{passive:true});
    window.addEventListener('resize',resize);
    resize();syncScroll();
  });
})();
</script>${navCtl}`;
  }

  // ── Split layout: video right, text left on solid background area ──────────
  return `
<section class="${cid}-scroll" data-frames='${framesJson}' data-layout="split" data-craft-scrollanim="1">
  <div class="${cid}-sticky">
    <canvas class="${cid}-canvas"></canvas>
    <div class="${cid}-panel">
${layers}
    </div>
  </div>
</section>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800&family=Manrope:wght@400;500;600&display=swap');
  .${cid}-scroll{position:relative;height:${scrollVh}vh;margin:0;padding:0;}
  .${cid}-sticky{position:sticky;top:0;height:100vh;width:100%;overflow:hidden;background:#f8f7f4;}
  .${cid}-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
  .${cid}-panel{position:absolute;top:0;left:0;width:52%;height:100%;pointer-events:none;display:flex;align-items:center;padding:0 clamp(32px,5.5vw,96px);background:linear-gradient(to right,rgba(248,247,244,0.9) 0%,rgba(248,247,244,0.74) 42%,rgba(248,247,244,0) 100%);}
  .${cid}-text{position:absolute;left:clamp(32px,5.5vw,96px);top:50%;transform:translateY(-50%);width:min(50vw,640px);text-align:left;opacity:0;will-change:opacity,transform;}
  .${cid}-text h2{margin:0 0 .35em;font-family:'Unbounded',system-ui,sans-serif;font-size:clamp(2.2rem,5.5vw,5.4rem);font-weight:800;letter-spacing:-0.03em;line-height:1.0;color:#15151A;}
  .${cid}-text p{margin:0;max-width:540px;font-family:'Manrope',system-ui,sans-serif;font-size:clamp(1rem,2vw,1.45rem);font-weight:500;line-height:1.6;color:#4a4a4f;}
  @media(max-width:700px){.${cid}-panel{width:100%;background:linear-gradient(to top,rgba(248,247,244,0.96) 60%,rgba(248,247,244,0) 100%);bottom:0;top:auto;height:46%;align-items:flex-start;padding:18px 22px;} .${cid}-text{position:relative;top:auto;left:auto;transform:none;width:100%;text-align:center;} .${cid}-text h2{font-size:clamp(1.7rem,7vw,2.4rem);} .${cid}-text p{font-size:0.92rem;}}
</style>
<script>
(function(){
  var roots=document.querySelectorAll('.${cid}-scroll');
  roots.forEach(function(root){
    if(root.__csaInit)return;root.__csaInit=true;
    var frames;try{frames=JSON.parse(root.getAttribute('data-frames')||'[]');}catch(e){frames=[];}
    if(!frames.length)return;
    var sticky=root.querySelector('.${cid}-sticky');
    var canvas=root.querySelector('.${cid}-canvas');
    var ctx=canvas.getContext('2d');
    var texts=[].slice.call(root.querySelectorAll('.${cid}-text'));
    var imgs=new Array(frames.length),started=new Array(frames.length),cur=-1;
    var dpr=Math.min(window.devicePixelRatio||1,2);
    function cover(img){var cw=sticky.clientWidth,ch=sticky.clientHeight,iw=img.naturalWidth,ih=img.naturalHeight;if(!iw||!ih)return;var s=Math.max(cw/iw,ch/ih),dw=iw*s,dh=ih*s,dx=(cw-dw)/2,dy=(ch-dh)/2;ctx.clearRect(0,0,cw,ch);ctx.drawImage(img,dx,dy,dw,dh);}
    function nearest(i){if(imgs[i]&&imgs[i].complete&&imgs[i].naturalWidth)return i;for(var d=1;d<frames.length;d++){var a=i-d,b=i+d;if(a>=0&&imgs[a]&&imgs[a].complete&&imgs[a].naturalWidth)return a;if(b<frames.length&&imgs[b]&&imgs[b].complete&&imgs[b].naturalWidth)return b;}return -1;}
    function paint(i){i=Math.max(0,Math.min(frames.length-1,i));cur=i;var use=nearest(i);if(use!==-1)cover(imgs[use]);ensure(i);}
    function resize(){var w=sticky.clientWidth,h=sticky.clientHeight;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);paint(cur<0?0:cur);}
    function signalReady(){try{window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){}}
    // Priority loader: frames near the CURRENT scroll target load first (ensure()), jumping
    // ahead of the plain sequential queue — a fast scroller no longer freezes waiting for a
    // strict index-order backlog to catch up. paint() also falls back to the nearest already-
    // loaded frame instead of leaving the canvas stuck on a stale one while the exact target
    // streams in. signalReady() still fires once every frame has settled (loaded or failed).
    var loadedCount=0,total=frames.length,activeCount=0,MAXP=6,nextSeq=0;
    function startLoad(idx){if(started[idx])return;started[idx]=true;activeCount++;var im=new Image(),settled=false;function _done(){if(settled)return;settled=true;activeCount--;loadedCount++;if(loadedCount>=total)signalReady();if(idx===cur||nearest(cur)===idx)paint(cur<0?0:cur);pump();}im.decoding='async';imgs[idx]=im;im.onload=_done;im.onerror=_done;setTimeout(_done,12000);im.src=frames[idx];}
    function pump(){while(activeCount<MAXP&&nextSeq<total){if(started[nextSeq]){nextSeq++;continue;}startLoad(nextSeq++);}}
    function ensure(i){var lo=Math.max(0,i-2),hi=Math.min(total-1,i+8);for(var k=lo;k<=hi;k++){if(!started[k])startLoad(k);}}
    startLoad(0);pump();
    function setP(p){
      p=Math.max(0,Math.min(1,p));
      var idx=Math.round(p*(frames.length-1));if(idx!==cur)paint(idx);
      texts.forEach(function(el){var fi=parseFloat(el.getAttribute('data-fi')),fis=parseFloat(el.getAttribute('data-fis')),fos=parseFloat(el.getAttribute('data-fos')),fo=parseFloat(el.getAttribute('data-fo'));var op=0;if(!isNaN(fi)&&p>=fi&&p<=fo){op=p<fis?(fis>fi?(p-fi)/(fis-fi):1):(p<=fos?1:(fo>fos?1-(p-fos)/(fo-fos):1));}op=Math.max(0,Math.min(1,op));el.style.opacity=op.toFixed(3);el.style.transform='translateY(calc(-50% + '+((1-op)*22)+'px))';});
    }
    // ── Passive scroll-driven progress (no scroll-jacking) ──
    function secTop(){return root.getBoundingClientRect().top+(window.pageYOffset||document.documentElement.scrollTop);}
    function totH(){return Math.max(1,root.offsetHeight-window.innerHeight);}
    function syncScroll(){var s=secTop(),t=totH(),top=window.pageYOffset||document.documentElement.scrollTop;setP((top-s)/t);}
    window.addEventListener('scroll',syncScroll,{passive:true});
    window.addEventListener('resize',resize);
    resize();syncScroll();
  });
})();
</script>${navCtl}`;
}

// Scan files for {{SCROLLANIM:...}} markers, generate the animation, and bake the result in.
// No marker ever survives — failures degrade to a static text section.

function buildMotionRevealDeps(opts: {
  shouldStop: () => boolean;
  onStatus?: (msg: string) => void;
  appBaseUrl?: string;
}): GenerateMotionRevealDeps {
  return {
    kieApiKey: KIE_API_KEY || "",
    createUrl: NANO_BANANA_CREATE_URL,
    statusUrl: NANO_BANANA_STATUS_URL,
    kieRequestJson,
    uploadToObjectStorage,
    appBaseUrl: opts.appBaseUrl || process.env.APP_BASE_URL || "https://craft-ai.ru",
    shouldStop: opts.shouldStop,
    onStatus: opts.onStatus,
  };
}

function buildAnimationalDeps(opts: {
  shouldStop: () => boolean;
  onStatus?: (msg: string) => void;
  appBaseUrl?: string;
}): GenerateAnimationalDeps {
  return {
    kieApiKey: KIE_API_KEY || "",
    createUrl: NANO_BANANA_CREATE_URL,
    statusUrl: NANO_BANANA_STATUS_URL,
    kieRequestJson,
    uploadToObjectStorage,
    appBaseUrl: opts.appBaseUrl || process.env.APP_BASE_URL || "https://craft-ai.ru",
    shouldStop: opts.shouldStop,
    onStatus: opts.onStatus,
  };
}

async function resolveAnimationalMarkers(
  filesMap: Map<string, string>,
  projectId: number,
  userId: number | undefined,
  runKey: string,
  res: any,
  isAborted: () => boolean = () => false,
): Promise<{ generated: number; creditsUsed: number }> {
  const RE = /\{\{ANIMATIONAL:([\s\S]+?)\}\}/g;
  const markers = new Map<string, string>();
  for (const code of Array.from(filesMap.values())) {
    let m: RegExpExecArray | null;
    RE.lastIndex = 0;
    while ((m = RE.exec(code)) !== null) {
      const raw = m[1].trim();
      if (!markers.has(raw)) markers.set(raw, raw);
    }
  }
  if (markers.size === 0) return { generated: 0, creditsUsed: 0 };

  const replaceMap = new Map<string, string>();
  let generated = 0;
  let creditsUsed = 0;
  const phaseDeadline = Date.now() + 900000; // 15 min — image-only pipeline

  for (const [raw] of Array.from(markers.entries()).slice(0, 1)) {
    if (isAborted() || Date.now() >= phaseDeadline) break;
    try {
      res.write(`data: ${JSON.stringify({ status: "Анимационный: генерирую кадры через KIE…" })}\n\n`);
    } catch {}

    let billed = false;
    let ikey: string | undefined;
    try {
      if (userId) {
        ikey = `animational-${projectId}-${runKey}-${crypto.createHash("md5").update(raw).digest("hex").slice(0, 8)}`;
        const ded = await storage.deductCredits(userId, SCROLL_ANIMATIONAL_COST, "animational", ikey);
        if (!ded.success) break;
        billed = !ded.alreadyProcessed;
      }

      const keepAliveInterval = setInterval(() => {
        try {
          res.write(`data: ${JSON.stringify({ status: "Анимационный: жду кадры от KIE…" })}\n\n`);
        } catch {}
      }, 15000);

      let site: Awaited<ReturnType<typeof generateAnimationalSite>> = null;
      try {
        site = await generateAnimationalSite({
          markerInner: raw,
          deps: buildAnimationalDeps({
            shouldStop: () => isAborted() || Date.now() >= phaseDeadline,
            onStatus: (msg) => {
              try {
                res.write(`data: ${JSON.stringify({ status: msg })}\n\n`);
              } catch {}
            },
          }),
        });
      } finally {
        clearInterval(keepAliveInterval);
      }

      if (site?.html) {
        replaceMap.set(raw, site.html);
        generated++;
        if (billed) creditsUsed += SCROLL_ANIMATIONAL_COST;
        try {
          res.write(`data: ${JSON.stringify({ status: "Анимационный сайт готов" })}\n\n`);
        } catch {}
      } else if (billed && userId) {
        try {
          await storage.refundCredits(userId, SCROLL_ANIMATIONAL_COST);
        } catch {}
      }
    } catch (e: any) {
      console.error("[ANI] resolve failed:", e?.message || e);
      if (billed && userId) {
        try {
          await storage.refundCredits(userId, SCROLL_ANIMATIONAL_COST);
        } catch {}
      }
    }
  }

  for (const [filename, code] of Array.from(filesMap.entries())) {
    const newCode = code.replace(/\{\{ANIMATIONAL:([\s\S]+?)\}\}/g, (_full, inner) => {
      const key = String(inner).trim();
      return replaceMap.get(key) ?? buildAnimationalFallbackHtml(key);
    });
    filesMap.set(filename, newCode);
  }
  return { generated, creditsUsed };
}

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
        return replaceMap.get(key) ?? scrollAnimFallbackHtml(markers.get(key)?.texts || [], markers.get(key)?.videoPrompt, layout);
      });
      filesMap.set(filename, newCode);
    }
  };

  const entries = Array.from(markers.entries());
  if (entries.length === 0) { return { generated: 0, creditsUsed: 0 }; }

  const layout = resolveScrollAnimLayout(interactiveStyle);
  // immersion + site3d: one cinematic MP4 scrub each; others: at most 2 markers
  const planned = entries.slice(0, layout === "immersion" || layout === "site3d" ? 1 : 2);
  // Immersion / 3D = one Kling MP4 scrub (~35m). Motion is image-only (2 stills).
  const phaseDeadline = Date.now() + (layout === "immersion" || layout === "site3d" ? 2100000 : layout === "motion" ? 240000 : 2520000);

  // Product still is regenerated lazily (ONCE) AFTER the first successful credit
  // deduction inside the loop, so we never spend external API budget on a user who
  // cannot pay.
  let referenceStill: string | undefined = undefined;
  let productStillResolved = false;
  // Creative concept is analyzed from the product photo ONCE (lazily, after the first
  // successful credit deduction) and reused for every block on this site.
  let creativeConcept: CreativeProductConcept | null = null;
  let creativeConceptResolved = false;

  for (const [raw, parsed] of planned) {
    if (isAborted() || Date.now() >= phaseDeadline) break;
    const isImmersion = layout === "immersion";
    const isSite3d = layout === "site3d";
    const isMotion = layout === "motion";
    // Immersion / 3D = one Kling clip (same token cost as standard scroll-anim).
    const blockCost = isMotion ? SCROLL_MOTION_COST : SCROLL_ANIM_COST;
    const blockReason = isImmersion ? "immersion-glass" : isSite3d ? "site3d-product" : isMotion ? "motion-reveal" : "scroll-anim";
    try {
      res.write(`data: ${JSON.stringify({ status: isImmersion
        ? "Погружение: рендерим кинематографичный видео-фон Kling (12 сек)…"
        : isSite3d
        ? "3D: рендерим продуктовый hero-ролик Kling (12 сек)…"
        : isMotion
        ? "Моушн: генерирую 2 цветных кадра параллельно (обычно <2 мин)…"
        : "Рендерю видео для анимации прокрутки (до 35 минут, зависит от очереди KIE)..." })}\n\n`);
    } catch {}

    let billed = false;
    let ikey: string | undefined;
    try {
    if (userId) {
      ikey = `${blockReason}-${projectId}-${runKey}-${crypto.createHash("md5").update(raw).digest("hex").slice(0, 8)}`;
      const ded = await storage.deductCredits(userId, blockCost, blockReason, ikey);
      if (!ded.success) break; // out of credits → leave for static fallback (finalize() still runs)
      billed = !ded.alreadyProcessed;
    }

    // Motion: dual-image WebGL hover reveal (no Kling video).
    if (isMotion) {
      const keepAliveInterval = setInterval(() => {
        try { res.write(`data: ${JSON.stringify({ status: "Моушн: жду пару кадров от KIE…" })}\n\n`); } catch {}
      }, 15000);
      let pair: Awaited<ReturnType<typeof generateMotionRevealPair>> = null;
      try {
        pair = await generateMotionRevealPair({
          scenePrompt: parsed.videoPrompt,
          productImageUrl,
          deps: buildMotionRevealDeps({
            shouldStop: () => isAborted() || Date.now() >= phaseDeadline,
            onStatus: (msg) => {
              try { res.write(`data: ${JSON.stringify({ status: msg })}\n\n`); } catch {}
            },
          }),
        });
      } finally {
        clearInterval(keepAliveInterval);
      }
      if (pair?.baseUrl && pair?.revealUrl) {
        // Build navCtl the same way as buildScrollAnimHtml (header transparency + sticky fix).
        const navCtl = `\n<style>header{transition:background .45s ease,background-color .45s ease,backdrop-filter .45s ease,-webkit-backdrop-filter .45s ease,border-color .45s ease,box-shadow .45s ease;}body:not(.craft-anim-passed) header{background:transparent!important;background-color:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;border-color:transparent!important;box-shadow:none!important;}</style>\n<script>(function(){if(window.__craftNavCtl)return;window.__craftNavCtl=true;function fixSticky(){var s=document.querySelectorAll('[data-craft-scrollanim]');if(!s.length)return;for(var i=0;i<s.length;i++){var el=s[i];while(el&&el.nodeType===1&&el!==document.documentElement){var cs=getComputedStyle(el);if(cs.overflowX==='hidden')el.style.overflowX='clip';if(cs.overflowY==='hidden')el.style.overflowY='clip';el=el.parentElement;}}var de=document.documentElement,b=document.body;[de,b].forEach(function(n){if(!n)return;var c=getComputedStyle(n);if(c.overflowX==='hidden')n.style.overflowX='clip';if(c.overflowY==='hidden')n.style.overflowY='clip';});}function u(){var s=document.querySelectorAll('[data-craft-scrollanim]');if(!s.length)return;var h=document.querySelector('header');var th=h?h.offsetHeight:64;var passed=true;for(var i=0;i<s.length;i++){if(s[i].getBoundingClientRect().bottom>th){passed=false;break;}}document.body.classList.toggle('craft-anim-passed',passed);}window.addEventListener('scroll',u,{passive:true});window.addEventListener('resize',u);if(document.readyState!=='loading'){fixSticky();u();}else{document.addEventListener('DOMContentLoaded',function(){fixSticky();u();});}fixSticky();u();})();</script>`;
        replaceMap.set(raw, buildMotionRevealHtml(pair.baseUrl, pair.revealUrl, parsed.texts, navCtl, csaEsc));
        generated++;
        if (billed) creditsUsed += blockCost;
        try { res.write(`data: ${JSON.stringify({ status: "Моушн готов — hover-reveal активен" })}\n\n`); } catch {}
      } else if (billed && userId) {
        try { await storage.refundCredits(userId, blockCost); } catch {}
      }
      continue;
    }

    // User is confirmed billable → safe to spend external API. Regenerate the uploaded
    // product photo ONCE onto a clean SOLID background (product positioned per layout)
    // and feed THAT still to Kling. Immersion uses brand-world flight (skip product detour).
    // site3d (3D product hero) WANTS the product still as Kling anchor when available.
    if (productImageUrl && !productStillResolved && layout !== "immersion") {
      productStillResolved = true;
      // Analyze the product ONCE and invent a creative, product-aware concept.
      if (!creativeConceptResolved) {
        creativeConceptResolved = true;
        try { res.write(`data: ${JSON.stringify({ status: "Анализирую товар и придумываю креативную идею для видео..." })}\n\n`); } catch {}
        creativeConcept = await generateCreativeConcept(productImageUrl, layout, () => isAborted() || Date.now() >= phaseDeadline);
      }
      try { res.write(`data: ${JSON.stringify({ status: "Готовлю кадр товара на однотонном фоне..." })}\n\n`); } catch {}
      referenceStill = (await generateProductStill(productImageUrl, layout, () => isAborted() || Date.now() >= phaseDeadline, creativeConcept?.stillAddition)) || undefined;
      if (!referenceStill) {
        // gpt-image-2 failed all retries — fall back to the raw uploaded product photo
        // so Kling still animates the REAL product rather than a generic text-to-image still.
        console.warn("[SCROLLANIM] product-still failed — using raw product photo as Kling source (real product preserved, bg may not be clean)");
        referenceStill = productImageUrl;
      } else {
        // GPT Image 2 rendered the still — now analyze the ACTUAL output with Gemini vision
        // to write a motion prompt based on what's really in the image (not the pre-planned
        // concept that may differ from what gpt-image-2 actually rendered).
        try { res.write(`data: ${JSON.stringify({ status: "Анализирую готовое изображение и пишу промпт для Kling..." })}\n\n`); } catch {}
        const visionMotion = await generateMotionPromptFromStill(
          referenceStill, layout, () => isAborted() || Date.now() >= phaseDeadline,
        );
        if (visionMotion) {
          // Override creativeConcept.motionPrompt with the vision-derived one
          creativeConcept = { ...(creativeConcept ?? { stillAddition: "", motionPrompt: "" }), motionPrompt: visionMotion };
        }
      }
    }

    // Keep the SSE connection alive with periodic status pings while video renders
    const keepAliveInterval = setInterval(() => {
      try { res.write(`data: ${JSON.stringify({ status: layout === "site3d"
        ? "3D: жду Kling (12с / product hero)…"
        : layout === "immersion"
        ? "Погружение: жду Kling (12с / video bg)…"
        : "Рендерю видео для анимации прокрутки (ожидаю результат от KIE)..." })}\n\n`); } catch {}
    }, layout === "site3d" || layout === "immersion" ? 15000 : 20000);

    // For product-photo sites, drive Kling with the vision-derived creative motion
    // (falls back to the LLM's videoPrompt when no concept was produced).
    const effectivePrompt = (productImageUrl && creativeConcept?.motionPrompt)
      ? creativeConcept.motionPrompt
      : parsed.videoPrompt;
    let frames: string[] = [];
    let videoUrl: string | undefined;
    let scrollKieFailed = false;
    try {
      const scrollOutcome = await generateScrollFrames(
        effectivePrompt,
        () => isAborted() || Date.now() >= phaseDeadline,
        referenceStill,
        layout,
        // Persist the Kling task ID into the pending section in DB so startup cleanup
        // can resume the already-running task if the server restarts mid-generation.
        projectId ? (klingTaskId) => {
          storage.getProject(projectId).then(proj => {
            if (!proj) return;
            const patched = (proj.generatedCode || "").replace(
              /(data-scroll-anim-pending="1"[^>]*?)(>)/,
              (m, attrs, gt) => attrs.includes("data-scroll-anim-task-id") ? m
                : `${attrs} data-scroll-anim-task-id="${klingTaskId}"${gt}`,
            );
            if (patched !== proj.generatedCode) {
              storage.updateProject(projectId, { generatedCode: patched }).catch(() => {});
            }
          }).catch(() => {});
        } : undefined,
      );
      frames = scrollOutcome.frames;
      videoUrl = scrollOutcome.videoUrl;
      scrollKieFailed = scrollOutcome.confirmedKieFailure;
    } finally {
      clearInterval(keepAliveInterval);
    }

    const videoScrubReady = (layout === "site3d" || layout === "immersion") && !!videoUrl;
    const framesReady = frames.length >= ((layout === "site3d" || layout === "immersion") ? 30 : 60);
    if (videoScrubReady || framesReady) {
      replaceMap.set(raw, buildScrollAnimHtml(frames, parsed.texts, layout, videoUrl));
      generated++;
      if (billed) creditsUsed += blockCost;
      try {
        res.write(`data: ${JSON.stringify({
          status: layout === "immersion"
            ? "Погружение готово (видео-фон + glass)"
            : layout === "site3d"
            ? "3D готово (product hero + glass)"
            : videoScrubReady
            ? "Анимация готова (видео-скролл)"
            : `Анимация готова (${frames.length} кадров)`,
        })}\n\n`);
      } catch {}
    } else if (billed && userId && scrollKieFailed) {
      await refundIfConfirmedKie(true, userId, blockCost, ikey, true, "scroll-anim-empty-frames");
    }
    } catch (blockErr: any) {
      // A helper (product still / creative concept / vision / frames / scroll-world) threw — never let
      // it abort the whole function (which would skip finalize() and strand the 2nd block).
      // Refund ONLY on confirmed KIE failure; continue so finalize() can degrade to fallback.
      console.warn(`[SCROLLANIM] block failed (project ${projectId}):`, blockErr?.message || blockErr);
      await refundIfConfirmedKie(billed, userId, blockCost, ikey, blockErr, "scroll-anim-block");
    }
  }

  finalize();
  return { generated, creditsUsed };
}

// Append cinematic, editorial-grade quality cues to a GENIMG prompt so every
// auto-generated content photo looks high-end instead of "stocky". Applied only at
// the generateGptImage call site — the ORIGINAL marker text stays the dedupe/cache
// key and the library name. Purely additive (no content restrictions) so prompts
// that intentionally include text/logos still work.
function withImageQualityBooster(p: string): string {
  const base = p.trim().replace(/[.\s]+$/, "");
  return `${base}. Editorial cinematic photography, shot on a full-frame camera with a fast prime lens, ` +
    `dramatic directional lighting, natural depth of field, rich filmic color grading, lifelike textures, ` +
    `crisp professional detail, premium commercial quality, photorealistic, ultra high resolution.`;
}

// Low-level: create a GPT Image 2 task on KIE, poll until ready, download and
// store in object storage. Returns the "/objects/..." URL or null on failure.
// Retries the full attempt up to MAX_ATTEMPTS times on transient errors.
async function generateGptImage(
  prompt: string,
  aspectRatio: string,
  shouldStop: () => boolean = () => false,
  refUrls?: string[],
): Promise<{ url: string | null; confirmedKieFailure: boolean }> {
  const useRefs = !!(refUrls && refUrls.length > 0);
  // More attempts since explicit-fail retries are near-instant (2 s each)
  const MAX_ATTEMPTS = 7;
  // Used only after a timeout — API was busy, back off gradually
  const TIMEOUT_RETRY_DELAYS = [3000, 6000, 12000, 20000, 20000, 20000];
  // Used after an explicit API error — recreate the task quickly
  const FAIL_RETRY_DELAY = 2000;

  let lastFailedExplicitly = false;
  let sawConfirmedKieFailure = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (shouldStop()) return { url: null, confirmedKieFailure: false };
    if (attempt > 0) {
      const delay = lastFailedExplicitly
        ? FAIL_RETRY_DELAY
        : (TIMEOUT_RETRY_DELAYS[attempt - 1] ?? 20000);
      const reason = lastFailedExplicitly ? "explicit fail → fast retry" : "timeout → backoff";
      console.log(`[GENIMG] attempt ${attempt + 1}/${MAX_ATTEMPTS} (${reason}), waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      if (shouldStop()) return { url: null, confirmedKieFailure: false };
    }
    lastFailedExplicitly = false; // reset for this attempt

    try {
      // --- Step 1: create task (retry create up to 3x on 5xx/network err) ---
      let createBody: any = null;
      let createHttpInfra = false;
      for (let cr = 0; cr < 3; cr++) {
        if (cr > 0) await new Promise((r) => setTimeout(r, 3000));
        try {
          const createResp = await fetch(NANO_BANANA_CREATE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${KIE_API_KEY}` },
            body: JSON.stringify({
              model: useRefs ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image",
              input: useRefs
                ? { prompt, input_urls: refUrls, aspect_ratio: aspectRatio, resolution: "1K" }
                : { prompt, aspect_ratio: aspectRatio, resolution: "1K" },
            }),
          });
          if (createResp.status === 429 || createResp.status >= 500) {
            createHttpInfra = true;
            sawConfirmedKieFailure = true;
            if (cr < 2) {
              console.warn(`[GENIMG] create HTTP ${createResp.status}, retrying create...`);
              continue;
            }
          }
          createBody = await createResp.json().catch(() => null);
          break;
        } catch (netErr: any) {
          console.warn(`[GENIMG] create network error (cr=${cr}):`, netErr?.message);
          sawConfirmedKieFailure = true;
          if (cr >= 2) break;
        }
      }

      if (!createBody || createBody.code !== 200 || !createBody.data?.taskId) {
        console.warn(`[GENIMG] create failed (attempt ${attempt + 1}):`, createBody?.msg);
        if (isConfirmedKieJobBodyFailure(createBody) || createHttpInfra) sawConfirmedKieFailure = true;
        lastFailedExplicitly = true; // create rejected → fast retry
        continue;
      }

      // --- Step 2: poll until done or 3-min per-task deadline ---
      const taskId = createBody.data.taskId;
      const deadline = Date.now() + 180000;
      let taskFailed = false;
      while (Date.now() < deadline) {
        if (shouldStop()) return { url: null, confirmedKieFailure: false };
        await new Promise((r) => setTimeout(r, 3000));
        let statusBody: any = null;
        try {
          const statusResp = await fetch(`${NANO_BANANA_STATUS_URL}?taskId=${taskId}`, {
            headers: { "Authorization": `Bearer ${KIE_API_KEY}` },
          });
          if (statusResp.status === 429 || statusResp.status >= 500) {
            sawConfirmedKieFailure = true;
            continue;
          }
          statusBody = await statusResp.json().catch(() => null);
        } catch (pollErr: any) {
          console.warn("[GENIMG] poll network error:", pollErr?.message);
          sawConfirmedKieFailure = true;
          continue;
        }
        if (!statusBody || statusBody.code !== 200) {
          if (isConfirmedKieJobBodyFailure(statusBody)) sawConfirmedKieFailure = true;
          continue;
        }
        const state = statusBody.data?.state;
        if (state === "success") {
          const result = JSON.parse(statusBody.data.resultJson);
          const urls = result.resultUrls || [];
          if (!urls[0]) { taskFailed = true; lastFailedExplicitly = true; sawConfirmedKieFailure = true; break; }
          const imgResp = await fetch(urls[0]);
          if (!imgResp.ok) { taskFailed = true; lastFailedExplicitly = true; sawConfirmedKieFailure = true; break; }
          const buf = Buffer.from(await imgResp.arrayBuffer());
          return { url: await uploadToObjectStorage(buf, "image/jpeg", "jpg"), confirmedKieFailure: false };
        }
        if (state === "fail" || state === "failed" || state === "error") {
          const failMsg = statusBody.data?.failMsg;
          const failCode = statusBody.data?.failCode;
          console.warn(`[GENIMG] task failed (attempt ${attempt + 1}):`, failMsg);
          taskFailed = true;
          lastFailedExplicitly = true;
          if (isKieModerationFailure(failMsg, failCode)) {
            // Content policy — do not mark as KIE infra failure
          } else if (isKieTaskInfraFailure(failMsg, failCode)) {
            sawConfirmedKieFailure = true;
          }
          break;
        }
      }
      if (!taskFailed) {
        // Deadline exceeded without a fail/success signal — API is slow, back off
        console.warn(`[GENIMG] task timed out (attempt ${attempt + 1})`);
        sawConfirmedKieFailure = true;
        // lastFailedExplicitly stays false → TIMEOUT_RETRY_DELAYS applied next iteration
      }
      // fall through to next attempt
    } catch (e: any) {
      console.warn(`[GENIMG] error (attempt ${attempt + 1}):`, e?.message || e);
      lastFailedExplicitly = true; // unexpected exception → fast retry
      if (isConfirmedKieApiFailure(e)) sawConfirmedKieFailure = true;
    }
  }

  console.warn("[GENIMG] all attempts exhausted, using gradient placeholder");
  return { url: null, confirmedKieFailure: sawConfirmedKieFailure };
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
  referenceImageUrls: string[] = [],
): Promise<{ generated: number; creditsUsed: number }> {
  const GENIMG_RE = /\{\{GENIMG:([^}]+)\}\}/g;
  const markers = new Map<string, { prompt: string; ratio: string; refIndices: number[] }>();
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
      let refIndices: number[] = [];
      const refPart = (parts[2] || "").trim();
      const refMatch = refPart.match(/^REF:?([\d,]+)$/i);
      if (refMatch) {
        refIndices = refMatch[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
      }
      markers.set(raw, { prompt: promptText, ratio, refIndices });
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
        const url = urlMap.get(key);
        if (url && !url.startsWith("data:")) return url; // real image
        // Encode the original key so autoFillMissingImages can later retry with the right prompt
        return `IMGPENDING:${Buffer.from(key).toString("base64")}`;
      });
      filesMap.set(filename, newCode);
    }
  };

  if (total === 0) { finalize(); return { generated: 0, creditsUsed: 0 }; }

  try { res.write(`data: ${JSON.stringify({ status: `Генерирую изображения (0/${total})...` })}\n\n`); } catch {}

  // Worker that processes an ordered list of (raw, parsed) entries
  const runWorkerBatch = async (
    batch: Array<[string, { prompt: string; ratio: string; refIndices: number[] }]>,
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
          let ikey: string | undefined;
          if (userId) {
            ikey = `auto-img-${projectId}-${runKey}-${crypto.createHash("md5").update(raw).digest("hex").slice(0, 8)}`;
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
            const refUrls = parsed.refIndices.length > 0
              ? parsed.refIndices.map(i => referenceImageUrls[i - 1]).filter((u): u is string => !!u)
              : undefined;
            const imgResult = await generateGptImage(withImageQualityBooster(parsed.prompt), parsed.ratio, () => isAborted() || Date.now() >= phaseDeadline, refUrls);
            const url = imgResult.url;
            if (url) {
              resolvedUrl = url;
              generated++;
              if (billed) creditsUsed += AUTO_IMAGE_COST;
              try {
                const proj = await storage.getProject(projectId);
                const name = (parsed.prompt.trim().split(/\s+/).slice(0, 3).join("_").replace(/[^a-zA-Z0-9_а-яА-Я-]/g, "") || `img_${myIdx}`).slice(0, 40);
                await storage.createProjectImage({ projectId, userId: proj?.userId, name, url, prompt: parsed.prompt.substring(0, 200) });
              } catch (e) { /* library save is best-effort */ }
            } else if (billed && userId && imgResult.confirmedKieFailure) {
              await refundIfConfirmedKie(true, userId, AUTO_IMAGE_COST, ikey, true, "auto-img");
            }
          }
        }

        urlMap.set(raw, resolvedUrl ?? gradientPlaceholderDataUri(raw));
        done++;
        const successSoFar = Array.from(urlMap.values()).filter(v => !v.startsWith("data:")).length;
        try { res.write(`data: ${JSON.stringify({ status: `${passLabel}: изображения (${successSoFar}/${total})...` })}\n\n`); } catch {}
      }
    };
    await Promise.all(Array.from({ length: Math.min(batch.length, MAX_AUTO_IMAGE_CONCURRENCY) }, () => worker()));
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

// ── Post-generation image review ──────────────────────────────────────────────
// Called only on the FIRST generation of a site. After resolveGenImgMarkers
// runs its two passes, any images that still failed are left as
// IMGPENDING:base64key markers (key = original "prompt|ratio").
// This function does one final targeted attempt with a fresh idempotency key,
// then converts remaining IMGPENDING: to gradient placeholders as a safety net.
async function autoFillMissingImages(
  filesMap: Map<string, string>,
  projectId: number,
  userId: number | undefined,
  runKey: string,
  res: any,
  isAborted: () => boolean = () => false,
): Promise<{ filled: number; creditsUsed: number }> {
  const PENDING_RE = /IMGPENDING:([A-Za-z0-9+/=]+)/g;
  const pendingSet = new Map<string, { prompt: string; ratio: string }>();
  for (const code of Array.from(filesMap.values())) {
    let m: RegExpExecArray | null;
    PENDING_RE.lastIndex = 0;
    while ((m = PENDING_RE.exec(code)) !== null) {
      const b64key = m[1];
      if (pendingSet.has(b64key)) continue;
      const key = Buffer.from(b64key, "base64").toString("utf8");
      const parts = key.split("|");
      const prompt = parts[0].trim();
      let ratio = (parts[1] || "").trim();
      if (!/^\d+:\d+$/.test(ratio)) ratio = "16:9";
      pendingSet.set(b64key, { prompt, ratio });
    }
  }
  if (pendingSet.size === 0) return { filled: 0, creditsUsed: 0 };

  const total = pendingSet.size;
  try { res.write(`data: ${JSON.stringify({ status: `Проверяю сайт, добавляю ${total} фото...` })}\n\n`); } catch {}

  const urlMap = new Map<string, string>(); // b64key → resolved URL
  let filled = 0;
  let creditsUsed = 0;
  const deadline = Date.now() + 300_000; // 5 min budget

  for (const [b64key, { prompt, ratio }] of Array.from(pendingSet)) {
    if (isAborted() || Date.now() > deadline) break;
    let billed = false;
    let ikey: string | undefined;
    if (userId) {
      ikey = `fill-${projectId}-${runKey}-${crypto.createHash("md5").update(b64key).digest("hex").slice(0, 8)}`;
      const ded = await storage.deductCredits(userId, AUTO_IMAGE_COST, "image", ikey);
      if (!ded.success) break; // out of credits
      if (!ded.alreadyProcessed) billed = true;
    }
    const imgResult = await generateGptImage(
      withImageQualityBooster(prompt),
      ratio,
      () => isAborted() || Date.now() > deadline,
    );
    const resolvedUrl = imgResult.url;
    if (resolvedUrl) {
      let savedUrl = resolvedUrl;
      try {
        const imgResp = await fetch(resolvedUrl);
        if (imgResp.ok) {
          const buf = Buffer.from(await imgResp.arrayBuffer());
          const localUrl = await uploadToObjectStorage(buf, "image/jpeg", "jpg");
          if (localUrl) savedUrl = localUrl;
        }
      } catch { /* best-effort object storage */ }
      try {
        const proj = await storage.getProject(projectId);
        const name = (prompt.trim().split(/\s+/).slice(0, 3).join("_").replace(/[^a-zA-Z0-9_а-яА-Я-]/g, "") || "review_img").slice(0, 40);
        await storage.createProjectImage({ projectId, userId: proj?.userId, name, url: savedUrl, prompt: prompt.substring(0, 200) });
      } catch { /* best-effort library save */ }
      urlMap.set(b64key, savedUrl);
      filled++;
      creditsUsed += AUTO_IMAGE_COST;
      try { res.write(`data: ${JSON.stringify({ status: `Добавляю фото (${filled}/${total})...` })}\n\n`); } catch {}
    } else if (billed && userId && imgResult.confirmedKieFailure) {
      await refundIfConfirmedKie(true, userId, AUTO_IMAGE_COST, ikey, true, "fill-img");
    }
  }

  // Replace IMGPENDING: markers — real URL if generated, gradient fallback otherwise
  for (const [filename, code] of Array.from(filesMap.entries())) {
    const newCode = code.replace(/IMGPENDING:([A-Za-z0-9+/=]+)/g, (_full, b64key) => {
      const url = urlMap.get(b64key);
      if (url) return url;
      const key = Buffer.from(b64key, "base64").toString("utf8");
      return gradientPlaceholderDataUri(key);
    });
    filesMap.set(filename, newCode);
  }

  if (filled > 0) console.log(`[IMG-REVIEW] Filled ${filled}/${total} missing image(s) for project ${projectId}`);
  else console.log(`[IMG-REVIEW] ${total} image(s) still unavailable after review pass for project ${projectId}`);
  return { filled, creditsUsed };
}

type KieContentItem =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_image_inline"; base64: string; mime_type: string };

type KieMessage = { role: "user" | "assistant" | "developer" | "system"; content: KieContentItem[] };

// Converts our provider-agnostic KieMessage[] into Anthropic Messages API blocks.
// Developer/system role entries are skipped here — system content is sent via the
// top-level `system` field instead, since Claude's `messages` only accepts user/assistant.
function toClaudeMessages(messages: KieMessage[]): any[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role,
      content: m.content.map((c: any) => {
        if (c.type === "input_text") return { type: "text", text: c.text };
        if (c.type === "input_image") return { type: "image", source: { type: "url", url: c.image_url } };
        if (c.type === "input_image_inline") {
          return { type: "image", source: { type: "base64", media_type: c.mime_type, data: c.base64 } };
        }
        return { type: "text", text: "" };
      }),
    }));
}

async function kieGenerateSync(
  messages: KieMessage[],
  systemPrompt: string
): Promise<string> {
  const resp = await fetch(KIE_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_API_KEY}` },
    body: JSON.stringify({
      model: KIE_LLM_MODEL,
      stream: false,
      system: systemPrompt,
      messages: toClaudeMessages(messages),
      max_tokens: KIE_LLM_MAX_TOKENS,
      thinkingFlag: false,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw kieHttpError(resp.status, err, "KIE API");
  }
  const data = await resp.json() as any;
  let text = "";
  for (const c of data.content || []) {
    if (c.type === "text" && c.text) text += c.text as string;
  }
  return text;
}

async function* kieGenerateStream(
  messages: KieMessage[],
  systemPrompt: string,
  reasoningEffort: "low" | "medium" | "high" | "xhigh" = "high"
): AsyncGenerator<string> {
  // Claude adapter only exposes a boolean "extended thinking" toggle — map effort onto it.
  const thinkingFlag = reasoningEffort === "high" || reasoningEffort === "xhigh";
  const resp = await fetch(KIE_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_API_KEY}` },
    body: JSON.stringify({
      model: KIE_LLM_MODEL,
      stream: true,
      system: systemPrompt,
      messages: toClaudeMessages(messages),
      max_tokens: KIE_LLM_MAX_TOKENS,
      thinkingFlag,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw kieHttpError(resp.status, errText, "KIE API");
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
        try {
          const parsed = JSON.parse(raw);
          if (eventType === "content_block_delta" && parsed?.delta?.type === "text_delta" && parsed.delta.text) {
            yield parsed.delta.text as string;
          } else if (eventType === "error" || parsed?.type === "error") {
            const errMsg = parsed?.error?.message || raw;
            throw new KieApiError(`KIE Claude stream error: ${errMsg}`, { source: "stream" });
          } else if (eventType === "message_stop" || parsed?.type === "message_stop") {
            return;
          }
        } catch (parseErr: any) {
          if (parseErr instanceof KieApiError) throw parseErr;
          if (parseErr instanceof Error && parseErr.message.startsWith("KIE Claude stream error")) throw parseErr;
          // ignore malformed/partial JSON chunks
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
    const parts = msg.content.map((c: any): any => {
      if (c.type === "input_text") return { text: c.text };
      // Base64 inline image → Gemini inline_data (the model actually sees the pixels)
      if (c.type === "input_image_inline") return { inline_data: { mime_type: c.mime_type, data: c.base64 } };
      // URL-only image → file_data (KIE Gemini proxy fetches the URL for Gemini)
      if (c.type === "input_image") return { file_data: { mime_type: "image/jpeg", file_uri: c.image_url } };
      return null;
    }).filter(Boolean);
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
    throw kieHttpError(resp.status, errText.slice(0, 400), "Gemini KIE");
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

const DAILY_PUBLISH_COST = 35;

const SYSTEM_PROMPT = `Ты — креативный frontend-разработчик мирового уровня. Генерируй полные HTML-документы.

⚡ ГЛАВНОЕ ПРАВИЛО — СВОБОДА И УНИКАЛЬНОСТЬ:
Ты — опытный дизайнер с собственным вкусом. НЕ используй шаблоны и заготовки.
Для каждого сайта придумай дизайн с нуля: цвета, шрифты, структуру, стиль анимаций — всё сам, исходя из темы.
Доверяй своей творческой интуиции. Удиви.

ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ:
- Полный HTML: <!DOCTYPE html>, <head> с <style>, <body>, <script> перед </body>
- Чистый HTML/CSS/JS — БЕЗ внешних CDN и библиотек
- 🚫 КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО подключать Tailwind, Bootstrap или любые другие CSS/JS-фреймворки через CDN (например cdn.tailwindcss.com, unpkg, jsdelivr) — они заблокированы в РФ и сайт сломается без VPN. Пиши ТОЛЬКО собственный CSS внутри <style>. (Google Fonts через fonts.googleapis.com — можно.)
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

СТРУКТУРА HERO (КРИТИЧНО — НАРУШЕНИЕ ЗАПРЕЩЕНО):
- HERO ОБЯЗАН ВСЕГДА содержать настоящую фоновую фотографию, сгенерированную через {{GENIMG:<промпт>|16:9}}. НИКОГДА не делай hero только на сплошном цвете или одном градиенте без фото — фото в hero обязательно.
- ЧИТАЕМОСТЬ ТЕКСТА — ГЛАВНОЕ: поверх hero-фото ВСЕГДА накладывай затемняющий градиент-оверлей, чтобы текст легко читался. Например: position:relative у контейнера, отдельный слой ::before или div с linear-gradient(rgba(0,0,0,.6), rgba(0,0,0,.35)) поверх фото (z-index ниже текста, выше фото). Для светлых дизайнов — свой оверлей под цвет бренда, но контраст текста к фону ОБЯЗАН быть высоким.
- ПРОМПТ для hero-фото составляй так, чтобы фото подходило под текст: добавляй в промпт "with darker moody areas and clean negative space for text overlay, not busy in the center, dramatic cinematic directional lighting" — чтобы в зоне заголовка фон был спокойным/тёмным и текст не терялся.
- Выбирай ОДИН layout (не один и тот же каждый раз):
  Вариант A: Центрированный — фоновое фото {{GENIMG}} на весь экран + затемняющий оверлей, текст по центру
  Вариант B: Раздельный — левая часть (55%) чистый цветной/градиентный фон + текст, правая часть (45%) большая фотография {{GENIMG}}
  Вариант C: Полноэкранное фото {{GENIMG}} — текст сверху/снизу на широкой градиентной подложке (НЕ узкий прямоугольник)

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

⚠️ ССЫЛКИ И ЯКОРЯ (КРИТИЧНО ДЛЯ РАБОЧЕЙ НАВИГАЦИИ):
- На index.html ссылки на секции пиши как якоря: href="#cases", href="#about" — плавный скролл внутри страницы.
- На ВСЕХ остальных страницах (about.html, contacts.html и т.д.) те же ссылки на секции ГЛАВНОЙ пиши как href="index.html#cases", href="index.html#about" — иначе на подстранице якорь ведёт в никуда.
- Ссылки на страницы — просто имя файла: href="about.html", href="contacts.html".
- Логотип в шапке: на index.html — href="#" или href="index.html"; на подстраницах — href="index.html" (клик по лого возвращает на главную).
- НЕ добавляй в меню пункт "Index"/"Главная" со ссылкой на сам файл index.html, если пользователь об этом не просил.

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
- НИКОГДА не рисуй объекты (товары, еду, пончики, людей, машины и т.п.) средствами CSS («нарисованный» из div-ов пончик/предмет, css-фигуры) вместо настоящего фото — рядом с реальными фото это смотрится как СЛОМАННАЯ/БИТАЯ картинка. Любой предмет/товар = ТОЛЬКО {{GENIMG}}.
- ПРАВИЛО ОДНОРОДНОСТИ СЕТКИ (главная причина «битых» сайтов): в любой сетке/ряду однотипных карточек (меню, товары, галерея, команда, портфолио) ВСЕ карточки ОБЯЗАНЫ иметь ОДИНАКОВЫЙ тип картинки — либо у ВСЕХ настоящее фото {{GENIMG}}, либо ни у одной. ЗАПРЕЩЕНО смешивать в одной сетке реальные фото с CSS-рисунками или градиентными заглушками. Если бюджета изображений не хватает на всю сетку — потрать его на ПОЛНЫЕ сетки целиком, а второстепенные одиночные блоки оформи чистой типографикой/цветом (без «битой» заглушки).
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
  4. КАЧЕСТВО (делай фото КИНЕМАТОГРАФИЧНЫМИ, а не «стоковыми»): всегда добавляй "editorial cinematic photography, dramatic directional lighting, shallow depth of field, rich filmic color grading, photorealistic, ultra high resolution, professional"

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

- КОЛИЧЕСТВО ИЗОБРАЖЕНИЙ: сам реши, сколько фото нужно сайту под его контент и секции, но строго в диапазоне НЕ МЕНЬШЕ 5 и НЕ БОЛЬШЕ 10 маркеров {{GENIMG:...}} на запрос (даже у простого сайта — минимум 5 настоящих фото). Не экономь на главном (hero, карточки товаров/меню). Если по смыслу фото нужно больше 10 — приоритет: (1) hero; (2) ВСЕ карточки главных сеток (меню/товары/галерея) — сетка ЦЕЛИКОМ, а не половина; (3) ключевые секции. Лучше покрыть реальными фото меньше секций, но ПОЛНОСТЬЮ, чем размазать по одной картинке и оставить сетки наполовину пустыми/«битыми». CSS-градиенты и inline SVG — ТОЛЬКО для абстрактного фона и декора, НИКОГДА вместо фото товара/контента.
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
Оборачивай формы в <form data-lead-form="имя_формы">.

НЕ добавляй прелоадер, splash-screen или loading-overlay — они не нужны для обычных сайтов.`;

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

async function enhancePromptOnly(query: string): Promise<{ enhancedPrompt: string; success: boolean; confirmedKieFailure?: boolean }> {
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
    return { enhancedPrompt: query, success: false, confirmedKieFailure: isConfirmedKieApiFailure(err) };
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

  try {
    // Deduplicate any legacy rows before creating the unique index
    await db.execute(sql`
      DELETE FROM project_files a USING project_files b
      WHERE a.id < b.id AND a.project_id = b.project_id AND a.filename = b.filename
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS project_files_project_id_filename_uniq
      ON project_files (project_id, filename)
    `);
  } catch (e: any) {
    console.warn("[boot] project_files unique index:", e?.message?.slice?.(0, 200) || e);
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS yc_storage_pools (
        id serial PRIMARY KEY,
        name text NOT NULL,
        cloud_id text NOT NULL,
        folder_id text NOT NULL,
        access_key_id text NOT NULL,
        secret_access_key text NOT NULL,
        bucket_count integer NOT NULL DEFAULT 0,
        bucket_limit integer NOT NULL DEFAULT 20,
        status text NOT NULL DEFAULT 'active',
        created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await db.execute(sql`
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS yc_storage_pool_id integer
    `);
  } catch (e: any) {
    console.warn("[boot] yc_storage_pools migrate:", e?.message?.slice?.(0, 200) || e);
  }

  // Bootstrap primary Object Storage pool from env (non-fatal if keys missing at boot).
  try {
    const { ensurePrimaryPoolBootstrapped } = await import("./yc-storage-pools");
    await ensurePrimaryPoolBootstrapped();
  } catch (e: any) {
    console.warn("[boot] yc storage pool bootstrap:", e?.message?.slice?.(0, 200) || e);
  }

  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const express = (await import("express")).default;
  app.use("/uploads", express.static(uploadsDir));

  registerObjectStorageRoutes(app);

  // --- Custom Domain Proxy ---
  // CDN edge nodes connect to craft-ai.ru with X-Custom-Domain: <custom-domain> header
  // (staticRequestHeaders configured on CDN resource per custom domain)
  // We proxy to the project's Yandex Object Storage bucket
  const OWN_HOSTS = new Set(["craft-ai.ru", "www.craft-ai.ru", "localhost"]);
  app.use(async (req, res, next) => {
    // CDN sends X-Custom-Domain header; fallback to Host for direct/legacy requests
    const xDomain = (req.headers["x-custom-domain"] || "").toString().toLowerCase().split(":")[0];
    const rawHost = xDomain || (req.headers["host"] || "").split(":")[0].toLowerCase();
    if (!rawHost || OWN_HOSTS.has(rawHost) || rawHost.includes("yandexcloud.net") || rawHost.startsWith("127.") || rawHost.startsWith("192.") || rawHost.startsWith("10.") || rawHost.includes("repl")) {
      return next();
    }
    let project: any;
    try {
      project = await storage.getProjectByCustomDomain(rawHost);
    } catch (e) {
      return next();
    }
    if (!project?.vercelProjectId) return next();
    const bucket = project.vercelProjectId as string;
    let filePath = req.path;
    if (filePath === "/" || filePath === "") filePath = "/index.html";
    // Guard against path traversal (e.g. /%2e%2e/other-bucket/...) — the WHATWG URL
    // parser normalizes dot segments, which would allow cross-bucket reads.
    if (/(^|[\\/])\.\.([\\/]|$)|%2e|%2f|%5c/i.test(filePath)) {
      res.status(400).send("Bad request");
      return;
    }
    // Responses vary by X-Custom-Domain (same URL path serves different projects) —
    // without Vary a shared cache could serve one project's content for another.
    res.setHeader("Vary", "X-Custom-Domain");
    const s3Url = `https://storage.yandexcloud.net/${bucket}${filePath}`;
    try {
      const upstream = await fetch(s3Url);
      if (!upstream.ok) {
        if (upstream.status === 404) {
          const indexResp = await fetch(`https://storage.yandexcloud.net/${bucket}/index.html`);
          if (indexResp.ok) {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "public, max-age=86400");
            res.send(Buffer.from(await indexResp.arrayBuffer()));
            return;
          }
        }
        res.status(upstream.status).send("Not found");
        return;
      }
      const contentType = upstream.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-Proxy-Origin", bucket);
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (e) {
      next(e);
    }
  });

  const ALLOWED_UPLOAD_MIMES: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp",
    "image/gif": "gif",
    // SVG deliberately excluded — executable on same origin as Craft AI
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
  const uploadLimiter = rateLimit("upload", { windowMs: 60_000, max: 30, keyGenerator: userOrIpKey, message: "Слишком много загрузок. Подождите минуту." });

  app.post("/api/upload-image", requireAuth, uploadLimiter, async (req, res) => {
    try {
      const { base64, mimeType, name } = req.body;
      if (!base64) return res.status(400).json({ message: "Нет данных файла" });
      const mime = (mimeType || "image/png").toLowerCase();
      if (mime.includes("svg")) {
        return res.status(400).json({ message: "SVG-загрузки отключены из соображений безопасности" });
      }
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

  app.post("/api/upload-file", requireAuth, uploadLimiter, upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ message: "Файл не прикреплён" });
      let mime = (file.mimetype || "").toLowerCase();
      if (mime.includes("svg")) {
        return res.status(400).json({ message: "SVG-загрузки отключены из соображений безопасности" });
      }
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
      // Delete from DB first so the user sees it gone immediately
      await storage.deleteProject(project.id);
      res.json({ message: "Проект удалён" });
      // Clean up Yandex Cloud resources in the background (non-blocking)
      // — removes CDN resource + DNS zone + certificate (if custom domain was set)
      // — empties and deletes the Object Storage bucket
      if (project.publishStatus && project.publishStatus !== "draft") {
        deleteProjectFromYandex(project.id, project.customDomain, project.ycStoragePoolId).catch((e) =>
          console.warn(`[delete] Yandex cleanup non-fatal for project ${project.id}:`, e?.message)
        );
      }
    } catch (err) {
      res.status(500).json({ message: "Ошибка удаления проекта" });
    }
  });

  app.get("/api/credits/history", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const txns = await storage.adminGetUserTransactions(user.id);
      const OP_LABELS: Record<string, string> = {
        generate: "Генерация сайта",
        image: "Изображение",
        "scroll-anim": "Видеоанимация",
        "scroll-world": "Погружение",
        "immersion-glass": "Погружение",
        "site3d-product": "3D",
        "motion-reveal": "Моушн",
        animational: "Анимационный",
        enhance: "Улучшение промпта",
        "deep-research": "Deep Research",
        "3d": "3D модель",
        refund: "Возврат",
        payment: "Пополнение",
        daily_publish: "Хостинг (день)",
        admin_add: "Начисление (админ)",
        admin_deduct: "Списание (админ)",
      };
      res.json(
        txns.slice(0, 100).map((t) => ({
          id: t.id,
          amount: t.amount,
          type: t.type,
          operation: t.operation,
          label: OP_LABELS[t.operation] || t.operation,
          note: t.note,
          createdAt: t.createdAt,
        })),
      );
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Ошибка загрузки истории" });
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
      const billed = !deduction.alreadyProcessed;
      try {
        const result = await enhancePromptOnly(prompt);
        if (result.success) {
          res.json({ enhancedPrompt: result.enhancedPrompt, creditsUsed: ENHANCE_COST, newBalance: deduction.newBalance });
        } else {
          await refundIfConfirmedKie(billed, user.id, ENHANCE_COST, ikey, !!result.confirmedKieFailure, "enhance");
          const bal = (await storage.getUser(user.id))?.credits ?? deduction.newBalance;
          res.json({ enhancedPrompt: prompt, creditsUsed: 0, newBalance: bal, warning: "AI временно недоступен, использован оригинальный промпт" });
        }
      } catch (inner: any) {
        await refundIfConfirmedKie(billed, user.id, ENHANCE_COST, ikey, inner, "enhance-catch");
        throw inner;
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
      const billed = !deduction.alreadyProcessed;
      try {
        const result = await deepResearch(prompt);
        if (result.success) {
          res.json({ research: result.research, creditsUsed: RESEARCH_COST, newBalance: deduction.newBalance });
        } else {
          if (billed) { try { await storage.refundCredits(user.id, RESEARCH_COST, ikey); } catch {} }
          const bal = (await storage.getUser(user.id))?.credits ?? deduction.newBalance;
          res.json({ research: "", creditsUsed: 0, newBalance: bal, warning: "Deep Research временно недоступен" });
        }
      } catch (inner: any) {
        if (billed) { try { await storage.refundCredits(user.id, RESEARCH_COST, ikey); } catch {} }
        throw inner;
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
    let genBilled = false;
    let generationCost = 0;
    let billedUserId: number | undefined;
    let genIkeyForRefund = "";
    let wroteGeneratingPlaceholder = false;
    let generateProjectId: number | undefined;
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) {
        return res.status(404).json({ message: "Проект не найден" });
      }
      const user = req.user as any;
      billedUserId = user.id;
      generateProjectId = project.id;
      if (project.userId !== user.id) {
        return res.status(403).json({ message: "Доступ запрещён" });
      }

      let clientGone = false;
      req.on("close", () => { clientGone = true; });
      // Never let a dead SSE socket abort the handler: wrap write/end so closed-socket
      // errors become no-ops. Generation must finish and persist even if the tab is closed.
      const _origWrite = res.write.bind(res);
      const _origEnd = res.end.bind(res);
      (res as any).write = function (chunk: any, encoding?: any, cb?: any) {
        try {
          if ((res as any).writableEnded || (res as any).destroyed) {
            if (typeof encoding === "function") encoding();
            else if (typeof cb === "function") cb();
            return true;
          }
          return _origWrite(chunk, encoding, cb);
        } catch {
          clientGone = true;
          if (typeof encoding === "function") encoding();
          else if (typeof cb === "function") cb();
          return true;
        }
      };
      (res as any).end = function (chunk?: any, encoding?: any, cb?: any) {
        try {
          if ((res as any).writableEnded || (res as any).destroyed) {
            if (typeof encoding === "function") encoding();
            else if (typeof cb === "function") cb();
            return res;
          }
          return _origEnd(chunk, encoding, cb);
        } catch {
          clientGone = true;
          if (typeof encoding === "function") encoding();
          else if (typeof cb === "function") cb();
          return res;
        }
      };

      const NEW_SITE_GENERATION_COST = 100;
      const EDIT_GENERATION_COST = 30;

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

      // Another generate is already running for this project (client may have disconnected).
      if (isCraftGeneratingHtml(project.generatedCode) && !isStaleCraftGenerating(project)) {
        return res.status(409).json({
          message: "Генерация уже идёт на сервере. Обновите страницу через минуту — сайт появится автоматически.",
          generating: true,
        });
      }

      // Capture history BEFORE saving the current prompt so we don't duplicate it
      // in conversationHistory + the active user message.
      const priorMessages = await storage.getProjectMessages(project.id);

      await storage.createProjectMessage({
        projectId: project.id,
        role: "user",
        content: prompt,
      });

      // Treat stale generating placeholders as empty so a retry counts as a new site.
      const isNewSite = !project.generatedCode || isCraftGeneratingHtml(project.generatedCode);
      const GENERATION_COST = isNewSite ? NEW_SITE_GENERATION_COST : EDIT_GENERATION_COST;

      const genIkey = idempotencyKey || `gen-${project.id}-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      genIkeyForRefund = genIkey;
      const genDeduction = await storage.deductCredits(user.id, GENERATION_COST, "generate", genIkey);
      if (!genDeduction.success) {
        return res.status(402).json({ message: `Не хватает токенов. Нужно ${GENERATION_COST}, у вас ${genDeduction.newBalance}.`, newBalance: genDeduction.newBalance });
      }
      const genBilledFlag = !genDeduction.alreadyProcessed;
      genBilled = genBilledFlag;
      generationCost = GENERATION_COST;

      const reqProto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
      const reqHost = req.get("host") || "";
      const baseUrl = process.env.APP_BASE_URL || (reqHost ? `${reqProto}://${reqHost}` : "https://craft-ai.ru");

      const projectImgs = await storage.getProjectImages(project.id);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Persist a generating placeholder ASAP so reload/disconnect can poll the project
      // until the real HTML is written. Edits keep the previous site visible in DB.
      if (isNewSite) {
        try {
          await storage.updateProject(project.id, {
            generatedCode: craftGeneratingPlaceholderHtml(prompt),
          });
          wroteGeneratingPlaceholder = true;
        } catch (e: any) {
          console.warn("[GENERATE] failed to write generating placeholder:", e?.message);
        }
      }

      let researchData = deepResearchData || "";

      let enhancedPrompt = prompt;

      if (isNewSite) {
        res.write(`data: ${JSON.stringify({ status: "Генерируем сайт...", generating: true })}\n\n`);
      }

      let systemContent = SYSTEM_PROMPT;
      const isAnimationalMode = !!(interactiveMode && isNewSite && interactiveStyle === "animational");
      if (isAnimationalMode) {
        // Full replace — own prompt, no master SYSTEM_PROMPT / interactive SCROLLANIM rules.
        systemContent = ANIMATIONAL_SYSTEM_PROMPT;
      }
      if (researchData) {
        systemContent += `\n\n═══ РЕЗУЛЬТАТЫ DEEP RESEARCH ═══\nИспользуй следующие РЕАЛЬНЫЕ факты и данные из исследования при создании контента сайта:\n${researchData}\n═══ КОНЕЦ ИССЛЕДОВАНИЯ ═══\n`;
      }
      if (!isAnimationalMode && multiPagesData && typeof multiPagesData === "string" && multiPagesData.trim()) {
        const pageList = multiPagesData.split(",").map((p: string) => p.trim()).filter(Boolean);
        const fileNames = pageList.map((p: string) => {
          const slug = p.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
          return `${slug}.html (${p})`;
        });
        systemContent += `\n\n═══ СТРУКТУРА САЙТА ═══\nСоздай МНОГОСТРАНИЧНЫЙ сайт. ОБЯЗАТЕЛЬНО сгенерируй ВСЕ перечисленные страницы:\n- index.html (главная)\n- ${fileNames.join("\n- ")}\nКаждая страница — полный отдельный HTML-документ. В навигации всех страниц должны быть ссылки на ВСЕ страницы. Используй формат --- FILE: имя.html --- для каждого файла.\n\n⚠️ HEADER/FOOTER: Сначала создай полный <header> и <footer> для index.html, затем СКОПИРУЙ ИХ ДОСЛОВНО во все остальные файлы. Все кнопки, ссылки и стили навбара и футера должны быть ИДЕНТИЧНЫ на каждой странице. Отличается только класс/стиль активной ссылки.\n⚠️ ЯКОРЯ: на index.html секции — href="#section"; на подстраницах те же ссылки на секции главной — href="index.html#section"; ссылки на страницы — href="имя.html"; логотип на подстраницах — href="index.html". НЕ добавляй пункт меню "Index".\n═══ КОНЕЦ СТРУКТУРЫ ═══\n`;
      } else {
        systemContent += `\n\n⚠️ ОДНОСТРАНИЧНЫЙ РЕЖИМ: Создай ОДИН файл index.html. ЗАПРЕЩЕНО использовать маркеры --- FILE: --- или разбивать на несколько файлов. Весь сайт — один HTML-документ.`;
      }
      if (interactiveMode && isNewSite && !isAnimationalMode) {
        const isSplitLayout = interactiveStyle === "split";
        const hasProductImage = !!absoluteProductImageUrl;
        if (isSplitLayout) {
          systemContent += `\n\n🚨🚨🚨 ОБЯЗАТЕЛЬНОЕ ТРЕБОВАНИЕ — БЕЗ ВЫПОЛНЕНИЯ ОТВЕТ НЕВЕРЕН 🚨🚨🚨
═══ РЕЖИМ «ИНТЕРАКТИВНЫЙ — СПЛИТ» ═══
Этот сайт ОБЯЗАН содержать специальный маркер {{SCROLLANIM:...}}. Если маркер отсутствует — сайт не будет работать.

ЕДИНСТВЕННОЕ ТРЕБОВАНИЕ К СТРУКТУРЕ HTML:
→ СРАЗУ после закрывающего тега </header> (на отдельной строке, ДО любых других секций) вставь:
{{SCROLLANIM:ВИДЕО-ПРОМПТ|Заголовок1::Подзаголовок1||Заголовок2::Подзаголовок2||Заголовок3::Подзаголовок3}}

Формат ВИДЕО-ПРОМПТА для сплит-режима (на английском). Придумай КИНЕМАТОГРАФИЧНУЮ сцену под товар с ВАУ-эффектом — НЕ «вращение 360». Движение ОБЯЗАНО быть заметным и развиваться (зритель сам прокручивает видео скроллом — еле заметное движение выглядит сломанным и унылым): объедини медленный кинематографичный наезд камеры (push-in) + 1 яркий эффект по смыслу товара, который реально движется (крем — блики и лучи света расходятся, капля стекает; парфюм — дымка клубится и блик-радуга скользит по стеклу; часы — луч света бежит по циферблату, искры; напиток — капли конденсата стекают, поднимаются пузырьки). Товар СПРАВА, левая половина — чистый однотонный матовый фон под текст; ВСЕ эффекты держи СПРАВА у товара, камера только лёгкий push-in (5-8%) без панорам, наклонов и отъезда:
"${hasProductImage ? "the product" : "PRODUCT_NAME"} on the right third of frame, <яркий кинематографичный эффект, который реально движется>, slow cinematic camera push-in, left half clean solid matte background, dramatic premium lighting, cinematic, no text, no watermark"
Примеры:
- "premium skincare cream jar on the right third, a glistening serum drop slides down and luminous light rays bloom across the dewy surface, slow cinematic camera push-in, left half clean ivory background, dramatic premium lighting, cinematic macro"
- "luxury glass water bottle on the right third, fresh condensation beads form and run down while light glints travel across the glass, slow cinematic camera push-in, left half clean white background, dramatic premium lighting, cinematic"

Тексты — РОВНО 3 пары на РУССКОМ (Заголовок::Подзаголовок), короткие и продающие.

⚠️ НЕ пиши <section> или Hero-раздел ДО этого маркера. Маркер И ЕСТЬ Hero.
⚠️ НЕ создавай canvas-код вручную. Маркер заменяется автоматически системой.
⚠️ После маркера — обычные секции: преимущества, отзывы, CTA, форма, футер.
🚨 ПРОВЕРЬ перед отправкой: маркер {{SCROLLANIM:...}} должен присутствовать в HTML.
═══ КОНЕЦ СПЛИТ-РЕЖИМА ═══\n`;
        } else if (interactiveStyle === "action") {
          systemContent += `\n\n🚨🚨🚨 ОБЯЗАТЕЛЬНОЕ ТРЕБОВАНИЕ — БЕЗ ВЫПОЛНЕНИЯ ОТВЕТ НЕВЕРЕН 🚨🚨🚨
═══ РЕЖИМ «ИНТЕРАКТИВНЫЙ — ЭКШН» (голливудский блокбастер) ═══
Этот сайт ОБЯЗАН содержать специальный маркер {{SCROLLANIM:...}}. Если маркер отсутствует — сайт не будет работать.

ЕДИНСТВЕННОЕ ТРЕБОВАНИЕ К СТРУКТУРЕ HTML:
→ СРАЗУ после закрывающего тега </header> (или сразу после <body> если нет header) на отдельной строке вставь:
{{SCROLLANIM:VIDEO_PROMPT_IN_ENGLISH|Заголовок1::Подзаголовок1||Заголовок2::Подзаголовок2||Заголовок3::Подзаголовок3}}

VIDEO_PROMPT (на английском) — ты РЕЖИССЁР голливудского ЭКШН-блокбастера и ставишь САМЫЙ эффектный кадр фильма. Придумай ОДИН взрывной кинокадр под нишу сайта, который при скролле смотрится как сцена из дорогого боевика.

🚨 КРИТИЧЕСКИ ВАЖНО: внутри сцены ДОЛЖНО что-то физически ПРОИСХОДИТЬ — это не просто облёт камерой статичного объекта! Опиши момент, когда действие УЖЕ В ПОЛНОМ РАЗГАРЕ: объект уже разлетается/разбивается/взрывается, частицы/осколки/искры/брызги/пыль уже висят в воздухе или летят, жидкость уже расплёскивается, поверхность уже трескается. Камера (облёт по дуге, bullet-time) — это ДОПОЛНЕНИЕ к происходящему в кадре, а не замена ему. Если в промпте нет конкретного физического события с объектом — считай задание невыполненным.

Думай приёмами большого кино: BULLET-TIME (время будто застыло), СЛОУ-МО (замедленная съёмка), камера ОБЛЕТАЕТ объект по дуге/орбите, ПОКА что-то эффектно РАЗЛЕТАЕТСЯ / РАЗБИВАЕТСЯ / ВЗРЫВАЕТСЯ, частицы, осколки, искры, брызги и пыль зависают в воздухе или продолжают лететь, анаморфные блики, моушн-блюр, глубокий драматичный контраст. Движение мощное, заметное и развивается по всему ролику — и в самом объекте, и в камере (зритель сам прокручивает кадры скроллом — вялое движение убивает эффект). Адаптируй идею ПОД КОНКРЕТНУЮ НИШУ — эффектно для ЛЮБОГО бизнеса. Оставь зону поспокойнее, где ляжет крупный текст (он накладывается поверх и подсвечивается автоматически). Пиши развёрнуто, ТОЛЬКО запятые (без | :: и фигурных скобок):
- Авто: "epic slow-motion bullet-time shot orbiting a luxury sports car as it powerslides through exploding clouds of dust and sparks, debris frozen mid-air, sweeping anamorphic lens flares, dramatic high-contrast lighting, photorealistic cinematic"
- Ресторан/еда: "ultra slow-motion macro of a gourmet burger assembling in mid-air as fresh ingredients and droplets float and the camera arcs around it, seasoning sparks suspended, dramatic studio lighting, mouth-watering cinematic"
- Спорт/фитнес: "explosive slow-motion bullet-time shot circling an athlete mid-jump, sweat droplets and chalk dust frozen in the air as the camera flies around in a full arc, dramatic stadium lighting, epic cinematic"
- Ювелирка/часы: "cinematic bullet-time orbit around a diamond ring as a glass pane shatters into glittering shards suspended in slow motion, light beams igniting rainbow sparkles, deep luxurious shadows, photorealistic"
- Стройка/техника: "powerful slow-motion camera flight around heavy machinery as concrete dust and sparks burst and hang frozen in the air, dramatic golden volumetric light, epic blockbuster cinematic"
- Косметика/продукт: "slow-motion bullet-time orbit around the product as a splash of liquid and petals explode outward and freeze mid-air while the camera arcs around it, luminous beams and sparkles, dramatic premium lighting, cinematic macro"
- Общее/услуги: "epic cinematic bullet-time shot orbiting the themed subject as particles, debris and light streaks burst and freeze in slow motion, the camera flying around in a dramatic arc, IMAX-grade blockbuster lighting, photorealistic"

Тексты — РОВНО 3 пары на РУССКОМ (Заголовок::Подзаголовок), короткие и мощные, в духе кино-трейлера.

⚠️ НЕ пиши <section> или Hero-раздел ДО этого маркера. Маркер И ЕСТЬ Hero.
⚠️ НЕ создавай canvas-код вручную. Маркер заменяется автоматически системой.
🚨 ПРОВЕРЬ перед отправкой: маркер {{SCROLLANIM:...}} должен присутствовать в HTML.
═══ КОНЕЦ ЭКШН-РЕЖИМА ═══\n`;
        } else if (interactiveStyle === "site3d") {
          systemContent += `\n\n🚨🚨🚨 ОБЯЗАТЕЛЬНОЕ ТРЕБОВАНИЕ — БЕЗ ВЫПОЛНЕНИЯ ОТВЕТ НЕВЕРЕН 🚨🚨🚨
═══ РЕЖИМ «ИНТЕРАКТИВНЫЙ — 3D» (product-hero cinematic + glass site) ═══
Этот сайт ОБЯЗАН содержать специальный маркер {{SCROLLANIM:...}}. Если маркер отсутствует — сайт не будет работать.

РАЗДЕЛЕНИЕ РОЛЕЙ (это НЕ «Погружение»):
→ ПАЙПЛАЙН заменяет маркер на ОДНО кинематографичное Kling-видео (12 сек) ПРОДУКТА на чёрном void: камера орбитирует / наезжает, во второй половине — явный scroll-payoff (лёд трескается, слои расходятся, продукт крутится, материал раскрывается). Видео = фиксированный фон всего сайта, scrub по скроллу. Если пользователь загрузил фото продукта — оно станет якорем клипа.
→ ТЫ пишешь полноценный сайт клиента ПОВЕРХ: минимальный chrome бренда, giant-type атмосферу даёт система, ниже — glass-секции.

СТРУКТУРА HTML:
1) #site-preloader, затем <header> с логотипом БРЕНДА КЛИЕНТА (не Craft AI), минимальное меню, CTA. Шапка прозрачная/glass поверх чёрного void.
2) СРАЗУ после </header> на отдельной строке:
{{SCROLLANIM:VIDEO_PROMPT_IN_ENGLISH|HeroЗаголовок::HeroПодзаголовок}}
3) ПОСЛЕ маркера — полный контент: преимущества, продукт, отзывы, CTA, форма (если разрешена), футер. Секции с ПРОЗРАЧНЫМ фоном. Карточки — liquid glass:
   background: rgba(255,255,255,0.08–0.14); backdrop-filter: blur(16–24px); border: 1px solid rgba(255,255,255,0.18); border-radius: 20–28px; светлый текст.

VIDEO_PROMPT (английский) — ОДИН product-hero клип на PURE BLACK / dark void (НЕ интерьер, НЕ полёт по миру бренда): product centered, studio rim light, second-half payoff. ТОЛЬКО запятые, без | :: {}. Примеры:
- Напиток/банка: "photorealistic beverage can encased in jagged translucent ice on pure black void, slow cinematic orbit, ice cracks and refracts in the second half, trapped air bubbles, studio rim light, commercial product hero"
- Косметика: "premium skincare bottle centered on pure black, slow push-in then gentle orbit, liquid splash and light sweep payoff in the second half, glossy reflections, photorealistic beauty commercial"
- Гаджет: "sleek device floating on pure black void, cinematic orbit revealing materials, second half unfolds a soft light-sweep material reveal, premium tech commercial, photorealistic"
- Еда: "signature food product centered on pure black, bold camera arc, second half layers separate or ingredients lift in hypermotion, studio lighting, mouth-watering commercial"
- Общее: "hero product centered on pure black void, cinematic orbit and push-in, second half clear scroll payoff transforming the product, studio rim light, photorealistic commercial"

Тексты в маркере — 1–2 пары на РУССКОМ (короткий мощный Hero::подзаголовок). Основной контент — секции ПОСЛЕ маркера.

⚠️ НЕ пиши Hero <section> ДО маркера. Маркер даёт 3D product video + hero glass.
⚠️ НЕ создавай video/canvas/WebGL код вручную.
⚠️ НЕ описывай environment fly-through / villa / office — только продукт на чёрном.
⚠️ ЗАПРЕЩЕНО плотные непрозрачные фоны секций, которые закрывают видео.
🚨 ПРОВЕРЬ: маркер {{SCROLLANIM:...}} есть; после него — glass-секции; в шапке — бренд клиента.
═══ КОНЕЦ РЕЖИМА 3D ═══\n`;
        } else if (interactiveStyle === "motion") {
          systemContent += `\n\n🚨🚨🚨 ОБЯЗАТЕЛЬНОЕ ТРЕБОВАНИЕ — БЕЗ ВЫПОЛНЕНИЯ ОТВЕТ НЕВЕРЕН 🚨🚨🚨
═══ РЕЖИМ «ИНТЕРАКТИВНЫЙ — МОУШН» (WebGL hover-reveal под ЛЮБУЮ нишу) ═══
Этот сайт ОБЯЗАН содержать специальный маркер {{SCROLLANIM:...}}. Если маркер отсутствует — сайт не будет работать.

Ты — креативный арт-директор. Сначала ПОЙМИ нишу сайта из запроса пользователя (ресторан, стройка, клиника, недвижимость, авто, юристы, кофейня, спортзал, школа, салон, IT и т.д.). Затем придумай ПАРУ ЯРКИХ ЦВЕТНЫХ кадров «состояние A → состояние B», которая именно для ЭТОЙ ниши выглядит вау при наведении курсора. ОБА кадра в ПОЛНОМ ЦВЕТЕ (НЕ чёрно-белые). Это НЕ обязательно портрет человека и НЕ шлем/маска — субъект может быть блюдом, интерьером, зданием, инструментом, улыбкой, машиной, упаковкой, рабочим местом — чем угодно, что продаёт нишу.

ЕДИНСТВЕННОЕ ТРЕБОВАНИЕ К СТРУКТУРЕ HTML:
→ СРАЗУ после закрывающего тега </header> (или сразу после <body> если нет header) на отдельной строке вставь:
{{SCROLLANIM:BASE_SCENE_IN_ENGLISH /// REVEAL_SCENE_IN_ENGLISH|Блок1::Текст1||Блок2::Текст2||Блок3::Текст3||Блок4::Текст4}}

Формат ENGLISH-части ОБЯЗАТЕЛЬНО с разделителем " /// " (пробел-три-слэша-пробел):
- СЛЕВА от /// — базовый ЦВЕТНОЙ кадр: конкретная сцена ниши, композиция, субъект, свет, атмосфера (full color)
- СПРАВА от /// — reveal ЦВЕТНОЙ кадр: ТА ЖЕ композиция/ракурс/субъект, но другое настроение/состояние — день↔ночь, спокойствие↔энергия, до↔после услуги, холодный↔тёплый свет, raw↔premium finish
Пиши развёрнуто, ТОЛЬКО запятые внутри каждой половины (без | :: и фигурных скобок). Обе половины — про ОДНУ и ту же сцену, ОБЕ в цвете. ЗАПРЕЩЕНО писать black and white / monochrome / grayscale.

Примеры под разные ниши (адаптируй под КОНКРЕТНЫЙ бренд пользователя, не копируй слепо):
- Ресторан: "gourmet plated signature dish on dark slate, rising steam, warm candlelight, rich food colors, tight cinematic framing /// same dish and camera angle at brighter golden hour, golden oil sheen, vibrant herbs, festive fine-dining commercial glow"
- Кофейня: "artisan latte in ceramic cup on wooden bar at dawn, soft cool window light, muted morning tones, cafe editorial /// same cup and framing in rich warm afternoon color, crema glow, sunlit espresso machine bokeh, premium coffee brand campaign"
- Стройка/ремонт: "modern construction site with crane at blue hour, cool concrete tones, industrial cinematic color /// same site and angle in golden hour, sparks and warm concrete, vivid contractor commercial energy"
- Недвижимость: "grand modern villa facade at blue hour twilight, cool glass reflections, luxury architecture photo in color /// same villa and camera angle at golden hour, warm interior lights glowing through glass, sunset real-estate campaign"
- Клиника/стоматология: "confident close-up smile in soft cool clinic light, clean medical beauty color editorial /// same smile and framing with warmer luminous healthy glow, soft spa ambience, premium healthcare brand"
- Автосервис/авто: "luxury car three-quarter view in moody garage, deep teal ambient light, glossy paint already in color /// same car and angle with brighter rim light streaks, richer paint pop, premium auto commercial energy"
- Салон красоты: "elegant hairstyle portrait in salon chair, soft glam color, muted rose lighting /// same pose and framing with richer hair color shine, brighter glam lighting, beauty brand metamorphosis"
- Фитнес: "athlete mid-pose in gym, cool stadium light, vivid sports color photography /// same pose and framing with warmer sweat glow, energetic neon accents, fitness brand campaign"
- Юристы/услуги: "premium office desk with leather folder and city skyline dusk bokeh, refined cool color /// same desk and framing at golden hour, warm brass accents, trustworthy luxury firm campaign"
- IT/SaaS: "minimal workspace with laptop and soft interface glow, cool blue color tech editorial /// same desk and framing with luminous richer UI reflections, brighter accent lights, modern software brand"
- Цветы/подарки: "bouquet of roses on marble in soft daylight, natural petal colors /// same bouquet and angle under romantic evening light, deeper petal saturation, dewdrops, luxury floral campaign"

Тексты — РОВНО 4 пары на РУССКОМ (Заголовок::Подзаголовок): короткие мощные фразы под нишу (оффер → характер → выгода → CTA).

После маркера — обычные секции сайта под эту нишу (преимущества, отзывы, CTA, форма, футер).

⚠️ НЕ пиши <section> или Hero-раздел ДО этого маркера. Маркер И ЕСТЬ Hero.
⚠️ НЕ создавай canvas/WebGL-код вручную. Маркер заменяется автоматически системой (пара цветных кадров под нишу + fluid mouse reveal).
⚠️ НЕ своди всё к портрету со шлемом — думай как арт-директор бренда ЭТОЙ ниши.
⚠️ НЕ делай базовый кадр чёрно-белым — оба кадра цветные и яркие.
🚨 ПРОВЕРЬ перед отправкой: маркер {{SCROLLANIM:...}} должен присутствовать в HTML и содержать " /// ".
═══ КОНЕЦ РЕЖИМА МОУШН ═══\n`;
        } else if (interactiveStyle === "immersion") {
          systemContent += `\n\n🚨🚨🚨 ОБЯЗАТЕЛЬНОЕ ТРЕБОВАНИЕ — БЕЗ ВЫПОЛНЕНИЯ ОТВЕТ НЕВЕРЕН 🚨🚨🚨
═══ РЕЖИМ «ИНТЕРАКТИВНЫЙ — ПОГРУЖЕНИЕ» (threshold fly-through + glass site) ═══
Этот сайт ОБЯЗАН содержать специальный маркер {{SCROLLANIM:...}}. Если маркер отсутствует — сайт не будет работать.

РАЗДЕЛЕНИЕ РОЛЕЙ:
→ ПАЙПЛАЙН заменяет маркер на ОДНО кинематографичное Kling-видео (12 сек) с эффектом ПОГРУЖЕНИЯ: фиксированный фон всего сайта, scrub по скроллу.
→ ТЫ пишешь полноценный сайт клиента ПОВЕРХ: шапка бренда, glass-секции, футер.

ОБЯЗАТЕЛЬНАЯ СТРУКТУРА ВИДЕО (придумай под ЛЮБУЮ нишу пользователя):
1) СТАРТОВЫЙ КАДР — порог / портал / рама, сквозь которую смотрит зритель:
   окно самолёта, дверь, арка, витрина, тоннель, балкон, лифт, пещера, иллюминатор, рамка ворот — выбери то, что логично для ниши.
2) ДАЛЬШЕ камера НЕПРЕРЫВНО летит ВПЕРЁД СКВОЗЬ этот порог в расширяющийся мир бренда
   (облака, интерьер, природа, цех, зал, город — по смыслу ниши), с parallax и сменой света.
3) Это НЕ орбита вокруг продукта на чёрном фоне и НЕ статичная студия. Это POV-погружение «сквозь → внутрь».

СТРУКТУРА HTML:
1) #site-preloader, затем <header> с логотипом БРЕНДА КЛИЕНТА (не Craft AI), меню по якорям, CTA. Шапка: glass / прозрачная поверх видео.
2) СРАЗУ после </header> на отдельной строке:
{{SCROLLANIM:VIDEO_PROMPT_IN_ENGLISH|HeroЗаголовок::HeroПодзаголовок}}
3) ПОСЛЕ маркера — полный контент: преимущества, услуги, отзывы, CTA, форма (если разрешена), футер. Секции с ПРОЗРАЧНЫМ фоном. Карточки — glass:
   background: rgba(255,255,255,0.08–0.16); backdrop-filter: blur(16–24px); border: 1px solid rgba(255,255,255,0.18); border-radius: 20–28px; светлый текст.

VIDEO_PROMPT (английский) — ОДИН continuous fly-through: START at threshold → fly THROUGH into the world. ТОЛЬКО запятые, без | :: {}. Примеры (адаптируй под нишу пользователя, не копируй слепо):
- Путешествия/авиа: "looking out an airplane oval window at layered clouds at golden hour, the camera glides forward through the window frame into open sky and soft cloud canyons, continuous POV immersion flight, volumetric sunbeams, photorealistic cinematic"
- Кофейня: "looking through a rain-speckled cafe window into a warm artisan roastery, the camera pushes through the glass into steaming cups and wooden counters then deeper toward glowing roasting drums, continuous immersion dolly, photorealistic"
- Недвижимость: "standing before tall glass villa doors at golden hour, the camera flies through the opening doors into a luminous living room and out toward a panoramic terrace sea view, continuous immersion flight, photorealistic"
- Спа/косметика: "looking through frosted spa doorway framed by botanicals, the camera drifts through into marble halls, soft steam and a serene treatment suite, continuous immersion push, photorealistic beauty film"
- Фитнес: "looking through gym entrance glass at blue-hour neon, the camera flies through into a vast training floor with dynamic lights and motion blur athletes in depth, continuous immersion flight, photorealistic"
- IT/SaaS: "looking through a dark server-hall threshold with cool LED glow, the camera flies through corridors of light into a luminous glass office overlooking a night city, continuous immersion dolly, photorealistic"
- Ресторан: "looking through a candlelit restaurant doorway, the camera glides through into an open kitchen with rising steam and a chef plating, then toward a warm dining room, continuous immersion flight, photorealistic"
- Общее под любую нишу: "looking through a symbolic threshold that fits the brand niche, the camera continuously flies forward through it into the expanding brand world with deep parallax and evolving light, POV immersion, photorealistic cinematic"

Тексты в маркере — 1–2 пары на РУССКОМ (Hero::подзаголовок). Основной контент — секции ПОСЛЕ маркера.

⚠️ НЕ пиши Hero <section> ДО маркера. Маркер даёт видео-фон + hero-glass.
⚠️ НЕ создавай video/canvas код вручную.
⚠️ НЕ пиши product-on-black / orbit around product — это режим 3D, не Погружение.
⚠️ ЗАПРЕЩЕНО плотные непрозрачные фоны секций, которые полностью закрывают видео.
🚨 ПРОВЕРЬ: маркер {{SCROLLANIM:...}} есть; промпт начинается с порога и пролёта сквозь; после маркера — glass-секции; в шапке — бренд клиента.
═══ КОНЕЦ РЕЖИМА ПОГРУЖЕНИЕ ═══\n`;
        } else {
          systemContent += `\n\n🚨🚨🚨 ОБЯЗАТЕЛЬНОЕ ТРЕБОВАНИЕ — БЕЗ ВЫПОЛНЕНИЯ ОТВЕТ НЕВЕРЕН 🚨🚨🚨
═══ РЕЖИМ «ИНТЕРАКТИВНЫЙ» — СКРОЛЛ-АНИМАЦИЯ ═══
Этот сайт ОБЯЗАН содержать специальный маркер {{SCROLLANIM:...}}. Если маркер отсутствует — сайт не будет работать.

ЕДИНСТВЕННОЕ ТРЕБОВАНИЕ К СТРУКТУРЕ HTML:
→ СРАЗУ после закрывающего тега </header> (или сразу после <body> если нет header) на отдельной строке вставь:
{{SCROLLANIM:VIDEO_PROMPT_IN_ENGLISH|Заголовок1::Подзаголовок1||Заголовок2::Подзаголовок2||Заголовок3::Подзаголовок3}}

VIDEO_PROMPT (на английском) — ты КИНОРЕЖИССЁР голливудского уровня. Придумай ЯРКУЮ, СМЕЛУЮ, полноценную КИНОСЦЕНУ под нишу сайта, которая при скролле создаёт эффект ПОГРУЖЕНИЯ (НЕ «вращение 360», НЕ скучный однотонный фон). Фон — это НАСТОЯЩАЯ киносцена/окружение под нишу (вилла, цех, витрина, студия, природа, зал), а не плоский цвет. Движение ОБЯЗАНО быть заметным и развиваться по ходу видео (зритель сам прокручивает кадры — еле заметное движение выглядит унылым): объедини СМЕЛОЕ движение камеры ВГЛУБЬ сцены (плавный пролёт/наезд вперёд, который втягивает зрителя внутрь и раскрывает глубину) + живое действие в кадре по смыслу ниши. Думай КРЕАТИВНО под конкретную нишу. Сцену делай с чуть более спокойной зоной, где ляжет крупный текст (он накладывается поверх и подсвечивается автоматически). Пиши развёрнуто, ТОЛЬКО запятые (без | :: и фигурных скобок):
- Недвижимость/вилла: "cinematic approach to a grand modern villa at golden hour, the camera glides forward toward tall glass doors that slowly swing open revealing a luxurious sunlit living room, warm light spilling out, soft dust motes drifting, volumetric god rays, epic film-still lighting, photorealistic"
- Стройка/ремонт: "sweeping cinematic forward move over a sunlit modern construction site, cranes turning and golden light shifting across fresh concrete and glass, drifting dust catching the light, dramatic volumetric lighting, photorealistic"
- Ювелирка: "extreme macro dolly-in toward a diamond ring on black velvet, facets igniting with travelling rainbow sparkles as a beam of light sweeps across, deep luxurious shadows, slow cinematic push-in, photorealistic"
- Ресторан/еда: "cinematic dolly-in across an elegant plated dish, ribbons of steam rising and curling, fresh herbs gently falling, warm candlelight flickering, shallow depth of field, mouth-watering film-still lighting"
- Авто: "low cinematic tracking push-in toward a luxury car in a dark studio, light streaks sweeping along the glossy bodywork, reflections igniting, subtle mist drifting on the floor, dramatic high-contrast lighting, photorealistic"
- Косметика/крем: "luxury skincare jar in a soft elegant setting, a delicate butterfly gently lands on the lid while luminous light rays bloom and a glistening drop slides down, slow cinematic push-in, rich dramatic lighting, cinematic macro"
- Природа/услуги/общее: "breathtaking cinematic forward flight into the themed scene, volumetric god rays and drifting atmospheric haze, the camera revealing depth and grandeur, epic film-still lighting, photorealistic"

Тексты — РОВНО 3 пары на РУССКОМ (Заголовок::Подзаголовок), короткие и продающие.

⚠️ НЕ пиши <section> или Hero-раздел ДО этого маркера. Маркер И ЕСТЬ Hero.
⚠️ НЕ создавай canvas-код вручную. Маркер заменяется автоматически системой.
🚨 ПРОВЕРЬ перед отправкой: маркер {{SCROLLANIM:...}} должен присутствовать в HTML.
═══ КОНЕЦ ИНТЕРАКТИВНОГО РЕЖИМА ═══\n`;
        }
        systemContent += `\n\n═══ ШАПКА / ВЕРХНЕЕ МЕНЮ (ОБЯЗАТЕЛЬНО для интерактивного сайта) ═══
Видео-анимация занимает весь экран сразу под шапкой. ПОКА ИДЁТ АНИМАЦИЯ шапка НЕ должна быть видна как плашка — никакого фона, блюра, границы или тени, иначе она портит эффект анимации. Шапка должна быть ПОЛНОСТЬЮ ПРОЗРАЧНОЙ: видны только логотип и пункты меню, «парящие» поверх видео. Цветной (заметный) вид шапка получает ТОЛЬКО после того, как пользователь полностью пролистал анимацию.

КАК ЭТО РАБОТАЕТ: система САМА автоматически добавляет класс \`craft-anim-passed\` на <body>, когда анимация полностью прокручена. Используй ЭТОТ класс, чтобы «включить» цветную шапку. НЕ пиши свой JS для отслеживания скролла шапки.

ПРАВИЛА (соблюдай ТОЧНО):
1. <header> с position:fixed; top:0; left:0; right:0; z-index:1000; и ОБЯЗАТЕЛЬНО transition:background .45s ease, backdrop-filter .45s ease, border-color .45s ease, box-shadow .45s ease;.
2. БАЗОВОЕ состояние (во время анимации) — АБСОЛЮТНО ПРОЗРАЧНОЕ: background:transparent; backdrop-filter:none; -webkit-backdrop-filter:none; border:none; box-shadow:none. НИКАКОЙ подложки, блюра, границы или тени. Это критично — иначе анимация выглядит испорченной.
3. ЦВЕТНОЕ состояние — задаётся ТОЛЬКО через селектор \`body.craft-anim-passed header\`: здесь дай шапке настоящий фирменный фон (плотный фон бренда ИЛИ насыщенный glassmorphism с backdrop-filter:blur), тонкую нижнюю границу и мягкую тень. Именно это состояние «появляется в цвете», когда анимация пролистана.
4. Логотип и пункты меню должны быть читаемы в ОБОИХ состояниях: поверх видео — светлые с лёгкой тенью (text-shadow:0 1px 12px rgba(0,0,0,0.4)) для ТЁМНОЙ анимации или тёмные для СВЕТЛОЙ; в цветном состоянии — подходящие под выбранный фон шапки (при необходимости меняй цвет текста тоже через \`body.craft-anim-passed header ...\`).
5. CTA-кнопку в шапке во время анимации делай ЛЁГКОЙ (прозрачный фон + бордер 1px, outline-стиль), без массивной заливки; в цветном состоянии (\`body.craft-anim-passed\`) можешь сделать её фирменной.
6. Компактная высота (padding по вертикали 14–18px). На мобильных — аккуратное бургер-меню.
7. Секции ПОСЛЕ анимации должны иметь собственный фон, чтобы фиксированная цветная шапка читалась над ними.
═══ КОНЕЦ ШАПКИ ═══\n`;
        systemContent += `\n\n═══ ПРЕЛОАДЕР САЙТА (ОБЯЗАТЕЛЬНО) ═══
Этот сайт содержит тяжёлую видео-анимацию, которая грузится не мгновенно. Чтобы посетитель не увидел пустой/чёрный экран, добавь УНИКАЛЬНЫЙ полноэкранный прелоадер.

ПРАВИЛА:
1. Самым ПЕРВЫМ элементом внутри <body> (до <header> и до маркера {{SCROLLANIM}}) вставь РОВНО ОДИН прелоадер:
   <div id="site-preloader"> ... твоя авторская анимация загрузки ... </div>
   ⚠️ id ОБЯЗАН быть РОВНО "site-preloader" (строчными, через дефис) — по нему система автоматически и плавно скрывает прелоадер. Назовёшь иначе (preloader, loader, intro, splash, hero-intro и т.п.) — прелоадер НЕ исчезнет и навсегда закроет сайт.
   ⚠️ НЕ создавай НИКАКИХ других полноэкранных заставок / intro / splash / cover-экранов поверх контента — только этот единственный #site-preloader. Любой второй полноэкранный оверлей зависнет.
2. Прелоадер ДОЛЖЕН быть УНИКАЛЬНЫМ и идеально соответствовать стилю ИМЕННО ЭТОГО сайта:
   - тот же фон, что у сайта (тёмный/светлый/градиент/цвет бренда);
   - те же шрифты и фирменные цвета;
   - то же настроение (люкс / минимализм / неон / эко / техно и т.д.).
3. По центру — твоя СОБСТВЕННАЯ анимация (НЕ банальный круглый спиннер): например, пульсирующее название/логотип бренда, тонкая анимированная линия-прогресс, морфинг фигуры, печатающийся текст, мерцание — то, что подходит теме. Рассчитывай анимацию на цикл РОВНО ~5 секунд — за это время подгружаются контент и кадры анимации, после чего прелоадер плавно скрывается.
4. Стили прелоадера задай инлайн (в <style> внутри документа или style-атрибутом). Используй position:fixed; inset:0; высокий z-index.
5. ОБЯЗАТЕЛЬНО добавь РОВНО этот скрипт (вставь как есть, ничего не меняя) — он скрывает прелоадер когда все кадры анимации загружены в память (максимум 20 секунд ожидания):
<script>(function(){var p=document.getElementById('site-preloader');if(!p)return;function hide(){p.style.transition='opacity .6s ease,visibility .6s';p.style.opacity='0';p.style.visibility='hidden';p.style.pointerEvents='none';setTimeout(function(){try{if(p.parentNode)p.parentNode.removeChild(p);}catch(e){}},700);}var t=setTimeout(hide,20000);window.addEventListener('craft:frames-ready',function(){clearTimeout(t);setTimeout(hide,300);},{once:true});})();</script>
   Другой JS для скрытия НЕ добавляй — только этот блок. Сам прелоадер делай красивой CSS-анимированной заглушкой.
═══ КОНЕЦ ПРЕЛОАДЕРА ═══\n`;
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
      const sitePages: SitePage[] = [
        { filename: "index.html", code: project.generatedCode || "" },
        ...existingFiles
          .filter((f) => f.filename !== "index.html" && isHtmlPage(f.filename))
          .map((f) => ({ filename: f.filename, code: f.code || "" })),
      ];
      let craftMdForEdit = "";
      let agentToolHandled = false;
      let agentChangedFiles: Map<string, string> | null = null;
      let agentSummary = "";

      let editPromptBase = "";
      if (isEditMode) {
        const editingFile = activeFile || "index.html";
        // Validate active file exists; stale tabs fall back to index
        const knownNames = new Set(sitePages.map((p) => p.filename));
        const safeEditingFile = knownNames.has(editingFile) ? editingFile : "index.html";
        const editingFileCodeRaw = safeEditingFile === "index.html"
          ? project.generatedCode
          : existingFiles.find(f => f.filename === safeEditingFile)?.code || project.generatedCode;
        const { map } = stripBase64(editingFileCodeRaw || "");
        base64Map = map;
        console.log(`[AGENT] Multipage edit. Active: ${safeEditingFile}, pages: ${sitePages.map(p => p.filename).join(", ")}`);

        craftMdForEdit = await ensureCraftMd(project.id, {
          title: project.title || "Сайт",
          description: project.description,
          userPrompt: prompt,
          pages: sitePages,
        });

        editPromptBase = systemContent;
        systemContent = buildMultipageEditSystemPrompt({
          baseSystem: editPromptBase,
          activeFile: safeEditingFile,
          craftMd: craftMdForEdit,
          pages: sitePages,
          useToolsHint: true,
        });
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
          // ═══ ДВУХЭТАПНЫЙ ПРОЦЕСС: ПРОФЕССИОНАЛ (референс → код) ═══
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
  "reference_photos": [
    {
      "index": 1,
      "role": "design_reference / product_photo / logo / person / brand_asset / other",
      "description": "что конкретно изображено на ЭТОМ приложенном фото"
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
- Пользователю могут быть приложены НЕСКОЛЬКО изображений одновременно: скриншот дизайна другого сайта (референс стиля) И/ИЛИ реальные фото товара/бренда/логотипа/человека пользователя, которые должны появиться на итоговом сайте
- ОБЯЗАТЕЛЬНО опиши КАЖДОЕ приложенное изображение отдельным объектом в "reference_photos", с "index" по порядку приложения (начиная с 1) и ролью: "design_reference" — это скриншот/макет чужого дизайна для вдохновения по стилю/структуре; "product_photo" / "logo" / "person" / "brand_asset" — это РЕАЛЬНЫЙ объект пользователя (товар, бренд, лого, человек), который нужно сохранить как есть на сайте, а не придумывать заново
- Определяй цвета МАКСИМАЛЬНО ТОЧНО по пикселям (для изображений с ролью design_reference)
- Извлекай ВСЕ тексты со скриншота-референса (заголовки, абзацы, кнопки, меню), если он есть
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
            textPart += `\n\n═══ РЕЖИМ "ПРОФЕССИОНАЛ" (референс + максимальная творческая свобода) ═══

ЗАДАЧА: Пользователь приложил референс(ы) — это может быть скриншот дизайна другого сайта (стиль/структура для вдохновения) и/или реальные фото товара/бренда/логотипа/человека, которые должны появиться на итоговом сайте. Используй это ТОЛЬКО как отправную точку и источник вдохновения — у тебя ПОЛНАЯ творческая свобода: улучшай, адаптируй, придумывай собственную композицию и решения. Ты НЕ обязан копировать референс один в один — итоговый сайт должен быть профессиональным, современным и лучше исходника.

СТРУКТУРИРОВАННЫЙ АНАЛИЗ РЕФЕРЕНСА (JSON, для вдохновения — НЕ для дословного копирования):
${designAnalysis}

ПРАВИЛА ГЕНЕРАЦИИ:
1. НЕ вставляй референс как <img> напрямую — переосмысли его в собственный HTML/CSS/JS
2. Бери из анализа то, что усиливает результат — палитру, настроение, общую структуру секций — но сам выбирай финальные пропорции, отступы и детали на профессиональном дизайнерском уровне
3. Тексты из анализа — используй как смысловую основу, но можешь переписать и улучшить формулировки под лучшую конверсию, если пользователь явно не просил использовать их дословно
4. Типографику и визуальные эффекты (тени, скругления, градиенты, glassmorphism) — вдохновляйся анализом, но выбирай то, что выглядит наиболее премиально именно для этого сайта
5. ⚠️ РЕФЕРЕНС-ФОТО ТОВАРА/БРЕНДА (КРИТИЧЕСКИ ВАЖНО): если в "reference_photos" есть изображение с ролью "product_photo" / "logo" / "person" / "brand_asset" (РЕАЛЬНЫЙ товар, лого или человек пользователя) — везде, где на сайте должен появиться ИМЕННО ЭТОТ товар/бренд/человек, используй маркер {{GENIMG:<промпт на английском, опиши сцену/контекст>|<соотношение>|REF<номер>}}, где <номер> — это "index" нужного фото из reference_photos. Это запускает image-to-image генерацию, которая сохраняет реальный товар/бренд/человека на новом качественном профессиональном кадре (студийный свет, контекст по смыслу сайта), НЕ придумывая его заново
6. Для ВСЕХ ОСТАЛЬНЫХ фото (декоративные, атмосферные, не связанные с конкретным реальным объектом пользователя) — используй обычный {{GENIMG:<промпт на английском>|<соотношение>}} БЕЗ REF, чтобы AI сгенерировал подходящее изображение с нуля
7. Сам реши для каждого фото сайта: нужен ли REF (когда важно сохранить реальный товар/бренд/человека) или генерация с нуля (когда фото просто иллюстративное) — ориентируйся на инструкцию пользователя выше запроса
8. Все интерактивные элементы (кнопки, ссылки, формы) должны быть функциональными
9. CSS: flexbox, grid, custom properties, hover-анимации, transitions
10. ⚠️ ОБЯЗАТЕЛЬНАЯ МОБИЛЬНАЯ АДАПТИВНОСТЬ: viewport meta, mobile-first @media, шрифты через clamp(), на ≤768px все grid → 1 колонка, навбар → гамбургер, картинки max-width:100%, кнопки min-height:44px, никаких горизонтальных скроллов. Сайт ОБЯЗАН отлично выглядеть на 375px ширины

Результат — полностью рабочий, ВИЗУАЛЬНО СИЛЬНЫЙ HTML/CSS/JS сайт, вдохновлённый референсом, но доведённый до профессионального уровня собственными дизайнерскими решениями.
═══ КОНЕЦ РЕЖИМА "ПРОФЕССИОНАЛ" ═══`;
          } else {
            // Fallback: single-step vision mode (analysis failed or invalid)
            textPart += `\n\n═══ РЕЖИМ "ПРОФЕССИОНАЛ" (референс + максимальная творческая свобода) ═══
ПОЛЬЗОВАТЕЛЬ ПРИЛОЖИЛ РЕФЕРЕНС(Ы) — это может быть скриншот дизайна другого сайта для вдохновения и/или реальные фото товара/бренда/логотипа/человека, которые должны появиться на сайте. Посмотри на приложенные изображения и определи, что из них — дизайн-референс (для стиля/структуры), а что — реальный объект пользователя (товар/бренд/человек), который нужно сохранить как есть.

ПРАВИЛА:
1. НЕ вставляй референс как <img> напрямую — переосмысли дизайн в собственный HTML/CSS/JS с ПОЛНОЙ творческой свободой: улучшай, адаптируй, не обязан копировать один в один
2. Бери из референса общее настроение, палитру и структуру, но выбирай финальные пропорции, отступы и детали сам, на профессиональном уровне
3. Тексты — переработай под лучшую конверсию, если пользователь явно не просил использовать их дословно
4. Современный CSS: flexbox, grid, custom properties, hover-эффекты
5. ⚠️ РЕФЕРЕНС-ФОТО ТОВАРА/БРЕНДА: если среди приложенных изображений есть РЕАЛЬНОЕ фото товара, лого или человека пользователя (не просто скриншот дизайна) — везде, где на сайте нужно показать ИМЕННО ЭТОТ товар/бренд/человека, используй маркер {{GENIMG:<промпт на английском>|<соотношение>|REF<номер>}}, где <номер> — порядковый номер этого изображения среди приложенных (считая с 1, в порядке приложения). Это сохранит реальный объект на новом качественном кадре вместо того, чтобы придумывать его заново
6. Для остальных, чисто иллюстративных фото — обычный {{GENIMG:<промпт на английском>|<соотношение>}} без REF
7. ⚠️ ОБЯЗАТЕЛЬНАЯ МОБИЛЬНАЯ АДАПТИВНОСТЬ: viewport meta, mobile-first @media, шрифты через clamp(), на ≤768px все grid → 1 колонка, навбар → гамбургер, картинки max-width:100%, кнопки min-height:44px, никаких горизонтальных скроллов. Сайт ОБЯЗАН отлично выглядеть на 375px ширины

Результат — полностью рабочий, профессиональный HTML/CSS/JS сайт, вдохновлённый референсом, с реальными фото товара/бренда там, где это уместно.
═══ КОНЕЦ РЕЖИМА "ПРОФЕССИОНАЛ" ═══`;
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

      const conversationHistory: KieMessage[] = [];

      for (const msg of priorMessages.slice(-10)) {
        if (msg.role === "user") {
          conversationHistory.push({ role: "user", content: [{ type: "input_text", text: msg.content }] });
        } else if (msg.role === "assistant") {
          const truncated = msg.content.length > 2000 ? msg.content.substring(0, 2000) + "...[обрезано]" : msg.content;
          conversationHistory.push({ role: "assistant", content: [{ type: "input_text", text: truncated }] });
        }
      }

      const userContent: KieContentItem[] = [];
      let imgIdx = 0;
      for (const item of inputContent) {
        if ((item as any).type === "text") {
          userContent.push({ type: "input_text", text: (item as any).text });
        } else if ((item as any).type === "image") {
          const imgB64: string | undefined = (item as any).data;
          const imgMime: string = (item as any).mime_type || "image/jpeg";
          if (useGemini && imgB64) {
            // For the Gemini path: send actual bytes so the model can see the image
            userContent.push({ type: "input_image_inline", base64: imgB64, mime_type: imgMime });
          } else {
            const relUrl = savedImageUrls[imgIdx] || "";
            if (relUrl) userContent.push({ type: "input_image", image_url: `${baseUrl}${relUrl}` });
          }
          imgIdx++;
        }
      }

      // For interactive split-mode sites: inject the uploaded product photo directly
      // into the Gemini message so the model can see the actual product and write a
      // product-specific {{SCROLLANIM:...}} video prompt and accurate alt-texts.
      if (useGemini && absoluteProductImageUrl) {
        const productImg = await fetchProductImageForVision(absoluteProductImageUrl);
        if (productImg) {
          userContent.push({
            type: "input_text",
            text: "⬇ ФОТО РЕАЛЬНОГО ТОВАРА (загружено для Hero-анимации в split-режиме). Внимательно изучи: форму, упаковку, цвета, текст на этикетке, стиль продукта. Используй это при создании: (1) точного описания товара в видео-промпте {{SCROLLANIM:...}} — укажи, что именно это за продукт и его ключевые визуальные особенности; (2) alt-текстов и подписей; (3) общей цветовой палитры и стиля сайта.",
          });
          userContent.push({ type: "input_image_inline", base64: productImg.base64, mime_type: productImg.mimeType });
          console.log(`[KIE] Product image injected into Gemini message (${productImg.mimeType}, ${Math.round(productImg.base64.length * 0.75 / 1024)}KB)`);
        } else {
          console.warn("[KIE] Could not load product image for Gemini injection — prompt will be text-only for product");
        }
      }

      conversationHistory.push({ role: "user", content: userContent });

      console.log(`[KIE] Generate call. Agent: ${useGemini ? "v2/Gemini-Flash" : "v1/Claude-Sonnet-5"}, History: ${conversationHistory.length}, Edit: ${isEditMode}`);

      // ── Multipage tool-calling agent (Claude + Gemini / KIE) ────────────────
      // Tries function calling so the model can read/patch ANY page.
      // If KIE rejects tools, we fall through to the streaming multipage text protocol.
      // Tool-calling path is text-tools only today — if the user attached images,
      // skip tools and use the streaming path that already carries vision parts.
      if (isEditMode && imageArray.length === 0) {
        try {
          res.write(`data: ${JSON.stringify({ status: useGemini ? "Gemini-агент изучает все страницы…" : "Агент изучает все страницы сайта…" })}\n\n`);
          const hist = conversationHistory
            .filter((m) => m.role === "user" || m.role === "assistant")
            .slice(0, -1)
            .map((m) => ({
              role: m.role as "user" | "assistant",
              text: m.content.map((c: any) => (c.type === "input_text" ? c.text : "")).join("\n").slice(0, 2000),
            }))
            .filter((h) => h.text.trim());

          const toolResult = await runToolCallingAgent({
            systemPrompt: systemContent,
            userPrompt: prompt,
            pages: sitePages,
            craftMd: craftMdForEdit,
            history: hist.slice(-8),
            maxRounds: 8,
            provider: useGemini ? "gemini" : "claude",
            onStatus: (status) => {
              try { res.write(`data: ${JSON.stringify({ status })}\n\n`); } catch {}
            },
            onContent: (chunk) => {
              if (!chunk) return;
              fullResponse += chunk;
              try { res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`); } catch {}
            },
          });

          if (toolResult.toolsSupported && toolResult.changedFiles.size > 0) {
            agentToolHandled = true;
            agentChangedFiles = toolResult.changedFiles;
            agentSummary = toolResult.summary;
            craftMdForEdit = toolResult.craftMd;
            if (!fullResponse.trim()) fullResponse = toolResult.summary;
            console.log(`[AGENT] ${useGemini ? "Gemini" : "Claude"} tool-calling success. Changed: ${[...toolResult.changedFiles.keys()].join(", ")}`);
          } else if (toolResult.toolsSupported && toolResult.changedFiles.size === 0) {
            console.log(`[AGENT] ${useGemini ? "Gemini" : "Claude"} tools supported but no file changes — falling back to stream protocol`);
          } else {
            console.log(`[AGENT] ${useGemini ? "Gemini" : "Claude"} tools unsupported by KIE — using multipage stream protocol`);
            systemContent = buildMultipageEditSystemPrompt({
              baseSystem: editPromptBase || SYSTEM_PROMPT,
              activeFile: activeFile || "index.html",
              craftMd: craftMdForEdit,
              pages: sitePages,
              useToolsHint: false,
            });
          }
        } catch (agentErr: any) {
          console.warn("[AGENT] Tool-calling failed, stream fallback:", agentErr?.message || agentErr);
        }
      }

      const MAX_RETRIES = 3;
      let lastError: any = null;
      if (!agentToolHandled) {
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
      }

      console.log("Total response length:", fullResponse.length);
      console.log("Response preview:", fullResponse.substring(0, 200));

      // Gemini Flash via KIE sometimes returns shell-command JSON lines:
      //   {"cmd":"cat > index.html <<'EOF'\n...HTML...\nEOF","workdir":""}  {"end":""}
      // Strip these so they don't bleed into the preview.
      if (fullResponse.includes('"cmd"') && fullResponse.includes('"workdir"')) {
        console.log("[PARSE] Detected Gemini shell-command JSON format — sanitizing");
        // 1) Try to extract HTML from heredoc patterns inside cmd values
        // Matches: cat > *.html <<'EOF'\n(content)\nEOF
        const heredocRegex = /cat\s*>\s*([\w./-]+\.html)\s*<<['"]?EOF['"]?\n([\s\S]*?)\nEOF/g;
        const extractedFiles: { filename: string; code: string }[] = [];
        let hm;
        while ((hm = heredocRegex.exec(fullResponse)) !== null) {
          const filename = hm[1].trim().toLowerCase().split("/").pop() || hm[1].trim().toLowerCase();
          const content = hm[2].trim();
          if (content.includes("<") && content.length > 100 && /^[a-z0-9][a-z0-9_-]*\.html$/.test(filename)) {
            extractedFiles.push({ filename, code: content });
          }
        }
        if (extractedFiles.length > 0) {
          fullResponse = extractedFiles
            .map((f) => `--- FILE: ${f.filename} ---\n\`\`\`html\n${f.code}\n\`\`\``)
            .join("\n");
          console.log("[PARSE] Extracted", extractedFiles.length, "file(s) from heredoc:", extractedFiles.map(f => f.filename).join(", "));
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

      // New-site single-page mode: strip rogue FILE markers so they don't leak.
      // Edit mode ALWAYS allows multipage --- FILE: --- markers.
      if (!isEditMode && !multiPagesData && fullResponse.includes("--- FILE:")) {
        fullResponse = fullResponse.replace(/---\s*FILE:\s*[^\s\-]+\.html\s*---\s*\n?/gi, "");
        console.log("[PARSE] Stripped rogue FILE markers (single-page mode)");
      }

      const hasDiffBlocks = fullResponse.includes("<<<<<<< SEARCH");
      const hasFileMarkers = fullResponse.includes("--- FILE:");
      const htmlBlockCount = (fullResponse.match(/```html/g) || []).length;
      const diffBlockCount = (fullResponse.match(/```diff/g) || []).length;
      console.log("Full response length:", fullResponse.length, "Has FILE markers:", hasFileMarkers, "HTML blocks:", htmlBlockCount, "Diff blocks:", diffBlockCount, "Has SEARCH/REPLACE:", hasDiffBlocks, "AgentTools:", agentToolHandled);

      const applyDiffPatches = (originalCode: string, response: string): { code: string; applied: number; total: number } =>
        applyDiffPatchesToCode(originalCode, response);

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

      let editingFile = activeFile || "index.html";
      let mainHtmlCode: string;
      let editedFilesList: string[] = [];

      if (agentToolHandled && agentChangedFiles && agentChangedFiles.size > 0) {
        aiTextReply = agentSummary || aiTextReply || "Сайт обновлён";
        mainHtmlCode = project.generatedCode || "";
        for (const [fn, code] of agentChangedFiles) {
          const finalCode = replaceImgMarkers(code);
          editedFilesList.push(fn);
          if (fn === "index.html") mainHtmlCode = finalCode;
          else await storage.upsertProjectFile({ projectId: project.id, filename: fn, code: finalCode });
        }
        if (!agentChangedFiles.has("index.html")) mainHtmlCode = project.generatedCode || "";
        editingFile = editedFilesList.includes(activeFile || "")
          ? (activeFile || "index.html")
          : (editedFilesList[0] || editingFile);
        await storage.upsertProjectFile({ projectId: project.id, filename: CRAFT_MD_FILENAME, code: craftMdForEdit });
      } else if (isEditMode && (hasDiffBlocks || (hasFileMarkers && (diffBlockCount > 0 || htmlBlockCount > 0)))) {
        // Multipage edit protocol: --- FILE: x.html --- + diff/html per file
        const filesMap = new Map<string, string>();
        filesMap.set("index.html", project.generatedCode || "");
        for (const f of existingFiles) {
          if (isHtmlPage(f.filename)) filesMap.set(f.filename, f.code || "");
        }
        const parsed = parseMultipageEditResponse(fullResponse, filesMap, editingFile);
        aiTextReply = parsed.aiTextReply || aiTextReply;

        if (parsed.total > 0 && parsed.applied === 0) {
          const freshBal = user?.id ? (await storage.getUser(user.id))?.credits : undefined;
          const failMsg = "Не удалось применить изменения к коду — попробуйте переформулировать запрос или повторить.";
          try {
            await storage.createProjectMessage({ projectId: project.id, role: "model", content: failMsg });
          } catch {}
          console.warn(`[EDIT] 0/${parsed.total} multipage patches applied for project ${project.id}`);
          res.write(`data: ${JSON.stringify({ error: failMsg, newBalance: freshBal, refunded: false })}\n\n`);
          res.end();
          return;
        }

        if (parsed.applied > 0 && parsed.applied < parsed.total) {
          const note = `⚠️ Применено ${parsed.applied} из ${parsed.total} изменений — остальные не удалось точно сопоставить с кодом. Если чего-то не хватает, переформулируйте запрос.`;
          aiTextReply = aiTextReply ? `${aiTextReply}\n\n${note}` : note;
        }

        mainHtmlCode = project.generatedCode || "";
        if (parsed.changed.size === 0 && !hasDiffBlocks) {
          // Fall through to full-HTML multipage parser below via empty changed —
          // handled in the else branch by reusing legacy FILE+html logic.
        }

        if (parsed.changed.size > 0) {
          for (const [fn, code] of parsed.changed) {
            const finalCode = replaceImgMarkers(code);
            editedFilesList.push(fn);
            if (fn === "index.html") mainHtmlCode = finalCode;
            else await storage.upsertProjectFile({ projectId: project.id, filename: fn, code: finalCode });
          }
          if (!parsed.changed.has("index.html")) mainHtmlCode = project.generatedCode || "";
          editingFile = editedFilesList.includes(activeFile || "")
            ? (activeFile || "index.html")
            : (editedFilesList[0] || editingFile);
        } else if (hasFileMarkers) {
          // Full HTML per FILE marker (rewrite / new pages)
          const fileMarkerRegex = /---\s*FILE:\s*([^\s\-]+\.html)\s*---\s*\n?\s*```html\s*\n?([\s\S]*?)```/gi;
          const parsedFiles: { filename: string; code: string }[] = [];
          let fm;
          while ((fm = fileMarkerRegex.exec(fullResponse)) !== null) {
            parsedFiles.push({ filename: fm[1].trim().toLowerCase(), code: replaceImgMarkers(fm[2].trim()) });
          }
          if (parsedFiles.length === 0) {
            const rawMarkerRegex = /---\s*FILE:\s*([^\s\-]+\.html)\s*---\s*\n([\s\S]*?)(?=\s*---\s*FILE:|$)/gi;
            let rm;
            while ((rm = rawMarkerRegex.exec(fullResponse)) !== null) {
              const rawCode = rm[2].trim();
              if (rawCode.includes("<") && rawCode.length > 50) {
                parsedFiles.push({ filename: rm[1].trim().toLowerCase(), code: replaceImgMarkers(rawCode) });
              }
            }
          }
          const indexFile = parsedFiles.find(f => f.filename === "index.html");
          mainHtmlCode = indexFile?.code || project.generatedCode || parsedFiles[0]?.code || "";
          for (const pf of parsedFiles) {
            editedFilesList.push(pf.filename);
            if (pf.filename !== "index.html") {
              await storage.upsertProjectFile({ projectId: project.id, filename: pf.filename, code: pf.code });
            }
          }
          editingFile = editedFilesList.includes(activeFile || "") ? (activeFile || "index.html") : (editedFilesList[0] || editingFile);
        } else {
          // Single-file legacy diff without FILE markers → active file
          const editingFileCodeRaw = editingFile === "index.html"
            ? project.generatedCode || ""
            : existingFiles.find(f => f.filename === editingFile)?.code || project.generatedCode || "";
          const { stripped: editingFileCode } = stripBase64(editingFileCodeRaw);
          const patchResult = applyDiffPatches(editingFileCode, fullResponse);
          if (patchResult.total > 0 && patchResult.applied === 0) {
            const freshBal = user?.id ? (await storage.getUser(user.id))?.credits : undefined;
            const failMsg = "Не удалось применить изменения к коду — попробуйте переформулировать запрос или повторить.";
            try {
              await storage.createProjectMessage({ projectId: project.id, role: "model", content: failMsg });
            } catch {}
            res.write(`data: ${JSON.stringify({ error: failMsg, newBalance: freshBal, refunded: false })}\n\n`);
            res.end();
            return;
          }
          const patchedCode = replaceImgMarkers(restoreBase64(patchResult.code, base64Map));
          editedFilesList = [editingFile];
          if (editingFile !== "index.html") {
            await storage.upsertProjectFile({ projectId: project.id, filename: editingFile, code: patchedCode });
            mainHtmlCode = project.generatedCode || "";
          } else {
            mainHtmlCode = patchedCode;
          }
        }
      } else {
        const fileMarkerRegex = /---\s*FILE:\s*([^\s\-]+\.html)\s*---\s*\n?\s*```html\s*\n?([\s\S]*?)```/gi;
        const parsedFiles: { filename: string; code: string }[] = [];
        let fm;
        while ((fm = fileMarkerRegex.exec(fullResponse)) !== null) {
          parsedFiles.push({ filename: fm[1].trim().toLowerCase(), code: replaceImgMarkers(fm[2].trim()) });
        }

        if (parsedFiles.length === 0) {
          const altMarkerRegex = /\*{0,2}\s*FILE:\s*([^\s*]+\.html)\s*\*{0,2}\s*\n?\s*```html\s*\n?([\s\S]*?)```/gi;
          let altM;
          while ((altM = altMarkerRegex.exec(fullResponse)) !== null) {
            parsedFiles.push({ filename: altM[1].trim().toLowerCase(), code: replaceImgMarkers(altM[2].trim()) });
          }
        }

        if (parsedFiles.length === 0 && hasFileMarkers) {
          const rawMarkerRegex = /---\s*FILE:\s*([^\s\-]+\.html)\s*---\s*\n([\s\S]*?)(?=\s*---\s*FILE:|$)/gi;
          let rm;
          while ((rm = rawMarkerRegex.exec(fullResponse)) !== null) {
            const rawCode = rm[2].trim();
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
            editedFilesList.push(pf.filename);
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
          const singleMatch = fullResponse.match(/```html\s*\n?([\s\S]*?)```/i);
          let parsedCode: string | null = null;
          if (singleMatch && singleMatch[1].includes("<")) {
            parsedCode = replaceImgMarkers(cleanHtmlDoc(singleMatch[1]));
          } else if (/<!DOCTYPE\s+html|<html[\s>]/i.test(fullResponse)) {
            parsedCode = replaceImgMarkers(cleanHtmlDoc(fullResponse));
          }

          if (parsedCode && isEditMode && editingFile !== "index.html") {
            await storage.upsertProjectFile({ projectId: project.id, filename: editingFile, code: parsedCode });
            mainHtmlCode = project.generatedCode || "";
            editedFilesList = [editingFile];
          } else if (parsedCode) {
            mainHtmlCode = parsedCode;
            editedFilesList = ["index.html"];
          } else {
            mainHtmlCode = project.generatedCode || "";
          }
        }
      }

      // Final safety net: if any parsing path still left conversational preamble
      // or a stray markdown fence in front of a full HTML document, strip it now so
      // a clean document is always persisted/previewed (covers "каждый второй сайт").
      if (mainHtmlCode && /<!DOCTYPE\s+html|<html[\s>]/i.test(mainHtmlCode) && !/^\s*<(!DOCTYPE|html)/i.test(mainHtmlCode)) {
        mainHtmlCode = cleanHtmlDoc(mainHtmlCode);
      }

      // ── Re-inject scroll-anim-pending if AI full-HTML edit stripped it ────────
      // When the user edits while BG ANIM is still running, the AI may output a
      // full HTML replacement that drops the pending spinner. BG ANIM then finds
      // nothing to replace and the animation is permanently lost. Fix: if the
      // ORIGINAL project code had the pending section and the AI-produced code
      // does NOT, extract and re-inject it after </header> (or <body>).
      {
        const PEND_MARKER = 'data-scroll-anim-pending="1"';
        const origCode = project.generatedCode || "";
        if (origCode.includes(PEND_MARKER) && mainHtmlCode && !mainHtmlCode.includes(PEND_MARKER)) {
          // Extract the full <section data-scroll-anim-pending...>...</section> from original
          const mIdx = origCode.indexOf(PEND_MARKER);
          const secStart = origCode.lastIndexOf('<section', mIdx);
          if (secStart !== -1) {
            let depth = 0, pos = secStart, secEnd = -1;
            while (pos < origCode.length) {
              const nextOpen = origCode.indexOf('<section', pos + 1);
              const nextClose = origCode.indexOf('</section>', pos);
              if (nextClose === -1) break;
              if (nextOpen !== -1 && nextOpen < nextClose) { depth++; pos = nextOpen; }
              else { if (depth === 0) { secEnd = nextClose + '</section>'.length; break; } depth--; pos = nextClose + 1; }
            }
            if (secEnd !== -1) {
              const pendingBlock = origCode.slice(secStart, secEnd);
              if (mainHtmlCode.includes('</header>')) {
                mainHtmlCode = mainHtmlCode.replace('</header>', `</header>\n${pendingBlock}`);
              } else {
                mainHtmlCode = mainHtmlCode.replace(/<body([^>]*)>/i, (_m, attrs) => `<body${attrs}>\n${pendingBlock}`);
              }
              console.log(`[EDIT] Re-injected scroll-anim-pending section into AI-edited code (project ${project.id})`);
            }
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
        if (f.filename === "index.html" || f.filename === CRAFT_MD_FILENAME || !isHtmlPage(f.filename)) continue;
        genFilesMap.set(f.filename, f.code);
      }
      const genRunKey = idempotencyKey || `gen-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const referenceImageUrlsForGen = (mockupMode && savedImageUrls.length > 0)
        ? savedImageUrls.map(u => (u.startsWith("http") ? u : `${baseUrl}${u}`))
        : [];
      // Always finish image generation even if the client disconnected — the site must
      // be saved complete. SSE status pings are already soft-fail via the write wrapper.
      const genImgResult = await resolveGenImgMarkers(genFilesMap, project.id, user?.id, genRunKey, res, () => false, referenceImageUrlsForGen);
      mainHtmlCode = genFilesMap.get("index.html") ?? mainHtmlCode;
      // Persist secondary pages that received GENIMG / IMGPENDING resolution
      for (const [filename, code] of Array.from(genFilesMap.entries())) {
        if (filename === "index.html" || filename === CRAFT_MD_FILENAME || !isHtmlPage(filename)) continue;
        const prev = secondaryForGen.find((f) => f.filename === filename)?.code;
        if (code !== prev) {
          await storage.upsertProjectFile({ projectId: project.id, filename, code });
        }
      }

      // ── Image review pass (first generation only) ─────────────────────────
      // Any GENIMG markers that survived both passes in resolveGenImgMarkers are
      // still encoded as IMGPENDING:base64key in the HTML. Try one final targeted
      // generation for each, then convert any survivors to gradient placeholders.
      let reviewCreditsUsed = 0;
      let reviewFilled = 0;
      if (isNewSite) {
        const reviewResult = await autoFillMissingImages(
          genFilesMap, project.id, user?.id,
          `rv-${genRunKey}`, res, () => false,
        );
        reviewCreditsUsed = reviewResult.creditsUsed;
        reviewFilled = reviewResult.filled;
        if (reviewResult.filled > 0) mainHtmlCode = genFilesMap.get("index.html") ?? mainHtmlCode;
      } else {
        // Not a new site — just convert any lingering IMGPENDING: to gradients
        for (const [filename, code] of Array.from(genFilesMap.entries())) {
          if (!code.includes("IMGPENDING:")) continue;
          genFilesMap.set(filename, code.replace(/IMGPENDING:([A-Za-z0-9+/=]+)/g, (_full, b64key) => {
            const key = Buffer.from(b64key, "base64").toString("utf8");
            return gradientPlaceholderDataUri(key);
          }));
        }
        mainHtmlCode = genFilesMap.get("index.html") ?? mainHtmlCode;
      }

      // ── Normalize malformed SCROLLANIM / ANIMATIONAL markers before any detection ──
      // The model sometimes deviates from the exact `{{SCROLLANIM:...}}` syntax —
      // adds spaces ({{ SCROLLANIM :), changes case ({{scrollanim:), or wraps the
      // marker in markdown code fences / backticks. Any of those makes the strict
      // includes()/regex checks below miss it, which both skips video generation AND
      // leaks the raw marker text to the visitor. Canonicalize first so detection,
      // pending-replace, and resolveScrollAnimMarkers all see a well-formed marker.
      if (interactiveMode) {
        mainHtmlCode = mainHtmlCode
          // 1. canonical opening tag first: {{  scrollanim  :  →  {{SCROLLANIM:
          .replace(/\{\{\s*SCROLLANIM\s*:/gi, "{{SCROLLANIM:")
          .replace(/\{\{\s*ANIMATIONAL\s*:/gi, "{{ANIMATIONAL:")
          // 2. unwrap backticks / code fences ONLY when they hug a FULL canonical marker
          //    on both sides — anchored to {{...}} so unrelated `SCROLLANIM:` text in
          //    scripts/content is never touched.
          .replace(/`+[ \t]*\n?[ \t]*(\{\{SCROLLANIM:[\s\S]*?\}\})[ \t]*\n?[ \t]*`+/g, "$1")
          .replace(/`+[ \t]*\n?[ \t]*(\{\{ANIMATIONAL:[\s\S]*?\}\})[ \t]*\n?[ \t]*`+/g, "$1");
      }

      // ── Auto-inject ANIMATIONAL if mode but AI missed the marker ──
      if (interactiveMode && isNewSite && interactiveStyle === "animational" && !mainHtmlCode.includes("{{ANIMATIONAL:")) {
        const brandGuess = (project.title || "Studio").replace(/[|{}]/g, "").slice(0, 40);
        const markerAuto = `\n{{ANIMATIONAL:${brandGuess}|Создаём впечатления|#E8FF47|#0B0B0C|#F5F2EC|cinematic premium brand hero scene, dramatic monochrome editorial /// same composition vivid color metamorphosis reveal|atmospheric brand still one,atmospheric brand still two,atmospheric brand still three,atmospheric brand still four,atmospheric brand still five,atmospheric brand still six|Атмосфера::Почувствуйте характер бренда::cinematic brand atmosphere chapter||Детали::Сила в каждой детали::editorial detail close-up||Результат::Когда вау становится нормой::hero result scene||Ваш ход::Начните прямо сейчас::premium call to action scene|Обсудить проект}}\n`;
        if (mainHtmlCode.includes("</header>")) {
          mainHtmlCode = mainHtmlCode.replace("</header>", `</header>${markerAuto}`);
        } else if (/<body[^>]*>/i.test(mainHtmlCode)) {
          mainHtmlCode = mainHtmlCode.replace(/<body[^>]*>/i, (m) => `${m}${markerAuto}`);
        } else {
          mainHtmlCode = markerAuto + mainHtmlCode;
        }
        console.log(`[ANIMATIONAL] Auto-injected marker (AI missed it)`);
      }

      // ── Auto-inject SCROLLANIM if interactive mode but AI missed the marker ──
      if (interactiveMode && isNewSite && interactiveStyle !== "animational" && !mainHtmlCode.includes("{{SCROLLANIM:")) {
        const isSplitAuto = interactiveStyle === "split";
        const isActionAuto = interactiveStyle === "action";
        const isImmersionAuto = interactiveStyle === "immersion";
        let videoPromptAuto: string;
        let textsAuto: string;
        if (isSplitAuto) {
          videoPromptAuto = absoluteProductImageUrl
            ? "the product on the right side of frame, a delicate butterfly gently lands and soft petals drift through the air, left side clean solid white background, soft studio lighting, cinematic macro, no text"
            : "premium product on the right side of frame, soft cinematic accents and gentle atmospheric motion, left side clean solid white background, soft studio lighting, cinematic";
          textsAuto = "Познакомьтесь с нами::Откройте для себя наш продукт||Качество и стиль::Только лучшее для вас||Начните сейчас::Сделайте первый шаг";
        } else if (isActionAuto) {
          videoPromptAuto = absoluteProductImageUrl
            ? "epic slow-motion bullet-time orbit around the product as a splash of liquid and sparks are already exploding outward, frozen mid-air and still drifting further apart while the camera arcs around it, luminous beams and suspended particles continuing to scatter, dramatic premium lighting, cinematic macro"
            : "epic cinematic bullet-time shot orbiting the themed subject as particles, debris and light streaks are already bursting outward mid-air and keep drifting, spinning and scattering further in slow motion, the camera flying around in a dramatic arc, IMAX-grade blockbuster lighting, photorealistic";
          textsAuto = "Почувствуй мощь::Эффект, который впечатляет||Каждая деталь::Снято как в кино||Начни прямо сейчас::Сделай первый шаг";
        } else if (isImmersionAuto) {
          videoPromptAuto = "looking through a symbolic brand threshold doorway framed by soft volumetric light, the camera continuously flies forward through the opening into an expanding premium brand world with deep parallax layers, evolving golden haze and cinematic depth, POV immersion flight, photorealistic";
          textsAuto = "Погрузитесь::Мир бренда на весь экран";
        } else if (interactiveStyle === "site3d") {
          videoPromptAuto = absoluteProductImageUrl
            ? "hero product centered on pure black void, cinematic orbit and push-in, second half clear scroll payoff with light sweep and material reveal, studio rim light, photorealistic commercial, no environment"
            : "premium hero product centered on pure black void, slow cinematic orbit, second half ice-crack or layer-separate payoff, studio rim light, photorealistic commercial product film";
          textsAuto = "Почувствуй объём::Продукт, который оживает при скролле";
        } else if (interactiveStyle === "motion") {
          videoPromptAuto = "premium niche brand scene in full vivid color, iconic commercial subject, cinematic lighting /// same subject and framing in richer alternate color mood, brighter premium commercial lighting, day-to-night or calm-to-energy metamorphosis reveal";
          textsAuto = "Прикоснись::Открой другую сторону бренда||Характер::Сила в деталях||Преображение::Когда результат виден сразу||Твой ход::Начни прямо сейчас";
        } else {
          videoPromptAuto = absoluteProductImageUrl
            ? "premium product with soft cinematic accents — gentle drifting petals and slow sweeping light, studio lighting, clean solid background, cinematic macro detail"
            : "breathtaking cinematic forward flight into the scene, volumetric god rays and drifting atmospheric haze, the camera revealing depth and grandeur, epic film-still lighting, photorealistic";
          textsAuto = "Добро пожаловать::Откройте что-то новое||Наше качество::Только лучшее||Начните прямо сейчас::Попробуйте сегодня";
        }
        const markerAuto = `\n{{SCROLLANIM:${videoPromptAuto}|${textsAuto}}}\n`;
        if (mainHtmlCode.includes("</header>")) {
          mainHtmlCode = mainHtmlCode.replace("</header>", `</header>${markerAuto}`);
        } else if (/<body[^>]*>/i.test(mainHtmlCode)) {
          mainHtmlCode = mainHtmlCode.replace(/<body[^>]*>/i, (m) => `${m}${markerAuto}`);
        } else {
          mainHtmlCode = markerAuto + mainHtmlCode;
        }
        console.log(`[SCROLLANIM] Auto-injected marker (AI missed it). Style: ${interactiveStyle}`);
      }

      // ── Scroll / Animational: fire-and-forget approach ───────────────────────
      // Replace markers with pending placeholders and deliver immediately.
      // Background pipeline bakes the final experience into the DB.
      const hasAniMarkers = mainHtmlCode.includes("{{ANIMATIONAL:");
      const hasScrollMarkers = mainHtmlCode.includes("{{SCROLLANIM:") || hasAniMarkers;
      let immediateHtml = mainHtmlCode;
      if (hasAniMarkers) {
        immediateHtml = mainHtmlCode.replace(/\{\{ANIMATIONAL:([\s\S]+?)\}\}/g, (_full, inner) => {
          const brief = parseAnimationalMarker(String(inner));
          return buildAnimationalPendingHtml(brief.brand, String(inner).trim());
        });
      } else if (mainHtmlCode.includes("{{SCROLLANIM:")) {
        immediateHtml = mainHtmlCode.replace(/\{\{SCROLLANIM:([\s\S]+?)\}\}/g, (_full, inner) => {
          const pipe = (inner as string).indexOf("|");
          const textPart = pipe === -1 ? "" : (inner as string).slice(pipe + 1);
          const texts = textPart.split("||").map((seg: string) => {
            const [title, sub] = seg.split("::");
            return { title: (title || "").trim(), sub: (sub || "").trim() };
          }).filter((t: { title: string; sub: string }) => t.title || t.sub);
          const videoPromptRaw = pipe === -1 ? (inner as string).trim() : (inner as string).slice(0, pipe).trim();
          return scrollAnimPendingHtml(texts.length ? texts : [{ title: "", sub: "" }], videoPromptRaw || undefined, interactiveStyle || undefined);
        });
      }

      // Version history (save previous code before overwrite)
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

      // Inject loading overlay into all interactive-mode sites (and any new site with video/images)
      // Animational ships its own loader — skip craft overlay to avoid double splash.
      if ((interactiveMode || hasScrollMarkers) && !hasAniMarkers) {
        immediateHtml = injectLoadingOverlay(immediateHtml);
      }

      await storage.updateProject(project.id, { generatedCode: immediateHtml });
      const animPendingCost = hasAniMarkers
        ? SCROLL_ANIMATIONAL_COST
        : hasScrollMarkers
        ? SCROLL_ANIM_COST
        : 0;
      const creditBreakdown = {
        generate: GENERATION_COST,
        images: genImgResult.creditsUsed + reviewCreditsUsed,
        imagesCount: genImgResult.generated + reviewFilled,
        videoPending: hasScrollMarkers,
        videoCostIfCharged: animPendingCost,
        total: GENERATION_COST + genImgResult.creditsUsed + reviewCreditsUsed,
      };
      const spendNote =
        `\n\n— Списано ${creditBreakdown.total} ток.` +
        ` (генерация ${creditBreakdown.generate}` +
        (creditBreakdown.images > 0
          ? ` + изображения ${creditBreakdown.imagesCount}×${AUTO_IMAGE_COST}=${creditBreakdown.images}`
          : "") +
        ")" +
        (hasAniMarkers
          ? `. Анимационный сайт рендерится отдельно (−${SCROLL_ANIMATIONAL_COST} ток. при успехе).`
          : hasScrollMarkers
          ? `. Видеоанимация рендерится отдельно (−${SCROLL_ANIM_COST} ток. при успехе).`
          : "");
      await storage.createProjectMessage({
        projectId: project.id,
        role: "model",
        content: (aiTextReply || "Сайт обновлён") + spendNote,
      });

      // craft.md — Replit-style agent memory for this site
      try {
        const pagesNow: SitePage[] = [
          { filename: "index.html", code: immediateHtml },
          ...(await storage.getProjectFiles(project.id))
            .filter((f) => f.filename !== "index.html" && isHtmlPage(f.filename))
            .map((f) => ({ filename: f.filename, code: f.code || "" })),
        ];
        if (isNewSite) {
          await ensureCraftMd(project.id, {
            title: project.title || "Сайт",
            description: project.description,
            userPrompt: prompt,
            pages: pagesNow,
          });
        } else if (isEditMode) {
          await refreshCraftMdPages(project.id, pagesNow, {
            userRequest: prompt,
            summary: (aiTextReply || "правка").replace(/\s+/g, " ").trim().slice(0, 220),
            changedFiles: editedFilesList.length ? editedFilesList : [editingFile],
          });
        }
      } catch (craftErr: any) {
        console.warn("[AGENT] craft.md update failed:", craftErr?.message || craftErr);
      }

      // Deliver to client immediately (no waiting for video)
      const allFiles = await storage.getProjectFiles(project.id);
      const editedFileCode = editingFile !== "index.html" ? allFiles.find(f => f.filename === editingFile)?.code : immediateHtml;
      const freshUser = user?.id ? await storage.getUser(user.id) : null;
      const immediateCreditsUsed = GENERATION_COST + genImgResult.creditsUsed + reviewCreditsUsed;
      const immediateBalance = freshUser?.credits ?? (genDeduction.newBalance - genImgResult.creditsUsed - reviewCreditsUsed);
      res.write(`data: ${JSON.stringify({
        done: true,
        code: immediateHtml,
        editedFile: editingFile,
        editedCode: editedFileCode || immediateHtml,
        editedFiles: editedFilesList.length ? editedFilesList : [editingFile],
        reply: aiTextReply,
        files: allFiles.filter((f) => isHtmlPage(f.filename) || f.filename === "index.html").map(f => ({ filename: f.filename, id: f.id })),
        imagesGenerated: genImgResult.generated + reviewFilled,
        creditsUsed: immediateCreditsUsed,
        creditBreakdown,
        newBalance: immediateBalance,
        animPending: hasScrollMarkers,
      })}\n\n`);
      res.end();

      // ── Background: resolve animation markers, then update DB ─────────────
      if (hasScrollMarkers) {
        const bgFilesMap = new Map<string, string>();
        bgFilesMap.set("index.html", mainHtmlCode); // original — still has markers
        for (const f of secondaryForGen) {
          if (f.filename !== "index.html") bgFilesMap.set(f.filename, f.code);
        }
        const noopRes = { write: () => {}, end: () => {} };
        // Extract fallback texts + prompt once (used in both retry and fallback paths)
        const _aniInner = mainHtmlCode.match(/\{\{ANIMATIONAL:([\s\S]+?)\}\}/)?.[1]?.trim() || "";
        const _animPipe = mainHtmlCode.match(/\{\{SCROLLANIM:([\s\S]+?)\}\}/)?.[1] || "";
        const _animPipeIdx = _animPipe.indexOf("|");
        const _animVideoPrompt = (_animPipeIdx === -1 ? _animPipe : _animPipe.slice(0, _animPipeIdx)).trim();
        const _animTextPart = _animPipeIdx === -1 ? "" : _animPipe.slice(_animPipeIdx + 1);
        const _animTexts = _animTextPart.split("||").map((seg: string) => { const [t, s] = seg.split("::"); return { title: (t||"").trim(), sub: (s||"").trim() }; }).filter((x: { title: string; sub: string }) => x.title || x.sub);
        if (_animTexts.length === 0) _animTexts.push({ title: "", sub: "" });
        const _animStyle = interactiveStyle || (hasAniMarkers ? "animational" : "parallax");
        (async () => {
          const MAX_ANIM_ATTEMPTS = 2;
          // Motion is image-only — retry quickly. Animational is lighter than Kling video.
          // Other video modes keep a longer pause for Kling recovery.
          const RETRY_DELAY_MS =
            _animStyle === "motion" ? 45 * 1000
            : hasAniMarkers || _animStyle === "animational" ? 60 * 1000
            : 3 * 60 * 1000;
          let animSucceeded = false;
          for (let animAttempt = 0; animAttempt < MAX_ANIM_ATTEMPTS; animAttempt++) {
            if (animAttempt > 0) {
              console.log(`[BG ANIM] Waiting ${RETRY_DELAY_MS / 60000} min before retry for project ${project.id}...`);
              await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
              bgFilesMap.set("index.html", mainHtmlCode);
            }
            try {
              console.log(`[BG ANIM] Starting attempt ${animAttempt + 1}/${MAX_ANIM_ATTEMPTS} for project ${project.id} (style=${_animStyle})`);
              const scrollResult = hasAniMarkers
                ? await resolveAnimationalMarkers(bgFilesMap, project.id, user?.id, genRunKey, noopRes, () => false)
                : await resolveScrollAnimMarkers(bgFilesMap, project.id, user?.id, genRunKey, noopRes, () => false, absoluteProductImageUrl, _animStyle);
              // Soft-fail (0 generated) still puts fallback HTML into bgFilesMap via finalize().
              // Do NOT treat that as success — leave pending so Kling task ID / retry can finish.
              if (!scrollResult.generated) {
                console.warn(`[BG ANIM] attempt ${animAttempt + 1}: no frames/pair yet for project ${project.id} — keeping pending`);
                bgFilesMap.set("index.html", mainHtmlCode);
                continue;
              }
              let animatedCode = bgFilesMap.get("index.html") ?? immediateHtml;
              if (!hasAniMarkers) {
                animatedCode = injectLoadingOverlay(animatedCode);
              }
              // Extract FULL animation blocks (section + trailing style/script engine).
              // Merging section-only previously dropped CSS/JS → hollow zero-height hero.
              const curProj = await storage.getProject(project.id);
              const curHtml = curProj?.generatedCode || immediateHtml;
              let mergedHtml = curHtml;
              const finishedBlocks = extractCraftScrollAnimBlocks(animatedCode);
              if (curHtml.includes('data-scroll-anim-pending="1"')) {
                if (finishedBlocks.length === 0) {
                  console.warn(`[BG ANIM] generated>0 but no craft-scrollanim block found — writing fallback`);
                  const fb = hasAniMarkers
                    ? buildAnimationalFallbackHtml(_aniInner)
                    : (() => {
                        const pendingTagM = curHtml.match(/<section[^>]*data-scroll-anim-pending="1"[^>]*>/);
                        const pendingTag = pendingTagM ? pendingTagM[0] : "";
                        const savedTaskIdEnc = pendingTag.match(/data-scroll-anim-task-id="([^"]*)"/)?.[1] || "";
                        const savedTaskId = savedTaskIdEnc ? decodeURIComponent(savedTaskIdEnc) : undefined;
                        return scrollAnimFallbackHtml(_animTexts, _animVideoPrompt, _animStyle, savedTaskId);
                      })();
                  mergedHtml = safeReplaceScrollAnimPending(curHtml, fb);
                } else {
                  let tmp = curHtml;
                  for (const block of finishedBlocks) {
                    if (!tmp.includes('data-scroll-anim-pending="1"')) break;
                    tmp = safeReplaceScrollAnimPending(tmp, block);
                  }
                  mergedHtml = tmp;
                }
              } else if (isHollowCraftScrollAnim(curHtml) && finishedBlocks.length) {
                // Pending already gone but hero CSS/JS was stripped on a prior buggy merge — repair.
                console.warn(`[BG ANIM] Repairing hollow craft-scrollanim hero for project ${project.id}`);
                mergedHtml = replaceHollowCraftScrollAnim(curHtml, finishedBlocks);
              } else if (!curHtml.includes('data-craft-scrollanim') && finishedBlocks.length) {
                // Pending lost — inject first finished block after </header> or <body>
                const block = finishedBlocks[0];
                if (curHtml.includes("</header>")) {
                  mergedHtml = curHtml.replace("</header>", `</header>\n${block}`);
                } else if (/<body[^>]*>/i.test(curHtml)) {
                  mergedHtml = curHtml.replace(/<body[^>]*>/i, (m) => `${m}\n${block}`);
                } else {
                  mergedHtml = block + curHtml;
                }
                console.warn(`[BG ANIM] Injected missing hero block for project ${project.id}`);
              } else {
                mergedHtml = curHtml;
              }
              await storage.updateProject(project.id, { generatedCode: mergedHtml });
              for (const [filename, code] of Array.from(bgFilesMap.entries())) {
                if (filename === "index.html" || !isHtmlPage(filename)) continue;
                await storage.upsertProjectFile({ projectId: project.id, filename, code });
              }
              console.log(`[BG ANIM] Done (attempt ${animAttempt + 1}) for project ${project.id} — frames: ${scrollResult.generated}, credits: ${scrollResult.creditsUsed}`);
              animSucceeded = true;
              break;
            } catch (bgErr: any) {
              console.error(`[BG ANIM] Error (attempt ${animAttempt + 1}) for project ${project.id}:`, bgErr?.message || bgErr);
            }
          }
          if (!animSucceeded) {
            // All attempts failed — replace pending with static fallback
            try {
              const curProj = await storage.getProject(project.id);
              const curHtml = curProj?.generatedCode || immediateHtml;
              const pendingTagM = curHtml.match(/<section[^>]*data-scroll-anim-pending="1"[^>]*>/);
              const pendingTag  = pendingTagM ? pendingTagM[0] : "";
              const savedTaskIdEnc = pendingTag.match(/data-scroll-anim-task-id="([^"]*)"/)?.[1] || "";
              const savedTaskId    = savedTaskIdEnc ? decodeURIComponent(savedTaskIdEnc) : undefined;
              const fallbackCode = hasAniMarkers
                ? safeReplaceScrollAnimPending(curHtml, buildAnimationalFallbackHtml(_aniInner))
                : safeReplaceScrollAnimPending(
                    curHtml,
                    scrollAnimFallbackHtml(_animTexts, _animVideoPrompt, _animStyle, savedTaskId),
                  );
              await storage.updateProject(project.id, { generatedCode: fallbackCode });
              console.warn(`[BG ANIM] All attempts failed for project ${project.id} — fallback saved${savedTaskId ? ` (task ${savedTaskId.slice(0,12)}… preserved)` : ""}`);
            } catch {}
          }
        })();
      }
    } catch (err: any) {
      console.error("Generation error:", err?.message || err);
      // Clear the generating placeholder so the user can retry (and polling stops).
      if (wroteGeneratingPlaceholder && generateProjectId) {
        try {
          const cur = await storage.getProject(generateProjectId);
          if (cur && isCraftGeneratingHtml(cur.generatedCode)) {
            await storage.updateProject(generateProjectId, { generatedCode: "" });
          }
        } catch {}
      }
      let refunded = false;
      try {
        if (genBilled && billedUserId && generationCost > 0 && isConfirmedKieApiFailure(err)) {
          await storage.refundCredits(billedUserId, generationCost, genIkeyForRefund);
          refunded = true;
          console.log(`[REFUND] site-generate: +${generationCost} tokens (confirmed KIE failure)`);
        } else if (genBilled) {
          console.log(`[REFUND-SKIP] site-generate: not a confirmed KIE failure — keeping charge (${err?.message?.slice(0, 120)})`);
        }
      } catch {}
      const _em = err?.message || "";
      const errMsg = (_em.includes("503") || _em.includes("UNAVAILABLE") || _em.includes("high demand"))
        ? "Сервер ИИ временно перегружен. Попробуйте через 30 секунд — мы уже сделали 3 попытки."
        : (_em.toLowerCase().includes("overloaded") || _em.includes("529") || _em.includes("overloaded_error"))
        ? "Серверы ИИ перегружены. Попробуйте снова через 5 минут."
        : (_em.includes("RATE_LIMIT") || _em.includes("429") || _em.includes("RESOURCE_EXHAUSTED") || _em.includes("quota"))
        ? "Превышен лимит запросов к Gemini API. Подождите 1-2 минуты и попробуйте снова."
        : _em.includes("RECITATION")
        ? "Ответ ИИ заблокирован из-за слишком похожего контента. Попробуйте переформулировать запрос."
        : _em.includes("SAFETY")
        ? "Ответ ИИ заблокирован фильтром безопасности. Попробуйте другой запрос."
        : (_em.includes("too long") || _em.includes("max_tokens"))
        ? "Ответ ИИ слишком длинный. Попробуйте более конкретный запрос для одной страницы."
        : (_em.includes("KIE Claude stream error") || err instanceof KieApiError)
        ? "Серверы ИИ временно недоступны. Попробуйте снова через несколько минут."
        : `Ошибка генерации: ${_em.substring(0, 150) || "неизвестная ошибка"}`;
      const freshBal = billedUserId ? (await storage.getUser(billedUserId))?.credits : undefined;
      const errPayload = {
        error: refunded ? `${errMsg} Токены возвращены (сбой KIE API).` : errMsg,
        newBalance: freshBal,
        refunded,
        refundAmount: refunded ? generationCost : 0,
      };
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify(errPayload)}\n\n`);
        res.end();
      } else {
        res.status(500).json({ message: errPayload.error, newBalance: freshBal, refunded, refundAmount: errPayload.refundAmount });
      }
    }
  });

  // ── Re-generate / repair scroll animation ───────────────────────────────────
  // Handles: fallback, pending, hollow craft-scrollanim (CSS/JS stripped), or
  // missing hero. Optional body.taskId resumes a completed KIE Kling job.
  app.post("/api/projects/:id/regen-animation", requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      const user = req.user as any;
      const project = await storage.getProject(projectId);
      if (!project || project.userId !== user.id) {
        return res.status(404).json({ message: "Проект не найден" });
      }
      let html = project.generatedCode || "";
      const bodyTaskId = typeof req.body?.taskId === "string" ? req.body.taskId.trim() : "";
      const bodyStyle = typeof req.body?.style === "string" ? req.body.style.trim() : "";
      const bodyPrompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
      const isPending = html.includes('data-scroll-anim-pending="1"');
      const isFallback = html.includes('data-scroll-anim-fallback="1"');
      const isHollow = isHollowCraftScrollAnim(html);
      const missingHero = !html.includes("data-craft-scrollanim") && !isPending && !isFallback;

      if (!isPending && !isFallback && !isHollow && !missingHero && !bodyTaskId) {
        return res.status(400).json({ message: "Анимация уже есть или сайт не интерактивный" });
      }

      // Prefer attrs from fallback/pending; allow body overrides for hollow repair.
      const tagMatch = html.match(/<section[^>]*data-scroll-anim-(?:fallback|pending)="1"[^>]*>/)
        || html.match(/<section[^>]*data-craft-scrollanim[^>]*>/);
      const tag = tagMatch ? tagMatch[0] : "";
      const promptRaw = tag.match(/data-scroll-anim-prompt="([^"]*)"/)?.[1] || "";
      const styleRaw = tag.match(/data-scroll-anim-style="([^"]*)"/)?.[1]
        || tag.match(/data-layout="([^"]*)"/)?.[1]
        || "";
      const taskIdRaw = tag.match(/data-scroll-anim-task-id="([^"]*)"/)?.[1] || "";
      const existingTaskId: string | undefined = bodyTaskId
        || (taskIdRaw ? decodeURIComponent(taskIdRaw) : undefined);
      const videoPrompt = bodyPrompt
        || (promptRaw ? decodeURIComponent(promptRaw) : "")
        || "breathtaking cinematic forward flight into the scene, volumetric god rays and drifting atmospheric haze, epic film-still lighting, photorealistic";
      const animStyle = bodyStyle
        || (styleRaw ? decodeURIComponent(styleRaw) : "")
        || "site3d";

      const animTexts: Array<{title: string; sub: string}> = [];
      if (Array.isArray(req.body?.texts)) {
        for (const t of req.body.texts) {
          animTexts.push({ title: String(t?.title || "").trim(), sub: String(t?.sub || "").trim() });
        }
      }
      if (!animTexts.length) {
        const textsEnc = tag.match(/data-scroll-anim-texts="([^"]*)"/)?.[1] || "";
        if (textsEnc) {
          for (const seg of decodeURIComponent(textsEnc).split("||")) {
            const [t, s] = seg.split("::");
            animTexts.push({ title: (t || "").trim(), sub: (s || "").trim() });
          }
        }
      }
      if (!animTexts.length) {
        const secMatch = html.match(/<section[^>]*data-scroll-anim-fallback="1"[\s\S]*?<\/section>/);
        if (secMatch) {
          const h2s = Array.from(secMatch[0].matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)).map(m => m[1].replace(/<[^>]+>/g, "").trim());
          const ps  = Array.from(secMatch[0].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)).map(m => m[1].replace(/<[^>]+>/g, "").trim());
          const n = Math.max(h2s.length, ps.length, 1);
          for (let i = 0; i < n; i++) animTexts.push({ title: h2s[i] || "", sub: ps[i] || "" });
        }
      }
      if (animTexts.length === 0) {
        animTexts.push(
          { title: "Новый уровень", sub: "Почувствуйте атмосферу бренда" },
          { title: "Суть предложения", sub: "То, что меняет опыт" },
          { title: "Ваш ход", sub: "Начните прямо сейчас" },
        );
      }

      const textsStr = animTexts.map(t => `${t.title}::${t.sub}`).join("||");
      const isAniRegen = animStyle === "animational" || html.includes('data-animational') || html.includes('data-animational-pending');
      const marker = isAniRegen
        ? `\n{{ANIMATIONAL:${videoPrompt.includes("|") ? videoPrompt : `${animTexts[0]?.title || "Studio"}|${animTexts[0]?.sub || "Создаём впечатления"}|#E8FF47|#0B0B0C|#F5F2EC|${videoPrompt}|atmospheric one,atmospheric two,atmospheric three,atmospheric four,atmospheric five,atmospheric six|${textsStr}|Обсудить проект`}}}\n`
        : `\n{{SCROLLANIM:${videoPrompt}|${textsStr}}}\n`;
      const pendingBlock = scrollAnimPendingHtml(animTexts, isAniRegen ? (videoPrompt.includes("|") ? videoPrompt : undefined) : videoPrompt, isAniRegen ? "animational" : animStyle)
        .replace(
          /(<section[^>]*data-scroll-anim-pending="1")/,
          existingTaskId && !isAniRegen
            ? `$1 data-scroll-anim-task-id="${encodeURIComponent(existingTaskId)}"`
            : "$1",
        );

      // Normalize HTML → pending placeholder + marker HTML for BG pipeline
      let pendingHtml = html;
      let markerHtml = html;
      if (isFallback) {
        pendingHtml = html.replace(/<section[^>]*data-scroll-anim-fallback="1"[\s\S]*?<\/section>/, pendingBlock);
        markerHtml = html.replace(/<section[^>]*data-scroll-anim-fallback="1"[\s\S]*?<\/section>/, marker);
      } else if (isPending) {
        pendingHtml = safeReplaceScrollAnimPending(html, pendingBlock);
        markerHtml = safeReplaceScrollAnimPending(html, marker);
      } else if (isHollow) {
        pendingHtml = replaceHollowCraftScrollAnim(html, [pendingBlock]);
        markerHtml = replaceHollowCraftScrollAnim(html, [marker]);
      } else {
        // Missing hero — inject after header
        if (html.includes("</header>")) {
          pendingHtml = html.replace("</header>", `</header>\n${pendingBlock}`);
          markerHtml = html.replace("</header>", `</header>\n${marker}`);
        } else if (/<body[^>]*>/i.test(html)) {
          pendingHtml = html.replace(/<body[^>]*>/i, (m) => `${m}\n${pendingBlock}`);
          markerHtml = html.replace(/<body[^>]*>/i, (m) => `${m}\n${marker}`);
        } else {
          pendingHtml = pendingBlock + html;
          markerHtml = marker + html;
        }
      }

      await storage.updateProject(projectId, { generatedCode: pendingHtml });
      res.json({ animPending: true, resumedTaskId: existingTaskId || null, style: animStyle });

      // ── Run video generation in background ──
      const runKey = `regen-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const bgMap = new Map<string, string>([["index.html", markerHtml]]);
      const noopRes = { write: () => {}, end: () => {} };
      const MAX_REGEN_ATTEMPTS = 2;
      const REGEN_RETRY_DELAY = 3 * 60 * 1000;
      const layout: ScrollAnimLayout = resolveScrollAnimLayout(animStyle);
      (async () => {
        let succeeded = false;

        // Fast path: resume completed Kling task (site3d / immersion / parallax / etc.)
        if (existingTaskId && layout !== "motion" && layout !== "animational") {
          console.log(`[REGEN ANIM] resuming from existing task ${existingTaskId} for project ${projectId}`);
          try {
            const scrollOutcome = await generateScrollFrames(
              videoPrompt, () => false, undefined, layout, undefined, existingTaskId,
            );
            const frames = scrollOutcome.frames;
            const videoUrl = scrollOutcome.videoUrl;
            const ready = ((layout === "site3d" || layout === "immersion") && !!videoUrl) || frames.length >= ((layout === "site3d" || layout === "immersion") ? 30 : 60);
            if (ready) {
              const canvasHtml = buildScrollAnimHtml(frames, animTexts, layout, videoUrl);
              let finalCode = safeReplaceScrollAnimPending(pendingHtml, canvasHtml);
              if (isHollowCraftScrollAnim(finalCode)) {
                finalCode = replaceHollowCraftScrollAnim(finalCode, [canvasHtml]);
              }
              finalCode = injectLoadingOverlay(finalCode);
              await storage.updateProject(projectId, { generatedCode: finalCode });
              console.log(`[REGEN ANIM] Resume done for project ${projectId} — ${videoUrl ? "video scrub" : frames.length + " frames"}`);
              succeeded = true;
            } else {
              console.warn(`[REGEN ANIM] Resume produced too few frames (${frames.length}) — falling through to full regen`);
            }
          } catch (resumeErr: any) {
            console.warn(`[REGEN ANIM] Resume failed:`, resumeErr?.message);
          }
        }

        if (!succeeded) {
          for (let attempt = 0; attempt < MAX_REGEN_ATTEMPTS; attempt++) {
            if (attempt > 0) {
              console.log(`[REGEN ANIM] Waiting ${REGEN_RETRY_DELAY / 60000} min before retry for project ${projectId}...`);
              await new Promise(r => setTimeout(r, REGEN_RETRY_DELAY));
              bgMap.set("index.html", markerHtml);
            }
            try {
              console.log(`[REGEN ANIM] Attempt ${attempt + 1}/${MAX_REGEN_ATTEMPTS} for project ${projectId}`);
              const result = isAniRegen
                ? await resolveAnimationalMarkers(bgMap, projectId, user.id, runKey, noopRes, () => false)
                : await resolveScrollAnimMarkers(bgMap, projectId, user.id, runKey, noopRes, () => false, undefined, animStyle);
              if (!result.generated) {
                console.warn(`[REGEN ANIM] attempt ${attempt + 1}: nothing generated`);
                continue;
              }
              const animatedCode = isAniRegen
                ? (bgMap.get("index.html") ?? pendingHtml)
                : injectLoadingOverlay(bgMap.get("index.html") ?? pendingHtml);
              const blocks = extractCraftScrollAnimBlocks(animatedCode);
              let finalCode = pendingHtml;
              const cur = await storage.getProject(projectId);
              const curHtml = cur?.generatedCode || pendingHtml;
              if (blocks.length && curHtml.includes('data-scroll-anim-pending="1"')) {
                let tmp = curHtml;
                for (const b of blocks) {
                  if (!tmp.includes('data-scroll-anim-pending="1"')) break;
                  tmp = safeReplaceScrollAnimPending(tmp, b);
                }
                finalCode = tmp;
              } else if (blocks.length && isHollowCraftScrollAnim(curHtml)) {
                finalCode = replaceHollowCraftScrollAnim(curHtml, blocks);
              } else if (blocks.length) {
                finalCode = animatedCode;
              } else {
                continue;
              }
              finalCode = injectLoadingOverlay(finalCode);
              await storage.updateProject(projectId, { generatedCode: finalCode });
              console.log(`[REGEN ANIM] Done (attempt ${attempt + 1}) for project ${projectId} — frames: ${result.generated}`);
              succeeded = true;
              break;
            } catch (err: any) {
              console.error(`[REGEN ANIM] Error (attempt ${attempt + 1}) for project ${projectId}:`, err?.message || err);
            }
          }
        }

        if (!succeeded) {
          try {
            const fallback = safeReplaceScrollAnimPending(
              pendingHtml,
              scrollAnimFallbackHtml(animTexts, videoPrompt, animStyle, existingTaskId),
            );
            await storage.updateProject(projectId, { generatedCode: fallback });
            console.warn(`[REGEN ANIM] All attempts failed for project ${projectId} — fallback written`);
          } catch {}
        }
      })();
    } catch (err: any) {
      console.error("regen-animation error:", err?.message);
      if (!res.headersSent) res.status(500).json({ message: err?.message || "Ошибка" });
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
      let confirmedKieFailure = false;
      try {
        const outcome = await generateScrollFrames(prompt, () => clientGone);
        frames = outcome.frames;
        confirmedKieFailure = outcome.confirmedKieFailure;
      } catch (genErr: any) {
        const refunded = await refundIfConfirmedKie(billed, user.id, SCROLL_ANIM_COST, saIkey, genErr, "scroll-assets");
        console.error("Scroll frame generation error:", genErr?.message || genErr);
        const bal = (await storage.getUser(user.id))?.credits;
        return res.status(502).json({
          message: refunded
            ? "Не удалось сгенерировать анимацию. Токены возвращены (сбой KIE API)."
            : "Не удалось сгенерировать анимацию.",
          newBalance: bal,
          refunded,
        });
      }
      if (frames.length < 60) {
        const refunded = await refundIfConfirmedKie(billed, user.id, SCROLL_ANIM_COST, saIkey, confirmedKieFailure, "scroll-assets-short");
        const bal = (await storage.getUser(user.id))?.credits;
        return res.status(502).json({
          message: refunded
            ? "Не удалось сгенерировать анимацию. Токены возвращены (сбой KIE API)."
            : "Не удалось сгенерировать анимацию.",
          newBalance: bal,
          refunded,
        });
      }

      const freshUser = await storage.getUser(user.id);
      res.json({
        frames,
        count: frames.length,
        creditsUsed: billed ? SCROLL_ANIM_COST : 0,
        creditBreakdown: { video: billed ? SCROLL_ANIM_COST : 0, total: billed ? SCROLL_ANIM_COST : 0 },
        newBalance: freshUser?.credits ?? deduction.newBalance,
      });
    } catch (err: any) {
      console.error("Scroll assets error:", err?.message || err);
      res.status(500).json({ message: `Ошибка генерации анимации: ${err?.message?.substring(0, 150) || "неизвестная ошибка"}` });
    }
  });

  app.post("/api/images/generate", requireAuth, aiLimiter, async (req, res) => {
    let billed = false;
    let imageCost = 15;
    let userId: number | undefined;
    let imgIkey = "";
    try {
      const IMAGE_COST = 15;
      imageCost = IMAGE_COST;
      const user = req.user as any;
      userId = user.id;

      const { prompt, aspectRatio = "16:9", outputFormat = "jpg", idempotencyKey, referenceImageUrls } = req.body;
      if (!prompt) {
        return res.status(400).json({ message: "Промпт обязателен" });
      }

      imgIkey = idempotencyKey || `img-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const deduction = await storage.deductCredits(user.id, IMAGE_COST, "image", imgIkey);
      if (!deduction.success) {
        return res.status(402).json({ message: `Недостаточно токенов. Нужно ${IMAGE_COST}, у вас ${deduction.newBalance}`, newBalance: deduction.newBalance });
      }
      billed = !deduction.alreadyProcessed;

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
          const gptResolution = aspectRatio === "auto" || aspectRatio === "1:1" ? "1K" : "1K";
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
          resolution: "1K",
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
        const kieFail = isConfirmedKieJobBodyFailure(createBody);
        if (billed && kieFail) {
          await refundIfConfirmedKie(true, user.id, IMAGE_COST, imgIkey, true, "image-create");
        } else if (billed) {
          console.log(`[REFUND-SKIP] image-create: body.code=${createBody?.code} — not confirmed KIE infra`);
        }
        const bal = (await storage.getUser(user.id))?.credits ?? deduction.newBalance;
        return res.status(500).json({
          message: createBody.msg || "Ошибка создания задачи",
          newBalance: bal,
          refunded: !!(billed && kieFail),
        });
      }

      console.log(`[Image] Task created with ${usedModel}, taskId=${createBody.data.taskId}`);
      if (billed && imgIkey) {
        pendingImageCharges.set(String(createBody.data.taskId), {
          userId: user.id,
          amount: IMAGE_COST,
          ikey: imgIkey,
          createdAt: Date.now(),
        });
      }
      res.json({
        taskId: createBody.data.taskId,
        model: usedModel,
        newBalance: deduction.newBalance,
        creditsUsed: billed ? IMAGE_COST : 0,
        creditBreakdown: { image: billed ? IMAGE_COST : 0, total: billed ? IMAGE_COST : 0 },
      });
    } catch (err: any) {
      console.error("Image generation error:", err);
      const refunded = await refundIfConfirmedKie(billed, userId, imageCost, imgIkey, err, "image-generate");
      const bal = userId ? (await storage.getUser(userId))?.credits : undefined;
      res.status(500).json({
        message: refunded
          ? "Ошибка генерации изображения. Токены возвращены (сбой KIE API)."
          : "Ошибка генерации изображения",
        newBalance: bal,
        refunded,
      });
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
        pendingImageCharges.delete(taskId);
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
        const failMsg = body.data.failMsg || "Ошибка генерации";
        const failCode = body.data.failCode;
        const pending = pendingImageCharges.get(taskId);
        let refunded = false;
        let newBalance: number | undefined;
        if (pending && pending.userId === (req.user as any).id) {
          pendingImageCharges.delete(taskId);
          if (isKieTaskInfraFailure(failMsg, failCode)) {
            refunded = await refundIfConfirmedKie(true, pending.userId, pending.amount, pending.ikey, true, "image-status-fail");
            newBalance = (await storage.getUser(pending.userId))?.credits;
          } else {
            console.log(`[REFUND-SKIP] image-status-fail: moderation/unknown — failMsg="${failMsg}" failCode="${failCode}"`);
          }
        }
        return res.json({
          state: "fail",
          error: refunded ? `${failMsg}. Токены возвращены (сбой KIE API).` : failMsg,
          refunded,
          newBalance,
        });
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
        const r = await safeFetch(url, { redirect: "error", signal: controller.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        mimeType = r.headers.get("content-type") || "image/jpeg";
        const mime = mimeType.split(";")[0].trim().toLowerCase();
        if (!["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"].includes(mime)) {
          return res.status(400).json({ message: "Разрешены только PNG/JPEG/WebP/GIF" });
        }
        mimeType = mime === "image/jpg" ? "image/jpeg" : mime;
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

  // ── Video-to-Scroll-Animation pipeline ────────────────────────────────────────
  // List section labels from the current project HTML so the client can show a picker.
  app.get("/api/projects/:id/sections", requireAuth, async (req: any, res) => {
    const projectId = parseInt(req.params.id);
    const project = await storage.getProject(projectId);
    if (!project || project.userId !== req.user!.id) return res.status(403).json({ message: "Нет доступа" });
    const html = project.generatedCode || "";
    const labels: string[] = [];
    const re = /<section([^>]*)>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const attrs = m[1] || "";
      const id = (attrs.match(/id=["']([^"']+)["']/) || [])[1];
      const cls = (attrs.match(/class=["']([^"']+)["']/) || [])[1];
      const tag = id ? `#${id}` : cls ? `.${cls.split(" ")[0]}` : "";
      labels.push(`Секция ${labels.length + 1}${tag ? " " + tag : ""}`);
    }
    if (labels.length === 0) labels.push("Начало сайта");
    const hasExistingAnim = html.includes('data-craft-scrollanim="1"');
    return res.json({ sections: labels, hasExistingAnim });
  });

  // Upload a video, extract ~90 frames with ffmpeg, store as WebP in Object Storage.
  app.post("/api/projects/:id/video-frames", requireAuth, upload.single("video"), async (req: any, res) => {
    const projectId = parseInt(req.params.id);
    const project = await storage.getProject(projectId);
    if (!project || project.userId !== req.user!.id) return res.status(403).json({ message: "Нет доступа" });

    const file = req.file;
    if (!file) return res.status(400).json({ message: "Видео не загружено" });
    if (!file.mimetype.startsWith("video/") && !/\.(mp4|webm|mov|mpeg|ogg|avi)$/i.test(file.originalname)) {
      return res.status(400).json({ message: "Неподдерживаемый формат. Загрузите mp4, webm или mov." });
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "videoframe-"));
    const videoPath = path.join(tmpDir, "input.mp4");
    const framesDir = path.join(tmpDir, "frames");
    try {
      fs.writeFileSync(videoPath, file.buffer);
      fs.mkdirSync(framesDir, { recursive: true });

      const ffmpegMod = (await import("fluent-ffmpeg")).default as any;
      await ensureFfmpegPath(ffmpegMod);

      // Probe duration so we can normalise to ~90 frames regardless of length
      const duration = await new Promise<number>((resolve) => {
        ffmpegMod.ffprobe(videoPath, (err: any, meta: any) => {
          resolve(err ? 10 : (meta?.format?.duration ?? 10));
        });
      });

      const TARGET_FRAMES = 90;
      const fps = TARGET_FRAMES / Math.max(1, duration);
      console.log(`[VIDEO-FRAMES] duration=${duration.toFixed(1)}s fps=${fps.toFixed(3)} target=${TARGET_FRAMES}`);

      await extractFramesWithFfmpeg(videoPath, framesDir, Number(fps.toFixed(4)));

      const frameFiles = fs.readdirSync(framesDir).filter((f: string) => /\.jpg$/i.test(f)).sort();
      console.log(`[VIDEO-FRAMES] ffmpeg produced ${frameFiles.length} frames`);

      const urls: string[] = [];
      for (const f of frameFiles) {
        const raw = fs.readFileSync(path.join(framesDir, f));
        const url = await uploadToObjectStorage(raw, "image/jpeg", "jpg");
        urls.push(url);
      }
      return res.json({ frames: urls, count: urls.length });
    } catch (e: any) {
      console.error("[VIDEO-FRAMES] error:", e?.message);
      return res.status(500).json({ message: "Ошибка нарезки кадров: " + (e?.message || "неизвестная ошибка") });
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  // Inject a scroll-animation section into the project HTML after the chosen section index.
  app.post("/api/projects/:id/inject-scroll-anim", requireAuth, async (req: any, res) => {
    const projectId = parseInt(req.params.id);
    const project = await storage.getProject(projectId);
    if (!project || project.userId !== req.user!.id) return res.status(403).json({ message: "Нет доступа" });

    const { frames, insertAfterSection = 0, texts = [], replaceExisting = false } = req.body;
    if (!Array.isArray(frames) || frames.length === 0) return res.status(400).json({ message: "Нет кадров" });

    const html = project.generatedCode || "";
    if (!html.trim()) return res.status(400).json({ message: "Сайт ещё не сгенерирован" });

    // Helper: find the start/end of the Nth top-level <section> (handles nested sections)
    function findTopLevelSection(src: string, targetIdx: number): { start: number; end: number } | null {
      const tagRe = /(<section(?:\s[^>]*)?>|<\/section>)/gi;
      let depth = 0, foundIdx = 0, secStart = -1;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(src)) !== null) {
        const isOpen = !m[0].startsWith("</");
        if (isOpen) {
          if (depth === 0) {
            if (foundIdx === targetIdx) secStart = m.index;
            depth = 1;
          } else {
            depth++;
          }
        } else {
          depth--;
          if (depth === 0) {
            if (foundIdx === targetIdx && secStart >= 0) {
              return { start: secStart, end: m.index + m[0].length };
            }
            foundIdx++;
            secStart = -1;
          }
        }
      }
      return null;
    }

    // Helper: strip HTML tags to plain text
    function stripTags(s: string): string {
      return s.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
    }

    // Helper: extract overlay texts from a hero section's HTML
    function extractHeroTexts(sectionHtml: string): Array<{ title: string; sub: string }> {
      const h1raw = (sectionHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "";
      const h2raw = (sectionHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || "";
      const pSubRaw = (sectionHtml.match(/<p[^>]*class="[^"]*(?:subtitle|sub|lead|desc)[^"]*"[^>]*>([\s\S]*?)<\/p>/i) || [])[1]
                   || (sectionHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || "";
      const title = stripTags(h1raw).slice(0, 90);
      const sub = stripTags(h2raw || pSubRaw).slice(0, 140);
      if (!title && !sub) return [];
      return [{ title, sub }];
    }

    let newHtml: string;

    if (replaceExisting) {
      // "Replace existing" means: replace the Hero (first section) with the animation.
      // Also remove any separate scroll-anim section that exists below.
      let working = html;

      // 1. Remove any existing data-craft-scrollanim section (separate from hero)
      working = working.replace(/<section[^>]*data-craft-scrollanim="1"[\s\S]*?<\/section>/g, "");

      // 2. Find the first section (Hero) in the updated HTML
      const hero = findTopLevelSection(working, 0);
      if (hero) {
        const heroHtml = working.slice(hero.start, hero.end);
        // Use passed texts if provided, otherwise auto-extract from Hero
        const overlayTexts: Array<{ title: string; sub: string }> = (texts && texts.length > 0)
          ? texts
          : extractHeroTexts(heroHtml);
        const animHtml = buildScrollAnimHtml(frames, overlayTexts.length ? overlayTexts : [{ title: "", sub: "" }], "parallax");
        // Replace hero section with animation
        newHtml = working.slice(0, hero.start) + animHtml + working.slice(hero.end);
      } else {
        // No sections at all — prepend animation before </body>
        const animHtml = buildScrollAnimHtml(frames, texts.length ? texts : [], "parallax");
        const bodyClose = working.lastIndexOf("</body>");
        newHtml = bodyClose >= 0
          ? working.slice(0, bodyClose) + "\n" + animHtml + "\n" + working.slice(bodyClose)
          : working + "\n" + animHtml;
      }
    } else {
      // Insert after the chosen section index
      const sectionEnds: number[] = [];
      const endRe = /<\/section>/gi;
      let em;
      while ((em = endRe.exec(html)) !== null) sectionEnds.push(em.index + em[0].length);

      const animHtml = buildScrollAnimHtml(frames, texts, "parallax");
      let insertPos: number;
      if (sectionEnds.length === 0) {
        const bodyClose = html.lastIndexOf("</body>");
        insertPos = bodyClose >= 0 ? bodyClose : html.length;
      } else {
        const idx = Math.max(0, Math.min(Number(insertAfterSection), sectionEnds.length - 1));
        insertPos = sectionEnds[idx];
      }
      newHtml = html.slice(0, insertPos) + "\n" + animHtml + "\n" + html.slice(insertPos);
    }

    // Wire up the reliable preloader-hide script so the loader can't get stuck.
    newHtml = injectLoadingOverlay(newHtml);

    // Save version before modifying
    await storage.createProjectVersion({ projectId, code: html, label: "До: Вставка видео-анимации" });
    await storage.updateProject(projectId, { generatedCode: newHtml });

    return res.json({ code: newHtml });
  });

  // WaveSpeed 3D model generation
  app.post("/api/3d/generate", requireAuth, aiLimiter, async (req, res) => {
    let billed = false;
    let userId: number | undefined;
    let ikey = "";
    try {
      const user = req.user as any;
      userId = user.id;
      const { imageUrl, enablePbr = false, generateType = "Normal", faceCount = 500000, idempotencyKey } = req.body;
      if (!imageUrl) {
        return res.status(400).json({ message: "URL изображения обязателен" });
      }
      if (!WAVESPEED_API_KEY) {
        return res.status(500).json({ message: "WAVESPEED_API_KEY не настроен" });
      }

      ikey = idempotencyKey || `3d-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const deduction = await storage.deductCredits(user.id, MODEL_3D_COST, "3d", ikey);
      if (!deduction.success) {
        return res.status(402).json({ message: `Недостаточно токенов. Нужно ${MODEL_3D_COST}, у вас ${deduction.newBalance}`, newBalance: deduction.newBalance });
      }
      billed = !deduction.alreadyProcessed;

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
        if (billed) { try { await storage.refundCredits(user.id, MODEL_3D_COST, ikey); } catch {} }
        return res.status(500).json({ message: createBody?.error?.message || createBody?.detail || createBody?.message || "Ошибка создания 3D задачи" });
      }

      res.json({
        taskId,
        statusUrl: taskData.urls?.get || `${WAVESPEED_3D_URL}/${taskId}`,
        newBalance: deduction.newBalance,
      });
    } catch (err: any) {
      console.error("[WaveSpeed 3D] generate error:", err);
      if (billed && userId) { try { await storage.refundCredits(userId, MODEL_3D_COST, ikey); } catch {} }
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
        ...files.filter(f => isPublishableProjectFile(f.filename)),
      ];

      const indexCode = project.generatedCode || "";
      const navMatch = indexCode.match(/<nav[^>]*>[\s\S]*?<\/nav>/i);
      if (!navMatch) return res.json({ success: true, message: "Nav not found" });

      const pageTitles: Record<string, string> = req.body?.pageTitles || {};
      const subPages = files.filter(f => isPublishableProjectFile(f.filename));

      // ── Ghost cleanup: earlier buggy syncs added a raw <a href="index.html">Index</a>
      //    link (index treated as a "missing page"). Strip any such ghost from EVERY page.
      const ghostRe = /\s*<a\b[^>]*href=["']index\.html["'][^>]*>\s*index\s*<\/a>/gi;

      // 1) Clean the ghost out of the index nav, then parse its links.
      const cleanIndexNav = navMatch[0].replace(ghostRe, "");
      const existingLinks: { href: string; text: string; full: string }[] = [];
      const linkRegex = /<a\s[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = linkRegex.exec(cleanIndexNav)) !== null) {
        existingLinks.push({ href: m[1], text: m[2], full: m[0] });
      }

      // 2) Which real sub-pages have no nav link yet? (index.html is NEVER added as a link —
      //    the homepage is reached via the logo / section links, not a raw "Index" item.)
      const missingPages = subPages.filter(
        p => !existingLinks.some(l => l.href.replace(/^\.\//, "").split("#")[0] === p.filename)
      );

      // 3) Build the canonical header nav (index-context hrefs) with missing sub-page links appended.
      let newNavLinks = "";
      for (const mp of missingPages) {
        const label = mp.filename.replace(/\.html$/, "");
        const displayName = pageTitles[mp.filename] || label.charAt(0).toUpperCase() + label.slice(1);
        if (existingLinks.length > 0) {
          const sample = existingLinks[existingLinks.length - 1].full;
          const newLink = sample
            .replace(/href=["'][^"']*["']/, `href="${mp.filename}"`)
            .replace(/>[\s\S]*?<\/a>/, `>${displayName}</a>`);
          newNavLinks += "\n                " + newLink;
        } else {
          newNavLinks += `\n                <a href="${mp.filename}">${displayName}</a>`;
        }
      }
      let canonicalNav = cleanIndexNav;
      if (newNavLinks) {
        const lastLinkIdx = cleanIndexNav.lastIndexOf("</a>");
        if (lastLinkIdx !== -1) {
          const insertPos = lastLinkIdx + 4;
          canonicalNav = cleanIndexNav.slice(0, insertPos) + newNavLinks + cleanIndexNav.slice(insertPos);
        }
      }
      const canonicalInner = canonicalNav.replace(/^<nav[^>]*>/i, "").replace(/<\/nav>\s*$/i, "");

      // 4) Collect element ids that exist on the homepage — these are the valid targets for
      //    cross-page section links (e.g. #cases → index.html#cases from a sub-page).
      const collectIds = (code: string): Set<string> => {
        const ids = new Set<string>();
        const re = /\bid\s*=\s*["']([^"']+)["']/gi;
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(code)) !== null) ids.add(mm[1]);
        return ids;
      };
      const indexIds = collectIds(indexCode);

      // Rewrite every href so navigation works from `filename`'s context.
      //  - sub-page:  #section → index.html#section  (only for sections that live on the homepage
      //               and are NOT present on this page), index.html#x stays absolute.
      //  - index:     index.html#section → #section  (smooth in-page scroll, no full reload).
      // Root-absolute (/…), external, mailto/tel, bare "#" and other .html pages are left intact.
      const fixHrefs = (code: string, filename: string): string => {
        const isIndex = filename === "index.html";
        const pageIds = isIndex ? indexIds : collectIds(code);
        const transform = (raw: string): string | null => {
          const v = raw.trim();
          if (!v || v === "#") return null;
          if (/^(https?:|mailto:|tel:|data:|\/\/|\/)/i.test(v)) return null;
          if (v.startsWith("#")) {
            const id = v.slice(1);
            if (!id || isIndex) return null;
            if (indexIds.has(id) && !pageIds.has(id)) return "index.html#" + id;
            return null;
          }
          const idxM = v.match(/^index\.html(#([\w-]+))?$/i);
          if (idxM) return isIndex ? (idxM[2] ? "#" + idxM[2] : null) : null;
          return null;
        };
        return code
          .replace(/href\s*=\s*"([^"]*)"/gi, (full, h) => { const t = transform(h); return t === null ? full : `href="${t}"`; })
          .replace(/href\s*=\s*'([^']*)'/gi, (full, h) => { const t = transform(h); return t === null ? full : `href='${t}'`; });
      };

      // 5) Apply to every page: strip ghosts, swap the header nav for the canonical menu
      //    (preserving that page's own <nav …> opening tag), then fix all hrefs for its context.
      let updatedCount = 0;
      for (const page of allPages) {
        let code = page.code.replace(ghostRe, "");
        const pageNavMatch = code.match(/<nav[^>]*>[\s\S]*?<\/nav>/i);
        if (pageNavMatch) {
          const openTag = pageNavMatch[0].match(/^<nav[^>]*>/i)?.[0] || "<nav>";
          // Use a replacer function so any `$`-sequences in the nav HTML aren't expanded.
          code = code.replace(pageNavMatch[0], () => openTag + canonicalInner + "</nav>");
        }
        code = fixHrefs(code, page.filename);
        if (code === page.code) continue;

        if (page.filename === "index.html") {
          await storage.updateProject(project.id, { generatedCode: code });
        } else {
          await storage.upsertProjectFile({ projectId: project.id, filename: page.filename, code });
        }
        updatedCount++;
      }

      res.json({ success: true, updated: updatedCount });
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
        return res.status(403).json({ message: "Недостаточно токенов для публикации. Ежедневная стоимость хостинга — 35 токенов/сайт в день." });
      }

      const alreadyLive = project.publishStatus === "published" || project.publishStatus === "publishing" || project.publishStatus === "suspended";

      // Serialize publish charges per user to prevent concurrent double-charges
      await db.execute(sql`SELECT pg_advisory_lock(${1000000 + user.id})`);
      try {
      // Charge first hosting day on new publish (daily cron continues afterwards)
      if (!alreadyLive) {
        const today = new Date().toISOString().slice(0, 10);
        const publishCharge = await storage.deductCredits(
          user.id,
          DAILY_PUBLISH_COST,
          "daily_publish",
          `publish-start-${projectId}-${today}`,
        );
        if (!publishCharge.success) {
          return res.status(403).json({
            message: "Недостаточно токенов для публикации. Ежедневная стоимость хостинга — 35 токенов/сайт в день.",
            newBalance: publishCharge.newBalance,
          });
        }
      }

      await storage.updateProject(projectId, { publishStatus: "publishing" });
      } finally {
        try { await db.execute(sql`SELECT pg_advisory_unlock(${1000000 + user.id})`); } catch {}
      }

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
        // Self-heal older interactive sites: ensure ancestors of the scroll-animation
        // never break position:sticky via overflow-x:hidden (convert hidden→clip at runtime).
        if (/data-craft-scrollanim/.test(result)) {
          result = result.replace(/<script[^>]*data-craft-stickyfix[^>]*>[\s\S]*?<\/script>/gi, "");
          const stickyFix = `<script data-craft-stickyfix>(function(){function f(){var s=document.querySelectorAll('[data-craft-scrollanim]');if(!s.length)return;for(var i=0;i<s.length;i++){var el=s[i];while(el&&el.nodeType===1&&el!==document.documentElement){var cs=getComputedStyle(el);if(cs.overflowX==='hidden')el.style.overflowX='clip';if(cs.overflowY==='hidden')el.style.overflowY='clip';el=el.parentElement;}}var de=document.documentElement,b=document.body;[de,b].forEach(function(n){if(!n)return;var c=getComputedStyle(n);if(c.overflowX==='hidden')n.style.overflowX='clip';if(c.overflowY==='hidden')n.style.overflowY='clip';});}if(document.readyState!=='loading')f();else document.addEventListener('DOMContentLoaded',f);})();<\/script>`;
          if (result.includes("</body>")) result = result.replace("</body>", stickyFix + "</body>");
          else result += stickyFix;
        }
        return result;
      }

      let mainHtml = project.generatedCode;
      for (const img of projectImages) {
        mainHtml = mainHtml.replace(new RegExp(`\\{\\{IMG:${img.name}\\}\\}`, "g"), img.url);
      }
      // Only inject preloader for sites that have scroll-animation sections.
      if (mainHtml.includes('data-craft-scrollanim')) {
        mainHtml = injectLoadingOverlay(mainHtml);
      }
      mainHtml = injectLeadsScript(mainHtml);
      files.push({ filename: "index.html", content: mainHtml });

      for (const f of extraFiles) {
        if (!isPublishableProjectFile(f.filename)) continue;
        let code = f.code;
        for (const img of projectImages) {
          code = code.replace(new RegExp(`\\{\\{IMG:${img.name}\\}\\}`, "g"), img.url);
        }
        code = injectLeadsScript(code);
        files.push({ filename: f.filename, content: code });
      }

      // Download and bundle ALL locally-hosted media (images, video, audio, 3D models)
      // referenced via /objects/... or /uploads/... so they work on the deployed site.
      // Also catches absolute same-origin URLs like https://craft-ai.ru/objects/... that
      // are produced when Kling needs a public URL for the still image input.
      const publishAppBase = (process.env.APP_BASE_URL || "https://craft-ai.ru").replace(/\/$/, "");
      const allHtmlForScan = files.map(f => f.content || "").join("\n");
      // Collect animation-frame URLs (from data-frames arrays) — these must NEVER be
      // compressed; their crispness drives smooth scroll playback.
      const frameUrls = new Set<string>();
      {
        const framesAttrRe = /data-frames\s*=\s*'([^']*)'/gi;
        let fmatch: RegExpExecArray | null;
        while ((fmatch = framesAttrRe.exec(allHtmlForScan)) !== null) {
          try {
            const arr = JSON.parse(fmatch[1].replace(/&#39;/g, "'"));
            if (Array.isArray(arr)) arr.forEach((u: any) => { if (typeof u === "string") frameUrls.add(u); });
          } catch { /* ignore malformed frame arrays */ }
        }
      }
      const localMediaUrls = new Set<string>(); // stores RELATIVE paths only
      const absoluteToRelative = new Map<string, string>(); // absolute URL → relative path
      const mediaRegexes = [
        /(?:src|href|poster)\s*=\s*["'](\/(?:objects|uploads)\/[^"']+)["']/gi,
        /url\(\s*['"]?(\/(?:objects|uploads)\/[^"')]+?)['"]?\s*\)/gi,
        // Bare relative media URLs (e.g. scroll-animation frame arrays in data-frames / JS)
        /(\/(?:objects|uploads)\/[A-Za-z0-9._\/-]+?\.(?:webp|jpe?g|png|gif|avif|svg|mp4|webm|mov|ogg|glb|gltf))/gi,
        // Absolute same-origin URLs: https://craft-ai.ru/objects/...
        new RegExp(`${publishAppBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\/(?:objects|uploads)\\/[A-Za-z0-9._\\/-]+?\\.(?:webp|jpe?g|png|gif|avif|svg|mp4|webm|mov|ogg|glb|gltf))`, "gi"),
      ];
      for (let ri = 0; ri < mediaRegexes.length; ri++) {
        const rx = mediaRegexes[ri];
        let mm: RegExpExecArray | null;
        while ((mm = rx.exec(allHtmlForScan)) !== null) {
          if (ri === 3) {
            // Absolute URL match: mm[0]=full abs URL, mm[1]=relative path
            const absUrl = mm[0];
            const relPath = mm[1];
            localMediaUrls.add(relPath);
            absoluteToRelative.set(absUrl, relPath);
          } else {
            localMediaUrls.add(mm[1]);
          }
        }
      }
      console.log(`[Publish] Found ${localMediaUrls.size} local media URL(s) to bundle for project ${projectId}`);
      if (localMediaUrls.size > 0) {
        const mediaMap = new Map<string, string>(); // relative path → local asset path
        const usedNames = new Set<string>();
        let counter = 0;
        let bundledBytes = 0; // running total of bundled media bytes (for payload diagnostics)
        const publishObjStorage = new ObjectStorageService();
        for (const mediaUrl of Array.from(localMediaUrls)) {
          try {
            let buffer: Buffer | null = null;
            if (mediaUrl.startsWith("/objects/")) {
              // Try GCS SDK first (works in both dev and prod, no localhost dependency)
              try {
                const gcsFile = await publishObjStorage.getObjectEntityFile(mediaUrl);
                const [fileContent] = await gcsFile.download();
                buffer = fileContent as Buffer;
                console.log(`[Publish] GCS download OK: ${mediaUrl} (${buffer.length} bytes)`);
              } catch (sdkErr: any) {
                console.warn(`[Publish] GCS SDK failed for ${mediaUrl}: ${sdkErr?.message || sdkErr} — trying localhost fallback`);
                // Fallback: fetch via localhost (works in dev env)
                try {
                  const fetchUrl = `http://localhost:${process.env.PORT || 5000}${mediaUrl}`;
                  const mediaResp = await fetch(fetchUrl, { signal: AbortSignal.timeout(15000) });
                  if (mediaResp.ok) {
                    buffer = Buffer.from(await mediaResp.arrayBuffer());
                    console.log(`[Publish] Localhost fallback OK: ${mediaUrl} (${buffer.length} bytes)`);
                  } else {
                    console.warn(`[Publish] Localhost fallback ${mediaUrl} returned ${mediaResp.status}`);
                  }
                } catch (fetchErr: any) {
                  console.warn(`[Publish] Localhost fallback failed for ${mediaUrl}:`, fetchErr?.message);
                }
              }
            } else {
              // Legacy /uploads/ static path — use localhost fetch
              const fetchUrl = `http://localhost:${process.env.PORT || 5000}${mediaUrl}`;
              const mediaResp = await fetch(fetchUrl, { signal: AbortSignal.timeout(15000) });
              if (!mediaResp.ok) {
                console.warn(`[Publish] Media fetch ${mediaUrl} returned ${mediaResp.status}`);
                continue;
              }
              buffer = Buffer.from(await mediaResp.arrayBuffer());
            }
            if (!buffer) continue;
            // Compress raster images at publish to keep deployed pages light. Heavy
            // pages (especially multi-frame scroll animations) fail to load over
            // throttled foreign-CDN connections (e.g. Russian ISPs without a VPN),
            // which is why interactive sites showed broken images while light
            // description sites loaded fine. Animation frames are bundled at FULL quality
            // (no compression) — per user request, compressing them visibly degraded the
            // scroll animation. Only non-frame rasters (e.g. heavy product photos) go through
            // the ≤300KB compressor. GIFs (Sharp flattens animation), video, 3D and SVG are
            // left untouched.
            const isRaster = /\.(jpe?g|png|webp)$/i.test(mediaUrl.split("?")[0]);
            if (isRaster && !frameUrls.has(mediaUrl)) {
              const before = buffer.length;
              buffer = await compressImageForPublish(buffer);
              if (buffer.length !== before) {
                console.log(`[Publish] Compressed ${mediaUrl}: ${(before/1024).toFixed(0)}KB → ${(buffer.length/1024).toFixed(0)}KB`);
              }
            }
            // Detect real format from magic bytes — Nano Banana returns PNG even when
            // requested as JPEG, so the stored file may have .jpg extension but PNG content.
            // Compression above may also have changed the format. Yandex Object Storage
            // assigns Content-Type from extension, so the extension must match the real bytes.
            let base = (mediaUrl.split("/").pop() || "").split("?")[0].replace(/[^a-zA-Z0-9._-]/g, "_");
            if (!base || base === "_") base = `asset_${counter}`;
            // Fix extension if actual format differs from file extension
            if (buffer.length >= 12) {
              const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
              const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
              const isWebp = buffer.slice(0,4).toString("ascii") === "RIFF" && buffer.slice(8,12).toString("ascii") === "WEBP";
              const isGif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
              // Always force the extension to match the real bytes (covers PNG-as-jpg from
              // Nano Banana AND format changes from compression, e.g. png→webp / png→jpg).
              const realExt = isPng ? "png" : isJpeg ? "jpg" : isWebp ? "webp" : isGif ? "gif" : null;
              if (realExt && !new RegExp(`\\.${realExt === "jpg" ? "jpe?g" : realExt}$`, "i").test(base)) {
                base = /\.[^.]+$/.test(base) ? base.replace(/\.[^.]+$/, `.${realExt}`) : `${base}.${realExt}`;
              }
            }
            let fileName = base;
            while (usedNames.has(fileName)) { fileName = `${counter}_${base}`; counter++; }
            usedNames.add(fileName);
            counter++;
            const localPath = `assets/${fileName}`;
            files.push({ filename: localPath, contentBuffer: buffer });
            bundledBytes += buffer.length;
            mediaMap.set(mediaUrl, localPath);
          } catch (err) {
            console.warn(`[Publish] Could not bundle media ${mediaUrl}:`, err);
          }
        }
        console.log(`[Publish] Bundled ${mediaMap.size}/${localMediaUrls.size} media file(s) for project ${projectId} — total media payload ${(bundledBytes / 1024 / 1024).toFixed(1)} MB`);
        // Rewrite references in ALL html pages: relative paths AND their absolute counterparts
        for (const f of files) {
          if (!f.content) continue;
          // Rewrite absolute same-origin URLs first (longer strings → no partial clobber)
          for (const [absUrl, relPath] of Array.from(absoluteToRelative.entries())) {
            const localPath = mediaMap.get(relPath);
            if (localPath) f.content = f.content.split(absUrl).join(localPath);
          }
          // Then rewrite relative paths
          for (const [relPath, localPath] of Array.from(mediaMap.entries())) {
            f.content = f.content.split(relPath).join(localPath);
          }
        }
      }

      // Deploys to the project bucket AND (if a custom domain is attached)
      // mirrors into the domain-named bucket served by the Caddy proxy.
      const { url, yandexProjectId, ycStoragePoolId } = await deployToYandex(
        projectId,
        files,
        project.customDomain,
        project.ycStoragePoolId,
      );

      await storage.updateProject(projectId, {
        publishStatus: "published",
        publishedUrl: url,
        vercelProjectId: yandexProjectId,
        ycStoragePoolId,
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
      if (!domain || typeof domain !== "string") return res.status(400).json({ message: "Домен обязателен" });
      // Convert IDN (e.g. Cyrillic .рф) to ASCII/punycode — that is what Yandex CDN & the cert need.
      const normalizedDomain = domainToASCII(domain.trim().toLowerCase());
      const DOMAIN_RE = /^(?!-)(?:[a-z0-9-]{1,63}(?<!-)\.)+(?:[a-z]{2,}|xn--[a-z0-9-]{2,})$/;
      if (!normalizedDomain || !DOMAIN_RE.test(normalizedDomain) || normalizedDomain.length > 253) {
        return res.status(400).json({ message: "Некорректный домен. Пример: example.ru или мойсайт.рф" });
      }
      if (!project.vercelProjectId) return res.status(400).json({ message: "Сначала опубликуйте сайт" });

      // A domain can belong to only one project — otherwise the Caddy "ask"
      // endpoint and the domain bucket would be ambiguous.
      const apexDomain = normalizedDomain.replace(/^www\./, "");
      const existing = await storage.getProjectByCustomDomain(apexDomain);
      if (existing && existing.id !== projectId) {
        return res.status(409).json({ message: "Этот домен уже привязан к другому проекту" });
      }

      const oldDomain = project.customDomain;
      if (oldDomain && oldDomain.replace(/^www\./, "") !== apexDomain) {
        removeCustomDomain(oldDomain, project.ycStoragePoolId).catch((e) =>
          console.warn("[domain change] cleanup old domain non-fatal:", e),
        );
      }
      const result = await addCustomDomain(
        project.vercelProjectId,
        apexDomain,
        project.ycStoragePoolId,
      );
      await storage.updateProject(projectId, {
        customDomain: apexDomain,
        ycStoragePoolId: result.ycStoragePoolId,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Ошибка добавления домена" });
    }
  });

  // Public "ask" endpoint for the Caddy proxy's on-demand TLS: Caddy calls
  // GET /api/domains/check?domain=<host> before issuing a certificate.
  // 200 = issue/renew the cert, 404 = refuse. Must return 200 for both the
  // apex and www forms, and ALSO for suspended sites (their certs still need
  // renewal — the domain bucket serves the "suspended" placeholder).
  app.get("/api/domains/check", async (req, res) => {
    try {
      const raw = ((req.query.domain as string) || "").toLowerCase().split(":")[0].trim();
      if (!raw || raw.length > 253 || !/^[a-z0-9.-]+$/.test(raw)) return res.sendStatus(404);
      const apex = raw.replace(/^www\./, "");
      // Only apex and www.<apex> are supported — refuse deeper subdomains.
      if (raw !== apex && raw !== `www.${apex}`) return res.sendStatus(404);
      const project = await storage.getProjectByCustomDomain(apex);
      if (!project) return res.sendStatus(404);
      return res.sendStatus(200);
    } catch {
      return res.sendStatus(404);
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
      const result = await checkDomainStatus(domain as string);
      res.json({ ...result, aRecordIp: getDomainProxyIp() });
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
        const response = await safeFetch(imageUrl, { redirect: "error", signal: controller.signal });
        if (!response.ok) throw new Error("Не удалось загрузить изображение");
        contentType = response.headers.get("content-type") || "application/octet-stream";
        const mime = contentType.split(";")[0].trim().toLowerCase();
        if (!["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"].includes(mime)) {
          return res.status(400).json({ message: "Разрешены только PNG/JPEG/WebP/GIF" });
        }
        buffer = Buffer.from(await response.arrayBuffer());
        contentType = mime === "image/jpg" ? "image/jpeg" : mime;
      } finally {
        clearTimeout(timeout);
      }
      if (buffer.length > 15 * 1024 * 1024) {
        return res.status(413).json({ message: "Изображение слишком большое" });
      }
      res.setHeader("Content-Type", contentType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "inline");
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

      await unpublishFromYandex(projectId, project.customDomain, project.ycStoragePoolId);
      // Voluntary unpublish frees the plan slot → "draft". "suspended" is reserved for
      // billing suspension (insufficient balance), which legitimately keeps holding a slot.
      await storage.updateProject(projectId, { publishStatus: "draft" });

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
      console.log("[Payment Webhook]", JSON.stringify({ order_id, status, merchant_price, test, has_user_data: !!user_data }));

      // Reject provider test/sandbox webhooks in production
      if (test === true || test === 1 || test === "1" || test === "true") {
        console.warn("[Payment] Rejected test webhook");
        return res.json({ status: "ok" });
      }

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

      if (parsed.userId !== order.userId) {
        console.error("Payment webhook userId mismatch for order:", parsed.orderId);
        return res.json({ status: "ok" });
      }

      const apiKey = process.env.ONEPAYMENT_API_KEY || "";
      const expectedHash = crypto.createHash("md5").update(`${parsed.orderId}:${parsed.userId}:${apiKey}`).digest("hex");
      if (parsed.v !== expectedHash) {
        console.error("Payment webhook signature mismatch for order:", parsed.orderId);
        return res.json({ status: "ok" });
      }

      if (order_id && order.orderId && String(order_id) !== String(order.orderId)) {
        console.error(`Payment order_id mismatch for ${order.id}: stored ${order.orderId}, got ${order_id}`);
        return res.json({ status: "ok" });
      }

      if (order.status === "paid") {
        return res.json({ status: "ok" });
      }

      if (Number(status) === 3) {
        // Paid webhooks must include merchant_price matching the stored order amount.
        if (merchant_price === undefined || merchant_price === null || String(merchant_price).trim() === "") {
          console.error(`Payment webhook missing merchant_price for order ${order.id}`);
          return res.json({ status: "ok" });
        }
        const paid = Math.round(Number(merchant_price));
        if (!Number.isFinite(paid) || paid !== order.amount) {
          console.error(`Payment amount mismatch order ${order.id}: expected ${order.amount}, got ${merchant_price}`);
          return res.json({ status: "ok" });
        }

        await storage.updatePaymentOrderStatus(order.id, "paid", order_id, new Date());

        const user = await storage.getUser(order.userId);
        if (user) {
          await storage.creditPayment(
            order.userId,
            order.tokens,
            `payment_${order.id}`,
            `Оплата ${order.amount}₽ — ${order.tokens} токенов`,
          );
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
          // Exactly-once, atomic (see webhook path).
          await storage.creditPayment(
            order.userId,
            order.tokens,
            `payment_${order.id}`,
            `Оплата ${order.amount}₽ — ${order.tokens} токенов`,
          );
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

  const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || "661325490";
  const adminOnly = (req: any, res: any, next: any) => {
    if (!req.user) return res.status(403).json({ message: "Forbidden" });
    const adminIds = (process.env.ADMIN_USER_IDS || "")
      .split(",")
      .map((s: string) => parseInt(s.trim(), 10))
      .filter((n: number) => Number.isFinite(n) && n > 0);
    const isAdmin =
      adminIds.includes(req.user.id)
      || (ADMIN_TELEGRAM_ID && req.user.telegramId === ADMIN_TELEGRAM_ID)
      // Legacy: only if ADMIN_USER_IDS unset — prefer setting ADMIN_USER_IDS in prod
      || (adminIds.length === 0 && req.user.id === 1);
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
            await unpublishFromYandex(proj.id, proj.customDomain, proj.ycStoragePoolId);
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

  // ── Stuck-animation cleanup (startup + periodic) ──────────────────────────
  // If the server was restarted while a background animation pipeline was running,
  // the fire-and-forget task is killed and the DB keeps the pending spinner forever.
  // We clean up on boot AND every 30 minutes so restarts are no longer the only chance.
  // Uses safeReplaceScrollAnimPending (string-search, no regex backtracking) so it
  // reliably works even on large HTML files (50-100 KB) without Node.js hanging.
  // ── One-time migration: replace scroll-jacking JS with passive scroll ────────
  // Finds all projects whose stored HTML still has the old scroll-jacking block
  // (identified by the unique comment marker) and rewrites it to passive scroll.
  // Runs once at startup. Safe to re-run — projects without the marker are skipped.
  async function migrateScrollJackingToPassive() {
    const JACKING_MARKER = '// \u2500\u2500 Scroll-jacking: lock page scroll while animation plays \u2500\u2500';
    const PASSIVE_BLOCK =
      '    // \u2500\u2500 Passive scroll-driven progress (no scroll-jacking) \u2500\u2500\n' +
      '    function secTop(){return root.getBoundingClientRect().top+(window.pageYOffset||document.documentElement.scrollTop);}\n' +
      '    function totH(){return Math.max(1,root.offsetHeight-window.innerHeight);}\n' +
      '    function syncScroll(){var s=secTop(),t=totH(),top=window.pageYOffset||document.documentElement.scrollTop;setP((top-s)/t);}\n' +
      '    window.addEventListener(\'scroll\',syncScroll,{passive:true});\n';
    const RESIZE_ANCHOR = '    window.addEventListener(\'resize\',resize);';

    try {
      // Use raw SQL LIKE to avoid loading every project
      const { projects } = await import("@shared/schema");
      const { ilike } = await import("drizzle-orm");
      const rows = await db.select({ id: projects.id, generatedCode: projects.generatedCode })
        .from(projects)
        .where(ilike(projects.generatedCode, '%Scroll-jacking: lock page scroll while animation plays%'));

      if (!rows.length) return;
      console.log(`[Migration] Patching scroll-jacking → passive scroll in ${rows.length} project(s)`);

      for (const row of rows) {
        let html = row.generatedCode || "";
        let changed = false;
        // There may be up to 2 occurrences (parallax + split), process both
        let searchFrom = 0;
        for (let pass = 0; pass < 3; pass++) {
          const jackStart = html.indexOf(JACKING_MARKER, searchFrom);
          if (jackStart === -1) break;
          const resizeIdx = html.indexOf(RESIZE_ANCHOR, jackStart);
          if (resizeIdx === -1) break;
          html = html.slice(0, jackStart) + PASSIVE_BLOCK + html.slice(resizeIdx);
          searchFrom = jackStart + PASSIVE_BLOCK.length;
          changed = true;
        }
        if (changed) {
          await storage.updateProject(row.id, { generatedCode: html });
          console.log(`[Migration] Patched project ${row.id}`);
        }
      }
    } catch (e: any) {
      console.warn('[Migration] scroll-jacking patch failed:', e?.message);
    }
  }

  async function cleanupStuckPendingAnims(label: string) {
    try {
      const allProjects = await storage.getAllProjectsWithPendingAnim();
      if (!allProjects || allProjects.length === 0) return;
      console.log(`[${label}] Found ${allProjects.length} project(s) with stuck animation placeholder — replacing with fallback`);
      for (const proj of allProjects) {
        try {
          const html = proj.generatedCode || "";
          // Recover prompt/style/texts embedded in the pending section (if any) so the
          // fallback keeps enough info for the "Повторить анимацию" button to re-run correctly.
          const pendingTagMatch = html.match(/<section[^>]*data-scroll-anim-pending="1"[^>]*>/);
          const pendingTag = pendingTagMatch ? pendingTagMatch[0] : "";
          const _savedPromptEnc = pendingTag.match(/data-scroll-anim-prompt="([^"]*)"/)?.[1] || "";
          const _savedStyleEnc  = pendingTag.match(/data-scroll-anim-style="([^"]*)"/)?.[1]  || "";
          const _savedTextsEnc  = pendingTag.match(/data-scroll-anim-texts="([^"]*)"/)?.[1]  || "";
          const _savedTaskEnc   = pendingTag.match(/data-scroll-anim-task-id="([^"]*)"/)?.[1] || "";
          const savedPrompt = _savedPromptEnc ? decodeURIComponent(_savedPromptEnc) : undefined;
          const savedStyle  = _savedStyleEnc  ? decodeURIComponent(_savedStyleEnc)  : undefined;
          const savedTaskId = _savedTaskEnc   ? decodeURIComponent(_savedTaskEnc)   : "";
          const savedTexts: Array<{title: string; sub: string}> = _savedTextsEnc
            ? decodeURIComponent(_savedTextsEnc).split("||").map(seg => {
                const [t, s] = seg.split("::");
                return { title: (t || "").trim(), sub: (s || "").trim() };
              })
            : [{ title: "", sub: "" }];

          // Write the static fallback immediately (unblocks server startup, user sees something).
          // Preserve the Kling task ID inside the fallback so that (a) the background resume
          // below can finish the animation without re-generating the video, and (b) if the
          // resume also fails the "Создать видео" retry button can re-use the completed video.
          const fallback = safeReplaceScrollAnimPending(
            html,
            scrollAnimFallbackHtml(savedTexts, savedPrompt, savedStyle, savedTaskId || undefined)
          );
          if (fallback !== html) {
            await storage.updateProject(proj.id, { generatedCode: fallback });
            console.log(`[${label}] Cleared pending placeholder for project ${proj.id} → fallback (will attempt background resume: ${savedTaskId ? "yes task=" + savedTaskId : "no task ID"})`);

          // Background: try to fetch the already-created Kling video and build the animation,
          // so the user gets the real animation without paying again or losing the video.
          if (savedTaskId && KIE_API_KEY && savedStyle !== "motion" && savedStyle !== "animational") {
            const _projId  = proj.id;
            const _layout: ScrollAnimLayout =
              savedStyle === "split" ? "split"
              : savedStyle === "action" ? "action"
              : savedStyle === "site3d" ? "site3d"
              : savedStyle === "immersion" ? "immersion"
              : "parallax";
            const _vidDur  = _layout === "action" ? SCROLL_ACTION_VIDEO_DURATION : (_layout === "immersion" || _layout === "site3d") ? 12 : SCROLL_VIDEO_DURATION;
            const _frCnt   = _layout === "action" ? SCROLL_ACTION_FRAME_COUNT : 90;
            const _texts   = savedTexts;
            (async () => {
              try {
                console.log(`[CLEANUP-RESUME] project ${_projId}: polling Kling task ${savedTaskId}`);
                const resumeDeadline = Date.now() + 38 * 60 * 1000; // 38 min (Kling can take 35)
                let mp4UrlResume: string | null = null;
                while (Date.now() < resumeDeadline) {
                  await new Promise(r => setTimeout(r, 12000));
                  try {
                    const sb: any = await kieRequestJson(
                      `${NANO_BANANA_STATUS_URL}?taskId=${savedTaskId}`,
                      { headers: { Authorization: `Bearer ${KIE_API_KEY}` } },
                      { label: "CLEANUP-RESUME poll", retries: 2, shouldStop: () => false },
                    );
                    if (!sb || sb.code !== 200 || !sb.data) continue;
                    const st = sb.data.state;
                    console.log(`[CLEANUP-RESUME] project ${_projId} task state=${st}`);
                    if (st === "success") {
                      let r: any = {};
                      try { r = typeof sb.data.resultJson === "string" ? JSON.parse(sb.data.resultJson) : (sb.data.resultJson || {}); } catch {}
                      mp4UrlResume = (r.resultUrls || [])[0] || null;
                      break;
                    }
                    if (st === "fail" || st === "failed" || st === "error") {
                      console.warn(`[CLEANUP-RESUME] project ${_projId}: task failed — keeping fallback`);
                      return;
                    }
                  } catch (pe: any) { console.warn(`[CLEANUP-RESUME] poll error:`, pe?.message); }
                }
                if (!mp4UrlResume) {
                  console.warn(`[CLEANUP-RESUME] project ${_projId}: deadline reached, keeping fallback`);
                  return;
                }
                // Download + slice + upload frames
                const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrollresume-"));
                const videoPath = path.join(tmpDir, "src.mp4");
                const framesDir = path.join(tmpDir, "frames");
                try {
                  const vr = await fetch(mp4UrlResume);
                  if (!vr.ok) throw new Error(`mp4 HTTP ${vr.status}`);
                  const mp4Buf = Buffer.from(await vr.arrayBuffer());
                  fs.writeFileSync(videoPath, mp4Buf);

                  // site3d / immersion: scrub the MP4 directly (no frame slice).
                  if (_layout === "site3d" || _layout === "immersion") {
                    const videoUrl = await uploadToObjectStorage(mp4Buf, "video/mp4", "mp4");
                    const cur = await storage.getProject(_projId);
                    if (!cur || !(cur.generatedCode || "").includes('data-scroll-anim-fallback="1"')) return;
                    let finalCode = (cur.generatedCode || "").replace(
                      /<section[^>]*data-scroll-anim-fallback="1"[\s\S]*?<\/section>/,
                      buildScrollAnimHtml([], _texts, _layout, videoUrl),
                    );
                    finalCode = injectLoadingOverlay(finalCode);
                    await storage.updateProject(_projId, { generatedCode: finalCode });
                    console.log(`[CLEANUP-RESUME] project ${_projId}: ${_layout} video scrub restored`);
                    return;
                  }

                  fs.mkdirSync(framesDir, { recursive: true });
                  const fps = Math.max(8, Math.round(_frCnt / _vidDur));
                  await extractFramesWithFfmpeg(videoPath, framesDir, fps, () => false);
                  const frameUrls: string[] = [];
                  for (const f of fs.readdirSync(framesDir).filter(f => /\.jpg$/i.test(f)).sort()) {
                    const url = await uploadToObjectStorage(fs.readFileSync(path.join(framesDir, f)), "image/jpeg", "jpg");
                    frameUrls.push(url);
                  }
                  if (frameUrls.length >= 60) {
                    // Read current project code — only replace if it still has the fallback section
                    const cur = await storage.getProject(_projId);
                    if (!cur || !(cur.generatedCode || "").includes('data-scroll-anim-fallback="1"')) return;
                    let finalCode = (cur.generatedCode || "").replace(
                      /<section[^>]*data-scroll-anim-fallback="1"[\s\S]*?<\/section>/, buildScrollAnimHtml(frameUrls, _texts, _layout));
                    finalCode = injectLoadingOverlay(finalCode);
                    await storage.updateProject(_projId, { generatedCode: finalCode });
                    console.log(`[CLEANUP-RESUME] project ${_projId}: animation restored (${frameUrls.length} frames)`);
                  } else {
                    console.warn(`[CLEANUP-RESUME] project ${_projId}: too few frames (${frameUrls.length})`);
                  }
                } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
              } catch (err: any) {
                console.warn(`[CLEANUP-RESUME] project ${_projId} error:`, err?.message);
              }
            })();
          }
          }
        } catch (e: any) {
          console.warn(`[${label}] Failed to clear project ${proj.id}:`, e?.message);
        }
      }
    } catch (e: any) {
      console.warn(`[${label}] Animation cleanup scan failed:`, e?.message);
    }
  }

  // ── Fast periodic scanner: poll ALL projects with a saved Kling task ID ─────
  // Runs every 5 minutes. For each project whose HTML contains a data-scroll-anim-task-id
  // (in either a pending spinner or a fallback section), we check the task status once.
  // • success  → download mp4, slice frames, inject canvas animation into the project
  // • fail     → strip the stale task ID from the HTML so the retry button can re-run fresh
  // • pending  → leave everything unchanged; we'll check again in 5 minutes
  // This guarantees that once a video completes on KIE it will be processed even if
  // the original server connection was lost or the server was restarted mid-pipeline.
  async function resumeCompletedKlingTasks() {
    if (!KIE_API_KEY) return;
    let projects: any[] = [];
    try { projects = await storage.getAllProjectsWithAnimTaskId(); } catch { return; }
    if (!projects.length) return;
    console.log(`[KLINGTASK] Scanning ${projects.length} project(s) with saved task IDs…`);

    for (const proj of projects) {
      const html: string = proj.generatedCode || "";

      // Collect every task ID in this project (pending + fallback can coexist on rare edge)
      const taskIdRe = /data-scroll-anim-task-id="([^"]+)"/g;
      let taskMatch: RegExpExecArray | null;
      const seenTaskIds = new Set<string>();
      while ((taskMatch = taskIdRe.exec(html)) !== null) {
        const enc = taskMatch[1];
        const tid = enc ? decodeURIComponent(enc) : "";
        if (tid) seenTaskIds.add(tid);
      }
      if (!seenTaskIds.size) continue;

      for (const taskId of Array.from(seenTaskIds)) {
        try {
          const body: any = await kieRequestJson(
            `${NANO_BANANA_STATUS_URL}?taskId=${taskId}`,
            { headers: { Authorization: `Bearer ${KIE_API_KEY}` } },
            { label: "KLINGTASK poll", retries: 2, shouldStop: () => false },
          );
          if (!body || body.code !== 200 || !body.data) continue;
          const state: string = body.data.state;
          console.log(`[KLINGTASK] project ${proj.id} task ${taskId.slice(0, 12)}… state=${state}`);

          if (state === "success") {
            // Video is ready — parse mp4 URL
            let result: any = {};
            try { result = typeof body.data.resultJson === "string" ? JSON.parse(body.data.resultJson) : (body.data.resultJson || {}); } catch {}
            const mp4Url: string = (result.resultUrls || [])[0] || "";
            if (!mp4Url) { console.warn(`[KLINGTASK] project ${proj.id}: no mp4 URL in resultJson`); continue; }

            // Read current project HTML — may have changed since scan started
            const cur = await storage.getProject(proj.id);
            if (!cur) continue;
            const curHtml: string = cur.generatedCode || "";

            // Detect section type (pending vs fallback) and extract metadata.
            // Also repair hollow craft-scrollanim heroes (section without engine CSS/JS)
            // left by a prior buggy merge — treat them as needing re-inject.
            const isPending  = curHtml.includes('data-scroll-anim-pending="1"');
            const isFallback = curHtml.includes('data-scroll-anim-fallback="1"');
            const isHollow   = isHollowCraftScrollAnim(curHtml);
            if (!isPending && !isFallback && !isHollow) {
              console.log(`[KLINGTASK] project ${proj.id}: task ${taskId.slice(0,12)}… already resolved`);
              continue;
            }

            const sectionTag = (curHtml.match(isPending
              ? /<section[^>]*data-scroll-anim-pending="1"[^>]*>/
              : isFallback
              ? /<section[^>]*data-scroll-anim-fallback="1"[^>]*>/
              : /<section[^>]*data-craft-scrollanim[^>]*>/) || [""])[0];
            const styleEnc   = sectionTag.match(/data-scroll-anim-style="([^"]*)"/)?.[1]
              || sectionTag.match(/data-layout="([^"]*)"/)?.[1]
              || "";
            const textsEnc   = sectionTag.match(/data-scroll-anim-texts="([^"]*)"/)?.[1] || "";
            const animStyle: string = styleEnc ? decodeURIComponent(styleEnc) : "parallax";
            // Motion uses dual stills (no Kling video) — skip frame resume.
            // Animational has its own pipeline.
            if (animStyle === "motion" || animStyle === "animational") {
              console.log(`[KLINGTASK] project ${proj.id}: ${animStyle} style — skip single-clip frame resume`);
              continue;
            }
            const layout: ScrollAnimLayout =
              animStyle === "split" ? "split"
              : animStyle === "action" ? "action"
              : animStyle === "site3d" ? "site3d"
              : animStyle === "immersion" ? "immersion"
              : "parallax";
            const vidDur  = layout === "action" ? SCROLL_ACTION_VIDEO_DURATION : (layout === "immersion" || layout === "site3d") ? 12 : SCROLL_VIDEO_DURATION;
            const frCnt   = layout === "action" ? SCROLL_ACTION_FRAME_COUNT : 90;
            const texts: Array<{title:string;sub:string}> = textsEnc
              ? decodeURIComponent(textsEnc).split("||").map(seg => { const [t,s] = seg.split("::"); return {title:(t||"").trim(),sub:(s||"").trim()}; })
              : [{ title: "", sub: "" }];

            console.log(`[KLINGTASK] project ${proj.id}: video ready — downloading mp4…`);
            // Download mp4 (3 attempts)
            let mp4Buf: Buffer | null = null;
            for (let i = 0; i < 3 && !mp4Buf; i++) {
              if (i > 0) await new Promise(r => setTimeout(r, 10000));
              try {
                const vr = await fetch(mp4Url);
                if (!vr.ok) throw new Error(`HTTP ${vr.status}`);
                const b = Buffer.from(await vr.arrayBuffer());
                if (b.length >= 10000) mp4Buf = b;
                else throw new Error(`too small: ${b.length}B`);
              } catch (e: any) { console.warn(`[KLINGTASK] project ${proj.id} dl attempt ${i+1}:`, e?.message); }
            }
            if (!mp4Buf) { console.warn(`[KLINGTASK] project ${proj.id}: mp4 download failed — will retry next cycle`); continue; }

            // Extract frames
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "klt-"));
            const videoPath = path.join(tmpDir, "src.mp4");
            const framesDir = path.join(tmpDir, "frames");
            try {
              fs.writeFileSync(videoPath, mp4Buf);

              // site3d / immersion: upload MP4 and scrub — skip ffmpeg frame loop.
              if (layout === "site3d" || layout === "immersion") {
                const videoUrl = await uploadToObjectStorage(mp4Buf, "video/mp4", "mp4");
                const latest = await storage.getProject(proj.id);
                if (!latest) continue;
                const latestHtml: string = latest.generatedCode || "";
                const stillPending  = latestHtml.includes('data-scroll-anim-pending="1"');
                const stillFallback = latestHtml.includes('data-scroll-anim-fallback="1"');
                const stillHollow   = isHollowCraftScrollAnim(latestHtml);
                const stillMissing  = !latestHtml.includes("data-craft-scrollanim") && !stillPending && !stillFallback;
                if (!stillPending && !stillFallback && !stillHollow && !stillMissing) {
                  console.log(`[KLINGTASK] project ${proj.id}: resolved by another path while we were processing`);
                  continue;
                }
                const canvasHtml = buildScrollAnimHtml([], texts, layout, videoUrl);
                let finalCode = latestHtml;
                if (stillPending) {
                  finalCode = safeReplaceScrollAnimPending(finalCode, canvasHtml);
                } else if (stillFallback) {
                  finalCode = finalCode.replace(/<section[^>]*data-scroll-anim-fallback="1"[\s\S]*?<\/section>/, canvasHtml);
                } else if (stillHollow) {
                  finalCode = replaceHollowCraftScrollAnim(finalCode, [canvasHtml]);
                } else if (stillMissing) {
                  if (finalCode.includes("</header>")) {
                    finalCode = finalCode.replace("</header>", `</header>\n${canvasHtml}`);
                  } else if (/<body[^>]*>/i.test(finalCode)) {
                    finalCode = finalCode.replace(/<body[^>]*>/i, (m) => `${m}\n${canvasHtml}`);
                  } else {
                    finalCode = canvasHtml + finalCode;
                  }
                }
                finalCode = injectLoadingOverlay(finalCode);
                await storage.updateProject(proj.id, { generatedCode: finalCode });
                console.log(`[KLINGTASK] project ${proj.id}: ✓ ${layout} video scrub injected`);
                continue;
              }

              fs.mkdirSync(framesDir, { recursive: true });
              const fps = Math.max(8, Math.round(frCnt / vidDur));
              await extractFramesWithFfmpeg(videoPath, framesDir, fps, () => false);
              const frameFiles = fs.readdirSync(framesDir).filter(f => /\.jpg$/i.test(f)).sort();
              const frameUrls: string[] = [];
              for (const f of frameFiles) {
                const url = await uploadToObjectStorage(fs.readFileSync(path.join(framesDir, f)), "image/jpeg", "jpg");
                frameUrls.push(url);
              }
              console.log(`[KLINGTASK] project ${proj.id}: ${frameUrls.length} frames uploaded`);

              if (frameUrls.length >= 60) {
                // Re-read project to avoid overwriting concurrent changes
                const latest = await storage.getProject(proj.id);
                if (!latest) continue;
                const latestHtml: string = latest.generatedCode || "";
                const stillPending  = latestHtml.includes('data-scroll-anim-pending="1"');
                const stillFallback = latestHtml.includes('data-scroll-anim-fallback="1"');
                const stillHollow   = isHollowCraftScrollAnim(latestHtml);
                const stillMissing  = !latestHtml.includes("data-craft-scrollanim") && !stillPending && !stillFallback;
                if (!stillPending && !stillFallback && !stillHollow && !stillMissing) {
                  console.log(`[KLINGTASK] project ${proj.id}: resolved by another path while we were processing`);
                  continue;
                }

                const canvasHtml = buildScrollAnimHtml(frameUrls, texts, layout);
                let finalCode = latestHtml;
                if (stillPending) {
                  finalCode = safeReplaceScrollAnimPending(finalCode, canvasHtml);
                } else if (stillFallback) {
                  finalCode = finalCode.replace(/<section[^>]*data-scroll-anim-fallback="1"[\s\S]*?<\/section>/, canvasHtml);
                } else if (stillHollow) {
                  finalCode = replaceHollowCraftScrollAnim(finalCode, [canvasHtml]);
                } else if (stillMissing) {
                  if (finalCode.includes("</header>")) {
                    finalCode = finalCode.replace("</header>", `</header>\n${canvasHtml}`);
                  } else if (/<body[^>]*>/i.test(finalCode)) {
                    finalCode = finalCode.replace(/<body[^>]*>/i, (m) => `${m}\n${canvasHtml}`);
                  } else {
                    finalCode = canvasHtml + finalCode;
                  }
                }
                finalCode = injectLoadingOverlay(finalCode);
                await storage.updateProject(proj.id, { generatedCode: finalCode });
                console.log(`[KLINGTASK] project ${proj.id}: ✓ animation injected (${frameUrls.length} frames, layout=${layout})`);
              } else {
                console.warn(`[KLINGTASK] project ${proj.id}: too few frames (${frameUrls.length}) — will retry next cycle`);
              }
            } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }

          } else if (state === "fail" || state === "failed" || state === "error") {
            // Video failed on KIE — remove the stale task ID so the next retry creates a fresh one
            console.warn(`[KLINGTASK] project ${proj.id}: task ${taskId.slice(0,12)}… FAILED — clearing task ID`);
            try {
              const cur2 = await storage.getProject(proj.id);
              if (!cur2) continue;
              const cleaned = (cur2.generatedCode || "").replace(/ data-scroll-anim-task-id="[^"]*"/g, "");
              if (cleaned !== cur2.generatedCode) await storage.updateProject(proj.id, { generatedCode: cleaned });
            } catch {}
          }
          // pending/processing states: leave unchanged, check again next cycle
        } catch (e: any) {
          console.warn(`[KLINGTASK] project ${proj.id} task ${taskId.slice(0,12)}…:`, e?.message);
        }
      }
    }
  }

  // Run once on startup (15s delay so DB connections stabilise)
  setTimeout(() => cleanupStuckPendingAnims("Startup"), 15000);
  // Patch old scroll-jacking JS to passive scroll (one-time migration, 20s delay)
  setTimeout(() => migrateScrollJackingToPassive(), 20000);
  // Fast task-ID scanner: runs every 5 min; guarantees video→animation pipeline completion
  setTimeout(() => resumeCompletedKlingTasks(), 30000); // first run 30s after boot
  setInterval(() => resumeCompletedKlingTasks(), 5 * 60 * 1000);
  // Fallback: heavy stuck-placeholder cleanup still runs every 30 min (handles edge cases)
  setInterval(() => cleanupStuckPendingAnims("Periodic"), 30 * 60 * 1000);

  registerSeoRoutes(app, storage);

  return httpServer;
}
