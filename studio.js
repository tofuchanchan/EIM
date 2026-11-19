(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {
    plus:'M12 5v14M5 12h14', right:'m9 5 7 7-7 7', arrow:'M4 12h15m-6-6 6 6-6 6', diag:'M6 18 18 6M7 6h11v11',
    date:'M4 9h16M8 3v4m8-4v4M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z',
    pin:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 1 1 4 0Z',
    search:'M16.7 16.7 21 21M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
    people:'M16 20v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM17 5a3 3 0 0 1 0 6m1 3c2 0 3 2 3 4',
    copy:'M8 8h12v13H8zM16 5V3H4v13h2',edit:'m4 15-1 6 6-2L20 8l-5-5Z M12 6l5 5',
    close:'M5 5l14 14M19 5 5 19', eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    list:'M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1',
    left:'m15 5-7 7 7 7',play:'m8 5 12 7-12 7z',pause:'M9 5v14m6-14v14'
  };
  const icon = name => '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="'+paths[name]+'"/></svg>';
  const titles = {live:'报名中',upcoming:'未开始',expired:'已截止',draft:'未发布',ended:'报名已关闭',offline:'已下线'};
  const eventChangeLabels={title:'活动名称',date:'日期',time:'时间',place:'地点',detail:'基本信息',cover:'分享封面',
    blocks:'内容',design:'逐屏设计',story:'逐屏设计',fields:'报名字段',registrationUnique:'报名规则',
    registrationSchedule:'报名时间',theme:'样式',template:'模板'};
  const themes = {violet:['FUTURE TOGETHER','INNOVATION SUMMIT'],orange:['DESIGN DIALOGUES','BRAND SALON'],teal:['CITY CONNECT','PARTNER MEETUP']};
  const baseFields = () => [{key:'company',label:'企业名称',required:true},{key:'name',label:'联系人',required:true},{key:'phone',label:'手机号码',required:true}];
  const key = 'invite-studio-demo.v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = () => 'e'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  const shared=location.protocol!=='file:';
  const publicRoute=shared && /^\/(i|s)\//.test(location.pathname);
  const passwordRoute=shared && location.pathname==='/set-password';
  const params=new URLSearchParams(location.search);
  const templateGallery=shared?location.pathname==='/templates':params.get('sample')==='all';
  const styleFromUrl=shared?location.pathname.match(/^\/templates\/(archive|blueprint|salon|poster|ink|neural)$/)?.[1]:params.get('sample');
  const templateStyle=Object.hasOwn(window.ForumTemplates?.looks||{},styleFromUrl)?styleFromUrl:'';
  const fileURL=query=>location.href.split(/[?#]/)[0]+query;
  const galleryURL=()=>shared?'/templates':fileURL('?sample=all');
  const previewURL=(style,i=0)=>shared?'/templates/'+style+(i?'?page='+(i+1):''):fileURL('?sample='+style+(i?'&page='+(i+1):''));
  const useStyleURL=style=>shared?'/?use='+style:fileURL('?use='+style);
  const eventPath=eventId=>'/api/events/'+encodeURIComponent(eventId);
  let user=null, refreshOrder=0;
  const canManageMembers=()=>shared&&user?.role==='admin';
  const memberRoles={member:'普通成员',admin:'管理员'};
  const memberAccess={member:'自己创建或复制的活动',admin:'全部活动'};
  let activeVisit=null,metricPeriod='all',metricsRequest=0,recordsSince=null;
  let dataEventId=null,metricsTerm='',activityMetrics=null,editorSession=null,navigation=0;
  let clockOffset=0;
  const registrationNow=()=>Date.now()+clockOffset;
  const registrationInstant=value=>value?Date.parse(value+':00+08:00'):NaN;
  function registrationState(event,accepting=true){
    if(!accepting)return 'ended';
    const schedule=event?.registrationSchedule;
    const now=registrationNow();
    if(now<registrationInstant(schedule?.start))return 'upcoming';
    if(now>=registrationInstant(schedule?.end))return 'expired';
    return 'live';
  }
  function atNextRegistrationBoundary(events,update){
    const now=registrationNow();
    let next=Infinity;
    for(const event of events){
      for(const value of [event.registrationSchedule?.start,event.registrationSchedule?.end]){
        const time=registrationInstant(value);
        if(time>now&&time<next)next=time;
      }
    }
    return Number.isFinite(next)?setTimeout(update,Math.min(2147483647,Math.ceil(next-now))):null;
  }
  async function request(url,method='GET',data){
    const options={method,credentials:'same-origin',cache:'no-store'};
    if(data!==undefined){
      options.headers={'Content-Type':'application/json'};
      options.body=JSON.stringify(data);
    }
    const response=await fetch(url,options);
    const serverTime=Number(response.headers.get('X-Invite-Server-Time'));
    if(Number.isSafeInteger(serverTime)&&serverTime>0)clockOffset=serverTime-Date.now();
    const result=await response.json().catch(()=>({}));
    if(!response.ok){
      if(response.status===401 && user && !publicRoute){
        showLogin(false,'登录已失效，请重新登录。');
      }
      throw Object.assign(new Error(result.error||'请求未完成，请重试。'),{status:response.status});
    }
    const accepting=response.headers.get('X-Invite-Registration-Enabled');
    if(accepting!==null)result.registrationAccepting=accepting==='1';
    return result;
  }
  async function refreshWorkspace(){
    const order=++refreshOrder;
    const data=await request('/api/workspace');
    if(order===refreshOrder && user){
      db=data;
      user=data.user??user;
      $('[data-nav="members"]').hidden=!canManageMembers();
    }
  }
  const mayReadRecords=eventId=>!shared || db.recordEventIds.includes(eventId);
  function historicalExample(){
    return {
      id:'caiyun2025', title:'中兴新云·财云系统合伙人大会', theme:'teal', status:'ended',
      version:1, template:'agenda', date:'2025-02-27', time:'14:00', place:'深圳 · 南山区金融科技大厦',
      detail:'承办单位：深圳市中兴新云服务有限公司、中邦（深圳）数字信息服务有限公司。',
      blocks:[
        {id:'schedule',type:'agenda',title:'大会议程（节选）',body:'14:00–14:30 嘉宾签到入场\n14:30–14:40 领导致欢迎词\n14:40–15:00 中邦数字分享'},
        {id:'venue',type:'notice',title:'会场地址',body:'深圳市南山区高新中区科苑大道8号金融科技大厦。原邀请函未给出具体楼层。'}
      ],
      fields:[
        {key:'name',label:'联系人姓名',required:false},{key:'company',label:'单位',required:false},
        {key:'phone',label:'电话',required:false},{key:'attendees',label:'参会人数',required:false}
      ],cover:''
    };
  }
  function seed(){
    const events = [
      {id:'future',title:'未来协作创新峰会',theme:'violet',date:'2026-12-12',place:'上海 · 西岸艺术中心',status:'live',detail:'与企业创新负责人、设计师及产业伙伴相聚上海，共同探讨跨组织协作的下一步。\n\n13:30 入场签到\n14:00 主题分享\n15:30 企业圆桌\n16:30 自由交流'},
      {id:'design',title:'品牌设计沙龙',theme:'orange',date:'2026-12-19',place:'杭州 · 天目里',status:'draft',detail:'围绕品牌表达与设计实践，邀请团队分享项目经验。\n\n14:00 开场分享\n15:00 设计对谈'}
    ].map((e,i)=>{
      const [intro,agenda]=e.detail.split('\n\n');
      return {...e, detail:intro, version:1, template:['classic','editorial','agenda'][i],
        blocks:agenda?[{id:'schedule',type:'agenda',title:'活动议程',body:agenda}]:[],
        fields:baseFields(),cover:''};
    });
    events.push(historicalExample());
    const rows = [['future','陈屿','远景创新','15:42'],['future','沈宁','序方设计','14:18'],['future','周遥','山海科技','11:06']].map(([eventId,name,company,time],i)=>({id:'r'+i,eventId,at:'2026-11-18T'+time+':00',values:{name,company,phone:'1380000000'+i},fields:baseFields()}));
    return {events,rows,published:Object.fromEntries(events.filter(e=>e.status!=='draft').map(e=>[e.id,clone(e)]))};
  }
  function normalize(event){
    return {version:1,template:'classic',blocks:[],time:'',...event};
  }
  function readDatabase(){
    const raw=localStorage.getItem(key);
    const data=raw===null?seed():JSON.parse(raw);
    if(!Array.isArray(data.events)||!Array.isArray(data.rows)||!data.published) throw new Error('本机活动数据无法读取。');
    if(data.covers){
      for(const event of [...data.events,...Object.values(data.published)]){
        if(Number.isInteger(event.cover))event.cover=data.covers[event.cover];
      }
      delete data.covers;
    }
    data.events=data.events.map(normalize);
    data.published=Object.fromEntries(Object.entries(data.published).map(([id,e])=>[id,normalize(e)]));
    if(!data.events.some(e=>e.id==='caiyun2025')){
      const example=historicalExample();data.events.push(example);data.published[example.id]=clone(example);
    }
    return data;
  }
  let db;
  if(!shared){try{db=readDatabase();}catch{db=seed();}}
  let filter='all',term='',recordTerm='',currentPage='home',messageTimer;
  const libraryPageSize=6;
  let libraryPage=1,libraryView='cards',spotlightId=null,spotlightTimer=null;
  let registrationRefreshTimer=null;
  let spotlightPaused=matchMedia('(prefers-reduced-motion: reduce)').matches;
  try{if(localStorage.getItem('invite-studio.library-view')==='list')libraryView='list';}catch{}
  const storeName='studio';
  const storeKey=location.protocol==='file:'?location.pathname:'workspace';
  const changesChannel=!shared && typeof BroadcastChannel==='function'?new BroadcastChannel(key+storeKey):null;
  const connection=shared?null:new Promise((resolve,reject)=>{
    const request=indexedDB.open('invite-studio-drafts-v2',1);
    request.onupgradeneeded=()=>request.result.createObjectStore(storeName);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  async function transact(change){
    const database=await connection;
    return new Promise((resolve,reject)=>{
      const transaction=database.transaction(storeName,change?'readwrite':'readonly');
      const store=transaction.objectStore(storeName);
      const request=store.get(storeKey);
      let next,result,error;
      request.onsuccess=()=>{
        try{
          next=request.result||readDatabase();
          if(change){
            // Read the latest version, compare and commit inside one serialized transaction.
            result=change(next);
            store.put(next,storeKey);
          }
        }catch(reason){error=reason;transaction.abort();}
      };
      transaction.onabort=()=>reject(error||transaction.error||new Error('本机草稿保存失败。'));
      transaction.oncomplete=()=>{
        db=next;
        if(change)changesChannel?.postMessage('updated');
        resolve(result);
      };
    });
  }
  async function current(eventId){
    if(shared)return request(eventPath(eventId));
    await transact();
    const event=db.events.find(e=>e.id===eventId);
    if(!event)throw new Error('活动不存在。');
    return clone(event);
  }
  async function save(event,publish=false,sourceId,expectedRevision){
    const entry=normalize(clone(event));
    if(shared){
      const url=entry.version===0?'/api/events':eventPath(entry.id)+(publish?'/publish':'');
      const saved=await request(url,(publish||entry.version===0)?'POST':'PUT',{event:entry,sourceId,expectedRevision});
      acceptSaved(saved,publish);
      return saved;
    }
    return transact(next=>{
      const index=next.events.findIndex(e=>e.id===entry.id), previous=next.events[index];
      if(previous && previous.version!==entry.version) throw new Error('草稿版本已更新，请载入最新草稿后再编辑。');
      if(!previous && event.version!==0) throw new Error('活动不存在，请重新打开活动库。');
      const changed=previous && Object.keys(eventChangeLabels).some(k=>JSON.stringify(entry[k])!==JSON.stringify(previous[k]));
      entry.version=previous?previous.version+Number(Boolean(changed)):1;
      if(publish){
        const seen={phone:new Set(),wechat:new Set()};
        for(const row of next.rows.filter(r=>r.eventId===entry.id)){
          for(const [kind,key] of Object.entries(entry.registrationUnique||{})){
            if(!key||!row.values[key]?.trim())continue;
            const value=historicalIdentity(kind,row.values[key]);
            if(!value)continue;
            if(seen[kind].has(value))throw Error('历史报名中存在重复的'+identityLabels[kind]+'，请调整规则后再发布。');
            seen[kind].add(value);
          }
        }
        entry.status='live';next.published[entry.id]=clone(entry);
      }
      else if(previous)entry.status=previous.status;
      if(previous)next.events[index]=entry;else next.events.unshift(entry);
      return clone(entry);
    });
  }
  const identityLabels={phone:'手机号',wechat:'微信号'};
  function historicalIdentity(kind,raw){
    try{return identityValue(kind,raw);}catch{return null;}
  }
  function identityValue(kind,raw){
    const value=String(raw||'').normalize('NFKC').trim();
    if(kind==='phone'){
      let number=value.replace(/[\s()-]/g,'').replace(/^00/,'+');
      if(/^\+861\d{10}$/.test(number))number=number.slice(3);
      if(!/^\+?\d{7,15}$/.test(number))throw Error('请输入有效的手机号。');
      return number;
    }
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(value))throw Error('微信号请使用字母、数字、下划线或短横线。');
    return value.toLowerCase();
  }
  function register(event,values,requestId){
    if(shared)return request('/api/public/'+encodeURIComponent(event.id)+'/registrations','POST',{version:event.version,values,requestId,...(activeVisit?{visit:activeVisit.payload()}:{})});
    return transact(next=>{
      const live=next.published[event.id];
      if(!live||live.status!=='live') throw new Error('本活动当前未开放报名。');
      if(live.version!==event.version) throw new Error('邀请函已更新，请重新打开后报名。');
      const rows=next.rows.filter(r=>r.eventId===event.id);
      const prior=requestId&&rows.find(r=>r.requestId===requestId);
      if(prior&&prior.version===event.version&&JSON.stringify(prior.values)===JSON.stringify(values))return true;
      if(prior)throw Error('这次提交已处理，请重新打开邀请函。');
      const state=registrationState(live);
      if(state!=='live')throw Error(state==='upcoming'?'报名尚未开始。':'报名已截止。');
      for(const [kind,key] of Object.entries(live.registrationUnique||{})){
        if(!key)continue;
        const identity=identityValue(kind,values[key]);
        if(rows.some(r=>historicalIdentity(kind,r.values[key])===identity)){
          throw Error('该'+identityLabels[kind]+'已报名本场活动。');
        }
      }
      next.rows.unshift({id:id(),eventId:event.id,at:new Date().toISOString(),requestId,version:event.version,fields:clone(live.fields),values:clone(values)});
      return true;
    });
  }
  function acceptSaved(event,published=false){
    refreshOrder++;
    const index=db.events.findIndex(e=>e.id===event.id);
    if(index>=0)db.events[index]=event;
    else{
      db.events.unshift(event);
      if(user && db.eventPeople)db.eventPeople[event.id]={creator:user.username};
      if(db.publications)db.publications[event.id]={shortCode:null,online:false,accepting:false,revision:0,canManage:true};
      if(!db.recordEventIds.includes(event.id))db.recordEventIds.push(event.id);
    }
    if(published)db.published[event.id]=clone(event);
  }
  function toast(msg){clearTimeout(messageTimer);$('#studio-toast').textContent=msg;messageTimer=setTimeout(()=>$('#studio-toast').textContent='',3500);}
  function showLogin(setup=false,note=''){
    user=null;db=null;refreshOrder++;
    clearTimeout(registrationRefreshTimer);
    discardEditor();stopSpotlight();
    $('.topbar').hidden=false;
    $('.topbar nav').hidden=true;
    $('.identity').textContent='';
    document.querySelectorAll('dialog[open]').forEach(node=>node.close());
    document.querySelectorAll('.ze-layer,.s-dialog').forEach(node=>{node.stopRegistrationTimer?.();node.remove();});
    document.documentElement.classList.remove('ze-open');
    $('#workspace').innerHTML='<section class="auth-card"><h1>'+(setup?'创建管理员账号':'登录活动工作台')+'</h1><p>'+(setup?'首次使用，创建管理本工作台的账号。':'使用团队账号进入活动库。')+'</p>'+
      '<form id="team-login"><label>用户名<input name="username" autocomplete="username" required maxlength="64"></label>'+
      '<label>密码<input name="password" type="password" autocomplete="'+(setup?'new-password':'current-password')+'" '+(setup?'minlength="10" placeholder="至少 10 个字符" ':'')+'required maxlength="256"></label>'+
      '<div class="auth-error" role="alert">'+esc(note)+'</div><button class="s-btn primary" type="submit">'+(setup?'创建账号并登录':'登录')+'</button></form></section>';
    const form=$('#team-login');
    form.onsubmit=async ev=>{
      ev.preventDefault();
      const button=form.querySelector('button');
      if(button.disabled)return;
      button.disabled=true;
      try{
        const values=Object.fromEntries(new FormData(form));
        const session=await request('/api/'+(setup?'setup':'login'),'POST',values);
        await enterWorkspace(session.user);
      }catch(error){
        if(!user)form.querySelector('[role=alert]').textContent=error.message;
        else showFailure(error);
      }finally{button.disabled=false;}
    };
  }
  function showSetPassword(){
    const fragment=new URLSearchParams(location.hash.slice(1));
    const token=fragment.get('token_hash'),type=fragment.get('setup_type');
    history.replaceState(null,'',location.pathname);
    const host=$('#workspace');
    if(!/^[0-9a-f]{64}$/.test(token||'')||!['invite','recovery'].includes(type)){
      host.innerHTML='<section class="auth-card"><h1>链接不可用</h1><p>请使用管理员发送的完整链接。</p><a class="s-btn" href="/">返回登录</a></section>';
      return;
    }
    const title=type==='recovery'?'重置密码':'设置登录密码';
    document.title=title+' · EIM';
    host.innerHTML='<section class="auth-card"><h1>'+title+'</h1><p>设置后，用管理员告知的用户名和新密码登录。</p>'+
      '<form><label>新密码<input type="password" name="password" autocomplete="new-password" required minlength="10" maxlength="256"></label>'+
      '<label>确认新密码<input type="password" name="confirmation" autocomplete="new-password" required minlength="10" maxlength="256"></label>'+
      '<div class="auth-error" role="alert"></div><button class="s-btn primary" type="submit">保存密码</button></form></section>';
    const form=host.querySelector('form'),button=form.querySelector('button'),error=form.querySelector('[role=alert]');
    form.onsubmit=async event=>{
      event.preventDefault();
      if(button.disabled)return;
      const {password,confirmation}=Object.fromEntries(new FormData(form));
      if(password!==confirmation){error.textContent='两次输入的密码不一致。';return;}
      error.textContent='';button.disabled=true;
      try{
        await request('/api/set-password','POST',{password,token,type});
        form.reset();
        host.innerHTML='<section class="auth-card"><h1>密码已设置</h1><p>现在可以使用新密码登录 EIM。</p><a class="s-btn primary" href="/">去登录</a></section>';
      }catch(err){error.textContent=err.message;}
      finally{button.disabled=false;}
    };
  }
  async function checkSession(){
    const active=user;
    if(!active||document.hidden)return;
    try{
      const session=await request('/api/session');
      if(user===active&&!session.user)showLogin(false,'登录已失效，请重新登录。');
    }catch{}
  }
  function showFailure(error){
    $('#workspace').innerHTML='<section class="auth-card"><h1>'+(publicRoute?'无法打开邀请函':'无法载入工作台')+'</h1><p>'+esc(error.message)+'</p>'+action('重试','retry',null,'s-btn')+'</section>';
  }
  async function enterWorkspace(member){
    user=member;
    await refreshWorkspace();
    $('.topbar').hidden=false;
    $('.topbar nav').hidden=false;
    $('.identity').innerHTML=memberAvatar(member.username)+'<span class="team-name">'+esc(member.username)+'</span>'+action('退出','logout',null,'mini-link');
    route();
    openRequestedStyle();
  }
  function openRequestedStyle(){
    const key=new URLSearchParams(location.search).get('use');
    if(!Object.hasOwn(window.ForumTemplates.looks,key))return;
    history.replaceState(null,'',location.pathname+location.hash);
    newEvent(null,key);
  }
  function pageThumbnail(event,index){
    const p=event.design.pages[index];
    return '<div class="gallery-mini il-canvas" aria-hidden="true" style="background:'+p.background+'">'+
      p.elements.map(e=>'<div class="il-element" style="'+esc(window.InviteLayout.elementStyle(e))+'">'+window.InviteLayout.elementHTML(e,event,{editor:true})+'</div>').join('')+'</div>';
  }
  function showStyleGallery(){
    $('.topbar').hidden=false;$('.topbar nav').hidden=true;
    const homeURL=shared?'/':fileURL('');
    $('.brand').href=homeURL;
    $('.identity').innerHTML='<a class="s-btn" href="'+esc(homeURL)+'">返回工作台</a>';
    const looks=window.ForumTemplates.looks;
    const samples=Object.entries(looks).map(([key,look])=>({key,look,event:window.ForumTemplates.sample(key)}));
    document.title='模板库 · EIM';
    $('#workspace').innerHTML=heading('模板库','中邦财智伙伴会 · 六套可直接使用的七页模板。')+
      '<label class="gallery-compare">对比同一页<select aria-label="对比同一页">'+samples[0].event.design.pages.map((p,i)=>
        '<option value="'+i+'">'+String(i+1).padStart(2,'0')+' · '+esc(p.name)+'</option>').join('')+'</select></label><section class="gallery-grid"></section>';
    function draw(i){
      $('.gallery-grid').innerHTML=samples.map(({key,look,event})=>
        '<article class="gallery-card"><a href="'+esc(previewURL(key,i))+'" class="gallery-art" aria-label="预览'+esc(look.name)+'">'+pageThumbnail(event,i)+'</a>'+
        '<div class="gallery-body"><h2>'+esc(look.name)+'</h2><p>'+esc(look.description)+'</p><div><a class="s-btn" href="'+esc(previewURL(key,i))+'">预览七页</a><a class="s-btn primary" href="'+esc(useStyleURL(key))+'">使用此款</a></div></div></article>').join('');
    }
    const compareSelect=$('.gallery-compare select');
    const requested=Number(params.get('page')||1)-1;
    const initial=Number.isInteger(requested)&&requested>=0&&requested<samples[0].event.design.pages.length?requested:0;
    compareSelect.value=String(initial);draw(initial);
    compareSelect.onchange=e=>{
      const i=Number(e.target.value);
      if(shared){
        const url=new URL(location.href);
        if(i)url.searchParams.set('page',String(i+1));else url.searchParams.delete('page');
        history.replaceState(null,'',url);
      }
      draw(i);
    };
  }
  async function renderRoute(){
    if(publicRoute||templateStyle||templateGallery||passwordRoute||(shared&&!user))return;
    const serial=++navigation;
    const editor=editorSession;
    if(editor){
      if(location.hash===editor.hash)return;
      const allowed=await editor.canLeave();
      if(serial!==navigation)return;
      if(!allowed){history.replaceState(null,'',editor.hash);return;}
      discardEditor();
    }
    try{
      if(shared)await refreshWorkspace();
      if(serial===navigation&&(!shared||user))route();
    }catch(error){if(user)toast(error.message);}
  }
  const publicationPath=id=>eventPath(id)+'/publication';
  const lifecycleLabels={close:'关闭报名',open:'重新开放报名',offline:'下线邀请函',restore:'恢复上线'};
  const displaySignupTime=value=>value?value.replace('T',' '):'';

  async function getPublication(id){
    const info=await request(publicationPath(id));
    if(db?.publications){
      const {published,...state}=info;
      db.publications[id]=state;
      if(published)db.published[id]=published;
      scheduleWorkspaceRegistrationRefresh();
    }
    return info;
  }
  function shareLink(event,info,justPublished=false){
    const url=info.url;
    const actions=info.canManage&&url?(info.online
      ?[info.accepting?'close':'open','offline']:['restore']):[];
    const controls=actions.map(op=>'<button class="s-btn" type="button" data-op="publication-control" data-id="'+esc(event.id)+'" data-lifecycle="'+op+'">'+lifecycleLabels[op]+'</button>').join('');
    const share=info.online&&url?'<label class="share-link">活动短链接<input value="'+esc(url)+'" readonly></label>':'';
    const note=info.publicOriginConfigured?'':'<p class="s-desc">正式域名待配置。请用公网 HTTPS 地址生成对外链接。</p>';
    const wechat=info.wechatConfigured?'公众号参数已配置，微信卡片待接入。':'微信公众号配置已预留。';
    const headingText=justPublished?(info.online?'发布成功':'发布版已更新'):'发布与分享';
    const schedule=info.published?.registrationSchedule;
    const windowDetails=schedule&&(schedule.start||schedule.end)?'<p class="s-desc">报名时间（北京时间） '+
      esc(displaySignupTime(schedule.start)||'发布后')+' 至 '+esc(displaySignupTime(schedule.end)||'手动关闭')+'</p>':'';
    const body='<div class="publication-dialog-status" data-registration-badge="'+esc(event.id)+'">'+badge(event)+'</div>'+windowDetails+share+note+
      '<p class="s-desc">'+wechat+'</p>'+(controls?'<div class="publication-controls">'+controls+'</div>':'');
    return dialog(headingText,body,info.online&&url?
      '<div class="dlg-footer"><a class="s-btn" href="'+esc(eventPath(event.id)+'/qr')+'" download>下载二维码</a>'+
      '<a class="s-btn" href="'+esc(url)+'" target="_blank" rel="noopener">打开访客页</a>'+action('复制链接','clipboard','copy','s-btn primary')+'</div>':'');
  }
  async function confirmedPublication(event){
    const info=await getPublication(event.id);
    if(!info.canManage)throw new Error('仅活动创建人和管理员可以发布。');
    const previous=info.published;
    const changes=previous?Object.entries(eventChangeLabels)
      .filter(([key])=>JSON.stringify(previous[key])!==JSON.stringify(event[key])).map(([,label])=>label):[];
    const fieldSummary=event.fields.map(field=>esc(field.label)+(field.required?'（必填）':'')).join('、');
    const rules=Object.entries(event.registrationUnique||{}).filter(([,key])=>key)
      .map(([key])=>({phone:'手机号',wechat:'微信号'})[key]).filter(Boolean).join('、');
    const cover=event.cover?'<img class="publish-cover" src="'+esc(event.cover)+'" alt="分享封面">':'<span>未设置分享封面</span>';
    const schedule=event.registrationSchedule||{}, priorSchedule=previous?.registrationSchedule||{};
    const reference=previous?[
      ['原活动名称',previous.title,event.title],
      ['原时间',[previous.date,previous.time].filter(Boolean).join(' '),[event.date,event.time].filter(Boolean).join(' ')],
      ['原地点',previous.place,event.place],
      ['原报名开始',displaySignupTime(priorSchedule.start)||'发布后',displaySignupTime(schedule.start)||'发布后'],
      ['原报名截止',displaySignupTime(priorSchedule.end)||'手动关闭',displaySignupTime(schedule.end)||'手动关闭']
    ].filter(([,before,after])=>before!==after)
      .map(([label,before])=>'<dt>'+label+'</dt><dd>'+esc(before||'未填写')+'</dd>').join(''):'';
    const body='<dl class="reg-details publish-review"><dt>活动</dt><dd>'+esc(event.title)+'</dd><dt>时间</dt><dd>'+
      esc([event.date,event.time].filter(Boolean).join(' '))+'</dd><dt>地点</dt><dd>'+esc(event.place)+'</dd><dt>分享封面</dt><dd>'+
      cover+'</dd><dt>报名开始</dt><dd>'+esc(schedule.start?displaySignupTime(schedule.start)+'（北京时间）':'发布后')+
      '</dd><dt>报名截止</dt><dd>'+esc(schedule.end?displaySignupTime(schedule.end)+'（北京时间）':'手动关闭')+
      '</dd><dt>报名字段</dt><dd>'+fieldSummary+'</dd><dt>限报规则</dt><dd>'+esc(rules?rules+'每场限报一次':'不限同一联系方式')+'</dd>'+reference+'</dl>'+
      (previous?'<p class="s-desc"><strong>相对发布版</strong> '+esc([...new Set(changes)].join('、')||'内容一致')+'</p>':'')+
      (previous&&!info.online?'<p class="publication-notice">本次更新保存到发布版，活动仍处于下线状态。</p>':'')+
      (previous&&info.online&&!info.accepting?'<p class="publication-notice">本次更新后，报名继续保持关闭。</p>':'');
    const dlg=dialog(previous?'确认更新发布版':'确认发布',body,
      '<div class="dlg-footer">'+action('取消','dismiss')+'<button type="button" class="s-btn primary" data-publish-approve>确认发布</button></div>');
    return new Promise(resolve=>{
      dlg.addEventListener('close',()=>resolve(dlg.returnValue==='publish'?info:null),{once:true});
      dlg.querySelector('[data-publish-approve]').onclick=()=>dlg.close('publish');
      dlg.querySelector('.dlg-footer [data-op=dismiss]').focus();
    });
  }
  async function changePublication(event,operation){
    const info=await getPublication(event.id);
    if(!info.canManage)throw new Error('仅活动创建人和管理员可以管理发布。');
    const scheduledState=registrationState(info.published);
    const resumeText=scheduledState==='upcoming'?'将按已发布的开始时间自动开放报名。':
      scheduledState==='expired'?'报名时间已经截止。':'访客可以继续提交新的报名。';
    const text={close:'访客仍可浏览邀请函，已有报名和统计会保留。',
      open:resumeText,offline:'访客打开原短链接会看到下线提示，已有数据会保留。',
      restore:'原短链接会重新开放浏览。'+(info.accepting?resumeText:'报名保持关闭。')};
    const label=lifecycleLabels[operation];
    if(!await window.StudioControls.confirm(label+'？'+text[operation],label,'取消'))return;
    db.publications[event.id]=await request(publicationPath(event.id),'PATCH',{operation,expectedRevision:info.revision});
    document.querySelector('#modal-host dialog')?.close();
    if(editorSession){
      const slot=$('.event-publication-status');
      if(slot)slot.innerHTML=badge(event);
    }else route();
    shareLink(event,await getPublication(event.id));
  }
  async function afterPublish(event){
    try{
      const info=await getPublication(event.id);
      home();
      shareLink(event,info,true);
    }catch{
      if(!user)return;
      home();
      toast('发布版已更新，可在活动库查看分享链接。');
    }
  }
  async function startShared(){
    try{
      if(publicRoute){
        $('.topbar').hidden=true;
        const eventId=$('meta[name="invite-event"]')?.content||decodeURIComponent(location.pathname.slice(3));
        const event=await request('/api/public/'+encodeURIComponent(eventId));
        activeVisit=window.EventData.tracker(event.id);
        document.title=event.title+' · 活动邀请函';
        $('#workspace').innerHTML='';
        window.launchInvite(event);
      }else{
        const session=await request('/api/session');
        if(session.user)await enterWorkspace(session.user);
        else showLogin(session.setupRequired);
      }
    }catch(error){showFailure(error);}
  }
  function poster(e){
    const theme=themes[e.theme]?e.theme:'violet',english=e.id==='caiyun2025'||e.title.includes('财云系统')?['PARTNER CONFERENCE']:themes[theme];
    if(e.cover && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(e.cover))return '<div class="s-poster"><img class="uploaded-cover" src="'+esc(e.cover)+'" alt="'+esc(e.title)+'活动封面"></div>';
    const breaks={'未来协作创新峰会':'未来协作<br>创新峰会','品牌设计沙龙':'品牌设计<br>沙龙','城市伙伴见面会':'城市伙伴<br>见面会'};
    return '<div class="s-poster '+theme+'">'+window.posterArt(theme)+'<div class="p-type"><small>'+english[0]+' / '+esc(e.date.slice(0,4))+'</small><b>'+(Object.hasOwn(breaks,e.title)?breaks[e.title]:esc(e.title))+'</b><footer>'+esc(e.date.replaceAll('-','.'))+'</footer></div></div>';
  }
  function eventAvailability(e){
    const state=db?.publications?.[e.id];
    const published=db?.published?.[e.id];
    if(!shared||!state)return published?.status==='live'?registrationState(published):e.status;
    if(!state.shortCode)return 'draft';
    if(!state.online)return 'offline';
    return registrationState(published,state.accepting);
  }
  function scheduleWorkspaceRegistrationRefresh(){
    clearTimeout(registrationRefreshTimer);
    if(!db)return;
    const events=Object.values(db.published).filter(event=>{
      if(!shared)return event.status==='live';
      const info=db.publications?.[event.id];
      return info?.online&&info.accepting;
    });
    registrationRefreshTimer=atNextRegistrationBoundary(events,refreshWorkspaceRegistration);
  }
  function refreshWorkspaceRegistration(){
    if(!db)return;
    const homeSpotlight=$('.focus-row');
    if(currentPage==='home'&&homeSpotlight){
      stopSpotlight();
      homeSpotlight.firstElementChild.outerHTML=spotlight();
      bindSpotlight();
      document.querySelectorAll('.tab-group [data-filter] small').forEach(count=>{
        count.textContent=filteredCount(count.parentElement.dataset.filter);
      });
      movePill();
      renderTiles();
    }else if(currentPage==='records'&&!dataEventId){
      renderActivityData();
    }
    document.querySelectorAll('[data-registration-badge]').forEach(slot=>{
      const event=db.events.find(e=>e.id===slot.dataset.registrationBadge);
      if(event)slot.innerHTML=badge(event);
    });
    scheduleWorkspaceRegistrationRefresh();
  }
  function badge(e){
    const availability=eventAvailability(e);
    const label='<span class="badge '+(['offline','expired'].includes(availability)?'ended':availability)+'">'+esc(titles[availability])+'</span>';
    const published=db?.published[e.id];
    if(!shared||!published)return label;
    const pending=e.version!==published.version;
    const revision=pending?'<span class="badge draft">有待发布修改</span>':
      availability==='offline'?'':'<span class="badge published">已发布</span>';
    return '<span class="event-badges">'+label+revision+'</span>';
  }
  function heading(title,sub,action=''){return '<div class="section-head"><div><h1 class="s-heading">'+title+'</h1><p class="s-desc">'+sub+'</p></div>'+action+'</div>';}
  function action(text,op,ico,classes='s-btn',eid=''){return '<button type="button" class="'+classes+'" data-op="'+op+'" data-id="'+esc(eid)+'">'+(ico?icon(ico):'')+text+'</button>';}
  function fieldSearch(value,placeholder){
    return '<div class="field-search">'+icon('search')+'<input type="search" aria-label="'+placeholder+'" placeholder="'+placeholder+'" value="'+esc(value)+'">'+
      '<button type="button" data-op="clear-search" aria-label="清除搜索">'+icon('close')+'</button></div>';
  }
  function featuredEvents(){
    const published=db.events.map(event=>db.published[event.id]).filter(event=>event&&eventAvailability(event)!=='offline');
    const accepting=published.filter(event=>eventAvailability(event)==='live');
    return accepting.length?accepting:[published[0]||db.events[0]].filter(Boolean);
  }
  function stopSpotlight(){
    clearTimeout(spotlightTimer);
    spotlightTimer=null;
  }
  function scheduleSpotlight(){
    stopSpotlight();
    const card=$('#home-spotlight');
    if(!card||featuredEvents().length<2||spotlightPaused||document.hidden||editorSession||document.querySelector('dialog[open]'))return;
    if(card.matches(':hover')||card.contains(document.activeElement))return;
    spotlightTimer=setTimeout(()=>stepSpotlight(1),5500);
  }
  function stepSpotlight(offset){
    const events=featuredEvents();
    if(!events.length)return;
    const index=events.findIndex(e=>e.id===spotlightId);
    spotlightId=events[(index+offset+events.length)%events.length]?.id;
    paintSpotlight(true);
  }
  function paintSpotlight(animate=false){
    const card=$('#home-spotlight');if(!card)return;
    const events=featuredEvents();
    const index=Math.max(0,events.findIndex(e=>e.id===spotlightId));
    const e=events[index];if(!e)return;
    spotlightId=e.id;
    const availability=eventAvailability(e);
    const editable=availability==='draft'||availability==='offline';
    card.querySelector('.spot-slide').innerHTML='<div class="spot-slide-body '+(animate?'spot-swap':'')+'">'+
      (e.cover?'<img class="spot-cover" src="'+esc(e.cover)+'" alt="">':window.posterArt(e.theme))+
      '<div class="spot-content"><div class="spot-kicker">'+titles[availability]+'</div><h2>'+esc(e.title)+'</h2>'+
      '<div class="s-meta"><span>'+icon('date')+esc([e.date.replaceAll('-','.'),e.time].filter(Boolean).join(' ')||'日期待定')+'</span><span>'+icon('pin')+esc(e.place||'地点待定')+'</span>'+(shared?'<span>'+icon('people')+'创建人 '+esc(creatorName(e.id))+'</span>':'')+'</div><div class="spot-links">'+
      action(editable?'编辑邀请函':'查看邀请函 '+icon('diag'),editable?'edit':'invite',null,'s-btn',e.id)+'</div></div></div>';
    card.querySelectorAll('[data-spot-index]').forEach((dot,i)=>dot.setAttribute('aria-current',String(i===index)));
    const counter=card.querySelector('.spot-position');
    if(counter)counter.textContent=(index+1)+' / '+events.length;
    scheduleSpotlight();
  }
  function spotlight(){
    const events=featuredEvents();
    if(!events.length)return '<section class="stats"><h2>创建第一场活动</h2>'+action('新建活动','new','plus','s-btn')+'</section>';
    function spotButton(label,op,glyph){
      return '<button type="button" class="spot-btn" data-op="'+op+'" aria-label="'+label+'" title="'+label+'">'+icon(glyph)+'</button>';
    }
    return '<section class="spotlight" id="home-spotlight" aria-label="精选活动"><div class="spot-slide"></div>'+
      (events.length>1?'<div class="spot-nav">'+
        spotButton('上一场活动','spot-prev','left')+
        (events.length<=8?'<div class="spot-dots">'+events.map((e,i)=>'<button type="button" data-op="spot-go" data-spot-index="'+i+'" aria-label="查看第 '+(i+1)+' 场 · '+esc(e.title)+'"></button>').join('')+'</div>':'')+
        '<span class="spot-position"></span>'+spotButton('下一场活动','spot-next','right')+
        spotButton(spotlightPaused?'播放轮播':'暂停轮播','spot-toggle',spotlightPaused?'play':'pause')+'</div>':'')+'</section>';
  }
  document.addEventListener('visibilitychange',scheduleSpotlight);

  function filteredCount(value){
    return value==='all'?db.events.length:db.events.filter(e=>eventAvailability(e)===value).length;
  }
  function bindSpotlight(){
    const featured=$('#home-spotlight');
    if(!featured)return;
    featured.addEventListener('mouseenter',stopSpotlight);
    featured.addEventListener('mouseleave',scheduleSpotlight);
    featured.addEventListener('focusin',stopSpotlight);
    featured.addEventListener('focusout',()=>requestAnimationFrame(scheduleSpotlight));
    paintSpotlight();
  }
  function showHome(){
    stopSpotlight();
    const rows=db.rows.slice().sort((a,b)=>new Date(b.at)-new Date(a.at));
    const recent=rows.slice(0,3).map(r=>'<div class="recent-person"><span class="initial">'+esc((r.values.name||r.values.company||'企').slice(0,1))+'</span><div><strong>'+esc(r.values.company||'企业报名')+'</strong><small>'+esc(r.values.name||'参与者')+' · '+esc(db.events.find(e=>e.id===r.eventId)?.title||'活动')+'</small></div><time>'+esc(new Date(r.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Shanghai'}))+'</time></div>').join('');
    $('#workspace').innerHTML=heading('活动工作台','创建邀请函、复用往期活动，查看企业报名。','<div class="s-actions"><a class="s-btn" href="'+esc(galleryURL())+'">模板库</a>'+action('新建活动','new','plus','s-btn primary')+'</div>')+
      '<div class="focus-row">'+spotlight()+
      '<section class="stats"><div class="stats-head"><h2>报名动态</h2>'+action('查看全部 '+icon('right'),'records',null,'mini-link')+'</div><div class="stats-counts"><div class="stats-counter">'+rows.length+'<small>份可查看的报名</small></div></div><div class="recent-list">'+(recent||'<p class="s-desc">暂无报名记录</p>')+'</div></section></div>'+
      '<section class="library"><div class="section-head"><h2>活动库</h2></div><div class="controls"><div class="tab-group" aria-label="活动状态"><span class="motion-pill" aria-hidden="true"></span>'+
      ['all','upcoming','live','expired','draft','ended',...(shared?['offline']:[])].map(v=>'<button type="button" data-filter="'+v+'" aria-pressed="'+(v===filter)+'">'+
        (v==='all'?'全部活动':titles[v])+' <small>'+filteredCount(v)+'</small></button>').join('')+'</div>'+
      '<div class="library-tools">'+fieldSearch(term,'搜索活动名称')+'<div class="view-switch" aria-label="活动库视图"><span class="motion-pill" aria-hidden="true"></span>'+
      [['cards','卡片','grid'],['list','列表','list']].map(([value,label,glyph])=>'<button type="button" data-op="library-view" data-view="'+value+'" aria-pressed="'+(value===libraryView)+'">'+icon(glyph)+label+'</button>').join('')+'</div></div></div><div id="tile-list"></div><div id="library-paging"></div></section>';
    bindSpotlight();
    movePill();renderTiles();
  }
  function movePill(){
    for(const group of document.querySelectorAll('.tab-group,.view-switch')){
      const selected=group.querySelector('[aria-pressed="true"]');if(!selected)continue;
      const left=selected.offsetLeft,last=Number(group.dataset.last??left);
      group.dataset.motionDirection=left<last?'left':'right';group.dataset.last=left;
      group.style.setProperty('--motion-pill-left',left+'px');
      group.style.setProperty('--motion-pill-right',(group.clientWidth-left-selected.offsetWidth)+'px');
    }
  }
  window.addEventListener('resize',movePill);
  const recordsCount=e=>db.rows.filter(r=>r.eventId===e.id).length;
  function eventActions(e){
    return action('编辑活动','edit','edit','card-action',e.id)+action('复制为新一期','copy','copy','card-action',e.id)+
      (shared&&mayReadRecords(e.id)?action('活动数据','event-data','people','card-action',e.id):'')+
      (shared&&db.published[e.id]?action(eventAvailability(e)==='offline'?'发布管理':'分享链接','share','diag','card-action',e.id):'');
  }
  function cards(items){
    return '<div class="tiles">'+items.map(e=>'<article class="tile"><button class="tile-preview" data-op="'+openEventAction(e)+'" data-id="'+esc(e.id)+'" aria-label="打开'+esc(e.title)+'">'+poster(e)+'</button><div class="tile-body"><div class="tile-title"><h3>'+esc(e.title)+'</h3>'+badge(e)+'</div><div class="tile-meta"><span>'+icon('date')+esc(e.date.replaceAll('-','.')||'日期待定')+'</span>'+
      (mayReadRecords(e.id)?'<span>'+icon('people')+recordsCount(e)+' 人报名</span>':'')+(shared?'<span>创建人 '+esc(creatorName(e.id))+'</span>':'')+'</div><div class="tile-bottom">'+eventActions(e)+'</div>'+
      (e.id==='caiyun2025'?'<div class="source-credit">公开案例 · 封面为演示设计 <a target="_blank" rel="noopener noreferrer" href="https://g.eqxiu.com/s/YHHj4cRb?eip=true">查看原邀请函 ↗</a></div>':'')+'</div></article>').join('')+'</div>';
  }
  function activityName(e,op,label=e.title){
    return '<button class="table-event" type="button" data-op="'+op+'" data-id="'+esc(e.id)+'" aria-label="'+esc(label)+'"><span class="table-art" aria-hidden="true">'+poster(e)+'</span><span>'+esc(e.title)+'</span></button>';
  }
  function openEventAction(event){
    return ['draft','offline'].includes(eventAvailability(event))?'edit':'invite';
  }
  function externalPreview(event){
    const published=db.published[event.id]||event;
    const info=db.publications?.[event.id];
    return clone({...published,registrationAccepting:info?info.online&&info.accepting:published.status==='live'});
  }
  function libraryTable(items){
    return '<div class="s-table-wrap lib-table"><table class="s-table s-stack-table"><thead><tr><th>活动名称</th><th>活动日期</th>'+(shared?'<th>创建人</th>':'')+'<th>状态</th><th class="s-num">报名</th><th>操作</th></tr></thead><tbody>'+
      items.map(e=>'<tr><td class="s-event-cell">'+activityName(e,openEventAction(e),'打开'+e.title)+'</td><td data-col="日期">'+esc(e.date||'待定')+'</td>'+(shared?'<td data-col="创建人">'+esc(creatorName(e.id))+'</td>':'')+'<td data-col="状态">'+badge(e)+'</td><td class="s-num" data-col="报名">'+(mayReadRecords(e.id)?window.EventData.count(recordsCount(e)):'—')+'</td><td class="s-row-actions">'+eventActions(e)+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function paging(total,page,pages){
    if(!total)return '';
    const start=(page-1)*libraryPageSize+1,end=Math.min(page*libraryPageSize,total);
    const numbers=[...new Set([1,page-1,page,page+1,pages])].filter(n=>n>0&&n<=pages).sort((a,b)=>a-b);
    const nav=(n,label,body,disabled=false,current=false)=>'<button type="button" class="page-btn" data-op="library-page" data-page="'+n+'" aria-label="'+label+'" '+(disabled?'disabled ':'')+(current?'aria-current="page"':'')+'>'+body+'</button>';
    return '<div class="library-pager"><span aria-live="polite">'+start+'–'+end+' / '+total+' 场活动</span><nav aria-label="活动库分页">'+
      nav(page-1,'上一页',icon('left'),page===1)+numbers.map((n,i)=>(i&&n-numbers[i-1]>1?'<span class="page-gap">…</span>':'')+nav(n,'第 '+n+' 页',n,false,n===page)).join('')+
      nav(page+1,'下一页',icon('right'),page===pages)+'</nav></div>';
  }
  function renderTiles(){
    const items=db.events.filter(e=>(filter==='all'||filter===eventAvailability(e))&&e.title.toLowerCase().includes(term.trim().toLowerCase()));
    const pages=Math.max(1,Math.ceil(items.length/libraryPageSize));
    libraryPage=Math.min(Math.max(libraryPage,1),pages);
    const pageItems=items.slice((libraryPage-1)*libraryPageSize,libraryPage*libraryPageSize);
    $('#tile-list').innerHTML=items.length?(libraryView==='cards'?cards(pageItems):libraryTable(pageItems)):'<p class="empty">没有匹配的活动。可以更换关键词或活动状态。</p>';
    $('#library-paging').innerHTML=paging(items.length,libraryPage,pages);
  }
  const dataHash=id=>'data'+(id?'/'+encodeURIComponent(id):'');
  const periodControl=()=>shared?'<label>时间 <select id="metric-period" aria-label="统计时间范围">'+
     [['all','全部时间'],['7','近 7 天'],['30','近 30 天']].map(([v,l])=>'<option value="'+v+'" '+(v===metricPeriod?'selected':'')+'>'+l+'</option>').join('')+'</select></label>'+
     action('刷新数据','refresh-data',null,'s-btn'):'';
  function showRecords(eventId=null){
    const event=eventId&&db.events.find(e=>e.id===eventId&&mayReadRecords(e.id));
    dataEventId=event?event.id:null;
    if(!event){
      $('#workspace').innerHTML=heading('活动数据','查看各场公开邀请函的浏览与报名表现。')+
        '<div class="record-toolbar metrics-filters">'+fieldSearch(metricsTerm,'搜索活动名称')+periodControl()+'</div>'+
        '<section class="record-surface data-index" id="data-index" aria-live="polite"></section>';
      refreshMetrics();return;
    }
    $('#workspace').innerHTML='<div class="data-breadcrumb"><a href="#data">'+icon('left')+'活动数据</a>'+
      '<span data-registration-badge="'+esc(event.id)+'">'+badge(event)+'</span></div>'+
      heading(esc(event.title),'活动详情')+eventContext(event.id)+'<div class="record-toolbar metrics-filters">'+periodControl()+'</div>'+
      '<div id="metric-area" aria-live="polite"></div><section class="record-surface"><div class="record-toolbar"><h2>报名明细</h2>'+fieldSearch(recordTerm,'搜索企业或联系人')+'</div><div id="record-list"></div></section>';
    refreshMetrics();
  }
  function renderActivityData(){
    const host=$('#data-index');if(!host)return;
    const events=db.events.filter(e=>mayReadRecords(e.id)&&e.title.toLowerCase().includes(metricsTerm.trim().toLowerCase()));
    if(!events.length){host.innerHTML='<p class="empty">'+(metricsTerm?'没有匹配的活动。':'暂无可查看的活动。')+'</p>';return;}
    const {count,duration,pct}=window.EventData;
    function cell(name,value){return '<td class="s-num" data-col="'+name+'">'+value+'</td>';}
    host.innerHTML='<div class="s-table-wrap"><table class="s-table s-stack-table data-index-table"><thead><tr><th>活动名称</th>'+(shared?'<th>创建人</th>':'')+'<th>状态</th><th class="s-num">浏览量</th><th class="s-num">独立访客</th><th class="s-num">平均浏览时长</th><th class="s-num">成功报名</th><th class="s-num">访问报名转化率</th><th>操作</th></tr></thead><tbody>'+
      events.map(e=>{
        const m=activityMetrics?.get(e.id),url='#'+dataHash(e.id);
        return '<tr><td class="s-event-cell"><a class="table-event" href="'+url+'"><span class="table-art" aria-hidden="true">'+poster(e)+'</span><span>'+esc(e.title)+'</span></a></td>'+(shared?'<td data-col="创建人">'+esc(creatorName(e.id))+'</td>':'')+'<td data-col="状态">'+badge(e)+'</td>'+
          cell('浏览量',m?count(m.pv):'—')+cell('独立访客',m?count(m.uv):'—')+cell('平均浏览时长',m?duration(m.ms,m.pv):'—')+
          cell('成功报名',m?count(m.signups):shared?'—':count(recordsCount(e)))+cell('访问报名转化率',m?pct(m.converted,m.pv):'—')+
          '<td class="s-row-actions"><a class="card-action" href="'+url+'" aria-label="查看 '+esc(e.title)+' 的详情">查看详情 '+icon('right')+'</a></td></tr>';
      }).join('')+'</tbody></table></div>'+(!shared?'<p class="data-footnote">访问统计在共享服务的公开邀请函中采集。</p>':'');
  }
  async function refreshMetrics(){
    const serial=++metricsRequest;
    const area=$('#metric-area')||$('#data-index');
    const eventId=dataEventId;
    const isCurrent=()=>serial===metricsRequest&&area?.isConnected;
    if(!area)return;
    recordsSince=null;
    if(shared&&metricPeriod!=='all'){
      const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
      recordsSince=Date.parse(today+'T00:00:00+08:00')-(Number(metricPeriod)-1)*86400000;
    }
    if(eventId)renderRecords();
    else{activityMetrics=null;renderActivityData();}
    if(!shared){
      if(eventId)area.innerHTML='<p class="s-desc">访问统计在共享服务的公开邀请函中采集。</p>';
      return;
    }
    if(eventId)area.textContent='正在读取活动数据…';
    try{
      const q=new URLSearchParams({days:metricPeriod});
      if(eventId){
        q.set('event',eventId);
        const report=await request('/api/insights?'+q);
        if(!isCurrent())return;
        recordsSince=report.since?Date.parse(report.since):null;
        area.innerHTML=window.EventData.render(report);renderRecords();
      }else{
        const report=await request('/api/insights/events?'+q);
        if(!isCurrent())return;
        activityMetrics=new Map(report.items.map(item=>[item.eventId,item]));
        renderActivityData();
      }
    }catch(error){
      if(isCurrent()){
        if(eventId)area.textContent=error.message;
        else{const notice=document.createElement('p');notice.className='data-footnote';notice.textContent=error.message;area.prepend(notice);}
      }
    }
  }
  function renderRecords(){
    const target=$('#record-list');if(!target)return;
    const rows=db.rows.filter(r=>r.eventId===dataEventId&&(!recordsSince||Date.parse(r.at)>=recordsSince)&&[r.values.company,r.values.name].some(v=>String(v||'').includes(recordTerm)));
    target.innerHTML=rows.length?'<div class="s-table-wrap"><table class="s-table s-stack-table"><thead><tr><th>企业名称</th><th>联系人</th><th>所属活动</th><th>报名时间</th><th>操作</th></tr></thead><tbody>'+rows.map(r=>'<tr><td class="s-event-cell">'+esc(r.values.company||'—')+'</td><td data-col="联系人">'+esc(r.values.name||'—')+'</td><td data-col="活动">'+esc(db.events.find(e=>e.id===r.eventId)?.title)+'</td><td data-col="报名时间">'+esc(new Date(r.at).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}))+'</td><td class="s-row-actions">'+action('详情','detail',null,'card-action',r.id)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="empty">暂无符合条件的报名。</p>';
  }

  function memberOptions(role='member'){
    return Object.entries(memberRoles).map(([value,label])=>
      '<option value="'+value+'" '+(value===role?'selected':'')+'>'+label+'</option>').join('');
  }
  function formatAuditTime(at){
    return at?new Date(at).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}):'—';
  }
  function memberAvatar(name){
    return '<span class="member-avatar" aria-hidden="true">'+esc(Array.from(name)[0].toUpperCase())+'</span>';
  }
  function showPasswordLink(member){
    const url=new URL(member.setupPath,location.origin);
    dialog('一次性设密链接','<p class="s-desc">发给「'+esc(member.username)+'」本人。链接 '+Math.round(member.expiresIn/3600)+' 小时内有效，成功设置密码后即失效。</p>'+
      '<label class="share-link">设密链接<input readonly value="'+esc(url.href)+'"></label>',
      '<div class="dlg-footer">'+action('完成','dismiss')+action('复制链接','clipboard','copy','s-btn primary')+'</div>');
  }
  function auditDialog(title,columns,rows,empty){
    const body=rows.length?'<p class="s-desc">北京时间 · 最近 '+rows.length+' 条</p><div class="s-table-wrap audit-table">'+
      '<table class="s-table"><thead><tr>'+columns.map(column=>'<th scope="col">'+column+'</th>').join('')+'</tr></thead><tbody>'+
      rows.map(row=>'<tr>'+row.map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p class="s-desc">'+empty+'</p>';
    dialog(esc(title),body).classList.add('audit-dialog');
  }
  function showMemberLogins(name,items){
    auditDialog(name+' · 登录记录',['登录时间','IP 地址'],items.map(item=>[formatAuditTime(item.at),item.ip]),'暂无登录记录。');
  }
  function creatorName(id){
    return db?.eventPeople?.[id]?.creator||'未记录';
  }
  function eventContext(id){
    if(!shared)return '';
    const event=db.events.find(item=>item.id===id);
    return '<div class="event-context"><span>创建人 '+esc(creatorName(id))+'</span>'+
      '<span class="event-publication-status" data-registration-badge="'+esc(id)+'">'+(event?badge(event):'')+'</span>'+
      (db.published[id]?action('发布管理','share',null,'card-action',id):'')+
      action('操作日志','event-operations',null,'card-action',id)+'</div>';
  }
  async function showEventOperations(id){
    const {items}=await request(eventPath(id)+'/operations');
    const names={create:'创建活动',copy:'复制为新一期',edit:'保存草稿',publish:'发布',...lifecycleLabels};
    auditDialog('活动操作日志',['时间','成员','操作','版本','修改内容'],items.map(item=>[
      formatAuditTime(item.at),item.username,names[item.operation],item.version,
      [...new Set(item.changes.map(key=>eventChangeLabels[key]||'活动配置'))].join('、')||'—'
    ]),'暂无操作记录。');
  }
  function showMembers(){
    const host=$('#workspace');
    host.innerHTML=heading('成员管理','为同事创建登录账号，设置他们可以查看的活动数据。',
      '<button class="s-btn primary" type="button" id="member-add" aria-expanded="false" aria-controls="member-create">'+icon('plus')+'新建成员</button>')+
      '<section class="record-surface member-create" id="member-create" hidden><form class="dlg-fields">'+
        '<div class="member-fields">'+
          '<label>用户名<input name="username" type="text" autocomplete="off" maxlength="64" required></label>'+
          '<label>角色<select name="role" aria-label="新成员角色">'+memberOptions()+'</select></label>'+
        '</div><p class="auth-error" role="alert"></p><div class="member-create-footer">'+
          '<p>将用户名和一次性链接私下交给成员，由本人设置密码。</p><div class="s-actions"><button class="s-btn" type="button" id="member-cancel">取消</button><button class="s-btn primary" type="submit">生成设密链接</button></div></div></form></section>'+
      '<section class="record-surface member-directory" aria-labelledby="member-list-title"><header class="member-directory-head">'+
        '<h2 id="member-list-title">工作台成员</h2><span id="member-count"></span></header><div id="member-list" aria-busy="true"><p class="empty">正在读取成员…</p></div></section>';
    const add=$('#member-add'),panel=$('#member-create'),form=panel.querySelector('form');
    const username=form.elements.username,formError=form.querySelector('[role=alert]');
    const list=$('#member-list'),count=$('#member-count');
    let members=[];

    function toggleCreate(open){
      panel.hidden=!open;
      add.setAttribute('aria-expanded',String(open));
      if(open){username.focus();return;}
      form.reset();username.setCustomValidity('');formError.textContent='';
      form.elements.role.dispatchEvent(new Event('input'));
      add.focus();
    }
    function handleMemberError(error,element){
      if(!element.isConnected)return;
      if(error.status===403){renderRoute();return;}
      element.textContent=error.message;
    }
    async function loadMembers(){
      list.setAttribute('aria-busy','true');
      try{
        const {items,currentId}=await request('/api/members');
        if(!list.isConnected)return;
        members=items;
        count.textContent=items.length+' 位';
        list.innerHTML='<div class="s-table-wrap"><table class="s-table s-stack-table member-table"><thead><tr><th scope="col">用户名</th><th scope="col">角色</th><th scope="col">活动数据范围</th><th scope="col">状态</th><th scope="col">最近登录</th><th scope="col">操作</th></tr></thead><tbody>'+
          items.map(member=>{
            const own=member.id===currentId;
            const role=own?'<span class="member-fixed-role">管理员</span>':
              '<select data-member-id="'+esc(member.id)+'" data-role="'+esc(member.role)+'" data-username="'+esc(member.username)+'" aria-label="'+esc(member.username)+' 的角色">'+memberOptions(member.role)+'</select>';
            const status={active:'已启用',pending:'待设密',disabled:'已停用'}[member.status];
            const enabled=member.status!=='disabled';
            const control=(op,label)=>'<button type="button" class="card-action" data-member-op="'+op+'" data-target="'+esc(member.id)+'">'+label+'</button>';
            return '<tr><td class="s-event-cell"><div class="member-person">'+memberAvatar(member.username)+'<strong>'+esc(member.username)+'</strong>'+(own?'<span class="member-self">当前账号</span>':'')+'</div></td>'+
              '<td data-col="角色">'+role+'</td><td class="member-access" data-col="活动数据范围">'+memberAccess[member.role]+'</td>'+
              '<td data-col="状态"><span class="badge '+({active:'live',pending:'draft',disabled:'ended'}[member.status])+'">'+status+'</span></td>'+
              '<td data-col="最近登录">'+esc(formatAuditTime(member.lastLogin))+(member.lastIP?'<small class="login-ip">'+esc(member.lastIP)+'</small>':'')+'</td>'+
              '<td class="s-row-actions"><div class="member-actions">'+control('logins','登录记录')+
              (own?'':(enabled?control('password',member.status==='pending'?'重发设密链接':'重置密码'):'')+control('toggle',enabled?'停用':'启用'))+'</div></td></tr>';

          }).join('')+'</tbody></table></div>';
      }catch(error){
        if(!list.isConnected)return;
        list.innerHTML='<p class="empty" role="alert"></p>';
        handleMemberError(error,list.firstElementChild);
      }finally{list.setAttribute('aria-busy','false');}
    }
    add.onclick=()=>toggleCreate(panel.hidden);
    $('#member-cancel').onclick=()=>toggleCreate(false);
    username.oninput=()=>username.setCustomValidity('');
    form.onsubmit=async ev=>{
      ev.preventDefault();
      const submit=form.querySelector('[type=submit]');
      if(submit.disabled)return;
      if(!username.value.trim()){
        username.setCustomValidity('请输入用户名。');username.reportValidity();return;
      }
      const payload=Object.fromEntries(new FormData(form));
      payload.username=payload.username.trim();
      submit.disabled=true;
      formError.textContent='';
      try{
        const result=await request('/api/members','POST',payload);
        if(!form.isConnected)return;
        toggleCreate(false);
        showPasswordLink(result);
        await loadMembers();
      }catch(error){handleMemberError(error,formError);}
      finally{submit.disabled=false;}
    };
    list.addEventListener('click',async ev=>{
      const button=ev.target.closest('[data-member-op]');
      if(!button)return;
      const member=members.find(item=>item.id===button.dataset.target);
      if(!member)return;
      const memberPath='/api/members/'+encodeURIComponent(member.id);
      const operation=button.dataset.memberOp;
      button.disabled=true;
      try{
        if(operation==='logins'){
          const {items}=await request(memberPath+'/logins');
          if(list.isConnected)showMemberLogins(member.username,items);
          return;
        }
        const enabled=member.status==='disabled';
        const password=operation==='password';
        const caption=password?button.textContent:(enabled?'启用成员':'停用成员');
        const consequence=password?'现有登录会话及旧链接将失效。':enabled?'成员可继续使用原账号。':'成员将退出登录。已有活动和报名数据会保留。';
        if(!await window.StudioControls.confirm(caption+'「'+member.username+'」？'+consequence,caption,'取消')||!list.isConnected)return;
        if(password){
          const result=await request(memberPath+'/password-link','POST',{});
          if(list.isConnected)showPasswordLink(result);
        }else{
          await request(memberPath,'PATCH',{enabled});
          if(list.isConnected)toast(enabled?'成员已启用。':'成员已停用。');
        }
        if(list.isConnected)await loadMembers();
      }catch(error){
        if(list.isConnected){if(error.status===403)renderRoute();else toast(error.message);}
      }finally{button.disabled=false;}
    });
    list.addEventListener('change',async ev=>{
      const select=ev.target.closest('[data-member-id]');
      if(!select||select.value===select.dataset.role||select.disabled)return;
      const role=select.value;
      select.value=select.dataset.role;
      select.dispatchEvent(new Event('input'));
      const ok=await window.StudioControls.confirm('将「'+select.dataset.username+'」设为'+memberRoles[role]+'？活动数据范围为'+memberAccess[role]+'。','确认调整','取消');
      if(!ok||!select.isConnected)return;
      select.disabled=true;
      try{
        const saved=await request('/api/members/'+encodeURIComponent(select.dataset.memberId),'PATCH',{role});
        if(!select.isConnected)return;
        select.value=saved.role;
        select.dataset.role=saved.role;
        select.dispatchEvent(new Event('input'));
        select.closest('tr').querySelector('.member-access').textContent=memberAccess[saved.role];
        toast('成员角色已更新。');
      }catch(error){
        if(select.isConnected){
          if(error.status===403)renderRoute();else toast(error.message);
        }
      }finally{select.disabled=false;}
    });
    loadMembers();
  }
  function discardEditor(){
    if(!editorSession)return;
    const previous=editorSession;
    editorSession=null;
    previous.dispose();
    $('#workspace').classList.remove('workspace-editor');
  }
  function mountEditor(id,element,canLeave,dispose){
    discardEditor();stopSpotlight();metricsRequest++;navigation++;
    const hash='#edit/'+encodeURIComponent(id);
    if(location.hash!==hash)history.pushState(null,'',hash);
    editorSession={hash,canLeave,dispose};
    currentPage='editor';
    document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav==='home'));
    $('#workspace').classList.add('workspace-editor');
    $('#workspace').replaceChildren(element);
    window.scrollTo(0,0);
    scheduleWorkspaceRegistrationRefresh();
  }
  function page(view,eventId=null){
    discardEditor();stopSpotlight();currentPage=view;
    document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',view===b.dataset.nav));
    if(view==='records')showRecords(eventId);
    else if(view==='members')showMembers();
    else showHome();
    scheduleWorkspaceRegistrationRefresh();
  }
  function navigate(view,eventId=null){
    const hash=view==='records'?dataHash(eventId):view;
    if(location.hash!=='#'+hash)location.hash=hash;else renderRoute();
  }
  function route(){
    const hash=location.hash.slice(1);
    if(hash.startsWith('edit/')){
      const id=hash.slice(5),event=db.events.find(e=>e.id===id);
      if(event){window.launchEditor(event);return;}
      toast('未找到该活动。');
      history.replaceState(null,'','#home');
    }
    if(hash.startsWith('invite/')){
      const event=db.published[hash.slice(7)];page('home');
      if(event)window.launchInvite(externalPreview(event));else toast('未找到已发布的活动');
    }else if(hash==='members'){
      if(canManageMembers())page('members');
      else{
        history.replaceState(null,'','#home');page('home');toast('仅管理员可以管理成员。');
      }
    }else if(hash==='records'||hash==='data'||hash.startsWith('data/')){
      const id=hash.startsWith('data/')?hash.slice(5):null;
      if(id&&(!mayReadRecords(id)||!db.events.some(e=>e.id===id))){
        history.replaceState(null,'','#data');toast('未找到可查看的活动。');page('records');
      }else page('records',id);
    }else page('home');
  }
  function dialog(title,body,footer=''){
    $('#modal-host').innerHTML='<dialog class="s-dialog" aria-labelledby="studio-dialog-title"><div class="dialog-head"><h2 id="studio-dialog-title">'+title+'</h2>'+action('','dismiss','close','util-btn')+'</div><div class="dialog-content">'+body+'</div>'+footer+'</dialog>';
    const dlg=$('.s-dialog');
    dlg.querySelector('[data-op=dismiss]').setAttribute('aria-label','关闭');
    dlg.addEventListener('close',()=>{dlg.remove();scheduleSpotlight();});
    stopSpotlight();
    dlg.showModal();return dlg;
  }
  function newEvent(base,selected='archive'){
    const looks=window.ForumTemplates.looks;
    const choices=base?'':'<fieldset class="style-picker"><legend>邀请函样式</legend><div>'+Object.entries(looks).map(([key,look])=>
      '<button type="button" data-look="'+key+'" aria-pressed="'+(key===selected)+'"><img alt="" src="'+window.ForumMedia[key]+'"><strong>'+look.name+'</strong></button>').join('')+
      '</div><p class="s-desc">新草稿会带入七页示例内容，可在编辑器里替换。</p><a href="'+esc(galleryURL())+'" target="_blank" rel="noopener">打开模板库 ↗</a></fieldset>';
    const dlg=dialog(base?'复制为新一期':'新建活动','<form id="new-event" class="dlg-fields"><label>活动名称<input name="title" required maxlength="60" value="'+esc(base?base.title+'（新一期）':window.ForumTemplates.example.title)+'" placeholder="输入活动名称"></label>'+choices+'</form>', '<div class="dlg-footer"><button class="s-btn" data-op="dismiss">取消</button><button class="s-btn primary" form="new-event" type="submit">进入编辑</button></div>');
    const form=dlg.querySelector('form');const input=form.elements.title;input.focus();input.select();
    form.addEventListener('click',ev=>{
      const pick=ev.target.closest('[data-look]');if(!pick)return;
      selected=pick.dataset.look;
      form.querySelectorAll('[data-look]').forEach(node=>node.setAttribute('aria-pressed',String(node===pick)));
    });
    form.onsubmit=async ev=>{
      ev.preventDefault();
      if(!input.value.trim()){input.setCustomValidity('请输入活动名称');input.reportValidity();return;}
      const source=base||window.ForumTemplates.sample(selected);
      const e=window.InviteLayout.prepare({...source,id:id(),version:0,title:input.value.trim(),status:'draft'});
      delete e.registrationSchedule;
      const submit=dlg.querySelector('[type=submit]');
      if(submit.disabled)return;
      submit.disabled=true;
      try{const saved=await save(e,false,base?.id);dlg.close();window.launchEditor(saved);}
      catch(err){toast(err.message);submit.disabled=false;}
    };
    input.oninput=()=>input.setCustomValidity('');
  }
  function home(){
    if(publicRoute)return;
    discardEditor();
    if(location.hash==='#home'||!location.hash){page('home');if(shared)renderRoute();}
    else navigate('home');
  }
  window.studio={current,save,publish:(e,revision)=>save(e,true,undefined,revision),register,home,toast,esc,poster,shared,
    publicRoute,identityValue,templateStyle,galleryURL,useStyleURL,mountEditor,eventContext,confirmedPublication,afterPublish,
    registrationState,atNextRegistrationBoundary,
    canPublish:id=>!shared||Boolean(db?.publications?.[id]?.canManage),trackPage:(i,n)=>activeVisit?.page(i,n)};
  document.addEventListener('click',async ev=>{
    const btn=ev.target.closest('[data-op],[data-nav],[data-filter]');if(!btn)return;
    if(btn.dataset.op==='retry'){location.reload();return;}
    if(shared&&!user)return;
    if(btn.dataset.nav){navigate(btn.dataset.nav);return;}if(btn.dataset.filter){filter=btn.dataset.filter;libraryPage=1;btn.parentElement.querySelectorAll('button').forEach(tab=>tab.setAttribute('aria-pressed',String(tab===btn)));movePill();renderTiles();return;}
    const e=db.events.find(x=>x.id===btn.dataset.id);
    try{switch(btn.dataset.op){
      case 'clear-search':{
        const input=btn.closest('.field-search').querySelector('input');
        input.value='';input.focus();input.dispatchEvent(new Event('input',{bubbles:true}));break;
      }
      case 'logout':
        if(editorSession&&!await editorSession.canLeave())return;
        await request('/api/logout','POST',{});
        term='';filter='all';recordTerm='';metricsTerm='';libraryPage=1;
        showLogin();
        break;
      case 'library-view':
        libraryView=btn.dataset.view;
        try{localStorage.setItem('invite-studio.library-view',libraryView);}catch{}
        btn.parentElement.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===btn)));
        movePill();renderTiles();break;
      case 'library-page':
        libraryPage=Number(btn.dataset.page);renderTiles();
        $('#library-paging button[aria-current="page"]')?.focus({preventScroll:true});
        break;
      case 'spot-prev':stepSpotlight(-1);break;
      case 'spot-next':stepSpotlight(1);break;
      case 'spot-go':
        spotlightId=featuredEvents()[Number(btn.dataset.spotIndex)]?.id;
        paintSpotlight(true);break;
      case 'spot-toggle': {
        spotlightPaused=!spotlightPaused;
        const label=spotlightPaused?'播放轮播':'暂停轮播';
        btn.setAttribute('aria-label',label);btn.title=label;
        btn.innerHTML=icon(spotlightPaused?'play':'pause');
        scheduleSpotlight();break;
      }
      case 'refresh-data':await renderRoute();break;
      case 'event-operations':await showEventOperations(btn.dataset.id);break;
      case 'event-data':recordTerm='';navigate('records',e.id);break;
      case 'share':shareLink(e,await getPublication(e.id));break;
      case 'publication-control':await changePublication(e,btn.dataset.lifecycle);break;
      case 'clipboard':{
        const input=btn.closest('dialog').querySelector('input');
        input.select();
        try{
          if(navigator.clipboard)await navigator.clipboard.writeText(input.value);
          else if(!document.execCommand('copy'))throw new Error();
          btn.textContent='已复制';
        }catch{btn.textContent='请复制选中的链接';}
        break;
      }
      case 'edit':window.launchEditor(await current(e.id));break;
      case 'invite':window.launchInvite(externalPreview(e));break;
      case 'copy':newEvent(await current(e.id));break;
      case 'new':newEvent();break;
      case 'records':recordTerm='';navigate('records');break;
      case 'dismiss':btn.closest('dialog').close();break;
      case 'detail':{const r=db.rows.find(r=>r.id===btn.dataset.id);dialog('报名详情','<dl class="reg-details">'+r.fields.map(f=>'<dt>'+esc(f.label)+'</dt><dd>'+esc(r.values[f.key]||'—')+'</dd>').join('')+'</dl>');break;}
    }}catch(error){toast(error.message);}
  });
  document.addEventListener('input',ev=>{if(!ev.target.matches('#workspace input[type=search]'))return;if(currentPage==='home'){term=ev.target.value;libraryPage=1;renderTiles();}else if(dataEventId){recordTerm=ev.target.value;renderRecords();}else{metricsTerm=ev.target.value;renderActivityData();}});
  document.addEventListener('change',ev=>{
    if(ev.target.id==='metric-period'){metricPeriod=ev.target.value;refreshMetrics();}
  });
  if(changesChannel&&!templateStyle&&!templateGallery)changesChannel.onmessage=()=>transact().then(()=>{if(!editorSession)route();}).catch(err=>toast(err.message));
  window.addEventListener('hashchange',renderRoute);
  if(templateStyle){
    $('.topbar').hidden=true;
    document.title=window.ForumTemplates.looks[templateStyle].name+' · 邀请函预览';
    const start=Number(params.get('page')||1)-1;
    window.launchInvite(window.ForumTemplates.sample(templateStyle),true,'overview',Number.isInteger(start)?start:0);
  }else if(templateGallery)showStyleGallery();
  else if(passwordRoute)showSetPassword();
  else if(shared){
    startShared();
    if(!publicRoute){setInterval(checkSession,10000);document.addEventListener('visibilitychange',checkSession);}
    window.addEventListener('focus',()=>{
      checkSession();
      if(user && !publicRoute && !document.querySelector('.ze-layer,dialog,#workspace input:focus,.ui-popover,#member-create:not([hidden])'))renderRoute();
    });
  }else{
    $('.topbar').hidden=false;
    $('.identity').innerHTML='<span class="team-name">品牌活动组</span><span class="user-avatar" title="演示用户 · 林可">林</span>';
    transact().then(()=>{route();openRequestedStyle();}).catch(()=>{route();toast('浏览器数据库不可用，请用新版 Edge 或 Chrome 打开。');});
  }
})();
