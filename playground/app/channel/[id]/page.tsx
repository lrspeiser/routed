"use client";
import { useMemo, useState } from 'react';

export default function ChannelPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [title, setTitle] = useState('Hello from Routed');
  const [body, setBody] = useState('This message was sent via the channel API');
  const [payload, setPayload] = useState('{"k":"v"}');
  const [log, setLog] = useState('');

  const sendUrl = useMemo(() => `/api/channel/${encodeURIComponent(id)}/send`, [id]);

  async function send() {
    try {
      const parsed = payload ? JSON.parse(payload) : null;
      const res = await fetch(sendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, payload: parsed }),
      });
      const j = await res.json();
      setLog(`POST ${sendUrl} → ${res.status} ${JSON.stringify(j)}`);
    } catch (e: any) {
      setLog(`Send failed: ${e.message || e}`);
    }
  }

  const shareLink = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Channel <code>{id}</code></h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => navigator.clipboard.writeText(id)}>Copy ID</button>
          <button onClick={() => navigator.clipboard.writeText(shareLink)}>Copy Link</button>
        </div>
      </div>
      <div style={{ opacity: 0.8 }}>Share this page link with collaborators or paste the Subscription ID in the Mac Receiver app.</div>
      <div style={{ display: 'grid', gap: 8 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body" rows={4} />
        <textarea value={payload} onChange={(e) => setPayload(e.target.value)} placeholder='Payload JSON {"k":"v"}' rows={4} />
        <div>
          <button onClick={send}>Send Message</button>
        </div>
      </div>
      <div>
        <h3>cURL</h3>
        <pre style={{ background:'#111', color:'#0f0', padding:12, borderRadius:8, overflow:'auto' }}>{`curl -s -X POST '${sendUrl}' \\
  -H 'Content-Type: application/json' \\
  -d '{"title":"${title.replace(/"/g, '\\"')}","body":"${body.replace(/"/g, '\\"')}","payload":${payload || 'null'}}'`}</pre>
      </div>
      <div>
        <h3>Log</h3>
        <pre style={{ background:'#111', color:'#0f0', padding:12, borderRadius:8 }}>{log}</pre>
      </div>
    </div>
  );
}


