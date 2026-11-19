/* eslint-disable */
/**
 * Drives the real UI (Playwright + installed Chrome/Edge) against the running dev server:
 * logs in, opens every ribbon button of every module tab, opens the first row of every list (and the "New" form),
 * and reports console errors, failed network calls (4xx/5xx), error boundaries and "Screen not available yet" placeholders.
 *
 *   cd client && node scripts/ui-crawl.cjs            (APP=http://localhost:5173  HEADED=1  ONLY=sales to filter modules by key substring)
 * Requires: a global/local `playwright` package (npm i -g playwright) and Chrome or Edge installed.
 */
const path = require('path');
const cp = require('child_process');
function loadPlaywright() {
  try { return require('playwright'); } catch { /* fall through */ }
  const root = cp.execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(root, 'playwright'));
}
const { chromium } = loadPlaywright();
const APP = process.env.APP || 'http://localhost:5173';
const ONLY = (process.env.ONLY || '').toLowerCase();
const WAIT = Number(process.env.WAIT || 900);

(async () => {
  let browser;
  for (const channel of ['chrome', 'msedge', undefined]) {
    try { browser = await chromium.launch({ headless: !process.env.HEADED, ...(channel ? { channel } : {}) }); break; } catch (e) { /* try next */ }
  }
  if (!browser) { console.error('No usable browser (install Chrome/Edge or run `npx playwright install chromium`)'); process.exit(2); }
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  let step = 'login';
  const issues = [];
  const seen = new Set();
  const add = (kind, msg) => { const k = `${step} | ${kind} | ${msg}`; if (seen.has(k)) return; seen.add(k); issues.push({ step, kind, msg }); console.log(`  ! [${kind}] ${step}: ${msg}`); };

  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (/Failed to load resource/.test(t)) return; add('console', t.slice(0, 300)); } });
  page.on('pageerror', (e) => add('pageerror', String(e.message || e).slice(0, 300)));
  page.on('requestfailed', (r) => { const f = r.failure(); if (f && /aborted/i.test(f.errorText)) return; add('reqfailed', `${r.method()} ${r.url().replace(APP, '')} ${f && f.errorText}`); });
  page.on('response', async (r) => {
    const s = r.status();
    if (s >= 400 && /\/api\//.test(r.url())) {
      let body = '';
      try { body = (await r.text()).slice(0, 200); } catch {}
      add('http' + s, `${r.request().method()} ${r.url().replace(APP, '')} ${body}`);
    }
  });

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  if (await page.locator('input[type=password]').count()) {
    await page.locator('input').first().fill('admin');
    await page.locator('input[type=password]').fill('admin123');
    await page.keyboard.press('Enter');
  }
  await page.waitForSelector('text=HOME', { timeout: 20000 });
  await page.waitForTimeout(1200);

  async function inspect(label) {
    await page.waitForTimeout(WAIT);
    try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch {}
    const area = page.locator('div.absolute.inset-0.overflow-auto.block').first();
    const txt = (await area.innerText({ timeout: 3000 }).catch(() => '')) || '';
    if (/Screen not available yet/.test(txt)) add('placeholder', label);
    if (/This screen crashed/.test(txt)) add('crash', `${label}: ${(txt.match(/This screen crashed\s*([^\n]*)/) || [])[1] || ''}`);
    if (/Access denied/.test(txt)) add('denied', label);
    if (/Something went wrong|Failed to load|Request failed|Network Error|Cannot read|undefined|NaN/.test(txt)) {
      const m = txt.match(/(Something went wrong|Failed to load[^\n]*|Request failed[^\n]*|Network Error|Cannot read[^\n]*|[^\n]*\bundefined\b[^\n]*|[^\n]*\bNaN\b[^\n]*)/);
      add('text', `${label}: ${m ? m[0].slice(0, 160) : ''}`);
    }
    const toasts = await page.locator('div.pointer-events-auto').allInnerTexts().catch(() => []);
    for (const t of toasts) if (t.trim()) add('toast', `${label}: ${t.trim().slice(0, 200)}`);
    return txt;
  }
  async function dismiss() {
    const OV = 'div.fixed.inset-0[class*="z-[100]"]';
    for (let i = 0; i < 4; i++) {
      if (!(await page.locator(OV).count())) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      const b = page.locator(`${OV} button:has-text("Cancel"), ${OV} button:has-text("Close")`);
      if ((await page.locator(OV).count()) && (await b.count())) await b.first().click({ timeout: 1500 }).catch(() => {});
    }
  }
  async function closeAllTabs() {
    await dismiss();
    for (let i = 0; i < 60; i++) {
      const c = page.locator('button[aria-label="Close tab"]');
      if (!(await c.count())) break;
      await c.first().click({ force: true }).catch(() => {});
      const dlg = page.locator('button:has-text("Discard"), button:has-text("Close anyway"), button:has-text("Yes")');
      if (await dlg.count()) await dlg.first().click().catch(() => {});
      await page.waitForTimeout(60);
    }
  }

  const modules = await page.locator('div.h-7.items-end button').allInnerTexts();
  const moduleNames = modules.map((m) => m.trim()).filter(Boolean);
  console.log('modules:', moduleNames.join(', '));
  let screens = 0;
  for (const mod of moduleNames) {
    if (ONLY && !mod.toLowerCase().includes(ONLY)) continue;
    await dismiss();
    await page.locator('div.h-7.items-end button', { hasText: new RegExp(`^${mod}$`) }).first().click();
    await page.waitForTimeout(300);
    const titles = await page.locator('div.h-\\[98px\\] button[title]').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
    console.log(`\n== ${mod}: ${titles.length} ribbon buttons`);
    for (const title of titles) {
      step = `${mod} > ${title}`;
      screens++;
      await closeAllTabs();
      try { await page.locator(`div.h-\\[98px\\] button[title="${title.replace(/"/g, '\\"')}"]`).first().click({ timeout: 4000 }); } catch (e) { add('click', 'ribbon button not clickable'); continue; }
      const txt = await inspect(title);
      // open first row of the list
      const area = page.locator('div.absolute.inset-0.overflow-auto.block').first();
      const row = area.locator('tbody tr').first();
      if (await row.count()) {
        const cell = row.locator('td').nth(1);
        step = `${mod} > ${title} > first row`;
        await ((await cell.count()) ? cell : row).dblclick({ timeout: 4000 }).catch(() => {});
        await inspect(`${title} (first row)`);
        await dismiss();
        const tabs = await page.locator('button[aria-label="Close tab"]').count();
        if (tabs < 2 && !/form|open/i.test(title)) { /* row open may not be supported for report-like grids */ }
      }
      // "New" button on the list toolbar
      const newBtn = area.locator('button:has-text("New")').first();
      if (await newBtn.count() && !(await row.count() === 0 && false)) {
        step = `${mod} > ${title} > New`;
        await page.locator(`div.h-\\[98px\\] button[title="${title.replace(/"/g, '\\"')}"]`).first().click({ timeout: 4000 }).catch(() => {});
        const a2 = page.locator('div.absolute.inset-0.overflow-auto.block').first();
        const nb = a2.locator('button:has-text("New")').first();
        if (await nb.count()) { await nb.click({ timeout: 3000 }).catch(() => {}); await inspect(`${title} (new)`); await dismiss(); }
      }
    }
  }
  console.log(`\n${screens} ribbon screens visited, ${issues.length} issue(s)`);
  for (const i of issues) console.log(` - [${i.kind}] ${i.step}: ${i.msg}`);
  await browser.close();
  process.exit(issues.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
