const { send, readBody, preflight } = require('../lib/http');
const { overlaps } = require('../lib/schedule-utils');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const SESSION_TIME_PATTERN = /(?:^|\s|T)(\d{2}:\d{2})/;
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    riskBefore: { type: 'integer', minimum: 0, maximum: 100 },
    riskAfter: { type: 'integer', minimum: 0, maximum: 100 },
    planSummary: { type: 'string' },
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
        },
        required: ['taskId', 'start', 'end'],
      },
    },
  },
  required: ['riskBefore', 'riskAfter', 'planSummary', 'sessions'],
};

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 422;
  return error;
}

function parseModelJSON(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch {
    throw validationError('AI trả về dữ liệu mô phỏng không đúng định dạng JSON.');
  }
}

function sessionDay(session) {
  if (Number.isInteger(Number(session.day))) return Number(session.day);
  const date = String(session.start).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!date) return null;
  return new Date(`${date[1]}-${date[2]}-${date[3]}T12:00:00Z`).getUTCDay();
}

function validateResult(result, fixedSchedules) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.sessions)) {
    throw validationError('AI trả về phương án mô phỏng không hợp lệ.');
  }
  result.sessions.forEach((session, index) => {
    if (!session || typeof session.taskId !== 'string' || !session.taskId.trim()
      || typeof session.start !== 'string' || typeof session.end !== 'string'
      || !SESSION_TIME_PATTERN.test(session.start) || !SESSION_TIME_PATTERN.test(session.end)) {
      throw validationError(`Phiên AI thứ ${index + 1} thiếu taskId hoặc giờ hợp lệ.`);
    }
    const day = sessionDay(session);
    if (day === null) throw validationError(`Phiên AI thứ ${index + 1} thiếu ngày để kiểm tra lịch cố định.`);
    const start = session.start.match(SESSION_TIME_PATTERN)[1];
    const end = session.end.match(SESSION_TIME_PATTERN)[1];
    if (start >= end) throw validationError(`Phiên AI thứ ${index + 1} có giờ kết thúc không hợp lệ.`);
    const conflict = fixedSchedules.find(fixed => Number(fixed.day) === day && overlaps({
      start,
      end,
    }, fixed));
    if (conflict) {
      const error = validationError(`Phiên "${session.taskId}" trùng lịch cố định "${conflict.title}" (${conflict.start}-${conflict.end}, ngày ${day}).`);
      error.conflict = { session, fixed: conflict };
      throw error;
    }
  });
  return result;
}

function promptFor({ situation, fixedSchedules, openTasks, availability }, correction) {
  return [
    'Bạn là trợ lý lập kế hoạch học tập. Suy luận về nguy cơ trễ và đề xuất các phiên học khả thi.',
    'RÀNG BUỘC BẮT BUỘC: lịch cố định (fixedSchedules) là bất biến tuyệt đối, không được đổi, xóa, dời hoặc rút ngắn.',
    'Chỉ tạo sessions trong ngày/giờ availability, không xếp trùng nhau và không đụng fixedSchedules.',
    'start/end của mỗi session phải là ISO 8601 có ngày và giờ, ví dụ 2026-09-14T18:00.',
    'Nếu situation yêu cầu dời lịch cố định, phải từ chối yêu cầu đó trong planSummary và giữ nguyên lịch cố định.',
    correction || '',
    `Tình huống: ${situation}`,
    `fixedSchedules: ${JSON.stringify(fixedSchedules)}`,
    `openTasks: ${JSON.stringify(openTasks)}`,
    `availability: ${JSON.stringify(availability)}`,
  ].join('\n');
}

async function callGemini(input, correction) {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error('Máy chủ chưa cấu hình GEMINI_API_KEY.');
    error.statusCode = 500;
    throw error;
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: promptFor(input, correction) }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Không thể mô phỏng bằng AI lúc này.');
    error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 502;
    throw error;
  }
  const text = data?.candidates?.[0]?.content?.parts?.find(item => typeof item.text === 'string')?.text;
  return parseModelJSON(text);
}

async function simulate(input) {
  const fixedSchedules = Array.isArray(input.fixedSchedules) ? input.fixedSchedules : [];
  let result = await callGemini(input);
  try {
    return validateResult(result, fixedSchedules);
  } catch (error) {
    if (!error.conflict) throw error;
    result = await callGemini(input, `Lần trước vi phạm: ${error.message} Hãy sửa sessions, tuyệt đối không đụng lịch cố định.`);
    try {
      return validateResult(result, fixedSchedules);
    } catch (secondError) {
      const finalError = validationError(`AI vẫn đề xuất phiên trùng lịch cố định sau hai lần thử: ${secondError.message}`);
      finalError.code = 'FIXED_SCHEDULE_CONFLICT';
      throw finalError;
    }
  }
}

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  try {
    const body = await readBody(req);
    if (typeof body.situation !== 'string' || !body.situation.trim()) {
      return send(res, 422, { error: 'Tình huống mô phỏng không được để trống.' });
    }
    const result = await simulate({
      situation: body.situation.trim(),
      fixedSchedules: Array.isArray(body.fixedSchedules) ? body.fixedSchedules : [],
      openTasks: Array.isArray(body.openTasks) ? body.openTasks : [],
      availability: body.availability && typeof body.availability === 'object' ? body.availability : {},
    });
    return send(res, 200, result);
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('simulation failed', error);
    return send(res, status, { error: error.message || 'Không thể mô phỏng kế hoạch.' });
  }
};

module.exports.validateResult = validateResult;
module.exports.simulate = simulate;
module.exports.RESPONSE_SCHEMA = RESPONSE_SCHEMA;
