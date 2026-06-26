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
): Promise<string | null> {
  if (!KIE_API_KEY) return null;
  const imagePrompt =
    `${scenePrompt.trim()}. A complete immersive cinematic SCENE with a real environment and layered depth (NOT a plain solid backdrop). ` +
    `Ultra-cinematic widescreen film still, shot on ARRI Alexa with an anamorphic lens, photorealistic, breathtaking dramatic ` +
    `composition that draws the eye deep into the scene, with a slightly calmer focal area where large overlay text can stay legible. ` +
    `Bold directional key light with soft volumetric god rays, rich filmic color grading, deep elegant shadows and luminous ` +
    `highlights, gentle atmospheric haze for depth, immersive premium Hollywood mood. No text, no watermark, no logos, ultra-high detail, 8K, 16:9 aspect ratio.`;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (shouldStop()) return null;
    if (attempt > 0) await new Promise(r => setTimeout(r, 4000));
    let taskId: string | null = null;
    const createBody: any = await kieRequestJson(
      NANO_BANANA_CREATE_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${KIE_API_KEY}` },
        body: JSON.stringify({ model: "nano-banana-2", input: { prompt: imagePrompt, aspect_ratio: "16:9", resolution: "2K" } }),
      },
      { label: "SCROLLANIM still-create", retries: 4, shouldStop },
    );
    if (createBody?.code === 200 && createBody?.data?.taskId) taskId = createBody.data.taskId;
    else { console.warn("[SCROLLANIM] still-image create failed:", createBody?.msg); continue; }
    const imgDeadline = Date.now() + 180000; // 3 min per attempt
    while (Date.now() < imgDeadline) {
      if (shouldStop()) return null;
      await new Promise(r => setTimeout(r, 4000));
      const body: any = await kieRequestJson(
        `${NANO_BANANA_STATUS_URL}?taskId=${taskId}`,
        { headers: { "Authorization": `Bearer ${KIE_API_KEY}` } },
        { label: "SCROLLANIM still-poll", retries: 2, shouldStop: () => shouldStop() || Date.now() >= imgDeadline },
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
  layout: "parallax" | "split",
  shouldStop: () => boolean = () => false,
): Promise<CreativeProductConcept | null> {
  if (shouldStop()) return null;
  const img = await fetchProductImageForVision(productImageUrl);
  if (!img || shouldStop()) return null;

  const placementNote = layout === "split"
    ? "The product sits on the RIGHT third of the frame and the LEFT half stays clean empty space for text, so keep any added element on or near the product on the right and never fill the left half."
    : "The product is centered, so keep any added element close around the product.";

  const instruction =
`You are the creative director of the world's most celebrated product-commercial studio (Apple launch films, Tom Ford, Chanel No.5).
Study the product in the image carefully — brand, category, texture, mood, color palette, material.
Design ONE spectacular, premium cinematic concept for a 5-second scroll-bound hero video that delivers an instant WOW. NOT a boring 360 rotation.

The motion MUST be clearly visible and evolve dramatically across the 5 seconds (the viewer scrubs it by scrolling — subtle or imperceptible motion looks broken and dull). Always combine a slow cinematic camera PUSH-IN with ONE bold signature effect that genuinely moves.

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
- ONE bold focal effect + the slow camera push-in — both already plausible from the composed still;
- no humans, no hands, no invented logos; cinematic, premium and dynamic;
- the effect must be PHOTOREALISTIC and achievable from a single still + 5s video.
${placementNote}

CRITICAL for motionPrompt:
The Kling video model gets the RENDERED STILL as frame 1 — the scene is already composed.
Animate ONLY what is already visible (light, shadow, mist, liquid, particles, reflections, texture) PLUS a slow camera push-in. Do NOT introduce new objects flying in, and never make the motion so subtle it looks frozen.
✓ CORRECT: "a hard spotlight beam sweeps boldly left-to-right across the metallic lid while the camera pushes in slowly and the shadow glides across the surface"
✗ WRONG:   "a spark flies in from the left" (it wasn't in the still) / "the lid barely shimmers" (too subtle, looks static)
${layout === "split" ? "SPLIT GUARDRAIL: keep the product on the right third and keep the LEFT half calmer, softer and uncluttered (simpler or gently out of focus) so overlay text stays readable; the camera push-in must be gentle (about 5-8 percent) with NO pan, NO tilt, NO pull-back and NO frame-edge reveal; keep ALL effects on or around the product on the right, never over the left text area." : "Keep the camera push-in smooth and centered with no frame-edge reveal."}

Return STRICT JSON only (no markdown, no commentary):
{"productSummary":"<3-5 words: exact product name + category>","stillAddition":"<one vivid English phrase: the dramatic STATIC accent/lighting already composed in the still>","motionPrompt":"<one precise cinematic sentence: bold VISIBLE motion of the already-present elements plus a slow camera push-in — dramatic, premium, stunning>"}`;

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
  layout: "parallax" | "split",
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

  const placementHint = layout === "split"
    ? "The product is on the RIGHT side and the left half is an empty solid text area — keep every effect on or around the product on the right, keep the camera push-in gentle (about 5-8 percent) and never let motion spill into or change the left half."
    : "The product is centered — keep the push-in smooth and centered.";

  const instruction =
`You are a world-class cinematographer directing a 5-second luxury product video for Kling AI.
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
  layout: "parallax" | "split",
  shouldStop: () => boolean = () => false,
  stillAddition?: string,
): Promise<string | null> {
  if (!KIE_API_KEY) return null;
  const placement = layout === "split"
    ? "Position the product on the RIGHT third of the frame; keep the LEFT half calmer, softer and uncluttered (clean negative space) so overlay text stays readable."
    : "Position the product centered in the frame.";
  const bgGuard = layout === "split"
    ? `Keep the LEFT half calmer, softer and less detailed (simpler or gently out of focus) so overlay text stays readable, and concentrate the product, the sharp detail and any glow on the RIGHT. `
    : `Keep the product the clear hero with the focus and glow on it, and the surrounding environment softer and uncluttered. `;
  const hasAddition = !!(stillAddition && stillAddition.trim());
  // The background may be a clean dramatic backdrop OR a tasteful, softly-blurred
  // premium environment that suits the product — but never cluttered or busy, and
  // the product must always stay the clear, faithful hero.
  const noProps = hasAddition
    ? `keep it tasteful and uncluttered with no competing objects, the product as the clear hero. `
    : `keep it tasteful and uncluttered with no competing objects or busy patterns, the product as the clear hero. `;
  const creative = hasAddition
    ? `As a tasteful cinematic accent you MAY add: ${stillAddition!.trim()} — placed beside or around the product only, small and elegant, NEVER covering, replacing or altering the product or its label, and keep the surroundings soft and uncluttered. `
    : "";
  const prompt =
    `Take the exact product from the reference image and keep it perfectly identical ` +
    `(same shape, label, text, colors and proportions) — the product is the untouchable hero. Place it in a high-end ` +
    `cinematic product-commercial setting: choose whatever looks most premium for this product — either a clean dramatic ` +
    `studio backdrop OR a tasteful, softly out-of-focus contextual environment (elegant surface, soft bokeh, atmospheric depth), ` +
    `${noProps}` +
    `${placement} Dramatic premium lighting like a luxury magazine ad (not flat catalog lighting): a strong directional ` +
    `key light and a crisp rim/edge highlight that separate the product, a soft halo of light only around the product, ` +
    `deep elegant shadows and rich glossy reflections for real depth. ${bgGuard}` +
    `A subtle realistic contact shadow under the product, photorealistic, ultra-high detail, 8K, 16:9 aspect ratio. ` +
    `${creative}Keep the product's own label and text exactly intact; add no extra text, captions or watermark.`;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (shouldStop()) return null;
    if (attempt > 0) await new Promise(r => setTimeout(r, 4000));
    let taskId: string | null = null;
    const createBody: any = await kieRequestJson(
      NANO_BANANA_CREATE_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${KIE_API_KEY}` },
        body: JSON.stringify({ model: "gpt-image-2-image-to-image", input: { prompt, input_urls: [productImageUrl], aspect_ratio: "16:9", resolution: "2K" } }),
      },
      { label: "SCROLLANIM product-create", retries: 4, shouldStop },
    );
    if (createBody?.code === 200 && createBody?.data?.taskId) taskId = createBody.data.taskId;
    else { console.warn("[SCROLLANIM] product-still create failed:", createBody?.msg); continue; }
    const imgDeadline = Date.now() + 180000; // 3 min per attempt
    while (Date.now() < imgDeadline) {
      if (shouldStop()) return null;
      await new Promise(r => setTimeout(r, 4000));
      const body: any = await kieRequestJson(
        `${NANO_BANANA_STATUS_URL}?taskId=${taskId}`,
        { headers: { "Authorization": `Bearer ${KIE_API_KEY}` } },
        { label: "SCROLLANIM product-poll", retries: 2, shouldStop: () => shouldStop() || Date.now() >= imgDeadline },
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
async function generateScrollFrames(
  videoPrompt: string,
  shouldStop: () => boolean = () => false,
  referenceStillUrl?: string,
  layout: "parallax" | "split" = "parallax",
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

  // Strip Cyrillic text from videoPrompt — the AI sometimes copies the user's Russian
  // site description into the SCROLLANIM marker instead of writing an English cinematic prompt.
  // We remove all Cyrillic word-clusters and collapse extra whitespace; if nothing is left
  // we fall back to a generic cinematic description so Kling always gets English-only input.
  const cleanVideoPrompt = videoPrompt
    .replace(/[\u0400-\u04FF][\u0400-\u04FF\s,;:!?—–-]*/g, " ")  // strip Cyrillic runs + trailing punctuation
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s.,;:]+|[\s.,;:]+$/g, "")
    .trim();
  const safeVideoPrompt = cleanVideoPrompt.length > 15
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
    : `with bold immersive cinematic camera movement that pulls the viewer INTO the scene — a smooth forward dolly / push-in that glides deeper and naturally reveals depth and detail (e.g. gliding toward a doorway or through the space) — graceful and steady, never shaky`;
  const animPrompt =
    `${safeVideoPrompt}. Render as a high-end Hollywood-grade cinematic shot: smooth, graceful but clearly visible motion ` +
    `(the scene must noticeably evolve and feel alive from start to finish), ${cameraGuidance}, premium dramatic lighting ` +
    `and rich filmic color grading. Do not warp, melt or distort the main subject or any architecture, ` +
    `no text, no captions, no watermark, no camera shake, no flicker, no jump cuts.`;

  // Overall deadline shared across all retry attempts (still image time already consumed)
  const deadline = Date.now() + 2400000; // 40 min cap (Kling can take up to 35 min)
  const MAX_VIDEO_ATTEMPTS = 4; // retry on API failure (e.g. upstream timeout)
  let mp4Url: string | null = null;

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
          input: { prompt: animPrompt.slice(0, 2500), image_urls: [stillUrl], duration: String(SCROLL_VIDEO_DURATION), resolution: "1080p" },
        }),
      },
      { label: "SCROLLANIM video-create", retries: 4, shouldStop: () => shouldStop() || Date.now() >= deadline },
    );
    if (createBody?.code === 200 && createBody?.data?.taskId) taskId = createBody.data.taskId;
    else console.warn("[SCROLLANIM] create task failed:", createBody?.msg || createBody?.code);
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
        const body: any = await kieRequestJson(
          `${NANO_BANANA_STATUS_URL}?taskId=${taskId}`,
          { headers: { "Authorization": `Bearer ${KIE_API_KEY}` } },
          { label: "SCROLLANIM video-poll", retries: 2, shouldStop: () => shouldStop() || Date.now() >= deadline },
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

  // Step 5 — upload raw JPEG frames to object storage (no compression)
  const urls: string[] = [];
  try {
    const files = fs.readdirSync(framesDir).filter(f => /\.jpg$/i.test(f)).sort();
    for (const f of files) {
      if (shouldStop()) break;
      const raw = fs.readFileSync(path.join(framesDir, f));
      const url = await uploadToObjectStorage(raw, "image/jpeg", "jpg");
      urls.push(url);
    }
  } catch (e: any) {
    console.warn("[SCROLLANIM] frame upload failed:", e?.message);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`[SCROLLANIM] produced ${urls.length} frames`);
  return urls;
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

  const hasCustom = /id\s*=\s*["']site-preloader["']/i.test(html);

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

  // Reliable hide — three independent triggers so the preloader can NEVER stay stuck:
  // 1. craft:anim-ready event (fired by animation script on frame-0 load OR error)
  // 2. window.load + 2 s  (page fully loaded, give frames a 2 s head-start)
  // 3. Hard cap 6 s  (absolute last resort regardless of network)
  const hideScript = `
<script id="__craft_loader_hide__">(function(){
  var el=document.getElementById('site-preloader');if(!el)return;
  var done=false;
  function hide(){if(done)return;done=true;if(!el.style.transition)el.style.transition='opacity .65s ease,visibility .65s';el.style.opacity='0';el.style.visibility='hidden';el.style.pointerEvents='none';setTimeout(function(){try{if(el.parentNode)el.parentNode.removeChild(el);}catch(e){}var s=document.getElementById('__craft_loader_style__');try{if(s&&s.parentNode)s.parentNode.removeChild(s);}catch(e){}},750);}
  if(window.__craftAnimReady){hide();return;}
  window.addEventListener('craft:anim-ready',hide,{once:true});
  function afterLoad(){setTimeout(hide,2000);}
  if(document.readyState==='complete'){afterLoad();}else{window.addEventListener('load',afterLoad,{once:true});}
  setTimeout(hide,6000);
})();</script>`;

  const inject = visual + hideScript;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, inject + '\n</body>');
  if (/<\/html>/i.test(html)) return html.replace(/<\/html>/i, inject + '\n</html>');
  return html + '\n' + inject;
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

function scrollAnimPendingHtml(texts: Array<{ title: string; sub: string }>): string {
  const first = texts[0] || { title: "", sub: "" };
  const tid = "pnd" + Math.random().toString(36).slice(2, 8);
  return `<section data-scroll-anim-pending="1" style="position:relative;height:100vh;min-height:600px;background:linear-gradient(135deg,#0a0a0a 0%,#16213e 50%,#0a0a0a 100%);display:flex;align-items:center;justify-content:center;overflow:hidden;">
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
      <div style="font-size:.95rem;font-weight:600;color:#fff;margin-bottom:2px;">🎬 Генерация видеоанимации</div>
      <div style="font-size:.8rem;color:rgba(255,255,255,.5);">Обычно занимает 2–10 минут</div>
    </div>
  </div>
  <div style="width:220px;height:3px;background:rgba(255,255,255,.08);border-radius:99px;margin:0 auto 1.5rem;overflow:hidden;">
    <div style="height:100%;background:linear-gradient(90deg,#a78bfa,#60a5fa);border-radius:99px;animation:${tid}-bar 9s cubic-bezier(.4,0,.2,1) forwards;"></div>
  </div>
  <div style="font-size:.78rem;color:rgba(255,255,255,.3);line-height:1.6;animation:${tid}-pulse 2.5s ease-in-out infinite;">Страница обновится автоматически.<br>Остальные секции сайта уже готовы — прокрутите вниз ↓</div>
</div>
</section>`;
}

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
  .${cid}-scroll{position:relative;height:${scrollVh}vh;margin:0;padding:0;background:#000;}
  .${cid}-sticky{position:sticky;top:0;height:100vh;width:100%;overflow:hidden;background:#000;}
  .${cid}-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
  .${cid}-veil{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 80% 80% at 50% 50%,rgba(0,0,0,0) 38%,rgba(0,0,0,0.32) 100%);}
  .${cid}-overlays{position:absolute;inset:0;pointer-events:none;}
  .${cid}-text{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1040px,92vw);text-align:center;opacity:0;will-change:opacity,transform;}
  .${cid}-text::before{content:"";position:absolute;inset:-45% -35%;z-index:-1;background:radial-gradient(ellipse at center,rgba(0,0,0,0.55) 0%,rgba(0,0,0,0.22) 52%,rgba(0,0,0,0) 74%);filter:blur(14px);}
  .${cid}-text h2{margin:0 0 .3em;font-family:'Unbounded',system-ui,sans-serif;font-size:clamp(2.8rem,8.5vw,7rem);font-weight:800;letter-spacing:-0.03em;line-height:0.98;color:#fff;text-shadow:0 2px 40px rgba(0,0,0,0.55);}
  .${cid}-text p{margin:.2em auto 0;max-width:760px;font-family:'Manrope',system-ui,sans-serif;font-size:clamp(1.1rem,2.6vw,1.7rem);font-weight:500;line-height:1.55;color:rgba(255,255,255,0.9);text-shadow:0 1px 18px rgba(0,0,0,0.45);}
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
    var imgs=new Array(frames.length),cur=-1;
    var dpr=Math.min(window.devicePixelRatio||1,2);
    function cover(img){var cw=sticky.clientWidth,ch=sticky.clientHeight,iw=img.naturalWidth,ih=img.naturalHeight;if(!iw||!ih)return;var s=Math.max(cw/iw,ch/ih),dw=iw*s,dh=ih*s,dx=(cw-dw)/2,dy=(ch-dh)/2;ctx.clearRect(0,0,cw,ch);ctx.drawImage(img,dx,dy,dw,dh);}
    function paint(i){i=Math.max(0,Math.min(frames.length-1,i));var im=imgs[i];if(im&&im.complete&&im.naturalWidth){cover(im);cur=i;}}
    function resize(){var w=sticky.clientWidth,h=sticky.clientHeight;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);paint(cur<0?0:cur);}
    function signalReady(){try{if(document.querySelector('[data-frames]')===root){window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));}}catch(e){}}
    frames.forEach(function(src,idx){var im=new Image();im.decoding='async';im.onload=function(){if(idx===0){paint(0);signalReady();}};im.onerror=function(){if(idx===0)signalReady();};im.src=src;imgs[idx]=im;});
    function setP(p){
      p=Math.max(0,Math.min(1,p));
      var idx=Math.round(p*(frames.length-1));if(idx!==cur)paint(idx);
      texts.forEach(function(el){var fi=parseFloat(el.getAttribute('data-fi')),fis=parseFloat(el.getAttribute('data-fis')),fos=parseFloat(el.getAttribute('data-fos')),fo=parseFloat(el.getAttribute('data-fo'));var op=0;if(!isNaN(fi)&&p>=fi&&p<=fo){op=p<fis?(fis>fi?(p-fi)/(fis-fi):1):(p<=fos?1:(fo>fos?1-(p-fos)/(fo-fos):1));}op=Math.max(0,Math.min(1,op));el.style.opacity=op.toFixed(3);el.style.transform='translate(-50%,calc(-50% + '+((1-op)*30)+'px))';});
    }
    // ── Scroll-jacking: lock page scroll while animation plays ──
    var locked=false,lp=0;
    function secTop(){return root.getBoundingClientRect().top+(window.pageYOffset||document.documentElement.scrollTop);}
    function totH(){return Math.max(1,root.offsetHeight-window.innerHeight);}
    function lockScroll(){if(locked)return;locked=true;document.documentElement.style.overflow='hidden';document.body.style.overflow='hidden';}
    function unlockScroll(toEnd){
      if(!locked)return;locked=false;
      document.documentElement.style.overflow='';document.body.style.overflow='';
      window.scrollTo(0,toEnd?secTop()+totH()+1:Math.max(0,secTop()-1));
      try{window.dispatchEvent(new Event('scroll'));}catch(e){}
    }
    function syncScroll(){if(locked)return;var s=secTop(),t=totH(),top=window.pageYOffset||document.documentElement.scrollTop;lp=Math.max(0,Math.min(1,(top-s)/t));setP(lp);}
    function onWheel(e){
      var s=secTop(),t=totH(),top=window.pageYOffset||document.documentElement.scrollTop;
      var inZ=top>=(s-2)&&top<=(s+t+2);
      if(!locked&&!inZ)return;
      if(!locked){lp=Math.max(0,Math.min(1,(top-s)/t));lockScroll();}
      e.preventDefault();
      lp=Math.max(0,Math.min(1,lp+e.deltaY/t));
      setP(lp);
      if(lp>=1)unlockScroll(true);
      else if(lp<=0&&e.deltaY<0)unlockScroll(false);
    }
    var ty=0;
    function onTS(e){ty=e.touches[0].clientY;}
    function onTM(e){
      var s=secTop(),t=totH(),top=window.pageYOffset||document.documentElement.scrollTop;
      var dy=ty-e.touches[0].clientY;ty=e.touches[0].clientY;
      var inZ=top>=(s-2)&&top<=(s+t+2);
      if(!locked&&!inZ)return;
      if(!locked){lp=Math.max(0,Math.min(1,(top-s)/t));lockScroll();}
      e.preventDefault();
      lp=Math.max(0,Math.min(1,lp+dy/t*2.5));
      setP(lp);
      if(lp>=1)unlockScroll(true);
      else if(lp<=0&&dy<0)unlockScroll(false);
    }
    window.addEventListener('wheel',onWheel,{passive:false});
    window.addEventListener('touchstart',onTS,{passive:true});
    window.addEventListener('touchmove',onTM,{passive:false});
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
  .${cid}-scroll{position:relative;height:${scrollVh}vh;margin:0;padding:0;background:#f8f7f4;}
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
    var imgs=new Array(frames.length),cur=-1;
    var dpr=Math.min(window.devicePixelRatio||1,2);
    function cover(img){var cw=sticky.clientWidth,ch=sticky.clientHeight,iw=img.naturalWidth,ih=img.naturalHeight;if(!iw||!ih)return;var s=Math.max(cw/iw,ch/ih),dw=iw*s,dh=ih*s,dx=(cw-dw)/2,dy=(ch-dh)/2;ctx.clearRect(0,0,cw,ch);ctx.drawImage(img,dx,dy,dw,dh);}
    function paint(i){i=Math.max(0,Math.min(frames.length-1,i));var im=imgs[i];if(im&&im.complete&&im.naturalWidth){cover(im);cur=i;}}
    function resize(){var w=sticky.clientWidth,h=sticky.clientHeight;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);paint(cur<0?0:cur);}
    function signalReady(){try{if(document.querySelector('[data-frames]')===root){window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));}}catch(e){}}
    frames.forEach(function(src,idx){var im=new Image();im.decoding='async';im.onload=function(){if(idx===0){paint(0);signalReady();}};im.onerror=function(){if(idx===0)signalReady();};im.src=src;imgs[idx]=im;});
    function setP(p){
      p=Math.max(0,Math.min(1,p));
      var idx=Math.round(p*(frames.length-1));if(idx!==cur)paint(idx);
      texts.forEach(function(el){var fi=parseFloat(el.getAttribute('data-fi')),fis=parseFloat(el.getAttribute('data-fis')),fos=parseFloat(el.getAttribute('data-fos')),fo=parseFloat(el.getAttribute('data-fo'));var op=0;if(!isNaN(fi)&&p>=fi&&p<=fo){op=p<fis?(fis>fi?(p-fi)/(fis-fi):1):(p<=fos?1:(fo>fos?1-(p-fos)/(fo-fos):1));}op=Math.max(0,Math.min(1,op));el.style.opacity=op.toFixed(3);el.style.transform='translateY(calc(-50% + '+((1-op)*22)+'px))';});
    }
    // ── Scroll-jacking: lock page scroll while animation plays ──
    var locked=false,lp=0;
    function secTop(){return root.getBoundingClientRect().top+(window.pageYOffset||document.documentElement.scrollTop);}
    function totH(){return Math.max(1,root.offsetHeight-window.innerHeight);}
    function lockScroll(){if(locked)return;locked=true;document.documentElement.style.overflow='hidden';document.body.style.overflow='hidden';}
    function unlockScroll(toEnd){
      if(!locked)return;locked=false;
      document.documentElement.style.overflow='';document.body.style.overflow='';
      window.scrollTo(0,toEnd?secTop()+totH()+1:Math.max(0,secTop()-1));
      try{window.dispatchEvent(new Event('scroll'));}catch(e){}
    }
    function syncScroll(){if(locked)return;var s=secTop(),t=totH(),top=window.pageYOffset||document.documentElement.scrollTop;lp=Math.max(0,Math.min(1,(top-s)/t));setP(lp);}
    function onWheel(e){
      var s=secTop(),t=totH(),top=window.pageYOffset||document.documentElement.scrollTop;
      var inZ=top>=(s-2)&&top<=(s+t+2);
      if(!locked&&!inZ)return;
      if(!locked){lp=Math.max(0,Math.min(1,(top-s)/t));lockScroll();}
      e.preventDefault();
      lp=Math.max(0,Math.min(1,lp+e.deltaY/t));
      setP(lp);
      if(lp>=1)unlockScroll(true);
      else if(lp<=0&&e.deltaY<0)unlockScroll(false);
    }
    var ty=0;
    function onTS(e){ty=e.touches[0].clientY;}
    function onTM(e){
      var s=secTop(),t=totH(),top=window.pageYOffset||document.documentElement.scrollTop;
      var dy=ty-e.touches[0].clientY;ty=e.touches[0].clientY;
      var inZ=top>=(s-2)&&top<=(s+t+2);
      if(!locked&&!inZ)return;
      if(!locked){lp=Math.max(0,Math.min(1,(top-s)/t));lockScroll();}
      e.preventDefault();
      lp=Math.max(0,Math.min(1,lp+dy/t*2.5));
      setP(lp);
      if(lp>=1)unlockScroll(true);
      else if(lp<=0&&dy<0)unlockScroll(false);
    }
    window.addEventListener('wheel',onWheel,{passive:false});
    window.addEventListener('touchstart',onTS,{passive:true});
    window.addEventListener('touchmove',onTM,{passive:false});
    window.addEventListener('scroll',syncScroll,{passive:true});
    window.addEventListener('resize',resize);
    resize();syncScroll();
  });
})();
</script>${navCtl}`;
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
  const layout: "parallax" | "split" = interactiveStyle === "split" ? "split" : "parallax";

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
    try { res.write(`data: ${JSON.stringify({ status: "Рендерю видео для анимации прокрутки (до 35 минут, зависит от очереди KIE)..." })}\n\n`); } catch {}

    let billed = false;
    if (userId) {
      const ikey = `scroll-anim-${projectId}-${runKey}-${crypto.createHash("md5").update(raw).digest("hex").slice(0, 8)}`;
      const ded = await storage.deductCredits(userId, SCROLL_ANIM_COST, "scroll-anim", ikey);
      if (!ded.success) break; // out of credits → leave for static fallback
      billed = !ded.alreadyProcessed;
    }

    // User is confirmed billable → safe to spend external API. Regenerate the uploaded
    // product photo ONCE onto a clean SOLID background (product positioned per layout)
    // and feed THAT still to Kling, so the scroll video always has a uniform background
    // instead of the raw busy photo. On failure referenceStill stays undefined and
    // generateScrollFrames falls back to a text-to-image still (still a solid bg).
    if (productImageUrl && !productStillResolved) {
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
      try { res.write(`data: ${JSON.stringify({ status: "Рендерю видео для анимации прокрутки (ожидаю результат от KIE)..." })}\n\n`); } catch {}
    }, 20000);

    // For product-photo sites, drive Kling with the vision-derived creative motion
    // (falls back to the LLM's videoPrompt when no concept was produced).
    const effectivePrompt = (productImageUrl && creativeConcept?.motionPrompt)
      ? creativeConcept.motionPrompt
      : parsed.videoPrompt;
    let frames: string[] = [];
    try {
      frames = await generateScrollFrames(effectivePrompt, () => isAborted() || Date.now() >= phaseDeadline, referenceStill, layout);
    } finally {
      clearInterval(keepAliveInterval);
    }

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
            const url = await generateGptImage(withImageQualityBooster(parsed.prompt), parsed.ratio, () => isAborted() || Date.now() >= phaseDeadline);
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
  | { type: "input_image"; image_url: string }
  | { type: "input_image_inline"; base64: string; mime_type: string };

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
Оборачивай формы в <form data-lead-form="имя_формы">.

⚠️ ПРЕЛОАДЕР ДЛЯ ПАРАЛЛАКС / АНИМИРОВАННЫХ САЙТОВ (КРИТИЧНО):
Если сайт содержит параллакс, тяжёлые scroll-анимации, canvas-эффекты или кинематичный дизайн — ОБЯЗАТЕЛЬНО добавь прелоадер:

1. ПЕРВЫМ элементом внутри <body> вставь <div id="site-preloader">...</div>
   ⚠️ id ОБЯЗАН быть ровно "site-preloader" — по нему система находит элемент.
2. position:fixed; inset:0; z-index:2147483647; — поверх всего содержимого.
3. Дизайн: те же цвета, шрифты, настроение что и у сайта. Анимация — тематическая (пульсация логотипа/названия, тонкая прогресс-линия, печатающийся текст, мерцание), НЕ банальный серый спиннер.
4. Добавь РОВНО этот JS для скрытия (не изменяй код, только вставь):
<script>(function(){var p=document.getElementById('site-preloader');if(!p)return;var done=false;function hide(){if(done)return;done=true;p.style.transition='opacity 0.7s ease,visibility 0.7s';p.style.opacity='0';p.style.visibility='hidden';p.style.pointerEvents='none';setTimeout(function(){try{if(p.parentNode)p.parentNode.removeChild(p);}catch(e){}},800);}window.addEventListener('load',function(){setTimeout(hide,1500);},{once:true});setTimeout(hide,6000);})();</script>
   Этот код: скрывает прелоадер через 1.5с после полной загрузки страницы, жёсткий лимит — 6 секунд.
   НЕ добавляй другой JS для скрытия — только этот блок.`;

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
1. Самым ПЕРВЫМ элементом внутри <body> (до <header> и до маркера {{SCROLLANIM}}) вставь:
   <div id="site-preloader"> ... твоя авторская анимация загрузки ... </div>
   ⚠️ id ОБЯЗАН быть ровно "site-preloader" — по нему система автоматически скроет прелоадер, когда видео-кадры загрузятся.
2. Прелоадер ДОЛЖЕН быть УНИКАЛЬНЫМ и идеально соответствовать стилю ИМЕННО ЭТОГО сайта:
   - тот же фон, что у сайта (тёмный/светлый/градиент/цвет бренда);
   - те же шрифты и фирменные цвета;
   - то же настроение (люкс / минимализм / неон / эко / техно и т.д.).
3. По центру — твоя СОБСТВЕННАЯ анимация (НЕ банальный круглый спиннер): например, пульсирующее название/логотип бренда, тонкая анимированная линия-прогресс, морфинг фигуры, печатающийся текст, мерцание — то, что подходит теме.
4. Стили прелоадера задай инлайн (в <style> внутри документа или style-атрибутом). Используй position:fixed; inset:0; высокий z-index.
5. НЕ добавляй JavaScript для скрытия прелоадера — система скроет его сама автоматически. Просто создай красивую статичную/CSS-анимированную заглушку.
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
          const singleMatch = fullResponse.match(/```html\s*\n?([\s\S]*?)```/i);
          let parsedCode: string | null = null;
          if (singleMatch && singleMatch[1].includes("<")) {
            // Closed ```html fence — use its content (still clean stray preamble/fences).
            parsedCode = replaceImgMarkers(cleanHtmlDoc(singleMatch[1]));
          } else if (/<!DOCTYPE\s+html|<html[\s>]/i.test(fullResponse)) {
            // No closed fence (e.g. unclosed ```html or raw doc) — slice the real
            // document out of the response, dropping conversational preamble and any
            // dangling opening/closing fence. Prevents the leak where the model's
            // "Вот готовый код файла index.html: ```html" prefix became the site.
            parsedCode = replaceImgMarkers(cleanHtmlDoc(fullResponse));
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
        if (f.filename !== "index.html") genFilesMap.set(f.filename, f.code);
      }
      const genRunKey = idempotencyKey || `gen-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const genImgResult = await resolveGenImgMarkers(genFilesMap, project.id, user?.id, genRunKey, res, () => clientGone);
      mainHtmlCode = genFilesMap.get("index.html") ?? mainHtmlCode;

      // ── Auto-inject SCROLLANIM if interactive mode but AI missed the marker ──
      if (interactiveMode && isNewSite && !mainHtmlCode.includes("{{SCROLLANIM:")) {
        const isSplitAuto = interactiveStyle === "split";
        let videoPromptAuto: string;
        let textsAuto: string;
        if (isSplitAuto) {
          videoPromptAuto = absoluteProductImageUrl
            ? "the product on the right side of frame, a delicate butterfly gently lands and soft petals drift through the air, left side clean solid white background, soft studio lighting, cinematic macro, no text"
            : "premium product on the right side of frame, soft cinematic accents and gentle atmospheric motion, left side clean solid white background, soft studio lighting, cinematic";
          textsAuto = "Познакомьтесь с нами::Откройте для себя наш продукт||Качество и стиль::Только лучшее для вас||Начните сейчас::Сделайте первый шаг";
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

      // ── Scroll animation: fire-and-forget approach ───────────────────────────
      // Replace {{SCROLLANIM:...}} markers with a beautiful "pending" placeholder
      // and deliver the site to the client immediately. The actual video + ffmpeg
      // pipeline runs in the background and writes the final code to the DB once
      // ready. The client polls for completion and auto-updates the preview.
      const hasScrollMarkers = mainHtmlCode.includes("{{SCROLLANIM:");
      let immediateHtml = mainHtmlCode;
      if (hasScrollMarkers) {
        immediateHtml = mainHtmlCode.replace(/\{\{SCROLLANIM:([\s\S]+?)\}\}/g, (_full, inner) => {
          const pipe = (inner as string).indexOf("|");
          const textPart = pipe === -1 ? "" : (inner as string).slice(pipe + 1);
          const texts = textPart.split("||").map((seg: string) => {
            const [title, sub] = seg.split("::");
            return { title: (title || "").trim(), sub: (sub || "").trim() };
          }).filter((t: { title: string; sub: string }) => t.title || t.sub);
          return scrollAnimPendingHtml(texts.length ? texts : [{ title: "", sub: "" }]);
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
      if (interactiveMode || hasScrollMarkers) {
        immediateHtml = injectLoadingOverlay(immediateHtml);
      }

      await storage.updateProject(project.id, { generatedCode: immediateHtml });
      await storage.createProjectMessage({
        projectId: project.id,
        role: "model",
        content: aiTextReply || "Сайт обновлён",
      });

      // Deliver to client immediately (no waiting for video)
      const allFiles = await storage.getProjectFiles(project.id);
      const editedFileCode = editingFile !== "index.html" ? allFiles.find(f => f.filename === editingFile)?.code : immediateHtml;
      const freshUser = user?.id ? await storage.getUser(user.id) : null;
      const immediateCreditsUsed = GENERATION_COST + genImgResult.creditsUsed;
      const immediateBalance = freshUser?.credits ?? (genDeduction.newBalance - genImgResult.creditsUsed);
      res.write(`data: ${JSON.stringify({ done: true, code: immediateHtml, editedFile: editingFile, editedCode: editedFileCode || immediateHtml, reply: aiTextReply, files: allFiles.map(f => ({ filename: f.filename, id: f.id })), imagesGenerated: genImgResult.generated, creditsUsed: immediateCreditsUsed, newBalance: immediateBalance, animPending: hasScrollMarkers })}\n\n`);
      res.end();

      // ── Background: resolve animation markers, then update DB ─────────────
      if (hasScrollMarkers) {
        const bgFilesMap = new Map<string, string>();
        bgFilesMap.set("index.html", mainHtmlCode); // original — still has {{SCROLLANIM}} markers
        for (const f of secondaryForGen) {
          if (f.filename !== "index.html") bgFilesMap.set(f.filename, f.code);
        }
        const noopRes = { write: () => {}, end: () => {} };
        (async () => {
          try {
            console.log(`[BG ANIM] Starting for project ${project.id}`);
            const scrollResult = await resolveScrollAnimMarkers(bgFilesMap, project.id, user?.id, genRunKey, noopRes, () => false, absoluteProductImageUrl, interactiveStyle);
            let animatedCode = bgFilesMap.get("index.html") ?? immediateHtml;
            // Re-inject the loading overlay into the now-animated version
            animatedCode = injectLoadingOverlay(animatedCode);
            await storage.updateProject(project.id, { generatedCode: animatedCode });
            for (const f of secondaryForGen) {
              if (f.filename === "index.html") continue;
              const upd = bgFilesMap.get(f.filename);
              if (upd !== undefined && upd !== f.code) {
                await storage.upsertProjectFile({ projectId: project.id, filename: f.filename, code: upd });
              }
            }
            console.log(`[BG ANIM] Done for project ${project.id} — frames: ${scrollResult.generated}, credits: ${scrollResult.creditsUsed}`);
            // Deduct remaining animation credits from user balance (idempotent)
            // (resolveScrollAnimMarkers already handles its own deduction)
          } catch (bgErr) {
            console.error(`[BG ANIM] Error for project ${project.id}:`, bgErr);
            // On failure: replace pending placeholder with static fallback (safe, no regex backtracking)
            try {
              const pipe = mainHtmlCode.match(/\{\{SCROLLANIM:([\s\S]+?)\}\}/)?.[1] || "";
              const pipeIdx = pipe.indexOf("|");
              const textPart = pipeIdx === -1 ? "" : pipe.slice(pipeIdx + 1);
              const texts = textPart.split("||").map((seg: string) => { const [t, s] = seg.split("::"); return { title: (t||"").trim(), sub: (s||"").trim() }; });
              const fallbackCode = safeReplaceScrollAnimPending(immediateHtml, scrollAnimFallbackHtml(texts));
              await storage.updateProject(project.id, { generatedCode: fallbackCode });
            } catch {}
          }
        })();
      }
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
    return res.json({ sections: labels });
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

      await new Promise<void>((resolve, reject) => {
        ffmpegMod(videoPath)
          .outputOptions(["-vf", `fps=${fps.toFixed(4)}`, "-q:v", "2"])
          .output(path.join(framesDir, "frame_%04d.jpg"))
          .on("end", () => resolve())
          .on("error", (err: any) => reject(err))
          .run();
      });

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

    const { frames, insertAfterSection = 0, texts = [] } = req.body;
    if (!Array.isArray(frames) || frames.length === 0) return res.status(400).json({ message: "Нет кадров" });

    const html = project.generatedCode || "";
    if (!html.trim()) return res.status(400).json({ message: "Сайт ещё не сгенерирован" });

    const animHtml = buildScrollAnimHtml(frames, texts, "parallax");

    // Find all </section> close-tag positions
    const sectionEnds: number[] = [];
    const endRe = /<\/section>/gi;
    let em;
    while ((em = endRe.exec(html)) !== null) sectionEnds.push(em.index + em[0].length);

    let insertPos: number;
    if (sectionEnds.length === 0) {
      // No sections — insert before </body> or at end
      const bodyClose = html.lastIndexOf("</body>");
      insertPos = bodyClose >= 0 ? bodyClose : html.length;
    } else {
      const idx = Math.max(0, Math.min(Number(insertAfterSection), sectionEnds.length - 1));
      insertPos = sectionEnds[idx];
    }

    let newHtml = html.slice(0, insertPos) + "\n" + animHtml + "\n" + html.slice(insertPos);
    // Wire up the reliable preloader-hide script so the loader can't get stuck.
    newHtml = injectLoadingOverlay(newHtml);

    // Save version before modifying
    await storage.createProjectVersion({ projectId, code: html, label: "До: Вставка видео-анимации" });
    await storage.updateProject(projectId, { generatedCode: newHtml });

    return res.json({ code: newHtml, sections: sectionEnds.length });
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
      // Ensure the reliable preloader-hide script is present (self-heals older
      // sites whose stored code was saved without it). Idempotent.
      mainHtml = injectLoadingOverlay(mainHtml);
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

  // ── Stuck-animation cleanup (startup + periodic) ──────────────────────────
  // If the server was restarted while a background animation pipeline was running,
  // the fire-and-forget task is killed and the DB keeps the pending spinner forever.
  // We clean up on boot AND every 30 minutes so restarts are no longer the only chance.
  // Uses safeReplaceScrollAnimPending (string-search, no regex backtracking) so it
  // reliably works even on large HTML files (50-100 KB) without Node.js hanging.
  async function cleanupStuckPendingAnims(label: string) {
    try {
      const allProjects = await storage.getAllProjectsWithPendingAnim();
      if (!allProjects || allProjects.length === 0) return;
      console.log(`[${label}] Found ${allProjects.length} project(s) with stuck animation placeholder — replacing with fallback`);
      for (const proj of allProjects) {
        try {
          const fallback = safeReplaceScrollAnimPending(
            proj.generatedCode || "",
            scrollAnimFallbackHtml([{ title: "", sub: "" }])
          );
          if (fallback !== proj.generatedCode) {
            await storage.updateProject(proj.id, { generatedCode: fallback });
            console.log(`[${label}] Cleared pending placeholder for project ${proj.id}`);
          }
        } catch (e: any) {
          console.warn(`[${label}] Failed to clear project ${proj.id}:`, e?.message);
        }
      }
    } catch (e: any) {
      console.warn(`[${label}] Animation cleanup scan failed:`, e?.message);
    }
  }

  // Run once on startup (15s delay so DB connections stabilise)
  setTimeout(() => cleanupStuckPendingAnims("Startup"), 15000);
  // Run every 30 minutes so stuck placeholders are cleaned even between restarts
  setInterval(() => cleanupStuckPendingAnims("Periodic"), 30 * 60 * 1000);

  return httpServer;
}
