const { send, readBody, preflight } = require('../lib/http');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
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
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (!fenced) throw validationError('AI trả về dữ liệu không đúng định dạng JSON.');
    try {
      return JSON.parse(fenced[1]);
    } catch {
      throw validationError('AI trả về dữ liệu không đúng định dạng JSON.');
    }
  }
}

function validateSlots(value) {
  if (!Array.isArray(value)) throw validationError('Thời khóa biểu phải là một mảng JSON.');
  const slots = value.map((slot, index) => {
    if (!slot || typeof slot !== 'object') throw validationError(`Ca học thứ ${index + 1} không hợp lệ.`);
    const day = Number(slot.day);
    const title = typeof slot.title === 'string' ? slot.title.trim() : '';
    const start = typeof slot.start === 'string' ? slot.start : '';
    const end = typeof slot.end === 'string' ? slot.end : '';
    if (!Number.isInteger(day) || day < 1 || day > 7) throw validationError(`Ca học thứ ${index + 1} có ngày không hợp lệ (phải từ 1 đến 7).`);
    if (!title) throw validationError(`Ca học thứ ${index + 1} chưa có tên môn.`);
    if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) throw validationError(`Ca học "${title}" có giờ không hợp lệ (cần dạng HH:MM).`);
    if (start >= end) throw validationError(`Ca học "${title}" có giờ bắt đầu phải trước giờ kết thúc.`);
    return { day, title, start, end };
  });

  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  for (let index = 0; index < slots.length; index += 1) {
    for (let other = index + 1; other < slots.length; other += 1) {
      if (slots[index].day !== slots[other].day) continue;
      const overlaps = minutes(slots[index].start) < minutes(slots[other].end)
        && minutes(slots[other].start) < minutes(slots[index].end);
      if (overlaps) throw validationError(`Hai ca học trong ngày ${slots[index].day} bị chồng giờ: "${slots[index].title}" và "${slots[other].title}".`);
    }
  }
  return slots;
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
          { text: 'Đọc ảnh thời khóa biểu này. Trả về duy nhất một JSON array gồm các ca học nhìn thấy, theo đúng schema: [{"day":1,"title":"Toán","start":"07:15","end":"08:00"}]. day là thứ trong tuần từ 1 (Thứ 2) đến 7 (Chủ nhật). Bỏ qua ô trống, ngày nghỉ và thông tin không phải ca học. Giữ nguyên tên môn/hoạt động nhìn thấy trong ảnh. Nếu không đọc chắc được một ca, không tự đoán ca đó.' },
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
