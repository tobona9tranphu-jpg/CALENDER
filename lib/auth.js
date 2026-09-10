const jwt = require('jsonwebtoken');

function getSecret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured.');
  return process.env.JWT_SECRET;
}

function signUser(userId) {
  return jwt.sign({ sub: userId }, getSecret(), { expiresIn: '30d' });
}

function getUserId(req) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    return jwt.verify(token, getSecret()).sub;
  } catch {
    return null;
  }
}

module.exports = { signUser, getUserId };
