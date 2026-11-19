// Run against the portable release with Playwright and a local Edge install.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {openRegistration} = require('./layout-browser-helpers.cjs');
const [html, evidence] = process.argv.slice(2);
async function run() {
  if(evidence)fs.mkdirSync(evidence, {recursive:true});
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:900}});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(html)).href);
    const card = page.locator('[data-id=caiyun2025][data-op=copy]');
    await card.waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /改稿|导出给 AI|活动包/);
    await card.click();
    await page.locator('#new-event input').fill('财云系统合伙人大会（新一期演示）');
    await page.locator('button[form=new-event]').click();
    const editor=page.locator('#zb-editor');
    await editor.locator('[data-field=date]').waitFor();
    assert.doesNotMatch(await editor.innerText(), /改稿|导出给 AI|活动包/);
    const eventId=decodeURIComponent(new URL(page.url()).hash.slice('#edit/'.length));
    const readDraft=()=>page.evaluate(id=>window.studio.current(id),eventId);
    const source=await readDraft();
    assert.equal(source.status,'draft');
    assert.equal(source.version,1);
    assert.deepEqual(source.fields.map(f=>f.label),['联系人姓名','单位','电话','参会人数']);
    const peer=await context.newPage();await peer.goto(page.url());
    // A colleague saves while the editor has uncommitted local input.
    await editor.locator('[data-field=date]').fill('2026-12-19');
    await peer.evaluate(async id=>{
      const e=await window.studio.current(id);e.place+='（新会场）';await window.studio.save(e);
    },eventId);
    await editor.locator('[data-act=save]').click();
    await page.waitForFunction(()=>/版本/.test(document.querySelector('#studio-toast').textContent));
    assert.equal((await readDraft()).date,source.date);
    await page.reload();
    await editor.locator('[data-field=date]').fill('2026-12-19');
    await editor.getByRole('button',{name:'逐屏设计',exact:true}).click();
    await editor.locator('[data-ds-tool=title]').click();
    await editor.locator('[data-tab=form]').click();
    await editor.locator('[data-act=add-field]').click();
    await editor.locator('input[data-field-index]').last().fill('职位');
    await editor.locator('[data-act=save]').click();
    await page.waitForFunction(async id=>(await window.studio.current(id)).version===3,eventId);
    assert.equal((await readDraft()).fields.at(-1).required,false);
    await page.locator('[data-act=publish]').click();
    await page.locator('#zb-editor').waitFor({state:'detached'});
    await page.setViewportSize({width:390,height:844});
    await page.locator('.tile-preview[data-id="'+eventId+'"]').click();
    await page.locator('.ze-device .il-player').waitFor();
    await page.locator('#studio-toast:empty').waitFor({state:'attached'});
    if(evidence)await page.screenshot({path:path.join(evidence,'manual-mobile-invite.jpg'),quality:87});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=390),true);
    await openRegistration(page);
    await page.locator('.ze-guest-form [name=company]').fill('测试单位');
    await page.locator('.ze-guest-form [name=name]').fill('测试联系人');
    await page.locator('.ze-guest-form [type=submit]').click();
    await page.locator('.ze-done').waitFor();
    await page.locator('#zb-invite [data-act=exit]').click();
    await page.locator('[data-nav=records]').click();
    await page.locator('.data-index-table tr').filter({hasText:'财云系统合伙人大会（新一期演示）'}).getByRole('link',{name:/查看.*详情/}).click();
    await page.getByRole('cell',{name:'测试单位',exact:true}).waitFor();
    assert.equal(await page.getByRole('cell',{name:'测试单位'}).count(),1);
    assert.equal(await page.evaluate(async()=>(await window.studio.current('caiyun2025')).version),1);
    // Concurrent saves with the same version: exactly one succeeds.
    const beforeRace=await readDraft();
    const race=await Promise.allSettled([page,peer].map((tab,i)=>tab.evaluate(
      ({base,i})=>window.studio.save({...base,place:'并发写入 '+i}),{base:beforeRace,i}
    )));
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await readDraft()).version,beforeRace.version+1);
    assert.deepEqual(errors,[]);
    console.log('Verified real-event copy',eventId,'manual editing → conflict → save → publish → mobile registration.');
  } finally {await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
