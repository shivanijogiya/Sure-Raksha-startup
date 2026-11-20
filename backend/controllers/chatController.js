// ─────────────────────────────────────────────
//  Suraksha — controllers/chatController.js
//  POST /api/chat  { messages: [{role, content}] }
//  Legal assistant "Nyaya", powered by Gemini.
// ─────────────────────────────────────────────
const gemini = require('../services/gemini');
const { redact } = require('../utils/redact');
const SYSTEM_PROMPT = require('../prompts/legalAssistant');

const MAX_MESSAGES = 20;
const MAX_CHARS    = 2000;

const FALLBACK =
  "I'm having trouble reaching the assistant right now. If you are in danger, call 112 (emergency) or the Women Helpline 181.";

const chat = async (req, res) => {
  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }

  // Keep only well-formed turns, trim, redact obvious identifiers, cap length.
  const clean = messages
    .slice(-MAX_MESSAGES)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: redact(m.content).slice(0, MAX_CHARS) }));

  // Gemini requires the conversation to start with, and end on, a user turn.
  while (clean.length && clean[0].role !== 'user') clean.shift();
  if (!clean.length || clean[clean.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'last message must be from the user' });
  }

  try {
    const reply = await gemini.chat(clean, { systemInstruction: SYSTEM_PROMPT });
    return res.json({ reply: reply || FALLBACK, model: gemini.MODEL });
  } catch (err) {
    console.error('[CHAT] Gemini error:', err.message);
    // Do not leak provider errors to the client; always give a safe fallback.
    return res.status(502).json({ error: FALLBACK });
  }
};

module.exports = { chat };
