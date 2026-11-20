// ─────────────────────────────────────────────
//  Suraksha — utils/triage.js
//  Gemini-powered complaint triage → structured JSON.
//  Output is advisory: it tags risk and suggests a
//  severity; it never changes complaint status.
// ─────────────────────────────────────────────
const { Type } = require('@google/genai');
const gemini   = require('../services/gemini');
const { redact } = require('./redact');

const RISK_TAGS  = ['harassment-prone', 'stalking-prone', 'poor-lighting', 'isolated', 'other'];
const CATEGORIES = ['harassment', 'stalking', 'assault', 'unsafe_area', 'other'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    suggestedCategory: { type: Type.STRING, enum: CATEGORIES },
    severity:          { type: Type.STRING, enum: SEVERITIES },
    riskTags:          { type: Type.ARRAY, items: { type: Type.STRING, enum: RISK_TAGS } },
    immediateDanger:   { type: Type.BOOLEAN },
    summary:           { type: Type.STRING },
  },
  required: ['suggestedCategory', 'severity', 'riskTags', 'immediateDanger', 'summary'],
};

const SYSTEM = `You triage anonymous safety complaints for a women's-safety platform in India.
Classify the complaint. Do not invent facts. Do not include names, phone numbers or exact addresses in the summary.
"summary" is one neutral sentence (max 200 characters). Set immediateDanger=true only if the text describes an ongoing or imminent threat.`;

/**
 * @returns {Promise<null | {suggestedCategory,severity,riskTags,immediateDanger,summary,model}>}
 *          null when Gemini is off / unavailable — callers must treat triage as optional.
 */
async function triageComplaint({ category, description, location }) {
  if (process.env.GEMINI_TRIAGE === 'off' || !gemini.isConfigured()) return null;

  try {
    const prompt =
      `User-selected category: ${category || 'other'}\n` +
      `Area (coarse): ${redact(location || '').slice(0, 100)}\n` +
      `Complaint text:\n${redact(description).slice(0, 2000)}`;

    const out = await gemini.generateJson({ prompt, schema: SCHEMA, systemInstruction: SYSTEM });

    return {
      suggestedCategory: CATEGORIES.includes(out.suggestedCategory) ? out.suggestedCategory : 'other',
      severity:          SEVERITIES.includes(out.severity) ? out.severity : 'medium',
      riskTags:          (out.riskTags || []).filter((t) => RISK_TAGS.includes(t)),
      immediateDanger:   Boolean(out.immediateDanger),
      summary:           String(out.summary || '').slice(0, 200),
      model:             gemini.MODEL,
    };
  } catch (err) {
    console.error('[TRIAGE] skipped:', err.message);
    return null;
  }
}

module.exports = { triageComplaint };
