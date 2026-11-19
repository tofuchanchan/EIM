// Exercise the actual story editor and two independent mobile guests on a fresh HTTP service.
const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [origin, evidence] = process.argv.slice(2);

const {openRegistration}=require('./layout-browser-helpers.cjs');

async function run(){
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const editorContext=await browser.newContext({viewport:{width:1440,height:900}});
    const page=await editorContext.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);
    const login=page.locator('#team-login');
    await login.locator('[name=username]').fill('story-owner');
    await login.locator('[name=password]').fill(randomBytes(22).toString('hex'));
    await login.locator('[type=submit]').click();
    await page.locator('[data-op=new]').first().click();
    await page.locator('#new-event [name=title]').fill('年度伙伴交流私享会');
    assert.equal(await page.locator('#new-event select').count(),0);
    const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/events'&&r.request().method()==='POST');
    await page.locator('[form=new-event]').click();
    const event=await (await created).json();
    assert.equal(event.template,'invitation');
    assert(event.design.pages.length>=2);
    const editor=page.locator('#zb-editor');
    await editor.locator('[data-tab=design]').waitFor();
    assert.equal(await editor.locator('[data-template]').count(),0);
    const tabs=await editor.locator('[data-tab]').allTextContents();
    assert.deepEqual(tabs.map(s=>s.trim()),['基本信息','逐屏设计','表单']);
    await editor.locator('[data-field=date]').fill('2026-12-19');
    await editor.locator('[data-field=place]').fill('深圳 · 会议中心');
    await editor.locator('[data-tab=design]').click();
    const devices=editor.locator('[data-device-preset]:visible').first();
    await devices.selectOption('iphoneSE');
    await devices.selectOption('ratio20');
    assert.equal(await devices.inputValue(),'ratio20');

    const source=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=800;c.height=500;
      const x=c.getContext('2d'),g=x.createLinearGradient(0,0,800,500);
      g.addColorStop(0,'#844948');g.addColorStop(1,'#e89571');x.fillStyle=g;x.fillRect(0,0,800,500);
      return c.toDataURL('image/png').split(',')[1];
    });
    if(!await editor.locator('[data-ds-cover]').count())await editor.locator('[data-ds-command=page-settings]').click();
    await editor.locator('[data-ds-cover]').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from(source,'base64')});
    const crop=page.getByRole('dialog',{name:'裁剪封面'});
    await crop.getByRole('combobox',{name:'裁剪比例'}).click();
    await page.getByRole('option',{name:'自由比例'}).click();
    await crop.locator('[data-dc-corner=nw]').focus();
    const geometry=()=>crop.locator('.dc-box').evaluate(el=>el.getBoundingClientRect().width);
    const beforeWidth=await geometry();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(w=>document.querySelector('.dc-box').getBoundingClientRect().width!==w,beforeWidth);
    await crop.locator('[data-dc-use]').click();

    // Place a new text block, move it on the phone canvas and change its content, style and motion.
    const tools=await editor.locator('[data-ds-tool]').evaluateAll(nodes=>nodes.map(n=>n.dataset.dsTool));
    assert.deepEqual(new Set(tools),new Set(['image','title','paragraph','table','divider','textbox','button']));
    await editor.locator('[data-ds-command=add-page]').click();
    await editor.locator('[data-ds-tool=table]').click();
    await editor.locator('[data-ds-cell="0,0"]').fill('论坛流程');
    await editor.locator('[data-ds-tool=paragraph]').click();
    const selected=editor.locator('[data-ds-element][data-ds-type=paragraph]').last();
    const piece=await selected.boundingBox();
    assert(piece,'Selected component must be visible on the canvas');
    const fromX=piece.x+piece.width/2, fromY=piece.y+piece.height/2;
    await page.mouse.move(fromX,fromY);await page.mouse.down();
    await page.mouse.move(fromX+24,fromY+38,{steps:8});await page.mouse.up();
    const moved=await selected.boundingBox();
    assert(moved && Math.abs(moved.y-piece.y)>5,'Pointer drag moved the component');
    await editor.locator('[data-ds-prop=text]').fill('欢迎到场交流案例。');
    await editor.locator('[data-ds-prop=fontSize]').fill('22');
    await editor.locator('[data-ds-animation=type]').selectOption('rise');
    await editor.locator('[data-ds-animation=duration]').fill('540');
    await editor.locator('[data-ds-animation=delay]').fill('160');
    const board=editor.locator('[data-ds-canvas]');
    const bounds=await board.boundingBox();
    await editor.locator('[data-ds-tool=divider]').dragTo(board,{
      targetPosition:{x:Math.round(bounds.width*.5),y:Math.round(bounds.height*.82)}
    });
    await board.locator('[data-ds-type=divider]').waitFor();
    await editor.locator('[data-ds-command=page-settings]').click();
    await editor.locator('[data-ds-page-transition]').selectOption('fade');
    if(evidence){
      fs.mkdirSync(evidence,{recursive:true});
      await page.screenshot({path:path.join(evidence,'story-editor.jpg'),quality:86,animations:'disabled'});
    }
    await editor.locator('[data-tab=form]').click();
    await editor.locator('[data-unique=phone]').selectOption('phone');
    await editor.locator('[data-unique=wechat]').selectOption('!new');
    const result=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/events/'+event.id+'/publish');
    await editor.locator('[data-act=publish]').click();
    await page.getByRole('button',{name:'确认发布',exact:true}).click();
    const publish=await result;
    const live=await publish.json();
    assert.equal(publish.status(),200,JSON.stringify(live.error));
    assert.equal(live.template,'invitation');
    const savedPage=live.design.pages.find(p=>p.elements.some(el=>el.content.text==='欢迎到场交流案例。'));
    assert(savedPage,'The manipulated block reached the published snapshot');
    assert.equal(savedPage.transition,'fade');
    assert(savedPage.elements.some(el=>el.type==='divider'&&el.y>70));
    assert(savedPage.elements.some(el=>el.type==='table'&&el.content.rows[0][0]==='论坛流程'));
    const savedBlock=savedPage.elements.find(el=>el.content.text==='欢迎到场交流案例。');
    assert.equal(savedBlock.style.fontSize,22);
    assert.deepEqual(savedBlock.animation,{type:'rise',duration:540,delay:160});
    assert.match(live.cover,/^data:image\/jpeg;base64,/);
    const anonymous=await browser.newContext();
    const document=await anonymous.request.get(origin+'/i/'+event.id);
    assert((await document.text()).includes('property="og:image"'));
    const publicCover=await anonymous.request.get(origin+'/api/public/'+event.id+'/cover');
    assert.equal(publicCover.headers()['content-type'],'image/jpeg');
    assert.deepEqual(await publicCover.body(),Buffer.from(live.cover.split(',')[1],'base64'));
    await anonymous.close();
    assert.equal(live.registrationUnique.phone,'phone');
    assert(live.fields.some(f=>f.key===live.registrationUnique.wechat&&f.required));
    const url=origin+'/i/'+event.id;

    for(let attempt=0; attempt<2; attempt++){
      const guest=await browser.newContext({viewport:{width:390,height:844},isMobile:true,
        hasTouch:true,reducedMotion:attempt?'reduce':'no-preference'});
      const mobile=await guest.newPage();
      mobile.on('pageerror',e=>errors.push(e.message));
      await mobile.goto(url);
      const player=mobile.locator('#zb-invite .il-player');
      await player.waitFor();
      await player.focus();await mobile.keyboard.press('ArrowDown');
      assert.equal(await player.getByRole('progressbar').getAttribute('aria-valuenow'),'2');
      const savedIndex=live.design.pages.findIndex(p=>p.id===savedPage.id);
      await mobile.keyboard.press('Home');
      for(let i=0;i<savedIndex;i++)await mobile.keyboard.press('ArrowDown');
      const publicBlock=player.locator('.il-page[data-page-id="'+savedPage.id+'"] [data-element-id="'+savedBlock.id+'"]');
      await publicBlock.waitFor();
      assert.equal((await publicBlock.innerText()).trim(),'欢迎到场交流案例。');
      assert.equal(await publicBlock.getAttribute('data-entry'),'rise');
      assert.equal(await publicBlock.evaluate(n=>n.style.getPropertyValue('--il-duration')),'540ms');
      assert.equal(await publicBlock.evaluate(n=>n.style.getPropertyValue('--il-delay')),'160ms');
      const cell=player.locator('.il-page[data-page-id="'+savedPage.id+'"] table th').first();
      assert.equal((await cell.innerText()).trim(),'论坛流程');
      await mobile.keyboard.press('Home');
      await player.locator('.il-page[aria-hidden=true]').first().waitFor({state:'detached'});
      const form=await openRegistration(mobile);
      await form.locator('[name=name]').fill('陈宁');
      await form.locator('[name=company]').fill('活动测试企业');
      await form.locator('[name=phone]').fill(attempt?'+86 138-0000-2041':'13800002041');
      await form.locator('[name="'+live.registrationUnique.wechat+'"]').fill('visitor_'+attempt);
      const submit=mobile.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/registrations'));
      await form.locator('[type=submit]').click();
      assert.equal((await submit).status(),attempt?409:201);
      if(attempt)await mobile.getByText('该手机号已报名本场活动，请勿重复提交。',{exact:true}).waitFor();
      else await mobile.locator('.ze-done').waitFor();
      assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=390),true);
      await guest.close();
    }
    const data=await (await editorContext.request.get(origin+'/api/workspace')).json();
    assert.equal(data.rows.filter(r=>r.eventId===event.id).length,1);
    assert.deepEqual(errors,[]);
    console.log('Verified drag from toolbox, canvas positioning, content, styles, entry and page animations, published playback and registration limits.');
  } finally {await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
