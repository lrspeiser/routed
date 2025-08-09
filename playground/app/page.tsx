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
  const [emails, setEmails] = useState<Array<{ email: string; user_id: string; online: boolean }>>([]);
  const [channelName, setChannelName] = useState<string>('');
  const [channelShortId, setChannelShortId] = useState<string>('');
  const [sendTitle, setSendTitle] = useState<string>('Hello from Routed');
  const [sendBody, setSendBody] = useState<string>('This is a test message');
  const [sendPayload, setSendPayload] = useState<string>('{"k":"v"}');

  async function createSandbox(): Promise<any | null> {
    try {
      setLog('');
      const res = await fetch('/api/dev/create', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      setSandbox(data);
      setLog(`Sandbox created. tenantId=${data.tenantId} userId=${data.userId} apiKey=${data.apiKey}`);
      setHubUrl(data.hubUrl);
      return data;
    } catch (e: any) {
      setLog(`Create failed: ${e.message || e}`);
      return null;
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
    if (!channelName) { setLog('Please enter a channel name.'); return; }
    setLog('');
    // Ensure sandbox exists (auto-provision if needed)
    let sb = sandbox;
    if (!sb) {
      sb = await createSandbox();
    }
    if (!sb) {
      setLog('Provision failed. Ensure HUB_URL and HUB_ADMIN_TOKEN are configured on the playground server.');
      return;
    }
    // Create server-side channel for persistence & association
    try {
      const resp = await fetch('/api/admin/channels/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: sb.tenantId, name: channelName, topic: 'runs.finished' }),
      });
      const jr = await resp.json();
      if (!resp.ok) { setLog(`Channel DB create failed: ${JSON.stringify(jr)}`); }
      if (jr.short_id) setChannelShortId(jr.short_id);
    } catch {}
    const res = await fetch('/api/channel/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hubUrl: sb.hubUrl, tenantId: sb.tenantId, userId: sb.userId, apiKey: sb.apiKey, topic: 'runs.finished', channelName }),
    });
    const j = await res.json();
    if (!res.ok) { setLog(`Create channel failed: ${JSON.stringify(j)}`); return; }
    setChannelId(j.channelId);
    if (sb) {
      const url = new URL('/v1/messages', sb.hubUrl).toString();
      const snippet = `curl -s -X POST '${url}' \
  -H 'Authorization: Bearer ${sb.apiKey}' \
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
      // Auto-provision sandbox (idempotent for local session)
      try {
        if (!sandbox && !sessionStorage.getItem('SANDBOX_READY')) {
          await createSandbox();
          sessionStorage.setItem('SANDBOX_READY', '1');
        }
      } catch {}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function allowEmail() {
    if (!sandbox || !allowedEmail) return;
    try {
      const res = await fetch('/api/admin/emails/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: allowedEmail, tenantId: sandbox.tenantId, topic: 'runs.finished' }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(j));
      setLog(`Email allowed → userId=${j.userId || j.user_id} topic=${j.topic || 'runs.finished'}`);
      setAllowedEmail('');
      await refreshEmails();
    } catch (e: any) {
      setLog(`Allow email failed: ${e.message || e}`);
    }
  }

  async function refreshEmails() {
    if (!sandbox) return;
    try {
      if (channelShortId) {
        const res = await fetch(`/api/admin/channels/users/${encodeURIComponent(channelShortId)}`, { cache: 'no-store' });
        const j = await res.json();
        setEmails(j.users || []);
      } else {
        const url = new URL('/api/admin/emails/list', window.location.origin);
        url.searchParams.set('tenantId', sandbox.tenantId);
        url.searchParams.set('topic', 'runs.finished');
        const res = await fetch(url.toString(), { cache: 'no-store' });
        const j = await res.json();
        setEmails(j.users || []);
      }
    } catch {}
  }

  async function removeEmail(email: string) {
    if (!sandbox) return;
    try {
      const res = await fetch('/api/admin/emails/remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: sandbox.tenantId, email, topic: 'runs.finished' }),
      });
      if (!res.ok) throw new Error('remove failed');
      await refreshEmails();
    } catch {}
  }

  useEffect(() => {
    if (!sandbox) return;
    const t = setInterval(refreshEmails, 3000);
    refreshEmails();
    return () => clearInterval(t);
  }, [sandbox?.tenantId, channelShortId]);

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
          <h3>1) Create Channel</h3>
          <p style={{ opacity: 0.8, marginTop: -8 }}>Developer ID: <code>{developerId || '…'}</code></p>
          <input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="Channel name (e.g., Leon's Laptop)" />
          <button onClick={createChannel} disabled={!channelName}>Submit</button>
          {channelId && sandbox && (
            <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6 }}>
              <div>Subscription ID: <code>{channelId}</code></div>
              {channelShortId ? (
                <div>Channel Short ID: <code>{channelShortId}</code></div>
              ) : null}
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button onClick={() => navigator.clipboard.writeText(channelId)}>Copy ID</button>
                <a href={`/channel/${channelId}`} target="_blank">Open Channel Page</a>
              </div>
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
        <h3>2) Add Email (Routed)</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={allowedEmail} onChange={(e) => setAllowedEmail(e.target.value)} placeholder="you@example.com" />
          <button onClick={allowEmail} disabled={!sandbox}>Add</button>
        </div>
        <div style={{ marginTop: 12 }}>
          {emails.map((u) => (
            <div key={u.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 9999, background: u.online ? '#22c55e' : '#ef4444', display: 'inline-block' }} />
              <code style={{ flex: 1 }}>{u.email}</code>
              <button onClick={() => removeEmail(u.email)}>Remove</button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: '#0b1020', color: '#e6e9f5', padding: 16, borderRadius: 12 }}>
        <h3>3) Send Message (Routed)</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          <input value={sendTitle} onChange={(e) => setSendTitle(e.target.value)} placeholder="Title" />
          <input value={sendBody} onChange={(e) => setSendBody(e.target.value)} placeholder="Body" />
          <textarea value={sendPayload} onChange={(e) => setSendPayload(e.target.value)} placeholder='Payload JSON {"k":"v"}' rows={3} />
          <button disabled={!channelId} onClick={async () => {
            if (!channelId) return;
            try {
              const payload = sendPayload ? JSON.parse(sendPayload) : null;
              const res = await fetch(`/api/channel/${channelId}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: sendTitle, body: sendBody, payload }) });
              const j = await res.json();
              setLog(`Channel send → ${res.status} ${JSON.stringify(j)}`);
            } catch (e: any) {
              setLog(`Channel send failed: ${e.message || e}`);
            }
          }}>Send</button>
          <button disabled={!sandbox} onClick={async () => {
            try {
              const payload = sendPayload ? JSON.parse(sendPayload) : null;
              const res = await fetch('/api/admin/test-message', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId: sandbox?.tenantId, topic: 'runs.finished', title: sendTitle, body: sendBody, payload })
              });
              const j = await res.json();
              setLog(`Admin test message → ${res.status} ${JSON.stringify(j)}`);
            } catch (e: any) {
              setLog(`Admin test failed: ${e.message || e}`);
            }
          }}>Send Admin Test</button>
        </div>
      </div>

      <div>
        <h3>Log</h3>
        <pre style={{ background: '#111', color: '#0f0', padding: 12, borderRadius: 8 }}>{log}</pre>
      </div>
    </div>
  );
}
