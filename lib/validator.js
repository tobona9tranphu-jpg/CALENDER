'use strict';

/**
 * P0.6 Server-Side Input Safety & Schema Validation
 *
 * Validates:
 * - Authentication payloads (Login & Registration)
 * - User state updates (Profile, Availability, Tasks, Schedules, Subjects, Milestones)
 * - String lengths, value ranges, and format patterns (dates, times, emails)
 * - Recurrence rules and safety limits
 */

const AppDate = require('../src/utils/date');
const { RecurrenceEngine, DataIntegrity } = require('../src/recurrence');

const TIME_REGEX = /^\d{1,2}:\d{2}$/;
// RFC 5322 compatible safe email regex that excludes HTML tags and malformed domains
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const MAX_STRING_LEN = 300;
const MAX_TEXT_LEN = 5000;

/**
 * Validates email format and length.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string' || email.length > 254) return false;
  return EMAIL_REGEX.test(email.trim());
}

/**
 * Validates Login payload.
 */
function validateLoginPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Thiếu thông tin đăng nhập.' };
  }
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  if (!email || !password) return { valid: false, error: 'Thiếu email hoặc mật khẩu.' };
  if (!isValidEmail(email)) return { valid: false, error: 'Email không đúng định dạng.' };
  if (password.length > 128) return { valid: false, error: 'Mật khẩu quá dài.' };
  return { valid: true, email, password };
}

/**
 * Validates Registration payload.
 */
function validateRegisterPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Thiếu thông tin đăng ký.' };
  }
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!name || !email || !password) return { valid: false, error: 'Thiếu thông tin đăng ký.' };
  if (name.length > 100) return { valid: false, error: 'Tên không được vượt quá 100 ký tự.' };
  if (!isValidEmail(email)) return { valid: false, error: 'Email không đúng định dạng.' };
  if (password.length < 4) return { valid: false, error: 'Mật khẩu cần ít nhất 4 ký tự.' };
  if (password.length > 128) return { valid: false, error: 'Mật khẩu quá dài.' };
  return { valid: true, name, email, password };
}

/**
 * Validates user profile object.
 */
function validateUserProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { valid: false, error: 'profile phải là một đối tượng' };
  }
  if (profile.name !== undefined && (typeof profile.name !== 'string' || profile.name.length > MAX_STRING_LEN)) {
    return { valid: false, error: 'Tên hồ sơ không hợp lệ' };
  }
  if (profile.grade !== undefined && (typeof profile.grade !== 'string' || profile.grade.length > MAX_STRING_LEN)) {
    return { valid: false, error: 'Lớp học không hợp lệ' };
  }
  if (profile.goal !== undefined && (typeof profile.goal !== 'string' || profile.goal.length > MAX_STRING_LEN)) {
    return { valid: false, error: 'Mục tiêu không hợp lệ' };
  }
  return { valid: true };
}

/**
 * Validates availability settings.
 */
function validateAvailability(avail) {
  if (!avail || typeof avail !== 'object' || Array.isArray(avail)) {
    return { valid: false, error: 'availability phải là một đối tượng' };
  }
  if (avail.start && !TIME_REGEX.test(avail.start)) return { valid: false, error: 'Giờ bắt đầu rảnh không hợp lệ' };
  if (avail.end && !TIME_REGEX.test(avail.end)) return { valid: false, error: 'Giờ kết thúc rảnh không hợp lệ' };
  if (Array.isArray(avail.days)) {
    for (const d of avail.days) {
      if (!Number.isInteger(d) || d < 0 || d > 6) return { valid: false, error: 'Thứ trong tuần không hợp lệ' };
    }
  }
  return { valid: true };
}

/**
 * Validates entire user PUT payload before persisting to database.
 */
function validateUserUpdatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Dữ liệu cập nhật phải là một đối tượng JSON' };
  }

  if (body.profile) {
    const pVal = validateUserProfile(body.profile);
    if (!pVal.valid) return pVal;
  }

  if (body.availability) {
    const aVal = validateAvailability(body.availability);
    if (!aVal.valid) return aVal;
  }

  if (body.tasks) {
    if (!Array.isArray(body.tasks) || body.tasks.length > 1000) {
      return { valid: false, error: 'Danh sách nhiệm vụ vượt quá giới hạn cho phép (tối đa 1000)' };
    }
    for (const task of body.tasks) {
      const tVal = DataIntegrity.validateTask(task);
      if (!tVal.valid) return tVal;
      if (task.title.length > MAX_STRING_LEN) return { valid: false, error: 'Tiêu đề nhiệm vụ quá dài' };
    }
  }

  if (body.fixedSchedules) {
    if (!Array.isArray(body.fixedSchedules) || body.fixedSchedules.length > 500) {
      return { valid: false, error: 'Danh sách lịch cố định vượt quá giới hạn (tối đa 500)' };
    }
    for (const sched of body.fixedSchedules) {
      const sVal = DataIntegrity.validateSchedule(sched);
      if (!sVal.valid) return sVal;
      if (sched.title.length > MAX_STRING_LEN) return { valid: false, error: 'Tiêu đề lịch cố định quá dài' };
    }
  }

  if (body.subjects) {
    if (!Array.isArray(body.subjects) || body.subjects.length > 100) {
      return { valid: false, error: 'Danh sách môn học vượt quá giới hạn (tối đa 100)' };
    }
    for (const sub of body.subjects) {
      if (!sub || typeof sub !== 'object' || !sub.id || !sub.name || typeof sub.name !== 'string') {
        return { valid: false, error: 'Cấu trúc môn học không hợp lệ' };
      }
      if (sub.name.length > MAX_STRING_LEN) return { valid: false, error: 'Tên môn học quá dài' };
      if (Array.isArray(sub.topics)) {
        if (sub.topics.length > 200) return { valid: false, error: 'Số lượng chủ đề vượt quá giới hạn (tối đa 200)' };
        for (const top of sub.topics) {
          if (!top || typeof top !== 'object' || !top.id || !top.name || typeof top.name !== 'string') {
            return { valid: false, error: 'Cấu trúc chủ đề không hợp lệ' };
          }
          if (top.name.length > MAX_STRING_LEN) return { valid: false, error: 'Tên chủ đề quá dài' };
        }
      }
    }
  }

  if (body.studyNotes) {
    if (!Array.isArray(body.studyNotes) || body.studyNotes.length > 1000) {
      return { valid: false, error: 'Danh sách ghi chú vượt quá giới hạn (tối đa 1000)' };
    }
    for (const note of body.studyNotes) {
      if (note && note.noteText && note.noteText.length > MAX_TEXT_LEN) {
        return { valid: false, error: 'Nội dung ghi chú vượt quá độ dài tối đa' };
      }
    }
  }

  return { valid: true };
}

module.exports = {
  isValidEmail,
  validateLoginPayload,
  validateRegisterPayload,
  validateUserProfile,
  validateAvailability,
  validateUserUpdatePayload
};
