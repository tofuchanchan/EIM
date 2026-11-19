const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const [origin,evidence]=process.argv.slice(2);

async function run(){
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
    const page=await context.newPage(),errors=[],frames=[];
    const submitted=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.method()==='POST')submitted.push(new URL(r.url()).pathname);});
    const styles=['archive','blueprint','salon','poster','ink','neural'];
    const expected=['邀请函首页','诚挚邀请','活动议程','会场导航','受邀回执','参会须知','关于承办方'];
    for(const key of styles){
      await page.goto(origin+'/templates/'+key);
      const deck=page.locator('.il-player');
      for(let i=0;i<7;i++){
        const screen=deck.locator('.il-page:not([aria-hidden=true])');
        await screen.waitFor();
        assert.equal(await screen.getAttribute('aria-label'),expected[i]);
        assert(await screen.locator('.il-element').count()>=4);
        if(i===3){
          assert.equal(await screen.getByRole('img',{name:/位置图/}).count(),1);
          const link=await screen.getByRole('link',{name:'打开地图导航'}).getAttribute('href');
          assert.equal(link,'https://www.amap.com/place/B0FFG9LEY2');
        }
        if(i===4){
          const form=screen.locator('form.ze-guest-form');
          await form.locator('[name=company]').fill('仅用于预览');
          await deck.getByRole('button',{name:'下一屏'}).click();
          await deck.getByRole('button',{name:'上一屏'}).click();
          assert.equal(await form.locator('[name=company]').inputValue(),'仅用于预览');
          await form.locator('[name=company]').fill('');
          await form.locator('[name=company]').blur();
        }
        const overflow=await screen.evaluate(node=>[...node.querySelectorAll('.il-content')].filter(e=>
          e.scrollHeight>e.clientHeight+3||e.scrollWidth>e.clientWidth+3).map(e=>e.parentNode.dataset.elementId));
        assert.deepEqual(overflow,[],key+' '+expected[i]+' clipped elements: '+overflow.join(','));
        if(evidence)frames.push((await page.screenshot({type:'jpeg',quality:82,animations:'disabled'})).toString('base64'));
        if(i<6)await deck.getByRole('button',{name:'下一屏'}).click();
      }
    }
    await page.setViewportSize({width:320,height:568});
    for(const key of styles){
      await page.goto(origin+'/templates/'+key);
      const deck=page.locator('.il-player');
      for(let i=0;i<7;i++){
        const screen=deck.locator('.il-page:not([aria-hidden=true])');
        await screen.waitFor();
        const clipped=await screen.evaluate(n=>[...n.querySelectorAll('.il-content')].filter(e=>
          e.scrollHeight>e.clientHeight+3||e.scrollWidth>e.clientWidth+3).map(e=>e.parentNode.dataset.elementId));
        assert.deepEqual(clipped,[],key+' small '+expected[i]);
        if(i<6)await deck.getByRole('button',{name:'下一屏'}).click();
      }
    }
    await page.goto(origin+'/templates/salon?page=5');
    const form=page.locator('.il-page form.ze-guest-form');
    await form.locator('[name=company]').fill('样式验收');await form.locator('[name=name]').fill('预览');
    await form.locator('[name=phone]').fill('13800000000');await form.getByRole('button',{name:'提交回执'}).click();
    await page.getByRole('heading',{name:'预览提交成功'}).waitFor();
    assert.deepEqual(submitted,[]);
    await page.setViewportSize({width:1440,height:920});
    await page.goto(origin+'/templates');
    const compare=page.getByRole('combobox',{name:'对比同一页'});
    await compare.click();
    await page.getByRole('option',{name:'04 · 会场导航'}).click();
    assert.equal(await page.locator('.gallery-mini img[alt*="位置图"]').count(),6);
    await compare.press('ArrowDown');
    await compare.press('Home');
    await compare.press('Enter');
    if(evidence){
      fs.mkdirSync(evidence,{recursive:true});
      await page.screenshot({path:path.join(evidence,'template-gallery.jpg'),quality:87,animations:'disabled'});
      const overview=await page.evaluate(async shots=>{
        const w=172,h=372,c=document.createElement('canvas');c.width=w*7;c.height=h*(shots.length/7);const ctx=c.getContext('2d');
        await Promise.all(shots.map(async(data,i)=>{const im=new Image();im.src='data:image/jpeg;base64,'+data;await im.decode();ctx.drawImage(im,(i%7)*w,Math.floor(i/7)*h,w,h);}));
        return c.toDataURL('image/jpeg',.91).split(',')[1];
      },frames);
      fs.writeFileSync(path.join(evidence,'forty-two-screens.jpg'),Buffer.from(overview,'base64'));
    }
    await page.locator('.gallery-card').nth(1).getByRole('link',{name:'使用此款'}).click();
    const login=page.locator('#team-login');
    await login.locator('[name=username]').fill('gallery-test');await login.locator('[name=password]').fill(randomBytes(20).toString('hex'));
    await login.locator('[type=submit]').click();
    await page.locator('#new-event [data-look=blueprint][aria-pressed=true]').waitFor();
    const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/events'&&r.request().method()==='POST');
    await page.locator('[form=new-event]').click();
    const resp=await created;assert.equal(resp.status(),201);const draft=await resp.json();
    assert.equal(draft.design.pages.length,7);assert.equal(draft.design.pages[0].background,'#0a1c2b');
    assert.equal(draft.status,'draft');
    assert.deepEqual(errors,[]);
    console.log('Verified 42 mobile screens, gallery comparison, inline RSVP and choosing the selected design after sign-in.');
  }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
