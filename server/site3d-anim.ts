/**
 * «3D сайт» scroll layout — cinematic scrubbed video background + stacked 3D cards.
 *
 * Prefer a single MP4 scrub (fast path): after Kling finishes we upload one video
 * and seek by scroll — no ffmpeg / 90-frame upload loop.
 * Frame arrays remain supported as a fallback for older regenerations.
 */
export function buildSite3dAnimHtml(
  frames: string[],
  texts: Array<{ title: string; sub: string }>,
  navCtl: string,
  esc: (s: string) => string,
  videoUrl?: string,
): string {
  const cid = "s3d" + Math.random().toString(36).slice(2, 8);
  const framesJson = JSON.stringify(frames || []).replace(/'/g, "&#39;");
  const vidEsc = videoUrl ? esc(videoUrl) : "";
  const cards = (texts.length ? texts : [{ title: "", sub: "" }]).slice(0, 6);
  const n = Math.max(1, cards.length);
  const scrollVh = Math.max(280, Math.min(720, Math.round(n * 115 + 80)));

  const cardsHtml = cards
    .map((t, i) => {
      const num = String(i + 1).padStart(2, "0");
      return `<article class="${cid}-card" data-i="${i}">
  <div class="${cid}-card__inner">
    <span class="${cid}-card__num">${num} / ${String(n).padStart(2, "0")}</span>
    ${t.title ? `<h2 class="${cid}-card__title">${esc(t.title)}</h2>` : ""}
    ${t.sub ? `<p class="${cid}-card__body">${esc(t.sub)}</p>` : ""}
  </div>
</article>`;
    })
    .join("\n");

  return `
<section class="${cid}-scroll" data-frames='${framesJson}'${vidEsc ? ` data-video="${vidEsc}"` : ""} data-layout="site3d" data-craft-scrollanim="1" data-cards="${n}">
  <div class="${cid}-sticky">
    ${vidEsc
      ? `<video class="${cid}-video" src="${vidEsc}" muted playsinline preload="auto" aria-hidden="true"></video>`
      : `<canvas class="${cid}-canvas" aria-hidden="true"></canvas>`}
    <div class="${cid}-veil"></div>
    <div class="${cid}-glow"></div>
    <div class="${cid}-stage" aria-live="polite">
${cardsHtml}
    </div>
    <div class="${cid}-hint"><span>листайте</span><i></i></div>
  </div>
</section>
<style>
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Manrope:wght@400;500;600&display=swap');
.${cid}-scroll{position:relative;height:${scrollVh}vh;margin:0;padding:0;background:#050505;}
.${cid}-sticky{position:sticky;top:0;height:100vh;width:100%;overflow:hidden;background:#050505;perspective:1400px;perspective-origin:50% 42%;}
.${cid}-canvas,.${cid}-video{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0;transform:scale(1.06);object-fit:cover;}
.${cid}-veil{position:absolute;inset:0;z-index:1;pointer-events:none;background:
  radial-gradient(ellipse 70% 55% at 50% 40%,rgba(0,0,0,0.15) 0%,rgba(0,0,0,0.55) 70%,rgba(0,0,0,0.82) 100%),
  linear-gradient(180deg,rgba(0,0,0,0.35) 0%,rgba(0,0,0,0.1) 35%,rgba(0,0,0,0.55) 100%);}
.${cid}-glow{position:absolute;inset:0;z-index:1;pointer-events:none;opacity:.55;background:
  radial-gradient(circle at 20% 20%,rgba(120,160,255,0.18),transparent 42%),
  radial-gradient(circle at 80% 70%,rgba(255,140,90,0.12),transparent 40%);}
.${cid}-stage{position:absolute;inset:0;z-index:2;display:grid;place-items:center;transform-style:preserve-3d;pointer-events:none;}
.${cid}-card{position:absolute;width:min(86vw,560px);transform-style:preserve-3d;will-change:transform,opacity;opacity:0;pointer-events:none;}
.${cid}-card__inner{padding:clamp(28px,4.5vw,48px) clamp(26px,4vw,44px);border-radius:28px;
  background:linear-gradient(155deg,rgba(255,255,255,0.16) 0%,rgba(255,255,255,0.06) 45%,rgba(255,255,255,0.03) 100%);
  border:1px solid rgba(255,255,255,0.22);
  box-shadow:0 30px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.25);
  backdrop-filter:blur(18px) saturate(1.25);-webkit-backdrop-filter:blur(18px) saturate(1.25);
  color:#fff;transform:translateZ(0);}
.${cid}-card__num{display:block;font-family:ui-monospace,Menlo,monospace;font-size:.72rem;letter-spacing:.18em;opacity:.62;margin-bottom:1.1rem;}
.${cid}-card__title{margin:0;font-family:'Syne',system-ui,sans-serif;font-weight:800;font-size:clamp(1.85rem,4.6vw,3.35rem);line-height:1.02;letter-spacing:-0.03em;text-shadow:0 8px 40px rgba(0,0,0,0.45);}
.${cid}-card__body{margin:1rem 0 0;font-family:'Manrope',system-ui,sans-serif;font-size:clamp(.98rem,1.5vw,1.18rem);line-height:1.55;color:rgba(255,255,255,0.84);max-width:36ch;}
.${cid}-hint{position:absolute;left:50%;bottom:max(22px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:3;display:flex;flex-direction:column;align-items:center;gap:8px;font-family:'Manrope',system-ui,sans-serif;font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.55);transition:opacity .35s;pointer-events:none;}
.${cid}-hint i{width:20px;height:32px;border:1.5px solid rgba(255,255,255,.35);border-radius:12px;position:relative;}
.${cid}-hint i::after{content:"";position:absolute;left:50%;top:6px;width:3px;height:7px;border-radius:2px;background:#fff;transform:translateX(-50%);animation:${cid}-wheel 1.6s ease-in-out infinite;}
@keyframes ${cid}-wheel{0%{opacity:0;top:6px}35%{opacity:1}100%{opacity:0;top:16px}}
@media (max-width:700px){
  .${cid}-card{width:min(92vw,420px);}
  .${cid}-card__inner{border-radius:22px;padding:24px 22px;}
  .${cid}-sticky{perspective:900px;}
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
    var hint=root.querySelector('.${cid}-hint');
    var cards=[].slice.call(root.querySelectorAll('.${cid}-card'));
    var N=cards.length||1;
    var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var video=root.querySelector('.${cid}-video');
    var videoUrl=root.getAttribute('data-video')||'';

    function syncCards(p){
      for(var i=0;i<N;i++){
        var c=cards[i]; if(!c)continue;
        var start=i/N, end=(i+1)/N, mid=(start+end)/2;
        var local=(p-start)/(end-start);
        var opacity=0, ty=80, tz=-220, rx=14, sc=.88;
        if(local>=0 && local<=1){
          if(local<.18){var t=local/.18;opacity=t;ty=80*(1-t);tz=-220+220*t;rx=14*(1-t);sc=.88+.12*t;}
          else if(local>.82){var t2=(local-.82)/.18;opacity=1-t2;ty=-40*t2;tz=-80*t2;rx=-8*t2;sc=1-.06*t2;}
          else{opacity=1;ty=0;tz=0;rx=0;sc=1;}
        } else if(p>mid){opacity=0;ty=-50;tz=-120;}
        c.style.opacity=String(opacity);
        c.style.transform='translate3d(0,'+ty.toFixed(1)+'px,'+tz.toFixed(1)+'px) rotateX('+rx.toFixed(2)+'deg) scale('+sc.toFixed(3)+')';
        c.style.pointerEvents='none';
      }
      if(hint)hint.style.opacity=p<.08?'1':'0';
    }

    function progress(){
      var r=root.getBoundingClientRect();
      var total=Math.max(1,root.offsetHeight-window.innerHeight);
      return Math.max(0,Math.min(1,(-r.top)/total));
    }

    // ── Fast path: scrub a single MP4 by scroll ──
    if(video && videoUrl){
      video.muted=true;video.playsInline=true;video.preload='auto';
      var ready=false, seeking=false, want=0;
      function applySeek(){
        if(!ready||seeking||!isFinite(video.duration)||video.duration<=0)return;
        var t=want*Math.max(0.05,video.duration-0.08);
        if(Math.abs(video.currentTime-t)<0.04)return;
        seeking=true;
        try{video.currentTime=t;}catch(e){seeking=false;}
      }
      video.addEventListener('seeked',function(){seeking=false;});
      video.addEventListener('loadedmetadata',function(){
        ready=true;applySeek();
        try{window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){}
      });
      if(video.readyState>=1){ready=true;applySeek();try{window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){}}
      function onScroll(){
        var p=progress();
        want=reduce?0:p;
        applySeek();
        syncCards(p);
      }
      window.addEventListener('scroll',onScroll,{passive:true});
      window.addEventListener('resize',onScroll);
      onScroll();
      return;
    }

    // ── Fallback: JPEG frame scrub on canvas ──
    var frames;try{frames=JSON.parse(root.getAttribute('data-frames')||'[]');}catch(e){frames=[];}
    if(!frames.length)return;
    var canvas=root.querySelector('.${cid}-canvas');
    if(!canvas)return;
    var ctx=canvas.getContext('2d');
    var imgs=new Array(frames.length),started=new Array(frames.length),cur=-1;
    var dpr=Math.min(window.devicePixelRatio||1,2);

    function cover(img){
      var cw=sticky.clientWidth,ch=sticky.clientHeight,iw=img.naturalWidth,ih=img.naturalHeight;
      if(!iw||!ih)return;
      var s=Math.max(cw/iw,ch/ih),dw=iw*s,dh=ih*s,dx=(cw-dw)/2,dy=(ch-dh)/2;
      ctx.clearRect(0,0,cw,ch);ctx.drawImage(img,dx,dy,dw,dh);
    }
    function resize(){
      var w=sticky.clientWidth,h=sticky.clientHeight;
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);
      if(cur>=0&&imgs[cur])cover(imgs[cur]);
    }
    function ensure(i){
      if(i<0||i>=frames.length||started[i])return;
      started[i]=1;
      var im=new Image();im.decoding='async';imgs[i]=im;
      im.onload=function(){if(i===cur)cover(im);};
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
      var use=nearest(i);if(use!==-1)cover(imgs[use]);ensure(i);
      for(var k=1;k<=3;k++){ensure(i+k);ensure(i-k);}
    }
    function onScrollFrames(){
      var p=progress();
      var idx=Math.round(p*(frames.length-1));
      if(idx!==cur)paint(idx);
      syncCards(p);
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
  });
})();
</script>
${navCtl}
`;
}
