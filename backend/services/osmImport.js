// ─────────────────────────────────────────────
//  Suraksha — services/osmImport.js
//  Pulls real roads + street lamps + shops + bus stops +
//  police/hospitals from OpenStreetMap (Overpass, free) and
//  turns them into ~100 m RoadSegment records.
// ─────────────────────────────────────────────
const axios = require('axios');
const { Grid, haversine, distToPath, pathLength } = require('../utils/geo');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const ROAD_TYPES = 'trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|footway|path|cycleway';
const SEG_LEN = 100; // metres

function waysQuery([s, w, n, e]) {
  return `[out:json][timeout:180];
way["highway"~"^(${ROAD_TYPES})$"]["access"!~"private|no"](${s},${w},${n},${e});
out tags geom;`;
}

function featuresQuery([s, w, n, e]) {
  const b = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:180];
(
  node["highway"="street_lamp"]${b};
  node["highway"="bus_stop"]${b};
  node["public_transport"="platform"]["bus"="yes"]${b};
  nwr["shop"]${b};
  nwr["amenity"]${b};
);
out center tags;`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OSM_PAUSE_MS = Number(process.env.OSM_PAUSE_MS ?? 3000);
const TILE_DEG = 0.06; // small areas time out less

async function overpass(query) {
  let lastErr;
  for (let round = 0; round < 2; round++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await axios.post(url, 'data=' + encodeURIComponent(query), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Suraksha-prototype/1.0' },
          timeout: 200000,
          maxBodyLength: Infinity,
        });
        if (res.data && Array.isArray(res.data.elements)) return res.data;
        lastErr = new Error('Unexpected Overpass response');
      } catch (err) {
        lastErr = err;
        console.warn(`[OSM] ${url} failed: ${err.message}`);
      }
      await sleep(OSM_PAUSE_MS);
    }
    await sleep(OSM_PAUSE_MS * 4);
  }
  throw lastErr;
}

function tiles([s, w, n, e]) {
  const out = [];
  for (let la = s; la < n - 1e-9; la += TILE_DEG) {
    for (let ln = w; ln < e - 1e-9; ln += TILE_DEG) {
      out.push([+la.toFixed(5), +ln.toFixed(5), +Math.min(la + TILE_DEG, n).toFixed(5), +Math.min(ln + TILE_DEG, e).toFixed(5)]);
    }
  }
  return out;
}

// Skip noise: sidewalk/crossing lines duplicate the road beside them
function wantWay(tags = {}) {
  if (tags.footway === 'sidewalk' || tags.footway === 'crossing') return false;
  if (tags.highway === 'footway' && tags.footway === 'traffic_island') return false;
  return true;
}

function litValue(tags = {}) {
  const v = (tags.lit || '').toLowerCase();
  if (['yes', '24/7', 'automatic', 'sunset-sunrise'].includes(v)) return 'yes';
  if (v === 'no' || v === 'disused') return 'no';
  return null;
}

// Cut a way's geometry into pieces of about SEG_LEN metres
function cutWay(points) {
  const pieces = [];
  let cur = [points[0]];
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversine(
      { lat: points[i - 1][0], lng: points[i - 1][1] },
      { lat: points[i][0], lng: points[i][1] }
    );
    cur.push(points[i]);
    len += d;
    if (len >= SEG_LEN) {
      pieces.push(cur);
      cur = [points[i]];
      len = 0;
    }
  }
  if (cur.length > 1) {
    if (pieces.length && len < 30) pieces[pieces.length - 1] = pieces[pieces.length - 1].concat(cur.slice(1));
    else pieces.push(cur);
  }
  return pieces;
}

function classifyFeature(tags = {}) {
  if (tags.highway === 'street_lamp') return 'lamp';
  if (tags.highway === 'bus_stop' || tags.public_transport === 'platform') return 'bus';
  if (tags.amenity === 'police' || tags.amenity === 'hospital') return 'safe';
  if (tags.shop || tags.amenity) return 'poi';
  return null;
}

/**
 * Pure function: Overpass JSON in, segment documents out.
 * @param {object} waysJson      result of waysQuery
 * @param {object} featuresJson  result of featuresQuery
 */
function buildSegments(waysJson, featuresJson) {
  const grids = { lamp: new Grid(), bus: new Grid(), safe: new Grid(), poi: new Grid(), any: new Grid() };
  for (const el of featuresJson.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const kind = classifyFeature(el.tags);
    if (!kind) continue;
    grids[kind].add(lat, lng, kind);
    grids.any.add(lat, lng, kind);
  }

  const segments = [];
  for (const way of waysJson.elements || []) {
    if (way.type !== 'way' || !way.geometry || way.geometry.length < 2) continue;
    if (!wantWay(way.tags)) continue;
    const pts = way.geometry.map((g) => [g.lat, g.lon]);
    const lit = litValue(way.tags);
    cutWay(pts).forEach((path, idx) => {
      const lengthM = Math.round(pathLength(path));
      if (lengthM < 5) return;
      const mid = path[Math.floor(path.length / 2)];
      const here = { lat: mid[0], lng: mid[1] };
      const within = (kind, radius) =>
        grids[kind].near(here.lat, here.lng, radius + 60).filter(
          (f) => distToPath(f, path) <= radius
        ).length;
      segments.push({
        key: `${way.id}:${idx}`,
        wayId: way.id,
        name: way.tags?.name || way.tags?.['name:en'] || '',
        highway: way.tags?.highway || '',
        lit,
        lat: mid[0],
        lng: mid[1],
        lengthM,
        path: path.map(([la, ln]) => [Number(la.toFixed(6)), Number(ln.toFixed(6))]),
        lamps: within('lamp', 30),
        pois: within('poi', 100),
        busStops: within('bus', 300),
        safeSites: within('safe', 600),
        coverage: grids.any.near(here.lat, here.lng, 500).length,
      });
    });
  }
  return segments;
}

async function fetchArea(bbox) {
  const ts = tiles(bbox);
  const ways = new Map();
  const feats = new Map();
  let failed = 0;
  for (let i = 0; i < ts.length; i++) {
    console.log(`[OSM] tile ${i + 1}/${ts.length} ${ts[i].join(',')}`);
    try {
      const w = await overpass(waysQuery(ts[i]));
      await sleep(OSM_PAUSE_MS);
      const f = await overpass(featuresQuery(ts[i]));
      w.elements.forEach((el) => ways.set(el.type + el.id, el));
      f.elements.forEach((el) => feats.set(el.type + el.id, el));
      console.log(`[OSM]   roads so far ${ways.size}, features so far ${feats.size}`);
    } catch (err) {
      failed++;
      console.warn(`[OSM] tile ${i + 1} skipped after retries: ${err.message}`);
    }
    await sleep(OSM_PAUSE_MS);
  }
  if (!ways.size) throw new Error('Overpass servers are busy. Wait 10 minutes and run again.');
  if (failed) console.warn(`[OSM] ${failed} tile(s) failed. Re-run later to fill gaps (safe).`);
  return { ways: { elements: [...ways.values()] }, feats: { elements: [...feats.values()] } };
}

module.exports = { buildSegments, fetchArea, cutWay, litValue, classifyFeature };
