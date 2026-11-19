/* Screenshot + console-error check for screens. node scripts/review-shots.cjs [name-filter]  -> ../.shots/<name>-<theme>.png  (THEMES=dark WAIT=2200) */
const path = require('path'), cp = require('child_process'), fs = require('fs');
function lp() { try { return require('playwright'); } catch {} return require(path.join(cp.execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); }
const { chromium } = lp();
const APP = process.env.APP || 'http://localhost:5174';
const OUT = path.join(__dirname, '..', '..', '.shots'); fs.mkdirSync(OUT, { recursive: true });
const FILTER = process.argv[2] || '';
const THEMES = (process.env.THEMES || 'light,dark').split(',');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true, channel: 'msedge' }));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  let cur = '';
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(`${cur}: ${m.text().slice(0, 250)}`); });
  page.on('pageerror', (e) => errs.push(`${cur}: PAGEERR ${String(e.message).slice(0, 250)}`));
  page.on('response', (r) => { if (r.status() >= 400 && /\/api\//.test(r.url()) && !/refresh/.test(r.url())) errs.push(`${cur}: HTTP ${r.status()} ${r.request().method()} ${r.url().replace(APP, '')}`); });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  if (await page.locator('input[type=password]').count()) {
    await page.locator('input').first().fill('ui-review'); await page.locator('input[type=password]').fill('Review#123');
    await page.keyboard.press('Enter'); await page.waitForTimeout(2500);
  }
  const { shots } = require('./review-shots.config.cjs');
  for (const s of shots) {
    if (FILTER && !s.name.includes(FILTER)) continue;
    for (const th of THEMES) {
      cur = `${s.name}/${th}`;
      await page.evaluate(({ s, th }) => {
        const ui = JSON.parse(localStorage.getItem('ss-ui') || '{"state":{},"version":0}'); ui.state.theme = th; localStorage.setItem('ss-ui', JSON.stringify(ui));
        const tab = { id: 'tx', screenId: s.screenId, title: s.name, params: s.params || {}, instanceKey: s.screenId + ':' + (s.params && s.params.id || 'x'), pinned: false, refreshKey: 0 };
        localStorage.setItem('ss-workspace', JSON.stringify({ state: { tabs: [tab], activeId: 'tx', closed: [] }, version: 1 }));
      }, { s, th });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(Number(process.env.WAIT || 2200));
      if (s.click) { try { await page.getByText(s.click, { exact: true }).first().click({ timeout: 3000 }); await page.waitForTimeout(800); } catch (e) { errs.push(`${cur}: click ${s.click} failed`); } }
      await page.screenshot({ path: path.join(OUT, `${s.name}${s.click ? '-' + s.click.replace(/\W/g, '') : ''}-${th}.png`), fullPage: false });
    }
  }
  console.log(errs.length ? errs.join('\n') : 'no console errors');
  await browser.close();
})();
