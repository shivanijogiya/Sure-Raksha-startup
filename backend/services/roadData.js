// ─────────────────────────────────────────────
//  Suraksha — services/roadData.js
//  Loads road segments for an area, attaches recent incident
//  reports and returns scored segments.
// ─────────────────────────────────────────────
const RoadSegment = require('../models/RoadSegment');
const Flag = require('../models/Flag');
const Complaint = require('../models/Complaint');
const { Grid, haversine, hourIST } = require('../utils/geo');
const { scoreSegment } = require('../utils/roadScore');

const INCIDENT_RADIUS_M = 150;
const INCIDENT_DAYS = 30;

async function loadIncidentGrid(bbox) {
  const since = new Date(Date.now() - INCIDENT_DAYS * 86400 * 1000);
  const pad = 0.003;
  const [s, w, n, e] = bbox;
  const [flags, complaints] = await Promise.all([
    Flag.find({ createdAt: { $gte: since }, lat: { $gte: s - pad, $lte: n + pad }, lng: { $gte: w - pad, $lte: e + pad } })
      .select('lat lng createdAt').lean(),
    Complaint.find({
      createdAt: { $gte: since },
      'coordinates.lat': { $gte: s - pad, $lte: n + pad },
      'coordinates.lng': { $gte: w - pad, $lte: e + pad },
    }).select('coordinates createdAt').lean(),
  ]);
  const grid = new Grid();
  const now = Date.now();
  for (const f of flags) grid.add(f.lat, f.lng, { ageHours: (now - f.createdAt) / 3600000 });
  for (const c of complaints) {
    if (c.coordinates?.lat != null) grid.add(c.coordinates.lat, c.coordinates.lng, { ageHours: (now - c.createdAt) / 3600000 });
  }
  return grid;
}

function scoreWithGrid(seg, grid, hour) {
  const incidents = grid.near(seg.lat, seg.lng, INCIDENT_RADIUS_M).map((e) => e.item);
  return { ...scoreSegment(seg, { hour, incidents }), incidentCount: incidents.length };
}

/** Segments whose midpoint lies inside bbox = [south, west, north, east], with scores. */
async function scoredSegmentsInBbox(bbox, { hour = hourIST(), limit = 6000 } = {}) {
  const [s, w, n, e] = bbox;
  const [segs, grid] = await Promise.all([
    RoadSegment.find({ lat: { $gte: s, $lte: n }, lng: { $gte: w, $lte: e } }).limit(limit).lean(),
    loadIncidentGrid(bbox),
  ]);
  return segs.map((seg) => ({ seg, result: scoreWithGrid(seg, grid, hour) }));
}

/** Nearest segment to a point within maxM metres (or null). */
async function nearestSegment(lat, lng, maxM = 150) {
  const d = maxM / 111320;
  const cands = await RoadSegment.find({
    lat: { $gte: lat - d - 0.0006, $lte: lat + d + 0.0006 },
    lng: { $gte: lng - d - 0.0006, $lte: lng + d + 0.0006 },
  }).lean();
  let best = null, bestD = Infinity;
  const { distToPath } = require('../utils/geo');
  for (const c of cands) {
    const dist = distToPath({ lat, lng }, c.path);
    if (dist < bestD) { best = c; bestD = dist; }
  }
  return bestD <= maxM ? { seg: best, distM: Math.round(bestD) } : null;
}

module.exports = { scoredSegmentsInBbox, scoreWithGrid, loadIncidentGrid, nearestSegment, haversine };
