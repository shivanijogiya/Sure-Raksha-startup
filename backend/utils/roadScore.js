// ─────────────────────────────────────────────
//  Suraksha — utils/roadScore.js
//  Road safety score (0–100), starts at 100 and loses points.
//  Not machine learning: a transparent rule set whose every
//  deduction is returned as a human-readable reason.
//
//  Inputs: OSM facts (lamps, shops, bus stops, police/hospital),
//          time of day, recent incidents nearby, women's ratings.
// ─────────────────────────────────────────────
const { hourIST } = require('./geo');

const REMOTE_TYPES = new Set(['footway', 'path', 'cycleway', 'track', 'service']);
const FAST_TYPES = new Set(['trunk', 'primary']);

const RATING_WEIGHT_K = 5; // 5 ratings = ratings and map facts count equally

function timeFactor(hour) {
  if (hour >= 21 || hour < 5) return { f: 1, label: 'night' };
  if (hour >= 18) return { f: 0.75, label: 'evening' };
  return { f: 0.5, label: 'day' };
}

/**
 * @param {object} seg       RoadSegment (lean)
 * @param {object} [ctx]
 * @param {number} [ctx.hour]        hour in IST (default now)
 * @param {Array}  [ctx.incidents]   [{ageHours}] reports near this segment
 * @returns {{score:number|null, factsScore:number|null, grade:string, reasons:string[], confidence:string}}
 */
function scoreSegment(seg, ctx = {}) {
  const hour = ctx.hour ?? hourIST();
  const incidents = ctx.incidents || [];
  const t = timeFactor(hour);

  if (!seg.coverage) {
    return { score: null, factsScore: null, grade: 'nodata', reasons: ['Not enough map data here yet'], confidence: 'none' };
  }

  let score = 100;
  const reasons = [];
  const lose = (pts, why) => {
    const p = Math.round(pts);
    if (p <= 0) return;
    score -= p;
    reasons.push(`−${p} ${why}`);
  };

  // 1. Lighting
  if (seg.lit === 'yes') {
    reasons.push('Road is mapped as lit');
  } else if (seg.lit === 'no') {
    lose(22 * t.f + 4, 'road is mapped as unlit');
  } else if (seg.lamps >= 2) {
    reasons.push(`${seg.lamps} street lamps within 30 m`);
  } else if (seg.lamps === 1) {
    lose(6 * t.f + 1, 'only 1 street lamp nearby');
  } else {
    lose(16 * t.f + 2, 'no street lamps mapped nearby');
  }

  // 2. Activity (people around): shops / amenities
  if (seg.pois >= 5) {
    reasons.push(`${seg.pois} shops/amenities within 100 m`);
  } else if (seg.pois >= 2) {
    lose(4 * (0.5 + t.f), 'few shops nearby');
  } else if (seg.pois === 1) {
    lose(8 * (0.5 + t.f), 'only one shop/amenity nearby');
  } else {
    lose(14 * (0.5 + t.f), 'no shops or amenities nearby (isolated)');
  }

  // 3. Public transport
  if (seg.busStops > 0) reasons.push(`${seg.busStops} bus stop(s) within 300 m`);
  else lose(5, 'no bus stop within 300 m');

  // 4. Help nearby
  if (seg.safeSites > 0) reasons.push('Police station / hospital within 600 m');
  else lose(4, 'no police station or hospital within 600 m');

  // 5. Road type
  if (REMOTE_TYPES.has(seg.highway)) lose(8 * (0.5 + t.f), `${seg.highway} path, usually quiet`);
  else if (FAST_TYPES.has(seg.highway)) lose(5, 'fast highway, few pedestrians');

  // 6. Time of day
  if (t.label === 'night') lose(8, 'night time (9pm–5am)');
  else if (t.label === 'evening') lose(4, 'evening (6–9pm)');

  // 7. Recent incident reports within 150 m (last 30 days, already filtered)
  if (incidents.length) {
    let pen = 0;
    for (const i of incidents) pen += i.ageHours <= 24 ? 14 : i.ageHours <= 168 ? 9 : 5;
    pen = Math.min(pen, 40);
    lose(pen, `${incidents.length} incident report(s) nearby in the last 30 days`);
  }

  const factsScore = Math.max(0, Math.min(100, Math.round(score)));

  // 8. Women's ratings (1–10) blend in as weight n/(n+K)
  let final = factsScore;
  const n = seg.ratingCount || 0;
  if (n > 0) {
    const avg = seg.ratingSum / n;
    const w = n / (n + RATING_WEIGHT_K);
    final = Math.round(factsScore * (1 - w) + avg * 10 * w);
    reasons.push(`${n} rating(s) by women, average ${avg.toFixed(1)}/10 (${Math.round(w * 100)}% of the score)`);
  }

  const confidence = n >= 5 ? 'high' : seg.coverage >= 8 ? 'medium' : 'low';
  return { score: final, factsScore, grade: gradeOf(final), reasons, confidence };
}

function gradeOf(score) {
  if (score == null) return 'nodata';
  if (score >= 70) return 'safe';
  if (score >= 45) return 'caution';
  return 'risk';
}

module.exports = { scoreSegment, gradeOf, timeFactor };
