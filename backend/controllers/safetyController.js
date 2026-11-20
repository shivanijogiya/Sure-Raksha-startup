// ─────────────────────────────────────────────
//  Suraksha — controllers/safetyController.js
//  Real-road safety map: OSM facts + incident reports + ratings
// ─────────────────────────────────────────────
const mongoose = require('mongoose');
const RoadSegment = require('../models/RoadSegment');
const RoadRating = require('../models/RoadRating');
const Flag = require('../models/Flag');
const { scoredSegmentsInBbox, scoreWithGrid, loadIncidentGrid, nearestSegment } = require('../services/roadData');
const { hourIST } = require('../utils/geo');

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function parseBbox(q) {
  const b = [q.south, q.west, q.north, q.east].map(Number);
  if (b.some((x) => Number.isNaN(x))) return null;
  // cap the area to ~0.1° (about 11 km) so one request stays small
  if (b[2] - b[0] > 0.1 || b[3] - b[1] > 0.1) return 'too_big';
  return b;
}

// GET /api/safety/segments?south&west&north&east[&hour]
const getSegments = async (req, res, next) => {
  try {
    const bbox = parseBbox(req.query);
    if (!bbox) return res.status(400).json({ error: 'south, west, north, east are required' });
    if (bbox === 'too_big') return res.status(400).json({ error: 'Zoom in a little — area too large' });
    const hour = req.query.hour !== undefined ? Number(req.query.hour) % 24 : hourIST();
    const rows = await scoredSegmentsInBbox(bbox, { hour });
    res.json({
      hour,
      count: rows.length,
      segments: rows.map(({ seg, result }) => ({
        id: seg._id,
        name: seg.name,
        path: seg.path,
        score: result.score,
        grade: result.grade,
      })),
    });
  } catch (err) { next(err); }
};

// GET /api/safety/segment/:id  → full explanation
const getSegment = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    const seg = await RoadSegment.findById(req.params.id).lean();
    if (!seg) return res.status(404).json({ error: 'Segment not found' });
    const grid = await loadIncidentGrid([seg.lat, seg.lng, seg.lat, seg.lng]);
    const r = scoreWithGrid(seg, grid, hourIST());
    res.json({
      id: seg._id, name: seg.name || 'Unnamed road', highway: seg.highway, lengthM: seg.lengthM,
      lat: seg.lat, lng: seg.lng,
      score: r.score, factsScore: r.factsScore, grade: r.grade, reasons: r.reasons, confidence: r.confidence,
      facts: { lamps: seg.lamps, shops: seg.pois, busStops: seg.busStops, policeOrHospital: seg.safeSites, litTag: seg.lit },
      incidentsNearby: r.incidentCount,
      ratings: { count: seg.ratingCount, average: seg.ratingCount ? +(seg.ratingSum / seg.ratingCount).toFixed(1) : null },
      source: 'OpenStreetMap contributors + Suraksha reports and ratings',
    });
  } catch (err) { next(err); }
};

// GET /api/safety/score?lat=&lng=   (nearest road)
const getScore = async (req, res, next) => {
  try {
    const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
    const hit = await nearestSegment(lat, lng, 150);
    if (!hit) return res.json({ score: null, grade: 'nodata', label: 'No road data within 150 m of this point' });
    const grid = await loadIncidentGrid([lat, lng, lat, lng]);
    const r = scoreWithGrid(hit.seg, grid, hourIST());
    res.json({
      segmentId: hit.seg._id, locationName: hit.seg.name || 'Unnamed road', distM: hit.distM,
      score: r.score, grade: r.grade, reasons: r.reasons, incidentCount: r.incidentCount,
    });
  } catch (err) { next(err); }
};

// GET /api/safety/predict?lat=&lng=  → same road, next 6 hours
const predictRisk = async (req, res, next) => {
  try {
    const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
    const hit = await nearestSegment(lat, lng, 150);
    if (!hit) return res.json({ predictions: [] });
    const grid = await loadIncidentGrid([lat, lng, lat, lng]);
    const now = hourIST();
    const predictions = [];
    for (let o = 0; o <= 5; o++) {
      const h = (now + o) % 24;
      const r = scoreWithGrid(hit.seg, grid, h);
      predictions.push({
        hour: h,
        label: `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`,
        score: r.score,
        colour: r.grade === 'safe' ? 'green' : r.grade === 'caution' ? 'amber' : 'red',
      });
    }
    res.json({ predictions, note: 'Only time of day changes; this is not a forecast of incidents.' });
  } catch (err) { next(err); }
};

// GET /api/safety/heatmap → recent community flags only
const getHeatmap = async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 86400 * 1000);
    const flags = await Flag.find({ createdAt: { $gte: since } }).select('lat lng').lean();
    res.json({ points: flags.map((f) => [f.lat, f.lng, 0.8]) });
  } catch (err) { next(err); }
};

// GET /api/safety/flags
const listFlags = async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 86400 * 1000);
    const flags = await Flag.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(300)
      .select('lat lng flagType createdAt').lean();
    res.json({ flags });
  } catch (err) { next(err); }
};

// POST /api/safety/flag  { lat, lng, flagType }
const flagLocation = async (req, res, next) => {
  try {
    const lat = parseFloat(req.body.lat), lng = parseFloat(req.body.lng);
    const allowed = ['harassment', 'poor_lighting', 'unsafe_crowd', 'other'];
    const flagType = allowed.includes(req.body.flagType) ? req.body.flagType : 'other';
    await Flag.create({ lat, lng, flagType, note: String(req.body.description || '').slice(0, 200) });
    const hit = await nearestSegment(lat, lng, 150);
    let score = null;
    if (hit) {
      const grid = await loadIncidentGrid([lat, lng, lat, lng]);
      score = scoreWithGrid(hit.seg, grid, hourIST()).score;
    }
    res.status(201).json({ message: 'Location flagged', score });
  } catch (err) { next(err); }
};

// Apply one rating to a segment; handles "same device, same day" edits
async function applyRating({ segmentId, clientId, rating, tags }) {
  const day = todayIST();
  const prev = await RoadRating.findOneAndUpdate(
    { segmentId, clientId, day },
    { $set: { rating, tags: tags || [] } },
    { upsert: true, new: false }
  );
  const inc = prev
    ? { ratingSum: rating - prev.rating }
    : { ratingSum: rating, ratingCount: 1 };
  await RoadSegment.updateOne({ _id: segmentId }, { $inc: inc });
}

const cleanTags = (tags) => (Array.isArray(tags) ? tags.filter((t) => RoadRating.TAGS.includes(t)) : []);
const validClient = (c) => typeof c === 'string' && c.length >= 8 && c.length <= 64;

// POST /api/safety/rate  { segmentId, clientId, rating, tags }
const rateSegment = async (req, res, next) => {
  try {
    const { segmentId, clientId } = req.body;
    const rating = Math.round(Number(req.body.rating));
    if (!mongoose.isValidObjectId(segmentId) || !validClient(clientId) || !(rating >= 1 && rating <= 10)) {
      return res.status(400).json({ error: 'segmentId, clientId and rating (1–10) are required' });
    }
    if (!(await RoadSegment.exists({ _id: segmentId }))) return res.status(404).json({ error: 'Segment not found' });
    await applyRating({ segmentId, clientId, rating, tags: cleanTags(req.body.tags) });
    res.status(201).json({ message: 'Thank you — rating saved' });
  } catch (err) { next(err); }
};

// POST /api/safety/rate-batch  { clientId, tags, ratings:[{segmentId, rating}] }  (after a trip)
const rateBatch = async (req, res, next) => {
  try {
    const { clientId, ratings } = req.body;
    if (!validClient(clientId) || !Array.isArray(ratings) || !ratings.length || ratings.length > 300) {
      return res.status(400).json({ error: 'clientId and 1–300 ratings required' });
    }
    const tags = cleanTags(req.body.tags);
    let saved = 0;
    for (const r of ratings) {
      const rating = Math.round(Number(r.rating));
      if (!mongoose.isValidObjectId(r.segmentId) || !(rating >= 1 && rating <= 10)) continue;
      await applyRating({ segmentId: r.segmentId, clientId, rating, tags });
      saved++;
    }
    res.status(201).json({ message: 'Thank you — ratings saved', saved });
  } catch (err) { next(err); }
};

module.exports = { getSegments, getSegment, getScore, predictRisk, getHeatmap, listFlags, flagLocation, rateSegment, rateBatch };
