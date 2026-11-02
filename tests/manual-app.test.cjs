'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../launcher');
let server, browser, address;

before(async () => {
  server = http.createServer((req, res) => {
    const relative = new URL(req.url, 'http://localhost').pathname;
    if (relative === '/garage-config.js') { res.end('window.GARAGE_CONFIG = {};'); return; }
    const file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  address = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openApp(hidden) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(address + '/') ? route.continue() : route.abort());
  await page.addInitScript(hidden => {
    window.appCalls = [];
    window.appHidden = hidden;
    Object.defineProperty(document, 'hidden', { get: () => window.appHidden });
    window.fetch = () => Promise.reject(new Error('External services unavailable'));
    window.tizen = { application: {
      getAppsInfo(done) { done([{ id: 'SampleApp1.Sample', name: 'Sample App', show: true, iconPath: '' }]); },
      getCurrentApplication() { return { appInfo: { id: 'GarageHome.launcher' },
        getRequestedAppControl() { return null; }, hide() { window.appCalls.push('hide'); } }; },
      launch(id, done) { window.appCalls.push(id); if (done) done(); },
      launchAppControl(control, id) { window.appCalls.push(id || 'appcontrol'); }
    } };
  }, hidden);
  await page.goto(address);
  await page.waitForSelector('#appsRow [data-launch="SampleApp1.Sample"]', { state: 'attached' });
  return { page, errors };
}

test('hidden startup and foreground changes never launch Garage Home or Vetro', async () => {
  const { page, errors } = await openApp(true);
  try {
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window.appHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => window.appCalls), []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a selected app opens normally and Back can leave without restarting the dashboard', async () => {
  const { page, errors } = await openApp(false);
  try {
    await page.waitForSelector('#splash.gone');
    // The TV UI activates its focused tile with the remote's OK key; it has no mouse handler.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.appCalls), ['SampleApp1.Sample']);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const calls = await page.evaluate(() => window.appCalls);
    assert.ok(calls.includes('hide'));
    assert.ok(!calls.includes('GarageHome.launcher') && !calls.some(id => id.startsWith('vetrotvapp')));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
