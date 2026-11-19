const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [origin, evidence] = process.argv.slice(2);

const beijingMinute = milliseconds => new Date(milliseconds + 8 * 3600000).toISOString().slice(0, 16);

async function run() {
  const browser = await chromium.launch({channel:'msedge', headless:true});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:900}});
    const operator = await context.newPage();
    const errors = [];
    operator.on('pageerror', error => errors.push(error.message));
    await operator.goto(origin);
    await operator.getByLabel('用户名',{exact:true}).fill('定时验收管理员');
    await operator.getByLabel('密码',{exact:true}).fill(randomBytes(24).toString('hex'));
    await operator.getByRole('button',{name:'创建账号并登录'}).click();
    await operator.getByRole('button',{name:'新建活动',exact:true}).click();
    await operator.locator('#new-event input').fill('定时报名验收');
    const created = operator.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/events' && response.request().method() === 'POST');
    await operator.locator('button[form=new-event]').click();
    const {id} = await (await created).json();
    const editor = operator.locator('#zb-editor');
    const start = Math.floor(Date.now() / 60000) * 60000 + 15 * 60000;
    const end = start + 120000;
    const [startDate, startTime] = beijingMinute(start).split('T');
    const [endDate, endTime] = beijingMinute(end).split('T');
    const picker = operator.locator('.ui-popover');
    async function setDate(label, value) {
      await editor.getByRole('button',{name:label,exact:true}).click();
      await picker.getByLabel('输入日期（年-月-日）').fill(value);
      await picker.getByRole('button',{name:'应用',exact:true}).click();
    }
    async function setTime(label, value) {
      const [hour, minute] = value.split(':').map(Number);
      await editor.getByRole('button',{name:label,exact:true}).click();
      await picker.getByRole('spinbutton',{name:'小时'}).fill(String(hour));
      await picker.getByRole('spinbutton',{name:'分钟'}).fill(String(minute));
      await picker.getByRole('button',{name:'应用',exact:true}).click();
    }
    await setDate('报名开始日期', startDate);
    await editor.getByRole('button',{name:'保存草稿',exact:true}).click();
    await operator.getByText('报名开始需要同时填写日期和时间。',{exact:true}).waitFor();
    await setTime('报名开始时间', startTime);
    await setDate('报名截止日期', endDate);
    await setTime('报名截止时间', endTime);
    const saved = operator.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/events/' + id && response.request().method() === 'PUT');
    await editor.getByRole('button',{name:'保存草稿',exact:true}).click();
    assert.deepEqual((await (await saved).json()).registrationSchedule,
      {start:beijingMinute(start),end:beijingMinute(end)});
    await operator.reload();
    await editor.getByRole('button',{name:'报名开始时间',exact:true}).waitFor();
    assert.equal(await editor.getByRole('button',{name:'报名截止时间',exact:true}).innerText(),endTime);
    if(evidence){
      fs.mkdirSync(evidence,{recursive:true});
      await editor.locator('.ze-registration-schedule').scrollIntoViewIfNeeded();
      await operator.screenshot({path:path.join(evidence,'signup-settings.jpg'),quality:86,animations:'disabled'});
    }
    await editor.getByRole('button',{name:'发布',exact:true}).click();
    const review = operator.getByRole('dialog',{name:'确认发布',exact:true});
    await review.getByText(endDate+' '+endTime+'（北京时间）',{exact:true}).waitFor();
    await review.getByRole('button',{name:'确认发布',exact:true}).click();
    const share = operator.getByRole('dialog',{name:'发布成功',exact:true});
    await share.getByText('未开始',{exact:true}).waitFor();
    const publicUrl = await share.getByRole('textbox',{name:'活动短链接'}).inputValue();
    await share.getByRole('button',{name:'关闭',exact:true}).click();

    const mobile = await browser.newPage({viewport:{width:390,height:844}});
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.clock.install();
    // Keep the real published snapshot and shift only its sampled server clock.
    await mobile.route('**/api/public/'+id, async route => {
      const response = await route.fetch();
      await route.fulfill({response,headers:{...response.headers(),'x-invite-server-time':String(start-30000)}});
    });
    await mobile.goto(publicUrl);
    const player = mobile.locator('#zb-invite .il-player');
    for(let page=2;page<=5;page++){
      await player.getByRole('button',{name:'下一屏'}).click();
      await mobile.waitForFunction(index=>document.querySelector('.il-progress')?.getAttribute('aria-valuenow')===String(index),page);
    }
    const form = player.locator('.il-page:not([aria-hidden=true]) form.ze-guest-form');
    const submit = form.locator('button[type=submit]');
    await form.getByRole('button',{name:'未开始',exact:true}).waitFor();
    assert.equal(await submit.isEnabled(),false);
    if(evidence)await mobile.screenshot({path:path.join(evidence,'signup-upcoming.jpg'),quality:86,animations:'disabled'});
    await mobile.clock.fastForward(31000);
    await mobile.waitForFunction(()=>!document.querySelector('.il-page:not([aria-hidden=true]) form button[type=submit]')?.disabled);
    const first = form.locator('input').first();
    await first.fill('时间切换保留输入');
    await mobile.clock.fastForward(120000);
    await form.getByRole('button',{name:'已截止',exact:true}).waitFor();
    assert.equal(await submit.isEnabled(),false);
    assert.equal(await first.inputValue(),'时间切换保留输入');

    const monitor = await context.newPage();
    monitor.on('pageerror', error => errors.push(error.message));
    await monitor.clock.install();
    await monitor.route('**/api/workspace', async route => {
      const response = await route.fetch();
      await route.fulfill({response,headers:{...response.headers(),'x-invite-server-time':String(start-6500)}});
    });
    await monitor.goto(origin);
    const tile = monitor.locator('.tile').filter({hasText:'定时报名验收'});
    await tile.getByText('未开始',{exact:true}).waitFor();
    await monitor.clock.fastForward(7000);
    await tile.getByText('报名中',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('Verified the published timing in the workbench and mobile invitation, including automatic transitions.');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
