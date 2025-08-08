const logEl = document.getElementById('log');
function log(msg) { console.log(msg); logEl.textContent += `\n${new Date().toISOString()} ${msg}`; logEl.scrollTop = logEl.scrollHeight; }

async function registerWebPush(tenantId, userId) {
  if (!('serviceWorker' in navigator)) { log('Service Worker not supported. Skipping web push.'); return; }
  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js');
    await navigator.serviceWorker.ready;
    log('Service Worker ready.');

    // Fetch public config (vapid key)
    const confRes = await fetch('/v1/config/public');
    const conf = confRes.ok ? await confRes.json() : {};
    const vapid = (conf && conf.vapid_public) || '';
    if (!vapid) { log('No VAPID public key set on window.VAPID_PUBLIC. Web push subscribe skipped.'); return; }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    });
    log('Push subscribed. Sending registration…');
    const res = await fetch('/v1/webpush/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, user_id: userId, subscription_json: sub }),
    });
    if (!res.ok) throw new Error(`register failed ${res.status}`);
    log('Web push registration ok.');
  } catch (e) {
    log(`Web push register failed: ${e}`);
  }
}

function openSocket(userId) {
  const base = window.HUB_BASE_URL || `${location.protocol}//${location.host}`;
  const wsProto = base.startsWith('https') ? 'wss' : 'ws';
  const url = new URL(base);
  const ws = new WebSocket(`${wsProto}://${url.host}/v1/socket?user_id=${encodeURIComponent(userId)}`);
  ws.onopen = () => log('WS open');
  ws.onmessage = (ev) => {
    log(`WS message: ${ev.data}`);
    try {
      const data = JSON.parse(ev.data);
      if (data && data.title && Notification.permission === 'granted') {
        new Notification(data.title, { body: data.body });
      }
    } catch {}
  };
  ws.onclose = () => log('WS closed');
  ws.onerror = (e) => log(`WS error: ${e.message || e}`);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function start() {
  const params = new URLSearchParams(location.search);
  const tenantId = (document.getElementById('tenantId').value || params.get('tenantId') || '').trim();
  const userId = (document.getElementById('userId').value || params.get('userId') || '').trim();
  if (!tenantId || !userId) { alert('Enter tenantId and userId'); return; }

  if ('Notification' in window) {
    const perm = await Notification.requestPermission();
    log(`Notification permission: ${perm}`);
  }

  openSocket(userId);
  await registerWebPush(tenantId, userId);
}

document.getElementById('startBtn').addEventListener('click', start);

async function joinByCode() {
  const code = document.getElementById('joinCode').value.trim();
  const registryUrl = document.getElementById('registryUrl').value.trim();
  if (!code || !registryUrl) { alert('Enter join code and registry URL'); return; }
  try {
    const res = await fetch(new URL(`/v1/hosts/resolve?code=${encodeURIComponent(code)}`, registryUrl).toString());
    if (!res.ok) throw new Error(`Resolve failed ${res.status}`);
    const desc = await res.json();
    log(`Resolved host: ${JSON.stringify(desc)}`);
    // TODO: verify host_statement against registry JWKS for production
    window.HUB_BASE_URL = desc.base_url;
    // Optionally set VAPID key
    window.VAPID_PUBLIC = desc.vapid_public;
  } catch (e) {
    log(`Join by code failed: ${e}`);
  }
}

document.getElementById('joinBtn').addEventListener('click', joinByCode);
