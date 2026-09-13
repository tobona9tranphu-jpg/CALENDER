'use strict';

const { getUserId } = require('../../lib/auth');

/**
 * requireAuth middleware
 *
 * Must be used AFTER cookieToHeader so that req.headers.authorization is
 * populated from the cookie.
 *
 * Returns 401 if:
 *  - No auth cookie was present (cookieToHeader sets no header → getUserId returns null)
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
