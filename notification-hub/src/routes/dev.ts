import { FastifyInstance } from 'fastify';
import { broadcastToAll } from '../adapters/socket';

export default async function routes(fastify: FastifyInstance) {
  // Simple dev page
  fastify.get('/dev', async (_req, reply) => {
    const html = `<!doctype html><html><body style="font-family:-apple-system,system-ui;">
<h2>Dev Test</h2>
<p><a href="/dev/client" target="_blank">Open client</a></p>
<form method="post" action="/dev/broadcast">
  <div><input name="title" placeholder="Title" /></div>
  <div><input name="body" placeholder="Body" /></div>
  <div><button type="submit">Broadcast</button></div>
</form>
</body></html>`;
    reply.header('Content-Type', 'text/html');
    return reply.send(html);
  });

  // Minimal client that connects without IDs (uses demo-user)
  fastify.get('/dev/client', async (_req, reply) => {
    const html = `<!doctype html><html><body style="font-family:-apple-system,system-ui;">
<h3>Dev Client</h3>
<script>
const uid = 'demo-user';
const ws = new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/v1/socket?user_id='+uid);
ws.onmessage = (ev)=>{ const d=JSON.parse(ev.data); const div=document.createElement('div'); div.textContent=JSON.stringify(d); document.body.appendChild(div); };
ws.onopen = ()=>{ const div=document.createElement('div'); div.textContent='open'; document.body.appendChild(div); };
ws.onerror = (e)=>{ const div=document.createElement('div'); div.textContent='error'; document.body.appendChild(div); };
ws.onclose = (e)=>{ const div=document.createElement('div'); div.textContent='close'; document.body.appendChild(div); };
</script>
</body></html>`;
    reply.header('Content-Type', 'text/html');
    return reply.send(html);
  });

  // Broadcast to all connected sockets
  fastify.post('/dev/broadcast', async (req, reply) => {
    if ((req.headers['content-type'] || '').includes('application/json')) {
      const b = (req.body as any) || {};
      const total = await broadcastToAll({ type: 'notification', title: b.title || 'Test', body: b.body || 'Hello' });
      return reply.send({ sent: total });
    }
    // parse simple form
    let body = '';
    await new Promise<void>((res) => { req.raw.on('data', (c) => (body += c)); req.raw.on('end', () => res()); });
    const params = new URLSearchParams(body);
    const total = await broadcastToAll({ type: 'notification', title: params.get('title') || 'Test', body: params.get('body') || 'Hello' });
    reply.header('Content-Type', 'text/html');
    return reply.send(`<p>Sent to ${total} sockets. <a href="/dev">Back</a></p>`);
  });
}
