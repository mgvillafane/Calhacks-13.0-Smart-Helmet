#!/usr/bin/env python3
"""Live MPU6050 plot from the ESP32 serial stream."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import serial

PORT_NAME = "/dev/cu.usbmodem101"
HTTP_PORT = 8765
KEEP = 500
lock = threading.Lock()
samples = []
status = "opening serial"

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>MPU6050 live</title>
<style>
  body { margin: 0; font: 15px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; background: #10141a; color: #e7edf5; }
  main { max-width: 980px; margin: 0 auto; padding: 24px 20px 40px; }
  h1 { font-size: 22px; font-weight: 650; margin: 0 0 4px; }
  p { margin: 0; color: #9aabbd; }
  .stats { display: flex; gap: 28px; margin: 18px 0 8px; }
  .stats b { display: block; font-size: 20px; font-weight: 650; color: #f4f7fb; }
  .stats span { color: #9aabbd; font-size: 12px; }
  section { margin-top: 22px; }
  h2 { font-size: 15px; margin: 0 0 8px; font-weight: 600; }
  canvas { width: 100%; height: 240px; background: #181e27; border-radius: 8px; }
  .legend { display: flex; gap: 16px; margin-top: 8px; color: #c5d0dc; font-size: 13px; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
</style>
</head>
<body>
<main>
  <h1>MPU6050 live</h1>
  <p id="status">Waiting for the ESP32…</p>
  <div class="stats">
    <div><b id="ax">—</b><span>X acceleration (g)</span></div>
    <div><b id="ay">—</b><span>Y acceleration (g)</span></div>
    <div><b id="az">—</b><span>Z acceleration (g)</span></div>
    <div><b id="gz">—</b><span>Z rotation (deg/s)</span></div>
  </div>
  <section>
    <h2>Acceleration (g)</h2>
    <canvas id="accel" width="1200" height="320"></canvas>
    <div class="legend"><span><i class="swatch" style="background:#7eb6ff"></i>X</span><span><i class="swatch" style="background:#7dcea0"></i>Y</span><span><i class="swatch" style="background:#f0b429"></i>Z</span></div>
  </section>
  <section>
    <h2>Rotation rate (deg/s)</h2>
    <canvas id="gyro" width="1200" height="320"></canvas>
    <div class="legend"><span><i class="swatch" style="background:#7eb6ff"></i>X</span><span><i class="swatch" style="background:#7dcea0"></i>Y</span><span><i class="swatch" style="background:#f0b429"></i>Z</span></div>
  </section>
</main>
<script>
const colors = ["#7eb6ff", "#7dcea0", "#f0b429"];
function draw(canvas, rows, keys, unit) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#2a3340";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (h * i) / 4;
    ctx.beginPath(); ctx.moveTo(48, y); ctx.lineTo(w - 12, y); ctx.stroke();
  }
  if (!rows.length) return;
  const series = keys.map((key) => rows.map((row) => row[key]));
  let lo = Math.min(...series.flat());
  let hi = Math.max(...series.flat());
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  ctx.fillStyle = "#9aabbd";
  ctx.font = "12px sans-serif";
  ctx.fillText(hi.toFixed(2) + unit, 4, 16);
  ctx.fillText(lo.toFixed(2) + unit, 4, h - 8);
  const left = 48, right = w - 12, top = 16, bottom = h - 22;
  series.forEach((values, index) => {
    ctx.beginPath();
    ctx.strokeStyle = colors[index];
    ctx.lineWidth = 1.6;
    values.forEach((value, i) => {
      const x = left + (values.length === 1 ? 0 : (i / (values.length - 1)) * (right - left));
      const y = bottom - ((value - lo) / (hi - lo)) * (bottom - top);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}
async function tick() {
  try {
    const response = await fetch("/data", { cache: "no-store" });
    const payload = await response.json();
    document.getElementById("status").textContent = payload.status;
    const rows = payload.samples;
    if (rows.length) {
      const last = rows[rows.length - 1];
      document.getElementById("ax").textContent = last.ax.toFixed(3);
      document.getElementById("ay").textContent = last.ay.toFixed(3);
      document.getElementById("az").textContent = last.az.toFixed(3);
      document.getElementById("gz").textContent = last.gz.toFixed(1);
    }
    draw(document.getElementById("accel"), rows, ["ax", "ay", "az"], " g");
    draw(document.getElementById("gyro"), rows, ["gx", "gy", "gz"], " deg/s");
  } catch (error) {
    document.getElementById("status").textContent = "Lost the live feed.";
  }
}
setInterval(tick, 100);
tick();
</script>
</body>
</html>
"""


def reader():
    global status
    port = serial.Serial()
    port.port = PORT_NAME
    port.baudrate = 115200
    port.timeout = 0.2
    port.dtr = False
    port.rts = False
    port.open()
    status = "serial open, waiting for samples"
    buffer = b""
    while True:
        buffer += port.read(4000)
        while b"\\n" in buffer or b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            text = line.decode("utf-8", "replace").strip()
            if text.startswith("MPU6050") or text.startswith("ESP-ROM") or text.startswith("waiting"):
                status = text
            if not text.startswith("imu,"):
                continue
            parts = text.split(",")
            if len(parts) != 8:
                continue
            try:
                sample = {
                    "t": int(parts[1]),
                    "ax": float(parts[2]),
                    "ay": float(parts[3]),
                    "az": float(parts[4]),
                    "gx": float(parts[5]),
                    "gy": float(parts[6]),
                    "gz": float(parts[7]),
                }
            except ValueError:
                continue
            with lock:
                samples.append(sample)
                del samples[:-KEEP]
                status = "Live from /dev/cu.usbmodem101 · last %d ms" % sample["t"]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/data"):
            with lock:
                payload = {"status": status, "samples": samples[-KEEP:]}
            body = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        body = PAGE.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return


def main():
    threading.Thread(target=reader, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), Handler)
    print("live plot at http://127.0.0.1:%d" % HTTP_PORT, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
