# Mayhem Pi

First prototype for a Raspberry Pi 5 (4 GB) connected to a HackRF over USB.
Open the Pi's website in Safari on an iPhone or iPad. The Pi owns USB; the browser
runs the existing receiver DSP, waterfall, and audio. No Apple developer account
or iOS USB driver is required.

**Status:** development prototype. Simulated streaming and desktop browser flow
are tested. Pi USB operation, Wi-Fi performance, and iPhone Safari playback have
not yet been verified on physical hardware. The native iPad project is separate
in `../ipad/` and is deferred.

## Install on the Pi

Use a current 64-bit Raspberry Pi OS and Node.js 22 or later with npm. Start with
the Pi and phone on the same LAN; this prototype does not configure a Wi-Fi access
point. A wired Pi connection can leave more wireless capacity for the phone.

From the repository root:

```sh
sudo apt-get update
sudo apt-get install -y build-essential libudev-dev
npm ci --prefix web
npm ci --prefix pi
npm --prefix pi run build
sudo cp pi/99-mayhem-hackrf.rules /etc/udev/rules.d/
sudo usermod -aG plugdev "$USER"
sudo udevadm control --reload-rules
```

Log out and back in for group membership, then unplug/replug the HackRF. Run the
server as your ordinary user. Close other SDR apps that may claim the radio.
A PortaPack must be switched to **HackRF mode** on its screen.

## Test without hardware on the development computer

```sh
npm --prefix pi run demo
```

Open `http://127.0.0.1:8443`, tap CONNECT, and enter the token printed in the
terminal. Demo mode generates an FM carrier 100 kHz above the configured centre
with a 1 kHz audio tone. It does not read a radio. The status identifies it as
**Simulated HackRF**. Open Audio and tune near that carrier to exercise demodulation.
Localhost is a secure context for browser audio; a plain HTTP LAN address is not.

## HTTPS for Safari over Wi-Fi

The existing audio engine uses AudioWorklet, which requires a secure context.
Use a certificate trusted by the phone and valid for the Pi's actual hostname or
IP address. Clicking through a certificate error is not a substitute for trust.

One local development option is [mkcert](https://github.com/FiloSottile/mkcert).
On your development Mac, install mkcert from its official instructions, then:

```sh
mkcert -install
mkdir -p pi/certs
mkcert -cert-file pi/certs/pi.pem -key-file pi/certs/pi-key.pem raspberrypi.local
mkcert -CAROOT
```

Use your Pi's actual hostname in place of `raspberrypi.local`. Copy the generated
server certificate and server key to `pi/certs/` on the Pi. Transfer only
`rootCA.pem` from the displayed CA directory to your iPhone, install the profile,
and enable full trust for that CA in Settings → General → About → Certificate
Trust Settings. Keep `rootCA-key.pem` on the development computer; do not copy it
to the phone or Pi. Certificate/private-key files in `pi/certs/` are gitignored.

From the repository root, run:

```sh
HOST=0.0.0.0 TLS_CERT="$PWD/pi/certs/pi.pem" TLS_KEY="$PWD/pi/certs/pi-key.pem" npm --prefix pi start
```

Open `https://raspberrypi.local:8443` on the iPhone, tap CONNECT, and enter the
terminal's pairing token. The startup address `0.0.0.0` means all Pi interfaces;
use the Pi hostname on the phone. Keep the page foreground and the screen awake
for the initial test. Internet access is not required for local tuning/audio;
some upstream maps, fonts, and online lookups use external services.

To test Wi-Fi before attaching hardware, use the same environment settings with
`npm --prefix pi run demo` instead. A fresh random pairing token is generated on
each restart. Set `BRIDGE_TOKEN` in the environment if a stable token is needed;
do not put it in a URL or commit it. Browser pairing lasts for the current tab
session. One controller can connect at a time. This is a local development service;
do not port-forward it to the internet.

## Scope and throughput

- HackRF reception, tuning, sample rate, LNA/VGA gain, and amplifier control.
- Signed interleaved int8 IQ over binary WebSocket frames, matching the existing DSP worker.
- Receive only: the bridge exposes no transmit command, and the client transmitter is unavailable.
- Initial rate envelope: 1–4 Msps. General audio uses 1.92 Msps (30.72 Mbit/s
  payload); 4 Msps requires 64 Mbit/s plus overhead. These are data-rate calculations,
  not measured Pi performance. Higher rates and simultaneous clients are deferred.
- A slow connection ends explicitly instead of silently dropping IQ and breaking
  decoder timing. Retry at a lower rate or improve the Wi-Fi connection.
- Real USB unplug/reconnect, sustained throughput, and all decoder modes still
  need hardware qualification. If a stalled USB read prevents reconnecting, restart
  the bridge. Pi-side DSP/decimation is a future option if raw IQ costs too much bandwidth.
- Capture uses upstream browser storage APIs and may have Safari-specific limitations.

## Checks

```sh
npm --prefix web run check
npm --prefix pi run build
npm --prefix pi test
npm --prefix web test
```

Bridge tests cover discovery/static serving, pairing/origin checks, configuration
validation, signed IQ streaming, retuning, exclusive control, disconnect/reconnect,
and malformed requests using the simulator. They do not prove physical reception.

Implementation references: [node-usb WebUSB adapter](https://node-usb.github.io/node-usb/)
and [ws](https://github.com/websockets/ws). The upstream GPL-3.0 license and credits
remain in effect.
