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
    var shownEnd = "";
    var pinFade = 1;
    var pinToken = 0;
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
    function destinationOf(state) {
      var remaining = state.remaining || [];
      var traveled = state.traveled || [];
      var points = remaining.length ? remaining : traveled;
      return points.length ? points[points.length - 1] : null;
    }
    function fadePinIn() {
      var token = ++pinToken;
      var started = Date.now();
      function step() {
        if (token !== pinToken) return;
        pinFade = Math.min(1, (Date.now() - started) / 200);
        render();
        if (pinFade < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    function drawPin(point) {
      if (!point) return;
      var xy = screenPoint(point[0], point[1]);
      ctx.save();
      ctx.globalAlpha = pinFade;
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
    var glyphTint = {};
    function prepareGlyph(kind, src) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        var g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        g.globalCompositeOperation = "source-in";
        g.fillStyle = "#1E1245";
        g.fillRect(0, 0, c.width, c.height);
        glyphTint[kind] = c;
        render();
      };
      img.src = src;
    }
    prepareGlyph("bicycle", "data:image/png;base64,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");
    prepareGlyph("scooter", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANkAAACfCAYAAAB0v3wHAAAEn0lEQVR4nO3dy5bTOhBAUfVd/P8vN4NLIDSdhxOVVFXee8QEIkc6ke08+Pj8/BxAnB+7B0BLUa/cH0H/biiRUelU5nMUDO2/3QOAgyq9KIwxREZNpUITGVWVCU1kEExkVFZiNxMZBBMZ1aXfzUQGwUQGwUQGwURGB6mvy0QGwUQGwXwKnxmfak99urabyJhh1tdPWsbqdBGCiYxMyn0h8xkig2Aio4u013Mig2Aig2Aig2AiI5t2dxhFBsFERicp7zCKDIKJDIKJDIKJDIKJDIKJDIKJjIzeeUM63W18kUEwkUEwkUEwkUEwkZFVm0/ji4yOUt1hFBkEExkEExkEExldpbkuExkEExkEExmZtXivTGQQTGR0luLmh8ggmMggmMjIrvzND5FBMJHR3fabHyKDYCKDYCKDYCKDYCKDYCKjgtLvlYkMgokMgomMKsr+JxQig2Aig2Aig2Aig2Aig2Aig2Aio5KSn/wQGQQTGWex7Q1pkUEwkUEwkUEwkUEwkVFNuU/jiwyCiQyCiQyCiYyzWX5d9mP1A8KLtv+m/atERmZlw7rmdJGsWgQ2hsjIqU1gYzhdJJdWcV3YychiZWBLY7aTsVvL3euanYyd2gc2hp2MPU4R14WdjNVOFdgYImOt0wU2hshY55SBjSEy1sgY2LIxufFBpIxxLWcnI4rAfhEZFX2MQj/ZLTIiRO5iHzf+nJZrMmaLCKxETLfYycguMrAl140iY6bZi7b0DnYhMmaZGdiRGxvpQ1wZmVu6PFLqruGzom583ArqUWjtnuCTmPECumvuv459+jhmR/buk335+2Jjl+lrcFZks08FxVbH7l0s6jJk2hp8J7IV11jXjyG4fHYGtuoa/+3YXr3xseMmxuemxyVO9sC+PuZLj3s0sgwLfffj879356FSYG89/pHIdh/ctUxjYZ0s835os3k2siwHdy3DrnpWO3axjHP91JieiSzjwbHPruuhrB6O7VFkmQ/uosIY+ePoLlZhfu+OsctnFytMBMdVmtebY70XWaUDHKPeeM/oyC7WZj5vRdbmAJnKurjv2+eny+nihUVAOt9FZqES4Syniv+MvdtONkbtCaKhr5FZoOzWYQ3+dQwddzJirP7WRRvXkXU6wE7H0sEZv6b0ew12/t1FoZGC00UIJjKyaHvmITIIJjIIJjIIJjIyaHs9NobIIJzIyKD1m9Uig2AiI1rrXeoZIoNgIoNgIoNg15Gd/tyZrbqtv9/H0/mrLt0mjaK+ni5amOzUcv11vSZrOVmU8df66xiZwGprN3/fRdbuIGGhf/rptpN5geih6jx+O+5bkVU9SEjn3k5WLbRq4+W+avN5c7zdThfppUpod8f5KLIKB/kxaoyT12Sf24fje2Yny3yQmcfGPFnn+alxPXu6mPUgYZenmzhyTZYpNKeI55Npvg+N5egHhC//+K5fF8r0RLPe9fyXWYOv3l3csdgFxrXVZzMvP947t/BXHqTAuCV6bby9zmd8nyzyFFJcPCPiNHLa2pv5pc3vBnX0gEXFu2YEN3UdRn8z+t4uJyiiPQpuyRpc9fMDgmK3bWvQZxch2E+SDIJbm3Ib0wAAAABJRU5ErkJggg==");
    function drawHere(point, heading, kind) {
      if (!point) return;
      var xy = screenPoint(point[0], point[1]);
      ctx.save();
      ctx.translate(xy[0], xy[1]);
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fillStyle = "#F2F2F0";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#3DA5FF";
      ctx.stroke();
      if (heading != null) ctx.rotate((heading - 90) * Math.PI / 180);
      var icon = glyphTint[kind] || glyphTint.bicycle;
      if (icon) {
        var w = 30;
        var h = w * (icon.height / icon.width);
        ctx.drawImage(icon, -w / 2, -h / 2, w, h);
      }
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
      drawPin(destinationOf(ride));
      if (ride.puck) drawHere(ride.puck, ride.heading, ride.vehicle);
      else drawHere(ride.user, null, ride.vehicle);
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
      var end = destinationOf(ride);
      var endKey = end ? end[0].toFixed(5) + "," + end[1].toFixed(5) : "";
      if (endKey !== shownEnd) {
        shownEnd = endKey;
        if (endKey) {
          pinFade = 0;
          fadePinIn();
        }
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
