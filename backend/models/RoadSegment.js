// ─────────────────────────────────────────────
//  Suraksha — models/RoadSegment.js
//  ~100 m piece of a real OpenStreetMap road plus the
//  facts we counted around it. Scores are computed from
//  these on request (time of day, incidents, ratings).
// ─────────────────────────────────────────────
const mongoose = require('mongoose');

const RoadSegmentSchema = new mongoose.Schema(
  {
    key:      { type: String, required: true, unique: true }, // "<osmWayId>:<index>"
    wayId:    { type: Number, index: true },
    name:     { type: String, default: '' },
    highway:  { type: String, default: '' },
    lit:      { type: String, enum: ['yes', 'no', null], default: null },
    lat:      { type: Number, required: true },   // midpoint
    lng:      { type: Number, required: true },
    lengthM:  { type: Number, default: 0 },
    path:     { type: [[Number]], default: [] },  // [[lat,lng],...]

    // Facts counted from OSM around the segment
    lamps:      { type: Number, default: 0 },  // street lamps within 30 m
    pois:       { type: Number, default: 0 },  // shops / amenities within 100 m
    busStops:   { type: Number, default: 0 },  // bus stops within 300 m
    safeSites:  { type: Number, default: 0 },  // police / hospital within 600 m
    coverage:   { type: Number, default: 0 },  // any mapped features within 500 m

    // Women's ratings (1–10)
    ratingSum:   { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },

    osmFetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

RoadSegmentSchema.index({ lat: 1, lng: 1 });

module.exports = mongoose.model('RoadSegment', RoadSegmentSchema);
