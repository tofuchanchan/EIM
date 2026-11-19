(() => {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
  const color = (v, fallback) => /^#[\da-f]{6}$/i.test(v) ? v : fallback;
  const number = (v, min, max, fallback) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min,v)) : fallback;
  const inList = (v, list, fallback) => list.includes(v) ? v : fallback;
  const uid = prefix => prefix + (crypto.randomUUID?.() || Date.now().toString(36)+Math.random().toString(36).slice(2));
  const transitions = ['none','slide','fade','zoom'];
  const entrances = ['none','fade','rise','zoom','slide'];
  const green = '#205b50';
  const ivory = '#f6f4ec';
  const ink = '#172b27';

  function makeElement(type, overrides={}) {
    const content = {
      title:{text:'页面标题'}, paragraph:{text:'在这里填写邀请函正文。'}, textbox:{text:'在这里填写提示信息。'},
      table:{rows:[['时间','事项'],['14:00','签到入场']]}, divider:{},
      image:{src:'',alt:'',fit:'contain'}, button:{text:'填写报名表',action:'register',url:''}
    }[type];
    const style = {color:ink,background:'transparent',fontSize:16,align:'left',bold:false,radius:0,font:'sans'};
    if(type==='title') Object.assign(style,{fontSize:30,bold:true});
    if(type==='textbox') Object.assign(style,{background:'#e7efe9',radius:8});
    if(type==='button') Object.assign(style,{color:'#ffffff',background:green,align:'center',bold:true,radius:7});
    if(type==='divider') style.color=green;
    const heights={title:16,paragraph:20,textbox:18,table:24,divider:3,image:32,button:9};
    return {
      id:uid('e'),type,x:8,y:10,w:84,h:heights[type],...overrides,
      content:{...content,...overrides.content},style:{...style,...overrides.style},
      animation:{type:'none',duration:400,delay:0,...overrides.animation}
    };
  }
  function makePage(name='新页面') {
    return {id:uid('p'),name,background:'#ffffff',transition:'slide',elements:[]};
  }
  function link(value) {
    try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}
    catch{return '';}
  }
  function text(value,event) {
    return String(value??'').replace(/\{\{(title|date|time|place)\}\}/g,(_, key)=>event[key]||'');
  }
  function imageValue(value) {
    return typeof value==='string' && /^data:image\/(?:jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
  }
  function elementStyle(el) {
    const s=el.style||{}, a=el.animation||{};
    const bg=s.background==='transparent'?'transparent':color(s.background,'transparent');
    const font=s.font==='serif'?'Georgia,Songti SC,SimSun,serif':'Inter,Microsoft YaHei,PingFang SC,sans-serif';
    const size=number(s.fontSize,8,120,16);
    return 'left:'+number(el.x,0,100,0)+'%;top:'+number(el.y,0,100,0)+'%;width:'+number(el.w,0,100,84)+
      '%;height:'+number(el.h,0,100,15)+'%;color:'+color(s.color,ink)+';background:'+bg+
      ';font-size:calc('+size+' * 100cqw / 390);font-family:'+font+';font-weight:'+(s.bold?'700':'400')+
      ';text-align:'+inList(s.align,['left','center','right'],'left')+';border-radius:'+number(s.radius,0,128,0)+'px;'+
      '--il-duration:'+number(a.duration,0,5000,400)+'ms;--il-delay:'+number(a.delay,0,5000,0)+'ms';
  }
  function registrationBlockedLabel(event,preview=false){
    return preview?'':({upcoming:'未开始',expired:'已截止',ended:'报名已关闭'})[event.registrationState||event.status]||'';
  }
  function registrationTimeNote(event,preview=false){
    if(preview)return '';
    const schedule=event.registrationSchedule;
    if(event.registrationState==='upcoming'&&schedule?.start)return '报名开始 '+schedule.start.replace('T',' ')+'（北京时间）';
    if(['live','expired'].includes(event.registrationState)&&schedule?.end)return '报名截止 '+schedule.end.replace('T',' ')+'（北京时间）';
    return '';
  }
  function updateRegistrationControls(container,event){
    const blocked=registrationBlockedLabel(event),timing=registrationTimeNote(event);
    for(const button of container.querySelectorAll('button[data-registration-label]')){
      button.disabled=Boolean(blocked);
      button.textContent=blocked||button.dataset.registrationLabel;
    }
    for(const input of container.querySelectorAll('form.ze-guest-form input')){
      input.disabled=Boolean(blocked);
    }
    for(const note of container.querySelectorAll('[data-registration-time-note]')){
      note.hidden=!timing;
      note.textContent=timing;
    }
  }
  function registrationForm(event,{editor=false,preview=false,inline=false,label='提交报名'}={}) {
    const blocked=registrationBlockedLabel(event,preview);
    const timing=registrationTimeNote(event,preview);
    const fields=event.fields.map(f=>{
      const kind=Object.entries(event.registrationUnique||{}).find(([,key])=>key===f.key)?.[0];
      const required=Boolean(f.required||kind);
      const type=kind==='phone'?'tel':kind==='wechat'?'text':/手机|电话/.test(f.label)?'tel':/邮箱/.test(f.label)?'email':'text';
      return '<label class="ze-label">'+esc(f.label)+(required?' <b>*</b>':'')+
        '<input name="'+esc(f.key)+'" type="'+type+'" maxlength="120" '+(required?'required ':'')+
        (editor||blocked?'disabled ':'')+(editor?'tabindex="-1" ':'')+
        'placeholder="请输入'+esc(f.label)+'">'+(kind?'<small class="ze-identity-help">同一'+(kind==='phone'?'手机号':'微信号')+'限报一次</small>':'')+'</label>';
    }).join('');
    const note=editor?'提交后，活动负责人可查看本次报名信息。':preview?'预览模式 · 提交仅体验回执':
      window.studio?.shared?'提交后，活动负责人可查看本次报名信息。':'演示报名仅保存在当前浏览器，请填写示例信息。';
    const tag=editor?'div':'form';
    return '<'+tag+' class="ze-guest-form'+(inline?' il-inline-form':'')+'">'+fields+
      '<p class="ze-muted ze-note">'+note+'</p>'+
      '<p class="ze-muted ze-note" data-registration-time-note aria-live="polite" '+(timing?'':'hidden')+'>'+esc(timing)+'</p>'+
      '<button class="ze-btn ze-primary ze-full" type="'+(editor?'button':'submit')+'" data-registration-label="'+esc(label)+'" '+
      (editor||blocked?'disabled':'')+'>'+esc(blocked||label)+'</button></'+tag+'>';
  }
  function elementHTML(el,event,{editor=false,preview=false}={}) {
    const c=el.content||{};
    const written = s => esc(text(s,event));
    let body='';
    switch(el.type) {
      case 'title': body='<h2>'+written(c.text)+'</h2>';break;
      case 'paragraph':
      case 'textbox': body='<div class="il-text">'+written(c.text)+'</div>';break;
      case 'divider': body='<hr>';break;
      case 'table':
        body='<table'+(c.lines==='ruled'?' class="il-ruled-table"':c.lines==='grid'?' class="il-grid-table"':'')+'><tbody>'+c.rows.map((row,index)=>'<tr>'+row.map(cell=>index===0?
          '<th scope="col">'+written(cell)+'</th>':'<td>'+written(cell)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';break;
      case 'image': {
        const src=imageValue(c.src==='@cover'?event.cover:c.src);
        if(src) body='<img draggable="false" alt="'+esc(c.alt)+'" style="object-fit:'+
          (c.fit==='cover'?'cover':'contain')+'" src="'+src+'">';
        else if(c.src==='@cover'&&typeof window.posterArt==='function') body=window.posterArt(event.theme||'teal');
        else if(editor) body='<span class="il-image-slot">选择图片</span>';
        break;
      }
      case 'button': {
        const label=written(c.text);
        if(c.action==='inline-register'){
          const accent=color(el.style.color,'#172e39');
          const channel=[1,3,5].map(i=>parseInt(accent.slice(i,i+2),16)/255);
          const luminance=channel.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
          const foreground=luminance[0]*.2126+luminance[1]*.7152+luminance[2]*.0722>.179?'#10212d':'#ffffff';
          return '<div class="il-content il-form-holder'+(el.style.background!=='transparent'?' il-form-panel':'')+'" style="--reply-accent:'+accent+';--reply-ink:'+foreground+'">'+
            registrationForm(event,{editor,preview,inline:true,label:text(c.text,event)})+'</div>';
        }
        if(editor)body='<span class="il-action">'+label+'</span>';
        else if(c.action==='register'){
          const blocked=registrationBlockedLabel(event,preview);
          body='<button type="button" class="il-action" data-layout-register data-registration-label="'+written(c.text)+'" '+
            (blocked?'disabled':'')+'>'+esc(blocked||text(c.text,event))+'</button>';
        }
        else {
          const href=link(String(c.url||'').replace(/\{\{(title|date|time|place)\}\}/g,
            (_,name)=>encodeURIComponent(event[name]||'')));
          body=href?'<a class="il-action" target="_blank" rel="noopener noreferrer" href="'+esc(href)+'">'+label+'</a>':'<span class="il-action">'+label+'</span>';
        }
        break;
      }
    }
    return '<div class="il-content il-body-'+esc(el.type)+'">'+body+'</div>';
  }

  // Assign IDs from the original order when adapting an unsaved legacy record.
  // Reopening a preview must not change IDs, versions or published content.
  function buildDesign(event) {
    let prior=event.story||{};
    if(!prior.pages && ['summit','salon'].includes(event.template)){
      const oldPages=event.template==='summit'?
        ['cover','letter','highlights','agenda','location','rsvp','follow']:
        ['cover','letter','organizers','about','agenda','location','rsvp'];
      const labels={cover:'活动邀请',letter:'诚挚邀请',highlights:'会议亮点',organizers:'主办单位',
        about:'机构介绍',agenda:'活动议程',location:'会场导航',rsvp:'参会回执',follow:'保持联系'};
      const blocks=event.blocks||[];
      const samples={cover:'',letter:event.detail||'诚邀您拨冗出席，与我们面对面交流。',highlights:'议题分享\n伙伴交流',
        organizers:'活动主办团队',about:'期待与您面对面交流。',agenda:blocks.filter(b=>b.type==='agenda').map(b=>b.body).join('\n')||'议程请以现场安排为准。',
        location:blocks.filter(b=>b.type==='notice'&&/地址|会场|地点/.test(b.title)).map(b=>b.body).join('\n'),
        rsvp:'请填写参会信息，以便主办方安排接待。',follow:'感谢关注，期待再次相聚。'};
      prior={accent:event.template==='summit'?'#245b52':'#804b3f',background:event.template==='summit'?'#f4f5ee':'#f6f1e8',
        font:event.template==='summit'?'sans':'serif',pages:oldPages.map(type=>({type,title:labels[type],body:samples[type].slice(0,2000)}))};
    }
    const accent=color(prior.accent,green),background=color(prior.background,ivory);
    const rgb=background.slice(1).match(/../g).map(v=>parseInt(v,16)/255);
    const textColor=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722<.48?'#ffffff':ink;
    const font=prior.font==='serif'||event.template==='editorial'?'serif':'sans';
    const pages=[];
    function page(name) {
      const p={...makePage(name),id:'p'+(pages.length+1),background};pages.push(p);return p;
    }
    function add(p,type,x,y,w,h,content,style={}) {
      const element=makeElement(type,{id:p.id+'e'+(p.elements.length+1),x,y,w,h,content,
        style:{font,color:type==='button'?'#ffffff':textColor,...style},
        animation:{type:type==='image'?'fade':'rise',duration:360,delay:Math.min(p.elements.length*45,180)}});
      p.elements.push(element);return element;
    }
    function cover(title,body) {
      const p=page(title||'封面');
      add(p,'image',0,0,100,49,{src:'@cover',alt:'活动封面',fit:'cover'},{background:accent});
      add(p,'paragraph',7,53,86,5,{text:title||'邀请函'},{fontSize:14,bold:true});
      add(p,'title',7,60,86,body?17:24,{text:'{{title}}'},{fontSize:36});
      if(body)add(p,'paragraph',7,77,86,10,{text:body},{fontSize:14});
      add(p,'divider',7,87,86,2,{}, {color:accent});
      add(p,'paragraph',7,90,86,9,{text:'{{date}}  {{time}}\n{{place}}'},{fontSize:14});
    }
    function contentPage(name,body,type='text',url='') {
      const p=page(name);
      add(p,'divider',8,7,12,2,{}, {color:accent});
      add(p,'title',8,13,84,16,{text:name},{fontSize:30});
      const button=(label,action,href='')=>add(p,'button',8,82,84,10,{text:label,action,url:href},{background:accent});
      if(type==='agenda') {
        const lines=body.split(/\r?\n/).filter(l=>l.trim());
        if(lines.length&&lines.length<=49){
          const rows=lines.map(line=>{
            const m=line.match(/^\s*(\d{1,2}[:：]\d{2}(?:\s*[–—~-]\s*\d{1,2}[:：]\d{2})?)\s*(.*)$/);
            return m?[m[1],m[2]]:['',line];
          });
          add(p,'table',8,33,84,58,{rows:[['时间','安排'],...rows]},{fontSize:15});
        }else add(p,'paragraph',8,33,84,58,{text:body});
      }else if(type==='location'){
        add(p,'textbox',8,33,84,18,{text:'{{place}}\n{{date}}  {{time}}'},
          {background:'#e8efe9',color:ink,fontSize:17});
        if(body)add(p,'paragraph',8,55,84,24,{text:body});
        // The address query follows changes made in basic information.
        button('打开地图','link',url||'https://uri.amap.com/search?view=map&keyword={{place}}');
      }else if(type==='rsvp'){
        add(p,'paragraph',8,33,84,44,{text:body});button('填写报名表','register');
      }else if(type==='follow'){
        const qr=prior.followImage;
        if(qr)add(p,'image',22,33,56,32,{src:qr,fit:'contain',alt:'关注二维码'});
        if(body)add(p,'paragraph',8,qr?67:33,84,qr?13:43,{text:body});
        if(link(prior.followUrl))button('打开关注链接','link',prior.followUrl);
      }else add(p,type==='notice'?'textbox':'paragraph',8,32,84,58,{text:body});
    }
    if(prior.pages?.length){
      for(const screen of prior.pages){
        if(screen.type==='cover')cover(screen.title,screen.body);
        else contentPage(screen.title,screen.body,screen.type,prior.mapUrl);
      }
    }else{
      cover('邀请函','');
      contentPage('诚挚邀请',event.detail||'诚邀您拨冗出席，与我们面对面交流。');
      for(const block of event.blocks||[])contentPage(block.title,block.body,block.type);
      if(!event.blocks?.some(b=>b.type==='agenda')) contentPage('活动议程','签到入场\n主题分享\n交流讨论','agenda');
      contentPage('会场导航','','location');
      contentPage('参会回执','请填写参会信息，以便主办方安排接待。','rsvp');
    }
    return {pages};
  }
  function prepare(event) {
    const prepared=clone(event);
    if(!prepared.design?.pages?.length)prepared.design=buildDesign(prepared);
    prepared.template='invitation';
    delete prepared.story;
    return prepared;
  }
  function render(event) {
    const design=event.design||buildDesign(event);
    return '<article class="il-player" tabindex="0" aria-label="邀请函"><div class="il-stage"></div>'+
      '<footer class="il-navigation"><span class="il-counter"></span><span class="il-page-name" aria-live="polite"></span>'+
      '<div class="il-progress" role="progressbar" aria-label="阅读进度" aria-valuemin="1" aria-valuemax="'+design.pages.length+'"><i></i></div>'+
      '<button type="button" data-layout-nav="prev" aria-label="上一屏">↑</button>'+
      '<button type="button" data-layout-nav="next" aria-label="下一屏">↓</button></footer></article>';
  }
  function mount(container,event,{index=0,onRegister,onPage,preview=false}={}) {
    const player=container.matches('.il-player')?container:container.querySelector('.il-player');
    if(!player)return null;
    const pages=(event.design||buildDesign(event)).pages;
    const stage=player.querySelector('.il-stage');
    const lifetime=new AbortController(),signal=lifetime.signal;
    const listen=(name,handler,options={})=>player.addEventListener(name,handler,{...options,signal});
    let active=-1,playing=[],current=null,touch=null,wheelSum=0,wheelAt=0,lastWheelTurn=0;
    const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stop=()=>{playing.forEach(a=>a.cancel());playing=[];};
    function drawPage(p) {
      const node=document.createElement('section');
      node.className='il-page il-canvas';node.dataset.pageId=p.id;node.setAttribute('aria-label',p.name);
      node.style.backgroundColor=color(p.background,'#ffffff');
      node.innerHTML=p.elements.map(el=>'<div class="il-element il-type-'+esc(el.type)+'" data-element-id="'+esc(el.id)+
        '" data-entry="'+inList(el.animation.type,entrances,'none')+'" style="'+elementStyle(el)+'">'+elementHTML(el,event,{preview})+'</div>').join('');
      return node;
    }
    function goTo(target,instant=false) {
      const next=Math.min(pages.length-1,Math.max(0,Math.trunc(target)||0));
      if(next===active)return;
      const old=current, forward=next>active;
      stop();stage.replaceChildren();
      const p=pages[next];current=drawPage(p);
      active=next;
      const mode=instant||reduced()?'none':inList(p.transition,transitions,'slide');
      if(old && mode!=='none'){
        old.inert=true;old.setAttribute('aria-hidden','true');
        stage.append(old,current);
        const dir=forward?1:-1;
        const a=mode==='fade'?[{opacity:0},{opacity:1}]:mode==='zoom'?
          [{opacity:.12,transform:'scale(.94)'},{opacity:1,transform:'scale(1)'}]:
          [{transform:'translateY('+dir*100+'%)'},{transform:'translateY(0%)'}];
        const b=mode==='slide'?[{transform:'translateY(0%)'},{transform:'translateY('+(-dir*100)+'%)'}]:
          [{opacity:1},{opacity:0}];
        const timing={duration:mode==='slide'?340:285,easing:'cubic-bezier(.22,.70,.23,1)'};
        const outgoing=old.animate(b,timing), incoming=current.animate(a,timing);
        playing=[outgoing,incoming];
        outgoing.onfinish=()=>old.remove();
      }else stage.append(current);
      player.querySelector('.il-counter').textContent=String(next+1).padStart(2,'0')+' / '+String(pages.length).padStart(2,'0');
      player.querySelector('.il-page-name').textContent=p.name;
      const bar=player.querySelector('.il-progress');bar.setAttribute('aria-valuenow',next+1);
      bar.firstChild.style.transform='scaleX('+((next+1)/pages.length)+')';
      player.querySelector('[data-layout-nav="prev"]').disabled=next===0;
      player.querySelector('[data-layout-nav="next"]').disabled=next===pages.length-1;
      onPage?.(next,current);
    }
    function canReadMore(node,dir) {
      const scroller=node.closest?.('.il-content');
      if(!scroller)return false;
      return dir>0?scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop>2:scroller.scrollTop>2;
    }
    listen('click',e=>{
      const action=e.target.closest('[data-layout-nav],[data-layout-register]');
      if(!action||action.disabled)return;
      if(action.hasAttribute('data-layout-register'))onRegister?.();
      else goTo(active+(action.dataset.layoutNav==='next'?1:-1));
    });
    listen('keydown',e=>{
      if(e.altKey||e.metaKey||e.ctrlKey||e.shiftKey||e.target.closest('input,textarea,select,[contenteditable=true]'))return;
      const offsets={PageDown:1,ArrowDown:1,PageUp:-1,ArrowUp:-1};
      if(Object.hasOwn(offsets,e.key)){
        if(canReadMore(e.target,offsets[e.key]))return;
        e.preventDefault();goTo(active+offsets[e.key]);
      }else if(e.key==='Home'||e.key==='End'){e.preventDefault();goTo(e.key==='Home'?0:pages.length-1);}
    });
    listen('touchstart',e=>{
      if(e.touches.length!==1||!stage.contains(e.target)||e.target.closest('input,textarea,select')){touch=null;return;}
      const t=e.touches[0];touch={x:t.clientX,y:t.clientY,up:canReadMore(e.target,1),down:canReadMore(e.target,-1)};
    },{passive:true});
    listen('touchcancel',()=>{touch=null;},{passive:true});
    listen('touchend',e=>{
      if(!touch||!e.changedTouches.length)return;
      const st=touch;touch=null;
      const dy=st.y-e.changedTouches[0].clientY,dx=st.x-e.changedTouches[0].clientX;
      if(Math.abs(dy)>36 && Math.abs(dy)>Math.abs(dx)*1.2 && !(dy>0?st.up:st.down))
        goTo(active+(dy>0?1:-1));
    },{passive:true});
    listen('wheel',e=>{
      if(e.ctrlKey||Math.abs(e.deltaX)>Math.abs(e.deltaY)||canReadMore(e.target,e.deltaY))return;
      if(!stage.contains(e.target))return;
      const now=performance.now();if(now-wheelAt>150||wheelSum*e.deltaY<0)wheelSum=0;
      const fresh=now-wheelAt>150;wheelAt=now;
      if(!fresh&&now-lastWheelTurn<500)return;
      wheelSum+=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?stage.clientHeight:1);
      if(Math.abs(wheelSum)>35){goTo(active+Math.sign(wheelSum));lastWheelTurn=now;wheelSum=0;}
    },{passive:true});
    goTo(index,true);
    return {goTo,get index(){return active;},destroy(){lifetime.abort();stop();}};
  }
  window.InviteLayout=Object.freeze({prepare,makeElement,makePage,elementHTML,elementStyle,registrationForm,
    updateRegistrationControls,render,mount});
})();
