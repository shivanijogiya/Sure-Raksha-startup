// ─────────────────────────────────────────────
//  Suraksha — utils/routeScore.js
//  Scores a walking route against real road segments.
//  Pure functions (no DB) so they can be tested offline.
// ─────────────────────────────────────────────
const { Grid, distToPath, resample, haversine } = require('./geo');
const { scoreSegment, gradeOf } = require('./roadScore');

const STEP_M = 50;
const SNAP_M = 60;        // a sample point belongs to a road if it is within 60 m of it
const DANGER_BELOW = 45;

/**
 * @param {Array<[number,number]>} path  route geometry [[lat,lng],...]
 * @param {Array} segs                   RoadSegment docs (lean) around the route
 * @param {Grid}  incidentGrid           recent incidents
 * @param {number} hour                  IST hour
 */
function scoreRoutePath(path, segs, incidentGrid, hour) {
  const segGrid = new Grid();
  for (const s of segs) segGrid.add(s.lat, s.lng, s);

  const memo = new Map();
  const scoreOf = (seg) => {
    const k = String(seg._id);
    if (!memo.has(k)) {
      const incidents = incidentGrid.near(seg.lat, seg.lng, 150).map((e) => e.item);
      memo.set(k, scoreSegment(seg, { hour, incidents }));
    }
    return memo.get(k);
  };

  const samples = resample(path, STEP_M).map((p) => {
    let best = null, bestD = Infinity;
    for (const c of segGrid.near(p.lat, p.lng, 160)) {
      const d = distToPath(p, c.item.path);
      if (d < bestD) { best = c.item; bestD = d; }
    }
    if (!best || bestD > SNAP_M) return { ...p, seg: null, score: null };
    const r = scoreOf(best);
    return { ...p, seg: best, score: r.score, reasons: r.reasons };
  });

  const known = samples.filter((s) => s.score != null);
  const coverage = samples.length ? known.length / samples.length : 0;

  let score = null;
  if (known.length >= 3 && coverage >= 0.3) {
    const avg = known.reduce((a, s) => a + s.score, 0) / known.length;
    let worst = avg;
    for (let i = 0; i + 2 < known.length; i++) {
      const w = (known[i].score + known[i + 1].score + known[i + 2].score) / 3;
      if (w < worst) worst = w;
    }
    score = Math.round(0.75 * avg + 0.25 * worst);
  }

  // Runs of low-score samples → danger zones
  const dangerZones = [];
  let run = [];
  const flush = () => {
    if (run.length) {
      const mid = run[Math.floor(run.length / 2)];
      dangerZones.push({
        lat: mid.lat, lng: mid.lng,
        lengthM: run.length * STEP_M,
        score: Math.round(run.reduce((a, s) => a + s.score, 0) / run.length),
        name: mid.seg?.name || '',
        reasons: (mid.reasons || []).filter((r) => r.startsWith('−')).slice(0, 3),
      });
    }
    run = [];
  };
  for (const s of samples) {
    if (s.score != null && s.score < DANGER_BELOW) run.push(s); else flush();
  }
  flush();

  // Roads along the route (ordered, unique segments) for the after-trip rating
  const roadsMap = new Map();
  const seen = new Set();
  for (const s of samples) {
    if (!s.seg || seen.has(String(s.seg._id))) continue;
    seen.add(String(s.seg._id));
    const name = s.seg.name || 'Unnamed road';
    if (!roadsMap.has(name)) roadsMap.set(name, []);
    roadsMap.get(name).push(String(s.seg._id));
  }
  const roads = [...roadsMap].map(([name, segmentIds]) => ({ name, segmentIds }));

  return { score, grade: gradeOf(score), coverage: +coverage.toFixed(2), dangerZones, roads };
}

/** Are two routes basically the same line? (mean distance of samples to the other) */
function similar(a, b) {
  const sa = resample(a, 100);
  let sum = 0;
  for (const p of sa) sum += distToPath(p, b);
  return sum / sa.length < 40;
}

/** Point offset sideways from the middle of a line, to force a different road choice */
function sidewaysVia(from, to, metres) {
  const mid = { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 };
  const dLat = to.lat - from.lat, dLng = (to.lng - from.lng) * Math.cos((mid.lat * Math.PI) / 180);
  const len = Math.hypot(dLat, dLng) || 1;
  const nLat = -dLng / len, nLng = dLat / len;
  const degLat = metres / 111320;
  return { lat: mid.lat + nLat * degLat, lng: mid.lng + (nLng * degLat) / Math.cos((mid.lat * Math.PI) / 180) };
}

/** Pick the recommended route: best score among routes not much longer than the shortest. */
function pickRecommended(cands) {
  const shortest = Math.min(...cands.map((c) => c.distanceM));
  const ok = cands.filter((c) => c.distanceM <= shortest * 1.5);
  const scored = ok.filter((c) => c.score != null);
  if (!scored.length) return cands.reduce((a, b) => (a.durationMin <= b.durationMin ? a : b));
  return scored.reduce((a, b) =>
    b.score > a.score + 1 || (Math.abs(b.score - a.score) <= 1 && b.distanceM < a.distanceM) ? b : a
  );
}

module.exports = { scoreRoutePath, similar, sidewaysVia, pickRecommended, haversine };
