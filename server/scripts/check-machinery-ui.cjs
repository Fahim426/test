/* Browser checks use the isolated QA API through request interception. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const reportDir = path.resolve(__dirname, '../../.local-run/machinery-qa');
const data = JSON.parse(fs.readFileSync(path.join(reportDir, 'api-results.json')));
const api = 'http://127.0.0.1:4001/api';
const checks = [], errors = [], failedRequests = [];
const check = (name, value = true) => { assert.ok(value, name); checks.push(name); console.log('PASS ' + name); };
async function main() {
  const login = await (await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) })).json();
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  let lastPage;
  try {
    for (const [app, port] of [['modern', 5174], ['classic', 5173]]) {
      const context = await browser.newContext({ viewport: { width: 1536, height: 960 } });
      const page = await context.newPage();
      lastPage = page;
      let shuttingDown = false;
      let configOverride;
      await page.route('**/api/**', route => {
        const u = new URL(route.request().url());
        if (configOverride && u.pathname === '/api/product-config' && route.request().method() === 'GET') return route.fulfill({ json: configOverride });
        return route.fetch({ url: 'http://127.0.0.1:4001' + u.pathname + u.search }).then(r => route.fulfill({ response: r })).catch(() => { if (!shuttingDown) errors.push(app + ': request interception failed'); });
      });
      page.on('pageerror', e => errors.push(app + ': ' + e.message));
      page.on('response', r => { if (r.status() >= 500) failedRequests.push(app + ': ' + r.status() + ' ' + r.url()); });
      await page.addInitScript(({ login }) => {
        localStorage.setItem('ss-auth', JSON.stringify({ state: { ...login }, version: 0 }));
        localStorage.setItem('ss-tour-seen-v1', '1');
        localStorage.setItem('ss-workspace', JSON.stringify({ state: { tabs: [], activeId: null, closed: [] }, version: 1 }));
        if (!localStorage.getItem('ss-bu')) localStorage.setItem('ss-bu', JSON.stringify({ state: { selectedBuId: null }, version: 0 }));
      }, { login });
      await page.goto('http://127.0.0.1:' + port);
      await page.waitForFunction(() => document.body.textContent.includes('ERP workspace') || document.body.textContent.includes('Dashboard'));
      async function open(screenId, params = {}) {
        await page.evaluate(async ({ screenId, params }) => { const { useWorkspaceStore } = await import('/src/store/workspace.ts'); useWorkspaceStore.getState().open({ screenId, params }); }, { screenId, params });
        await page.waitForTimeout(300);
      }
      const screenIds = await page.evaluate(async () => (await import('/src/screens/registry.ts')).allScreens().map(s => s.id));
      check(app + ' screen registry loaded', screenIds.length > 50);
      await open('sales-order-form');
      const modal = page.getByRole('dialog').filter({ hasText: 'Which Business Unit' });
      await modal.waitFor({ state: 'visible' });
      const buButton = modal.getByRole('button').filter({ hasNotText: 'Choose later' }).filter({ hasNotText: 'Close' });
      const buttons = await modal.locator('button').all();
      let chosen;
      for (const button of buttons) { const text = (await button.innerText()).trim(); if (text && text !== 'Choose later' && text !== 'Close') { chosen = text; await button.click(); break; } }
      assert.ok(chosen, 'BU choice available');
      await page.waitForTimeout(200);
      check(app + ' BU remembered', await page.evaluate(() => JSON.parse(localStorage.getItem('ss-bu')).state.newDocBuId > 0));
      await open('sales-quotation-form');
      check(app + ' next document does not prompt for BU', await modal.count() === 0 || !await modal.isVisible());
      await page.reload(); await page.waitForTimeout(700);
      check(app + ' BU survives reload', await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('ss-bu')).state; return s.newDocBuId > 0 && s.newDocBuUserId > 0; }));
      const enabled = await (await fetch(api + '/product-config', { headers: { Authorization: 'Bearer ' + login.accessToken } })).json();
      for (const [key, screen] of [['po','purchase-order-form'],['grn','goods-receipt-form'],['pi','purchase-invoice-form'],['enquiry','sales-enquiry-form'],['quote','sales-quotation-form'],['order','sales-order-form'],['pick','picking-form'],['pack','packing-list-form'],['delivery','delivery-note-form'],['invoice','sales-invoice-form'],['proforma','proforma-invoice-form'],['pr','purchase-return-form'],['sr','sales-return-form'],['landed','landed-cost-form']]) {
        if (!screenIds.includes(screen)) throw Error('Missing screen ' + screen);
        await open(screen, { id: data.documents[key] });
        {
          const active = page.locator('[data-tour="screen-' + screen + '"]:visible');
          await active.getByText(data.master.stockNumber, { exact: true }).first().waitFor({ state: 'visible' });
          check(app + ' ' + key + ' shows Stock No', /stock no/i.test(await active.innerText()));
          check(app + ' ' + key + ' displays stock reference', (await active.innerText()).includes(data.master.stockNumber));
          const alignment = await active.locator('table').evaluateAll(tables => tables.filter(t => /stock no/i.test(t.tHead?.textContent || '')).map(t => {
            const width = row => [...row.cells].reduce((n, c) => n + c.colSpan, 0);
            const head = width(t.tHead.rows[0]);
            return { head, body: t.tBodies[0]?.rows[0] ? width(t.tBodies[0].rows[0]) : head, foot: t.tFoot ? [...t.tFoot.rows].map(width) : [] };
          }));
          assert.ok(alignment.every(t => t.head === t.body && t.foot.every(n => n === t.head)), app + ' ' + key + ' table alignment ' + JSON.stringify(alignment));
        }
      }
      await open('sales-order-form', { id: undefined });
      const productInputs = page.locator('input[data-c="productId"]');
      if (await productInputs.count() === 0) {
        const add = page.getByRole('button', { name: /Add (line|item)/i });
        if (await add.count()) await add.first().click();
      }
      const input = page.locator('input[data-c="productId"]').first();
      await input.fill(data.master.stockNumber);
      await page.waitForTimeout(500);
      const suggestion = page.locator('[data-idx]').filter({ hasText: data.master.productCode }).first();
      await suggestion.waitFor({ state: 'visible' });
      check(app + ' richer product picker', (await suggestion.innerText()).includes(data.master.stockNumber));
      await suggestion.click();
      await page.waitForTimeout(100);
      check(app + ' selected product retains details', (await page.locator('body').innerText()).includes(data.master.stockNumber));
      await page.evaluate(async () => { const { useBuStore } = await import('/src/store/bu.ts'); useBuStore.getState().setNewDocBuId(999999, 1); });
      await page.reload();
      await open('sales-enquiry-form');
      await modal.waitFor({ state: 'visible' }); check(app + ' invalid remembered BU asks again');
      await modal.getByRole('button', { name: 'Choose later' }).click();
      await page.evaluate(async () => { const { useBuStore } = await import('/src/store/bu.ts'); useBuStore.getState().setNewDocBuId(1, 999999); });
      await page.reload();
      // Force a fresh unsaved form without a fake document id.
      await page.evaluate(async () => { const { useWorkspaceStore } = await import('/src/store/workspace.ts'); useWorkspaceStore.setState({ tabs: [], activeId: null }); useWorkspaceStore.getState().open({ screenId: 'sales-order-form' }); });
      await modal.waitFor({ state: 'visible' }); check(app + ' another user does not inherit remembered BU');
      await modal.getByRole('button', { name: 'Choose later' }).click();
      configOverride = { ...enabled, features: { ...enabled.features, partNumbers: true, vehicleCompatibility: true } };
      await page.reload(); await open('sales-invoice-form', { id: data.documents.invoice });
      const fullInvoice = page.locator('[data-tour="screen-sales-invoice-form"]:visible');
      await fullInvoice.getByText('QA-ALT-1530 (GXU)', { exact: true }).waitFor({ state: 'visible' });
      check(app + ' optional manufacturer and equipment details work', (await fullInvoice.innerText()).includes('GXU Laser series'));
      configOverride = { ...enabled, features: { ...enabled.features, partNumbers: false, vehicleCompatibility: false } };
      await page.reload(); await open('sales-invoice-form', { id: data.documents.invoice });
      await page.locator('[data-tour="screen-sales-invoice-form"]:visible').getByText(data.master.stockNumber, { exact: true }).waitFor({ state: 'visible' });
      check(app + ' optional columns hide when disabled', !/Manufacturer Ref|Alternate Ref/.test(await page.locator('[data-tour="screen-sales-invoice-form"]:visible').innerText()));
      for (const modeScreen of ['stock-balances']) { await open(modeScreen); check(app + ' stock list contains Stock No', /stock no/i.test(await page.locator('[data-tour="screen-' + modeScreen + '"]:visible').innerText())); }
      // Mount every registered list and setup screen to catch rendering regressions.
      const lists = screenIds.filter(id => !id.endsWith('-form') && !id.startsWith('navigation:'));
      for (const id of lists) {
        await page.evaluate(async () => { const { useWorkspaceStore } = await import('/src/store/workspace.ts'); useWorkspaceStore.setState({ tabs: [], activeId: null }); });
        await open(id);
      }
      check(app + ' list/setup screens mounted: ' + lists.length);
      await open('sales-invoice-form', { id: data.documents.invoice });
      await page.screenshot({ path: path.join(reportDir, app + '-workspace.png') });
      shuttingDown = true;
      await page.unrouteAll({ behavior: 'wait' });
      await context.close();
    }
    assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
    check('No browser runtime errors or server failures');
  } finally {
    if (lastPage && !lastPage.isClosed()) { fs.writeFileSync(path.join(reportDir, 'last-screen.txt'), await lastPage.locator('body').innerText()); await lastPage.screenshot({ path: path.join(reportDir, 'last-screen.png') }); fs.writeFileSync(path.join(reportDir, 'last-state.json'), JSON.stringify(await lastPage.evaluate(async () => { const { useBuStore, useDocBuStore } = await import('/src/store/bu.ts'); const { useWorkspaceStore } = await import('/src/store/workspace.ts'); return { bu: useBuStore.getState(), docBu: useDocBuStore.getState(), workspace: useWorkspaceStore.getState() }; }), null, 2)); }
    await browser.close();
    fs.writeFileSync(path.join(reportDir, 'ui-results.json'), JSON.stringify({ checks, errors, failedRequests }, null, 2));
  }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
