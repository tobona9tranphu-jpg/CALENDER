const { send, readBody, preflight } = require('../lib/http');
const { getUserId } = require('../lib/auth');
const { loadUser, replaceUser, safeUser } = require('../lib/user-repository');

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  const userId = getUserId(req);
  if (!userId) return send(res, 401, { error: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.' });
  try {
    if (req.method === 'GET') {
      const user = await loadUser(userId);
      return user ? send(res, 200, { user: safeUser(user) }) : send(res, 401, { error: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.' });
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      const current = await loadUser(userId);
      if (!current) return send(res, 401, { error: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.' });
      const updated = { ...body, id: current.id, email: current.email, passwordHash: current.passwordHash };
      const saved = await replaceUser(updated);
      return send(res, 200, { user: safeUser(saved) });
    }
    return send(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error('user route failed', error);
    return send(res, 400, { error: 'Dữ liệu không hợp lệ.' });
  }
};
