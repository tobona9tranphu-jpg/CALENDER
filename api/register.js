'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { send, readBody, preflight } = require('../lib/http');
const { signUser, serializeAuthCookie } = require('../lib/auth');
const { findUserByEmail, createUser, safeUser } = require('../lib/user-repository');
const { validateRegisterPayload } = require('../lib/validator');

function defaultUser({ id, email, name, passwordHash }) {
  return {
    id, email, passwordHash, onboarded: false,
    profile: { name, grade: '', goal: '', timezone: 'Asia/Ho_Chi_Minh' },
    availability: { start: '15:00', end: '21:00', days: [1, 2, 3, 4, 5] },
    settings: { reminders: true, coach: true }, subjects: [], tasks: [], fixedSchedules: [], sessions: [], reviewSchedules: [], studyNotes: [],
    examMilestones: [
      { id: 'm-midterm1', title: 'Thi Giữa Học Kỳ I', date: '2026-10-20', subjects: 'Các môn chính' },
      { id: 'm-final1', title: 'Thi Cuối Học Kỳ I', date: '2026-12-25', subjects: 'Tất cả các môn' },
      { id: 'm-thpt', title: 'Kỳ thi Tốt nghiệp THPT 2026', date: '2026-06-26', subjects: 'Tổ hợp thi' },
    ],
    lastSimulation: null, scheduleChanges: [],
  };
}

/**
 * POST /api/register
 *
 * Creates a new account, then sets an HttpOnly auth cookie.
 * Returns { ok: true, user } — the token is NEVER returned in the response body.
 *
 * Vercel serverless function — also called by the local Express server bridge.
 */
module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  try {
    const body = await readBody(req);
    const validation = validateRegisterPayload(body);
    if (!validation.valid) return send(res, 400, { error: validation.error });

    const { name, email, password } = validation;
    const normalizedEmail = email.toLowerCase().trim();
    if (await findUserByEmail(normalizedEmail)) return send(res, 409, { error: 'Email đã tồn tại. Hãy đăng nhập hoặc dùng email khác.' });

    const user = await createUser(defaultUser({
      id: `user-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      email: normalizedEmail,
      name: String(name).trim(),
      passwordHash: await bcrypt.hash(password, 12),
    }));

    const token = signUser(user.id);

    // Set the JWT as an HttpOnly cookie — it must NOT appear in the response body.
    return send(res, 201, { ok: true, user: safeUser(user) }, {
      setCookie: serializeAuthCookie(token),
    });
  } catch (error) {
    console.error('register failed', error.message);
    return send(res, 500, { error: 'Lỗi hệ thống khi đăng ký.' });
  }
};
