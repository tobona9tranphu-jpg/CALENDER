'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { send, readBody, preflight } = require('../lib/http');
const { signUser, serializeAuthCookie } = require('../lib/auth');
const { findUserByEmail, loadUser, safeUser } = require('../lib/user-repository');
const { query } = require('../lib/db');

const { validateLoginPayload } = require('../lib/validator');

function legacyHash(password) { return crypto.createHash('sha256').update(password).digest('hex'); }

/**
 * POST /api/login
 *
 * Verifies credentials, then:
 *  - Sets an HttpOnly, SameSite=Strict cookie containing the signed JWT.
 *  - Returns { ok: true, user } — the token is NEVER returned in the response body.
 *
 * This handler runs as a Vercel serverless function in production and is also
 * called by the local Express server (src/server/expressServer.js) via its
 * delegateToHandler() bridge.
 */
module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  try {
    const body = await readBody(req);
    const validation = validateLoginPayload(body);
    if (!validation.valid) return send(res, 400, { error: validation.error });

    const { email, password } = validation;
    const user = await findUserByEmail(email.toLowerCase());
    if (!user) return send(res, 401, { error: 'Email hoặc mật khẩu chưa đúng.' });

    const isBcrypt = typeof user.passwordHash === 'string' && /^\$2[aby]?\$\d{2}\$/.test(user.passwordHash);
    const matches  = isBcrypt
      ? await bcrypt.compare(password, user.passwordHash)
      : user.passwordHash === legacyHash(password);

    if (!matches) return send(res, 401, { error: 'Email hoặc mật khẩu chưa đúng.' });

    // Upgrade legacy hash to bcrypt on successful login
    if (!isBcrypt) {
      await query('UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1',
        [user.id, await bcrypt.hash(password, 12)]);
    }

    const freshUser = await loadUser(user.id);
    const token = signUser(user.id);

    // Set the JWT as an HttpOnly cookie — it must NOT appear in the response body.
    return send(res, 200, { ok: true, user: safeUser(freshUser) }, {
      setCookie: serializeAuthCookie(token),
    });
  } catch (error) {
    console.error('login failed', error.message);
    return send(res, 500, { error: 'Lỗi hệ thống khi đăng nhập.' });
  }
};
