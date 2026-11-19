/* Logical screen sizes in CSS pixels, without browser or WeChat chrome.
   Model dimensions follow the matching Playwright device descriptors. */
window.DeviceCover = (() => {
  'use strict';
  const phones = [
    ['iphoneSE','iPhone SE（第三代）',375,667],
    ['iphone14','iPhone 14',390,844],
    ['iphone16max','iPhone 16 Pro Max',440,956],
    ['galaxyS24','Galaxy S24',360,780],
    ['pixel7','Pixel 7',412,915],
    ['ratio16','9:16',360,640],
    ['ratio195','9:19.5',360,780],
    ['ratio20','9:20',360,800]
  ];
  const find = key => phones.find(([id]) => id === key) || phones[1];
  function renderDeviceSelect(value = 'iphone14') {
    const [selected] = find(value);
    const options = rows => rows.map(([id,name,w,h]) =>
      '<option value="'+id+'"'+(id===selected?' selected':'')+'>'+name+' · '+w+'×'+h+'</option>').join('');
    return '<label class="dc-select"><span>模拟屏幕</span><select data-device-preset aria-label="模拟手机屏幕（CSS 像素）">'+
      '<optgroup label="手机型号">'+options(phones.slice(0,5))+'</optgroup>'+
      '<optgroup label="常见比例">'+options(phones.slice(5))+'</optgroup></select></label>';
  }
  const displays = new Map();
  function releaseDevice(container) {
    for (const [node,observer] of displays) {
      if (!node.isConnected || node === container || container?.contains(node)) {
        observer.disconnect();
        displays.delete(node);
      }
    }
  }
  function applyDevice(container,preset = 'iphone14') {
    if (!container) return;
    releaseDevice(container);
    const shell = container.matches('.ze-phone,.ze-device') ? container :
      container.querySelector('.ze-phone,.ze-device');
    if (!shell || shell.closest('.ze-public')) return;
    const editor = shell.matches('.ze-phone');
    const stage = shell.parentElement;
    const [, , w, h] = find(preset);
    shell.classList.add('dc-simulated');
    shell.style.setProperty('--dc-viewport-width', w+'px');
    shell.style.setProperty('--dc-viewport-height', h+'px');
    function fit() {
      if (!shell.isConnected) {
        displays.get(shell)?.disconnect();displays.delete(shell);return;
      }
      const style = getComputedStyle(stage);
      const pad = prop => parseFloat(style.getPropertyValue(prop)) || 0;
      const availW = stage.clientWidth - pad('padding-left') - pad('padding-right');
      const bar = editor ? stage.querySelector('.ze-canvashead') : null;
      const availH = stage.clientHeight - pad('padding-top') - pad('padding-bottom') -
        (bar ? bar.offsetHeight + 26 : 0);
      if (availW <= 0 || availH <= 0) return;
      const scale = Math.min(1, availW/(w+(editor?18:2)), availH/(h+(editor?64:2)));
      shell.style.setProperty('--dc-scale', String(scale));
    }
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    displays.set(shell,observer);
  }

  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
  const ratios = {square:1, portrait:9/16, wide:16/9, banner:2.35};
  const cornerNames = {nw:'左上角', ne:'右上角', sw:'左下角', se:'右下角'};
  function crop(source, options = {}) {
    return new Promise((resolve,reject)=>{
      if (source instanceof Blob) {
        if (!['image/png','image/jpeg','image/webp'].includes(source.type) || source.size>10*1024*1024) {
          reject(Error('请选择 10 MB 以内的 JPG、PNG 或 WebP 图片。'));return;
        }
      } else if (typeof source!=='string' || !/^data:image\/(?:png|jpeg|webp);base64,/i.test(source)) {
        reject(Error('无法读取封面图片。'));return;
      }
      const [, , screenW, screenH]=find(options.preset);
      const initialRatio=options.aspect==='free'?0:
        typeof options.aspect==='number' && options.aspect>0 ? options.aspect :
        ratios[options.aspect] || screenW/screenH;
      const url=source instanceof Blob?URL.createObjectURL(source):source;
      const img=new Image();
      const dialog=document.createElement('dialog');
      dialog.className='dc-dialog';
      dialog.setAttribute('aria-label','裁剪封面');
      dialog.innerHTML='<form method="dialog" class="dc-crop"><header><h2>裁剪封面</h2>'+
        '<button type="button" class="dc-quiet" data-dc-cancel aria-label="关闭裁剪">×</button></header>'+
        '<div class="dc-stage" tabindex="0" aria-label="裁剪画布，上下左右键移动图片">'+
        '<div class="dc-box"><div class="dc-grid"></div>'+
        Object.entries(cornerNames).map(([k,name])=>'<button type="button" data-dc-corner="'+k+'" aria-label="调整'+name+'，使用方向键"></button>').join('')+
        '</div></div><p class="dc-hint">拖动图片，双指缩放，拖动四角调整取景。方向键可微调。</p>'+
        '<div class="dc-settings"><label>裁剪比例<select data-dc-ratio>'+
        '<option value="device">当前手机屏幕</option><option value="free">自由比例</option>'+
        '<option value="portrait">竖图 9:16</option><option value="square">方图 1:1</option>'+
        '<option value="wide">横图 16:9</option><option value="banner">横图 2.35:1</option></select></label>'+
        '<label class="dc-scale-range">缩放<input aria-label="图片缩放" type="range" min="1" max="5" value="1" step="0.01">'+
        '<output>1.00×</output></label></div><footer><button type="button" class="dc-reset" data-dc-reset>重置</button>'+
        '<button type="button" class="dc-secondary" data-dc-cancel>取消</button>'+
        '<button type="button" class="dc-primary" data-dc-use>使用封面</button></footer></form>';
      const stage=dialog.querySelector('.dc-stage'),box=dialog.querySelector('.dc-box');
      const ratioSelect=dialog.querySelector('[data-dc-ratio]'),slider=dialog.querySelector('input[type="range"]');
      const output=dialog.querySelector('output'),use=dialog.querySelector('[data-dc-use]');
      let ratio=initialRatio, zoom=1, rect, geometry, observer, raf=0, closed=false;
      let center={x:0,y:0}, drag=null, pinch=null;
      const pointers=new Map();
      img.alt='待裁剪的封面';img.draggable=false;img.className='dc-picture';
      stage.prepend(img);
      const W=()=>stage.clientWidth, H=()=>stage.clientHeight;

      function finish(result,error) {
        if (closed) return;
        closed=true;
        observer?.disconnect();
        cancelAnimationFrame(raf);
        if (dialog.open) dialog.close();
        dialog.remove();
        if (source instanceof Blob) URL.revokeObjectURL(url);
        if(error)reject(error);else resolve(result);
      }
      function defaultFrame() {
        const r=ratio || img.naturalWidth/img.naturalHeight;
        const w=Math.min(W()*.86,H()*.84*clamp(r,.16,6));
        const h=w/clamp(r,.16,6);
        rect={x:(W()-w)/2,y:(H()-h)/2,w,h};
      }
      function paint() {
        raf=0;
        if (!rect || closed) return;
        const iw=img.naturalWidth, ih=img.naturalHeight;
        const scale=Math.max(rect.w/iw, rect.h/ih)*zoom;
        const halfW=rect.w/(scale*2),halfH=rect.h/(scale*2);
        center.x=clamp(center.x,halfW,iw-halfW);center.y=clamp(center.y,halfH,ih-halfH);
        const left=rect.x+rect.w/2-center.x*scale,top=rect.y+rect.h/2-center.y*scale;
        Object.assign(img.style,{width:iw*scale+'px',height:ih*scale+'px',transform:'translate('+left+'px,'+top+'px)'});
        Object.assign(box.style,{width:rect.w+'px',height:rect.h+'px',transform:'translate('+rect.x+'px,'+rect.y+'px)'});
        output.textContent=zoom.toFixed(2)+'×';slider.value=String(zoom);
        geometry={left,top,scale};
      }
      function schedule(){if (!raf)raf=requestAnimationFrame(paint);}
      function reset() {
        zoom=1;center={x:img.naturalWidth/2,y:img.naturalHeight/2};
        defaultFrame();paint();
      }
      function resizeCorner(base,corner,dx,dy,geo) {
        const east=corner.includes('e'),south=corner.includes('s');
        const anchorX=east?base.x:base.x+base.w,anchorY=south?base.y:base.y+base.h;
        const maxW=east?W()-anchorX:anchorX,maxH=south?H()-anchorY:anchorY;
        let w=clamp(base.w+(east?dx:-dx),Math.min(32,maxW),maxW);
        let h=clamp(base.h+(south?dy:-dy),Math.min(32,maxH),maxH);
        if (ratio) {
          const desired=Math.abs(dx)>=Math.abs(dy*ratio)?w:h*ratio;
          const max=Math.min(maxW,maxH*ratio);
          w=clamp(desired,Math.min(max,Math.max(32,32*ratio)),max);h=w/ratio;
        }
        rect={x:east?anchorX:anchorX-w,y:south?anchorY:anchorY-h,w,h};
        zoom=clamp(geo.scale/Math.max(w/img.naturalWidth,h/img.naturalHeight),1,5);
        center={x:(rect.x+w/2-geo.left)/geo.scale,y:(rect.y+h/2-geo.top)/geo.scale};
      }
      stage.addEventListener('pointerdown',e=>{
        if(!geometry || e.button!==0 || pointers.size>=2)return;
        const corner=e.target.closest('[data-dc-corner]')?.dataset.dcCorner;
        if(drag && (drag.corner || e.pointerType!=='touch'))return;
        if(!corner)stage.focus({preventScroll:true});
        stage.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(pointers.size===2){
          paint();
          const [a,b]=[...pointers.values()],stageRect=stage.getBoundingClientRect();
          pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom,
            srcX:((a.x+b.x)/2-stageRect.left-geometry.left)/geometry.scale,
            srcY:((a.y+b.y)/2-stageRect.top-geometry.top)/geometry.scale};
          drag=null;
        }else{
          drag={id:e.pointerId,x:e.clientX,y:e.clientY,base:{...rect},geo:{...geometry},center:{...center},corner};
        }
        e.preventDefault();
      });
      stage.addEventListener('pointermove',e=>{
        if(!pointers.has(e.pointerId))return;
        pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(pinch){
          const [a,b]=[...pointers.values()],stageRect=stage.getBoundingClientRect();
          zoom=clamp(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance,1,5);
          const scale=Math.max(rect.w/img.naturalWidth,rect.h/img.naturalHeight)*zoom;
          center={x:pinch.srcX+(rect.x+rect.w/2-((a.x+b.x)/2-stageRect.left))/scale,
            y:pinch.srcY+(rect.y+rect.h/2-((a.y+b.y)/2-stageRect.top))/scale};
          schedule();return;
        }
        if(!drag||e.pointerId!==drag.id)return;
        const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
        if(drag.corner) resizeCorner(drag.base,drag.corner,dx,dy,drag.geo);
        else center={x:drag.center.x-dx/drag.geo.scale,y:drag.center.y-dy/drag.geo.scale};
        schedule();
      });
      function endDrag(e){
        if(!pointers.delete(e.pointerId))return;
        pinch=null;drag=null;paint();
        if(pointers.size){
          const [id,point]=pointers.entries().next().value;
          drag={id,...point,base:{...rect},geo:{...geometry},center:{...center}};
        }
      }
      stage.addEventListener('pointerup',endDrag);stage.addEventListener('pointercancel',endDrag);
      stage.addEventListener('lostpointercapture',endDrag);
      stage.addEventListener('keydown',e=>{
        const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
        if(!direction || !geometry)return;
        e.preventDefault();const step=e.shiftKey?10:2,dx=direction[0]*step,dy=direction[1]*step;
        const corner=e.target.closest('[data-dc-corner]')?.dataset.dcCorner;
        if(corner) resizeCorner(rect,corner,dx,dy,geometry);
        else center={x:center.x-dx/geometry.scale,y:center.y-dy/geometry.scale};
        paint();
      });
      slider.addEventListener('input',()=>{zoom=Number(slider.value);paint();});
      ratioSelect.addEventListener('change',()=>{
        ratio=ratioSelect.value==='free'?0:ratioSelect.value==='custom'?initialRatio:ratios[ratioSelect.value] || screenW/screenH;
        if (ratio) defaultFrame();
        paint();
      });
      dialog.querySelector('form').onsubmit=e=>e.preventDefault();
      dialog.querySelectorAll('[data-dc-cancel]').forEach(b=>b.onclick=()=>finish(null));
      dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
      dialog.querySelector('[data-dc-reset]').onclick=reset;
      use.onclick=()=>{
        use.disabled=true;
        try {
          paint();
          const {scale,left,top}=geometry;
          const sw=rect.w/scale,sh=rect.h/scale;
          const sx=clamp((rect.x-left)/scale,0,img.naturalWidth-sw);
          const sy=clamp((rect.y-top)/scale,0,img.naturalHeight-sh);
          const outputScale=Math.min(1,1600/Math.max(sw,sh));
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(sw*outputScale));canvas.height=Math.max(1,Math.round(sh*outputScale));
          const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
          ctx.drawImage(img,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
          for(const quality of [.9,.77,.6,.4]){
            const result=canvas.toDataURL('image/jpeg',quality);
            if(result.startsWith('data:image/jpeg;base64,') && result.length-23<=4*Math.floor(2*1024*1024/3)){
              finish(result);return;
            }
          }
          throw Error('封面压缩失败，请尝试较小的图片。');
        }catch(error){finish(null,error);}
      };
      img.onload=()=>{
        if (img.naturalWidth*img.naturalHeight>48000000) {finish(null,Error('图片超过 4800 万像素，请缩小后重试。'));return;}
        document.body.append(dialog);dialog.showModal();
        const presetName=options.aspect;
        if(presetName==='free'||Object.hasOwn(ratios,presetName)) ratioSelect.value=presetName;
        else if(typeof presetName==='number'&&presetName>0 && Number.isFinite(presetName)){
          ratioSelect.add(new Option('指定比例','custom'));ratioSelect.value='custom';
        }
        reset();
        let oldW=W(),oldH=H();
        observer=new ResizeObserver(()=>{
          if (!rect||!oldW||!oldH||!W()||!H())return;
          if(oldW===W()&&oldH===H())return;
          const scale=Math.min(W()/oldW,H()/oldH);
          rect={x:clamp(rect.x*W()/oldW,0,W()-rect.w*scale),y:clamp(rect.y*H()/oldH,0,H()-rect.h*scale),w:rect.w*scale,h:rect.h*scale};
          oldW=W();oldH=H();paint();
        });
        observer.observe(stage);
        stage.focus({preventScroll:true});
      };
      img.onerror=()=>finish(null,Error('无法解码封面，请使用有效的 JPG、PNG 或 WebP 图片。'));
      img.src=url;
    });
  }
  return Object.freeze({renderDeviceSelect,applyDevice,releaseDevice,crop});
})();
