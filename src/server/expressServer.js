'use strict';

/**
 * Express server — local development server.
 *
 * Architecture decisions
 * ──────────────────────
 * • Production: Vercel deploys api/*.js as serverless functions directly.
 *   The Express server is ONLY used for local development.
 *
 * • Cookie-based auth: The JWT lives in an HttpOnly, SameSite=Strict cookie.
 *   It is never returned in a JSON response body and never stored in
 *   localStorage / sessionStorage.
 *
 * • The api/ handlers (login.js, logout.js, register.js, user.js, health.js,
 *   parse-timetable.js) now manage cookies themselves via lib/auth.js helpers.
 *   They are mounted directly on the Express app — no bridging needed.
 *
 * • lib/auth.getUserId() reads the HttpOnly cookie first, then falls back to
 *   Authorization: Bearer header.  cookieToHeader middleware is kept for
 *   compatibility but may be removed in a future clean-up.
 *
 * • Static files are served from the project root (same layout as repo).
 * • Same-origin: no CORS configuration needed.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });

const path    = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { requireAuth }  = require('../middleware/requireAuth');
const { errorHandler } = require('../middleware/errorHandler');

const loginHandler          = require('../../api/login');
const logoutHandler         = require('../../api/logout');
const registerHandler       = require('../../api/register');
const userHandler           = require('../../api/user');
const healthHandler         = require('../../api/health');
const parseTimetableHandler = require('../../api/parse-timetable');
const aiHandler             = require('../../api/ai');

const PORT   = process.env.PORT || 4173;
const HOST   = process.env.HOST || '127.0.0.1';
const ROOT   = path.join(__dirname, '../../');
const isProd = process.env.NODE_ENV === 'production';

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();

// ─── Core middleware ──────────────────────────────────────────────────────────

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

// ─── Security Headers Middleware ──────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});

// ─── Public routes (no auth required) ────────────────────────────────────────

// Health — delegates to api/health.js (same handler as Vercel)
app.get('/api/health', (req, res, next) =>
  healthHandler(req, res).catch(next));

// Login — api/login.js now sets the HttpOnly cookie itself via lib/auth helpers
app.post('/api/login', (req, res, next) =>
  loginHandler(req, res).catch(next));

// Logout — api/logout.js clears the cookie
app.post('/api/logout', (req, res, next) =>
  logoutHandler(req, res).catch(next));

// Register — api/register.js sets the HttpOnly cookie itself
app.post('/api/register', (req, res, next) =>
  registerHandler(req, res).catch(next));

// ─── Protected routes ─────────────────────────────────────────────────────────
//
// requireAuth calls lib/auth.getUserId(req) which now reads the HttpOnly cookie
// first (via the raw 'cookie' package), then falls back to Authorization header.
// cookieToHeader middleware is no longer needed since getUserId reads the cookie
// directly, but it is kept in place for compatibility.

app.use('/api', requireAuth);

app.all('/api/user', (req, res, next) =>
  userHandler(req, res).catch(next));

app.post('/api/parse-timetable', (req, res, next) =>
  parseTimetableHandler(req, res).catch(next));

app.post('/api/ai', (req, res, next) =>
  aiHandler(req, res).catch(next));

// ─── 404 for unknown /api/* paths ────────────────────────────────────────────

app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// ─── Static files (project root) ─────────────────────────────────────────────

// Block access to sensitive paths
app.use((req, res, next) => {
  const url = req.path.toLowerCase();
  if (
    url.startsWith('/data/') ||
    url.startsWith('/node_modules/') ||
    url.startsWith('/src/server/') ||
    url.startsWith('/src/middleware/') ||
    url.startsWith('/tests/') ||
    url.startsWith('/scripts/') ||
    url.startsWith('/.env') ||
    url.startsWith('/.git') ||
    url.endsWith('.sql')
  ) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  next();
});

app.use(express.static(ROOT, {
  index: 'index.html',
  setHeaders(res, filePath) {
    // Prevent caching HTML to avoid stale auth state after logout
    if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

// ─── Centralised error handler ────────────────────────────────────────────────

app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────

// Only bind port when run directly — not when required by Jest (avoids EADDRINUSE)
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`[server] TB calendar ready at http://${HOST}:${PORT}`);
    if (!isProd) console.log('[server] DEVELOPMENT mode — Secure cookie flag is OFF');
  });
}

module.exports = app; // exported for supertest
