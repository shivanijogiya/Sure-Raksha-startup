// ─────────────────────────────────────────────
//  Suraksha — models/RoadRating.js
//  One anonymous rating per device per road per day.
// ─────────────────────────────────────────────
const mongoose = require('mongoose');

const TAGS = ['well-lit', 'poorly-lit', 'crowded', 'empty', 'felt-followed', 'felt-safe'];

const RoadRatingSchema = new mongoose.Schema(
  {
    segmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'RoadSegment', required: true },
    clientId:  { type: String, required: true },   // random id kept in the browser, not an account
    day:       { type: String, required: true },   // YYYY-MM-DD (IST)
    rating:    { type: Number, min: 1, max: 10, required: true },
    tags:      [{ type: String, enum: TAGS }],
  },
  { timestamps: true }
);

RoadRatingSchema.index({ segmentId: 1, clientId: 1, day: 1 }, { unique: true });
RoadRatingSchema.statics.TAGS = TAGS;

module.exports = mongoose.model('RoadRating', RoadRatingSchema);
