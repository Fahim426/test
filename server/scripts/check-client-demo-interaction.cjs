const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
async function main() {
  if (!process.env.DEMO_TEST_PASSWORD) throw Error('Provide DEMO_TEST_PASSWORD and optionally DEMO_TEST_USER');
  const login = await (await fetch('http://127.0.0.1:4000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.DEMO_TEST_USER || 'admin', password: process.env.DEMO_TEST_PASSWORD }) })).json();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const results = [];
  try {
    for (const [name, port] of [['Modern', 5174], ['Classic', 5173]]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(login => { localStorage.setItem('ss-auth', JSON.stringify({ state: login, version: 0 })); localStorage.setItem('ss-tour-seen-v1', '1'); localStorage.setItem('ss-workspace', JSON.stringify({ state: { tabs: [], activeId: null, closed: [] }, version: 1 })); }, login);
      await page.goto('http://127.0.0.1:' + port);
      await page.evaluate(async () => { const { useWorkspaceStore: ws } = await import('/src/store/workspace.ts'); ws.setState({ tabs: [], activeId: null }); window.demoOriginal = ws.getState().open({ screenId: 'dashboard' }); await (await import('/src/lib/clientDemo.ts')).startClientDemo(); });
      const guide = page.locator('.ss-client-demo.driver-popover');
      await guide.locator('.ss-demo-flow').waitFor();
      const progress = () => guide.locator('.driver-popover-progress-text').innerText();
      const next = async () => { const before = await progress(); await guide.locator('.driver-popover-next-btn').click(); await page.waitForFunction(before => document.querySelector('.ss-client-demo .driver-popover-progress-text')?.textContent !== before, before); };
      await next();
      const screen = page.locator('[data-tour="screen-dashboard"]:visible');
      await screen.waitFor();
      await screen.evaluate(e => { for (const n of [e, ...e.querySelectorAll('*')]) n.scrollTop = 0; });
      await page.mouse.move(1200, 600); await page.mouse.wheel(0, 550); await page.waitForTimeout(400);
      assert.ok(await screen.evaluate(e => [e, ...e.querySelectorAll('*')].some(n => n.scrollTop > 0)), name + ' dashboard scrolls while guide expanded');
      const step = await progress();
      await page.evaluate(async () => { const { useWorkspaceStore: ws } = await import('/src/store/workspace.ts'); window.demoStepTab = ws.getState().activeId; ws.getState().open({ screenId: 'products', title: 'Browse products', background: true }); });
      await page.locator('[data-tour="tabs"]').getByText('Browse products', { exact: true }).click();
      await page.waitForTimeout(200);
      assert.equal(await progress(), step, 'switching screens retains the guide step');
      await page.evaluate(async () => { const { useWorkspaceStore: ws } = await import('/src/store/workspace.ts'); ws.getState().activate(window.demoStepTab); });
      const toggle = page.locator('[data-tour="tree-toggle"]:visible').first();
      if (await toggle.count()) { await toggle.click(); await toggle.click(); assert.equal(await progress(), step); }
      await guide.getByRole('button', { name: 'Minimize tour', exact: true }).click();
      assert.ok(await guide.evaluate(e => e.classList.contains('ss-tour-is-minimized')));
      await screen.evaluate(e => { for (const n of [e, ...e.querySelectorAll('*')]) n.scrollTop = 0; });
      await page.mouse.move(1200, 450); await page.mouse.wheel(0, 400); await page.waitForTimeout(200);
      assert.ok(await screen.evaluate(e => [e, ...e.querySelectorAll('*')].some(n => n.scrollTop > 0)), name + ' scrolls while minimized');
      await guide.getByRole('button', { name: 'Next tour step', exact: true }).click(); await page.waitForTimeout(500);
      assert.ok(await guide.evaluate(e => e.classList.contains('ss-tour-is-minimized')), 'minimized state survives next');
      await guide.getByRole('button', { name: 'Previous tour step', exact: true }).click(); await page.waitForTimeout(500);
      await guide.getByRole('button', { name: 'Restore tour', exact: true }).click();
      assert.equal(await progress(), step, 'restore retains current step');
      const all = [];
      while (await guide.count()) {
        const title = await guide.locator('.driver-popover-title').innerText();
        const text = await guide.locator('.driver-popover-description').innerText();
        assert.ok(text.split(/\s+/).length <= 85, 'brief description: ' + title);
        all.push(title);
        if ((await progress()).match(/Step (\d+) of \1$/)) { await guide.locator('.driver-popover-next-btn').click(); break; }
        await next();
      }
      await page.waitForFunction(() => !document.body.classList.contains('ss-client-demo-active'));
      assert.ok(await page.evaluate(async () => (await import('/src/store/workspace.ts')).useWorkspaceStore.getState().tabs.some(t => t.id === window.demoOriginal)), 'original tab restored');
      assert.deepEqual(errors, []);
      results.push({ interface: name, scrolling: 'expanded and minimized passed', navigation: 'background interaction and compact Back/Next passed', position: 'step retained on restore', shortStepsWalked: all.length + 1, runtimeErrors: errors });
      console.log(JSON.stringify(results[results.length - 1]));
      await context.close();
    }
  } finally { await browser.close(); }
  const dir = path.resolve(__dirname, '../../.local-run'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'client-demo-interaction-results.json'), JSON.stringify(results, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
