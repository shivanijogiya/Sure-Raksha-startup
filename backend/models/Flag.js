// ─────────────────────────────────────────────
//  Suraksha — models/Flag.js
//  Anonymous "flag this area" reports from the map.
// ─────────────────────────────────────────────
const mongoose = require('mongoose');

const FlagSchema = new mongoose.Schema(
  {
    lat:      { type: Number, required: true },
    lng:      { type: Number, required: true },
    flagType: { type: String, enum: ['harassment', 'poor_lighting', 'unsafe_crowd', 'other'], default: 'other' },
    note:     { type: String, default: '', maxlength: 200 },
  },
  { timestamps: true }
);

FlagSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // auto-delete after 90 days
FlagSchema.index({ lat: 1, lng: 1 });

module.exports = mongoose.model('Flag', FlagSchema);
