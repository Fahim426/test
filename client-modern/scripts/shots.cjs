/* eslint-disable */
// Visual check: node scripts/shots.cjs [light|dark] [only-substring]
const path = require('path');
const cp = require('child_process');
function loadPlaywright() {
  try { return require('playwright'); } catch {}
  return require(path.join(cp.execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
}
const { chromium } = loadPlaywright();
const APP = process.env.APP || 'http://localhost:5174';
const theme = process.argv[2] || 'light';
const only = process.argv[3] || '';
const out = path.join(__dirname, '..', 'screenshots');
const W = Number(process.env.W || 1600), H = Number(process.env.H || 900);

(async () => {
  let browser;
  for (const channel of ['chrome', 'msedge', undefined]) {
    try { browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) }); break; } catch {}
  }
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript((t) => {
    if (!localStorage.getItem('ss-ui')) localStorage.setItem('ss-ui', JSON.stringify({ state: { theme: t, activeModule: 'home', sidebarCollapsed: false, openModules: { home: true, inventory: true }, density: 'comfortable' }, version: 0 }));
  }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 200)));
  const shot = async (name) => { if (!only || name.includes(only)) await page.screenshot({ path: path.join(out, `${theme}-${name}.png`) }); };
  const wait = (ms) => page.waitForTimeout(ms);

  await page.goto(APP + '/login'); await wait(800);
  await shot('01-login');
  await page.fill('input[autocomplete=username]', 'admin');
  await page.fill('input[autocomplete=current-password]', 'admin123');
  await page.click('button[type=submit]');
  await page.waitForSelector('aside', { timeout: 15000 }); await wait(2500);
  await shot('02-dashboard');

  const openVia = async (label) => { // open via command palette
    await page.keyboard.press('Control+k'); await wait(250);
    await page.keyboard.type(label); await wait(400);
    await page.keyboard.press('Enter'); await wait(1800);
  };
  await openVia('Sales Orders'); await shot('03-sales-orders');
  await openVia('Products'); await shot('04-products');
  // document form: open first sales order
  await openVia('Sales Orders');
  const row = page.locator('tbody tr:visible').first();
  if (await row.count()) { await row.dblclick(); await wait(2500); await shot('05-doc-form'); }
  await openVia('Brands');
  await wait(800);
  await shot('06-brands');
  const nb = page.getByRole('button', { name: 'New', exact: true }).last();
  if (await nb.count()) { await nb.click(); await wait(500); await shot('07-modal'); await page.keyboard.press('Escape'); }
  await openVia('Quick Actions'); await shot('14-quick-actions');
  await openVia('Favorites'); await shot('15-favorites');
  await openVia('Pending Approvals'); await shot('16-approvals');
  await openVia('BP-00135'); await wait(1500); await shot('17-part-lookup');
  await page.keyboard.press('Control+k'); await wait(400); await shot('08-palette-empty');
  await page.keyboard.type('sales'); await wait(900); await shot('09-palette-query');
  await page.keyboard.press('Escape'); await wait(200);
  // new-menu
  await page.getByRole('button', { name: /New/ }).first().click().catch(() => {}); await wait(300); await shot('10-new-menu'); await page.keyboard.press('Escape');
  await page.mouse.click(700, 500); await wait(200);
  // collapse sidebar
  await page.getByTitle('Collapse sidebar').click(); await wait(400); await shot('11-collapsed');
  await page.locator('[data-rail]').nth(2).click(); await wait(300); await shot('12-rail-flyout');
  await page.mouse.click(900, 500);
  await page.setViewportSize({ width: 1100, height: 800 }); await wait(500); await shot('13-narrow');
  console.log('errors:', errors.length ? errors.slice(0, 10) : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
