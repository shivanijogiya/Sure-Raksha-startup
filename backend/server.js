// ─────────────────────────────────────────────
//  Suraksha — server.js  (Entry point)
// ─────────────────────────────────────────────
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const dotenv   = require('dotenv');

dotenv.config();

const app = express();

// Cloud Run / Firebase Hosting sit behind Google's proxy. Without this,
// every user shares one IP and the rate limiter blocks everybody together.
app.set('trust proxy', 1);

// ── Middleware ────────────────────────────────
// CORS: with Firebase Hosting rewriting /api/** to this service the browser
// sees one origin, so CORS is only needed for local dev or a separate domain.
// Set CORS_ORIGINS="https://your-app.web.app,https://your-domain.in"
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({
  origin:  allowedOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// ── Rate limiter ──────────────────────────────
const apiLimiter = require('./middleware/rateLimit');
app.use('/api/', apiLimiter);

// ── Routes ────────────────────────────────────
const complaintRoutes = require('./routes/complaints');
const evidenceRoutes  = require('./routes/evidence');
const safetyRoutes    = require('./routes/safety');
const reportRoutes    = require('./routes/report');
const contactRoutes   = require('./routes/contacts');
const chatRoutes      = require('./routes/chat');

app.use('/api/complaints', complaintRoutes);
app.use('/api/evidence',   evidenceRoutes);
app.use('/api/safety',     safetyRoutes);
app.use('/api/report',     reportRoutes);
app.use('/api/contacts',   contactRoutes);
app.use('/api/chat',       chatRoutes);

// ── Health check ──────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

// ── 404 catch-all ─────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Global error handler ──────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── MongoDB + Start ───────────────────────────
// Cloud Run injects PORT (8080). Local default stays 5000 to match the docs.
const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('[DB] MongoDB connected');
    app.listen(PORT, '0.0.0.0', () => console.log(`[SERVER] Listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  });