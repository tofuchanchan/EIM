/* Invitation page composer. The editor and the public player share the same element renderer. */
window.InviteDesigner = (() => {
  'use strict';
  const tools = {image:'图片',title:'标题',paragraph:'段落',table:'表格',divider:'分割线',textbox:'文本框',button:'按钮'};
  const paths = {
    image:'M3 4h18v16H3z M3 17l5-6 4 4 3-3 6 7 M15.5 8h.01',
    title:'M3 5h13M9.5 5v14M13 10h8m-4 0v9',
    paragraph:'M3 5h18M3 10h15M3 15h18M3 20h10',
    table:'M3 4h18v16H3z M3 9h18M3 14h18M10 4v16',
    divider:'M2 12h20',
    textbox:'M3 4h18v16H3z M7 9h10M7 14h7',
    button:'M4 7h16v10H4z M9 12h6m-2-2 2 2-2 2',
    plus:'M12 4v16M4 12h16', duplicate:'M7 7h13v14H7z M4 17H2V2h14v2',
    remove:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15 M10 9v9m4-9v9',
    up:'m6 14 6-6 6 6',down:'m6 10 6 6 6-6',
    undo:'M8 4 3 9l5 5M3 9h9c5 0 8 2 8 7v2',
    redo:'m16 4 5 5-5 5m5-5h-9c-5 0-8 2-8 7v2',
    play:'m7 3 14 9-14 9z', layers:'m2 8 10-5 10 5-10 5z M2 12l10 5 10-5M2 16l10 5 10-5'
  };
  const svg = key => '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="'+paths[key]+'"/></svg>';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const within = (n,lo,hi) => Math.max(lo, Math.min(hi,n));
  const round = n => Math.round(n*100)/100;
  const uid = () => 'd'+(globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+Math.random().toString(36).slice(2));
  const copy = o => Array.isArray(o)?o.map(copy):o && typeof o==='object'?Object.fromEntries(Object.entries(o).map(([k,v])=>[k,copy(v)])):o;
  const options = (map,value) => Object.entries(map).map(([k,v])=>'<option value="'+esc(k)+'" '+(k===value?'selected':'')+'>'+esc(v)+'</option>').join('');
  const entries = {none:'无动画',fade:'淡入',rise:'向上浮入',slide:'侧向滑入',zoom:'缩放出现'};
  const transitions = {none:'直接切换',slide:'滑动',fade:'淡化',zoom:'缩放'};
  function cmd(action,title,icon,disabled=false,withText=false){
    return '<button type="button" class="ds-cmd '+(withText?'ds-named':'')+'" data-ds-command="'+action+'" aria-label="'+esc(title)+'" title="'+esc(title)+'" '+(disabled?'disabled':'')+'>'+svg(icon)+(withText?esc(title):'')+'</button>';
  }
  function field(label,control,full=false){return '<label class="ds-field '+(full?'ds-full':'')+'"><span>'+label+'</span>'+control+'</label>';}
  function num(label,key,value,min,max,step=1,scope='prop'){
    return field(label,'<input type="number" inputmode="decimal" data-ds-'+scope+'="'+key+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+round(value)+'">');
  }
  function select(label,attr,value,map,full=false){return field(label,'<select '+attr+'>'+options(map,value)+'</select>',full);}
  function color(label,key,value,optional=false){
    return '<div class="ds-field"><label><span>'+label+'</span><input type="color" aria-label="'+label+'" data-ds-prop="'+key+'" value="'+esc(value==='transparent'?'#ffffff':value)+'"></label>'+
      (optional?'<button type="button" class="ds-clear" data-ds-command="transparent" aria-pressed="'+(value==='transparent')+'">透明</button>':'')+'</div>';
  }
  const pane = (title,html) => '<section class="ds-section"><h4>'+title+'</h4><div class="ds-grid">'+html+'</div></section>';
  const upload = (label,attrs) => '<label class="ds-upload">'+svg('image')+esc(label)+'<input type="file" accept="image/jpeg,image/png,image/webp" '+attrs+'></label>';

  function mount(host,event,config={}) {
    const layout=window.InviteLayout;
    const life=new AbortController(), signal=life.signal;
    const notify=msg=>window.studio?.toast(msg);
    const pages=()=>event.design.pages;
    let index=within(config.index || 0,0,pages().length-1), selected='', device=config.device || 'iphone14';
    let pointer=null, busy=false, touchTool=null, groupedInput=null, originalCover=null, active=true;
    const undo=[], redo=[];
    const page=()=>pages()[index];
    const elements=()=>page().elements;
    const current=()=>elements().find(item=>item.id===selected);
    const snapshot=()=>({design:copy(event.design),cover:event.cover,index,selected});
    function checkpoint(previous=snapshot()){
      undo.push(previous);if(undo.length>20)undo.shift();redo.length=0;
    }
    function changed(){config.onChange?.();historyButtons();}
    function restore(from,to){
      if(!from.length)return;
      to.push(snapshot());
      const state=from.pop();
      event.design=state.design;event.cover=state.cover;index=state.index;selected=state.selected;groupedInput=null;
      config.onPage?.(index);render();changed();
    }
    host.innerHTML='<div class="ds-studio">'+
      '<aside class="ds-rail"><section class="ds-toolbox"><h3>组件库</h3><div class="ds-tools">'+
      Object.entries(tools).map(([key,name])=>'<button type="button" draggable="true" class="ds-tool" data-ds-tool="'+key+'" title="点击添加或拖入画布">'+svg(key)+'<span>'+name+'</span></button>').join('')+'</div></section>'+
      '<section class="ds-pages"><header><h3>页面</h3>'+cmd('add-page','添加页面','plus')+'</header><div class="ds-page-list"></div><div class="ds-page-actions"></div></section></aside>'+
      '<section class="ds-work"><header class="ds-work-head">'+window.DeviceCover.renderDeviceSelect(device)+'<div class="ds-history">'+cmd('undo','撤销','undo')+cmd('redo','重做','redo')+'</div></header>'+
      '<div class="ds-stage"><div class="ds-frame"><div class="ds-board il-canvas" data-ds-canvas tabindex="0" aria-label="邀请函设计画布"></div><div class="ds-frame-foot"></div></div></div>'+
      '<footer class="ds-work-foot"><span class="ds-status"></span><span class="ds-screen-size"></span></footer></section>'+
      '<aside class="ds-inspector"><nav class="ds-inspect-tabs"><button type="button" data-ds-command="page-settings">页面设置</button><button type="button" data-ds-command="item-settings">组件属性</button></nav><div class="ds-properties"></div></aside></div>';
    const $=s=>host.querySelector(s);
    const root=$('.ds-studio'),stage=$('.ds-stage'),board=$('[data-ds-canvas]'),frame=$('.ds-frame');
    function fit(){
      const select=$('[data-device-preset]');
      const dims=select?.selectedOptions[0]?.textContent.match(/(\d+)\s*×\s*(\d+)$/);
      const width=Number(dims?.[1]||390), height=Number(dims?.[2]||844);
      const scale=Math.max(.1,Math.min(1,(stage.clientWidth-30)/(width+6),(stage.clientHeight-20)/(height+6)));
      frame.style.width=(width*scale+6)+'px';
      board.style.height=((height-46)*scale)+'px';
      $('.ds-frame-foot').style.height=(46*scale)+'px';
      $('.ds-screen-size').textContent=width+' × '+height;
    }
    const resize=new ResizeObserver(fit);resize.observe(stage);
    function historyButtons(){
      $('[data-ds-command=undo]').disabled=!undo.length;
      $('[data-ds-command=redo]').disabled=!redo.length;
    }
    function rows(){
      $('.ds-page-list').innerHTML=pages().map((p,i)=>{
        const mini=p.elements.slice(0,12).map(el=>{
          const isImage=el.type==='image',bg=el.style.background==='transparent'?(isImage?'#b9b6cf':el.style.color):el.style.background;
          return '<i style="left:'+el.x+'%;top:'+el.y+'%;width:'+el.w+'%;height:'+Math.min(el.h,isImage?100:4)+'%;background:'+esc(bg)+'"></i>';
        }).join('');
        return '<button type="button" draggable="true" class="ds-page-row" data-ds-page-index="'+i+'" aria-pressed="'+(i===index)+'" title="点击编辑，拖动调整页序"><span class="ds-mini" aria-hidden="true" style="background:'+esc(p.background)+'">'+mini+'</span><span><small>'+String(i+1).padStart(2,'0')+'</small><b>'+esc(p.name||'未命名页')+'</b></span></button>';
      }).join('');
      $('.ds-page-actions').innerHTML=cmd('page-up','页面上移','up',index===0)+cmd('page-down','页面下移','down',index===pages().length-1)+cmd('duplicate-page','复制页面','duplicate',pages().length>=80)+cmd('delete-page','删除页面','remove',pages().length===1);
      $('.ds-frame-foot').innerHTML='<span>'+String(index+1).padStart(2,'0')+' / '+String(pages().length).padStart(2,'0')+'</span><span>'+esc(page().name||'未命名页')+'</span>';
      $('.ds-status').textContent='第 '+(index+1)+' 屏 · '+elements().length+' 个组件';
    }
    function elementMarkup(el){
      const pick=el.id===selected;
      const html=layout.elementHTML(el,event,{editor:true});
      const handles=pick?['nw','ne','sw','se'].map(c=>'<i class="ds-handle" data-ds-handle="'+c+'"></i>').join(''):'';
      return '<div class="il-element il-type-'+el.type+' ds-object'+(pick?' ds-selected':'')+'" tabindex="0" role="button" aria-label="选择'+tools[el.type]+'" data-ds-type="'+el.type+'" data-ds-element="'+esc(el.id)+'" style="'+esc(layout.elementStyle(el))+'">'+html+handles+'</div>';
    }
    function renderBoard(){
      board.style.background=page().background;
      board.innerHTML=elements().map(elementMarkup).join('');
    }
    function pagePanel(){
      return '<div class="ds-prop-heading"><small>第 '+(index+1)+' 屏</small><h3>'+esc(page().name||'页面设置')+'</h3></div>'+
        pane('页面',field('页面名称','<input data-ds-name maxlength="100" value="'+esc(page().name)+'">',true)+
        field('页面底色','<input type="color" data-ds-page-bg value="'+esc(page().background)+'">')+
        select('进入此页时','data-ds-page-transition',page().transition,transitions))+
        pane('分享封面','<div class="ds-full ds-cover">'+(event.cover?'<img alt="当前分享封面" src="'+esc(event.cover)+'">':'')+
        upload(event.cover?'更换封面':'上传并裁剪封面','data-ds-cover')+(event.cover?'<button type="button" class="ds-inline" data-ds-command="recrop-cover">再次裁剪</button>':'')+'</div>')+
        pane('当前页图层','<div class="ds-layer-list ds-full">'+(elements().length?elements().slice().reverse().map(o=>'<button type="button" data-ds-layer="'+esc(o.id)+'">'+svg(o.type)+'<span>'+esc((o.content.text || o.content.alt || tools[o.type]).slice(0,48))+'</span></button>').join(''):'<p>从组件库添加第一个组件。</p>')+'</div>');
    }
    function contentControls(el){
      const c=el.content;
      if(el.type==='image'){
        return '<div class="ds-full">'+upload('上传图片','data-ds-image')+'<button type="button" class="ds-inline" data-ds-command="cover-image">使用分享封面</button></div>'+
          field('图片说明','<input maxlength="100" data-ds-prop="alt" value="'+esc(c.alt)+'">',true)+select('适应方式','data-ds-prop="fit"',c.fit,{cover:'填满裁切',contain:'完整显示'});
      }
      if(el.type==='divider')return '';
      if(el.type==='table'){
        const grid=c.rows.map((r,i)=>'<tr>'+r.map((v,j)=>'<td><input aria-label="第'+(i+1)+'行第'+(j+1)+'列" maxlength="2000" data-ds-cell="'+i+','+j+'" value="'+esc(v)+'"></td>').join('')+'</tr>').join('');
        return select('表格线','data-ds-prop="lines"',c.lines||'grid',{grid:'网格',ruled:'横线'},true)+'<div class="ds-full ds-table-edit"><table><tbody>'+grid+'</tbody></table></div><div class="ds-full ds-table-actions">'+
          [['add-row','加行'],['remove-row','减行'],['add-column','加列'],['remove-column','减列']].map(([k,l])=>'<button type="button" data-ds-command="'+k+'">'+l+'</button>').join('')+'</div>';
      }
      let controls=field(el.type==='button'?'按钮文字':'文字','<textarea rows="3" maxlength="'+(el.type==='button'?100:8000)+'" data-ds-prop="text">'+esc(c.text)+'</textarea>',true);
      if(el.type==='button'){
        controls+=select('用途','data-ds-prop="action"',c.action,{register:'打开报名表', 'inline-register':'在本页显示报名表',link:'打开链接'},true);
        if(c.action==='link')controls+=field('目标链接','<input type="url" maxlength="2048" data-ds-prop="url" placeholder="https://" value="'+esc(c.url)+'">',true);
        if(c.action==='inline-register')controls+='<p class="ds-full">报名字段和必填规则在「表单」中编辑。</p>';
      }else controls+='<details class="ds-bindings ds-full"><summary>插入活动信息</summary><div>'+
        [['title','活动名'],['date','日期'],['time','时间'],['place','地点']].map(([k,v])=>'<button type="button" data-ds-binding="'+k+'">'+v+'</button>').join('')+'</div></details>';
      return controls;
    }
    function itemPanel(el){
      const s=el.style, a=el.animation;
      const textual=!['image','divider'].includes(el.type);
      const content=contentControls(el);
      const style=(textual?num('字号（px）','fontSize',s.fontSize,8,120)+select('字重','data-ds-prop="bold"',String(s.bold),{false:'常规',true:'粗体'})+
        select('字体','data-ds-prop="font"',s.font||'sans',{sans:'黑体',serif:'宋体'})+select('对齐','data-ds-prop="align"',s.align,{left:'左对齐',center:'居中',right:'右对齐'}):'')+
        (el.type!=='image'?color(el.type==='divider'?'线条颜色':'文字颜色','color',s.color):'')+
        color('填充颜色','background',s.background,true)+num('圆角（px）','radius',s.radius,0,128);
      const geom=num('左侧 X（%）','x',el.x,0,100-el.w,.1)+num('顶部 Y（%）','y',el.y,0,100-el.h,.1)+
        num('宽 W（%）','w',el.w,1,100-el.x,.1)+num('高 H（%）','h',el.h,1,100-el.y,.1);
      return '<div class="ds-prop-heading"><small>所选组件</small><h3>'+svg(el.type)+tools[el.type]+'</h3><div class="ds-item-actions">'+
        cmd('raise','上移一层','up',elements().at(-1)===el)+cmd('lower','下移一层','down',elements()[0]===el)+cmd('duplicate-item','复制组件','duplicate')+cmd('delete-item','删除组件','remove')+'</div></div>'+
        (content?pane('内容',content):'')+pane('样式',style)+pane('位置与尺寸',geom)+
        pane('进入动画',select('效果','data-ds-animation="type"',a.type,entries,true)+num('时长（ms）','duration',a.duration,0,5000,50,'animation')+num('延迟（ms）','delay',a.delay,0,5000,50,'animation')+
        '<div class="ds-full">'+cmd('replay','播放效果','play',a.type==='none',true)+'</div>');
    }
    function inspector(){
      const el=current();
      $('[data-ds-command=page-settings]').setAttribute('aria-pressed',String(!el));
      const itemTab=$('[data-ds-command=item-settings]');
      itemTab.setAttribute('aria-pressed',String(Boolean(el)));itemTab.disabled=!elements().length;
      $('.ds-properties').innerHTML=el?itemPanel(el):pagePanel();
    }
    function render(){rows();renderBoard();inspector();historyButtons();fit();}
    function choose(id,focus=false){
      if(selected!==id){selected=id;groupedInput=null;renderBoard();inspector();$('.ds-properties').scrollTop=0;}
      if(focus)board.querySelector('.ds-selected')?.focus({preventScroll:true});
    }
    function go(n){
      index=within(n,0,pages().length-1);selected='';groupedInput=null;
      config.onPage?.(index);render();
      root.querySelector('[data-ds-page-index="'+index+'"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
    }
    function capacity(add){
      if(elements().length>=64 || pages().reduce((n,p)=>n+p.elements.length,0)+add>1200){notify('组件数量已达上限。');return false;}
      return true;
    }
    function imageBytes(src){
      if(!src || !src.startsWith('data:'))return 0;
      const length=src.length-src.indexOf(',')-1;
      return Math.floor(length*3/4)-(src.endsWith('==')?2:src.endsWith('=')?1:0);
    }
    function checkImageBudget(delta){
      if(delta<=0)return true;
      let total=imageBytes(event.cover);
      for(const p of pages())for(const el of p.elements)if(el.type==='image')total+=imageBytes(el.content.src);
      if(total+delta<=8*1024*1024)return true;
      notify('封面与组件图片合计最多 8 MiB，请缩小图片或移除其他图片。');return false;
    }
    function clickPlacement(item){
      // A full-bleed back layer is a backdrop; ordinary blocks reserve space.
      const blocks=elements().filter((el,i)=>!(i===0&&el.type==='image'&&el.w>=98&&el.h>=98));
      const anchor=blocks.find(el=>el.id===selected)||blocks.at(-1), gap=2;
      const startX=within(anchor?.x??(100-item.w)/2,0,100-item.w);
      const below=anchor?anchor.y+anchor.h+gap:7;
      const startY=below+item.h<=100?below:7;
      const axis=(list,max)=>[...new Set(list.map(v=>round(within(v,0,max))))];
      const xs=axis([startX,4,...blocks.flatMap(el=>[el.x,el.x+el.w+gap,el.x-item.w-gap]),0,100-item.w],100-item.w)
        .sort((a,b)=>Math.abs(a-startX)-Math.abs(b-startX));
      const ys=axis([startY,7,...blocks.flatMap(el=>[el.y+el.h+gap,el.y-item.h-gap]),0,100-item.h],100-item.h);
      let best={x:startX,y:startY},score=Infinity;
      for(const y of ys)for(const x of xs){
        const occupied=blocks.reduce((sum,el)=>{
          const w=Math.min(x+item.w,el.x+el.w+1)-Math.max(x,el.x-1);
          const h=Math.min(y+item.h,el.y+el.h+1)-Math.max(y,el.y-1);
          return sum+Math.max(w,0)*Math.max(h,0);
        },0);
        if(!occupied)return {x,y};
        if(occupied<score){score=occupied;best={x,y};}
      }
      return best;
    }
    function insert(type,x,y){
      if(!Object.hasOwn(tools,type)||!capacity(1))return;
      const item=layout.makeElement(type);
      if(x==null||y==null)Object.assign(item,clickPlacement(item));
      else{
        item.x=round(within(x-item.w/2,0,100-item.w));
        item.y=round(within(y-item.h/2,0,100-item.h));
      }
      checkpoint();elements().push(item);selected=item.id;groupedInput=null;render();changed();
      board.focus({preventScroll:true});
    }
    function locate(clientX,clientY){
      const b=board.getBoundingClientRect();
      if(clientX<b.left||clientX>b.right||clientY<b.top||clientY>b.bottom)return null;
      return {x:100*(clientX-b.left)/b.width,y:100*(clientY-b.top)/b.height};
    }
    function applyGeometry(el,key,val){
      if(key==='x')el.x=round(within(val,0,100-el.w));
      if(key==='y')el.y=round(within(val,0,100-el.h));
      if(key==='w')el.w=round(within(val,1,100-el.x));
      if(key==='h')el.h=round(within(val,1,100-el.y));
    }
    function events(type,handler,extra={}){root.addEventListener(type,handler,{signal,...extra});}
    events('pointerdown',e=>{
      if(busy||!e.isPrimary||e.button!==0)return;
      const tool=e.target.closest('[data-ds-tool]');
      if(tool && e.pointerType!=='mouse'){
        touchTool={id:e.pointerId,type:tool.dataset.dsTool,x:e.clientX,y:e.clientY,drag:false};
        tool.setPointerCapture(e.pointerId);return;
      }
      if(!board.contains(e.target))return;
      const node=e.target.closest('[data-ds-element]');
      if(!node){choose('');return;}
      const grip=e.target.closest('[data-ds-handle]')?.dataset.dsHandle;
      choose(node.dataset.dsElement,true);
      const el=current(), bounds=board.getBoundingClientRect();
      pointer={id:e.pointerId,x:e.clientX,y:e.clientY,bounds,initial:{x:el.x,y:el.y,w:el.w,h:el.h},grip,moved:false};
      board.setPointerCapture(e.pointerId);e.preventDefault();
    });
    events('pointermove',e=>{
      if(touchTool?.id===e.pointerId){
        if(Math.hypot(e.clientX-touchTool.x,e.clientY-touchTool.y)>6){touchTool.drag=true;board.classList.toggle('ds-drop',Boolean(locate(e.clientX,e.clientY)));}
        return;
      }
      if(pointer?.id!==e.pointerId)return;
      const p=pointer,dx=100*(e.clientX-p.x)/p.bounds.width,dy=100*(e.clientY-p.y)/p.bounds.height;
      if(!p.moved && Math.hypot(e.clientX-p.x,e.clientY-p.y)<2)return;
      if(!p.moved){p.moved=true;p.before=snapshot();}
      const el=current(),g=p.initial,grip=p.grip;
      if(!grip){
        el.x=round(within(g.x+dx,0,100-g.w));el.y=round(within(g.y+dy,0,100-g.h));
        const snapX=!e.altKey&&Math.abs(el.x+g.w/2-50)*p.bounds.width/100<4;
        const snapY=!e.altKey&&Math.abs(el.y+g.h/2-50)*p.bounds.height/100<4;
        if(snapX)el.x=round((100-g.w)/2);if(snapY)el.y=round((100-g.h)/2);
        board.classList.toggle('ds-guide-x',snapX);board.classList.toggle('ds-guide-y',snapY);
      }
      else {
        const left=grip.endsWith('w'),top=grip.startsWith('n');
        el.x=left?round(within(g.x+dx,0,g.x+g.w-1)):g.x;
        el.y=top?round(within(g.y+dy,0,g.y+g.h-1)):g.y;
        el.w=round(left?g.x+g.w-el.x:within(g.w+dx,1,100-g.x));
        el.h=round(top?g.y+g.h-el.y:within(g.h+dy,1,100-g.y));
      }
      const wrapper=board.querySelector('.ds-selected');
      for(const [key,property] of [['x','left'],['y','top'],['w','width'],['h','height']]){
        wrapper.style[property]=el[key]+'%';
        const control=$('[data-ds-prop="'+key+'"]');if(control)control.value=el[key];
      }
    });
    let ignoreClickUntil=0;
    function finishPointer(e){
      if(touchTool?.id===e.pointerId){
        const t=touchTool;touchTool=null;board.classList.remove('ds-drop');
        if(t.drag){
          ignoreClickUntil=performance.now()+400;
          const at=locate(e.clientX,e.clientY);
          if(at&&e.type!=='pointercancel')insert(t.type,at.x,at.y);
        }
      }
      if(pointer?.id!==e.pointerId)return;
      const p=pointer;pointer=null;
      board.classList.remove('ds-guide-x','ds-guide-y');
      if(p.moved){
        if(e.type==='pointercancel')Object.assign(current(),p.initial);
        else {checkpoint(p.before);changed();}
        rows();renderBoard();inspector();
      }
    }
    events('pointerup',finishPointer);events('pointercancel',finishPointer);
    let draggingTool='',draggingPage=null;
    function clearDrag(){
      draggingTool='';draggingPage=null;board.classList.remove('ds-drop');
      root.querySelector('.ds-page-over')?.classList.remove('ds-page-over');
    }
    events('dragstart',e=>{
      const tool=e.target.closest('[data-ds-tool]');
      const pg=e.target.closest('[data-ds-page-index]');
      if(pg&&!busy){
        draggingPage=Number(pg.dataset.dsPageIndex);e.dataTransfer.effectAllowed='move';
        e.dataTransfer.setData('application/x-invite-page',String(draggingPage));return;
      }
      if(!tool||busy){e.preventDefault();return;}
      draggingTool=tool.dataset.dsTool;e.dataTransfer.effectAllowed='copy';
      e.dataTransfer.setData('application/x-invite-component',draggingTool);
    });
    events('dragover',e=>{
      if(draggingTool && board.contains(e.target)){e.preventDefault();e.dataTransfer.dropEffect='copy';board.classList.add('ds-drop');}
      const pg=e.target.closest('[data-ds-page-index]');
      if(draggingPage!==null && pg){
        e.preventDefault();e.dataTransfer.dropEffect='move';
        root.querySelector('.ds-page-over')?.classList.remove('ds-page-over');
        pg.classList.add('ds-page-over');
      }
    });
    events('dragleave',e=>{if(board.contains(e.target)&&!board.contains(e.relatedTarget))board.classList.remove('ds-drop');});
    events('drop',e=>{
      const pg=e.target.closest('[data-ds-page-index]');
      if(draggingPage!==null && pg){
        e.preventDefault();
        const from=draggingPage,to=Number(pg.dataset.dsPageIndex);clearDrag();
        if(from!==to){checkpoint();const [item]=pages().splice(from,1);pages().splice(to,0,item);go(to);changed();}
        return;
      }
      const at=locate(e.clientX,e.clientY);
      if(!at||!draggingTool)return;
      e.preventDefault();insert(draggingTool,at.x,at.y);draggingTool='';board.classList.remove('ds-drop');
    });
    events('dragend',clearDrag);
    function modify(fn){checkpoint();groupedInput=null;fn();render();changed();}
    function play(el){
      const component=board.querySelector('.ds-selected');
      if(!component||el.animation.type==='none'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      // Replay exactly the same keyframes, duration and delay as the visitor sees.
      component.style.animation='none';void component.offsetWidth;
      component.style.animation='il-'+el.animation.type+' '+el.animation.duration+'ms cubic-bezier(.19,.73,.25,1) '+el.animation.delay+'ms backwards';
    }
    function newPage(duplicate){
      if(pages().length>=80 || (duplicate && pages().reduce((n,p)=>n+p.elements.length,0)+elements().length>1200)){notify('页面或组件数量已达上限。');return;}
      if(duplicate&&!checkImageBudget(elements().reduce((sum,el)=>sum+(el.type==='image'?imageBytes(el.content.src):0),0)))return;
      checkpoint();
      const fresh=duplicate?copy(page()):layout.makePage('新页面');
      if(duplicate){fresh.id=uid();fresh.name=(fresh.name.slice(0,94)+' 副本');fresh.elements.forEach(el=>el.id=uid());}
      pages().splice(index+1,0,fresh);go(index+1);changed();
    }
    function command(action){
      const el=current(),arr=elements();
      if(action==='undo'||action==='redo'){action==='undo'?restore(undo,redo):restore(redo,undo);return;}
      if(action==='page-settings'){choose('');inspector();return;}
      if(action==='item-settings'){choose(el?.id||arr.at(-1)?.id||'');return;}
      if(action==='add-page'||action==='duplicate-page'){newPage(action==='duplicate-page');return;}
      if(action==='page-up'||action==='page-down'){
        const other=index+(action==='page-up'?-1:1);
        if(other<0||other>=pages().length)return;
        checkpoint();[pages()[index],pages()[other]]=[pages()[other],pages()[index]];go(other);changed();return;
      }
      if(action==='delete-page'&&pages().length>1){checkpoint();pages().splice(index,1);go(Math.min(index,pages().length-1));changed();notify('页面已删除，可撤销');return;}
      if(action==='recrop-cover'){readImage(originalCover||event.cover,true);return;}
      if(!el)return;
      if(action==='replay'){play(el);return;}
      const at=arr.indexOf(el);
      if(action==='raise'||action==='lower'){
        const dest=at+(action==='raise'?1:-1);if(dest<0||dest>=arr.length)return;
        modify(()=>{[arr[at],arr[dest]]=[arr[dest],arr[at]];});return;
      }
      if(action==='duplicate-item'&&capacity(1)){
        if(el.type==='image'&&!checkImageBudget(imageBytes(el.content.src)))return;
        modify(()=>{const item=copy(el);item.id=uid();item.x=round(Math.min(100-item.w,item.x+2));item.y=round(Math.min(100-item.h,item.y+2));arr.splice(at+1,0,item);selected=item.id;});return;
      }
      if(action==='delete-item'){modify(()=>{arr.splice(at,1);selected='';});return;}
      if(action==='cover-image'){modify(()=>{el.content.src='@cover';});return;}
      if(action==='transparent'){modify(()=>{el.style.background='transparent';});return;}
      if(el.type==='table'){
        const grid=el.content.rows,cols=grid[0].length;
        if(action==='add-row'&&grid.length<50)modify(()=>grid.push(Array(cols).fill('')));
        if(action==='remove-row'&&grid.length>1)modify(()=>grid.pop());
        if(action==='add-column'&&cols<12)modify(()=>grid.forEach(row=>row.push('')));
        if(action==='remove-column'&&cols>1)modify(()=>grid.forEach(row=>row.pop()));
      }
    }
    events('click',e=>{
      if(busy||performance.now()<ignoreClickUntil)return;
      const tool=e.target.closest('[data-ds-tool]'),op=e.target.closest('[data-ds-command]'),pg=e.target.closest('[data-ds-page-index]');
      if(tool)insert(tool.dataset.dsTool);
      else if(op)command(op.dataset.dsCommand);
      else if(pg)go(Number(pg.dataset.dsPageIndex));
      else if(e.target.closest('[data-ds-layer]'))choose(e.target.closest('[data-ds-layer]').dataset.dsLayer,true);
      else if(e.target.closest('[data-ds-binding]')&&current()){
        const key=e.target.closest('[data-ds-binding]').dataset.dsBinding;
        if(current().content.text.length+key.length+4<=8000)modify(()=>{current().content.text+='{{'+key+'}}';});
      }
    });
    events('keydown',e=>{
      if(busy||e.target.closest('input,textarea,select'))return;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){
        e.preventDefault();command(e.shiftKey?'redo':'undo');return;
      }
      if(e.ctrlKey&&e.key.toLowerCase()==='y'){e.preventDefault();command('redo');return;}
      if(!board.contains(e.target))return;
      const target=e.target.closest('[data-ds-element]');
      if(target&&['Enter',' '].includes(e.key)){e.preventDefault();choose(target.dataset.dsElement,true);return;}
      const el=current();if(!el)return;
      if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();command('delete-item');board.focus();return;}
      const keys={ArrowLeft:['x',-1],ArrowRight:['x',1],ArrowUp:['y',-1],ArrowDown:['y',1]};
      if(!keys[e.key])return;
      e.preventDefault();const [key,delta]=keys[e.key];
      modify(()=>applyGeometry(el,key,el[key]+delta*(e.shiftKey?2:.25)));
      board.querySelector('.ds-selected')?.focus({preventScroll:true});
    });
    async function readImage(source,isCover){
      if(!source||busy)return;
      const el=current(), originalEvent=event;
      if(!isCover && el?.type!=='image')return;
      busy=true;config.onBusy?.(true);
      try{
        const data=await window.DeviceCover.crop(source,{preset:device,aspect:isCover?'device':'free'});
        if(!data||!active)return;
        if(!checkImageBudget(imageBytes(data)-imageBytes(isCover?event.cover:el.content.src)))return;
        modify(()=>{if(isCover){originalEvent.cover=data;originalCover=source;}else el.content.src=data;});
      }catch(error){notify(error.message||'图片读取失败');}
      finally{busy=false;if(active)config.onBusy?.(false);}
    }
    function edit(control,commit=false){
      const el=current(),key=control.dataset.dsProp,animation=control.dataset.dsAnimation;
      if(!control.matches('[data-ds-name],[data-ds-page-bg],[data-ds-page-transition],[data-ds-prop],[data-ds-animation],[data-ds-cell]'))return;
      if(control.type==='number'&&(control.value===''||!Number.isFinite(control.valueAsNumber)))return;
      if(control!==groupedInput){checkpoint();groupedInput=control;}
      const value=control.value;
      if(control.hasAttribute('data-ds-name'))page().name=value;
      else if(control.hasAttribute('data-ds-page-bg'))page().background=value;
      else if(control.hasAttribute('data-ds-page-transition'))page().transition=value;
      else if(!el)return;
      else if(control.dataset.dsCell){
        const [r,c]=control.dataset.dsCell.split(',').map(Number);el.content.rows[r][c]=value;
      }else if(animation)el.animation[animation]=animation==='type'?value:Math.round(within(Number(value),0,5000));
      else if(['x','y','w','h'].includes(key))applyGeometry(el,key,Number(value));
      else if(['url','alt','fit','action','text','lines'].includes(key)){
        if(key==='action'&&value==='inline-register'&&el.content.action!==value){
          el.h=Math.max(el.h,54);el.w=Math.max(el.w,70);
          el.y=Math.min(el.y,100-el.h);el.x=Math.min(el.x,100-el.w);
        }
        el.content[key]=value;
      }
      else if(key==='fontSize')el.style.fontSize=Math.round(within(Number(value),8,120));
      else if(key==='radius')el.style.radius=Math.round(within(Number(value),0,128));
      else if(key==='bold')el.style.bold=value==='true';
      else if(['color','background','align','font'].includes(key))el.style[key]=value;
      renderBoard();rows();changed();
      if(commit && (key==='action'||animation==='type'))inspector();
      if(commit && control.type==='number'){
        control.value=animation?el.animation[animation]:Object.hasOwn(el,key)?el[key]:el.style[key];
        const limits={x:100-el.w,y:100-el.h,w:100-el.x,h:100-el.y};
        for(const [prop,max] of Object.entries(limits)){
          const input=$('[data-ds-prop="'+prop+'"]');if(input)input.max=round(max);
        }
      }
      if(commit && animation==='type'&&el)play(el);
    }
    events('input',e=>{if(!busy)edit(e.target);});
    events('change',e=>{
      if(busy)return;
      const t=e.target;
      if(t.matches('[data-ds-image],[data-ds-cover]')){const f=t.files?.[0];if(f)readImage(f,t.hasAttribute('data-ds-cover'));t.value='';return;}
      if(t.matches('[data-device-preset]')){device=t.value;config.onDevice?.(device);fit();return;}
      edit(t,true);
    });
    render();
    return {get index(){return index;},destroy(){active=false;life.abort();resize.disconnect();}};
  }
  return Object.freeze({mount});
})();
