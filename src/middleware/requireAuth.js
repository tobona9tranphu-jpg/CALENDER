'use strict';

const { getUserId } = require('../../lib/auth');

/**
 * requireAuth middleware
 *
 * Reads the HttpOnly TB-auth-token cookie via getUserId() and validates the JWT.
 *
 * Returns 401 if:
 *  - No auth cookie was present (getUserId returns null)
 *  - The JWT is expired, malformed, or signed with the wrong secret
 *
 * Attaches req.userId for downstream handlers (not currently used by legacy
 * handlers since they call getUserId(req) themselves, but available for future
 * route handlers).
 */
function requireAuth(req, res, next) {
  const userId = getUserId(req);

  if (!userId) {
    return res.status(401).json({ error: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.' });
  }

  req.userId = userId;
  next();
}

module.exports = { requireAuth };
