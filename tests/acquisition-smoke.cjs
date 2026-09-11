const { chromium } = require(process.env.WT_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

(async () => {
  let png;
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/image')) {
      const status = req.headers['sec-fetch-dest'] === 'image' && req.headers.referer ? 200 : 403;
      requests.push({ status, referer: req.headers.referer || null, origin: req.headers.origin || null,
        destination: req.headers['sec-fetch-dest'], hasCookie: Boolean(req.headers.cookie), cache: req.headers['cache-control'] || null });
      res.writeHead(status, { 'Content-Type': status === 200 ? 'image/png' : 'text/plain', 'Cache-Control': 'no-store' });
      res.end(status === 200 ? png : 'Hotlink rejected');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="margin:0;padding-top:60px"><img style="display:block;width:600px;height:400px;margin-left:40px" src="http://127.0.0.1:${server.address().port}/image.png"></body></html>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let context;
  try {
    const extension = path.resolve('dist');
    context = await chromium.launchPersistentContext(path.join('.test-profile', `acquisition-${Date.now()}`), {
      channel: 'msedge', headless: true, viewport: { width: 1000, height: 720 }, deviceScaleFactor: 1.5,
      args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    png = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1200, 800);
      ctx.fillStyle = 'black'; ctx.font = 'bold 44px Arial';
      ['HMPH!! NO!!', 'IT PISSES ME OFF', 'BECAUSE IT FEELS LIKE', "I AM DOING WHAT YOU WANT!"].forEach((text, i) => ctx.fillText(text, 60, 110 + 120 * i));
      return canvas.toDataURL().split(',')[1];
    }), 'base64');
    const logs = [];
    page.on('console', async msg => {
      if (msg.text().includes('[Webtoon Translator]')) logs.push(await Promise.all(msg.args().map(arg => arg.jsonValue().catch(() => null))));
    });
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForFunction(() => document.images[0].naturalWidth === 1200);
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('http://localhost:')).id);
    const send = type => sw.evaluate(({ tabId, type }) => chrome.tabs.sendMessage(tabId, { type }, { frameId: 0 }), { tabId, type });
    const referrerCheck = await sw.evaluate(async ({ pageUrl, port }) => {
      try {
        const request = new Request(`http://127.0.0.1:${port}/image-probe.png`, { referrer: pageUrl, credentials: 'include', cache: 'force-cache' });
        const response = await fetch(request);
        return { referrer: request.referrer, status: response.status };
      } catch (error) { return error.message; }
    }, { pageUrl: page.url(), port: server.address().port });
    console.log('Extension-origin page referrer check:', referrerCheck);
    const browserCdp = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    const target = targetInfos.find(target => target.url === page.url());
    await browserCdp.send('Extensions.triggerAction', { id: new URL(sw.url()).hostname, targetId: target.targetId });
    await send('SCAN_IMAGES');
    await send('START_OCR');
    let status;
    const deadline = Date.now() + 150000;
    do {
      status = await send('GET_OCR_STATUS');
      if (!status.running) break;
      if (Date.now() > deadline) throw new Error('Timeout ' + JSON.stringify(status));
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (true);
    console.log('Network metadata (no cookie values):', requests);
    console.log('Status:', status);
    console.log('Acquisition:', logs.filter(entry => /Image acqui/.test(entry[0])));
    console.log('OCR:', logs.filter(entry => entry[0].endsWith('OCR text')));
    assert.deepEqual(status.errors, []);
    assert.ok(status.regions >= 3);
    assert.ok(logs.some(entry => entry[1]?.method === 'viewport-capture' && entry[1]?.outcome === 'acquired'));
    const text = logs.find(entry => entry[0].endsWith('OCR text'))[1];
    assert.ok(text.x >= 55 && text.x < 80, JSON.stringify(text));
    assert.ok(text.y >= 60 && text.y < 110, JSON.stringify(text));
    assert.ok(requests.some(request => request.status === 200 && request.destination === 'image'));
    assert.ok(requests.some(request => request.status === 403 && request.destination === 'empty'));
    await page.screenshot({ path: '.test-profile/acquisition-result.png' });
    // Begin from a partially visible image at actual browser zoom; auto-scroll
    // must capture the full candidate and then restore this initial view.
    await sw.evaluate(tabId => chrome.tabs.setZoom(tabId, 1.25), tabId);
    await page.evaluate(() => { document.body.style.minHeight = '1800px'; scrollTo(0, 160); });
    await page.waitForFunction(() => scrollY === 160);
    const previousLogs = logs.length;
    await send('START_OCR');
    const secondDeadline = Date.now() + 150000;
    do {
      status = await send('GET_OCR_STATUS');
      if (!status.running) break;
      if (Date.now() > secondDeadline) throw new Error('Partial capture timeout');
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (true);
    assert.deepEqual(status.errors, []);
    assert.ok(status.regions >= 2);
    const partial = logs.slice(previousLogs).filter(entry => entry[0].endsWith('OCR text'));
    assert.equal(partial.length, 4);
    assert.ok(partial.some(entry => entry[1].text.includes('HMPH') && Math.abs(entry[1].y - 78) < 10));
    assert.ok(partial.some(entry => entry[1].text.includes('BECAUSE') && Math.abs(entry[1].y - 318) < 10));
    assert.equal(await page.evaluate(() => scrollY), 160);
    console.log('Partial capture at 125% zoom:', partial);
    await page.screenshot({ path: '.test-profile/acquisition-partial.png' });
    console.log('PASS: real extension viewport capture after HTTP 403, DPR=1.5, browser zoom=125%, partial crop and natural coordinates.');
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
