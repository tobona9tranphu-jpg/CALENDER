const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { send, readBody, preflight } = require('../lib/http');
const { signUser } = require('../lib/auth');
const { findUserByEmail, loadUser, safeUser } = require('../lib/user-repository');
const { query } = require('../lib/db');

function legacyHash(password) { return crypto.createHash('sha256').update(password).digest('hex'); }

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  try {
    const { email, password } = await readBody(req);
    if (!email || !password) return send(res, 400, { error: 'Thiếu email hoặc mật khẩu.' });
    const user = await findUserByEmail(String(email).trim().toLowerCase());
    if (!user) return send(res, 401, { error: 'Email hoặc mật khẩu chưa đúng.' });
    const isBcrypt = typeof user.passwordHash === 'string' && /^\$2[aby]?\$\d{2}\$/.test(user.passwordHash);
    const matches = isBcrypt ? await bcrypt.compare(password, user.passwordHash) : user.passwordHash === legacyHash(password);
    if (!matches) return send(res, 401, { error: 'Email hoặc mật khẩu chưa đúng.' });
    if (!isBcrypt) await query('UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1', [user.id, await bcrypt.hash(password, 12)]);
    const freshUser = await loadUser(user.id);
    return send(res, 200, { token: signUser(user.id), user: safeUser(freshUser) });
  } catch (error) {
    console.error('login failed', error);
    return send(res, 400, { error: 'Dữ liệu không hợp lệ.' });
  }
};
