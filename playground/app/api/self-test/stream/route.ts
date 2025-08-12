import WebSocket from 'ws';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sse(obj: any) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export async function GET() {
  const HUB_URL_RAW = (process.env.HUB_URL || '').trim();
  const HUB_ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '';

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (o: any) => controller.enqueue(new TextEncoder().encode(sse(o)));
      const end = () => controller.close();

      const safe = async (fn: () => Promise<void>) => { try { await fn(); } catch (e: any) { enqueue({ level: 'error', msg: String(e?.message || e) }); } };

      enqueue({ level: 'info', msg: 'Self-test started' });
      enqueue({ level: 'info', env: { hub_url_raw: HUB_URL_RAW, has_admin_token: Boolean(HUB_ADMIN_TOKEN) } });

      let hubUrl = HUB_URL_RAW.replace(/^@+/, '');
      if (hubUrl && !/^https?:\/\//i.test(hubUrl)) hubUrl = `https://${hubUrl}`;
      if (!hubUrl || !HUB_ADMIN_TOKEN) {
        enqueue({ level: 'error', step: 'env', msg: 'HUB_URL or HUB_ADMIN_TOKEN missing' });
        enqueue({ done: false });
        end();
        return;
      }

      // Health
      await safe(async () => {
        const res = await fetch(new URL('/healthz', hubUrl).toString(), { cache: 'no-store' });
        enqueue({ level: 'info', step: 'health', status: res.status });
      });

      // Provision
      let tenantId = '', apiKey = '', userId = '';
      await safe(async () => {
        const url = new URL('/v1/admin/sandbox/provision', hubUrl).toString();
        const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${HUB_ADMIN_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        const j = await res.json().catch(() => ({}));
        enqueue({ level: res.ok ? 'info' : 'error', step: 'provision', status: res.status, body: j });
        if (!res.ok) throw new Error('provision_failed');
        tenantId = j.tenantId; apiKey = j.apiKey; userId = j.userId;
      });
      if (!tenantId || !apiKey || !userId) { enqueue({ done: false }); end(); return; }

      // Ensure tester email subscription
      let targetUserId = '';
      await safe(async () => {
        const url = new URL('/v1/admin/users/ensure', hubUrl).toString();
        const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${HUB_ADMIN_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant_id: tenantId, email: 'tester@routed.is', topic: 'runs.finished' }) });
        const j = await res.json().catch(() => ({}));
        enqueue({ level: res.ok ? 'info' : 'error', step: 'ensure', status: res.status, body: j });
        if (!res.ok) throw new Error('ensure_failed');
        targetUserId = j.userId || j.user_id || '';
      });
      if (!targetUserId) { enqueue({ done: false }); end(); return; }

      // Open WS (try /socket then /v1/socket)
      let ws: WebSocket | null = null;
      const base = new URL(hubUrl);
      const wsProto = base.protocol === 'https:' ? 'wss' : 'ws';
      const alt = `${wsProto}://${base.host}/socket?user_id=${encodeURIComponent(targetUserId)}`;
      const v1 = `${wsProto}://${base.host}/v1/socket?user_id=${encodeURIComponent(targetUserId)}`;

      const connectWs = async (u: string) => new Promise<void>((resolve, reject) => {
        enqueue({ level: 'info', step: 'ws_connect', url: u });
        const w = new WebSocket(u, undefined, { headers: { Origin: base.origin, 'User-Agent': 'routed-self-test' } as any });
        let opened = false;
        const to = setTimeout(() => { if (!opened) { try { w.terminate(); } catch {} reject(new Error(`ws_timeout:${u}`)); } }, 7000);
        w.on('open', () => { opened = true; clearTimeout(to); ws = w; enqueue({ level: 'info', step: 'ws_open', url: u }); resolve(); });
        w.on('error', (e) => { if (!opened) { clearTimeout(to); reject(e as any); } else { enqueue({ level: 'error', step: 'ws_error', error: String((e as any)?.message || e) }); } });
        w.on('close', (c, r) => { enqueue({ level: 'info', step: 'ws_close', code: c, reason: String(r || '') }); });
      });

      let wsOk = false;
      await safe(async () => { try { await connectWs(alt); wsOk = true; } catch { await connectWs(v1); wsOk = true; } });
      if (!wsOk || !ws) { enqueue({ done: false }); end(); return; }

      // Send message
      await safe(async () => {
        const url = new URL('/v1/messages', hubUrl).toString();
        const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: 'runs.finished', title: 'Self-Test', body: 'Hello', payload: { selftest: true } }) });
        const j = await res.json().catch(() => ({}));
        enqueue({ level: res.ok ? 'info' : 'error', step: 'send', status: res.status, body: j });
        if (!res.ok) throw new Error('send_failed');
      });

      // Await one message
      let received: any = null;
      await safe(async () => {
        received = await new Promise<any>((resolve, reject) => {
          const to = setTimeout(() => reject(new Error('no_message')), 10000);
          ws!.on('message', (buf) => { try { const d = JSON.parse(buf.toString()); if (d && d.title) { clearTimeout(to); resolve(d); } } catch {} });
        });
        enqueue({ level: 'info', step: 'received', body: received });
      });

      try { ws?.close(); } catch {}
      enqueue({ done: Boolean(received), ok: Boolean(received) });
      end();
    }
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
}


