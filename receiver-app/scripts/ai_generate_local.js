#!/usr/bin/env node
/**
 * receiver-app/scripts/ai_generate_local.js
 *
 * A standalone CLI to exercise the same OpenAI chat completion used by the Electron app
 * without launching Electron or building a DMG. Useful for end-to-end debugging.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node scripts/ai_generate_local.js \
 *     --mode poller \
 *     --prompt "Rewrite to poll https://api.example.com and notify on changes" \
 *     [--current ./path/to/current.ts] \
 *     [--context ./path/to/context.txt]
 *
 * The script will also look for a persisted key at:
 *   - macOS: ~/Library/Application Support/Routed/ai/openai.key
 *   - Linux: ~/.config/Routed/ai/openai.key
 *   - Windows: %APPDATA%/Routed/ai/openai.key
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

function readFileIfExists(p) {
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; } catch { return null; }
}

function userDataAIKeyPath() {
  const platform = process.platform;
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Routed', 'ai', 'openai.key');
  } else if (platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appdata, 'Routed', 'ai', 'openai.key');
  } else {
    // linux and others
    const cfg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(cfg, 'Routed', 'ai', 'openai.key');
  }
}

function parseArgs(argv) {
  const out = { mode: 'poller', prompt: '', current: null, context: null, max: 3000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode' && i + 1 < argv.length) { out.mode = argv[++i]; continue; }
    if (a === '--prompt' && i + 1 < argv.length) { out.prompt = argv[++i]; continue; }
    if (a === '--current' && i + 1 < argv.length) { out.current = argv[++i]; continue; }
    if (a === '--context' && i + 1 < argv.length) { out.context = argv[++i]; continue; }
    if (a === '--max' && i + 1 < argv.length) { out.max = Math.max(100, parseInt(argv[++i], 10) || 800); continue; }
  }
  return out;
}

function extractCodeFromLLMContent(content) {
  const m = String(content || '').match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  return (m && m[1]) ? m[1] : String(content || '');
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.prompt) {
    console.error('Usage: node scripts/ai_generate_local.js --mode poller|webhook --prompt "..." [--current file] [--context file]');
    process.exit(2);
  }

  const mode = args.mode === 'webhook' ? 'webhook' : 'poller';
  const defaultTopic = 'runs.finished';

  let currentCode = '';
  if (args.current) {
    currentCode = readFileIfExists(path.resolve(args.current)) || '';
  }
  let contextData = '';
  if (args.context) {
    contextData = readFileIfExists(path.resolve(args.context)) || '';
  }

  // Resolve OpenAI credentials
  let keySource = 'env';
  let OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_TOKEN || '';
  if (!OPENAI_API_KEY) {
    const k = (readFileIfExists(userDataAIKeyPath()) || '').trim();
    if (k) { OPENAI_API_KEY = k; keySource = 'userData'; }
  }
  if (!OPENAI_API_KEY) {
    console.error('ERROR: missing_openai_key. Set OPENAI_API_KEY or place a key in ' + userDataAIKeyPath());
    process.exit(1);
  }
  const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
  const OPENAI_PROJECT = process.env.OPENAI_PROJECT || '';
  const OPENAI_ORG = process.env.OPENAI_ORG || '';

  const system = [
    'You are GPT-5 generating a single-file TypeScript script for Deno.',
    'Target: Electron-bundled Deno runner providing ctx.notify({ title, body, payload?, topic? }).',
    'Constraints:',
    '- No external npm imports; use built-ins (fetch, URL, crypto).',
    '- Do not access environment variables; use ctx and file-local state only.',
    '- For poller mode: export async function handler(ctx).',
    '- For webhook mode: export async function onRequest(req, ctx) returning Response.',
    'Quality: concise, robust, handle errors, reasonable timeouts.',
  ].join('\n');

  const user = [
    '# SDK and Guardrails',
    '(no guide available in CLI mode)',
    '',
    '<<<ROUTED_API_GUIDE_START>>>',
    '(no developer API guide available in CLI mode)',
    '<<<ROUTED_API_GUIDE_END>>>',
    '',
    '# Mode',
    `mode: ${mode}`,
    '',
    '# Default Topic',
    `defaultTopic: ${defaultTopic}`,
    '',
    '# Current Script (for rewrite, optional)',
    currentCode ? '```ts\n' + String(currentCode).slice(0, 20000) + '\n```' : '(none)',
    '',
    '# Freeform Context (optional)',
    contextData ? String(contextData).slice(0, 40000) : '(none)',
    '',
    '# Intent',
    String(args.prompt || '(no prompt provided)')
  ].join('\n');

  const body = {
    model: 'gpt-5',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    max_completion_tokens: args.max,
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
  };
  if (OPENAI_PROJECT) headers['OpenAI-Project'] = OPENAI_PROJECT;
  if (OPENAI_ORG) headers['OpenAI-Organization'] = OPENAI_ORG;

  const tail = String(OPENAI_API_KEY).slice(-6);
  console.log(`ai:generate(cli) → calling ${OPENAI_BASE_URL}/v1/chat/completions model=gpt-5 key_source=${keySource} auth_tail=${tail}`);

  const resp = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await resp.text().catch(() => '');
  if (!resp.ok) {
    console.error(`ai:generate(cli) http_error status=${resp.status} body=${text.slice(0, 400)}`);
    process.exit(3);
  }
  let data = {};
  try { data = JSON.parse(text); } catch {}
  const content = data?.choices?.[0]?.message?.content || '';
  if (!content) {
    console.error('ai:generate(cli) empty_content: raw_body_snippet=' + text.slice(0, 800));
  }
  const code = extractCodeFromLLMContent(content);

  console.log('--- GENERATED CODE START ---');
  process.stdout.write(code + '\n');
  console.log('--- GENERATED CODE END ---');
}

main().catch((e) => { console.error('fatal:', e?.stack || String(e)); process.exit(10); });

