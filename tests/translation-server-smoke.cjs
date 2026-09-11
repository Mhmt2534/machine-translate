const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

(async () => {
  const port = 43817;
  const child = spawn(process.execPath, ['dist-server/translationServer.mjs'], {
    cwd: process.cwd(), env: { ...process.env, TRANSLATION_PORT: String(port), OPENAI_API_KEY: '',
      GOOGLE_TRANSLATE_API_KEY: '', GOOGLE_TRANSLATE_PROJECT_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('Translation server listening')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => reject(new Error(`Server exited early: ${code}`)));
    });
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const denied = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: 'https://example.com' } });
    assert.equal(denied.status, 403);
    const response = await fetch(`http://127.0.0.1:${port}/api/translate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', imageId: 'image-1', blocks: [{ id: 'b1', text: 'HELLO' }] }),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'API_KEY_MISSING');
    assert.doesNotMatch(JSON.stringify(body), /Bearer|test-key/);
    const unknown = await fetch(`http://127.0.0.1:${port}/api/translate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'unexpected', imageId: 'image-1', blocks: [{ id: 'b1', text: 'HELLO' }] }),
    });
    assert.equal(unknown.status, 400);
    assert.match(await unknown.text(), /Unknown translation provider/);
    console.log('PASS: localhost-only translation server, restricted CORS, provider whitelist and missing-key error.');
  } finally {
    child.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
