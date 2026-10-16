import http from 'node:http';
import https from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { resolve, relative as relativePath, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { DEFAULTS, LIMITS, validateConfig, applyConfig } from './protocol.mjs';

const root = resolve(fileURLToPath(new URL('../web/', import.meta.url)));
const demo = process.argv.includes('--demo');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8443);
const token = process.env.BRIDGE_TOKEN || randomBytes(24).toString('hex');
const tls = process.env.TLS_CERT && process.env.TLS_KEY;
if (host !== '127.0.0.1' && host !== 'localhost' && !tls) throw new Error('LAN access requires TLS_CERT and TLS_KEY (Safari audio requires a trusted HTTPS connection).');
await stat(resolve(root, 'dist/main.js')); // Fail before listening if the web build is missing.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const publicFiles = new Set(['index.html', 'styles.css', 'audio-worklet.js', 'mic-worklet.js', 'icon.svg', 'icon-maskable.svg', 'manifest.webmanifest', 'version.json', 'privacy.html', 'sw.js']);
async function handle(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/bridge.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ protocol: 1, demo, limits: LIMITS })); return;
    }
    const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const path = resolve(root, relative);
    const normalized = relativePath(root, path).split(sep).join('/');
    if (!path.startsWith(root + sep) || (!publicFiles.has(normalized) && !normalized.startsWith('dist/') && !normalized.startsWith('assets/'))) { res.writeHead(404); res.end(); return; }
    const data = await readFile(path);
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); res.end(); }
}
const server = tls ? https.createServer({ cert: await readFile(process.env.TLS_CERT), key: await readFile(process.env.TLS_KEY) }, handle) : http.createServer(handle);
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  const expected = `${tls ? 'https' : 'http'}://${req.headers.host}`;
  if (req.url !== '/radio' || req.headers.origin !== expected) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});
let owner = null;
function authorized(value) {
  if (typeof value !== 'string') return false;
  const supplied = Buffer.from(value), expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function send(ws, value) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); }
wss.on('connection', ws => {
  let authenticated = false, radio = null, task = null, demoTimer = null, config = { ...DEFAULTS }, busy = false;
  let alive = true;
  const deadline = setTimeout(() => ws.close(1008, 'Authentication timeout'), 5000);
  const heartbeat = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; ws.ping(); }, 10000);
  ws.on('pong', () => { alive = true; });
  function iq(buf) {
    if (ws.readyState !== WebSocket.OPEN) return;
    // Fail explicitly instead of dropping samples and silently corrupting decoder timing.
    if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(1013, 'Wi-Fi too slow; reduce sample rate'); radio?.stop(); return; }
    ws.send(buf, { binary: true });
  }
  function status(text) { send(ws, { type: 'status', text, board: radio?.board || 'Simulated HackRF', firmware: radio?.firmware || 'demo' }); }
  ws.on('message', async (data, binary) => {
    let starting = false;
    try {
      if (binary) throw new Error('Binary client messages are not supported');
      const message = JSON.parse(data.toString());
      if (!authenticated) {
        if (message.type !== 'auth' || !authorized(message.token)) { ws.close(1008, 'Invalid pairing token'); return; }
        if (owner) { ws.close(1013, 'Radio is in use'); return; }
        authenticated = true; owner = ws; clearTimeout(deadline);
        send(ws, { type: 'ready', protocol: 1, limits: LIMITS, demo }); return;
      }
      if (message.type === 'config') {
        config = validateConfig(message.config);
        if (radio) applyConfig(radio, config);
        if (demoTimer) status(`Simulated HackRF · ${(config.freqHz / 1e6).toFixed(3)} MHz`);
      } else if (message.type === 'start') {
        if (busy || task || demoTimer) throw new Error('Radio already started');
        busy = true;
        starting = true;
        if (demo) {
          let phase = 0;
          demoTimer = setInterval(() => {
            const samples = Math.floor(config.rateHz / 100);
            const buf = Buffer.alloc(samples * 2);
            for (let i = 0; i < samples; i++) {
              // Synthetic FM carrier: 100 kHz off centre, 1 kHz audio, 25 kHz deviation.
              phase += 2 * Math.PI * (100000 + 25000 * Math.sin(2 * Math.PI * i / (config.rateHz / 1000))) / config.rateHz;
              buf.writeInt8(Math.round(60 * Math.cos(phase)), 2 * i);
              buf.writeInt8(Math.round(60 * Math.sin(phase)), 2 * i + 1);
            }
            phase %= 2 * Math.PI;
            iq(buf);
          }, 10);
          status(`Simulated HackRF · ${(config.freqHz / 1e6).toFixed(3)} MHz`);
        } else {
          const [{ WebUSB }, { HackRf, isHackRf, isMayhemSerial }] = await Promise.all([import('usb'), import('../web/dist/hackrf.js')]);
          const devices = await new WebUSB({ allowAllDevices: true }).getDevices();
          if (ws.readyState !== WebSocket.OPEN) return;
          const device = devices.find(isHackRf);
          if (!device) throw new Error(devices.some(isMayhemSerial) ? 'Select HackRF mode on the PortaPack screen' : 'No HackRF found; check USB cable and udev permissions');
          radio = new HackRf(device, { onIq: iq, onLog: text => send(ws, { type: 'log', text }), onStatus: status });
          applyConfig(radio, config);
          try { await radio.open(); } catch (error) { if (device.opened) await device.close().catch(() => {}); throw error; }
          if (ws.readyState !== WebSocket.OPEN) { await device.releaseInterface(0); await device.close(); return; }
          task = radio.run().finally(() => { task = null; ws.close(1000, 'Radio stopped'); if (owner === ws) owner = null; });
        }
      } else if (message.type === 'stop') { radio?.stop(); ws.close(1000, 'Stopped'); }
      else throw new Error('Unsupported command');
    } catch (error) { radio?.stop(); send(ws, { type: 'error', text: error.message }); ws.close(1011, 'Radio error'); }
    finally {
      if (starting) {
        busy = false;
        if (ws.readyState !== WebSocket.OPEN && !task && owner === ws) owner = null;
      }
    }
  });
  ws.on('error', () => { radio?.stop(); });
  ws.on('close', () => {
    clearTimeout(deadline); clearInterval(heartbeat); clearInterval(demoTimer);
    radio?.stop();
    // Keep the device reserved until its outstanding USB reads have drained.
    if (!task && !busy && owner === ws) owner = null;
  });
});
server.listen(port, host, () => {
  console.log(`Mayhem Pi ${demo ? '(SIMULATED RADIO)' : '(USB HackRF)'}: ${tls ? 'https' : 'http'}://${host}:${server.address().port}`);
  console.log(`Pairing token: ${token}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  for (const ws of wss.clients) ws.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
});
