#!/usr/bin/env node
/**
 * Smoke test for /auth/complete-sms
 * Usage:
 *   HUB_URL=https://routed.onrender.com PHONE=+14155551234 node scripts/smoke_auth_complete_sms.js
 */
const https = require('https');
const http = require('http');

function postJson(urlStr, body, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const lib = isHttps ? https : http;
      const data = Buffer.from(JSON.stringify(body));
      const req = lib.request({
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': data.length,
        },
      }, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => buf += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => { try { req.destroy(new Error('timeout')); } catch {} });
      req.write(data);
      req.end();
    } catch (e) { reject(e); }
  });
}

(async () => {
  const base = process.env.HUB_URL || process.env.BASE_URL || 'https://routed.onrender.com';
  const phone = process.env.PHONE || '';
  const deviceName = process.env.DEVICE_NAME || 'Routed Desktop';
  if (!phone) {
    console.error('Set PHONE env var, e.g. PHONE=+14155551234');
    process.exit(2);
  }
  const paths = ['/v1/auth/complete-sms', '/auth/complete-sms'];
  const payload = { phone, deviceName, wantDefaultOpenAIKey: true };
  try {
    let last = null;
    for (const p of paths) {
      const url = new URL(p, base).toString();
      const res = await postJson(url, payload, 8000);
      const snippet = (res.body || '').slice(0, 400);
      console.log(`[smoke] POST ${url} status=${res.status} body=${snippet}`);
      last = { res, url };
      if (res.status === 200) {
        let j = null; try { j = JSON.parse(res.body); } catch {}
        if (j && (j.accessToken || j.refreshToken)) process.exit(0);
      }
    }
    process.exit(1);
  } catch (e) {
    console.error('[smoke] error', e.message || String(e));
    process.exit(1);
  }
})();

