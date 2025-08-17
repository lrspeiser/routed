#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

async function main() {
  try {
    const appDir = path.join(__dirname, '..', 'receiver-app');
    const resBase = path.join(appDir, 'resources', 'ai');
    function readIf(p) { try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null; } catch { return null; } }

    // Load from raw files first, then fall back to .env style
    let OPENAI_API_KEY = readIf(path.join(resBase, 'openai.key'));
    let OPENAI_PROJECT = readIf(path.join(resBase, 'openai.project'));
    let OPENAI_ORG = readIf(path.join(resBase, 'openai.org'));
    let OPENAI_BASE_URL = readIf(path.join(resBase, 'openai.base_url'));

    // Merge .env files if present
    function parseEnv(text) {
      const out = {}; if (!text) return out;
      text.split(/\r?\n/).forEach(line => {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) return; let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1);
        out[m[1]] = v;
      });
      return out;
    }
    const envDot = readIf(path.join(resBase, '.env'));
    const envAlt = readIf(path.join(resBase, 'openai.env'));
    const envVars = { ...parseEnv(envDot), ...parseEnv(envAlt) };
    OPENAI_API_KEY = OPENAI_API_KEY || envVars.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    OPENAI_PROJECT = OPENAI_PROJECT || envVars.OPENAI_PROJECT || process.env.OPENAI_PROJECT;
    OPENAI_ORG = OPENAI_ORG || envVars.OPENAI_ORG || process.env.OPENAI_ORG;
    OPENAI_BASE_URL = (OPENAI_BASE_URL || envVars.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');

    if (!OPENAI_API_KEY) {
      console.error('Missing OPENAI_API_KEY in resources/ai/openai.key or .env');
      process.exit(2);
    }

    const url = `${OPENAI_BASE_URL}/v1/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    };
    if (OPENAI_PROJECT) headers['OpenAI-Project'] = OPENAI_PROJECT;
    if (OPENAI_ORG) headers['OpenAI-Organization'] = OPENAI_ORG;

    const body = {
      model: 'gpt-5',
      messages: [
        { role: 'system', content: 'You are a health check.' },
        { role: 'user', content: 'Say OK.' }
      ],
      temperature: 0,
      max_tokens: 5,
    };

    // Use native https to avoid external deps
    const https = require('https');
    function postJson(u, headers, bodyObj) {
      return new Promise((resolve, reject) => {
        const parsed = new URL(u);
        const req = https.request({
          method: 'POST',
          hostname: parsed.hostname,
          path: parsed.pathname + (parsed.search || ''),
          port: parsed.port || 443,
          headers: { ...headers },
        }, (res) => {
          let data = '';
          res.on('data', (c) => data += c);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.write(JSON.stringify(bodyObj));
        req.end();
      });
    }

    const resp = await postJson(url, headers, body);
    const text = resp.body || '';
    if ((resp.status|0) < 200 || (resp.status|0) >= 300) {
      console.error(`OpenAI check failed: status=${resp.status} body=${text.slice(0, 500)}`);
      process.exit(1);
    }
    let j; try { j = JSON.parse(text); } catch {}
    const content = j?.choices?.[0]?.message?.content || '';
    console.log(`OpenAI check OK: status=${resp.status} reply=${JSON.stringify(content).slice(0, 120)}`);
  } catch (e) {
    console.error('OpenAI check error:', e && e.message ? e.message : String(e));
    process.exit(1);
  }
}

main();

