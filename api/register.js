const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { send, readBody, preflight } = require('../lib/http');
const { signUser } = require('../lib/auth');
const { findUserByEmail, createUser, safeUser } = require('../lib/user-repository');

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

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  try {
    const { name, email, password } = await readBody(req);
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!name || !normalizedEmail || !password) return send(res, 400, { error: 'Thiếu thông tin đăng ký.' });
    if (password.length < 4) return send(res, 400, { error: 'Mật khẩu cần ít nhất 4 ký tự.' });
    if (await findUserByEmail(normalizedEmail)) return send(res, 409, { error: 'Email đã tồn tại. Hãy đăng nhập hoặc dùng email khác.' });
    const user = await createUser(defaultUser({ id: `user-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, email: normalizedEmail, name: String(name).trim(), passwordHash: await bcrypt.hash(password, 12) }));
    return send(res, 201, { token: signUser(user.id), user: safeUser(user) });
  } catch (error) {
    console.error('register failed', error);
    return send(res, error.code === 'INVALID_JSON' ? 400 : 500, { error: error.code === 'INVALID_JSON' ? 'Dữ liệu không hợp lệ.' : 'Máy chủ đăng ký đang gặp lỗi.' });
  }
};
