const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [origin, evidence] = process.argv.slice(2);

async function run() {
  const browser = await chromium.launch({channel:'msedge', headless:true});
  try {
    const operator = await browser.newPage({viewport:{width:1440,height:900}});
    const member = await browser.newPage({viewport:{width:390,height:844}});
    const errors = [];
    for (const page of [operator, member]) page.on('pageerror', error => errors.push(error.message));
    const adminPassword = randomBytes(24).toString('hex');
    const memberPassword = randomBytes(24).toString('hex');
    await operator.goto(origin);
    await operator.getByLabel('用户名',{exact:true}).fill('活动管理员');
    await operator.getByLabel('密码',{exact:true}).fill(adminPassword);
    await operator.getByRole('button',{name:'创建账号并登录'}).click();
    await operator.getByRole('button',{name:'成员管理',exact:true}).click();
    const table = operator.locator('.member-table');
    const newMember = operator.getByRole('button',{name:'新建成员'});
    await table.getByText('当前账号',{exact:true}).waitFor();
    assert.equal(await table.getByRole('combobox').count(),0);

    await newMember.click();
    const form = operator.locator('#member-create form');
    assert.equal(await form.getByRole('combobox',{name:'新成员角色'}).innerText(),'普通成员');
    await form.getByLabel('用户名',{exact:true}).fill('活动同事');
    if (evidence) {
      fs.mkdirSync(evidence,{recursive:true});
      await operator.screenshot({path:path.join(evidence,'member-create.jpg'),quality:86});
    }
    assert.equal(await form.locator('input[type=password]').count(),0);
    await form.getByRole('button',{name:'生成设密链接'}).click();
    const link = operator.getByRole('textbox',{name:'设密链接'});
    await link.waitFor();
    await operator.getByText(/24 小时内有效/).waitFor();
    const setupUrl=await link.inputValue();
    assert.equal(new URL(setupUrl).origin,origin);
    await operator.getByRole('button',{name:'完成',exact:true}).click();
    const row = table.getByRole('row').filter({hasText:'活动同事'});
    await row.getByText('待设密',{exact:true}).waitFor();
    assert.equal(await row.locator('.member-avatar').innerText(),'活');
    assert.equal(await form.isVisible(),false);

    await member.goto(setupUrl);
    await member.getByLabel('新密码',{exact:true}).fill(memberPassword);
    await member.getByLabel('确认新密码',{exact:true}).fill(memberPassword);
    await member.getByRole('button',{name:'保存密码'}).click();
    await member.getByRole('link',{name:'去登录'}).waitFor();
    await member.goto(origin+'/#members');
    await member.getByLabel('用户名',{exact:true}).fill('活动同事');
    await member.getByLabel('密码',{exact:true}).fill(memberPassword);
    await member.getByRole('button',{name:'登录',exact:true}).click();
    await member.getByRole('heading',{name:'活动工作台',exact:true}).waitFor();
    assert.equal(new URL(member.url()).hash,'#home');
    assert.equal(await member.getByRole('button',{name:'成员管理',exact:true}).count(),0);

    const role = row.getByRole('combobox',{name:'活动同事 的角色'});
    await role.focus();
    await role.press('ArrowDown');
    await role.press('End');
    await role.press('Enter');
    await operator.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await role.innerText(),'普通成员');
    await role.click();
    await operator.getByRole('option',{name:'管理员',exact:true}).click();
    await operator.getByRole('button',{name:'确认调整'}).click();
    await row.getByText('全部活动',{exact:true}).waitFor();

    await member.reload();
    await member.getByRole('button',{name:'成员管理',exact:true}).click();
    await member.getByText('当前账号',{exact:true}).waitFor();
    assert(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    await role.click();
    await operator.getByRole('option',{name:'普通成员',exact:true}).click();
    await operator.getByRole('button',{name:'确认调整'}).click();
    await row.getByText('自己创建或复制的活动',{exact:true}).waitFor();
    await member.reload();
    await member.getByRole('heading',{name:'活动工作台',exact:true}).waitFor();
    assert.equal(await member.getByRole('button',{name:'成员管理',exact:true}).count(),0);

    await operator.getByRole('button',{name:'活动工作台',exact:true}).click();
    await operator.getByRole('button',{name:'成员管理',exact:true}).click();
    await row.getByText('已启用',{exact:true}).waitFor();
    await row.getByRole('button',{name:'登录记录'}).click();
    await operator.getByRole('dialog').getByText('127.0.0.1',{exact:true}).waitFor();
    await operator.getByRole('dialog').getByRole('button',{name:'关闭'}).click();
    await row.getByRole('button',{name:'停用',exact:true}).click();
    await operator.getByRole('button',{name:'停用成员',exact:true}).click();
    await row.getByText('已停用',{exact:true}).waitFor();
    await member.getByRole('heading',{name:'登录活动工作台'}).waitFor({timeout:20000});
    await row.getByRole('button',{name:'启用',exact:true}).click();
    await operator.getByRole('button',{name:'启用成员',exact:true}).click();
    await row.getByText('已启用',{exact:true}).waitFor();

    if (evidence) await operator.screenshot({path:path.join(evidence,'member-management.jpg'),quality:86});
    for (const width of [768,390]) {
      await operator.setViewportSize({width,height:844});
      await newMember.click();
      assert(await operator.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await form.getByRole('button',{name:'取消'}).click();
    }
    assert.deepEqual(errors,[]);
    console.log('Verified member creation, sign-in, role confirmation and navigation for both roles.');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
