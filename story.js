(() => {
  'use strict';

  const kinds = {
    summit: ['cover', 'letter', 'highlights', 'agenda', 'location', 'rsvp', 'follow'],
    salon: ['cover', 'letter', 'organizers', 'about', 'agenda', 'location', 'rsvp']
  };
  const labels = {
    cover:'活动邀请', letter:'诚挚邀请', highlights:'会议亮点', organizers:'主办单位',
    about:'机构介绍', agenda:'活动议程', location:'会场导航', rsvp:'参会回执', follow:'保持联系'
  };
  const blank = {cover:'',letter:'诚邀您拨冗出席，与我们面对面交流。',highlights:'议题分享\n伙伴交流',
    organizers:'活动主办团队',about:'期待与您面对面交流。',agenda:'议程请以现场安排为准。',
    location:'',rsvp:'请填写参会信息，以便主办方安排接待。',follow:'感谢关注，期待再次相聚。'};
  const is = event => Object.hasOwn(kinds,event.template);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const picture = value => /^data:image\/(?:jpeg|png|webp);base64,[\w+/=]+$/i.test(value || '') ? value : '';
  function url(value) {
    try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) ? u.href : ''; }
    catch { return ''; }
  }
  function makePage(type,event) {
    const blocks = event?.blocks || [];
    let body = blank[type];
    if (type==='letter') body = event?.detail || body;
    if (type==='agenda') body = blocks.filter(b=>b.type==='agenda').map(b=>b.body).join('\n') || body;
    if (type==='location') body = blocks.filter(b=>b.type==='notice' && /地址|会场|地点/.test(b.title)).map(b=>b.body).join('\n');
    return {type,title:labels[type],body:body.slice(0,2000).replace(/[\uD800-\uDBFF]$/,'')};
  }
  function defaults(kind,event) {
    const summit=kind==='summit';
    return {accent:summit?'#245b52':'#804b3f',background:summit?'#f4f5ee':'#f6f1e8',
      font:summit?'sans':'serif',pages:(kinds[kind]||kinds.summit).map(t=>makePage(t,event)),
      mapUrl:'',followUrl:'',followImage:''};
  }
  function settings(event) { return event.story || defaults(event.template,event); }
  function ensure(event) { return event.story ||= defaults(event.template,event); }
  function cssColor(value,fallback) { return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback; }
  function onColor(hex) {
    const a=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+.055)/1.055)**2.4);
    return a[0]*.2126+a[1]*.7152+a[2]*.0722>.179?'#101615':'#ffffff';
  }
  const glyph = direction => '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="'+(direction==='up'?'m6 14 6-6 6 6':'m6 10 6 6 6-6')+'"/></svg>';
  const number = n => String(n).padStart(2,'0');
  const lines = s => String(s || '').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const paras = text => lines(text).map(t=>'<p>'+esc(t)+'</p>').join('');
  function pageBody(event, cfg, page) {
    const time = [event.date, event.time].filter(Boolean).join(' · ');
    switch(page.type){
      case 'cover': {
        const cover=picture(event.cover);
        const media=cover?'<img class="st-cover-photo" src="'+esc(cover)+'" alt="活动封面">':
          '<div class="st-art" aria-hidden="true">'+(typeof window.posterArt==='function'?window.posterArt(event.theme||'teal'):'')+'</div>';
        return '<div class="st-cover-media">'+media+'</div><div class="st-cover-copy"><p class="st-cover-label">'+esc(page.title)+'</p><h1>'+esc(event.title)+'</h1>'+paras(page.body)+'<div class="st-facts"><span>'+esc(time)+'</span><span>'+esc(event.place)+'</span></div></div>';
      }
      case 'highlights':
        return '<ul class="st-highlights">'+lines(page.body).map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul>';
      case 'agenda':
        return '<ol class="st-agenda">'+lines(page.body).map(line=>{
          const match=line.match(/^(\d{1,2}[:：]\d{2}(?:\s*[–—~-]\s*\d{1,2}[:：]\d{2})?)\s*(.*)$/);
          return '<li>'+(match?'<time>'+esc(match[1])+'</time><span>'+esc(match[2])+'</span>':esc(line))+'</li>';
        }).join('')+'</ol>';
      case 'location': {
        const map = url(cfg.mapUrl) || (event.place ? 'https://uri.amap.com/search?keyword='+encodeURIComponent(event.place)+'&view=map&src=invite-studio' : '');
        return '<div class="st-venue"><p>'+esc(event.place || '地点待定')+'</p><small>'+esc(time)+'</small></div>'+paras(page.body)+(map?'<a class="st-action" href="'+esc(map)+'" target="_blank" rel="noopener noreferrer">打开地图 ↗</a>':'');
      }
      case 'rsvp':
        return paras(page.body)+'<button class="st-action" type="button" data-story-register '+(event.status==='ended'?'disabled>活动已结束':'>填写报名表')+'</button>';
      case 'follow':
        return paras(page.body)+(picture(cfg.followImage)?'<img class="st-qr" src="'+esc(cfg.followImage)+'" alt="关注二维码">':'')+(url(cfg.followUrl)?'<a class="st-action" href="'+esc(url(cfg.followUrl))+'" target="_blank" rel="noopener noreferrer">打开关注链接 ↗</a>':'');
      default:
        return paras(page.body);
    }
  }
  function render(event, options={}) {
    const cfg=settings(event), count=cfg.pages.length;
    const accent=cssColor(cfg.accent,'#245b52'),paper=cssColor(cfg.background,'#f4f5ee');
    const pages=cfg.pages.map((p,i)=>'<section class="st-page st-'+esc(p.type)+'" data-story-screen="'+i+'" aria-label="'+esc(p.title)+'">'+
      '<div class="st-page-inner">'+(p.type==='cover'?pageBody(event,cfg,p):
      '<header><p class="st-running">'+esc(event.title)+'</p><h2>'+esc(p.title)+'</h2></header><div class="st-body">'+pageBody(event,cfg,p)+'</div>')+'</div></section>').join('');
    return '<article tabindex="0" class="st-deck st-font-'+(cfg.font==='serif'?'serif':'sans')+'" aria-label="逐屏邀请函" style="--st-accent:'+accent+';--st-paper:'+paper+';--st-ink:'+onColor(paper)+';--st-on-accent:'+onColor(accent)+'">'+
      '<div class="st-viewport">'+pages+'</div><div class="st-controls"><div class="st-progress" role="progressbar" aria-label="邀请函阅读进度" aria-valuemin="1" aria-valuemax="'+count+'"><span></span></div>'+
      '<div class="st-nav"><b class="st-counter"></b><span class="st-page-name" aria-live="polite"></span><button data-story-nav="-1" aria-label="上一屏">'+glyph('up')+'</button><button data-story-nav="1" aria-label="下一屏">'+glyph('down')+'</button></div></div></article>';
  }
  function mount(container,event,options={}) {
    const deck=container.matches('.st-deck')?container:container.querySelector('.st-deck');
    if(!deck)return null;
    const lifetime=new AbortController(),signal=lifetime.signal;
    const viewport=deck.querySelector('.st-viewport'),screens=[...viewport.children],cfg=settings(event);
    const progress=deck.querySelector('.st-progress'),pill=progress.firstElementChild;
    const coverImage=deck.querySelector('.st-cover-photo');
    if(coverImage){
      const sizeLayout=()=>coverImage.closest('.st-cover')?.classList.toggle('st-wide-photo',coverImage.naturalWidth>coverImage.naturalHeight);
      if(coverImage.complete)sizeLayout();else coverImage.addEventListener('load',sizeLayout,{once:true,signal});
    }
    let active=-1, frame=0, pending=null;
    const clamp=index=>Math.max(0,Math.min(screens.length-1,Math.trunc(index)||0));
    const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
    function mark(index) {
      if(index===active)return;
      const old=active;active=index;
      deck.querySelector('.st-counter').textContent=number(index+1)+' / '+number(screens.length);
      deck.querySelector('.st-page-name').textContent=cfg.pages[index].title;
      deck.querySelector('[data-story-nav="-1"]').disabled=index===0;
      deck.querySelector('[data-story-nav="1"]').disabled=index===screens.length-1;
      progress.setAttribute('aria-valuenow',index+1);
      progress.dataset.direction=index<old?'back':'forward';
      pill.style.left=(100*index/screens.length)+'%';
      pill.style.right=(100*(screens.length-index-1)/screens.length)+'%';
      screens.forEach((screen,i)=>screen.classList.toggle('st-current',i===index));
      options.onPage?.(index);
    }
    function goTo(index, instant=false){
      const next=clamp(index);
      pending=next;
      mark(next);
      viewport.scrollTo({top:screens[next].offsetTop,behavior:instant||reduced()?'instant':'smooth'});
      if(instant || reduced())pending=null;
    }
    function identify() {
      frame=0;
      if(!deck.isConnected)return;
      const point=viewport.scrollTop+Math.min(64,viewport.clientHeight/4);
      let index=0;while(index+1<screens.length&&screens[index+1].offsetTop<=point)index++;
      if(index===pending)pending=null;
      if(pending===null)mark(index);
    }
    viewport.addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(identify)},{passive:true,signal});
    viewport.addEventListener('scrollend',()=>{pending=null;identify()},{signal});
    for(const kind of ['pointerdown','wheel','touchstart'])viewport.addEventListener(kind,()=>{pending=null},{passive:true,signal});
    deck.addEventListener('click',e=>{
      const register=e.target.closest('[data-story-register]');
      if(register && !register.disabled){options.onRegister?.();return;}
      const btn=e.target.closest('[data-story-nav]');
      if(btn && !btn.disabled)goTo(active+Number(btn.dataset.storyNav));
    },{signal});
    deck.addEventListener('keydown',e=>{
      if(e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('input,textarea,select'))return;
      const keys={ArrowDown:1,PageDown:1,ArrowUp:-1,PageUp:-1};
      if(Object.hasOwn(keys,e.key)){e.preventDefault();goTo(active+keys[e.key]);}
      else if(e.key==='Home' || e.key==='End'){e.preventDefault();goTo(e.key==='Home'?0:screens.length-1);}
    },{signal});
    goTo(options.index ?? 0,true);
    return {goTo,get index(){return active},destroy(){lifetime.abort();cancelAnimationFrame(frame);}};
  }
  function editorControls(event) {
    const cfg=settings(event);
    const rows=cfg.pages.map((p,i)=>{
      const fixed=p.type==='cover'||p.type==='rsvp';
      const a=(op,label,disabled=false)=>'<button type="button" data-story-action="'+op+'" '+(disabled?'disabled':'')+'>'+label+'</button>';
      let extra='';
      if(p.type==='location')extra='<label class="ze-label">导航链接（选填）<input type="url" maxlength="2048" data-story-setting="mapUrl" value="'+esc(cfg.mapUrl)+'" placeholder="默认按活动地点搜索地图"></label>';
      if(p.type==='follow')extra='<label class="ze-label">关注链接（选填）<input type="url" maxlength="2048" data-story-setting="followUrl" value="'+esc(cfg.followUrl)+'" placeholder="https://"></label><label class="ze-label">关注二维码（选填）<input type="file" data-story-follow-input accept="image/png,image/jpeg,image/webp"></label>'+(cfg.followImage?'<div class="st-edit-qr"><img src="'+esc(picture(cfg.followImage))+'" alt="已上传的关注二维码">'+a('remove-qr','移除二维码')+'</div>':'');
      return '<details class="story-page-edit" data-story-page="'+i+'"><summary><small>'+number(i+1)+'</small><span>'+esc(labels[p.type])+'</span></summary><div class="st-row-edit">'+
        '<label class="ze-label">页面标题<input maxlength="100" data-story-prop="title" value="'+esc(p.title)+'"></label><label class="ze-label">页面文案<textarea rows="3" maxlength="2000" data-story-prop="body">'+esc(p.body)+'</textarea></label>'+extra+
        '<div class="st-row-actions">'+(i>0?a('up','上移',i===1)+a('down','下移',i===cfg.pages.length-1):'')+(!fixed?a('remove','移除本页'):'')+'</div></div></details>';
    }).join('');
    const missing=Object.keys(labels).filter(type=>!cfg.pages.some(p=>p.type===type));
    return '<section class="st-editor"><h2>逐屏设计</h2><p class="ze-muted">调整配色和页面内容，或通过手机预览检查翻页顺序。</p><div class="st-palette">'+
      '<label>主题色<input data-story-setting="accent" type="color" value="'+esc(cfg.accent)+'"></label><label>页面底色<input data-story-setting="background" type="color" value="'+esc(cfg.background)+'"></label>'+
      '<label>字体<select data-story-setting="font"><option value="sans" '+(cfg.font==='sans'?'selected':'')+'>现代黑体</option><option value="serif" '+(cfg.font==='serif'?'selected':'')+'>人文宋体</option></select></label></div>'+
      '<h3>页面顺序</h3>'+rows+(missing.length?'<div class="st-page-add"><label>添加页面<select data-story-new>'+missing.map(type=>'<option value="'+type+'">'+esc(labels[type])+'</option>').join('')+'</select></label><button type="button" data-story-action="add">添加</button></div>':'')+'</section>';
  }
  function update(event,target) {
    if(!target?.matches('[data-story-prop],[data-story-setting]'))return false;
    const cfg=ensure(event), key=target.dataset.storySetting;
    if(key && ['accent','background','font','mapUrl','followUrl'].includes(key))cfg[key]=target.value;
    else {
      const item=cfg.pages[Number(target.closest('[data-story-page]')?.dataset.storyPage)];
      if(!item||!['title','body'].includes(target.dataset.storyProp))return false;
      item[target.dataset.storyProp]=target.value;
    }
    return true;
  }
  function action(event,button) {
    const cfg=ensure(event), list=cfg.pages, command=button.dataset.storyAction;
    if(command==='add'){
      const type=button.closest('.st-page-add')?.querySelector('select')?.value;
      if(!Object.hasOwn(labels,type)||list.some(p=>p.type===type))return null;
      const index=type==='follow'?list.length:list.findIndex(p=>p.type==='rsvp');
      list.splice(index,0,makePage(type,event));
      return index;
    }
    const index=Number(button.closest('[data-story-page]')?.dataset.storyPage);
    if(!list[index])return null;
    if(command==='remove-qr'){cfg.followImage='';return index;}
    if(command==='remove'&&!['rsvp','cover'].includes(list[index].type)){
      list.splice(index,1);return Math.min(index,list.length-1);
    }
    const next=index+(command==='up'?-1:command==='down'?1:0);
    if(index<=0||next<=0||index===next||next>=list.length)return null;
    [list[index],list[next]]=[list[next],list[index]];
    return next;
  }
  async function uploadFollow(event,file) {
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>512*1024)throw new Error('请选择 512 KB 以内的 PNG、JPG 或 WebP 二维码。');
    const reader=new FileReader();
    const src=await new Promise((res,rej)=>{reader.onload=()=>res(reader.result);reader.onerror=()=>rej(new Error('无法读取图片。'));reader.readAsDataURL(file);});
    const img=new Image();img.src=src;await img.decode();
    if(img.width>8192||img.height>8192||img.width*img.height>16777216)throw new Error('二维码图片尺寸过大。');
    ensure(event).followImage=src;
  }
  window.InviteStory=Object.freeze({is,defaults,settings,render,mount,editorControls,update,action,uploadFollow});
})();
