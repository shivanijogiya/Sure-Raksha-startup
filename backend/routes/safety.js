// ─────────────────────────────────────────────
//  Suraksha — routes/safety.js
// ─────────────────────────────────────────────
const express  = require('express');
const router   = express.Router();
const { validateFlag, validateCoordQuery } = require('../middleware/validate');
const {
  getScore, getHeatmap, flagLocation, predictRisk,
  getSegments, getSegment, listFlags, rateSegment, rateBatch,
} = require('../controllers/safetyController');
const { getRouteSafety } = require('../controllers/safetyRouteController');

// GET /api/safety/score?lat=&lng=
router.get('/score', validateCoordQuery, getScore);

// GET /api/safety/heatmap
router.get('/heatmap', getHeatmap);

// POST /api/safety/flag
router.post('/flag', validateFlag, flagLocation);

// GET /api/safety/predict?lat=&lng=
router.get('/predict', validateCoordQuery, predictRisk);

// GET /api/safety/route?from=&to=
router.get('/route', getRouteSafety);

// Real-road map
router.get('/segments', getSegments);
router.get('/segment/:id', getSegment);
router.get('/flags', listFlags);

// Women's ratings (anonymous, one per device per road per day)
const rateLimit = require('express-rate-limit');
const rateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many ratings, try later.' } });
router.post('/rate', rateLimiter, rateSegment);
router.post('/rate-batch', rateLimiter, rateBatch);

module.exports = router;