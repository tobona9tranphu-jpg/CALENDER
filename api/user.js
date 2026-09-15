const { send, readBody, preflight } = require('../lib/http');
const { getUserId } = require('../lib/auth');
const { loadUser, replaceUser, safeUser } = require('../lib/user-repository');
const { validateUserUpdatePayload } = require('../lib/validator');
const { DataIntegrity } = require('../src/recurrence');

// getUserId(req) in lib/auth now reads the HttpOnly TB-auth-token cookie first,
// then falls back to Authorization: Bearer header. No changes needed here.

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
      const validation = validateUserUpdatePayload(body);
      if (!validation.valid) {
        return send(res, 400, { error: validation.error });
      }

      const current = await loadUser(userId);
      if (!current) return send(res, 401, { error: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.' });

      // Run through data integrity pipeline to normalize and validate schedules/tasks
      const processed = DataIntegrity.processUserDataPipeline(body);
      const sanitized = (processed && processed.data) ? processed.data : body;

      const updated = {
        ...sanitized,
        id: current.id,
        email: current.email,
        passwordHash: current.passwordHash
      };

      console.log('[USER API PUT] Saving user to database:', {
        userId,
        fixedSchedules: updated.fixedSchedules?.length,
        tasks: updated.tasks?.length,
        subjects: updated.subjects?.length
      });

      const saved = await replaceUser(updated);
      return send(res, 200, { user: safeUser(saved) });
    }
    return send(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error('user route failed', error);
    // Validation errors are thrown with an explicit .status / .statusCode of 400.
    // Everything else (DB failure, unexpected crash) is a server error → 500.
    const status = (error.status === 400 || error.statusCode === 400 || error.isValidationError) ? 400 : 500;
    const message = status === 400 ? (error.message || 'Dữ liệu không hợp lệ.') : 'Đã xảy ra lỗi máy chủ. Vui lòng thử lại.';
    return send(res, status, { error: message });
  }
};
