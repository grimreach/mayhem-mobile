export const LIMITS = { minHz: 1_000_000, maxHz: 6_000_000_000, rates: [[1_000_000, 4_000_000]], canTransmit: false };
export const DEFAULTS = { freqHz: 92_300_000, rateHz: 1_920_000, lna: 24, vga: 24, amp: false };

export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a configuration object');
  const bounds = { freqHz: [LIMITS.minHz, LIMITS.maxHz, 1], rateHz: [1_000_000, 4_000_000, 1], lna: [0, 40, 8], vga: [0, 62, 2] };
  for (const [key, [lo, hi, step]] of Object.entries(bounds)) {
    const value = input[key];
    if (!Number.isSafeInteger(value) || value < lo || value > hi || value % step !== 0) throw new Error(`Invalid ${key}`);
  }
  if (typeof input.amp !== 'boolean') throw new Error('Invalid amp');
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, input[key]]));
}

export function applyConfig(radio, config) {
  radio.targetFreqHz = config.freqHz;
  radio.targetRateHz = config.rateHz;
  radio.setGain(config.lna, config.vga, config.amp);
}
