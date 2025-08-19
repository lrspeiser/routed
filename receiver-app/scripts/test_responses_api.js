#!/usr/bin/env node
/*
  Test the OpenAI Responses API for GPT-5 using the same schema as the Electron app.
  - Reads OPENAI_API_KEY from env, or tries macOS userData path: ~/Library/Application Support/Routed/ai/openai.key
  - Posts to /v1/responses with json_schema output format
  - Prints the generated code and the raw JSON snippet length
*/
const fs = require('fs');
const os = require('os');
const path = require('path');

async function getKey() {
  const envKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_TOKEN;
  if (envKey) return { key: envKey, source: 'env' };
  // Try macOS Routed userData location
  try {
    const p = path.join(os.homedir(), 'Library', 'Application Support', 'Routed', 'ai', 'openai.key');
    if (fs.existsSync(p)) {
      return { key: fs.readFileSync(p, 'utf8').trim(), source: 'userData' };
    }
  } catch {}
  return { key: null, source: 'none' };
}

function extractCodeFromJSON(jsonText) {
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed.code === 'string') return parsed.code;
  } catch {}
  return null;
}

(async () => {
  const { key, source } = await getKey();
  if (!key) {
    console.error('Missing OPENAI_API_KEY. Set the env var or ensure ~/Library/Application Support/Routed/ai/openai.key exists.');
    process.exit(1);
  }

  const prompt = process.argv.slice(2).join(' ').trim() ||
    'Rewrite with AI: Generate a single-file TypeScript Deno poller that fetches Los Altos weather from Open-Meteo and notifies temperature, wind speed, humidity, and precipitation probability. Use only built-ins and include robust error handling.';

  const t = 'runs.finished';
  const jsonSchema = {
    name: 'routed_script_generation',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'manifestDelta'],
      properties: {
        code: { type: 'string', description: 'Complete TypeScript source for a single-file Deno script.' },
        manifestDelta: {
          type: 'object',
          additionalProperties: false,
          properties: {
            defaultTopic: { type: 'string' }
          },
          required: ['defaultTopic']
        }
      }
    }
  };

  const system = [
    'You are GPT-5 generating a single-file TypeScript script for Deno.',
    'Target: Electron-bundled Deno runner providing ctx.notify({ title, body, payload?, topic? }).',
    'Constraints:',
    '- No external npm imports; use built-ins (fetch, URL, crypto).',
    '- Do not access environment variables; use ctx and file-local state only.',
    '- For poller mode: export async function handler(ctx).',
    'Quality: concise, robust, handle errors, reasonable timeouts.',
    '',
    'Output strictly as JSON matching the provided schema. No prose outside JSON.'
  ].join('\n');

  const exampleJson = JSON.stringify({
    code: 'export async function handler(ctx){ /* ... */ }',
    manifestDelta: { defaultTopic: t },
    summary: 'Polls an endpoint and notifies on changes.',
    warnings: []
  }, null, 2);

  const inputText = [
    '# Mode',
    'mode: poller',
    '',
    '# Default Topic',
    `defaultTopic: ${t}`,
    '',
    '# Intent',
    prompt,
    '',
    '# JSON Output Example (conform to schema)',
    '```json',
    exampleJson,
    '```'
  ].join('\n');

  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
  const body = {
    model: 'gpt-5',
    instructions: system,
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: inputText }] }
    ],
    text: {
      format: { type: 'json_schema', name: jsonSchema.name, schema: jsonSchema.schema }
    },
    store: false
  };

  console.error(`Calling ${base}/v1/responses model=gpt-5 key_source=${source}`);

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`,
  };
  if (process.env.OPENAI_PROJECT) headers['OpenAI-Project'] = process.env.OPENAI_PROJECT;
  if (process.env.OPENAI_ORG) headers['OpenAI-Organization'] = process.env.OPENAI_ORG;

  const res = await fetch(`${base}/v1/responses`, { method: 'POST', headers, body: JSON.stringify(body) });
  const raw = await res.text().catch(() => '');
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${raw.slice(0, 400)}`);
    process.exit(2);
  }
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  const items = data && Array.isArray(data.output) ? data.output : [];
  let outputText = '';
  for (const item of items) {
    const parts = item && Array.isArray(item.content) ? item.content : [];
    for (const p of parts) {
      if (p && p.type === 'output_text' && typeof p.text === 'string') outputText += p.text;
    }
  }
  if (!outputText) {
    console.error('No output_text returned by model. First 800 chars of body:');
    console.error(raw.slice(0, 800));
    process.exit(3);
  }
  const code = extractCodeFromJSON(outputText);
  if (!code) {
    console.error('Model did not return valid JSON per schema. Snippet:');
    console.error(outputText.slice(0, 400));
    process.exit(4);
  }
  console.log('--- Deno Code Start ---');
  console.log(code);
  console.log('--- Deno Code End ---');
})();

