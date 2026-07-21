/**
 * «Моушн» — WebGL mouse-trail image reveal (Lando Norris / Unicorn Studio style).
 *
 * Pipeline: 2 paired stills via KIE (nano-banana-2 + gpt-image-2-image-to-image)
 * → self-contained HTML with fluid cursor reveal, chromatic edges, soft pixelation.
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
const I2I_MODEL = "gpt-image-2-image-to-image";
const STILL_DEADLINE_MS = 3 * 60 * 1000;
const MAX_STILL_ATTEMPTS = 4;

function cleanEnglishPrompt(raw: string): string {
  const cleaned = raw
    .replace(/[\u0400-\u04FF][\u0400-\u04FF\s,;:!?—–-]*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s.,;:]+|[\s.,;:]+$/g, "")
    .trim();
  return cleaned.length > 12
    ? cleaned
    : "premium brand hero subject, cinematic editorial portrait, centered composition";
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
  while (Date.now() < deadline) {
    if (deps.shouldStop()) return null;
    await new Promise((r) => setTimeout(r, 4000));
    const body: any = await deps.kieRequestJson(
      `${deps.statusUrl}?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${deps.kieApiKey}` } },
      { label: `${label}-poll`, retries: 2, shouldStop: () => deps.shouldStop() || Date.now() >= deadline },
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
    if (attempt > 0) await new Promise((r) => setTimeout(r, 4000));
    const model = inputUrl ? I2I_MODEL : STILL_MODEL;
    const input: any = inputUrl
      ? { prompt, input_urls: [inputUrl], aspect_ratio: "16:9", resolution: "2K" }
      : { prompt, aspect_ratio: "16:9", resolution: "2K" };
    const createBody: any = await deps.kieRequestJson(
      deps.createUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deps.kieApiKey}`,
        },
        body: JSON.stringify({ model, input }),
      },
      { label: `${label}-create`, retries: 4, shouldStop: deps.shouldStop },
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

function buildBasePrompt(scene: string, hasProduct: boolean): string {
  if (hasProduct) {
    return (
      `Take the exact product from the reference image and keep it perfectly identical ` +
      `(same shape, label, text, colors and proportions). Place it as a hero product shot ` +
      `centered in frame on a dark premium studio backdrop. Convert the whole frame to ` +
      `high-contrast black-and-white editorial photography (gradient-map monochrome), ` +
      `dramatic rim light, soft volumetric haze, magazine cover composition. ` +
      `No text, no watermark, no logos added. Ultra-high detail, 8K, 16:9. ` +
      `Subject context: ${scene}`
    );
  }
  return (
    `${scene}. Create a striking HERO still for a premium interactive website. ` +
    `Centered subject (person, product or brand icon matching the niche), tight cinematic framing, ` +
    `high-contrast BLACK AND WHITE editorial photograph (gradient-map monochrome), ` +
    `dramatic studio key + rim light, soft atmospheric haze, shallow depth of field, ` +
    `clean dark background, powerful and iconic like a luxury campaign. ` +
    `No text, no watermark, no logos. Ultra-high detail, 8K, 16:9 aspect ratio.`
  );
}

function buildRevealPrompt(scene: string, hasProduct: boolean): string {
  if (hasProduct) {
    return (
      `Keep the EXACT same product, pose, framing and composition as the reference image. ` +
      `Transform it into a vivid COLOR reveal: neon chromatic glow, rich saturated brand colors ` +
      `(warm orange into electric cyan/magenta accents), glossy premium lighting, ` +
      `subtle liquid iridescence and lens chromatic aberration around edges, ` +
      `cinematic luxury commercial look. The product identity must stay identical. ` +
      `No text, no watermark. Ultra-high detail, 8K, 16:9. Context: ${scene}`
    );
  }
  return (
    `Keep the EXACT same subject identity, pose, framing and composition as the reference. ` +
    `Reveal a spectacular COLOR transformation of the same hero: vibrant neon gradient map ` +
    `(deep blacks into electric orange, magenta and cyan), premium brand metamorphosis ` +
    `(mask, helmet, luminous aura, couture detail or product glow that fits the niche), ` +
    `chromatic aberration edges, glossy cinematic lighting, liquid iridescence. ` +
    `Same silhouette and camera angle as the reference — only the look transforms. ` +
    `No text, no watermark. Ultra-high detail, 8K, 16:9. Niche: ${scene}`
  );
}

export async function generateMotionRevealPair(opts: {
  scenePrompt: string;
  productImageUrl?: string;
  deps: GenerateMotionRevealDeps;
}): Promise<{ baseUrl: string; revealUrl: string } | null> {
  const { deps } = opts;
  const scene = cleanEnglishPrompt(opts.scenePrompt);
  const hasProduct = !!opts.productImageUrl;

  deps.onStatus?.("Моушн: генерирую базовый кадр (чёрно-белый герой)…");
  const baseUrl = await createStill(
    deps,
    buildBasePrompt(scene, hasProduct),
    "MOTION base",
    opts.productImageUrl,
  );
  if (!baseUrl) {
    console.warn("[MOTION] base still failed");
    return null;
  }

  deps.onStatus?.("Моушн: генерирую reveal-кадр (цветное преображение)…");
  let revealUrl = await createStill(
    deps,
    buildRevealPrompt(scene, hasProduct),
    "MOTION reveal",
    baseUrl,
  );
  // Fallback: text-to-image reveal if i2i fails
  if (!revealUrl) {
    console.warn("[MOTION] reveal i2i failed — trying text-to-image");
    revealUrl = await createStill(
      deps,
      buildRevealPrompt(scene, false) + ` Match this subject: ${scene}`,
      "MOTION reveal-t2i",
    );
  }
  if (!revealUrl) {
    console.warn("[MOTION] reveal still failed");
    return null;
  }

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
    <div class="${cid}-hint"><span>ведите курсором</span><i></i></div>
  </div>
</section>
<style>
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Manrope:wght@400;500;600&display=swap');
.${cid}-scroll{position:relative;height:${scrollVh}vh;margin:0;padding:0;background:#050505;}
.${cid}-sticky{position:sticky;top:0;height:100vh;width:100%;overflow:hidden;background:#050505;cursor:none;}
.${cid}-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0;touch-action:none;}
.${cid}-veil{position:absolute;inset:0;z-index:1;pointer-events:none;background:
  radial-gradient(ellipse 65% 55% at 50% 42%,rgba(0,0,0,0.08) 0%,rgba(0,0,0,0.45) 72%,rgba(0,0,0,0.72) 100%),
  linear-gradient(180deg,rgba(0,0,0,0.28) 0%,rgba(0,0,0,0.05) 40%,rgba(0,0,0,0.55) 100%);}
.${cid}-overlays{position:absolute;inset:0;z-index:2;pointer-events:none;}
.${cid}-text{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92vw,720px);text-align:center;opacity:0;color:#fff;will-change:opacity,transform;}
.${cid}-text h2{margin:0;font-family:'Syne',system-ui,sans-serif;font-weight:800;font-size:clamp(2rem,5.2vw,4rem);line-height:1.02;letter-spacing:-0.03em;text-shadow:0 10px 48px rgba(0,0,0,0.55);}
.${cid}-text p{margin:1rem auto 0;max-width:38ch;font-family:'Manrope',system-ui,sans-serif;font-size:clamp(1rem,1.6vw,1.22rem);line-height:1.55;color:rgba(255,255,255,0.82);text-shadow:0 4px 24px rgba(0,0,0,0.45);}
.${cid}-hint{position:absolute;left:50%;bottom:max(22px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:3;display:flex;flex-direction:column;align-items:center;gap:8px;font-family:'Manrope',system-ui,sans-serif;font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.55);transition:opacity .4s;pointer-events:none;}
.${cid}-hint i{width:28px;height:28px;border:1.5px solid rgba(255,255,255,.35);border-radius:50%;position:relative;}
.${cid}-hint i::after{content:"";position:absolute;left:50%;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:#fff;animation:${cid}-pulse 1.4s ease-in-out infinite;}
@keyframes ${cid}-pulse{0%,100%{transform:scale(.7);opacity:.35}50%{transform:scale(1.15);opacity:1}}
@media (max-width:700px){
  .${cid}-sticky{cursor:auto;}
  .${cid}-text{width:min(94vw,420px);}
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
    var mainFs=
      'precision mediump float;varying vec2 v;uniform sampler2D uBase;uniform sampler2D uRev;uniform sampler2D uMask;'+
      'uniform vec2 uRes;uniform vec2 uBaseSize;uniform vec2 uRevSize;uniform float uTime;uniform float uPix;'+
      'vec2 coverUV(vec2 uv,vec2 res,vec2 tex){float ar=res.x/max(res.y,.001);float tr=tex.x/max(tex.y,.001);vec2 s=ar>tr?vec2(tr/ar,1.):vec2(1.,ar/tr);return clamp((uv-.5)/s+.5,0.,1.);}'+
      'void main(){'+
      'float mask=texture2D(uMask,v).r;'+
      'float edge=smoothstep(0.05,0.55,mask)*smoothstep(0.95,0.45,mask);'+
      'float pix=mix(1.,uPix,edge*0.85);'+
      'vec2 grid=floor(v*uRes/pix)*pix/uRes;'+
      'vec2 buP=coverUV(mix(v,grid,edge*0.65),uRes,uBaseSize);'+
      'vec2 ruP=coverUV(mix(v,grid,edge*0.65),uRes,uRevSize);'+
      'float ca=edge*0.0045;'+
      'vec3 base=texture2D(uBase,buP).rgb;'+
      'vec3 rev=vec3(texture2D(uRev,ruP+vec2(ca,0.)).r,texture2D(uRev,ruP).g,texture2D(uRev,ruP-vec2(ca,0.)).b);'+
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

    var baseTex=null,revTex=null,baseSize=[1,1],revSize=[1,1],loaded=0;
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
    loadTex(revUrl,function(t,w,h){revTex=t;revSize=[w||1,h||1];onReady();});

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
    function setPtr(e){
      var r=canvas.getBoundingClientRect();
      var cx=(e.clientX!==undefined?e.clientX:(e.touches&&e.touches[0]?e.touches[0].clientX:r.left+r.width/2));
      var cy=(e.clientY!==undefined?e.clientY:(e.touches&&e.touches[0]?e.touches[0].clientY:r.top+r.height/2));
      mouse.x=(cx-r.left)/Math.max(1,r.width);
      mouse.y=1-(cy-r.top)/Math.max(1,r.height);
      drawing=1;hasMoved=1;
      if(hint)hint.style.opacity='0';
    }
    canvas.addEventListener('pointermove',setPtr,{passive:true});
    canvas.addEventListener('pointerdown',setPtr,{passive:true});
    canvas.addEventListener('touchmove',function(e){if(e.touches&&e.touches[0])setPtr(e.touches[0]);},{passive:true});
    canvas.addEventListener('touchstart',function(e){if(e.touches&&e.touches[0])setPtr(e.touches[0]);},{passive:true});
    window.addEventListener('pointerup',function(){drawing=0;});
    // Idle auto-reveal pulse so the effect is discoverable without hover
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
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,read);
      gl.uniform1i(gl.getUniformLocation(trailP,'uPrev'),0);
      var mx=mouse.x,my=mouse.y;
      if(!hasMoved&&!reduce){
        autoT+=dt;
        mx=0.5+Math.sin(autoT*0.55)*0.22;
        my=0.48+Math.cos(autoT*0.4)*0.16;
      }
      gl.uniform2f(gl.getUniformLocation(trailP,'uMouse'),mx,my);
      var drawAmt=(drawing||!hasMoved)?1:0;
      if(reduce)drawAmt=hasMoved?1:0.35;
      gl.uniform1f(gl.getUniformLocation(trailP,'uDraw'),drawAmt);
      gl.uniform1f(gl.getUniformLocation(trailP,'uRadius'),hasMoved?0.12:0.16);
      gl.uniform1f(gl.getUniformLocation(trailP,'uHard'),0.55);
      gl.uniform1f(gl.getUniformLocation(trailP,'uFade'),0.965);
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
      gl.uniform2f(gl.getUniformLocation(mainP,'uRevSize'),revSize[0],revSize[1]);
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

    function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
    function setP(p){
      p=clamp(p,0,1);
      if(hint&&hasMoved)hint.style.opacity=String(clamp(1-p*3.5,0,1));
      texts.forEach(function(el){
        var fi=parseFloat(el.getAttribute('data-fi')),fis=parseFloat(el.getAttribute('data-fis'));
        var fos=parseFloat(el.getAttribute('data-fos')),fo=parseFloat(el.getAttribute('data-fo'));
        var op=0;
        if(!isNaN(fi)&&p>=fi&&p<=fo){
          op=p<fis?(fis>fi?(p-fi)/(fis-fi):1):(p<=fos?1:(fo>fos?1-(p-fos)/(fo-fos):1));
        }
        op=clamp(op,0,1);
        el.style.opacity=op.toFixed(3);
        el.style.transform='translate(-50%,calc(-50% + '+((1-op)*18)+'px))';
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
