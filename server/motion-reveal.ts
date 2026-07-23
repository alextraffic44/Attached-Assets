/**
 * «Моушн» — WebGL mouse-trail image reveal (Lando Norris / Unicorn Studio style).
 *
 * Pipeline:
 * 1) Generate BASE still (T2I / product ref)
 * 2) IMAGE-TO-IMAGE from that exact base → REVEAL still (same camera/placement,
 *    but the subject/object metamorphoses — e.g. diamond→ring, red dress→blue —
 *    plus lighting/materials) so frames register for hover morph
 * 3) Self-contained HTML: fluid cursor reveal on desktop; on mobile scroll drives
 *    the morph and vertical pan is never captured (touch-action: pan-y)
 */
export const SCROLL_MOTION_COST = 120;

export type MotionText = { title: string; sub: string };

export type GenerateMotionRevealDeps = {
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
/** 1K is plenty for full-bleed web hero and ~2× faster than 2K on nano-banana-2. */
const STILL_RESOLUTION = "1K";
const STILL_DEADLINE_MS = 90 * 1000;
const MAX_STILL_ATTEMPTS = 2;
const POLL_MS = 1500;

function cleanEnglishPrompt(raw: string): string {
  const cleaned = raw
    .replace(/[\u0400-\u04FF][\u0400-\u04FF\s,;:!?—–-]*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s.,;:]+|[\s.,;:]+$/g, "")
    .trim();
  return cleaned.length > 12
    ? cleaned
    : "premium brand scene for the business niche, cinematic editorial composition";
}

/** Split AI dual prompt: "BASE /// REVEAL" (or ::: / →). Falls back to one scene for both. */
export function parseMotionDualPrompt(raw: string): { baseScene: string; revealScene: string } {
  const cleaned = cleanEnglishPrompt(raw);
  const separators = [" /// ", " ::: ", " → ", " -> ", " /+/ "];
  for (const sep of separators) {
    const idx = cleaned.indexOf(sep);
    if (idx > 8) {
      const baseScene = cleaned.slice(0, idx).trim();
      const revealScene = cleaned.slice(idx + sep.length).trim();
      if (baseScene.length > 8 && revealScene.length > 8) {
        return { baseScene, revealScene };
      }
    }
  }
  return { baseScene: cleaned, revealScene: cleaned };
}

async function reuploadStable(
  deps: GenerateMotionRevealDeps,
  cdnUrl: string,
): Promise<string> {
  try {
    const imgResp = await fetch(cdnUrl, { signal: AbortSignal.timeout(25000) });
    if (imgResp.ok) {
      const imgBuf = Buffer.from(await imgResp.arrayBuffer());
      const relUrl = await deps.uploadToObjectStorage(imgBuf, "image/jpeg", "jpg");
      return `${deps.appBaseUrl}${relUrl}`;
    }
  } catch (e: any) {
    console.warn("[MOTION] re-upload failed, using CDN:", e?.message);
  }
  return cdnUrl;
}

async function pollImageTask(
  deps: GenerateMotionRevealDeps,
  taskId: string,
  label: string,
): Promise<string | null> {
  const deadline = Date.now() + STILL_DEADLINE_MS;
  // First poll quickly — nano-banana-2 often finishes in <15s at 1K
  let wait = POLL_MS;
  while (Date.now() < deadline) {
    if (deps.shouldStop()) return null;
    await new Promise((r) => setTimeout(r, wait));
    wait = POLL_MS;
    const body: any = await deps.kieRequestJson(
      `${deps.statusUrl}?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${deps.kieApiKey}` } },
      { label: `${label}-poll`, retries: 1, shouldStop: () => deps.shouldStop() || Date.now() >= deadline },
    );
    if (!body || body.code !== 200 || !body.data) continue;
    const state = body.data.state;
    if (state === "success") {
      let result: any = {};
      try {
        result = typeof body.data.resultJson === "string"
          ? JSON.parse(body.data.resultJson)
          : (body.data.resultJson || {});
      } catch {}
      const cdnUrl = (result.resultUrls || [])[0] || null;
      if (!cdnUrl) return null;
      return reuploadStable(deps, cdnUrl);
    }
    if (state === "fail" || state === "failed" || state === "error") {
      console.warn(`[MOTION] ${label} failed:`, body.data?.failMsg);
      return null;
    }
  }
  console.warn(`[MOTION] ${label} timed out after ${STILL_DEADLINE_MS / 1000}s`);
  return null;
}

async function createStill(
  deps: GenerateMotionRevealDeps,
  prompt: string,
  label: string,
  inputUrl?: string,
): Promise<string | null> {
  if (!deps.kieApiKey) return null;
  for (let attempt = 0; attempt < MAX_STILL_ATTEMPTS; attempt++) {
    if (deps.shouldStop()) return null;
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
    // Prefer nano-banana-2 for both T2I and reference-image edits (fast).
    // image_input = image-to-image so reveal keeps the base composition locked.
    const input: any = inputUrl
      ? {
          prompt,
          // Strict I2I: single reference = the finished previous frame (composition lock).
          image_input: [inputUrl],
          aspect_ratio: "16:9",
          resolution: STILL_RESOLUTION,
          output_format: "jpg",
        }
      : {
          prompt,
          aspect_ratio: "16:9",
          resolution: STILL_RESOLUTION,
          output_format: "jpg",
        };
    if (inputUrl) {
      console.log(`[MOTION] ${label}: I2I from prior frame ${inputUrl.slice(0, 96)}`);
    }
    const createBody: any = await deps.kieRequestJson(
      deps.createUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deps.kieApiKey}`,
        },
        body: JSON.stringify({ model: STILL_MODEL, input }),
      },
      { label: `${label}-create`, retries: 2, shouldStop: deps.shouldStop },
    );
    if (createBody?.code !== 200 || !createBody?.data?.taskId) {
      console.warn(`[MOTION] ${label} create failed:`, createBody?.msg);
      continue;
    }
    const url = await pollImageTask(deps, createBody.data.taskId, label);
    if (url) return url;
  }
  return null;
}

function buildBasePrompt(baseScene: string, hasProduct: boolean): string {
  const leftTextSpace =
    `Leave calm darker negative space on the LEFT third for website overlay text; ` +
    `keep the hero subject clearly on the center-right so left copy stays readable. `;
  if (hasProduct) {
    return (
      `Take the exact product from the reference image and keep it perfectly identical ` +
      `(same shape, label, text, colors and proportions). Place it as the clear hero inside this niche scene: ${baseScene}. ` +
      leftTextSpace +
      `This is STATE A of a two-frame hover morph — compose a vivid, photorealistic commercial scene ` +
      `(season, weather, props and lighting must match the description exactly). ` +
      `FULL VIVID COLOR photorealistic commercial photography — rich brand colors, dramatic directional light, ` +
      `soft volumetric haze, premium campaign still. Match the niche environment and props from the description. ` +
      `Do NOT invent an unrelated portrait. No text, no watermark, no logos added. Ultra-high detail, 16:9.`
    );
  }
  return (
    `${baseScene}. ` +
    leftTextSpace +
    `Create a photorealistic FULL-COLOR commercial HERO still tailored to this exact business niche and subject. ` +
    `Follow the described scene, environment, props and composition closely — it may be a person, product, ` +
    `interior, workspace, dish, building, vehicle, tool, or any niche-specific subject (NOT forced to be a fashion portrait). ` +
    `Vivid saturated color, cinematic lighting, soft atmospheric haze, powerful iconic framing for a premium website hero. ` +
    `Do NOT render black-and-white or desaturated monochrome unless the scene itself asks for night/shadow mood in color. ` +
    `No text, no watermark, no logos. Ultra-high detail, 16:9 aspect ratio.`
  );
}

/**
 * I2I reveal: EDIT the finished base frame — never recompose from scratch.
 * With a product photo — keep the exact product locked in place; morph environment only.
 * Without product — subject/object may metamorphose (diamond→ring etc.).
 */
function buildRevealPrompt(revealScene: string, hasProduct: boolean): string {
  const atmosphere = sanitizeRevealAtmosphere(revealScene);
  if (hasProduct) {
    return (
      `CRITICAL: This is an IMAGE-TO-IMAGE EDIT of the provided reference photograph (frame 1 already generated). ` +
      `Do NOT generate a new composition. Do NOT re-place, re-frame, re-scale or re-center the product. ` +
      `PIXEL-LOCK registration: the product must occupy the EXACT same pixels / silhouette / position / size / angle as in the reference image. ` +
      `KEEP the exact product identity — same shape, label, logo, text, colors and proportions. ` +
      `CHANGE ONLY the surrounding atmosphere, season, weather, lighting and background props around that locked product. ` +
      `Target atmosphere: ${atmosphere}. ` +
      `Classic success: summer condensation → winter ice/frost while the can/bottle stays glued in place. ` +
      `FULL VIVID COLOR. If the product moved even slightly, the edit FAILED — keep position identical. ` +
      `No text, no watermark, no logos added. Same 16:9 framing as the reference.`
    );
  }
  return (
    `CRITICAL: This is an IMAGE-TO-IMAGE EDIT of the provided reference photograph (frame 1 already generated). ` +
    `Do NOT generate a new composition from scratch. ` +
    `KEEP the same camera angle, framing, scale and the subject's place in the frame (perfect pixel registration). ` +
    `DO transform the SUBJECT / OBJECT itself into the reveal state — not only light. ` +
    `Examples: raw diamond → finished diamond ring, red dress → blue dress, ` +
    `plain cake → decorated celebration cake, unfinished room → finished interior, dull car → polished showroom car. ` +
    `Apply this metamorphosis: ${atmosphere}. ` +
    `The reveal must be OBVIOUSLY a different object or clearly transformed product/outfit/scene element at a glance, ` +
    `while staying in the same spot and silhouette footprint so the morph overlay lines up. ` +
    `Also upgrade lighting, materials and atmosphere to sell the new state. FULL VIVID COLOR. ` +
    `If the subject moved or was reframed, the edit FAILED. No text, no watermark, no logos. Same 16:9 framing.`
  );
}

/** Strip placement/composition chatter so I2I only receives the atmosphere change. */
function sanitizeRevealAtmosphere(revealScene: string): string {
  let s = (revealScene || "").trim();
  // Drop common framing boilerplate that causes the model to recompose.
  s = s
    .replace(/\bsame camera framing[^,]*/gi, "")
    .replace(/\bsubject placement locked[^,]*/gi, "")
    .replace(/\bsame exact product identity and label[^,]*/gi, "")
    .replace(/\bmetamorphose (the )?environment to\b/gi, "")
    .replace(/\bobviously different[^,]*/gi, "")
    .replace(/\bright of center[^,]*/gi, "")
    .replace(/\bcenter-right[^,]*/gi, "")
    .replace(/\bcalm left text space[^,]*/gi, "")
    .replace(/\bleft text space[^,]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:]+|[\s,;:]+$/g, "")
    .trim();
  if (s.length < 12) {
    return "winter ice frost snow crystalline cold atmosphere around the same locked product";
  }
  return s.slice(0, 400);
}

export async function generateMotionRevealPair(opts: {
  scenePrompt: string;
  productImageUrl?: string;
  deps: GenerateMotionRevealDeps;
}): Promise<{ baseUrl: string; revealUrl: string } | null> {
  const { deps } = opts;
  const { baseScene, revealScene } = parseMotionDualPrompt(opts.scenePrompt);
  const hasProduct = !!opts.productImageUrl;
  const t0 = Date.now();

  // 1) Wait for BASE to fully finish (including re-upload) before starting reveal.
  //    Never launch both stills in parallel — registration depends on editing frame 1.
  deps.onStatus?.("Моушн: генерирую первый кадр…");
  console.log("[MOTION] step1: waiting for base still before any I2I…");
  const baseUrl = await createStill(
    deps,
    buildBasePrompt(baseScene, hasProduct),
    "MOTION base",
    opts.productImageUrl,
  );
  if (!baseUrl) {
    console.warn(`[MOTION] base failed after ${Date.now() - t0}ms`);
    return null;
  }
  console.log(`[MOTION] step1 done: base ready ${baseUrl.slice(0, 80)}… — starting sequential I2I`);

  // 2) ONLY AFTER base is ready: I2I from that exact frame (locks product position).
  const morphBrief =
    !revealScene ||
    revealScene === baseScene ||
    revealScene.length < 20
      ? (hasProduct
          ? "winter ice frost snow cracked clear ice crystals and cold rim light around the product"
          : "metamorphose the main subject into its premium finished counterpart, richer materials and lighting")
      : revealScene;

  deps.onStatus?.(
    hasProduct
      ? "Моушн: первый кадр готов — image-to-image второго (тот же объект на месте)…"
      : "Моушн: первый кадр готов — image-to-image morph поверх него…",
  );
  const revealUrl = await createStill(
    deps,
    buildRevealPrompt(morphBrief, hasProduct),
    "MOTION reveal i2i",
    baseUrl, // MUST be the finished base, never the raw product photo
  );
  if (!revealUrl) {
    console.warn(`[MOTION] reveal i2i failed after ${Date.now() - t0}ms`);
    return null;
  }

  console.log(`[MOTION] pair ready (strict sequential i2i from base) in ${Date.now() - t0}ms`);
  deps.onStatus?.(`Моушн готов за ${Math.round((Date.now() - t0) / 1000)} с`);
  return { baseUrl, revealUrl };
}

export function buildMotionRevealHtml(
  baseUrl: string,
  revealUrl: string,
  texts: MotionText[],
  navCtl: string,
  esc: (s: string) => string,
): string {
  const cid = "mot" + Math.random().toString(36).slice(2, 8);
  const cards = (texts.length ? texts : [{ title: "", sub: "" }]).slice(0, 5);
  const n = Math.max(1, cards.length);
  const scrollVh = Math.max(260, Math.min(560, Math.round(n * 95 + 140)));

  const layers = cards
    .map((t, i) => {
      const segStart = i / n;
      const segEnd = (i + 1) / n;
      const fade = (1 / n) * 0.22;
      const fi = (i === 0 ? -1 : segStart).toFixed(3);
      const fis = (i === 0 ? 0 : segStart + fade).toFixed(3);
      const fos = (i === n - 1 ? 2 : segEnd - fade).toFixed(3);
      const fo = (i === n - 1 ? 2 : segEnd).toFixed(3);
      return `      <div class="${cid}-text" data-fi="${fi}" data-fis="${fis}" data-fos="${fos}" data-fo="${fo}">
        ${t.title ? `<h2>${esc(t.title)}</h2>` : ""}
        ${t.sub ? `<p>${esc(t.sub)}</p>` : ""}
      </div>`;
    })
    .join("\n");

  const baseEsc = esc(baseUrl);
  const revEsc = esc(revealUrl);
  // Safe for single-quoted JS string literals inside <script>
  const baseJs = String(baseUrl).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/</g, "\\u003c").replace(/\n/g, "\\n");
  const revJs = String(revealUrl).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/</g, "\\u003c").replace(/\n/g, "\\n");

  return `
<section class="${cid}-scroll" data-layout="motion" data-craft-scrollanim="1" data-craft-motion="1"
  data-base="${baseEsc}" data-reveal="${revEsc}">
  <div class="${cid}-sticky">
    <canvas class="${cid}-canvas" aria-hidden="true"></canvas>
    <div class="${cid}-veil"></div>
    <div class="${cid}-overlays">
${layers}
    </div>
    <div class="${cid}-hint"><span class="${cid}-hint-desk">ведите курсором</span><span class="${cid}-hint-mob">листайте вниз</span><i></i></div>
  </div>
</section>
<style>
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Manrope:wght@400;500;600&display=swap');
.${cid}-scroll{position:relative;height:${scrollVh}vh;margin:0;padding:0;background:#050505;}
.${cid}-sticky{position:sticky;top:0;height:100vh;width:100%;overflow:hidden;background:#050505;cursor:none;}
.${cid}-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0;touch-action:none;}
.${cid}-veil{position:absolute;inset:0;z-index:1;pointer-events:none;background:
  linear-gradient(90deg,rgba(0,0,0,.62) 0%,rgba(0,0,0,.28) 38%,rgba(0,0,0,.08) 62%,rgba(0,0,0,.22) 100%),
  radial-gradient(ellipse 55% 60% at 22% 48%,rgba(0,0,0,.25) 0%,transparent 70%);}
.${cid}-overlays{position:absolute;inset:0;z-index:2;pointer-events:none;}
.${cid}-text{position:absolute;left:clamp(18px,5vw,64px);right:auto;top:50%;transform:translateY(-50%);width:min(42vw,520px);max-width:calc(100% - 36px);text-align:left;opacity:0;color:#fff;will-change:opacity,transform;}
.${cid}-text h2{margin:0;font-family:'Syne',system-ui,sans-serif;font-weight:800;font-size:clamp(1.85rem,4.6vw,3.6rem);line-height:1.02;letter-spacing:-0.03em;text-shadow:0 10px 48px rgba(0,0,0,0.55);}
.${cid}-text p{margin:1rem 0 0;max-width:34ch;font-family:'Manrope',system-ui,sans-serif;font-size:clamp(.95rem,1.5vw,1.15rem);line-height:1.55;color:rgba(255,255,255,0.86);text-shadow:0 4px 24px rgba(0,0,0,0.45);}
.${cid}-hint{position:absolute;left:50%;bottom:max(22px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:3;display:flex;flex-direction:column;align-items:center;gap:8px;font-family:'Manrope',system-ui,sans-serif;font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.55);transition:opacity .4s;pointer-events:none;}
.${cid}-hint-mob{display:none;}
.${cid}-hint i{width:28px;height:28px;border:1.5px solid rgba(255,255,255,.35);border-radius:50%;position:relative;}
.${cid}-hint i::after{content:"";position:absolute;left:50%;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:#fff;animation:${cid}-pulse 1.4s ease-in-out infinite;}
@keyframes ${cid}-pulse{0%,100%{transform:scale(.7);opacity:.35}50%{transform:scale(1.15);opacity:1}}
@media (max-width:700px){
  .${cid}-sticky{cursor:auto;touch-action:pan-y;}
  .${cid}-canvas{touch-action:pan-y;pointer-events:none;}
  .${cid}-hint-desk{display:none;}
  .${cid}-hint-mob{display:inline;}
  .${cid}-text{left:clamp(16px,4vw,28px);width:min(88vw,420px);top:auto;bottom:clamp(72px,14vh,120px);transform:none;}
  .${cid}-veil{background:
    linear-gradient(180deg,rgba(0,0,0,.15) 0%,rgba(0,0,0,.2) 45%,rgba(0,0,0,.72) 100%);}
}
@media (hover:none), (pointer:coarse){
  .${cid}-sticky{cursor:auto;touch-action:pan-y;}
  .${cid}-canvas{touch-action:pan-y;pointer-events:none;}
  .${cid}-hint-desk{display:none;}
  .${cid}-hint-mob{display:inline;}
}
@media (prefers-reduced-motion:reduce){
  .${cid}-hint i::after{animation:none;}
}
</style>
<script>
(function(){
  var roots=document.querySelectorAll('.${cid}-scroll');
  roots.forEach(function(root){
    if(root.__csaInit)return;root.__csaInit=true;
    var sticky=root.querySelector('.${cid}-sticky');
    var canvas=root.querySelector('.${cid}-canvas');
    var hint=root.querySelector('.${cid}-hint');
    var texts=[].slice.call(root.querySelectorAll('.${cid}-text'));
    var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Phones/tablets: never capture touch for morph — vertical scroll must work.
    // Morph is driven by scroll progress instead of finger painting.
    var touchUI=window.matchMedia('(hover: none), (pointer: coarse), (max-width: 700px)').matches;
    var scrollP=0;
    var gl=canvas.getContext('webgl',{alpha:false,antialias:true,preserveDrawingBuffer:false})
      ||canvas.getContext('experimental-webgl',{alpha:false,antialias:true});
    if(!gl){var bu0=root.getAttribute('data-base')||'';if(bu0)root.style.background='center/cover no-repeat url("'+bu0.replace(/"/g,'')+'")';return;}

    function sh(type,src){
      var s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.warn(gl.getShaderInfoLog(s));return null;}
      return s;
    }
    function prog(vs,fs){
      var p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS)){console.warn(gl.getProgramInfoLog(p));return null;}
      return p;
    }

    var vsSrc='attribute vec2 a;varying vec2 v;void main(){v=.5*a+.5;gl_Position=vec4(a,0.,1.);}';
    var trailFs=
      'precision mediump float;varying vec2 v;uniform sampler2D uPrev;uniform vec2 uMouse;uniform float uDraw;uniform float uRadius;uniform float uHard;uniform float uFade;'+
      'void main(){vec4 p=texture2D(uPrev,v);float d=distance(v,uMouse);float m=smoothstep(uRadius,uRadius*(1.-uHard),d);'+
      'float a=max(p.r*uFade,uDraw*m);gl_FragColor=vec4(a,a,a,1.);}';
    // Same cover UV for base + reveal so I2I-aligned frames stay perfectly registered.
    var mainFs=
      'precision mediump float;varying vec2 v;uniform sampler2D uBase;uniform sampler2D uRev;uniform sampler2D uMask;'+
      'uniform vec2 uRes;uniform vec2 uBaseSize;uniform float uTime;uniform float uPix;'+
      'vec2 coverUV(vec2 uv,vec2 res,vec2 tex){float ar=res.x/max(res.y,.001);float tr=tex.x/max(tex.y,.001);vec2 s=ar>tr?vec2(tr/ar,1.):vec2(1.,ar/tr);return clamp((uv-.5)/s+.5,0.,1.);}'+
      'void main(){'+
      'float mask=texture2D(uMask,v).r;'+
      'float edge=smoothstep(0.05,0.55,mask)*smoothstep(0.95,0.45,mask);'+
      'float pix=mix(1.,uPix,edge*0.85);'+
      'vec2 grid=floor(v*uRes/pix)*pix/uRes;'+
      'vec2 uvP=coverUV(mix(v,grid,edge*0.65),uRes,uBaseSize);'+
      'float ca=edge*0.0045;'+
      'vec3 base=texture2D(uBase,uvP).rgb;'+
      'vec3 rev=vec3(texture2D(uRev,uvP+vec2(ca,0.)).r,texture2D(uRev,uvP).g,texture2D(uRev,uvP-vec2(ca,0.)).b);'+
      'vec3 col=mix(base,rev,smoothstep(0.08,0.72,mask));'+
      'col+=edge*vec3(0.08,0.03,0.12)*sin(uTime*2.+mask*6.283);'+
      'gl_FragColor=vec4(col,1.);}';

    var vs=sh(gl.VERTEX_SHADER,vsSrc);
    var trailP=prog(vs,sh(gl.FRAGMENT_SHADER,trailFs));
    var mainP=prog(vs,sh(gl.FRAGMENT_SHADER,mainFs));
    if(!trailP||!mainP){var bu1=root.getAttribute('data-base')||'';if(bu1)root.style.background='center/cover no-repeat url("'+bu1.replace(/"/g,'')+'")';return;}

    var buf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);

    function makeTex(filter){
      var t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
      return t;
    }
    function loadTex(url,cb){
      var t=makeTex(gl.LINEAR),im=new Image();im.crossOrigin='anonymous';
      im.onload=function(){gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);cb(t,im.naturalWidth,im.naturalHeight);};
      im.onerror=function(){cb(null,0,0);};im.src=url;
    }

    var baseTex=null,revTex=null,baseSize=[1,1],loaded=0;
    function onReady(){
      loaded++;
      if(loaded>=2){
        try{window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){}
        resize();loop();
      }
    }
    var baseUrl=root.getAttribute('data-base')||'${baseJs}';
    var revUrl=root.getAttribute('data-reveal')||'${revJs}';
    loadTex(baseUrl,function(t,w,h){baseTex=t;baseSize=[w||1,h||1];onReady();});
    loadTex(revUrl,function(t,w,h){revTex=t;onReady();});

    var trailA=makeTex(gl.LINEAR),trailB=makeTex(gl.LINEAR),fbo=gl.createFramebuffer();
    var tw=1,th=1,flip=false;
    function allocTrail(w,h){
      tw=w;th=h;
      [trailA,trailB].forEach(function(t){
        gl.bindTexture(gl.TEXTURE_2D,t);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,tw,th,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      });
      // clear
      gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,trailA,0);
      gl.viewport(0,0,tw,th);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,trailB,0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }

    var mouse={x:0.5,y:0.5},drawing=0,hasMoved=0,start=performance.now();
    function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
    function setPtr(e){
      if(touchUI) return; // mobile: scroll owns the gesture
      var r=canvas.getBoundingClientRect();
      var cx=(e.clientX!==undefined?e.clientX:(e.touches&&e.touches[0]?e.touches[0].clientX:r.left+r.width/2));
      var cy=(e.clientY!==undefined?e.clientY:(e.touches&&e.touches[0]?e.touches[0].clientY:r.top+r.height/2));
      mouse.x=(cx-r.left)/Math.max(1,r.width);
      mouse.y=1-(cy-r.top)/Math.max(1,r.height);
      drawing=1;hasMoved=1;
      if(hint)hint.style.opacity='0';
    }
    if(!touchUI){
      canvas.addEventListener('pointermove',setPtr,{passive:true});
      canvas.addEventListener('pointerdown',setPtr,{passive:true});
      window.addEventListener('pointerup',function(){drawing=0;});
    }
    // Idle auto-reveal pulse so the effect is discoverable without hover (desktop only)
    var autoT=0;

    function bindAttr(p){
      var loc=gl.getAttribLocation(p,'a');
      gl.bindBuffer(gl.ARRAY_BUFFER,buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    }

    function stepTrail(dt){
      var read=flip?trailB:trailA,write=flip?trailA:trailB;
      gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,write,0);
      gl.viewport(0,0,tw,th);
      gl.useProgram(trailP);bindAttr(trailP);

      var mx=mouse.x,my=mouse.y,drawAmt,rad,fade,hard;

      if(touchUI){
        // Scroll-linked morph: fresh expanding reveal each frame — no touch capture.
        gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,read);
        gl.uniform1i(gl.getUniformLocation(trailP,'uPrev'),0);
        mx=0.62; my=0.42;
        drawAmt = scrollP > 0.01 ? 1 : 0;
        rad = 0.1 + clamp(scrollP,0,1) * 0.78;
        fade = 0;
        hard = 0.35;
        if(hint) hint.style.opacity = String(clamp(1 - scrollP * 2.2, 0, 1));
      } else {
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,read);
        gl.uniform1i(gl.getUniformLocation(trailP,'uPrev'),0);
        if(!hasMoved&&!reduce){
          autoT+=dt;
          mx=0.5+Math.sin(autoT*0.55)*0.22;
          my=0.48+Math.cos(autoT*0.4)*0.16;
        }
        drawAmt=(drawing||!hasMoved)?1:0;
        if(reduce)drawAmt=hasMoved?1:0.35;
        rad=hasMoved?0.12:0.16;
        fade=0.965;
        hard=0.55;
      }

      gl.uniform2f(gl.getUniformLocation(trailP,'uMouse'),mx,my);
      gl.uniform1f(gl.getUniformLocation(trailP,'uDraw'),drawAmt);
      gl.uniform1f(gl.getUniformLocation(trailP,'uRadius'),rad);
      gl.uniform1f(gl.getUniformLocation(trailP,'uHard'),hard);
      gl.uniform1f(gl.getUniformLocation(trailP,'uFade'),fade);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      flip=!flip;
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }

    function drawMain(){
      var mask=flip?trailA:trailB;
      gl.viewport(0,0,canvas.width,canvas.height);
      gl.useProgram(mainP);bindAttr(mainP);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,baseTex);
      gl.uniform1i(gl.getUniformLocation(mainP,'uBase'),0);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,revTex);
      gl.uniform1i(gl.getUniformLocation(mainP,'uRev'),1);
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,mask);
      gl.uniform1i(gl.getUniformLocation(mainP,'uMask'),2);
      gl.uniform2f(gl.getUniformLocation(mainP,'uRes'),canvas.width,canvas.height);
      gl.uniform2f(gl.getUniformLocation(mainP,'uBaseSize'),baseSize[0],baseSize[1]);
      gl.uniform1f(gl.getUniformLocation(mainP,'uTime'),(performance.now()-start)/1000);
      gl.uniform1f(gl.getUniformLocation(mainP,'uPix'),Math.max(6,Math.min(18,canvas.width/70)));
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }

    var last=performance.now();
    function loop(){
      var now=performance.now(),dt=Math.min(0.05,(now-last)/1000);last=now;
      if(baseTex&&revTex){stepTrail(dt);drawMain();}
      requestAnimationFrame(loop);
    }

    function resize(){
      var w=sticky.clientWidth,h=sticky.clientHeight,dpr=Math.min(window.devicePixelRatio||1,2);
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
      canvas.style.width=w+'px';canvas.style.height=h+'px';
      allocTrail(Math.max(1,Math.round(w*0.5)),Math.max(1,Math.round(h*0.5)));
    }
    window.addEventListener('resize',resize);

    function setP(p){
      p=clamp(p,0,1);
      scrollP=p;
      if(hint&&hasMoved&&!touchUI)hint.style.opacity=String(clamp(1-p*3.5,0,1));
      var mobile=touchUI||window.matchMedia('(max-width:700px)').matches;
      texts.forEach(function(el){
        var fi=parseFloat(el.getAttribute('data-fi')),fis=parseFloat(el.getAttribute('data-fis'));
        var fos=parseFloat(el.getAttribute('data-fos')),fo=parseFloat(el.getAttribute('data-fo'));
        var op=0;
        if(!isNaN(fi)&&p>=fi&&p<=fo){
          op=p<fis?(fis>fi?(p-fi)/(fis-fi):1):(p<=fos?1:(fo>fos?1-(p-fos)/(fo-fos):1));
        }
        op=clamp(op,0,1);
        el.style.opacity=op.toFixed(3);
        // Left-aligned copy — do not re-center with translateX(-50%).
        if(mobile){
          el.style.transform='translateY('+((1-op)*14)+'px)';
        } else {
          el.style.transform='translateY(calc(-50% + '+((1-op)*18)+'px))';
        }
      });
    }
    function secTop(){return root.getBoundingClientRect().top+(window.pageYOffset||document.documentElement.scrollTop);}
    function totH(){return Math.max(1,root.offsetHeight-window.innerHeight);}
    function syncScroll(){var s=secTop(),t=totH(),top=window.pageYOffset||document.documentElement.scrollTop;setP((top-s)/t);}
    window.addEventListener('scroll',syncScroll,{passive:true});
    resize();syncScroll();
  });
})();
</script>${navCtl}`;
}
