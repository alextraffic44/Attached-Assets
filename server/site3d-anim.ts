/**
 * «3D сайт» scroll layout — cinematic scrubbed video background + stacked 3D cards
 * (smooth perspective cards like popular 3D scroll Shorts demos).
 */
export function buildSite3dAnimHtml(
  frames: string[],
  texts: Array<{ title: string; sub: string }>,
  navCtl: string,
  esc: (s: string) => string,
): string {
  const cid = "s3d" + Math.random().toString(36).slice(2, 8);
  const framesJson = JSON.stringify(frames).replace(/'/g, "&#39;");
  const cards = (texts.length ? texts : [{ title: "", sub: "" }]).slice(0, 6);
  const n = Math.max(1, cards.length);
  // ~1.15 viewport of scroll per card so the stack feels cinematic
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
<section class="${cid}-scroll" data-frames='${framesJson}' data-layout="site3d" data-craft-scrollanim="1" data-cards="${n}">
  <div class="${cid}-sticky">
    <canvas class="${cid}-canvas" aria-hidden="true"></canvas>
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
.${cid}-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0;transform:scale(1.06);}
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
    var frames;try{frames=JSON.parse(root.getAttribute('data-frames')||'[]');}catch(e){frames=[];}
    if(!frames.length)return;
    var sticky=root.querySelector('.${cid}-sticky');
    var canvas=root.querySelector('.${cid}-canvas');
    var hint=root.querySelector('.${cid}-hint');
    var ctx=canvas.getContext('2d');
    var cards=[].slice.call(root.querySelectorAll('.${cid}-card'));
    var N=cards.length||1;
    var imgs=new Array(frames.length),started=new Array(frames.length),cur=-1;
    var dpr=Math.min(window.devicePixelRatio||1,2);
    var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function cover(img){
      var cw=sticky.clientWidth,ch=sticky.clientHeight,iw=img.naturalWidth,ih=img.naturalHeight;
      if(!iw||!ih)return;
      var s=Math.max(cw/iw,ch/ih),dw=iw*s,dh=ih*s,dx=(cw-dw)/2,dy=(ch-dh)/2;
      ctx.clearRect(0,0,cw,ch);ctx.drawImage(img,dx,dy,dw,dh);
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
    }
    function resize(){
      var w=sticky.clientWidth,h=sticky.clientHeight;
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
      canvas.style.width=w+'px';canvas.style.height=h+'px';
      ctx.setTransform(dpr,0,0,dpr,0,0);paint(cur<0?0:cur);
    }
    function signalReady(){
      try{window.__craftAnimReady=true;window.dispatchEvent(new Event('craft:anim-ready'));window.dispatchEvent(new Event('craft:frames-ready'));}catch(e){}
    }
    var loadedCount=0,total=frames.length,activeCount=0,MAXP=6,nextSeq=0;
    function startLoad(idx){
      if(started[idx])return;started[idx]=true;activeCount++;
      var im=new Image(),settled=false;
      function _done(){if(settled)return;settled=true;activeCount--;loadedCount++;if(loadedCount>=total)signalReady();if(idx===cur||nearest(cur)===idx)paint(cur<0?0:cur);pump();}
      im.decoding='async';imgs[idx]=im;im.onload=_done;im.onerror=_done;setTimeout(_done,12000);im.src=frames[idx];
    }
    function pump(){while(activeCount<MAXP&&nextSeq<total){if(started[nextSeq]){nextSeq++;continue;}startLoad(nextSeq++);}}
    function ensure(i){var lo=Math.max(0,i-2),hi=Math.min(total-1,i+8);for(var k=lo;k<=hi;k++){if(!started[k])startLoad(k);}}
    startLoad(0);pump();

    function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
    function smooth(x){x=clamp(x,0,1);return x*x*(3-2*x);}

    function setP(p){
      p=clamp(p,0,1);
      var idx=Math.round(p*(frames.length-1));if(idx!==cur)paint(idx);
      if(hint)hint.style.opacity=String(clamp(1-p*4.5,0,1));

      // Stacked 3D cards: one active in front, previous shrink into depth, next rises from below.
      var pos=p*(N-0.001);
      for(var i=0;i<N;i++){
        var el=cards[i];
        var local=pos-i; // 0 = fully active
        var op=0, ty=0, tz=0, sc=1, rx=0;
        if(local<-0.15){
          // waiting below
          op=0; ty=72; tz=-80; sc=0.92; rx=8;
        }else if(local<0){
          // rising into view
          var u=smooth((local+0.15)/0.15);
          op=u; ty=(1-u)*72; tz=-80+(u*80); sc=0.92+0.08*u; rx=(1-u)*8;
        }else if(local<=1){
          // active → stacking back
          var v=smooth(local);
          op=1-v*0.22; ty=-v*34; tz=-v*180; sc=1-v*0.12; rx=-v*6;
        }else{
          // deep stack
          var w=clamp(local-1,0,2);
          op=Math.max(0,0.78-w*0.35); ty=-34-w*18; tz=-180-w*90; sc=0.88-w*0.05; rx=-6;
        }
        if(reduce){op=local>=-0.05&&local<0.95?1:0;ty=0;tz=0;sc=1;rx=0;}
        el.style.opacity=op.toFixed(3);
        el.style.zIndex=String(100+Math.round((1-Math.abs(local))*20));
        el.style.transform='translate3d(-50%,-50%,0) translateY('+ty.toFixed(2)+'vh) translateZ('+tz.toFixed(1)+'px) rotateX('+rx.toFixed(2)+'deg) scale('+sc.toFixed(3)+')';
        el.style.left='50%';el.style.top='50%';
        el.style.pointerEvents=op>0.55?'auto':'none';
      }
    }

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
