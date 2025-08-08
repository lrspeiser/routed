"use client";
import { useState } from 'react';

export default function Page() {
  const [adminToken, setAdminToken] = useState('');
  const [hubUrl, setHubUrl] = useState('http://localhost:8080');
  const [sandbox, setSandbox] = useState<any>(null);
  const [log, setLog] = useState<string>('');

  async function createSandbox() {
    try {
      setLog('');
      const res = await fetch(new URL('/v1/admin/sandbox/provision', hubUrl).toString(), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
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
      const res = await fetch(new URL('/v1/messages', hubUrl).toString(), {
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

  const clientLink = sandbox ? `${hubUrl}/?tenantId=${sandbox.tenantId}&userId=${sandbox.userId}` : '';

  return (
    <div>
      <h1>Notification Playground</h1>
      <p>Point to a running hub and create a sandbox tenant/publisher/user.</p>

      <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
        <label>Hub URL <input value={hubUrl} onChange={(e) => setHubUrl(e.target.value)} placeholder="http://localhost:8080" /></label>
        <label>Admin Token <input value={adminToken} onChange={(e) => setAdminToken(e.target.value)} placeholder="HUB_ADMIN_TOKEN" /></label>
        <button onClick={createSandbox}>Create Sandbox</button>
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
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Log</h3>
      <pre style={{ background: '#111', color: '#0f0', padding: 12, borderRadius: 8 }}>{log}</pre>
    </div>
  );
}
