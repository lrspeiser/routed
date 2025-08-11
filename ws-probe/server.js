// Render-friendly WebSocket probe sharing the same HTTP server.
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const app = express();

app.get('/healthz', (_req, res) => {
  console.log('[HTTP] GET /healthz');
  res.status(200).send('ok');
});

// Single HTTP server for both HTTP and WS
const server = http.createServer(app);

// Attach WS to the existing HTTP server
// If you want a gated path (e.g., /socket), switch to noServer:true and handle upgrade.
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  console.log(`[WS] New client from ${req.socket.remoteAddress}`);
  ws.on('message', (msg) => {
    console.log(`[WS] Received: ${msg}`);
    ws.send(`server-echo: ${msg}`);
  });
  ws.on('close', (code, reason) => {
    console.log(`[WS] Closed code=${code} reason=${reason}`);
  });
  ws.on('error', (err) => {
    console.error('[WS] Error:', err);
  });
  // Heartbeat
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
});

// Server-side heartbeat loop
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.warn('[WS] Terminating dead connection');
      return ws.terminate();
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 30000);

wss.on('close', () => clearInterval(interval));

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[BOOT] Listening on port ${PORT}`);
  console.log(`[INFO] Connect clients with wss://<your-service>.onrender.com`);
});


