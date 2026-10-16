import type { Radio, RadioEvents, RadioLimits } from './radio.js';

/** Same signed-int8 IQ contract as the USB driver, carried over the Pi's WebSocket. */
export class NetworkRadio implements Radio {
  readonly kind = 'hackrf' as const;
  readonly limits: RadioLimits = { minHz: 1_000_000, maxHz: 6_000_000_000, rates: [[1_000_000, 4_000_000]], canTransmit: false };
  get label(): string { return `${this.board || 'HackRF'} via Pi`; }
  board = ''; firmware = ''; running = false;
  targetFreqHz = 92_300_000; targetRateHz = 1_920_000;
  private lna = 24; private vga = 24; private amp = false;
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastConfig = '';
  private finish: (() => void) | undefined;
  constructor(private token: string, private events: RadioEvents) {}
  setGain(lna: number, vga: number, amp: boolean): void { this.lna = lna; this.vga = vga; this.amp = amp; }
  async open(): Promise<void> {
    const url = new URL('/radio', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = this.ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { ws.close(); reject(new Error('Pi connection timed out')); }, 8000);
      const fail = (message: string): void => { clearTimeout(timeout); reject(new Error(message)); };
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: this.token }));
      ws.onerror = () => fail('Cannot connect to the Pi');
      ws.onclose = e => fail(e.reason || 'Pi disconnected');
      ws.onmessage = e => {
        if (typeof e.data !== 'string') return;
        const message = JSON.parse(e.data);
        if (message.type === 'ready' && message.protocol === 1) {
          clearTimeout(timeout); ws.onclose = e => { this.events.onLog(`Pi disconnected: ${e.reason || 'connection closed'}`); this.closed(); }; ws.onerror = () => this.events.onLog('Pi connection error');
          ws.onmessage = event => this.message(event);
          this.events.onLog(message.demo ? 'SIMULATED RADIO: generated IQ, no hardware connected' : 'Connected to Raspberry Pi bridge');
          resolve();
        } else if (message.type === 'error') fail(message.text);
      };
    });
  }
  async run(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Pi connection is closed');
    this.running = true;
    const done = new Promise<void>(resolve => { this.finish = resolve; });
    this.configure();
    this.ws.send(JSON.stringify({ type: 'start' }));
    this.timer = setInterval(() => this.configure(), 100);
    await done;
  }
  stop(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'stop' }));
    this.ws?.close(); this.closed();
  }
  private configure(): void {
    const config = JSON.stringify({ freqHz: this.targetFreqHz, rateHz: this.targetRateHz, lna: this.lna, vga: this.vga, amp: this.amp });
    if (config !== this.lastConfig && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(`{"type":"config","config":${config}}`); this.lastConfig = config;
    }
  }
  private message(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer) { this.events.onIq(new Int8Array(event.data)); return; }
    try {
      const m = JSON.parse(event.data as string);
      if (m.type === 'status') { this.board = m.board; this.firmware = m.firmware; this.events.onStatus(m.text); }
      else if (m.type === 'log' || m.type === 'error') this.events.onLog(m.text);
    } catch { this.events.onLog('Invalid message from Pi'); this.stop(); }
  }
  private closed(): void {
    clearInterval(this.timer); this.running = false; this.finish?.(); this.finish = undefined;
  }
}
