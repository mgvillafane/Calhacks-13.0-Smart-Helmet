import { ComponentType, useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { VehicleKind } from "./icons";
import { ScreenState } from "./screen";

const MapWeb = WebView as unknown as ComponentType<Record<string, unknown>>;

const MAP_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body, #map { margin: 0; height: 100%; width: 100%; background: #1a1c22; overflow: hidden; touch-action: none; }
    #tiles { position: absolute; inset: 0; }
    #tiles img { position: absolute; width: 256px; height: 256px; filter: grayscale(0.35) brightness(0.38) contrast(1.2); }
    #draw { position: absolute; inset: 0; width: 100%; height: 100%; }
    #credit { position: absolute; right: 6px; bottom: 4px; background: rgba(20,22,26,.72); color: #8B929C; font: 11px sans-serif; padding: 1px 4px; }
    #status { position: absolute; left: 8px; top: 8px; color: #8B929C; font: 13px sans-serif; }
  </style>
</head>
<body>
  <div id="map">
    <div id="tiles"></div>
    <canvas id="draw"></canvas>
    <div id="credit">© OpenStreetMap</div>
    <div id="status">Loading streets…</div>
  </div>
  <script>
    var TILE = 256;
    var zoom = 16;
    var center = { lat: 37.8703, lng: -122.2595 };
    var ride = { traveled: [], remaining: [], puck: null, decision: null, follow: false, routeKey: "", heading: null, vehicle: "bicycle", user: null };
    var seenRoute = "";
    var userMoved = false;
    var tilesLoaded = 0;
    var mapEl = document.getElementById("map");
    var tileBox = document.getElementById("tiles");
    var canvas = document.getElementById("draw");
    var ctx = canvas.getContext("2d");
    var statusEl = document.getElementById("status");
    var images = {};

    function world(lat, lng, z) {
      var n = Math.pow(2, z);
      var x = (lng + 180) / 360 * n;
      var s = Math.sin(lat * Math.PI / 180);
      var y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
      return { x: x, y: y };
    }
    function unworld(x, y, z) {
      var n = Math.pow(2, z);
      var lng = x / n * 360 - 180;
      var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
      return { lat: lat, lng: lng };
    }
    function size() {
      var rect = mapEl.getBoundingClientRect();
      return { w: rect.width || window.innerWidth, h: rect.height || window.innerHeight };
    }
    function screenPoint(lat, lng) {
      var box = size();
      var c = world(center.lat, center.lng, zoom);
      var p = world(lat, lng, zoom);
      return [box.w / 2 + (p.x - c.x) * TILE, box.h / 2 + (p.y - c.y) * TILE];
    }
    function renderTiles() {
      var box = size();
      var c = world(center.lat, center.lng, zoom);
      var left = c.x - box.w / 2 / TILE;
      var top = c.y - box.h / 2 / TILE;
      var x0 = Math.floor(left);
      var y0 = Math.floor(top);
      var x1 = Math.floor(left + box.w / TILE);
      var y1 = Math.floor(top + box.h / TILE);
      var limit = Math.pow(2, zoom);
      var keep = {};
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          if (y < 0 || y >= limit) continue;
          var wrapped = ((x % limit) + limit) % limit;
          var key = zoom + "/" + wrapped + "/" + y;
          keep[key] = true;
          var img = images[key];
          if (!img) {
            img = document.createElement("img");
            img.alt = "";
            img.src = "https://tile.openstreetmap.org/" + key + ".png";
            img.onload = function () { tilesLoaded += 1; statusEl.textContent = ""; };
            img.onerror = function () { if (!tilesLoaded) statusEl.textContent = "Street tiles did not load. Check the internet connection."; };
            images[key] = img;
            tileBox.appendChild(img);
          }
          img.style.left = ((x - left) * TILE) + "px";
          img.style.top = ((y - top) * TILE) + "px";
        }
      }
      Object.keys(images).forEach(function (key) {
        if (!keep[key]) {
          images[key].remove();
          delete images[key];
        }
      });
    }
    function stroke(points, color, width) {
      if (!points || points.length < 2) return;
      ctx.beginPath();
      points.forEach(function (point, index) {
        var xy = screenPoint(point[0], point[1]);
        if (index === 0) ctx.moveTo(xy[0], xy[1]);
        else ctx.lineTo(xy[0], xy[1]);
      });
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = width + 4;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    function drawPin(point) {
      if (!point) return;
      var xy = screenPoint(point[0], point[1]);
      ctx.save();
      ctx.translate(xy[0], xy[1]);
      ctx.beginPath();
      ctx.moveTo(0, 12);
      ctx.bezierCurveTo(-14, 2, -11, -16, 0, -16);
      ctx.bezierCurveTo(11, -16, 14, 2, 0, 12);
      ctx.closePath();
      ctx.fillStyle = "#FFC400";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#14161A";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -6, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
    }
    function wheelAt(x, y, r) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#142033";
      ctx.stroke();
    }
    function drawBicycleGlyph() {
      wheelAt(-16, 6, 7.5);
      wheelAt(16, 6, 7.5);
      ctx.beginPath();
      ctx.moveTo(-16, 6);
      ctx.lineTo(0, 6);
      ctx.lineTo(0, -10);
      ctx.lineTo(-16, 6);
      ctx.moveTo(0, -10);
      ctx.lineTo(12, -8);
      ctx.lineTo(16, 6);
      ctx.moveTo(0, 6);
      ctx.lineTo(12, -8);
      ctx.moveTo(-6, -12);
      ctx.lineTo(6, -12);
      ctx.moveTo(10, -12);
      ctx.lineTo(22, -12);
      ctx.stroke();
    }
    function drawScooterGlyph() {
      wheelAt(-14, 8, 6);
      wheelAt(16, 8, 6);
      ctx.beginPath();
      ctx.moveTo(-14, 8);
      ctx.lineTo(8, 8);
      ctx.moveTo(-4, 4);
      ctx.lineTo(8, 4);
      ctx.moveTo(8, 8);
      ctx.lineTo(14, -12);
      ctx.lineTo(16, 8);
      ctx.moveTo(10, -12);
      ctx.lineTo(24, -12);
      ctx.stroke();
    }
    function drawUser(point) {
      if (!point) return;
      var xy = screenPoint(point[0], point[1]);
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], 14, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(242,242,240,0.28)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], 5, 0, Math.PI * 2);
      ctx.fillStyle = "#F2F2F0";
      ctx.fill();
    }
    function drawRider(point, heading, kind) {
      if (!point) return;
      var xy = screenPoint(point[0], point[1]);
      ctx.save();
      ctx.translate(xy[0], xy[1]);
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fillStyle = "#F2F2F0";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#3DA5FF";
      ctx.stroke();
      ctx.rotate(((heading == null ? 90 : heading) - 90) * Math.PI / 180);
      ctx.scale(0.55, 0.55);
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1E1245";
      if (kind === "scooter") drawScooterGlyph();
      else drawBicycleGlyph();
      ctx.restore();
    }
    function render() {
      var box = size();
      var dpr = window.devicePixelRatio || 1;
      canvas.width = box.w * dpr;
      canvas.height = box.h * dpr;
      canvas.style.width = box.w + "px";
      canvas.style.height = box.h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderTiles();
      ctx.clearRect(0, 0, box.w, box.h);
      stroke(ride.traveled, "#4A4E54", 5);
      stroke(ride.remaining, "#3DA5FF", 6);
      var end = ride.remaining && ride.remaining.length ? ride.remaining[ride.remaining.length - 1] : null;
      drawPin(ride.decision || end);
      if (ride.puck) drawRider(ride.puck, ride.heading, ride.vehicle);
      else drawUser(ride.user);
    }
    function fit(points) {
      var box = size();
      if (!points || points.length < 2 || box.w < 20) return;
      var chosen = 3;
      for (var z = 17; z >= 3; z--) {
        var projected = points.map(function (point) { return world(point[0], point[1], z); });
        var xs = projected.map(function (point) { return point.x; });
        var ys = projected.map(function (point) { return point.y; });
        var bw = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) * TILE;
        var bh = (Math.max.apply(null, ys) - Math.min.apply(null, ys)) * TILE;
        if (bw < box.w - 64 && bh < box.h - 64) { chosen = z; break; }
      }
      zoom = chosen;
      var sx = 0;
      var sy = 0;
      points.forEach(function (point) {
        var p = world(point[0], point[1], zoom);
        sx += p.x;
        sy += p.y;
      });
      center = unworld(sx / points.length, sy / points.length, zoom);
    }
    function showRide(state) {
      ride = state || ride;
      var points = (ride.traveled || []).concat(ride.remaining || []);
      var changed = ride.routeKey !== seenRoute;
      if (changed) { seenRoute = ride.routeKey; userMoved = false; }
      if (ride.follow && ride.puck && !userMoved) {
        center = { lat: ride.puck[0], lng: ride.puck[1] };
        if (changed) zoom = 16;
      } else if (!points.length && ride.user && !userMoved) {
        center = { lat: ride.user[0], lng: ride.user[1] };
        zoom = 16;
      } else if (changed) {
        fit(points);
      }
      render();
    }
    window.showRide = showRide;
    window.focusUser = function () {
      userMoved = false;
      var point = ride.user || ride.puck;
      if (!point) return;
      center = { lat: point[0], lng: point[1] };
      zoom = 16;
      render();
    };

    var touches = {};
    var pinch = 0;
    function touchList(event) {
      touches = {};
      for (var i = 0; i < event.touches.length; i++) {
        var t = event.touches[i];
        touches[t.identifier] = { x: t.clientX, y: t.clientY };
      }
    }
    function pinchDistance() {
      var ids = Object.keys(touches);
      if (ids.length < 2) return 0;
      var a = touches[ids[0]];
      var b = touches[ids[1]];
      var dx = a.x - b.x;
      var dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    mapEl.addEventListener("touchstart", function (event) {
      touchList(event);
      pinch = pinchDistance();
    }, { passive: true });
    mapEl.addEventListener("touchmove", function (event) {
      event.preventDefault();
      var ids = Object.keys(touches);
      if (ids.length === 1 && event.touches.length === 1) {
        var previous = touches[event.touches[0].identifier];
        var dx = event.touches[0].clientX - previous.x;
        var dy = event.touches[0].clientY - previous.y;
        var c = world(center.lat, center.lng, zoom);
        center = unworld(c.x - dx / TILE, c.y - dy / TILE, zoom);
        userMoved = true;
        render();
      } else if (event.touches.length === 2) {
        touchList(event);
        var next = pinchDistance();
        if (pinch && next) {
          if (next > pinch * 1.12 && zoom < 18) { zoom += 1; pinch = next; userMoved = true; render(); }
          else if (next < pinch * 0.88 && zoom > 3) { zoom -= 1; pinch = next; userMoved = true; render(); }
        }
        return;
      }
      touchList(event);
    }, { passive: false });
    mapEl.addEventListener("touchend", function (event) { touchList(event); pinch = pinchDistance(); });
    window.addEventListener("resize", render);
    render();
  </script>
</body>
</html>`;

export function StreetMap({ screen, vehicle, user, focusNonce = 0 }: { screen: ScreenState; vehicle: VehicleKind; user: [number, number] | null; focusNonce?: number }) {
  const webRef = useRef<WebView>(null);
  const latest = useRef({ screen, vehicle, user });
  const seenFocus = useRef(focusNonce);
  latest.current = { screen, vehicle, user };

  function push(next: ScreenState, kind: VehicleKind, point: [number, number] | null): void {
    const payload = {
      traveled: next.traveled,
      remaining: next.remaining,
      puck: next.puck,
      decision: next.decisionMarker,
      heading: next.puckHeadingDeg,
      vehicle: kind,
      user: point,
      follow: next.phase === "navigating" && next.puck != null,
      routeKey: next.destinationName,
    };
    webRef.current?.injectJavaScript(`window.showRide && window.showRide(${JSON.stringify(payload)}); true;`);
  }

  useEffect(() => {
    push(screen, vehicle, user);
  }, [screen, vehicle, user]);

  useEffect(() => {
    if (seenFocus.current === focusNonce) return;
    seenFocus.current = focusNonce;
    webRef.current?.injectJavaScript("window.focusUser && window.focusUser(); true;");
  }, [focusNonce]);

  return (
    <MapWeb
      ref={webRef}
      originWhitelist={["*"]}
      source={{ html: MAP_HTML, baseUrl: "https://tile.openstreetmap.org/" }}
      style={styles.map}
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled={false}
      setSupportMultipleWindows={false}
      applicationNameForUserAgent="SmartHelmet/1.0"
      onLoadEnd={() => push(latest.current.screen, latest.current.vehicle, latest.current.user)}
    />
  );
}

const styles = StyleSheet.create({
  map: { flex: 1, backgroundColor: "#1a1c22" },
});
