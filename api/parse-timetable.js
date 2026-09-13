const { send, readBody, preflight } = require('../lib/http');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 422;
  return error;
}

function parseModelJSON(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw validationError('AI không trả về dữ liệu thời khóa biểu.');
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.slots)) return parsed.slots;
      if (Array.isArray(parsed.timetable)) return parsed.timetable;
    }
    return parsed;
  } catch {}

  // 1. Try markdown fenced block anywhere in text
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.slots)) return parsed.slots;
        if (Array.isArray(parsed.timetable)) return parsed.timetable;
      }
      return parsed;
    } catch {}
  }

  // 2. Try finding outermost array [ ... ]
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
    } catch {}
  }

  // 3. Try finding outermost object { ... }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const obj = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      if (Array.isArray(obj.slots)) return obj.slots;
      if (Array.isArray(obj.timetable)) return obj.timetable;
      return obj;
    } catch {}
  }

  throw validationError('AI trả về dữ liệu không đúng định dạng JSON.');
}

function validateSlots(value) {
  if (!Array.isArray(value)) throw validationError('Thời khóa biểu phải là một mảng JSON.');
  
  const rawSlots = [];
  for (let index = 0; index < value.length; index += 1) {
    const slot = value[index];
    if (!slot || typeof slot !== 'object') continue;
    let day = Number(slot.day);
    const title = typeof slot.title === 'string' ? slot.title.trim() : '';
    let start = typeof slot.start === 'string' ? slot.start.trim() : '';
    let end = typeof slot.end === 'string' ? slot.end.trim() : '';

    // Normalize single-digit hour (e.g. "7:15" -> "07:15")
    if (/^\d:[0-5]\d$/.test(start)) start = '0' + start;
    if (/^\d:[0-5]\d$/.test(end)) end = '0' + end;

    // Day: 0..7 where 7 is Sunday. Normalize 7 -> 0 for consistency with calendar app
    if (day === 7) day = 0;
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    if (!title) continue;
    if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) continue;
    if (start >= end) continue;

    rawSlots.push({ day, title, start, end });
  }

  if (!rawSlots.length && value.length > 0) {
    throw validationError('Không tìm thấy ca học có ngày và giờ hợp lệ từ ảnh.');
  }

  // Sort slots by day then start time
  const minutes = val => Number(val.slice(0, 2)) * 60 + Number(val.slice(3));
  const timeFromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  rawSlots.sort((a, b) => a.day !== b.day ? a.day - b.day : minutes(a.start) - minutes(b.start));

  // Resolve overlaps gracefully instead of rejecting the entire timetable
  const cleaned = [];
  for (const slot of rawSlots) {
    const prev = cleaned[cleaned.length - 1];
    if (prev && prev.day === slot.day) {
      const prevEnd = minutes(prev.end);
      const slotStart = minutes(slot.start);
      const slotEnd = minutes(slot.end);

      if (slotStart <= prevEnd) {
        if (prev.title.toLowerCase() === slot.title.toLowerCase()) {
          // Same subject consecutive periods -> merge into one block
          prev.end = timeFromMin(Math.max(prevEnd, slotEnd));
          continue;
        } else if (slotStart < prevEnd) {
          if (slotEnd - prevEnd >= 20) {
            // Different subjects overlap: adjust start of second slot
            slot.start = prev.end;
          } else if (prevEnd - slotStart <= 10) {
            // Minor overlap: adjust end of first slot
            prev.end = slot.start;
          }
        }
      }
    }
    cleaned.push(slot);
  }

  return cleaned;
}

async function callGemini(image, mimeType) {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error('Máy chủ chưa cấu hình GEMINI_API_KEY.');
    error.statusCode = 500;
    throw error;
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: 'Bạn là bộ trích xuất thời khóa biểu. Chỉ trả về JSON hợp lệ, không markdown, không giải thích.' }] },
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: image } },
          { text: 'Đọc ảnh thời khóa biểu này. Trả về duy nhất một JSON array gồm các ca học nhìn thấy, theo đúng schema: [{"day":1,"title":"Toán","start":"07:15","end":"08:00"}]. day là thứ trong tuần từ 1 (Thứ 2) đến 6 (Thứ 7), và 0 hoặc 7 (Chủ nhật). Bỏ qua ô trống, ngày nghỉ và thông tin không phải ca học. Giữ nguyên tên môn/hoạt động nhìn thấy trong ảnh. Nếu không đọc chắc được một ca, không tự đoán ca đó.' },
        ],
      }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Không thể đọc ảnh bằng AI lúc này.');
    error.statusCode = response.status === 422 ? 422 : 502;
    throw error;
  }
  const text = data?.candidates?.[0]?.content?.parts?.find(item => typeof item.text === 'string')?.text;
  return parseModelJSON(text);
}

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  try {
    const body = await readBody(req);
    const image = typeof body.image === 'string' ? body.image.replace(/^data:[^;]+;base64,/, '') : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : '';
    if (!image || !/^image\/(png|jpeg|jpg|webp)$/.test(mimeType)) {
      return send(res, 422, { error: 'Ảnh không hợp lệ. Vui lòng chọn PNG, JPG hoặc WebP.' });
    }
    const slots = validateSlots(await callGemini(image, mimeType === 'image/jpg' ? 'image/jpeg' : mimeType));
    return send(res, 200, { slots });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('parse timetable failed', error);
    return send(res, status, { error: error.message || 'Không thể đọc thời khóa biểu từ ảnh.' });
  }
};

module.exports.validateSlots = validateSlots;
module.exports.parseModelJSON = parseModelJSON;
