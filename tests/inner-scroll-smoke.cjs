const { chromium } = require(process.env.WT_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

(async () => {
  const images = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/image')) {
      const index = Number(req.url.match(/\d+/)[0]);
      const ok = req.headers['sec-fetch-dest'] === 'image' && req.headers.referer;
      res.writeHead(ok ? 200 : 403, { 'Content-Type': ok ? 'image/png' : 'text/plain', 'Cache-Control': 'no-store' });
      res.end(ok ? images[index] : 'Fetch denied');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body style="margin:0"><div id="reader" style="position:relative;margin:80px 0 0 40px;width:520px;height:500px;overflow-y:auto;overflow-x:hidden;border:4px solid purple">${[0,1,2].map(i => `<img style="display:block;width:500px" src="http://127.0.0.1:${server.address().port}/image${i}.png">`).join('')}</div><aside style="position:fixed;top:80px;left:40px;width:520px;height:35px;background:black;color:white;z-index:9999">STICKY UI</aside></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let context;
  try {
    const extension = path.resolve('dist');
    context = await chromium.launchPersistentContext(path.join('.test-profile', `inner-scroll-${Date.now()}`), {
      channel: 'msedge', headless: true, viewport: { width: 1000, height: 720 }, deviceScaleFactor: 1.25,
      args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    for (const [index, height] of [800, 1880, 2600].entries()) {
      images.push(Buffer.from(await page.evaluate(({ index, height }) => {
        const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = height;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, height);
        ctx.fillStyle = 'black'; ctx.font = 'bold 48px Arial';
        const name = ['VISIBLE', 'INNER', 'FINAL'][index];
        const ys = height === 800 ? [100, 400, 700] : [100, Math.round(height / 2), height - 100];
        ['FIRST', 'MIDDLE', 'LAST'].forEach((text, i) => ctx.fillText(`${name} ${text}`, 60, ys[i]));
        return canvas.toDataURL().split(',')[1];
      }, { index, height }), 'base64'));
    }
    const logs = [];
    page.on('console', async msg => {
      if (msg.text().includes('[Webtoon Translator]')) logs.push(await Promise.all(msg.args().map(arg => arg.jsonValue().catch(() => null))));
    });
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth === 1000));
    await page.locator('#reader').evaluate(node => { node.scrollTop = 50; node.scrollLeft = 0; });
    const initial = await page.locator('#reader').evaluate(node => ({ top: node.scrollTop, left: node.scrollLeft }));
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('http://localhost:')).id);
    const send = type => sw.evaluate(({ tabId, type }) => chrome.tabs.sendMessage(tabId, { type }, { frameId: 0 }), { tabId, type });
    const browserCdp = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    await browserCdp.send('Extensions.triggerAction', { id: new URL(sw.url()).hostname, targetId: targetInfos.find(target => target.url === page.url()).targetId });
    await send('START_OCR');
    const deadline = Date.now() + 300000;
    let status;
    do {
      status = await send('GET_OCR_STATUS');
      if (!status.running) break;
      if (Date.now() > deadline) throw new Error('Timeout: ' + JSON.stringify(status));
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (true);
    const completed = logs.filter(entry => entry[0].endsWith('OCR completed for image')).map(entry => entry[1]);
    const scrollContexts = logs.filter(entry => entry[0].endsWith('Scroll context')).map(entry => entry[1]);
    const segments = logs.filter(entry => entry[0].endsWith('Processing segment')).map(entry => entry[1]);
    console.log('Status:', status);
    console.log('Per image:', completed);
    console.log('Scroll contexts:', scrollContexts);
    assert.deepEqual(status.errors, []);
    assert.match(status.message, /Images processed: 3 \/ 3/);
    assert.equal(status.regions, 9);
    assert.deepEqual(completed.map(item => item.segments), [1, 2, 3]);
    assert.ok(scrollContexts.every(item => item.isWindowScroll === false && item.scrollContainer.includes('#reader')));
    assert.equal(segments[0].actualScroll[0].scrollTop, 0); // visible/partial candidate works and reaches its top
    assert.ok(segments.some(item => item.imageIndex === 3 && item.actualScroll[0].scrollTop === 2140)); // max scroll final segment
    assert.deepEqual(await page.locator('#reader').evaluate(node => ({ top: node.scrollTop, left: node.scrollLeft })), initial);
    assert.equal(await page.locator('aside').evaluate(node => node.style.visibility), '');
    const texts = logs.filter(entry => entry[0].endsWith('OCR text')).map(entry => entry[1].text);
    assert.ok(texts.some(text => text.includes('VISIBLE FIRST')));
    assert.ok(texts.some(text => text.includes('FINAL LAST')));
    const cdp = await context.newCDPSession(page);
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = node => node.attributes?.includes('data-wt-ocr-overlay') ? node : (node.children || []).map(find).find(Boolean);
    assert.equal(find(root).shadowRoots[0].children.length, 3);
    console.log('PASS: inner scroll container; visible short candidate; offscreen candidates; long segments; max-scroll final segment; state restore; persistent overlays.');
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
