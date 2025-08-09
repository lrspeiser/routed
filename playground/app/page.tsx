"use client";
import { useEffect, useMemo, useState } from 'react';

export default function Page() {
  const [sandbox, setSandbox] = useState<any>(null);
  const [log, setLog] = useState<string>('');
  const [channelCode, setChannelCode] = useState<string>('');
  const [quickTitle, setQuickTitle] = useState('Test ✅');
  const [quickBody, setQuickBody] = useState('Hello from Playground');
  const [developerId, setDeveloperId] = useState<string>('');
  const [channelId, setChannelId] = useState<string>('');
  const [hubUrl, setHubUrl] = useState<string>('');
  const [apiSnippet, setApiSnippet] = useState<string>('');
  const [allowedEmail, setAllowedEmail] = useState<string>('');

  async function createSandbox() {
    try {
      setLog('');
      const res = await fetch('/api/dev/create', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      setSandbox(data);
      setLog(`Sandbox created. tenantId=${data.tenantId} userId=${data.userId} apiKey=${data.apiKey}`);
      setHubUrl(data.hubUrl);
    } catch (e: any) {
      setLog(`Create failed: ${e.message || e}`);
    }
  }

  async function sendTest() {
    if (!sandbox) return;
    try {
      const res = await fetch(new URL('/v1/messages', sandbox.hubUrl).toString(), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${sandbox.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: 'runs.finished',
          title: 'Playground test ✅',
          body: 'Hello from the Playground',
          payload: { playground: true },
        }),
      });
      const j = await res.json();
      setLog(`POST /v1/messages → ${res.status} ${JSON.stringify(j)}`);
    } catch (e: any) {
      setLog(`Send failed: ${e.message || e}`);
    }
  }

  async function quickBroadcast() {
    try {
      const res = await fetch('/api/dev/quick-test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: quickTitle, body: quickBody }),
      });
      const j = await res.json();
      setLog(`Quick broadcast → ${res.status} ${JSON.stringify(j)}`);
    } catch (e: any) {
      setLog(`Quick broadcast failed: ${e.message || e}`);
    }
  }

  async function createChannel() {
    if (!sandbox) return;
    setLog('');
    const res = await fetch('/api/channel/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hubUrl: sandbox.hubUrl, tenantId: sandbox.tenantId, userId: sandbox.userId, apiKey: sandbox.apiKey, topic: 'runs.finished' }),
    });
    const j = await res.json();
    if (!res.ok) { setLog(`Create channel failed: ${JSON.stringify(j)}`); return; }
    setChannelId(j.channelId);
    if (sandbox) {
      const url = new URL('/v1/messages', sandbox.hubUrl).toString();
      const snippet = `curl -s -X POST '${url}' \
  -H 'Authorization: Bearer ${sandbox.apiKey}' \
  -H 'Content-Type: application/json' \
  -d '{"topic":"runs.finished","title":"Hello","body":"From API","payload":{"k":"v"}}'`;
      setApiSnippet(snippet);
    }
  }

  const clientLink = sandbox ? `${sandbox.hubUrl}/?tenantId=${sandbox.tenantId}&userId=${sandbox.userId}` : '';

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/devinit', { cache: 'no-store' });
        const j = await res.json();
        setDeveloperId(j.developerId || '');
        try { localStorage.setItem('DEV_ID', j.developerId); } catch {}
      } catch {}
    })();
  }, []);

  async function allowEmail() {
    if (!sandbox || !allowedEmail) return;
    try {
      const res = await fetch('/api/resolve-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: allowedEmail, tenantId: sandbox.tenantId, topic: 'runs.finished' }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(j));
      setLog(`Email allowed → userId=${j.user_id} topic=${j.topic}`);
    } catch (e: any) {
      setLog(`Allow email failed: ${e.message || e}`);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Routed</h1>
        <div style={{ opacity: 0.8 }}>
          {developerId ? <span>Developer ID: <code>{developerId}</code></span> : null}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#0b1020', color: '#e6e9f5', padding: 16, borderRadius: 12 }}>
          <h3>Create Sandbox (Routed)</h3>
          <p style={{ opacity: 0.8, marginTop: -8 }}>Provision a tenant, publisher and user linked to your Developer ID.</p>
          <button onClick={createSandbox}>Create Developer Key</button>
          {sandbox && (
            <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6 }}>
              <div>tenantId: <code>{sandbox.tenantId}</code></div>
              <div>userId: <code>{sandbox.userId}</code></div>
              <div>apiKey: <code>{sandbox.apiKey}</code></div>
              <div style={{ marginTop: 8 }}>
                <button onClick={sendTest}>Send Test Message</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ background: '#0b1020', color: '#e6e9f5', padding: 16, borderRadius: 12 }}>
          <h3>Create Channel (Routed)</h3>
          <p style={{ opacity: 0.8, marginTop: -8 }}>Generate a short Subscription ID to share with your Mac client.</p>
          <button onClick={createChannel} disabled={!sandbox}>Create Channel</button>
          {channelId && sandbox && (
            <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6 }}>
              <div>Subscription ID: <code>{channelId}</code></div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button onClick={() => navigator.clipboard.writeText(channelId)}>Copy ID</button>
                <a href={`/channel/${channelId}`} target="_blank">Open Channel Page</a>
              </div>
              <div style={{ marginTop: 8 }}>Receiver app: <a href="https://example.com/downloads/receiver.dmg" target="_blank">Download DMG</a></div>
              <div style={{ marginTop: 8 }}>Client page: <a href={`${sandbox.hubUrl}/dev/client`} target="_blank">{`${sandbox.hubUrl}/dev/client`}</a></div>
              <div style={{ marginTop: 8 }}>
                <div>Channel API:</div>
                <pre style={{ background:'#111', color:'#0f0', padding:8, borderRadius:6 }}>{`curl -s -X POST '${typeof window !== 'undefined' ? new URL(`/api/channel/${channelId}/send`, window.location.origin).toString() : ''}' \\
  -H 'Content-Type: application/json' \\
  -d '{"title":"Hello","body":"From Channel","payload":{"k":"v"}}'`}</pre>
              </div>
              {apiSnippet && (
                <div style={{ marginTop: 8 }}>
                  <div>Direct Hub API:</div>
                  <pre style={{ background:'#111', color:'#0f0', padding:8, borderRadius:6 }}>{apiSnippet}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ background: '#0b1020', color: '#e6e9f5', padding: 16, borderRadius: 12 }}>
        <h3>Allow Email (Routed)</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={allowedEmail} onChange={(e) => setAllowedEmail(e.target.value)} placeholder="you@example.com" />
          <button onClick={allowEmail} disabled={!sandbox}>Allow</button>
        </div>
      </div>

      <div style={{ background: '#0b1020', color: '#e6e9f5', padding: 16, borderRadius: 12 }}>
        <h3>Quick Broadcast (Routed)</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)} placeholder="Title" />
          <input value={quickBody} onChange={(e) => setQuickBody(e.target.value)} placeholder="Body" />
          <button onClick={quickBroadcast}>Broadcast</button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Open {`{HUB_URL}/dev/client`} to receive</div>
      </div>

      <div>
        <h3>Log</h3>
        <pre style={{ background: '#111', color: '#0f0', padding: 12, borderRadius: 8 }}>{log}</pre>
      </div>
    </div>
  );
}
