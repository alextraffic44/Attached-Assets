/**
 * «3D» mode — product-hero cinematic site (ZOICE-style).
 *
 * One Kling MP4 (product on dark void, scroll-scrubbed) as fixed full-site
 * background. Giant headline sits behind the product; glass UI layers on top.
 * Separate from «Погружение» (brand-world fly-through + glass).
 */

export function buildSite3dPendingHtml(
  videoPrompt: string,
  texts: Array<{ title: string; sub: string }>,
): string {
  const tid = "s3dp" + Math.random().toString(36).slice(2, 8);
  const first = texts[0] || { title: "", sub: "" };
  const _pa = videoPrompt
    ? ` data-scroll-anim-prompt="${encodeURIComponent(videoPrompt)}"`
    : "";
  const _sa = ` data-scroll-anim-style="${encodeURIComponent("site3d")}"`;
  const _ta = texts.length
    ? ` data-scroll-anim-texts="${encodeURIComponent(
        texts.map((t) => `${t.title}::${t.sub}`).join("||"),
      )}"`
    : "";

  return `<section id="craft-site3d-pending" data-scroll-anim-pending="1" data-craft-scrollanim="1" data-layout="site3d"${_pa}${_sa}${_ta} style="position:relative;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#050505;">
<style>
@keyframes ${tid}-spin{to{transform:rotate(360deg)}}
@keyframes ${tid}-pulse{0%,100%{opacity:.4}50%{opacity:1}}
@keyframes ${tid}-bar{0%{width:0%}100%{width:78%}}
@keyframes ${tid}-fade{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
</style>
<div style="text-align:center;color:#F4F0EA;z-index:2;padding:40px;max-width:560px;animation:${tid}-fade .65s ease both;">
  ${first.title ? `<div style="font-size:clamp(1.5rem,4vw,2.6rem);font-weight:800;letter-spacing:-.03em;margin:0 0 .35em;opacity:.9;">${escapeBasic(first.title)}</div>` : ""}
  ${first.sub ? `<div style="font-size:.95rem;color:rgba(244,240,234,.45);margin:0 0 1.6rem;line-height:1.5;">${escapeBasic(first.sub)}</div>` : ""}
  <div style="display:inline-flex;align-items:center;gap:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:18px 26px;margin-bottom:1.3rem;backdrop-filter:blur(16px);">
    <div style="width:34px;height:34px;border:2.5px solid rgba(255,255,255,.12);border-top-color:#A8C5FF;border-radius:50%;flex-shrink:0;animation:${tid}-spin .9s linear infinite;"></div>
    <div style="text-align:left;">
      <div style="font-size:.95rem;font-weight:600;margin-bottom:2px;">Рендерим 3D-сцену продукта…</div>
      <div style="font-size:.8rem;color:rgba(244,240,234,.5);">Kling · 12 сек · обычно 10–25 минут</div>
    </div>
  </div>
  <div style="width:220px;height:3px;background:rgba(255,255,255,.08);border-radius:99px;margin:0 auto 1.2rem;overflow:hidden;">
    <div style="height:100%;background:linear-gradient(90deg,#A8C5FF,#E8D5B5);border-radius:99px;animation:${tid}-bar 16s cubic-bezier(.4,0,.2,1) forwards;"></div>
  </div>
  <div style="font-size:.78rem;color:rgba(244,240,234,.32);line-height:1.6;animation:${tid}-pulse 2.4s ease-in-out infinite;">Стекло-секции уже на странице — прокрутите вниз ↓</div>
</div>
</section>`;
}

function escapeBasic(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Final baked HTML: fixed product video + giant type behind + hero glass + scrub.
 * Agent-written sections after the marker sit over the same fixed video.
 */
export function buildSite3dAnimHtml(
  frames: string[],
  texts: Array<{ title: string; sub: string }>,
  navCtl: string,
  esc: (s: string) => string,
  videoUrl?: string,
): string {
  const cid = "s3d" + Math.random().toString(36).slice(2, 8);
  const vid = esc(videoUrl || "");
  const hero = texts[0] || { title: "", sub: "" };
  const heroTitle = hero.title ? esc(hero.title) : "";
  const heroSub = hero.sub ? esc(hero.sub) : "";
  // Giant type behind product — prefer first title; fallback short brand line
  const giant = heroTitle || "PRODUCT";
  const framesJson = JSON.stringify(frames || []).replace(/'/g, "&#39;");

  return `
<div id="craft-site3d-bg" class="${cid}-bg" data-layout="site3d"${vid ? ` data-video="${vid}"` : ""} data-frames='${framesJson}' aria-hidden="true">
  ${vid
    ? `<video class="${cid}-video" src="${vid}" muted playsinline preload="auto"></video>`
    : `<canvas class="${cid}-canvas" aria-hidden="true"></canvas>`}
  <div class="${cid}-void"></div>
</div>
<div class="${cid}-giant" aria-hidden="true"><span>${giant}</span></div>
<section id="top" class="${cid}-hero" data-craft-scrollanim="1" data-layout="site3d" data-craft-site3d-hero="1">
  <div class="${cid}-hero__glass">
    ${heroTitle ? `<h1 class="${cid}-hero__title">${heroTitle}</h1>` : ""}
    ${heroSub ? `<p class="${cid}-hero__sub">${heroSub}</p>` : ""}
    <div class="${cid}-hint"><span>Scroll</span><i></i></div>
  </div>
</section>
<style>
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Manrope:wght@400;500;600&display=swap');
html.craft-site3d,body.craft-site3d{background:#050505!important;min-height:100%;}
.${cid}-bg{position:fixed;inset:0;z-index:2;pointer-events:none;overflow:hidden;background:transparent;}
.${cid}-video,.${cid}-canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center 42%;transform:scale(1.02);}
.${cid}-void{position:absolute;inset:0;pointer-events:none;background:
  radial-gradient(ellipse 55% 50% at 50% 42%,rgba(0,0,0,0) 0%,rgba(0,0,0,.35) 55%,rgba(0,0,0,.75) 100%),
  linear-gradient(180deg,rgba(0,0,0,.45) 0%,rgba(0,0,0,.08) 38%,rgba(0,0,0,.7) 100%);}
.${cid}-giant{position:fixed;inset:0;z-index:1;display:grid;place-items:center;pointer-events:none;overflow:hidden;}
.${cid}-giant span{
  font-family:'Syne',system-ui,sans-serif;font-weight:800;
  font-size:clamp(4.5rem,18vw,14rem);line-height:.85;letter-spacing:-.06em;
  text-transform:uppercase;text-align:center;color:rgba(255,255,255,.14);
  max-width:92vw;user-select:none;
  text-shadow:0 0 80px rgba(255,255,255,.04);
}
.${cid}-hero{position:relative;z-index:3;min-height:100vh;display:grid;place-items:end center;padding:clamp(88px,12vh,140px) clamp(18px,5vw,64px) clamp(36px,7vh,72px);box-sizing:border-box;}
.${cid}-hero__glass{
  width:min(640px,100%);
  padding:clamp(20px,3.2vw,36px) clamp(20px,3.5vw,40px);
  border-radius:24px;
  background:linear-gradient(155deg,rgba(255,255,255,.12) 0%,rgba(255,255,255,.04) 55%,rgba(255,255,255,.02) 100%);
  border:1px solid rgba(255,255,255,.18);
  box-shadow:0 24px 70px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.22);
  backdrop-filter:blur(20px) saturate(1.3);-webkit-backdrop-filter:blur(20px) saturate(1.3);
  text-align:center;color:#fff;
}
.${cid}-hero__title{margin:0;font-family:'Syne',system-ui,sans-serif;font-size:clamp(1.6rem,3.8vw,2.6rem);font-weight:800;letter-spacing:-.03em;line-height:1.05;text-shadow:0 6px 28px rgba(0,0,0,.5);}
.${cid}-hero__sub{margin:.7rem auto 0;max-width:36ch;font-family:'Manrope',system-ui,sans-serif;font-size:clamp(.92rem,1.4vw,1.08rem);line-height:1.5;color:rgba(255,255,255,.82);}
.${cid}-hint{margin-top:1.2rem;display:inline-flex;flex-direction:column;align-items:center;gap:8px;font-family:'Manrope',system-ui,sans-serif;font-size:.65rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.5);transition:opacity .35s;}
.${cid}-hint i{width:18px;height:28px;border:1.5px solid rgba(255,255,255,.35);border-radius:10px;position:relative;}
.${cid}-hint i::after{content:"";position:absolute;left:50%;top:5px;width:3px;height:6px;border-radius:2px;background:#fff;transform:translateX(-50%);animation:${cid}-wheel 1.6s ease-in-out infinite;}
@keyframes ${cid}-wheel{0%{opacity:0;top:5px}35%{opacity:1}100%{opacity:0;top:14px}}

body.craft-site3d > *:not(#craft-site3d-bg):not(.${cid}-giant):not(#site-preloader){position:relative;z-index:3;}
body.craft-site3d header{z-index:1000!important;}

/* Liquid glass for agent sections over the product film */
body.craft-site3d section:not(.${cid}-hero),
body.craft-site3d footer{
  background:transparent!important;
  background-color:transparent!important;
}
body.craft-site3d section:not(.${cid}-hero) > .container,
body.craft-site3d section:not(.${cid}-hero) > .wrap,
body.craft-site3d section:not(.${cid}-hero) > .inner,
body.craft-site3d [class*="card"],
body.craft-site3d [class*="Card"],
body.craft-site3d article,
body.craft-site3d .feature,
body.craft-site3d .pricing,
body.craft-site3d .review,
body.craft-site3d .testimonial,
body.craft-site3d form,
body.craft-site3d .glass,
body.craft-site3d .liquid-glass{
  background:linear-gradient(155deg,rgba(255,255,255,.11) 0%,rgba(255,255,255,.04) 55%,rgba(255,255,255,.025) 100%)!important;
  border:1px solid rgba(255,255,255,.16)!important;
  box-shadow:0 20px 60px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.18)!important;
  backdrop-filter:blur(18px) saturate(1.25)!important;-webkit-backdrop-filter:blur(18px) saturate(1.25)!important;
  border-radius:22px;
  color:#fff;
  position:relative;
}
body.craft-site3d section:not(.${cid}-hero) > .container::before,
body.craft-site3d [class*="card"]::before,
body.craft-site3d .glass::before,
body.craft-site3d .liquid-glass::before{
  content:"";position:absolute;inset:0;border-radius:inherit;padding:1.2px;pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.45),rgba(255,255,255,.08) 40%,rgba(255,255,255,.05) 60%,rgba(255,255,255,.28));
  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;
}
body.craft-site3d h1,body.craft-site3d h2,body.craft-site3d h3,
body.craft-site3d p,body.craft-site3d li,body.craft-site3d a,body.craft-site3d span,body.craft-site3d label{
  text-shadow:0 1px 14px rgba(0,0,0,.3);
}
@media (max-width:700px){
  .${cid}-video,.${cid}-canvas{object-fit:contain;object-position:center 38%;}
  .${cid}-giant span{font-size:clamp(3.2rem,22vw,7rem);}
}
@media (prefers-reduced-motion:reduce){.${cid}-hint i::after{animation:none;}}
</style>
<script>
(function(){
  if(window.__craftSite3d)return;window.__craftSite3d=true;
  document.documentElement.classList.add('craft-site3d');
  document.body.classList.add('craft-site3d');
  var root=document.getElementById('craft-site3d-bg');
  if(!root)return;
  var video=root.querySelector('.${cid}-video');
  var canvas=root.querySelector('.${cid}-canvas');
  var hint=document.querySelector('.${cid}-hint');
  var giant=document.querySelector('.${cid}-giant');
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function progress(){
    var max=Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    return Math.max(0, Math.min(1, window.scrollY / max));
  }
  function applyChrome(p){
    if(hint) hint.style.opacity = p < 0.06 ? '1' : '0';
    if(giant){
      var s=1 + p*0.12;
      var o=Math.max(0.06, 0.16 - p*0.1);
      giant.style.transform='scale('+s.toFixed(3)+')';
      var sp=giant.querySelector('span');
      if(sp) sp.style.color='rgba(255,255,255,'+o.toFixed(3)+')';
    }
  }

  if(video){
    var seeking=false, target=0, ready=false;
    function apply(){
      if(!ready || !video.duration) return;
      var p=progress();
      target = p * Math.max(0, video.duration - 0.05);
      if(reduce){ try{ video.currentTime=target; }catch(e){} applyChrome(p); return; }
      if(!seeking && Math.abs((video.currentTime||0)-target)>0.04){
        seeking=true;
        try{
          video.currentTime=target;
          var done=function(){seeking=false;video.removeEventListener('seeked',done);};
          video.addEventListener('seeked',done);
        }catch(e){seeking=false;}
      }
      applyChrome(p);
    }
    function onScroll(){ requestAnimationFrame(apply); }
    video.addEventListener('loadedmetadata', function(){ ready=true; apply(); try{window.dispatchEvent(new Event('craft:frames-ready'));window.dispatchEvent(new Event('craft:anim-ready'));}catch(e){} });
    if(video.readyState>=1){ ready=true; }
    window.addEventListener('scroll', onScroll, {passive:true});
    window.addEventListener('resize', onScroll);
    function prime(){ try{ var p=video.play(); if(p&&p.then)p.then(function(){try{video.pause();}catch(e){}}).catch(function(){});}catch(e){} }
    window.addEventListener('pointerdown', prime, {once:true, passive:true});
    window.addEventListener('touchstart', prime, {once:true, passive:true});
    apply();
  } else if(canvas){
    var frames;try{frames=JSON.parse(root.getAttribute('data-frames')||'[]');}catch(e){frames=[];}
    if(!frames.length){ applyChrome(0); return; }
    var ctx=canvas.getContext('2d');
    var imgs=new Array(frames.length),started=new Array(frames.length),cur=-1;
    var dpr=Math.min(window.devicePixelRatio||1,2);
    function contain(img){
      var cw=root.clientWidth,ch=root.clientHeight,iw=img.naturalWidth,ih=img.naturalHeight;
      if(!iw||!ih)return;
      var s=Math.min(cw/iw,ch/ih)*0.92,dw=iw*s,dh=ih*s,dx=(cw-dw)/2,dy=(ch-dh)*0.42;
      ctx.clearRect(0,0,cw,ch);ctx.drawImage(img,dx,dy,dw,dh);
    }
    function resize(){
      var w=root.clientWidth,h=root.clientHeight;
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);
      if(cur>=0&&imgs[cur])contain(imgs[cur]);
    }
    function ensure(i){
      if(i<0||i>=frames.length||started[i])return;
      started[i]=1;
      var im=new Image();im.decoding='async';imgs[i]=im;
      im.onload=function(){if(i===cur)contain(im);};
      im.src=frames[i];
    }
    function nearest(i){
      if(imgs[i]&&imgs[i].complete&&imgs[i].naturalWidth)return i;
      for(var d=1;d<frames.length;d++){
        var a=i-d,b=i+d;
        if(a>=0&&imgs[a]&&imgs[a].complete&&imgs[a].naturalWidth)return a;
        if(b<frames.length&&imgs[b]&&imgs[b].complete&&imgs[b].naturalWidth)return b;
      }
      return -1;
    }
    function paint(i){
      i=Math.max(0,Math.min(frames.length-1,i));cur=i;
      var use=nearest(i);if(use!==-1)contain(imgs[use]);ensure(i);
      for(var k=1;k<=3;k++){ensure(i+k);ensure(i-k);}
    }
    function onScrollFrames(){
      var p=progress();
      paint(Math.round(p*(frames.length-1)));
      applyChrome(p);
    }
    var loadedCount=0,total=frames.length,activeCount=0,MAXP=6,nextSeq=0;
    function pump(){
      while(activeCount<MAXP&&nextSeq<total){
        var i=nextSeq++;activeCount++;
        var im=new Image();im.decoding='async';imgs[i]=im;started[i]=1;
        im.onload=im.onerror=function(){activeCount--;loadedCount++;if(loadedCount===1)paint(0);if(loadedCount>=total){try{window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){}}pump();};
        im.src=frames[i];
      }
    }
    window.addEventListener('scroll',onScrollFrames,{passive:true});
    window.addEventListener('resize',function(){resize();onScrollFrames();});
    resize();pump();onScrollFrames();
  }

  try{
    var pending=document.getElementById('craft-site3d-pending');
    if(pending) pending.style.display='none';
  }catch(e){}
})();
</script>
${navCtl}
`;
}
