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
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="margin:0"><header style="position:fixed;top:0;left:0;right:0;height:48px;background:black;color:white;z-index:99999">SITE HEADER DO NOT OCR</header>${[0,1,2].map(i => `<img style="display:block;width:500px;margin-left:40px" src="http://127.0.0.1:${server.address().port}/image${i}.png">`).join('')}<div style="height:500px"></div></body></html>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let context;
  try {
    const extension = path.resolve('dist');
    context = await chromium.launchPersistentContext(path.join('.test-profile', `auto-scroll-${Date.now()}`), {
      channel: 'msedge', headless: true, viewport: { width: 1000, height: 720 }, deviceScaleFactor: 1.5,
      args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    for (const [index, height] of [1880, 800, 2600].entries()) {
      images.push(Buffer.from(await page.evaluate(({ index, height }) => {
        const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = height;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, height);
        ctx.fillStyle = 'black'; ctx.font = 'bold 48px Arial';
        const name = ['ALPHA', 'BETA', 'GAMMA'][index];
        const ys = index === 1 ? [100, 400, 700] : [100, 1320, height - 100];
        ['FIRST', 'OVERLAP', 'LAST'].forEach((text, i) => ctx.fillText(`${name} ${text}`, 60, ys[i]));
        return canvas.toDataURL().split(',')[1];
      }, { index, height }), 'base64'));
    }
    const logs = [];
    page.on('console', async msg => {
      if (msg.text().includes('[Webtoon Translator]')) logs.push(await Promise.all(msg.args().map(arg => arg.jsonValue().catch(() => null))));
    });
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForFunction(() => document.images.length === 3 && [...document.images].every(img => img.complete && img.naturalWidth === 1000));
    await page.evaluate(() => scrollTo(0, 1500));
    const startY = await page.evaluate(() => scrollY);
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('http://localhost:')).id);
    const send = type => sw.evaluate(({ tabId, type }) => chrome.tabs.sendMessage(tabId, { type }, { frameId: 0 }), { tabId, type });
    const browserCdp = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    await browserCdp.send('Extensions.triggerAction', { id: new URL(sw.url()).hostname, targetId: targetInfos.find(target => target.url === page.url()).targetId });
    assert.equal((await send('SCAN_IMAGES')).candidateCount, 3);
    async function finish() {
      const deadline = Date.now() + 240000;
      let status;
      do {
        status = await send('GET_OCR_STATUS');
        if (!status.running) return status;
        if (Date.now() > deadline) throw new Error('Timeout: ' + JSON.stringify(status));
        await new Promise(resolve => setTimeout(resolve, 500));
      } while (true);
    }
    await send('START_OCR');
    const status = await finish();
    console.log('Full batch:', status);
    const completed = logs.filter(entry => entry[0].endsWith('OCR completed for image')).map(entry => entry[1]);
    console.log('Per image:', completed);
    assert.deepEqual(status.errors, []);
    assert.match(status.message, /Images processed: 3 \/ 3/);
    assert.equal(status.regions, 9);
    assert.deepEqual(completed.map(image => image.segments), [2, 1, 2]);
    assert.deepEqual(completed.map(image => image.regions), [3, 3, 3]);
    assert.equal(await page.evaluate(() => scrollY), startY);
    assert.equal(await page.locator('header').evaluate(node => node.style.visibility), '');
    const texts = logs.filter(entry => entry[0].endsWith('OCR text')).map(entry => entry[1]);
    assert.equal(texts.filter(line => line.text.includes('ALPHA OVERLAP')).length, 1);
    assert.ok(texts.some(line => line.text.includes('GAMMA LAST') && Math.abs(line.y - 2465) < 20));
    // Inspect the real closed-shadow overlay: all three images retain boxes.
    const cdp = await context.newCDPSession(page);
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = node => node.attributes?.includes('data-wt-ocr-overlay') ? node : (node.children || []).map(find).find(Boolean);
    assert.equal(find(root).shadowRoots[0].children.length, 3);
    await page.screenshot({ path: '.test-profile/auto-scroll-result.png', fullPage: true });

    // One acquisition error must not prevent the later candidate or restoration.
    await page.evaluate(() => { document.images[1].style.filter = 'grayscale(1)'; });
    await send('START_OCR');
    const failed = await finish();
    console.log('Batch with image 2 failure:', failed);
    assert.equal(failed.errors.length, 1);
    assert.match(failed.message, /Images processed: 2 \/ 3/);
    assert.equal(failed.regions, 6);
    assert.equal(await page.evaluate(() => scrollY), startY);

    // Trusted user wheel interrupts instead of fighting automatic scrolling.
    await send('START_OCR');
    await page.mouse.wheel(0, 200);
    const interrupted = await finish();
    assert.match(interrupted.message, /OCR interrupted/);
    assert.equal(await page.evaluate(() => scrollY), startY);
    console.log('PASS: 3 offscreen/long candidates; segments 2/1/2; 9 regions; overlap dedup; sticky header; preserved overlays; success/error/interruption scroll restore.');
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
