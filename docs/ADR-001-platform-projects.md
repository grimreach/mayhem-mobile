# ADR-001: Separate Raspberry Pi and iPad projects

Status: Accepted for the first prototype
Date: 2026-10-15

## Context

The user wants separate Pi and iPad projects, with Pi first. The existing upstream
contains an Android app and a TypeScript browser app. An iPhone cannot run the
required USBDriverKit driver; an M4 iPad can. The Pi can own USB and serve a network
client to either device.

## Decision

Use `pi/` for the independently runnable bridge, `ipad/` for the deferred native
project, and retain `web/` as the browser client shared with the Pi. Keep these in
the fork initially so upstream code stays traceable; this is not yet two separate
GitHub repositories. Pi work is on branch `pi-bridge`.

Reuse the existing HackRF vendor-protocol driver through node-usb's WebUSB adapter.
Send signed interleaved int8 IQ over an authenticated, same-origin WebSocket.
The phone runs the existing DSP worker and AudioWorklet. Start receive-only, with
a 4 Msps ceiling, one controller, bounded output buffering, and HTTPS for LAN use.
The first validation uses a synthetic FM source with no attached radio.

## Alternatives and trade-offs

- A new libhackrf bridge would use the vendor library but duplicate integration
  work. Reusing the existing driver preserves upstream behavior; compatibility
  with node-usb and real hardware must still be validated.
- Pi-side DSP would greatly reduce Wi-Fi bandwidth, but requires a different
  decoder/audio transport. Raw IQ preserves browser functionality and moves that
  optimization until after measurements. At 1.92 Msps, payload is 30.72 Mbit/s;
  at 4 Msps it is 64 Mbit/s, excluding network overhead.
- Separate repositories can follow when each project has a release/build identity.
  Separate directories now avoid duplicating shared code during the prototype.

## Consequences and next steps

No Apple account is needed for Pi browser use. Trusted local HTTPS certificates
need setup on the phone. Hardware throughput, USB reconnects, Safari audio, and
background behavior require real-device tests; simulated tests cannot prove them.
Obtain the Pi model and radio model, validate audio and tuning on that setup, then
decide whether to move DSP to the Pi. Begin the native iPad project afterwards.
