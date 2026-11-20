// ─────────────────────────────────────────────
//  Suraksha — controllers/safetyRouteController.js
//  GET /api/safety/route?fromLat=&fromLng=&toLat=&toLng=
//  Gets walking routes (free OSM foot router), scores each one
//  from real road data and recommends the safest reasonable one.
// ─────────────────────────────────────────────
const axios = require('axios');
const RoadSegment = require('../models/RoadSegment');
const { loadIncidentGrid } = require('../services/roadData');
const { hourIST, haversine } = require('../utils/geo');
const { scoreRoutePath, similar, sidewaysVia, pickRecommended } = require('../utils/routeScore');

const ROUTING_BASE = process.env.ROUTING_URL || 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';

async function fetchFoot(points, alternatives) {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `${ROUTING_BASE}/${coords}?overview=full&geometries=geojson&alternatives=${alternatives ? 'true' : 'false'}`;
  const res = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Suraksha-prototype/1.0' } });
  if (res.data.code !== 'Ok') return [];
  return res.data.routes.map((r) => ({
    path: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceM: Math.round(r.distance),
    // OSRM foot durations are optimistic; use 4.5 km/h so time matches real walking
    durationMin: Math.max(1, Math.round(r.distance / 75)),
  }));
}

const cache = new Map(); // tiny in-memory cache for repeated routing calls
async function cachedFoot(points, alternatives) {
  const key = points.map((p) => p.lat.toFixed(4) + ',' + p.lng.toFixed(4)).join('|') + alternatives;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.v;
  const v = await fetchFoot(points, alternatives);
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return v;
}

async function getRouteSafety(req, res) {
  try {
    const q = req.query;
    const from = { lat: parseFloat(q.fromLat), lng: parseFloat(q.fromLng) };
    const to = { lat: parseFloat(q.toLat), lng: parseFloat(q.toLng) };
    if ([from.lat, from.lng, to.lat, to.lng].some(Number.isNaN)) {
      return res.status(400).json({ error: 'fromLat, fromLng, toLat, toLng are all required.' });
    }
    const crow = haversine(from, to);
    if (crow > 15000) return res.status(400).json({ error: 'Walking routes are limited to about 15 km.' });
    const hour = q.hour !== undefined ? Number(q.hour) % 24 : hourIST();

    // 1. Candidate routes: the router's own alternatives + two sideways detours
    const bias = Math.min(700, Math.max(150, crow * 0.25));
    const [main, viaA, viaB] = await Promise.all([
      cachedFoot([from, to], true),
      cachedFoot([from, sidewaysVia(from, to, bias), to], false).catch(() => []),
      cachedFoot([from, sidewaysVia(from, to, -bias), to], false).catch(() => []),
    ]);
    const raw = [];
    for (const r of [...main, ...viaA, ...viaB]) {
      if (!r.path.length) continue;
      if (r.distanceM > Math.max(crow * 2.2, 400)) continue; // silly detours
      if (!raw.some((x) => similar(x.path, r.path))) raw.push(r);
      if (raw.length >= 4) break;
    }
    if (!raw.length) return res.status(502).json({ error: 'No walking route found between these points.' });

    // 2. Real road data around all candidates
    const lats = raw.flatMap((r) => r.path.map((p) => p[0]));
    const lngs = raw.flatMap((r) => r.path.map((p) => p[1]));
    const pad = 0.003;
    const bbox = [Math.min(...lats) - pad, Math.min(...lngs) - pad, Math.max(...lats) + pad, Math.max(...lngs) + pad];
    const [segs, grid] = await Promise.all([
      RoadSegment.find({ lat: { $gte: bbox[0], $lte: bbox[2] }, lng: { $gte: bbox[1], $lte: bbox[3] } }).lean(),
      loadIncidentGrid(bbox),
    ]);

    // 3. Score every candidate
    const cands = raw.map((r, i) => ({
      id: 'r' + (i + 1),
      distanceM: r.distanceM,
      durationMin: r.durationMin,
      path: r.path,
      ...scoreRoutePath(r.path, segs, grid, hour),
    }));
    const rec = pickRecommended(cands);
    const fastest = cands.reduce((a, b) => (a.durationMin <= b.durationMin ? a : b));
    cands.forEach((c) => {
      c.isRecommended = c.id === rec.id;
      c.isFastest = c.id === fastest.id;
    });
    cands.sort((a, b) => (b.isRecommended ? 1 : 0) - (a.isRecommended ? 1 : 0) || a.durationMin - b.durationMin);

    res.json({
      hour,
      roadDataLoaded: segs.length > 0,
      recommendedId: rec.id,
      fastestId: fastest.id,
      candidates: cands,
      note: 'Scores come from OpenStreetMap data (lamps, shops, bus stops), recent reports and women’s ratings. Treat as guidance, not a guarantee.',
    });
  } catch (err) {
    console.error('[safety/route]', err.message);
    res.status(500).json({ error: 'Route safety check failed.' });
  }
}

module.exports = { getRouteSafety };
