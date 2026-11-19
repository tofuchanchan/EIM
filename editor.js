(() => {
  'use strict';
  const api = () => window.studio;
  const esc = value => api().esc(String(value ?? ''));
  const clone = value => JSON.parse(JSON.stringify(value));
  let previewDevice='iphone14';
  const identityKind=(ev,key)=>Object.entries(ev.registrationUnique||{}).find(([,value])=>value===key)?.[0];
  const icons = {
    back: '<path d="m14 6-6 6 6 6"/>',
    next: '<path d="m10 6 6 6-6 6"/>',
    edit: '<path d="m5 16-1 4 4-1 11-11-3-3Z"/>',
    form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    send: '<path d="m21 3-7 18-3-8-8-3 18-7Z"/><path d="m11 13 10-10"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
    pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    cross: '<path d="m6 6 12 12M18 6 6 18"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>'
  };
  const icon = name => '<svg class="ze-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
  const defFields = () => [{key:'company',label:'企业名称',required:true},{key:'name',label:'联系人',required:true},{key:'phone',label:'联系电话',required:true}];
  const scheduleLabels={start:'报名开始',end:'报名截止'};
  function scheduleInputs(event){
    return Object.fromEntries(Object.keys(scheduleLabels).map(bound=>{
      const [date='',time='']=(event.registrationSchedule?.[bound]||'').split('T');
      return [bound,{date,time}];
    }));
  }
  const btn = (cmd, label, cls='', ico='') => '<button type="button" class="ze-btn '+cls+'" data-act="'+cmd+'">'+(ico ? icon(ico) : '')+label+'</button>';
  const close = el => {
    if (!el) return;
    el.stopRegistrationTimer?.();
    window.DeviceCover.releaseDevice(el);
    el.remove();
    if (!document.querySelector('.ze-layer:not(.ze-workbench)')) document.documentElement.classList.remove('ze-open');
    const editor=document.getElementById('zb-editor');
    if(editor&&el.id==='zb-invite')editor.inert=false;
    if (el._previousFocus?.isConnected) el._previousFocus.focus();
  };
  function layer(id, label, onExit) {
    const node = document.createElement('section');
    node.className = 'ze-layer';
    node.id = id;
    node.setAttribute('role','dialog');
    node.setAttribute('aria-modal','true');
    node.setAttribute('aria-label',label);
    node._previousFocus = document.activeElement;
    document.documentElement.classList.add('ze-open');
    document.body.append(node);
    node.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); onExit(); return; }
      if (e.key !== 'Tab') return;
      const items = [...node.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),textarea,select,[tabindex="0"]')].filter(el => el.getClientRects().length&&!el.closest('[inert]'));
      if (!items.length) return;
      if (e.shiftKey && (document.activeElement === items[0] || document.activeElement === node)) {e.preventDefault();items.at(-1).focus();}
      else if (!e.shiftKey && (document.activeElement === items.at(-1) || document.activeElement === node)) {e.preventDefault();items[0].focus();}
    });
    node.tabIndex = -1;
    node.focus();
    return node;
  }
  function showError(msg) { api().toast(msg); }
  async function persist(method, ...args) {
    try { return (await api()[method](...args)) !== false; }
    catch (error) {
      showError(error.message || '本机保存失败，请检查浏览器存储空间后重试。');
      return false;
    }
  }
  const readableDate = date => (date || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1.$2.$3');
  const facts = ev => '<div class="ze-facts"><div>'+icon('calendar')+'<span>'+esc([readableDate(ev.date),ev.time].filter(Boolean).join(' ') || '时间待定')+'</span></div><div>'+icon('pin')+'<span>'+esc(ev.place || '地点待定')+'</span></div></div>';
  function inside(ev, step, preview) {
    if(step==='form')return '<div class="ze-sheet motion-panel"><div class="ze-step">REGISTRATION</div><h2>企业报名</h2><p class="ze-muted">'+esc(ev.title)+'</p>'+window.InviteLayout.registrationForm(ev,{preview})+'</div>';
    if (step === 'done') return '<div class="ze-done motion-enter"><div class="ze-tick motion-success">'+icon('check')+'</div><h2>'+(preview?'预览提交成功':'报名成功')+'</h2><p>'+esc(ev.title)+'</p>'+facts(ev)+'<p class="ze-note">'+(preview?'本次预览未生成报名记录。':(api().shared?'报名信息已提交给活动负责人。':'演示报名记录已保存到本机活动名单。'))+'</p>'+btn('overview','返回邀请函','ze-ghost')+'</div>';
    return window.InviteLayout.render(ev);
  }
  window.launchInvite = function(ev, preview=false, initialStep='overview',initialPage=0) {
    close(document.getElementById('zb-invite'));
    const data = window.InviteLayout.prepare(ev);
    data.fields = data.fields?.length ? data.fields : defFields();
    const accepting=data.registrationAccepting??(data.status==='live');
    if(!preview)data.registrationState=api().registrationState(data,accepting);
    let storyPage=initialPage,controller;
    const exit = () => {
      if(submitting||api().publicRoute||api().templateStyle)return;
      controller?.destroy?.();close(el);
      const editor=document.getElementById('zb-editor');
      if(editor)editor.dispatchEvent(new CustomEvent('preview-return',{detail:previewDevice}));
      else api().home();
    };
    const el = layer('zb-invite', preview?'邀请函预览':'活动邀请函',exit);
    const editor=document.getElementById('zb-editor');
    if(editor)editor.inert=true;
    let step = preview && initialStep==='form'?'form':'overview', submitting=false;
    let entries = {}, lastPayload='', requestId='';
    let registrationTimer=null;
    const sampleStyle=api().templateStyle;
    const publicView=api().publicRoute||Boolean(sampleStyle);
    if(publicView)el.classList.add('ze-public');
    function draw() {
      controller?.destroy?.();
      const back=sampleStyle?'<a class="ze-back" href="'+esc(api().galleryURL())+'">'+icon('back')+'返回模板库</a>':publicView?'':'<button class="ze-back" data-act="exit">'+icon('back')+(document.getElementById('zb-editor')?'返回编辑器':'返回活动库')+'</button>';
      el.innerHTML='<header class="ze-bar">'+back+'<strong>'+(sampleStyle?window.ForumTemplates.looks[sampleStyle].name:preview?'邀请函预览':'活动邀请函')+'</strong>'+
        (sampleStyle?'<a class="ze-btn ze-primary gallery-use" href="'+esc(api().useStyleURL(sampleStyle))+'">使用此款</a>':preview?window.DeviceCover.renderDeviceSelect(previewDevice):api().shared?'':'<span class="ze-preview-label">本地演示</span>')+
        '</header><main class="ze-viewstage"><div class="ze-device">'+(step==='form'?btn('overview','返回邀请函','ze-form-back','back'):'')+inside(data,step,preview)+'</div></main>';
      if (step === 'form') {
        el.querySelectorAll('form input').forEach(i => {i.value = Object.hasOwn(entries,i.name) ? entries[i.name] : '';});
      }
      const isDeck=step==='overview';
      el.classList.toggle('ze-deck-view',isDeck);
      if(preview&&!sampleStyle)window.DeviceCover.applyDevice(el,previewDevice);
      if(isDeck){
        controller=window.InviteLayout.mount(el.querySelector('.ze-device'),data,{
          preview,index:storyPage,onPage:(i,screen)=>{
            storyPage=i;
            if(publicView&&!sampleStyle&&!preview)api().trackPage(i,data.design.pages.length);
            for(const input of screen.querySelectorAll('.ze-guest-form input'))input.value=Object.hasOwn(entries,input.name)?entries[input.name]:'';
          },
          onRegister:()=>{step='form';draw();el.querySelector('form input')?.focus({preventScroll:true});}
        });
      }
      el.querySelector('main').scrollTop = 0;
    }
    function refreshRegistration(){
      clearTimeout(registrationTimer);
      if(!el.isConnected)return;
      const state=api().registrationState(data,accepting);
      if(state!==data.registrationState){
        data.registrationState=state;
        if(!submitting)window.InviteLayout.updateRegistrationControls(el,data);
      }
      if(accepting)registrationTimer=api().atNextRegistrationBoundary([data],refreshRegistration);
    }
    el.addEventListener('change',e=>{
      if(e.target.matches('[data-device-preset]')){
        previewDevice=e.target.value;window.DeviceCover.applyDevice(el,previewDevice);
      }
    });
    el.addEventListener('input',e => {if(e.target.tagName==='INPUT') entries[e.target.name]=e.target.value;});
    el.addEventListener('click',e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if(submitting)return;
      if(act === 'exit') exit();
      if (act === 'form' || act === 'overview') {step=act;draw();el.querySelector('.ze-device')?.scrollIntoView({block:'start'});}
    });
    el.addEventListener('submit', async e => {
      e.preventDefault();
      if(submitting)return;
      if(!preview&&api().registrationState(data,accepting)!=='live'){
        refreshRegistration();
        return;
      }
      const form = e.target;
      const values = Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,v.trim()]));
      const inputs=new Map([...form.querySelectorAll('input')].map(input=>[input.name,input]));
      for (const f of data.fields) {
        const input = inputs.get(f.key);
        const kind=identityKind(data,f.key);
        if(kind){
          try{api().identityValue(kind,values[f.key]);}
          catch(error){input.setCustomValidity(error.message);input.reportValidity();input.setCustomValidity('');return;}
          continue;
        }
        if (f.required && !values[f.key]) { input.setCustomValidity('请填写'+f.label);input.reportValidity();input.setCustomValidity('');return; }
        if (/电话|手机/.test(f.label) && values[f.key] && !/^[+\d()\s-]{6,24}$/.test(values[f.key])) {input.setCustomValidity('请输入有效的联系电话');input.reportValidity();input.setCustomValidity('');return;}
      }
      if (!preview){
        submitting=true;
        const submit=form.querySelector('[type=submit]'),originalLabel=submit.textContent;
        const player=form.closest('.il-player');if(player)player.inert=true;
        submit.disabled=true;submit.textContent='正在提交…';
        const payload=JSON.stringify(values);
        if(payload!==lastPayload){
          lastPayload=payload;
          requestId=crypto.randomUUID?.()||'reg_'+Array.from(crypto.getRandomValues(new Uint32Array(4)),v=>v.toString(16)).join('');
        }
        const ok=await persist('register',data,values,requestId);submitting=false;
        if(player)player.inert=false;
        if(!ok){
          submit.disabled=false;submit.textContent=originalLabel;
          window.InviteLayout.updateRegistrationControls(el,data);
          return;
        }
      }
      step='done';entries={};lastPayload='';draw();el.focus();
    });
    draw();
    if(!preview&&accepting&&(data.registrationSchedule?.start||data.registrationSchedule?.end)){
      const lifetime=new AbortController();
      el.stopRegistrationTimer=()=>{clearTimeout(registrationTimer);lifetime.abort();};
      document.addEventListener('visibilitychange',refreshRegistration,{signal:lifetime.signal});
      refreshRegistration();
    }
  };

  window.launchEditor = function(source, initialTab='content'){
    let draft=window.InviteLayout.prepare(source);
    draft.fields=draft.fields?.length?draft.fields:defFields();
    let signupInputs=scheduleInputs(draft);
    let tab=['content','design','form'].includes(initialTab)?initialTab:'content';
    let pageIndex=0,designer=null,dirty=false,busy=false,saveError='';
    const el=document.createElement('section');
    el.className='ze-layer ze-workbench';
    el.id='zb-editor';el.tabIndex=-1;
    el.setAttribute('aria-label','邀请函编辑器');
    let pendingLeave=null;
    async function canLeave(){
      if(busy)return false;
      if(!dirty)return true;
      if(!pendingLeave)pendingLeave=window.StudioControls.confirm('草稿还有未保存的修改。').finally(()=>{pendingLeave=null;});
      return pendingLeave;
    }
    async function exit(){
      if(await canLeave())api().home();
    }
    function mark(){
      dirty=true;
      const state=el.querySelector('.ze-save-state');
      if(state)state.textContent='有未保存修改';
    }
    function setBusy(value){
      busy=Boolean(value);
      el.querySelectorAll('.ze-editor-header button,.ze-editor-nav button').forEach(b=>b.disabled=busy);
      const publish=el.querySelector('[data-act=publish]');
      if(publish&&!api().canPublish(draft.id)){
        publish.disabled=true;
        publish.title='仅活动创建人和管理员可以发布';
      }
    }
    function field(label,key,type='text'){
      return '<label class="ze-label">'+label+'<input data-field="'+key+'" type="'+type+'" value="'+esc(draft[key])+'" maxlength="100"></label>';
    }
    function registrationSchedulePanel(){
      return '<fieldset class="ze-registration-schedule"><legend>报名时间 <small>北京时间</small></legend>'+
        '<p class="ze-muted">开始留空时以发布时间为起点。截止留空时可手动关闭。</p>'+
        Object.entries(scheduleLabels).map(([bound,label])=>
          '<div class="ze-schedule-bound"><strong>'+label+'</strong>'+
          '<div class="ze-schedule-inputs">'+[['date','日期'],['time','时间']].map(([type,text])=>
            '<label class="ze-label">'+text+'<input type="'+type+'" data-signup-bound="'+bound+
            '" aria-label="'+label+text+'" value="'+esc(signupInputs[bound][type])+'"></label>').join('')+
          '<button type="button" class="ze-link" data-act="clear-signup-'+bound+'" aria-label="清空'+label+'时间">清空</button>'+
          '</div></div>').join('')+'</fieldset>';
    }
    function basicPanel(){
      const starterMap=window.ForumTemplates && draft.design.pages.some(p=>p.elements.some(e=>
        e.id==='forumP4_navigate'&&e.content.url==='https://www.amap.com/place/B0FFG9LEY2'));
      return '<section class="ze-config-sheet"><h2>基本信息</h2><div class="ze-basic-grid">'+
        field('活动名称','title')+field('活动日期','date','date')+field('开始时间（选填）','time','time')+field('活动地点','place')+'</div>'+
        (starterMap?'<p class="ze-muted" data-venue-note '+(draft.place===window.ForumTemplates.example.place?'hidden':'')+'>当前导航页使用深圳金融科技大厦的示例位置图。更换会场后，请在逐屏设计中同步更新地图图片、交通说明和导航链接。</p>':'')+
        registrationSchedulePanel()+'</section>';
    }
    function uniqueControls(){
      return '<fieldset class="ze-unique"><legend>每场活动限报一次</legend><p>选择用于识别重复报名的字段。两项同时启用时，任一号码重复都会阻止提交。</p>'+
        [['phone','手机号'],['wechat','微信号']].map(([kind,name])=>{
          const rule=draft.registrationUnique||{}, selected=rule[kind], other=rule[kind==='phone'?'wechat':'phone'];
          const fields=draft.fields.filter(f=>f.key!==other);
          return '<label>'+name+'<select data-unique="'+kind+'"><option value="">不限制</option>'+
            fields.map(f=>'<option value="'+esc(f.key)+'" '+(f.key===selected?'selected':'')+'>'+esc(f.label||'未命名字段')+'</option>').join('')+
            '<option value="!new">新增「'+name+'」字段并启用</option></select></label>';
        }).join('')+'</fieldset>';
    }
    function setUnique(kind,key){
      const rule={phone:'',wechat:'',...draft.registrationUnique};
      if(key==='!new'){
        const name=kind==='phone'?'手机号':'微信号';
        const field=draft.fields.find(f=>f.label.trim()===name);
        if(field)key=field.key;
        else{
          if(draft.fields.length>=30){draw();return showError('每场活动最多 30 个报名字段');}
          key=bump('f');draft.fields.push({key,label:name,required:true});
        }
      }
      if(key && key===rule[kind==='phone'?'wechat':'phone']){
        draw();return showError('手机号和微信号需要选择不同的字段。');
      }
      rule[kind]=key;
      draft.registrationUnique=rule;
      mark();draw();
    }
    function formPanel(){
      return '<h2>报名表单</h2><p class="ze-muted">设置参与者报名时需要填写的信息。</p>'+uniqueControls()+'<div class="ze-form-list">'+draft.fields.map((f,i)=>{
        const locked=Boolean(identityKind(draft,f.key));
        return '<div class="ze-formrow"><label class="ze-label">字段名称<input maxlength="30" data-field-index="'+i+'" value="'+esc(f.label)+'"></label><div><label class="ze-switch"><input type="checkbox" data-required="'+i+'" '+(locked||f.required?'checked ':'')+(locked?'disabled':'')+'>'+(locked?'去重字段 · 必填':'必填')+'</label><button type="button" class="ze-link" data-act="remove-field" data-index="'+i+'" '+(locked?'disabled title="先取消该字段的报名限制"':'')+' aria-label="删除'+esc(f.label)+'">删除</button></div></div>';
      }).join('')+'</div>'+btn('add-field','添加字段','ze-ghost ze-full','plus');
    }
    const tabs=[['content','基本信息'],['design','逐屏设计'],['form','表单']];
    let previewFrame=0;
    function renderConfigPreview(){
      const screen=el.querySelector('.zc-screen');if(!screen)return;
      const isForm=tab==='form';
      const pages=draft.design.pages;
      const page=(isForm&&pages.find(p=>p.elements.some(e=>e.content.action==='inline-register')))||pages[0];
      if(isForm&&!page.elements.some(e=>e.content.action==='inline-register')){
        screen.style.background='#fff';
        screen.innerHTML='<div class="ze-sheet"><h2>企业报名</h2>'+window.InviteLayout.registrationForm(draft,{editor:true})+'</div>';
      }else{
        screen.style.background=page.background;
        screen.innerHTML=page.elements.map(e=>'<div class="il-element" style="'+esc(window.InviteLayout.elementStyle(e))+'">'+window.InviteLayout.elementHTML(e,draft,{editor:true})+'</div>').join('');
      }
    }
    function schedulePreview(){
      cancelAnimationFrame(previewFrame);
      previewFrame=requestAnimationFrame(renderConfigPreview);
    }
    function draw(){
      if(designer){pageIndex=designer.index;designer.destroy();designer=null;}
      el.classList.toggle('ze-design-mode',tab==='design');
      window.DeviceCover.releaseDevice(el);
      el.innerHTML='<header class="ze-bar ze-editor-header"><div class="ze-barleft"><button class="ze-back" data-act="exit">'+icon('back')+'活动库</button><i></i><strong>'+esc(draft.title||'编辑邀请函')+'</strong></div>'+
        '<nav class="ze-editor-nav" aria-label="编辑项目">'+tabs.map(([id,label])=>'<button data-act="tab" data-tab="'+id+'" aria-pressed="'+(id===tab)+'">'+label+'</button>').join('')+'</nav>'+
        '<div class="ze-actions"><small class="ze-save-state">'+(dirty?'有未保存修改':'草稿 v'+draft.version)+'</small>'+btn('save','保存草稿','ze-quiet')+btn('preview','预览','ze-ghost','eye')+btn('publish','发布','ze-primary','send')+'</div></header>'+
        api().eventContext(draft.id)+
        (saveError?'<div class="ze-editor-error" role="alert">'+esc(saveError)+' '+btn('reload','载入最新草稿','ze-link')+'</div>':'')+
        (tab==='design'?'<main class="ze-design-host"></main>':'<main class="zc-work"><section class="zc-preview"><header>'+icon('phone')+(tab==='form'?'回执预览':'封面预览')+'</header><div class="zc-stage"><div class="ze-device"><div class="il-canvas zc-screen" inert></div><footer>手机预览</footer></div></div></section><div class="ze-config-area">'+(tab==='form'?'<section class="ze-config-sheet">'+formPanel()+'</section>':basicPanel())+'</div></main>');
      if(tab==='design'){
        designer=window.InviteDesigner.mount(el.querySelector('.ze-design-host'),draft,{
          index:pageIndex,device:previewDevice,onChange:mark,onPage:i=>{pageIndex=i;},
          onDevice:key=>{previewDevice=key;},onBusy:setBusy
        });
      }else{window.DeviceCover.applyDevice(el,previewDevice);renderConfigPreview();}
      setBusy(busy);
    }
    function validate(publishing){
      let key='',msg='';
      if(!draft.title.trim()){key='title';msg='请填写活动名称。';}
      else if(publishing&&(!draft.date||!draft.place.trim())){key=draft.date?'place':'date';msg='发布前请补全活动日期和地点。';}
      if(key){
        tab='content';draw();el.querySelector('[data-field="'+key+'"]').focus();showError(msg);return false;
      }
      function scheduleError(bound,part,message){
        tab='content';draw();
        // Custom date/time controls are enhanced after the draw.
        queueMicrotask(()=>el.querySelector('[data-signup-bound="'+bound+'"][type="'+part+'"]')?.focus());
        showError(message);
        return false;
      }
      const schedule={};
      for(const [bound,{date,time}] of Object.entries(signupInputs)){
        if(Boolean(date)!==Boolean(time)){
          return scheduleError(bound,date?'time':'date',scheduleLabels[bound]+'需要同时填写日期和时间。');
        }
        schedule[bound]=date?date+'T'+time:'';
      }
      if(schedule.start&&schedule.end&&schedule.end<=schedule.start){
        return scheduleError('end','time','报名截止时间须晚于开始时间。');
      }
      if(schedule.start||schedule.end)draft.registrationSchedule=schedule;
      else delete draft.registrationSchedule;
      if(!draft.fields.length||draft.fields.some(f=>!f.label.trim())||new Set(draft.fields.map(f=>f.label.trim())).size!==draft.fields.length){
        tab='form';draw();showError('请保留至少一个报名字段，并填写互不重复的字段名称。');return false;
      }
      return true;
    }
    function bump(prefix){return prefix+'_'+(crypto.randomUUID?.()||Date.now().toString(36)+'_'+Math.random().toString(36).slice(2));}
    el.addEventListener('input',e=>{
      const node=e.target;
      if(busy)return;
      if(node.dataset.field){
        draft[node.dataset.field]=node.value;
        if(node.dataset.field==='place'){
          const note=el.querySelector('[data-venue-note]');if(note)note.hidden=node.value===window.ForumTemplates.example.place;
        }
        if(node.dataset.field==='title')el.querySelector('.ze-barleft strong').textContent=node.value||'编辑邀请函';
      }else if(node.dataset.signupBound)signupInputs[node.dataset.signupBound][node.type]=node.value;
      else if(node.dataset.fieldIndex!==undefined)draft.fields[Number(node.dataset.fieldIndex)].label=node.value;
      else if(node.dataset.required!==undefined)draft.fields[Number(node.dataset.required)].required=node.checked;
      else return;
      mark();schedulePreview();
    });
    el.addEventListener('change',e=>{
      if(!busy&&e.target.matches('[data-unique]'))setUnique(e.target.dataset.unique,e.target.value);
    });
    el.addEventListener('preview-return',e=>{
      if(tab==='design'&&e.detail!==el.querySelector('[data-device-preset]')?.value){
        const select=el.querySelector('[data-device-preset]');
        if(select){select.value=e.detail;select.dispatchEvent(new Event('change',{bubbles:true}));}
      }
    });
    async function act(button){
      const cmd=button.dataset.act;
      if(busy)return;
      if(cmd==='exit'){exit();return;}
      if(cmd==='preview'){
        if(validate(false))window.launchInvite(draft,true,tab==='form'?'form':'overview',pageIndex);
        return;
      }
      if(cmd==='tab'){if(tab!==button.dataset.tab){tab=button.dataset.tab;draw();}return;}
      if(cmd.startsWith('clear-signup-')){
        const bound=cmd.slice('clear-signup-'.length);
        for(const input of el.querySelectorAll('[data-signup-bound="'+bound+'"]')){
          if(!input.value)continue;
          input.value='';
          input.dispatchEvent(new Event('input',{bubbles:true}));
        }
        return;
      }
      if(cmd==='save'||cmd==='publish'){
        if(!validate(cmd==='publish'))return;
        setBusy(true);
        const work=el.querySelector('main');if(work)work.inert=true;
        try{
          const current=await api().current(draft.id);
          if(current.version!==draft.version)throw Error('草稿版本已变化，请载入最新草稿后再编辑。');
          const approval=cmd==='publish'&&api().shared?await api().confirmedPublication(draft):undefined;
          if(approval===null)return;
          if(cmd==='publish'||dirty){
            const saved=await api()[cmd](clone(draft),approval?.revision);
            draft=window.InviteLayout.prepare(saved);dirty=false;
          }
          saveError='';
        }finally{setBusy(false);if(work)work.inert=false;}
        if(cmd==='publish'){
          if(api().shared)await api().afterPublish(draft);
          else{api().home();api().toast('邀请函已发布到本机活动库');}
        }
        else{draw();api().toast('草稿已保存');}
        return;
      }
      if(cmd==='reload'){
        if(dirty&&!await window.StudioControls.confirm('载入最新草稿会放弃当前未保存的修改。','载入最新草稿'))return;
        draft=window.InviteLayout.prepare(await api().current(draft.id));dirty=false;saveError='';
        signupInputs=scheduleInputs(draft);
        designer?.destroy();designer=null;pageIndex=0;tab='content';draw();return;
      }
      if(cmd==='add-field'){
        if(draft.fields.length>=30)return showError('每场活动最多 30 个报名字段');
        draft.fields.push({key:bump('f'),label:'',required:false});
      }else if(cmd==='remove-field'){
        const index=Number(button.dataset.index);
        if(identityKind(draft,draft.fields[index].key))return;
        draft.fields.splice(index,1);
      }else return;
      mark();draw();
      if(cmd==='add-field')el.querySelector('.ze-formrow:last-child input').focus();
    }
    el.addEventListener('click',async e=>{
      const button=e.target.closest('button[data-act]');
      if(!button)return;
      try{await act(button);}catch(error){saveError=error.message||'操作失败，请重试。';showError(saveError);draw();}
    });
    api().mountEditor(source.id,el,canLeave,()=>{
      cancelAnimationFrame(previewFrame);
      designer?.destroy();
      close(el);
    });
    draw();
    el.focus({preventScroll:true});
  };
})();
