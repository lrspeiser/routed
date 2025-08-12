// Simple end-to-end check: deep health + playground self-test (non-stream)
// Usage: node scripts/e2e_self_test.mjs

const HUB = process.env.HUB_BASE_URL || 'https://routed.onrender.com';
const PG = process.env.PLAYGROUND_BASE_URL || 'https://routed-gbiz.onrender.com';

async function withTimeout(p, ms) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  try {
    const res = await p(ac.signal);
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'accept': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, json };
}

async function main() {
  const out = { when: new Date().toISOString(), hub: HUB, playground: PG };
  try {
    // Deep health
    const dh = await withTimeout((signal) => fetchJson(`${HUB}/v1/health/deep`, { signal }), 8000).catch((e) => ({ status: 0, json: { error: String(e?.message || e) } }));
    out.deep_health = dh;

    // Playground non-stream self-test (runs WS + send + await receive on server)
    const st = await withTimeout((signal) => fetchJson(`${PG}/api/self-test`, { signal, cache: 'no-store' }), 15000).catch((e) => ({ status: 0, json: { error: String(e?.message || e) } }));
    out.self_test = st;

    const ok = (dh.status === 200 && dh.json?.ok !== false) && (st.status === 200 && st.json?.ok === true);
    console.log(JSON.stringify(out));
    process.exit(ok ? 0 : 1);
  } catch (e) {
    out.error = String(e?.message || e);
    console.log(JSON.stringify(out));
    process.exit(2);
  }
}

main();


