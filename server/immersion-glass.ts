/**
 * «Погружение» v2 — one Kling MP4 as fixed full-site background, scrubbed by
 * page scroll. Agent-written content layers on top with glassmorphism.
 *
 * Unlike the old 5-scene scroll-world, this does NOT cut frames and does NOT
 * own the site chrome — only the video + scrub + global glass CSS.
 */

export function buildImmersionGlassPendingHtml(
  videoPrompt: string,
  texts: Array<{ title: string; sub: string }>,
): string {
  const tid = "igp" + Math.random().toString(36).slice(2, 8);
  const _pa = videoPrompt
    ? ` data-scroll-anim-prompt="${encodeURIComponent(videoPrompt)}"`
    : "";
  const _sa = ` data-scroll-anim-style="${encodeURIComponent("immersion")}"`;
  const _ta = texts.length
    ? ` data-scroll-anim-texts="${encodeURIComponent(
        texts.map((t) => `${t.title}::${t.sub}`).join("||"),
      )}"`
    : "";

  return `<section id="craft-immersion-glass-pending" data-scroll-anim-pending="1" data-craft-scrollanim="1" data-layout="immersion"${_pa}${_sa}${_ta} style="position:relative;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;background:linear-gradient(145deg,#0a0c12 0%,#141820 45%,#0d1520 100%);">
<style>
@keyframes ${tid}-spin{to{transform:rotate(360deg)}}
@keyframes ${tid}-pulse{0%,100%{opacity:.4}50%{opacity:1}}
@keyframes ${tid}-bar{0%{width:0%}100%{width:78%}}
@keyframes ${tid}-fade{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
</style>
<div style="text-align:center;color:#F4F0EA;z-index:2;padding:40px;max-width:560px;animation:${tid}-fade .65s ease both;">
  <div style="display:inline-flex;align-items:center;gap:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:18px 26px;margin-bottom:1.3rem;backdrop-filter:blur(16px);">
    <div style="width:34px;height:34px;border:2.5px solid rgba(255,255,255,.12);border-top-color:#7EB8FF;border-radius:50%;flex-shrink:0;animation:${tid}-spin .9s linear infinite;"></div>
    <div style="text-align:left;">
      <div style="font-size:.95rem;font-weight:600;margin-bottom:2px;">Рендерим кинематографичный фон…</div>
      <div style="font-size:.8rem;color:rgba(244,240,234,.5);">Kling · 12 сек · обычно 10–25 минут</div>
    </div>
  </div>
  <div style="width:220px;height:3px;background:rgba(255,255,255,.08);border-radius:99px;margin:0 auto 1.2rem;overflow:hidden;">
    <div style="height:100%;background:linear-gradient(90deg,#7EB8FF,#A78BFA);border-radius:99px;animation:${tid}-bar 16s cubic-bezier(.4,0,.2,1) forwards;"></div>
  </div>
  <div style="font-size:.78rem;color:rgba(244,240,234,.32);line-height:1.6;animation:${tid}-pulse 2.4s ease-in-out infinite;">Стекло-секции уже на странице — прокрутите вниз ↓</div>
</div>
</section>`;
}

export function buildImmersionGlassHtml(
  videoUrl: string,
  texts: Array<{ title: string; sub: string }>,
  navCtl: string,
  esc: (s: string) => string,
): string {
  const cid = "ig" + Math.random().toString(36).slice(2, 8);
  const vid = esc(videoUrl || "");
  const hero = texts[0] || { title: "", sub: "" };
  const heroTitle = hero.title ? esc(hero.title) : "";
  const heroSub = hero.sub ? esc(hero.sub) : "";

  return `
<div id="craft-immersion-bg" class="${cid}-bg" data-layout="immersion" data-video="${vid}" aria-hidden="true">
  <video class="${cid}-video" src="${vid}" muted playsinline preload="auto"></video>
  <div class="${cid}-veil"></div>
</div>
<section id="top" class="${cid}-hero" data-craft-scrollanim="1" data-layout="immersion" data-craft-immersion-hero="1">
  <div class="${cid}-hero__glass">
    ${heroTitle ? `<h1 class="${cid}-hero__title">${heroTitle}</h1>` : ""}
    ${heroSub ? `<p class="${cid}-hero__sub">${heroSub}</p>` : ""}
    <div class="${cid}-hint"><span>листайте</span><i></i></div>
  </div>
</section>
<style>
html.craft-immersion-site,body.craft-immersion-site{background:#05070c!important;min-height:100%;}
.${cid}-bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;background:#05070c;}
.${cid}-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scale(1.04);}
.${cid}-veil{position:absolute;inset:0;background:
  radial-gradient(ellipse 75% 60% at 50% 40%,rgba(0,0,0,.12) 0%,rgba(0,0,0,.45) 72%,rgba(0,0,0,.72) 100%),
  linear-gradient(180deg,rgba(0,0,0,.28) 0%,rgba(0,0,0,.08) 40%,rgba(0,0,0,.55) 100%);
  pointer-events:none;}
.${cid}-hero{position:relative;z-index:1;min-height:100vh;display:grid;place-items:center;padding:clamp(88px,12vh,140px) clamp(18px,5vw,64px) clamp(48px,8vh,96px);box-sizing:border-box;}
.${cid}-hero__glass{
  width:min(920px,100%);
  padding:clamp(28px,4.5vw,52px) clamp(24px,4vw,48px);
  border-radius:28px;
  background:linear-gradient(155deg,rgba(255,255,255,.14) 0%,rgba(255,255,255,.05) 50%,rgba(255,255,255,.03) 100%);
  border:1px solid rgba(255,255,255,.22);
  box-shadow:0 28px 80px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.28);
  backdrop-filter:blur(22px) saturate(1.35);-webkit-backdrop-filter:blur(22px) saturate(1.35);
  text-align:center;color:#fff;
}
.${cid}-hero__title{margin:0;font-size:clamp(2.1rem,5.2vw,4.2rem);font-weight:800;letter-spacing:-.03em;line-height:1.05;text-shadow:0 8px 40px rgba(0,0,0,.45);}
.${cid}-hero__sub{margin:1rem auto 0;max-width:42ch;font-size:clamp(1rem,1.6vw,1.2rem);line-height:1.55;color:rgba(255,255,255,.86);text-shadow:0 2px 16px rgba(0,0,0,.35);}
.${cid}-hint{margin-top:1.6rem;display:inline-flex;flex-direction:column;align-items:center;gap:8px;font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.55);}
.${cid}-hint i{width:20px;height:32px;border:1.5px solid rgba(255,255,255,.35);border-radius:12px;position:relative;}
.${cid}-hint i::after{content:"";position:absolute;left:50%;top:6px;width:3px;height:7px;border-radius:2px;background:#fff;transform:translateX(-50%);animation:${cid}-wheel 1.6s ease-in-out infinite;}
@keyframes ${cid}-wheel{0%{opacity:0;top:6px}35%{opacity:1}100%{opacity:0;top:16px}}

/* Lift all page content above the fixed video */
body.craft-immersion-site > *:not(#craft-immersion-bg):not(#site-preloader){position:relative;z-index:1;}
body.craft-immersion-site header{z-index:1000!important;}

/* Glass defaults for agent sections/cards sitting over the video */
body.craft-immersion-site section,
body.craft-immersion-site footer{
  background:transparent!important;
  background-color:transparent!important;
}
body.craft-immersion-site section > .container,
body.craft-immersion-site section > .wrap,
body.craft-immersion-site section > .inner,
body.craft-immersion-site [class*="card"],
body.craft-immersion-site [class*="Card"],
body.craft-immersion-site article,
body.craft-immersion-site .feature,
body.craft-immersion-site .pricing,
body.craft-immersion-site .review,
body.craft-immersion-site .testimonial,
body.craft-immersion-site form,
body.craft-immersion-site .glass{
  background:linear-gradient(155deg,rgba(255,255,255,.13) 0%,rgba(255,255,255,.05) 55%,rgba(255,255,255,.03) 100%)!important;
  border:1px solid rgba(255,255,255,.18)!important;
  box-shadow:0 20px 60px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.2)!important;
  backdrop-filter:blur(18px) saturate(1.3)!important;-webkit-backdrop-filter:blur(18px) saturate(1.3)!important;
  border-radius:22px;
  color:#fff;
}
body.craft-immersion-site h1,body.craft-immersion-site h2,body.craft-immersion-site h3,
body.craft-immersion-site p,body.craft-immersion-site li,body.craft-immersion-site a,body.craft-immersion-site span,body.craft-immersion-site label{
  text-shadow:0 1px 14px rgba(0,0,0,.25);
}
@media (prefers-reduced-motion:reduce){.${cid}-hint i::after{animation:none;}}
</style>
<script>
(function(){
  if(window.__craftImmersionGlass)return;window.__craftImmersionGlass=true;
  document.documentElement.classList.add('craft-immersion-site');
  document.body.classList.add('craft-immersion-site');
  var root=document.getElementById('craft-immersion-bg');
  if(!root)return;
  var video=root.querySelector('video');
  if(!video)return;
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var seeking=false, target=0, ready=false, hint=document.querySelector('.${cid}-hint');

  function progress(){
    var max=Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    return Math.max(0, Math.min(1, window.scrollY / max));
  }
  function apply(){
    if(!ready || !video.duration) return;
    target = progress() * Math.max(0, video.duration - 0.05);
    if(reduce){ try{ video.currentTime=target; }catch(e){} return; }
    if(!seeking && Math.abs((video.currentTime||0)-target)>0.04){
      seeking=true;
      try{
        var p=video.currentTime=target;
        var done=function(){seeking=false;video.removeEventListener('seeked',done);};
        video.addEventListener('seeked',done);
      }catch(e){seeking=false;}
    }
    if(hint) hint.style.opacity = progress() < 0.06 ? '1' : '0';
  }
  function onScroll(){ requestAnimationFrame(apply); }
  video.addEventListener('loadedmetadata', function(){ ready=true; apply(); try{window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){} });
  if(video.readyState>=1){ ready=true; }
  window.addEventListener('scroll', onScroll, {passive:true});
  window.addEventListener('resize', onScroll);
  // iOS prime
  function prime(){ try{ var p=video.play(); if(p&&p.then)p.then(function(){try{video.pause();}catch(e){}}).catch(function(){});}catch(e){} }
  window.addEventListener('pointerdown', prime, {once:true, passive:true});
  window.addEventListener('touchstart', prime, {once:true, passive:true});
  apply();
  try{
    var pending=document.getElementById('craft-immersion-glass-pending')||document.getElementById('craft-scroll-world-pending');
    if(pending) pending.style.display='none';
  }catch(e){}
})();
</script>
${navCtl}
`;
}
