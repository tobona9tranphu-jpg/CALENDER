'use strict';

const jwt  = require('jsonwebtoken');
const cookie = require('cookie');

const COOKIE_NAME = 'TB-auth-token';
const isProd = process.env.NODE_ENV === 'production';

// ─── Cookie configuration ─────────────────────────────────────────────────────
// Centralised here so login, logout, and tests all use the same settings.
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  secure:   isProd,       // true on Vercel (HTTPS), false for local HTTP dev
  path:     '/',
  maxAge:   30 * 24 * 60 * 60, // 30 days in seconds (for Set-Cookie header)
};

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function getSecret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured.');
  return process.env.JWT_SECRET;
}

function signUser(userId) {
  return jwt.sign({ sub: userId }, getSecret(), { expiresIn: '30d' });
}

// ─── Token extraction ─────────────────────────────────────────────────────────

/**
 * Extracts and verifies the user ID from a request.
 *
 * Resolution order:
 *  1. HttpOnly cookie  TB-auth-token  (preferred — set by login handler)
 *  2. Authorization: Bearer <token>   (kept for backward-compat during transition;
 *                                     the Express cookieToHeader middleware also
 *                                     uses this path)
 *
 * Returns the userId string or null.
 */
function getUserId(req) {
  // 1. Try cookie first
  const rawCookies = req.headers && req.headers.cookie;
  if (rawCookies) {
    const parsed = cookie.parse(rawCookies);
    const cookieToken = parsed[COOKIE_NAME];
    if (cookieToken) {
      try {
        return jwt.verify(cookieToken, getSecret()).sub;
      } catch {
        // Cookie token invalid/expired — fall through to Authorization header
      }
    }
  }

  // 2. Fallback: Authorization: Bearer <token>
  const header = (req.headers && req.headers.authorization) || '';
  const bearerToken = header.replace(/^Bearer\s+/i, '');
  if (!bearerToken) return null;
  try {
    return jwt.verify(bearerToken, getSecret()).sub;
  } catch {
    return null;
  }
}

// ─── Cookie serialisation helpers ────────────────────────────────────────────

/**
 * Returns a Set-Cookie header value that sets the auth cookie.
 * @param {string} token  Signed JWT
 */
function serializeAuthCookie(token) {
  return cookie.serialize(COOKIE_NAME, token, COOKIE_OPTS);
}

/**
 * Returns a Set-Cookie header value that clears the auth cookie.
 */
function clearAuthCookie() {
  return cookie.serialize(COOKIE_NAME, '', {
    ...COOKIE_OPTS,
    maxAge: 0,
  });
}

module.exports = { signUser, getUserId, serializeAuthCookie, clearAuthCookie, COOKIE_NAME };
