const { send, readBody, preflight } = require('../lib/http');
const { generateWeeklyPlan, overlaps, minutes } = require('../lib/schedule-utils');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
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
        required: ['date', 'sessions'],
      },
    },
    unscheduled: {
      type: 'array',
      items: {
        type: 'object',
        properties: { taskId: { type: 'string' }, reason: { type: 'string' } },
        required: ['taskId', 'reason'],
      },
    },
  },
  required: ['days', 'unscheduled'],
};

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 422;
  return error;
}

function formatTime(value) {
  const match = String(value || '').match(/(?:T|\s)(\d{2}:\d{2})/);
  return match ? match[1] : null;
}

function validatePlan(plan, input) {
  const fixed = Array.isArray(input.fixedSchedules) ? input.fixedSchedules : [];
  const availability = input.availability || {};
  const availableDays = new Set((availability.days || []).map(Number));
  const start = minutes(availability.start);
  const end = minutes(availability.end);
  const tasks = new Map((input.openTasks || []).map(task => [String(task.id), task]));
  const accepted = [];
  const unscheduled = new Map((plan.unscheduled || []).map(item => [String(item.taskId), item.reason]));
  for (const day of plan.days || []) {
    const weekday = new Date(`${day.date}T12:00:00`).getDay();
    const daySessions = [];
    for (const session of day.sessions || []) {
      const task = tasks.get(String(session.taskId));
      const startTime = formatTime(session.start);
      const endTime = formatTime(session.end);
      if (!task || !startTime || !endTime || minutes(startTime) >= minutes(endTime)
        || !availableDays.has(weekday) || minutes(startTime) < start || minutes(endTime) > end
        || fixed.some(slot => Number(slot.day) === weekday && overlaps({ start: startTime, end: endTime }, slot))
        || daySessions.some(slot => overlaps({ start: startTime, end: endTime }, slot))) {
        unscheduled.set(String(session.taskId), 'Phiên AI vi phạm khung giờ rảnh hoặc bị trùng lịch.');
        continue;
      }
      daySessions.push({ start: startTime, end: endTime });
      accepted.push({ ...task, date: day.date, start: session.start, end: session.end, minutes: Number(task.minutes) || 45 });
    }
  }
  const acceptedIds = new Set(accepted.map(item => String(item.id)));
  for (const task of input.openTasks || []) {
    if (!acceptedIds.has(String(task.id)) && !unscheduled.has(String(task.id))) unscheduled.set(String(task.id), 'AI không tìm được khoảng trống phù hợp.');
  }
  const days = (plan.days || []).map(day => ({
    date: day.date,
    sessions: accepted.filter(session => session.date === day.date),
  }));
  return { days, unscheduled: [...unscheduled.entries()].map(([taskId, reason]) => ({ taskId, reason })) };
}

async function callGemini(input, provisional) {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error('Máy chủ chưa cấu hình GEMINI_API_KEY.');
    error.statusCode = 503;
    throw error;
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: 'Bạn là bộ lập lịch học. Lịch cố định không được thay đổi. Chỉ xếp task trong availability, ưu tiên deadline và examMilestones. Nếu không đủ chỗ, ghi taskId vào unscheduled với lý do tiếng Việt.' }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Không thể tạo lịch AI.');
    error.statusCode = 502;
    throw error;
  }
  const text = data?.candidates?.[0]?.content?.parts?.find(part => typeof part.text === 'string')?.text;
  if (!text) throw validationError('AI không trả về lịch hợp lệ.');
  return JSON.parse(text);
}

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  try {
    const input = await readBody(req);
    const provisional = generateWeeklyPlan(input || {});
    let plan;
    try {
      plan = await callGemini(input || {}, provisional);
    } catch (error) {
      if (error.statusCode >= 500) return send(res, error.statusCode, { error: error.message });
      plan = { ...provisional, ai: false };
    }
    return send(res, 200, validatePlan(plan, input || {}));
  } catch (error) {
    return send(res, error.statusCode || 500, { error: error.message || 'Không thể tạo lịch.' });
  }
};

module.exports.validatePlan = validatePlan;
module.exports.RESPONSE_SCHEMA = RESPONSE_SCHEMA;
