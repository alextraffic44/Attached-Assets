/**
 * «Погружение» — one Kling MP4 (15s) as fixed full-site background, scrubbed by
 * a dedicated 5-beat scroll track (≈3s of video per beat). Glass cards overlay
 * at most ~35% of the viewport; hero/beat copy crossfades with Motion.
 */

const DEFAULT_BEATS: Array<{ title: string; sub: string }> = [
  { title: "Порог", sub: "Начните путешествие в мир бренда" },
  { title: "Вход", sub: "Камера ведёт вас внутрь" },
  { title: "Глубина", sub: "Пространство раскрывается дальше" },
  { title: "Суть", sub: "Главный смысл на всём экране" },
  { title: "Горизонт", sub: "Ваш следующий шаг" },
];

function padBeats(texts: Array<{ title: string; sub: string }>): Array<{ title: string; sub: string }> {
  const out: Array<{ title: string; sub: string }> = [];
  for (let i = 0; i < 5; i++) {
    const t = texts[i];
    if (t && (t.title || t.sub)) out.push({ title: t.title || DEFAULT_BEATS[i].title, sub: t.sub || DEFAULT_BEATS[i].sub });
    else out.push({ ...DEFAULT_BEATS[i] });
  }
  return out;
}

export function buildImmersionGlassPendingHtml(
  videoPrompt: string,
  texts: Array<{ title: string; sub: string }>,
): string {
  const tid = "igp" + Math.random().toString(36).slice(2, 8);
  const beats = padBeats(texts);
  const _pa = videoPrompt
    ? ` data-scroll-anim-prompt="${encodeURIComponent(videoPrompt)}"`
    : "";
  const _sa = ` data-scroll-anim-style="${encodeURIComponent("immersion")}"`;
  const _ta = ` data-scroll-anim-texts="${encodeURIComponent(
    beats.map((t) => `${t.title}::${t.sub}`).join("||"),
  )}"`;

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
      <div style="font-size:.8rem;color:rgba(244,240,234,.5);">Kling · 15 сек · 5 сцен × 3 сек · обычно 10–25 минут</div>
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
  const beats = padBeats(texts);
  const beatsJson = JSON.stringify(
    beats.map((b) => ({ title: b.title, sub: b.sub })),
  ).replace(/</g, "\\u003c");

  const cardsHtml = beats
    .map((b, i) => {
      const side = i % 2 === 0 ? "left" : "right";
      return `<article class="${cid}-card" data-beat="${i}" data-side="${side}" aria-hidden="${i === 0 ? "false" : "true"}">
  <span class="${cid}-card__idx">0${i + 1} · сцена</span>
  <h3 class="${cid}-card__title">${esc(b.title)}</h3>
  <p class="${cid}-card__sub">${esc(b.sub)}</p>
</article>`;
    })
    .join("\n");

  // IMPORTANT: wrap bg + track + engine in craft-scrollanim-full comments so BG merge
  // (extractCraftScrollAnimBlocks) keeps the fixed video layer.
  return `
<!--craft-scrollanim-full-->
<div id="craft-immersion-bg" class="${cid}-bg" data-layout="immersion" data-video="${vid}" data-vid-dur="15" aria-hidden="true">
  <video class="${cid}-video" src="${vid}" muted playsinline preload="auto"></video>
  <div class="${cid}-veil"></div>
</div>
<div class="${cid}-progress" aria-hidden="true"><i class="${cid}-progress__bar"></i></div>
<section id="top" class="${cid}-track" data-craft-scrollanim="1" data-layout="immersion" data-craft-immersion-hero="1" data-beats='${beatsJson}'>
  <div class="${cid}-sticky">
    <div class="${cid}-beat" data-craft-immersion-beat="1">
      <h1 class="${cid}-beat__title">${esc(beats[0].title)}</h1>
      <p class="${cid}-beat__sub">${esc(beats[0].sub)}</p>
    </div>
    <div class="${cid}-cards">
${cardsHtml}
    </div>
    <div class="${cid}-hint"><span>листайте · 5 сцен</span><i></i></div>
  </div>
</section>
<style>
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Manrope:wght@400;500;600&display=swap');
html.craft-immersion-site,body.craft-immersion-site{background:#05070c!important;min-height:100%;}
/* Force sticky top nav — must not scroll away with the page */
body.craft-immersion-site header,
html.craft-immersion-site header,
body.craft-immersion-site > header,
body.craft-immersion-site header.site-header,
body.craft-immersion-site .site-header,
body.craft-immersion-site [data-site-header]{
  position:fixed!important;
  top:0!important;left:0!important;right:0!important;
  width:100%!important;max-width:100%!important;
  z-index:1000!important;
  transform:none!important;
}
.${cid}-bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;background:#05070c;}
.${cid}-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scale(1.03);will-change:transform;}
.${cid}-veil{position:absolute;inset:0;background:
  radial-gradient(ellipse 78% 62% at 50% 42%,rgba(0,0,0,.1) 0%,rgba(0,0,0,.42) 70%,rgba(0,0,0,.7) 100%),
  linear-gradient(180deg,rgba(0,0,0,.32) 0%,rgba(0,0,0,.06) 42%,rgba(0,0,0,.58) 100%);
  pointer-events:none;}
.${cid}-progress{position:fixed;top:0;left:0;right:0;height:2px;z-index:900;pointer-events:none;background:rgba(255,255,255,.06);}
.${cid}-progress__bar{display:block;height:100%;width:0%;background:linear-gradient(90deg,#9ecbff,#fff);box-shadow:0 0 12px rgba(158,203,255,.45);}
.${cid}-track{position:relative;z-index:1;height:500vh;margin:0;padding:0;}
.${cid}-sticky{position:sticky;top:0;height:100vh;width:100%;overflow:hidden;box-sizing:border-box;
  display:grid;grid-template-rows:1fr auto;align-items:stretch;
  padding:clamp(72px,10vh,110px) clamp(16px,4vw,48px) clamp(28px,5vh,56px);}
.${cid}-beat{align-self:end;justify-self:start;max-width:min(560px,92vw);color:#fff;z-index:3;
  transition:opacity .35s ease,transform .45s cubic-bezier(.22,1,.36,1);}
.${cid}-beat.is-swap{opacity:0;transform:translateY(14px);}
.${cid}-beat__title{margin:0;font-family:'Syne',system-ui,sans-serif;font-size:clamp(1.85rem,5vw,3.6rem);font-weight:800;letter-spacing:-.035em;line-height:1.02;text-shadow:0 10px 48px rgba(0,0,0,.55);}
.${cid}-beat__sub{margin:.7rem 0 0;max-width:38ch;font-family:'Manrope',system-ui,sans-serif;font-size:clamp(.95rem,1.55vw,1.15rem);line-height:1.5;color:rgba(255,255,255,.88);text-shadow:0 2px 18px rgba(0,0,0,.45);}
.${cid}-cards{position:absolute;inset:clamp(72px,10vh,110px) clamp(16px,4vw,48px) clamp(100px,14vh,140px);pointer-events:none;z-index:2;}
.${cid}-card{
  position:absolute;top:50%;transform:translateY(-50%) translateY(18px);
  width:min(380px,42vw);max-width:42%;
  max-height:35vh;overflow:hidden;
  padding:clamp(14px,2vw,22px) clamp(16px,2.2vw,26px);
  border-radius:22px;
  background:linear-gradient(155deg,rgba(255,255,255,.14) 0%,rgba(255,255,255,.05) 55%,rgba(255,255,255,.03) 100%);
  border:1px solid rgba(255,255,255,.18);
  box-shadow:0 18px 50px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.22);
  backdrop-filter:blur(18px) saturate(1.3);-webkit-backdrop-filter:blur(18px) saturate(1.3);
  color:#fff;opacity:0;pointer-events:none;
  transition:opacity .45s ease,transform .55s cubic-bezier(.22,1,.36,1);
}
.${cid}-card[data-side="left"]{left:0;right:auto;}
.${cid}-card[data-side="right"]{right:0;left:auto;}
.${cid}-card.is-on{opacity:1;transform:translateY(-50%) translateY(0);pointer-events:auto;}
.${cid}-card__idx{display:block;font-family:'Manrope',system-ui,sans-serif;font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.55);margin-bottom:.45rem;}
.${cid}-card__title{margin:0;font-family:'Syne',system-ui,sans-serif;font-size:clamp(1.05rem,2vw,1.45rem);font-weight:700;letter-spacing:-.02em;line-height:1.15;}
.${cid}-card__sub{margin:.45rem 0 0;font-family:'Manrope',system-ui,sans-serif;font-size:clamp(.82rem,1.2vw,.95rem);line-height:1.45;color:rgba(255,255,255,.82);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.${cid}-hint{justify-self:center;align-self:end;z-index:3;display:inline-flex;flex-direction:column;align-items:center;gap:8px;font-family:'Manrope',system-ui,sans-serif;font-size:.66rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.55);transition:opacity .35s ease;}
.${cid}-hint i{width:20px;height:32px;border:1.5px solid rgba(255,255,255,.35);border-radius:12px;position:relative;}
.${cid}-hint i::after{content:"";position:absolute;left:50%;top:6px;width:3px;height:7px;border-radius:2px;background:#fff;transform:translateX(-50%);animation:${cid}-wheel 1.6s ease-in-out infinite;}
@keyframes ${cid}-wheel{0%{opacity:0;top:6px}35%{opacity:1}100%{opacity:0;top:16px}}

body.craft-immersion-site > *:not(#craft-immersion-bg):not(.${cid}-progress):not(#site-preloader){position:relative;z-index:1;}
body.craft-immersion-site header{z-index:1000!important;}

/* Agent sections over the fixed video — glass, never opaque walls */
body.craft-immersion-site section:not(.${cid}-track),
body.craft-immersion-site footer{
  background:transparent!important;
  background-color:transparent!important;
}
body.craft-immersion-site section:not(.${cid}-track) > .container,
body.craft-immersion-site section:not(.${cid}-track) > .wrap,
body.craft-immersion-site section:not(.${cid}-track) > .inner,
body.craft-immersion-site [class*="card"],
body.craft-immersion-site [class*="Card"],
body.craft-immersion-site article:not(.${cid}-card),
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
  max-height:none;
}
/* Keep post-track cards from covering the video too aggressively */
body.craft-immersion-site section:not(.${cid}-track) [class*="card"],
body.craft-immersion-site section:not(.${cid}-track) article:not(.${cid}-card){
  max-width:min(100%,520px);
}
body.craft-immersion-site h1,body.craft-immersion-site h2,body.craft-immersion-site h3,
body.craft-immersion-site p,body.craft-immersion-site li,body.craft-immersion-site a,body.craft-immersion-site span,body.craft-immersion-site label{
  text-shadow:0 1px 14px rgba(0,0,0,.25);
}
@media (max-width:720px){
  .${cid}-sticky{padding-top:clamp(78px,12vh,120px);}
  .${cid}-beat{align-self:start;justify-self:stretch;max-width:94vw;text-align:left;}
  .${cid}-cards{inset:auto clamp(12px,4vw,24px) clamp(92px,15vh,130px);height:34vh;top:auto;}
  .${cid}-card{width:min(92vw,420px);max-width:92%;max-height:32vh;left:50%!important;right:auto!important;top:auto;bottom:0;transform:translate(-50%,0) translateY(14px);}
  .${cid}-card.is-on{transform:translate(-50%,0) translateY(0);}
}
@media (prefers-reduced-motion:reduce){
  .${cid}-hint i::after{animation:none;}
  .${cid}-card,.${cid}-beat{transition:none;}
}
</style>
<script type="module">
(async function(){
  try{
    const { animate, inView } = await import('https://cdn.jsdelivr.net/npm/motion@11.18.2/+esm');
    const postCards = document.querySelectorAll('body.craft-immersion-site section:not(.${cid}-track) [class*="card"], body.craft-immersion-site section:not(.${cid}-track) article');
    postCards.forEach(function(el){
      if(el.classList && el.classList.contains('${cid}-card')) return;
      el.style.opacity = '0';
      inView(el, function(){
        animate(el, { opacity: [0, 1], y: [28, 0] }, { duration: 0.6, easing: [0.22, 1, 0.36, 1] });
      }, { amount: 0.25, once: true });
    });
    const beat = document.querySelector('.${cid}-beat');
    if(beat){
      animate(beat, { opacity: [0, 1], y: [20, 0] }, { duration: 0.7, easing: [0.22, 1, 0.36, 1] });
    }
  }catch(e){}
})();
</script>
<script>
(function(){
  if(window.__craftImmersionGlass)return;window.__craftImmersionGlass=true;
  document.documentElement.classList.add('craft-immersion-site');
  document.body.classList.add('craft-immersion-site');

  var root=document.getElementById('craft-immersion-bg');
  var track=document.querySelector('.${cid}-track');
  if(!root||!track)return;
  var video=root.querySelector('video');
  if(!video)return;

  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var seeking=false, ready=false, lastBeat=-1;
  var bar=document.querySelector('.${cid}-progress__bar');
  var hint=document.querySelector('.${cid}-hint');
  var beatEl=document.querySelector('.${cid}-beat');
  var beatTitle=document.querySelector('.${cid}-beat__title');
  var beatSub=document.querySelector('.${cid}-beat__sub');
  var cards=[].slice.call(document.querySelectorAll('.${cid}-card'));
  var beats=[];
  try{ beats=JSON.parse(track.getAttribute('data-beats')||'[]'); }catch(e){ beats=[]; }
  if(!beats.length){
    beats=[{title:'Порог',sub:''},{title:'Вход',sub:''},{title:'Глубина',sub:''},{title:'Суть',sub:''},{title:'Горизонт',sub:''}];
  }
  while(beats.length<5) beats.push(beats[beats.length-1]||{title:'',sub:''});

  var TARGET_DUR=15;

  function trackProgress(){
    var total=Math.max(1, track.offsetHeight - window.innerHeight);
    var top=track.getBoundingClientRect().top;
    var scrolled=-top;
    return Math.max(0, Math.min(1, scrolled / total));
  }

  function setBeat(idx){
    if(idx===lastBeat) return;
    lastBeat=idx;
    var b=beats[idx]||beats[0];
    cards.forEach(function(c,i){
      var on=i===idx;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    if(!beatTitle||!beatSub||!beatEl) return;
    if(reduce){
      beatTitle.textContent=b.title||'';
      beatSub.textContent=b.sub||'';
      return;
    }
    beatEl.classList.add('is-swap');
    setTimeout(function(){
      beatTitle.textContent=b.title||'';
      beatSub.textContent=b.sub||'';
      beatEl.classList.remove('is-swap');
    }, 180);
  }

  function apply(){
    var p=trackProgress();
    if(bar) bar.style.width=(p*100).toFixed(2)+'%';
    if(hint) hint.style.opacity = p < 0.045 ? '1' : '0';

    var beatIdx=Math.min(4, Math.floor(p * 5 + 1e-6));
    if(p>=0.999) beatIdx=4;
    setBeat(beatIdx);

    if(!ready) return;
    var dur=video.duration && isFinite(video.duration) ? video.duration : TARGET_DUR;
    // Prefer full clip; clamp near end to avoid freeze on last frame
    var target=p * Math.max(0.05, dur - 0.08);
    if(reduce){ try{ video.currentTime=target; }catch(e){} return; }
    if(!seeking && Math.abs((video.currentTime||0)-target)>0.035){
      seeking=true;
      try{
        video.currentTime=target;
        var done=function(){seeking=false;video.removeEventListener('seeked',done);};
        video.addEventListener('seeked',done);
        setTimeout(function(){seeking=false;},180);
      }catch(e){seeking=false;}
    }
  }

  function onScroll(){ requestAnimationFrame(apply); }

  video.addEventListener('loadedmetadata', function(){
    ready=true; apply();
    try{ window.dispatchEvent(new Event('craft:frames-ready')); }catch(e){}
  });
  if(video.readyState>=1){ ready=true; }

  window.addEventListener('scroll', onScroll, {passive:true});
  window.addEventListener('resize', onScroll);

  function prime(){
    try{
      var p=video.play();
      if(p&&p.then) p.then(function(){ try{video.pause();}catch(e){} }).catch(function(){});
    }catch(e){}
  }
  window.addEventListener('pointerdown', prime, {once:true, passive:true});
  window.addEventListener('touchstart', prime, {once:true, passive:true});

  setBeat(0);
  apply();

  try{
    var pending=document.getElementById('craft-immersion-glass-pending')||document.getElementById('craft-scroll-world-pending');
    if(pending) pending.style.display='none';
  }catch(e){}
})();
</script>
${navCtl}
<!--/craft-scrollanim-full-->
`;
}
