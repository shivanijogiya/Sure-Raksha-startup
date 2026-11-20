// ─────────────────────────────────────────────
//  Suraksha — routes/chat.js
// ─────────────────────────────────────────────
const express = require('express');
const rateLimit = require('express-rate-limit');
const router  = express.Router();
const { chat } = require('../controllers/chatController');

// Model calls cost money — stricter than the global limiter.
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many chat requests. Please try again in a few minutes.' },
});

// POST /api/chat
router.post('/', chatLimiter, chat);

module.exports = router;
