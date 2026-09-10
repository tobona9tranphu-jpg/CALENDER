const { send, readBody, preflight } = require('../lib/http');
const { getUserId } = require('../lib/auth');
const { query } = require('../lib/db');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const DAILY_LIMIT = 30;
const MAX_MESSAGE_LENGTH = 4000;

const functionDeclarations = [
  {
    name: 'get_tasks_due_today',
    description: 'Lấy các nhiệm vụ đang mở có hạn vào hôm nay của người dùng.',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  {
    name: 'get_topic_mastery',
    description: 'Lấy mức độ nắm vững của chủ đề có tên gần đúng với topicName.',
    parameters: {
      type: 'OBJECT',
      properties: { topicName: { type: 'STRING', description: 'Tên chủ đề cần tra cứu.' } },
      required: ['topicName'],
    },
  },
  {
    name: 'get_upcoming_exams',
    description: 'Lấy các kỳ thi sắp tới và số ngày còn lại của người dùng.',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  {
    name: 'get_recent_sessions',
    description: 'Lấy các phiên học gần đây nhất của người dùng.',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
];

const tools = [{ functionDeclarations }];

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 422;
  return error;
}

async function executeTool(name, args, userId) {
  switch (name) {
    case 'get_tasks_due_today': {
      const result = await query(`
        SELECT t.id, t.title, t.minutes, t.priority, t.status,
               to_char(t.deadline, 'YYYY-MM-DD') AS deadline,
               s.name AS subject, tp.name AS topic
        FROM tasks t
        LEFT JOIN subjects s ON s.id = t.subject_id AND s.user_id = t.user_id
        LEFT JOIN topics tp ON tp.id = t.topic_id
        WHERE t.user_id = $1 AND t.status <> 'done' AND t.deadline = CURRENT_DATE
        ORDER BY t.priority DESC, t.created_at ASC
      `, [userId]);
      return result.rows;
    }
    case 'get_topic_mastery': {
      const topicName = typeof args?.topicName === 'string' ? args.topicName.trim() : '';
      if (!topicName) throw validationError('Tên chủ đề không hợp lệ.');
      const result = await query(`
        SELECT t.name AS topic, s.name AS subject, t.mastery
        FROM topics t
        JOIN subjects s ON s.id = t.subject_id AND s.user_id = $1
        WHERE t.name ILIKE $2
        ORDER BY CASE WHEN lower(t.name) = lower($3) THEN 0 ELSE 1 END, t.name
        LIMIT 5
      `, [userId, `%${topicName}%`, topicName]);
      return result.rows;
    }
    case 'get_upcoming_exams': {
      const result = await query(`
        SELECT id, title, to_char(exam_date, 'YYYY-MM-DD') AS exam_date,
               subjects, (exam_date - CURRENT_DATE)::int AS days_remaining
        FROM exam_milestones
        WHERE user_id = $1 AND exam_date >= CURRENT_DATE
        ORDER BY exam_date ASC
        LIMIT 10
      `, [userId]);
      return result.rows;
    }
    case 'get_recent_sessions': {
      const result = await query(`
        SELECT ss.id, to_char(ss.study_date, 'YYYY-MM-DD') AS study_date,
               ss.minutes, ss.understanding, ss.status,
               t.name AS topic, s.name AS subject
        FROM study_sessions ss
        LEFT JOIN topics t ON t.id = ss.topic_id
        LEFT JOIN subjects s ON s.id = t.subject_id AND s.user_id = ss.user_id
        WHERE ss.user_id = $1
        ORDER BY ss.study_date DESC, ss.id DESC
        LIMIT 10
      `, [userId]);
      return result.rows;
    }
    default:
      throw validationError(`Không cho phép gọi hàm ${name}.`);
  }
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-20).filter(item => item && ['user', 'model'].includes(item.role)
    && typeof item.content === 'string' && item.content.trim())
    .map(item => ({ role: item.role, parts: [{ text: item.content.slice(0, MAX_MESSAGE_LENGTH) }] }));
}

function extractText(response) {
  return response?.candidates?.[0]?.content?.parts
    ?.filter(part => typeof part.text === 'string')
    .map(part => part.text)
    .join('')
    .trim() || '';
}

function extractFunctionCalls(response) {
  return response?.candidates?.[0]?.content?.parts
    ?.filter(part => part.functionCall && typeof part.functionCall.name === 'string')
    || [];
}

async function callGemini(contents) {
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
      systemInstruction: {
        parts: [{
          text: 'Bạn là Study Coach tiếng Việt. Chỉ dùng dữ liệu trả về từ các hàm để trả lời; nếu chưa có dữ liệu thì nói rõ, không bịa. Trả lời ngắn gọn, hữu ích. Không bao giờ nói rằng bạn đã thay đổi dữ liệu người dùng.',
        }],
      },
      contents,
      tools,
      generationConfig: { temperature: 0.2 },
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Không thể kết nối Study Coach lúc này.');
    error.statusCode = 502;
    throw error;
  }
  return data;
}

async function answerWithTools(message, history, userId) {
  const contents = [...normalizeHistory(history), { role: 'user', parts: [{ text: message }] }];
  for (let turn = 0; turn < 4; turn += 1) {
    const response = await callGemini(contents);
    const calls = extractFunctionCalls(response);
    if (!calls.length) {
      const text = extractText(response);
      if (!text) throw new Error('Study Coach không trả về câu trả lời.');
      return text;
    }
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);
    for (const call of calls) {
      const result = await executeTool(call.functionCall.name, call.functionCall.args || {}, userId);
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: call.functionCall.name, response: { result } } }],
      });
    }
  }
  throw new Error('Study Coach không hoàn tất được câu trả lời.');
}

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  const userId = getUserId(req);
  if (!userId) return send(res, 401, { error: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.' });
  try {
    const body = await readBody(req);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return send(res, 422, { error: 'Tin nhắn không được để trống.' });
    if (message.length > MAX_MESSAGE_LENGTH) return send(res, 422, { error: 'Tin nhắn quá dài.' });
    const owner = await query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!owner.rows[0]) return send(res, 401, { error: 'Tài khoản không còn tồn tại.' });
    const count = await query(`
      SELECT COUNT(*)::int AS count FROM chat_messages
      WHERE user_id = $1 AND role = 'user' AND created_at >= CURRENT_DATE
    `, [userId]);
    if (count.rows[0].count >= DAILY_LIMIT) {
      return send(res, 429, { error: 'Bạn đã dùng hết 30 tin nhắn Study Coach hôm nay. Hãy thử lại vào ngày mai.' });
    }
    const reply = await answerWithTools(message, body.history, userId);
    await query('INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)', [userId, 'user', message]);
    await query('INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)', [userId, 'model', reply]);
    return send(res, 200, { reply });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('chat route failed', error);
    return send(res, status, { error: error.message || 'Không thể trả lời lúc này.' });
  }
};

module.exports.executeTool = executeTool;
module.exports.answerWithTools = answerWithTools;
module.exports.functionDeclarations = functionDeclarations;
