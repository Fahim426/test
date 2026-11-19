/* Opens every screen (lists + 'new' forms) of my folders; reports console/api errors + error boundaries. node scripts/review-crawl.cjs [theme] ; screenshots -> ../.shots/crawl/ */
const path = require('path'), cp = require('child_process'), fs = require('fs');
function lp() { try { return require('playwright'); } catch {} return require(path.join(cp.execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); }
const APP = 'http://localhost:5174'; const theme = process.argv[2] || 'light';
const OUT = path.join(__dirname, '..', '..', '.shots', 'crawl'); fs.mkdirSync(OUT, { recursive: true });
const root = path.join(__dirname, '..', 'src', 'screens');
const ids = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== 'home') walk(p); } else if (/\.screen\.tsx$/.test(f.name)) { const t = fs.readFileSync(p, 'utf8'); for (const m of t.matchAll(/\bid: '([a-z0-9-]+)'/g)) ids.push(m[1]); } } })(root);
(async () => {
  const b = await lp().chromium.launch({ channel: 'chrome' });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  let cur = ''; const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|\[hmr\]/.test(m.text())) errs.push(`${cur}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errs.push(`${cur}: PAGEERR ${String(e.message).slice(0, 200)}`));
  page.on('response', (r) => { if (r.status() >= 400 && /\/api\//.test(r.url()) && !/refresh/.test(r.url())) errs.push(`${cur}: HTTP ${r.status()} ${r.url().replace(APP, '')}`); });
  await page.goto(APP); await page.waitForTimeout(1000);
  if (await page.locator('input[type=password]').count()) { await page.locator('input').first().fill('ui-review'); await page.locator('input[type=password]').fill('Review#123'); await page.keyboard.press('Enter'); await page.waitForTimeout(2500); }
  for (const id of ids) {
    cur = `${id}/${theme}`;
    await page.evaluate(({ id, theme }) => {
      const ui = JSON.parse(localStorage.getItem('ss-ui')); ui.state.theme = theme; localStorage.setItem('ss-ui', JSON.stringify(ui));
      localStorage.setItem('ss-workspace', JSON.stringify({ state: { tabs: [{ id: 'tx', screenId: id, title: id, params: {}, instanceKey: id + ':x', pinned: false, refreshKey: 0 }], activeId: 'tx', closed: [] }, version: 1 }));
    }, { id, theme });
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
    const txt = await page.evaluate(() => document.body.innerText);
    if (/Something went wrong|crashed|not available yet/i.test(txt)) errs.push(`${cur}: ERROR BOUNDARY / placeholder`);
    if (theme==='dark') { const bad = await page.evaluate(() => { const out=[]; document.querySelectorAll('body *').forEach((e)=>{ const r=e.getBoundingClientRect(); if(r.width*r.height<1500||r.left<260) return; const c=getComputedStyle(e).backgroundColor.match(/[d.]+/g); if(!c||(c[3]!==undefined&&+c[3]<0.5)) return; const l=(0.299*c[0]+0.587*c[1]+0.114*c[2]); if(l>170) out.push(e.tagName+'.'+String(e.className).slice(0,60)+' '+Math.round(r.width)+'x'+Math.round(r.height)); }); return out.slice(0,3); }); if (bad.length) errs.push(`${cur}: LIGHT-BG ${bad.join(' | ')}`); }
    await page.screenshot({ path: path.join(OUT, `${id}-${theme}.png`) });
  }
  console.log(ids.length, 'screens'); console.log(errs.length ? [...new Set(errs)].join('\n') : 'no errors'); await b.close();
})();
