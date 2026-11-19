const assert = require('node:assert/strict');

async function openRegistration(page) {
  const player = page.locator('#zb-invite .il-player');
  await player.waitFor();
  const count = Number(await player.getByRole('progressbar').getAttribute('aria-valuemax'));
  assert(count > 0, 'The invitation must contain at least one page');
  for (let index = 0; index < count; index++) {
    const inline = player.locator('.il-page:not([aria-hidden=true]) form.ze-guest-form:visible').first();
    if(await inline.count())return inline;
    const button = player.locator('.il-page:not([aria-hidden=true]) [data-layout-register]:visible').first();
    if (await button.count()) {
      await button.click();
      return page.locator('form.ze-guest-form');
    }
    if (index + 1 < count) {
      await player.getByRole('button', {name:'下一屏'}).click();
      await page.waitForFunction(next =>
        document.querySelector('.il-progress')?.getAttribute('aria-valuenow') === String(next), index + 2);
    }
  }
  throw Error('No accessible registration button in the published invitation');
}

module.exports = {openRegistration};
