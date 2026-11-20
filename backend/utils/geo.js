// ─────────────────────────────────────────────
//  Suraksha — utils/geo.js
//  Small geometry helpers (metres, lat/lng)
// ─────────────────────────────────────────────
const M_PER_DEG = 111320;
const toRad = (d) => (d * Math.PI) / 180;

function haversine(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Distance (m) from point p to segment a-b using a local flat projection
function distToSegment(p, a, b) {
  const k = Math.cos(toRad(p.lat));
  const ax = (a.lng - p.lng) * M_PER_DEG * k, ay = (a.lat - p.lat) * M_PER_DEG;
  const bx = (b.lng - p.lng) * M_PER_DEG * k, by = (b.lat - p.lat) * M_PER_DEG;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

// path: [[lat,lng],...]
function distToPath(p, path) {
  if (path.length === 1) return haversine(p, { lat: path[0][0], lng: path[0][1] });
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = distToSegment(
      p,
      { lat: path[i][0], lng: path[i][1] },
      { lat: path[i + 1][0], lng: path[i + 1][1] }
    );
    if (d < best) best = d;
  }
  return best;
}

function pathLength(path) {
  let sum = 0;
  for (let i = 0; i < path.length - 1; i++) {
    sum += haversine(
      { lat: path[i][0], lng: path[i][1] },
      { lat: path[i + 1][0], lng: path[i + 1][1] }
    );
  }
  return sum;
}

// Points every `stepM` metres along a path (includes first and last point)
function resample(path, stepM = 50) {
  if (path.length < 2) return path.map(([lat, lng]) => ({ lat, lng, at: 0 }));
  const out = [{ lat: path[0][0], lng: path[0][1], at: 0 }];
  let travelled = 0;
  let nextAt = stepM;
  for (let i = 0; i < path.length - 1; i++) {
    const a = { lat: path[i][0], lng: path[i][1] };
    const b = { lat: path[i + 1][0], lng: path[i + 1][1] };
    const seg = haversine(a, b);
    while (seg > 0 && travelled + seg >= nextAt) {
      const t = (nextAt - travelled) / seg;
      out.push({ lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng), at: nextAt });
      nextAt += stepM;
    }
    travelled += seg;
  }
  const last = path[path.length - 1];
  const tail = out[out.length - 1];
  if (haversine(tail, { lat: last[0], lng: last[1] }) > stepM / 3) {
    out.push({ lat: last[0], lng: last[1], at: travelled });
  }
  return out;
}

// Bucket grid for "what is within r metres" queries
class Grid {
  constructor(cellDeg = 0.002) {
    this.cell = cellDeg;
    this.map = new Map();
  }
  _key(ix, iy) { return ix + ':' + iy; }
  add(lat, lng, item) {
    const k = this._key(Math.floor(lat / this.cell), Math.floor(lng / this.cell));
    let arr = this.map.get(k);
    if (!arr) { arr = []; this.map.set(k, arr); }
    arr.push({ lat, lng, item });
  }
  near(lat, lng, radiusM) {
    const dLat = radiusM / M_PER_DEG;
    const dLng = radiusM / (M_PER_DEG * Math.max(0.2, Math.cos(toRad(lat))));
    const y0 = Math.floor((lat - dLat) / this.cell), y1 = Math.floor((lat + dLat) / this.cell);
    const x0 = Math.floor((lng - dLng) / this.cell), x1 = Math.floor((lng + dLng) / this.cell);
    const out = [];
    const here = { lat, lng };
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const arr = this.map.get(this._key(y, x));
        if (!arr) continue;
        for (const e of arr) {
          if (haversine(here, e) <= radiusM) out.push(e);
        }
      }
    }
    return out;
  }
}

// Hour of day (0-23) in India, independent of the server's timezone
function hourIST(date = new Date()) {
  const h = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata',
  }).format(date);
  return Number(h) % 24;
}

module.exports = { haversine, distToSegment, distToPath, pathLength, resample, Grid, hourIST, M_PER_DEG };
