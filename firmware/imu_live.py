#!/usr/bin/env python3
"""Live IMU and motion-based brake plots; accepts old and new firmware streams."""
import argparse
import csv
import json
import math
import re
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

RAW_FIELDS = ("t", "ax", "ay", "az", "gx", "gy", "gz")
BRAKE_FIELDS = ("linear_g", "average_g", "delta_v_mps", "braking", "ready", "rotation_blocked")
CSV_FIELDS = RAW_FIELDS + BRAKE_FIELDS
KEEP = 1500

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Helmet IMU &amp; brakes</title>
<style>
body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#10141a;color:#e7edf5}
main{max-width:1100px;margin:auto;padding:24px 20px 40px}h1{font-size:24px;margin:0}
p{color:#a9b8c9;margin:6px 0}.stats{display:flex;gap:24px;flex-wrap:wrap;margin:20px 0}
.stats b{display:block;font-size:22px}.stats span,.legend{color:#a9b8c9;font-size:13px}
section{margin:24px 0}h2{font-size:16px;margin-bottom:8px}canvas{width:100%;height:220px;background:#181e27;border-radius:8px}
.legend{margin:6px 0}.blue{color:#7eb6ff}.green{color:#7dcea0}.yellow{color:#f0b429}.red{color:#ff7b7b}
button,select,a.button{background:#263345;color:#e7edf5;border:1px solid #4b5d75;border-radius:6px;padding:7px 12px;font:inherit;text-decoration:none}
.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:16px}
</style></head>
<body><main>
<h1>Helmet IMU &amp; brakes</h1>
<p id="status" role="status">Waiting for samples...</p>
<p>Keep the helmet still for 0.5 s after startup. This detects horizontal speed changes; acceleration can also trigger it.</p>
<div class="controls"><button id="pause">Pause graph</button>
<label>Window <select id="window"><option value="10">10 s</option><option value="20" selected>20 s</option><option value="30">30 s</option></select></label>
<a class="button" href="/download.csv">Download CSV</a></div>
<div class="stats">
<div><b id="brake">Waiting</b><span>Brake estimate</span></div>
<div><b id="average">--</b><span>300 ms average (g)</span></div>
<div><b id="dv">--</b><span>300 ms velocity change (m/s)</span></div>
<div><b id="rotation">--</b><span>Rotation magnitude (deg/s)</span></div>
</div>
<section><h2>Acceleration (g)</h2><canvas id="accel" width="1200" height="300"></canvas><div class="legend"><span class="blue">X</span> / <span class="green">Y</span> / <span class="yellow">Z</span></div></section>
<section><h2>Rotation rate (deg/s)</h2><canvas id="gyro" width="1200" height="300"></canvas><div class="legend"><span class="blue">X</span> / <span class="green">Y</span> / <span class="yellow">Z</span></div></section>
<section><h2>Motion used by the brake detector (g)</h2><canvas id="motion" width="1200" height="300"></canvas><div class="legend"><span class="blue">Horizontal acceleration</span> / <span class="green">Rolling vector average</span> / <span class="red">ON threshold</span> / <span class="yellow">OFF threshold</span>. Shading marks an active brake.</div></section>
<section><h2>Short-window velocity change (m/s)</h2><canvas id="velocity" width="1200" height="300"></canvas><div class="legend">Magnitude over 300 ms, not absolute speed. Vertical acceleration is excluded.</div></section>
</main>
<script>
const colors = ["#7eb6ff","#7dcea0","#f0b429"];
let paused = false, latest = null;
document.getElementById("pause").onclick = () => { paused = !paused; document.getElementById("pause").textContent = paused ? "Resume graph" : "Pause graph"; if (!paused && latest) render(latest); };
document.getElementById("window").onchange = () => { if (latest) render(latest); };
function draw(id, rows, keys, unit, lines = []) {
  const canvas = document.getElementById(id), ctx = canvas.getContext("2d");
  const w=canvas.width, h=canvas.height, left=70, right=w-18, top=18, bottom=h-30;
  ctx.clearRect(0,0,w,h);
  const valid = rows.flatMap(row => keys.map(key => row[key])).filter(Number.isFinite);
  if (!valid.length) { ctx.fillStyle="#a9b8c9"; ctx.font="16px sans-serif"; ctx.fillText(rows.length ? "Flash updated firmware for brake metrics." : "Waiting for samples...",left,h/2); return; }
  let lo=Math.min(0,...valid,...lines.map(l=>l.value)), hi=Math.max(0.02,...valid,...lines.map(l=>l.value));
  const pad=Math.max((hi-lo)*0.12,0.01); lo-=pad; hi+=pad;
  const end=rows[rows.length-1].t, start=end-Number(document.getElementById("window").value)*1000;
  const px=t=>left+(t-start)/(end-start)*(right-left), py=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
  for (let i=0;i<rows.length;i++) { if (rows[i].braking===1) { ctx.fillStyle="#ff525222"; const x=Math.max(left,px(rows[i].t)), next=i+1<rows.length?px(rows[i+1].t):right; ctx.fillRect(x,top,Math.max(1,next-x),bottom-top); } }
  ctx.font="12px sans-serif";
  for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4,y=py(v);ctx.strokeStyle="#2a3340";ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle="#a9b8c9";ctx.fillText(v.toFixed(2),5,y+4);}
  for(let i=0;i<=4;i++){const t=start+(end-start)*i/4;ctx.fillStyle="#a9b8c9";ctx.fillText(((t-end)/1000).toFixed(0)+"s",px(t)-10,h-8);}
  lines.forEach(line=>{ctx.setLineDash([7,5]);ctx.strokeStyle=line.color;ctx.beginPath();ctx.moveTo(left,py(line.value));ctx.lineTo(right,py(line.value));ctx.stroke();ctx.setLineDash([]);});
  keys.forEach((key,index)=>{ctx.beginPath();ctx.strokeStyle=colors[index];ctx.lineWidth=2;let pen=false,lastT=null;
    rows.forEach(row=>{const v=row[key];if(!Number.isFinite(v)){pen=false;return;}const x=px(row.t),y=py(v);if(!pen || (lastT!==null && row.t-lastT>200))ctx.moveTo(x,y);else ctx.lineTo(x,y);pen=true;lastT=row.t;});ctx.stroke();});
  ctx.fillStyle="#a9b8c9";ctx.fillText(unit,right-50,15);
}
function render(payload){
  const all=payload.samples, last=all[all.length-1], age=payload.last_sample_age_s, fresh=age!==null && age<1;
  const rows=last?all.filter(row=>row.t>=last.t-Number(document.getElementById("window").value)*1000):[];
  document.getElementById("status").textContent=payload.status+(age!==null?" | last sample "+age.toFixed(1)+" s ago":"");
  const el=document.getElementById("brake");
  el.textContent=!fresh?"No live data":!last.metrics?"Raw IMU only":!last.ready?"Keep still: calibrating":last.rotation_blocked?"Head movement":last.braking?"BRAKE ON":"Released";
  el.className=fresh&&last&&last.braking?"red":"green";
  document.getElementById("average").textContent=fresh&&last.metrics?last.average_g.toFixed(3):"--";
  document.getElementById("dv").textContent=fresh&&last.metrics?last.delta_v_mps.toFixed(3):"--";
  document.getElementById("rotation").textContent=fresh?Math.hypot(last.gx,last.gy,last.gz).toFixed(1):"--";
  draw("accel",rows,["ax","ay","az"],"g"); draw("gyro",rows,["gx","gy","gz"],"deg/s");
  draw("motion",rows,["linear_g","average_g"],"g",[{value:payload.settings.on_g,color:"#ff7b7b"},{value:payload.settings.off_g,color:"#f0b429"}]);
  draw("velocity",rows,["delta_v_mps"],"m/s");
}
async function tick(){try{const r=await fetch("/data",{cache:"no-store"});latest=await r.json();if(!paused)render(latest);}catch(error){document.getElementById("status").textContent="Lost connection to the plot server.";document.getElementById("brake").textContent="No live data";}finally{setTimeout(tick,100);}}
tick();
</script></body></html>
"""


def parse_sample(line):
    """Old firmware has 8 CSV columns; new firmware adds 6 brake metrics."""
    parts = line.strip().split(",")
    if len(parts) not in (8, 14) or parts[0] != "imu":
        return None
    try:
        sample = dict(zip(RAW_FIELDS, [int(parts[1])] + [float(v) for v in parts[2:8]]))
        if not 0 <= sample["t"] <= 0xFFFFFFFF or not all(math.isfinite(sample[k]) for k in RAW_FIELDS):
            return None
        sample["metrics"] = len(parts) == 14
        if sample["metrics"]:
            values = [float(v) for v in parts[8:11]] + [int(v) for v in parts[11:14]]
            if not all(math.isfinite(v) for v in values) or any(v < 0 for v in values[:3]) or any(v not in (0, 1) for v in values[3:]):
                return None
            sample.update(zip(BRAKE_FIELDS, values))
        return sample
    except ValueError:
        return None


def read_settings():
    header = Path(__file__).with_name("include").joinpath("brake.h").read_text(encoding="utf-8")
    def value(name):
        return float(re.search(r"^#define\s+" + name + r"\s+([0-9.]+)", header, re.M)[1])
    return {"on_g": value("BRAKE_ON_G"), "off_g": value("BRAKE_OFF_G"),
            "window_ms": value("BRAKE_WINDOW_MS")}


class Feed:
    def __init__(self, csv_path=None):
        self.lock = threading.Lock()
        self.samples = deque(maxlen=KEEP)
        self.status = "Waiting for serial"
        self.last_sample_at = None
        self.settings = read_settings()
        self.csv_file = open(csv_path, "w", newline="", encoding="utf-8") if csv_path else None
        self.writer = csv.DictWriter(self.csv_file, fieldnames=CSV_FIELDS, extrasaction="ignore") if self.csv_file else None
        if self.writer:
            self.writer.writeheader()

    def add(self, sample):
        with self.lock:
            if self.samples and sample["t"] < self.samples[-1]["t"]:
                self.samples.clear()
            self.samples.append(sample)
            self.last_sample_at = time.monotonic()
            if self.writer:
                self.writer.writerow(sample)
                self.csv_file.flush()

    def set_status(self, status):
        with self.lock:
            self.status = status

    def snapshot(self):
        with self.lock:
            age = None if self.last_sample_at is None else time.monotonic() - self.last_sample_at
            return {"status": self.status, "samples": list(self.samples),
                    "last_sample_age_s": age, "settings": self.settings}

    def close(self):
        if self.csv_file:
            self.csv_file.close()


def serial_reader(feed, port_name, baud, stop):
    import serial
    while not stop.is_set():
        try:
            port = serial.Serial(port=None, baudrate=baud, timeout=0.2)
            port.dtr = False
            port.rts = False
            port.port = port_name
            port.open()
            with port:
                feed.set_status("Connected to " + port_name + "; waiting for IMU samples")
                buffer = b""
                while not stop.is_set():
                    buffer += port.read(4096)
                    while b"\n" in buffer:
                        raw, buffer = buffer.split(b"\n", 1)
                        line = raw.decode("utf-8", "replace").strip()
                        sample = parse_sample(line)
                        if sample is not None:
                            feed.add(sample)
                            feed.set_status("Live from " + port_name + (" | brake metrics" if sample["metrics"] else " | old firmware: raw IMU only"))
                        elif line.startswith(("MPU6050", "IMU read failed", "ESP-ROM")):
                            feed.set_status(line)
                    if len(buffer) > 65536:
                        buffer = b""
        except (serial.SerialException, OSError) as error:
            feed.set_status(str(error) + " | retrying " + port_name)
            stop.wait(1)


def demo_reader(feed, stop):
    feed.set_status("SYNTHETIC DEMO - no connected hardware")
    t = 0
    while not stop.is_set():
        phase = (t // 1000) % 8
        moving = 2 <= phase < 5
        ax = 0.12 if moving else 0.0
        ready = int(t >= 500)
        avg = 0.12 if moving and t % 1000 >= 300 else 0.0
        row = f"imu,{t},{ax},0,1,0,0,0,{abs(ax)},{avg},{avg * 9.80665 * 0.3},{int(avg > 0.08)},{ready},0"
        feed.add(parse_sample(row))
        t += 20
        stop.wait(0.02)


def handler_for(feed):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            if path == "/data":
                body = json.dumps(feed.snapshot(), allow_nan=False).encode()
                content_type = "application/json"
            elif path == "/download.csv":
                import io
                text = io.StringIO(newline="")
                writer = csv.DictWriter(text, fieldnames=CSV_FIELDS, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(feed.snapshot()["samples"])
                body, content_type = text.getvalue().encode(), "text/csv; charset=utf-8"
            elif path == "/":
                body, content_type = PAGE.encode(), "text/html; charset=utf-8"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            if path == "/download.csv":
                self.send_header("Content-Disposition", 'attachment; filename="helmet-imu.csv"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            pass
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", help="Serial port, e.g. COM7 or /dev/cu.usbmodem101")
    parser.add_argument("--list-ports", action="store_true")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--http-port", type=int, default=8765)
    parser.add_argument("--csv", type=Path, help="Record samples to a CSV file")
    parser.add_argument("--demo", action="store_true", help="Synthetic graph preview without hardware")
    args = parser.parse_args()
    port_name = args.port
    if not args.demo:
        try:
            from serial.tools import list_ports
        except ImportError:
            parser.error("Install pySerial: python -m pip install -r firmware/requirements.txt")
        ports = list(list_ports.comports())
        if args.list_ports:
            for port in ports:
                print(f"{port.device}: {port.description} [{port.hwid}]")
            return
        if port_name is None:
            esp = [p for p in ports if p.vid == 0x303A]
            candidates = esp or [p for p in ports if p.vid in (0x10C4, 0x1A86, 0x0403)]
            if len(candidates) != 1:
                parser.error("Select --port explicitly; use --list-ports to see connected devices")
            port_name = candidates[0].device
    stop = threading.Event()
    feed = Feed(args.csv)
    server = ThreadingHTTPServer(("127.0.0.1", args.http_port), handler_for(feed))
    target = demo_reader if args.demo else serial_reader
    arguments = (feed, stop) if args.demo else (feed, port_name, args.baud, stop)
    worker = threading.Thread(target=target, args=arguments, daemon=True)
    worker.start()
    print(f"Live plot: http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        worker.join(timeout=2)
        server.server_close()
        feed.close()


if __name__ == "__main__":
    main()
