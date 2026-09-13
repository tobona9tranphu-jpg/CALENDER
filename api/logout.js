'use strict';

const { send, preflight } = require('../lib/http');
const { clearAuthCookie } = require('../lib/auth');

/**
 * POST /api/logout
 *
 * Clears the TB-auth-token HttpOnly cookie.
 * Safe to call even when no active session exists.
 *
 * Vercel serverless function — also mounted by the local Express server.
 */
module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });

  // Clear the auth cookie using the same options it was set with
  return send(res, 200, { ok: true }, { setCookie: clearAuthCookie() });
};
