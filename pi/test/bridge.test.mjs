import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { DEFAULTS, validateConfig } from '../protocol.mjs';

let child, base, origin;
before(async () => {
  child = spawn(process.execPath, ['server.mjs', '--demo'], { cwd: new URL('../', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: '0', BRIDGE_TOKEN: 'test-token' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = await new Promise((resolve, reject) => {
    let text = '';
    const timeout = setTimeout(() => reject(new Error('Bridge did not start')), 5000);
    child.stdout.on('data', data => { text += data; if (text.includes('Pairing token:')) { clearTimeout(timeout); resolve(text); } });
    child.on('exit', code => { clearTimeout(timeout); reject(new Error(`Bridge exited: ${code}`)); });
  });
  origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  base = origin.replace('http:', 'ws:');
});
after(async () => { child?.kill(); if (child && child.exitCode === null) await once(child, 'exit'); });

async function connect(token = 'test-token') {
  const ws = new WebSocket(`${base}/radio`, { origin });
  await once(ws, 'open');
  const ready = once(ws, 'message');
  ws.send(JSON.stringify({ type: 'auth', token }));
  return { ws, ready };
}
function waitFor(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Message timeout')); }, 3000);
    const receive = (data, binary) => {
      const value = binary ? data : JSON.parse(data.toString());
      if (predicate(value, binary)) { cleanup(); resolve(value); }
    };
    function cleanup() { clearTimeout(timeout); ws.off('message', receive); }
    ws.on('message', receive);
  });
}
test('validates tuning and gain, including invalid types and bounds', () => {
  assert.deepEqual(validateConfig(DEFAULTS), DEFAULTS);
  for (const patch of [{ freqHz: 0 }, { rateHz: 8e6 }, { lna: 7 }, { vga: 63 }, { amp: 'true' }, { rateHz: NaN }]) assert.throws(() => validateConfig({ ...DEFAULTS, ...patch }));
});
test('serves browser build and discovery, excludes sources', async () => {
  assert.equal((await fetch(`${origin}/`)).status, 200);
  assert.equal((await fetch(`${origin}/dist/network-radio.js`)).status, 200);
  assert.equal((await (await fetch(`${origin}/bridge.json`)).json()).demo, true);
  for (const path of ['/package.json', '/src/main.ts', '/%2e%2e%2fpi/server.mjs', '/dist/%2e%2e%2fpackage.json']) assert.equal((await fetch(origin + path)).status, 404);
});
test('rejects a cross-origin WebSocket', async () => {
  const ws = new WebSocket(`${base}/radio`, { origin: 'https://other.invalid' });
  const [error] = await once(ws, 'error');
  assert.match(error.message, /403/);
});
test('rejects an incorrect pairing token', async () => {
  const ws = new WebSocket(`${base}/radio`, { origin });
  await once(ws, 'open');
  const closed = once(ws, 'close');
  ws.send(JSON.stringify({ type: 'auth', token: 'wrong' }));
  assert.equal((await closed)[0], 1008);
});
test('pairs, streams signed IQ, retunes, enforces exclusive access, and releases on disconnect', async () => {
  const { ws, ready } = await connect();
  assert.equal(JSON.parse((await ready)[0]).limits.canTransmit, false);
  ws.send(JSON.stringify({ type: 'config', config: DEFAULTS }));
  const iq = waitFor(ws, (_, binary) => binary);
  ws.send(JSON.stringify({ type: 'start' }));
  const samples = await iq;
  assert.equal(samples.length, 38_400);
  assert.ok(samples.includes(60) && samples.includes(196)); // +60 and -60 in signed int8.
  const retuned = waitFor(ws, message => message.type === 'status' && message.text.includes('101.100'));
  ws.send(JSON.stringify({ type: 'config', config: { ...DEFAULTS, freqHz: 101_100_000 } }));
  await retuned;
  const second = new WebSocket(`${base}/radio`, { origin });
  await once(second, 'open');
  const refused = once(second, 'close'); second.send(JSON.stringify({ type: 'auth', token: 'test-token' }));
  assert.equal((await refused)[0], 1013);
  const stopped = once(ws, 'close'); ws.send(JSON.stringify({ type: 'stop' })); await stopped;
  const next = await connect(); await next.ready;
  const closed = once(next.ws, 'close'); next.ws.close(); await closed;
});
test('rejects invalid remote configuration without crashing the bridge', async () => {
  const { ws, ready } = await connect(); await ready;
  const error = waitFor(ws, message => message.type === 'error');
  const closed = once(ws, 'close');
  ws.send(JSON.stringify({ type: 'config', config: { ...DEFAULTS, freqHz: -1 } }));
  assert.equal((await error).text, 'Invalid freqHz'); await closed;
  assert.equal((await fetch(`${origin}/bridge.json`)).status, 200);
});
