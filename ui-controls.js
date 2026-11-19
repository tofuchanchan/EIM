/* The original controls remain the source of form values and change events. */
window.StudioControls = (() => {
  'use strict';
  const selector = 'select:not([multiple]),input[type=date],input[type=time],input[type=color]';
  const icons = {
    select:'m6 9 6 6 6-6',
    date:'M4 6h16v15H4z M8 3v6m8-6v6M4 11h16',
    time:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 2'
  };
  const svg = name => '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="'+icons[name]+'"/></svg>';
  let active = null;
  let serial = 0;

  function create(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }
  function affordance(label, className='ui-action') {
    const button = create('button', className, label);
    button.type = 'button';
    return button;
  }
  function close(restoreFocus=false) {
    if (!active) return;
    const {box,trigger,abort} = active;
    active = null;
    abort.abort();
    trigger.setAttribute('aria-expanded','false');
    trigger.removeAttribute('aria-activedescendant');
    if ('hidePopover' in box && box.matches(':popover-open')) box.hidePopover();
    box.remove();
    if (restoreFocus && trigger.isConnected) trigger.focus({preventScroll:true});
  }
  function anchor(trigger, box, isList) {
    const rect = trigger.getBoundingClientRect();
    if(rect.bottom < 0 || rect.top >= innerHeight) {close();return;}
    const width = Math.max(rect.width, isList ? 164 : 266);
    const actualWidth = Math.min(width, innerWidth-20);
    const below = innerHeight-rect.bottom-16;
    const above = rect.top-16;
    const wanted = isList ? 255 : 346;
    const flip = below < wanted && above > below;
    box.dataset.placement = flip ? 'above' : 'below';
    box.style.width = actualWidth+'px';
    box.style.left = Math.min(Math.max(rect.left,10),innerWidth-actualWidth-10)+'px';
    box.style.maxHeight = Math.max(68, Math.min(wanted, flip?above:below))+'px';
    box.style.top = flip ? 'auto' : (rect.bottom+5)+'px';
    box.style.bottom = flip ? (innerHeight-rect.top+5)+'px' : 'auto';
  }
  function surface(trigger, isList, name) {
    const box = create('div','ui-popover');
    box.id = trigger.getAttribute('aria-controls');
    box.setAttribute('role',isList?'listbox':'dialog');
    box.setAttribute('aria-label',name);
    const abort = new AbortController();
    const {signal} = abort;
    active = {box,trigger,abort};
    const modal = trigger.closest('dialog[open]') || document.body;
    if ('showPopover' in box) box.setAttribute('popover','manual');
    modal.append(box);
    anchor(trigger,box,isList);
    if (!box.isConnected) return null;
    if ('showPopover' in box) box.showPopover();
    trigger.setAttribute('aria-expanded','true');
    window.addEventListener('resize',()=>anchor(trigger,box,isList),{signal});
    document.addEventListener('scroll',e=>{
      if (!box.contains(e.target)) anchor(trigger,box,isList);
    },{capture:true,signal});
    document.addEventListener('pointerdown',e=>{
      if (!box.contains(e.target) && !trigger.contains(e.target)) close();
    },{capture:true,signal});
    document.addEventListener('focusin', e => {
      if (!box.contains(e.target) && !trigger.contains(e.target)) close();
    },{signal});
    document.addEventListener('keydown',e=>{
      if (e.key!=='Escape') return;
      e.preventDefault();e.stopPropagation();close(true);
    },{capture:true,signal});
    return box;
  }
  function emit(control, value, index) {
    close(true);
    if(index===undefined) control.value=value; else control.selectedIndex=index;
    control.dispatchEvent(new Event('input',{bubbles:true}));
    control.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function showOptions(control, trigger, name, direction=0) {
    const box = surface(trigger,true,name);
    if (!box) return;
    const entries = [];
    for (const [index,option] of Array.from(control.options).entries()) {
      if (option.hidden || option.parentElement.hidden) continue;
      const group = option.parentElement;
      if(group.tagName==='OPTGROUP' && entries.at(-1)?.group!==group) box.append(create('div','ui-option-group',group.label));
      const row = affordance(option.label,'ui-option');
      row.id=box.id+'-'+index;
      row.tabIndex=-1;
      row.setAttribute('role','option');
      row.setAttribute('aria-selected',String(index===control.selectedIndex));
      row.disabled=option.disabled||group.disabled===true;
      row.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')e.preventDefault();});
      row.addEventListener('click',()=>emit(control,null,index));
      box.append(row);
      entries.push({row,index,group});
    }
    const available=entries.filter(e=>!e.row.disabled);
    let cursor=available.findIndex(e=>e.index===control.selectedIndex);
    if(cursor<0) cursor=direction<0?available.length-1:0;
    function highlight() {
      available.forEach((e,i)=>e.row.classList.toggle('ui-highlight',i===cursor));
      const item=available[cursor]?.row;
      if(!item)return;
      trigger.setAttribute('aria-activedescendant',item.id);
      item.scrollIntoView({block:'nearest'});
    }
    highlight();
    let typed='', typedAt=0;
    trigger.addEventListener('keydown',e=>{
      if (e.key==='Tab') {close();return;}
      const current=available[cursor];
      if (e.key==='Enter'||e.key===' ') {
        e.preventDefault();e.stopImmediatePropagation();
        if(current)emit(control,null,current.index);
        return;
      }
      if (['ArrowUp','ArrowDown','Home','End'].includes(e.key)) {
        e.preventDefault();e.stopImmediatePropagation();
        if(e.key==='Home'||e.key==='End') cursor=e.key==='Home'?0:available.length-1;
        else cursor=Math.min(available.length-1,Math.max(0,cursor+(e.key==='ArrowDown'?1:-1)));
        highlight();
      }else if (e.key.length===1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now=performance.now();
        typed=(now-typedAt<600?typed:'')+e.key.toLowerCase();typedAt=now;
        const found=available.findIndex(({row})=>row.textContent.toLowerCase().startsWith(typed));
        if(found>=0){cursor=found;highlight();}
      }
    }, {signal:active.abort.signal,capture:true});
  }

  const pad = n => String(n).padStart(2,'0');
  const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
  function showDate(control,box) {
    const value=control.value||today();
    const [year,month]=value.split('-').map(Number);
    let cursor=new Date(Date.UTC(year,month-1,1));
    function render() {
      const y=cursor.getUTCFullYear(),m=cursor.getUTCMonth();
      box.innerHTML='';
      const bar=create('div','ui-calendar-bar');
      const prev=affordance('‹'),next=affordance('›'),title=create('strong',null,y+'年 '+(m+1)+'月');
      prev.setAttribute('aria-label','上个月');next.setAttribute('aria-label','下个月');
      prev.onclick=()=>move(-1);next.onclick=()=>move(1);
      bar.append(prev,title,next);box.append(bar);
      const grid=create('div','ui-calendar-grid');
      for(const label of ['一','二','三','四','五','六','日'])grid.append(create('span',null,label));
      for(let i=0;i<(cursor.getUTCDay()+6)%7;i++)grid.append(create('span'));
      const last=new Date(Date.UTC(y,m+1,0)).getUTCDate();
      for(let day=1;day<=last;day++){
        const date=y+'-'+pad(m+1)+'-'+pad(day);
        const item=affordance(String(day));
        item.setAttribute('aria-label',date);
        item.setAttribute('aria-pressed',String(date===control.value));
        item.disabled=Boolean((control.min && date<control.min)||(control.max && date>control.max));
        item.onclick=()=>emit(control,date);grid.append(item);
      }
      box.append(grid);
      const direct=create('div','ui-date-direct'),input=create('input'),apply=affordance('应用','ui-action primary');
      input.placeholder='YYYY-MM-DD';
      input.setAttribute('aria-label','输入日期（年-月-日）');
      input.value=control.value;input.maxLength=10;
      function validateDate() {
        const raw=input.value.trim();
        const parsed=new Date(raw+'T00:00:00Z');
        apply.disabled=!/^\d{4}-\d{2}-\d{2}$/.test(raw)||!Number.isFinite(parsed.getTime())||
          parsed.toISOString().slice(0,10)!==raw||(control.min&&raw<control.min)||(control.max&&raw>control.max);
      }
      input.addEventListener('input',validateDate);
      input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();apply.click();}});
      apply.onclick=()=>emit(control,input.value.trim());validateDate();
      direct.append(input,apply);box.append(direct);
      const tools=create('div','ui-picker-footer'),clear=affordance('清除'),now=affordance('今天');
      clear.onclick=()=>emit(control,'');now.onclick=()=>emit(control,today());
      now.disabled=Boolean((control.min && today()<control.min)||(control.max && today()>control.max));
      tools.append(clear,now);box.append(tools);
    }
    function move(offset) {cursor=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+offset,1));render();box.querySelector(offset<0?'button:first-child':'button:last-child')?.focus();}
    render();
    (box.querySelector('[aria-pressed="true"]')||box.querySelector('button')).focus({preventScroll:true});
  }
  function showTime(control,box) {
    const fields=create('div','ui-time-fields');
    const [hours,minutes]=(control.value||'09:00').split(':');
    for (const [label,max,value] of [['小时',23,hours],['分钟',59,minutes]]) {
      const field=create('label',null,label), input=create('input');
      input.type='number';input.inputMode='numeric';input.min=0;input.max=max;input.value=value;
      field.append(input);fields.append(field);
    }
    const actions=create('div','ui-picker-footer'),clear=affordance('清除'),apply=affordance('应用','ui-action primary');
    clear.onclick=()=>emit(control,'');
    const inputs=Array.from(fields.querySelectorAll('input'));
    apply.onclick=()=>{
      const invalid=inputs.find(i=>!i.value||!i.checkValidity());
      if(invalid){invalid.focus();return;}
      emit(control,inputs.map(i=>pad(Number(i.value))).join(':'));
    };
    fields.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apply.click();}});
    actions.append(clear,apply);box.append(fields,actions);inputs[0].focus({preventScroll:true});inputs[0].select();
  }
  function showColor(control,box) {
    const grid=create('div','ui-colors');
    for(const color of ['#101827','#5042b8','#5640d8','#174152','#2c4c43','#174b82','#f6f7fa','#ffffff','#fff1d2','#ff824e','#ffbb5c','#742e40']){
      const swatch=affordance(color,'ui-color-chip');swatch.style.setProperty('--swatch',color);
      swatch.setAttribute('aria-label',color);
      swatch.setAttribute('aria-pressed',String(color===control.value));
      swatch.onclick=()=>emit(control,color);grid.append(swatch);
    }
    const field=create('label','ui-hex','色值'),input=create('input');
    input.type='text';input.value=control.value;input.maxLength=7;
    field.append(input);
    const tools=create('div','ui-picker-footer'),apply=affordance('应用','ui-action primary');
    const update=()=>{apply.disabled=!/^#?[0-9a-f]{6}$/i.test(input.value.trim());};
    input.addEventListener('input',update);
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apply.click();}});
    apply.onclick=()=>emit(control,'#'+input.value.trim().replace(/^#/,''));
    tools.append(apply);box.append(grid,field,tools);input.focus({preventScroll:true});input.select();
  }

  function enhance(control) {
    if(control.dataset.studioNative || (control.tagName==='SELECT' && control.size>1))return;
    const kind=control.tagName==='SELECT'?'select':control.type;
    const label=control.closest('label');
    const name=control.getAttribute('aria-label')||(label?.textContent||'').replace(control.textContent||'\0','').trim()||
      ({select:'选择选项',date:'选择日期',time:'选择时间',color:'选择颜色'})[kind];
    const wrap=create('span','ui-field ui-field-'+kind),trigger=affordance('', 'ui-trigger');
    const value=create('span','ui-value'),glyph=create('span','ui-trigger-icon');
    if(kind==='color')glyph.classList.add('ui-current-color');else glyph.innerHTML=svg(kind);
    trigger.append(value,glyph);
    trigger.setAttribute('aria-label',name);
    trigger.setAttribute('aria-expanded','false');
    trigger.setAttribute('aria-controls','studio-control-'+(++serial));
    trigger.setAttribute('aria-haspopup',kind==='select'?'listbox':'dialog');
    if(kind==='select')trigger.setAttribute('role','combobox');
    control.dataset.studioNative=kind;
    control.tabIndex=-1;
    control.setAttribute('aria-hidden','true');
    control.before(wrap);wrap.append(trigger,control);
    const sync=()=>{
      trigger.disabled=control.disabled;
      value.textContent=kind==='select'?(control.selectedOptions[0]?.label||'请选择'):
        control.value||({date:'选择日期',time:'选择时间'})[kind];
      if(kind==='color')glyph.style.setProperty('--swatch',control.value);
    };
    control.addEventListener('input',sync);control.addEventListener('change',sync);
    control.addEventListener('focus',()=>trigger.focus({preventScroll:true}));
    control.addEventListener('invalid',()=>trigger.focus());
    new MutationObserver(sync).observe(control,{attributes:true,childList:true,subtree:true,attributeFilter:['disabled','value','selected','label']});
    function open(direction=0) {
      sync();
      if(control.disabled)return;
      if(active?.trigger===trigger){close();return;}
      close();
      if(kind==='select'){showOptions(control,trigger,name,direction);return;}
      const box=surface(trigger,false,name);
      if(box)({date:showDate,time:showTime,color:showColor})[kind](control,box);
    }
    trigger.onclick=e=>{e.preventDefault();open();};
    trigger.addEventListener('keydown',e=>{
      if (kind==='select' && active?.trigger!==trigger && ['ArrowDown','ArrowUp'].includes(e.key)){
        e.preventDefault();open(e.key==='ArrowUp'?-1:1);
      }
    });
    sync();
  }
  function scan(node) {
    if (!(node instanceof Element)) return;
    if (node.matches(selector)) enhance(node);
    node.querySelectorAll(selector).forEach(enhance);
  }
  new MutationObserver(records=>{
    if(active && !active.trigger.isConnected)close();
    for(const record of records)record.addedNodes.forEach(scan);
  }).observe(document.body,{childList:true,subtree:true});
  scan(document.body);

  function confirm(message, caption='放弃修改', cancelCaption='继续编辑') {
    close();
    return new Promise(resolve=>{
      const dialog=create('dialog','s-dialog ui-confirm');
      const form=create('form');form.method='dialog';
      const title=create('h2',null,'确认操作'),text=create('p',null,message);
      const footer=create('div','dlg-footer');
      const cancel=affordance(cancelCaption,'s-btn'),ok=affordance(caption,'s-btn primary');
      cancel.onclick=()=>dialog.close('cancel');ok.onclick=()=>dialog.close('ok');
      footer.append(cancel,ok);form.append(title,text,footer);dialog.append(form);document.body.append(dialog);
      dialog.setAttribute('aria-label',message);
      dialog.addEventListener('close',()=>{resolve(dialog.returnValue==='ok');dialog.remove();},{once:true});
      dialog.showModal();cancel.focus();
    });
  }
  return {close,confirm};
})();
