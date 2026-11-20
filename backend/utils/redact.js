// ─────────────────────────────────────────────
//  Suraksha — utils/redact.js
//  Best-effort removal of obvious identifiers BEFORE
//  any text leaves our servers for an AI model.
//
//  This is a first line of defence (regex only). It does
//  NOT catch names or free-text addresses. Planned upgrade:
//  a Gemma pass on Cloud Run and/or Cloud DLP.
// ─────────────────────────────────────────────
const RULES = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,            '[EMAIL]'],
  [/https?:\/\/\S+/gi,                                            '[LINK]'],
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,                            '[ID_NUMBER]'],   // Aadhaar-like
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g,                                     '[PAN]'],
  [/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g,                    '[PHONE]'],        // Indian mobile
  [/\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{4}\b/g,       '[VEHICLE_NO]'],   // e.g. MH 12 AB 1234
];

function redact(text) {
  if (typeof text !== 'string') return '';
  return RULES.reduce((acc, [re, token]) => acc.replace(re, token), text);
}

module.exports = { redact };
