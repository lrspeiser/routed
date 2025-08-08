"use client";
import { useState } from 'react';

export default function Page() {
  const [sandbox, setSandbox] = useState<any>(null);
  const [log, setLog] = useState<string>('');
  const [channelCode, setChannelCode] = useState<string>('');

  async function createSandbox() {
    try {
      setLog('');
      const res = await fetch('/api/dev/create', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      setSandbox(data);
      setLog(`Sandbox created. tenantId=${data.tenantId} userId=${data.userId} apiKey=${data.apiKey}`);
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

  async function createChannel() {
    if (!sandbox) return;
    setLog('');
    const res = await fetch('/api/channel/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hubUrl: sandbox.hubUrl, tenantId: sandbox.tenantId, userId: sandbox.userId, topic: 'runs.finished' }),
    });
    const j = await res.json();
    if (!res.ok) { setLog(`Create channel failed: ${JSON.stringify(j)}`); return; }
    setChannelCode(j.code);
  }

  const clientLink = sandbox ? `${sandbox.hubUrl}/?tenantId=${sandbox.tenantId}&userId=${sandbox.userId}` : '';

  return (
    <div>
      <h1>Notification Playground</h1>
      <p>Point to a running hub and create a sandbox tenant/publisher/user.</p>

      <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
        <button onClick={createSandbox}>Create Developer Key</button>
      </div>

      {sandbox && (
        <div style={{ marginTop: 16 }}>
          <div>tenantId: <code>{sandbox.tenantId}</code></div>
          <div>userId: <code>{sandbox.userId}</code></div>
          <div>apiKey: <code>{sandbox.apiKey}</code></div>
          <div style={{ marginTop: 8 }}>
            <a href={clientLink} target="_blank">Open client with prefilled IDs</a>
          </div>
          <div style={{ marginTop: 8 }}>
            <button onClick={sendTest}>Send Test Message</button>
          </div>
          <div style={{ marginTop: 8 }}>
            <button onClick={createChannel}>Create Channel</button>
            {channelCode && (
              <div style={{ marginTop: 8 }}>
                <div>Channel Code:</div>
                <textarea readOnly value={channelCode} style={{ width: '100%', height: 100 }} />
                <div style={{ marginTop: 8 }}>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(channelCode); }}>Copy code</a>
                </div>
                <div style={{ marginTop: 8 }}>
                  <a href="https://example.com/downloads/receiver.dmg" target="_blank">Download Mac app (DMG)</a>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Log</h3>
      <pre style={{ background: '#111', color: '#0f0', padding: 12, borderRadius: 8 }}>{log}</pre>
    </div>
  );
}
