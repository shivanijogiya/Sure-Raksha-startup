// ─────────────────────────────────────────────
//  Suraksha — models/Complaint.js
// ─────────────────────────────────────────────
const mongoose = require('mongoose');

const ComplaintSchema = new mongoose.Schema(
  {
    anonymousToken: { type: String, required: true, unique: true },
    category: {
      type: String,
      enum: ['harassment', 'stalking', 'assault', 'unsafe_area', 'other'],
      default: 'other',
    },
    description: { type: String, required: true },
    location:    { type: String, default: '' },
    coordinates: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    riskTags: [{ type: String, enum: ['harassment-prone', 'stalking-prone', 'poor-lighting', 'isolated', 'other'] }],
    status: {
      type:    String,
      enum:    ['submitted', 'under_review', 'escalated', 'resolved'],
      default: 'submitted',
    },
    // Advisory output from Gemini triage (null when AI is off/unavailable)
    triage: {
      type: new mongoose.Schema({
        suggestedCategory: String,
        severity:          { type: String, enum: ['low', 'medium', 'high', 'critical'] },
        immediateDanger:   Boolean,
        summary:           String,
        model:             String,
      }, { _id: false }),
      default: null,
    },
    statusHistory: [
      {
        status:    { type: String },
        note:      { type: String, default: '' },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Complaint', ComplaintSchema);