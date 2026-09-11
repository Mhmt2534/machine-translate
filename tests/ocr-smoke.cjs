// Run after build: node tests/ocr-smoke.cjs
// Requires Playwright (npm install --no-save playwright) and Microsoft Edge.
const { chromium } = require(process.env.WT_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

(async () => {
  let png;
  let downloads = 0;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/image')) {
      downloads++;
      res.writeHead(200, { 'Content-Type': 'image/png' }); // Deliberately no CORS header.
      res.end(png);
    } else if (req.url === '/denied.png') {
      res.writeHead(403); res.end('Forbidden');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body>${[1, 2, 3, 4].map(i => `<img style="width:400px;height:200px" src="http://127.0.0.1:${server.address().port}/image${i}.png">`).join('')}</body></html>`);
    }
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  let context;
  try {
    const extension = path.resolve('dist');
    context = await chromium.launchPersistentContext(path.join('.test-profile', `run-${Date.now()}`), {
      channel: 'msedge', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const origin = sw.url().replace('/background.js', '');
    const page = await context.newPage();
    png = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 400;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 400);
      ctx.fillStyle = 'black'; ctx.font = 'bold 44px Arial';
      ctx.fillText('ARE YOU FEELING BETTER?', 40, 120);
      ctx.fillText('HELLO WORLD', 40, 240);
      return canvas.toDataURL('image/png').split(',')[1];
    }), 'base64');
    const logs = [];
    page.on('console', msg => logs.push(msg.text()));
    await page.goto(`http://localhost:${server.address().port}`);
    await page.waitForFunction(() => [...document.images].every(img => img.naturalWidth === 800));
    const tainted = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.getContext('2d').drawImage(document.images[0], 0, 0);
      try { canvas.toDataURL(); return false; } catch (error) { return error.name === 'SecurityError'; }
    });
    assert.equal(tainted, true);
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('http://localhost:')).id);
    const send = (type) => sw.evaluate(({ tabId, type }) => chrome.tabs.sendMessage(tabId, { type }, { frameId: 0 }), { tabId, type });
    assert.equal((await send('SCAN_IMAGES')).candidateCount, 4);
    await send('START_OCR');
    let status;
    const deadline = Date.now() + 180000;
    do {
      status = await send('GET_OCR_STATUS');
      if (!status.running) break;
      if (Date.now() > deadline) throw new Error('Test timeout: ' + JSON.stringify(status));
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (true);
    console.log('OCR status:', status);
    assert.deepEqual(status.errors, []);
    assert.ok(status.regions >= 6);
    assert.equal(status.filteredRegions, status.regions);
    assert.ok(status.initialTextBlocks >= status.textBlocks);
    assert.ok(status.textBlocks > 0);
    assert.match(status.message, /Initial text blocks: \d+/);
    assert.match(status.message, /Final text blocks: \d+/);
    assert.equal(logs.filter(text => text.includes('OCR completed for image')).length, 3);
    assert.ok(logs.some(text => text.includes('HELLO WORLD')));
    assert.equal(await page.locator('[data-wt-ocr-overlay]').count(), 1);
    const cdp = await context.newCDPSession(page);
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const findOverlay = node => node.attributes?.includes('data-wt-ocr-overlay') ? node :
      (node.children || []).map(findOverlay).find(Boolean);
    const overlayNode = findOverlay(root);
    const marker = overlayNode.shadowRoots[0].children[0].children[0];
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: marker.nodeId });
    const imgRect = await page.locator('img').first().boundingBox();
    const bounds = { x: model.border[0] - imgRect.x, y: model.border[1] - imgRect.y };
    // Text starts at x=40 in an 800px source displayed at 400px width.
    assert.ok(bounds.x >= 18 && bounds.x <= 25, JSON.stringify(bounds));
    assert.ok(bounds.y > 30 && bounds.y < 65, JSON.stringify(bounds));
    // Reopening the popup must show the finished job, using real extension messaging.
    const popup = await context.newPage();
    await page.bringToFront();
    await popup.goto(`${origin}/popup.html`);
    await popup.waitForFunction(() => document.querySelector('#ocr-result').textContent.includes('OCR complete'), null, { timeout: 10000 });
    await page.screenshot({ path: '.test-profile/ocr-result.png', fullPage: true });
    // Same popup button, real messaging, and old overlays must be replaced.
    await popup.click('#detect-text');
    await popup.waitForFunction(() => document.querySelector('#ocr-result').textContent.includes('OCR complete') && !document.querySelector('#detect-text').disabled, null, { timeout: 120000 });
    assert.equal(await page.locator('[data-wt-ocr-overlay]').count(), 1);
    const denied = await sw.evaluate(async port => {
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS', 'BLOBS'], justification: 'Test HTTP failure' });
      try { return await chrome.runtime.sendMessage({ target: 'offscreen', type: 'RECOGNIZE', request: {
        method: 'extension-fetch', source: `http://127.0.0.1:${port}/denied.png`, pageUrl: `http://localhost:${port}/`,
        naturalWidth: 800, naturalHeight: 400, credentials: 'include',
      } }); }
      finally { await chrome.offscreen.closeDocument(); }
    }, server.address().port);
    assert.match(denied.error, /HTTP 403/);
    // A readable already-loaded image must not be fetched again.
    await page.evaluate(source => {
      const img = document.images[0];
      for (const other of [...document.images].slice(1)) other.remove();
      img.src = source;
    }, 'data:image/png;base64,' + png.toString('base64'));
    await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth === 800);
    const beforeLoadedRun = downloads;
    await send('START_OCR');
    const loadedDeadline = Date.now() + 120000;
    do {
      status = await send('GET_OCR_STATUS');
      if (!status.running) break;
      if (Date.now() > loadedDeadline) throw new Error('Loaded-image timeout');
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (true);
    assert.deepEqual(status.errors, []);
    assert.ok(status.regions >= 2);
    assert.equal(downloads, beforeLoadedRun);
    console.log('PASS: real MV3 extension, local WASM/eng, cross-origin tainted canvas bypassed via extension fetch, 3-image limit, text grouping, popup status.');
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
