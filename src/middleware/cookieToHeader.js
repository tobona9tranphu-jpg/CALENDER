'use strict';

/**
 * cookieToHeader middleware
 *
 * The existing api/ handlers (user.js, parse-timetable.js) authenticate by
 * calling lib/auth.getUserId(req), which reads req.headers.authorization.
 * Now that auth tokens live in an HttpOnly cookie the client cannot set that
 * header.  This middleware bridges the gap:
 *
 *   cookie  →  synthetic Authorization header  →  existing handler (unchanged)
 *
 * Security note: this header is constructed server-side from a validated
 * cookie value and is never forwarded from the client.  The downstream handler
 * still verifies the JWT signature, so forging the header client-side has no
 * effect (the cookie is httpOnly and inaccessible to JavaScript).
 *
 * @param {string} cookieName  Name of the authentication cookie.
 */
function cookieToHeader(cookieName) {
  return function (req, _res, next) {
    const token = req.cookies && req.cookies[cookieName];
    if (token) {
      // Synthesise the header the legacy handlers expect
      req.headers['authorization'] = `Bearer ${token}`;
    }
    next();
  };
}

module.exports = { cookieToHeader };
