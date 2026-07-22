/**
 * «Тригер» — Hero with a character (animal / robot / creature) on the RIGHT,
 * styled background on the LEFT. A short (≈4s) Kling clip turns the head FULLY
 * left → center → right; mouse X smoothly scrubs frames so gaze follows the cursor.
 */

export function buildTriggerLookHtml(
  frames: string[],
  texts: Array<{ title: string; sub: string }>,
  navCtl: string,
  esc: (s: string) => string,
): string {
  const cid = "trg" + Math.random().toString(36).slice(2, 8);
  const framesJson = JSON.stringify(frames || []).replace(/</g, "\\u003c");
  const hero = texts[0] || { title: "", sub: "" };
  const title = hero.title ? esc(hero.title) : "";
  const sub = hero.sub ? esc(hero.sub) : "";

  return `
<!--craft-scrollanim-full-->
<section class="${cid}-hero" data-frames='${framesJson}' data-layout="trigger" data-craft-scrollanim="1" data-craft-trigger="1">
  <div class="${cid}-stage">
    <canvas class="${cid}-canvas" aria-hidden="true"></canvas>
    <div class="${cid}-veil"></div>
    <div class="${cid}-copy">
      ${title ? `<h1 class="${cid}-title">${title}</h1>` : ""}
      ${sub ? `<p class="${cid}-sub">${sub}</p>` : ""}
      <p class="${cid}-hint">двигайте мышью · персонаж смотрит за курсором</p>
    </div>
  </div>
</section>
<style>
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Manrope:wght@400;500;600&display=swap');
.${cid}-hero{position:relative;min-height:100vh;margin:0;padding:0;background:#07080c;overflow:hidden;}
.${cid}-stage{position:relative;min-height:100vh;width:100%;}
.${cid}-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
.${cid}-veil{position:absolute;inset:0;pointer-events:none;background:
  linear-gradient(90deg,rgba(0,0,0,.62) 0%,rgba(0,0,0,.28) 38%,rgba(0,0,0,.08) 58%,rgba(0,0,0,.2) 100%),
  radial-gradient(ellipse 55% 70% at 22% 50%,rgba(0,0,0,.35) 0%,transparent 70%);}
.${cid}-copy{position:relative;z-index:2;min-height:100vh;display:flex;flex-direction:column;justify-content:center;
  padding:clamp(88px,12vh,140px) clamp(18px,5vw,64px);max-width:min(520px,52vw);box-sizing:border-box;color:#fff;
  pointer-events:none;}
.${cid}-title{margin:0;font-family:'Syne',system-ui,sans-serif;font-weight:800;font-size:clamp(1.85rem,4.6vw,3.6rem);
  letter-spacing:-.035em;line-height:1.02;text-shadow:0 10px 40px rgba(0,0,0,.55);}
.${cid}-sub{margin:.85rem 0 0;max-width:34ch;font-family:'Manrope',system-ui,sans-serif;font-size:clamp(.95rem,1.5vw,1.15rem);
  line-height:1.5;color:rgba(255,255,255,.88);text-shadow:0 2px 16px rgba(0,0,0,.4);}
.${cid}-hint{margin-top:1.4rem;font-family:'Manrope',system-ui,sans-serif;font-size:.66rem;letter-spacing:.14em;
  text-transform:uppercase;color:rgba(255,255,255,.45);transition:opacity .45s ease;}
@media (max-width:780px){
  .${cid}-copy{max-width:92vw;justify-content:flex-end;padding-bottom:clamp(28px,8vh,64px);text-align:left;}
  .${cid}-veil{background:
    linear-gradient(180deg,rgba(0,0,0,.2) 0%,rgba(0,0,0,.15) 40%,rgba(0,0,0,.72) 100%);}
}
@media (prefers-reduced-motion:reduce){
  .${cid}-hint{display:none;}
}
</style>
<script>
(function(){
  var roots=document.querySelectorAll('.${cid}-hero');
  roots.forEach(function(root){
    if(root.__trgInit)return; root.__trgInit=true;
    var frames; try{ frames=JSON.parse(root.getAttribute('data-frames')||'[]'); }catch(e){ frames=[]; }
    if(!frames.length) return;
    var canvas=root.querySelector('.${cid}-canvas');
    if(!canvas) return;
    var ctx=canvas.getContext('2d',{ alpha:false });
    var imgs=new Array(frames.length);
    var loaded=0, ready=false;
    var target=0, current=0;
    var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var hint=root.querySelector('.${cid}-hint');
    var lastDraw=-1;
    var lastPtrX=null, lastPtrY=null;

    function fitDraw(img){
      if(!img || !img.complete || !img.naturalWidth) return;
      var dpr=Math.min(window.devicePixelRatio||1, 2);
      var w=canvas.clientWidth, h=canvas.clientHeight;
      if(!w || !h) return;
      if(canvas.width!==Math.floor(w*dpr) || canvas.height!==Math.floor(h*dpr)){
        canvas.width=Math.floor(w*dpr); canvas.height=Math.floor(h*dpr);
      }
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.fillStyle='#07080c';
      ctx.fillRect(0,0,w,h);
      var s=Math.max(w/img.naturalWidth, h/img.naturalHeight);
      var dw=img.naturalWidth*s, dh=img.naturalHeight*s;
      var dx=(w-dw)/2, dy=(h-dh)/2;
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    function render(){
      var i=Math.max(0, Math.min(frames.length-1, Math.round(current)));
      if(i===lastDraw && canvas.width) return;
      var img=imgs[i];
      if(img){ fitDraw(img); lastDraw=i; }
    }

    function lookFromPointer(clientX, clientY){
      var rect=root.getBoundingClientRect();
      // Full-viewport X: left (copy) → look left / frame 0; right (character) → look right / last frame.
      var nx=(clientX - rect.left) / Math.max(1, rect.width);
      var ny=(clientY - rect.top) / Math.max(1, rect.height);
      nx=Math.max(0, Math.min(1, nx));
      ny=Math.max(0, Math.min(1, ny));
      // Slight vertical bias for natural gaze; keep horizontal dominant.
      var look = nx * 0.94 + (ny - 0.5) * 0.06;
      return Math.max(0, Math.min(1, look));
    }

    function onPointer(clientX, clientY){
      if(!ready || reduce) return;
      lastPtrX=clientX; lastPtrY=clientY;
      var look=lookFromPointer(clientX, clientY);
      target = look * (frames.length - 1);
      if(hint) hint.style.opacity='0';
    }

    function tick(){
      if(ready){
        var ease = reduce ? 1 : 0.16;
        current += (target - current) * ease;
        if(Math.abs(target - current) < 0.015) current = target;
        render();
      }
      requestAnimationFrame(tick);
    }

    function onMove(e){ onPointer(e.clientX, e.clientY); }
    function onTouch(e){
      if(e.touches && e.touches[0]) onPointer(e.touches[0].clientX, e.touches[0].clientY);
    }
    window.addEventListener('pointermove', onMove, {passive:true});
    window.addEventListener('touchmove', onTouch, {passive:true});
    // Seed center gaze so left/right scrub has room both ways when frames are full L→R.
    target = (frames.length - 1) * 0.5;
    current = target;

    window.addEventListener('resize', function(){
      lastDraw=-1;
      if(lastPtrX!=null) onPointer(lastPtrX, lastPtrY);
      render();
    });

    frames.forEach(function(url, idx){
      var img=new Image();
      img.decoding='async';
      img.onload=function(){
        imgs[idx]=img;
        loaded++;
        if(idx===0) fitDraw(img);
        if(loaded>=frames.length){
          for(var i=0;i<frames.length;i++){
            if(!imgs[i] || !imgs[i].naturalWidth){
              var prev=null;
              for(var j=i-1;j>=0;j--){ if(imgs[j] && imgs[j].naturalWidth){ prev=imgs[j]; break; } }
              var any=null;
              for(var k=0;k<frames.length;k++){ if(imgs[k] && imgs[k].naturalWidth){ any=imgs[k]; break; } }
              imgs[i]=prev || any || img;
            }
          }
          ready=true;
          try{ window.dispatchEvent(new Event('craft:frames-ready')); }catch(e){}
          render();
        }
      };
      img.onerror=function(){
        loaded++;
        if(loaded>=frames.length){
          for(var i=0;i<frames.length;i++){
            if(!imgs[i] || !imgs[i].naturalWidth){
              var prev=null;
              for(var j=i-1;j>=0;j--){ if(imgs[j] && imgs[j].naturalWidth){ prev=imgs[j]; break; } }
              var any=null;
              for(var k=0;k<frames.length;k++){ if(imgs[k] && imgs[k].naturalWidth){ any=imgs[k]; break; } }
              imgs[i]=prev || any;
            }
          }
          if(imgs.some(function(x){ return x && x.naturalWidth; })){
            ready=true;
            try{ window.dispatchEvent(new Event('craft:frames-ready')); }catch(e){}
            render();
          }
        }
      };
      img.src=url;
    });
    requestAnimationFrame(tick);
  });
})();
</script>
${navCtl}
<!--/craft-scrollanim-full-->
`;
}
