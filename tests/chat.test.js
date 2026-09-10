const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../lib/db');
process.env.GEMINI_API_KEY = 'test-key';
const originalQuery = db.query;
let requestedUserIds = [];
db.query = async (text, params) => {
  requestedUserIds.push(params?.[0]);
  if (text.includes('FROM tasks')) return { rows: [{ id: 'task-1', title: 'Ôn Toán', minutes: 45 }] };
  if (text.includes('FROM exam_milestones')) return { rows: [{ title: 'Thi Toán', days_remaining: 12 }] };
  return { rows: [] };
};
delete require.cache[require.resolve('../api/chat')];
const { answerWithTools, functionDeclarations } = require('../api/chat');

test.after(() => {
  db.query = originalQuery;
});

test('Study Coach tra nhiệm vụ hôm nay bằng userId xác thực', async () => {
  requestedUserIds = [];
  let call = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    call += 1;
    const body = call === 1
      ? { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_tasks_due_today', args: {} } }] } }] }
      : { candidates: [{ content: { role: 'model', parts: [{ text: 'Hôm nay bạn cần ôn Toán 45 phút.' }] } }] };
    return { ok: true, json: async () => body };
  };
  const reply = await answerWithTools('Hôm nay tôi cần học gì?', [], 'jwt-user-1');
  assert.match(reply, /ôn Toán/);
  assert.equal(requestedUserIds[0], 'jwt-user-1');
  global.fetch = originalFetch;
});

test('Study Coach trả số ngày đến kỳ thi từ dữ liệu thật', async () => {
  let call = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    call += 1;
    const body = call === 1
      ? { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_upcoming_exams', args: {} } }] } }] }
      : { candidates: [{ content: { role: 'model', parts: [{ text: 'Còn 12 ngày nữa thi Toán.' }] } }] };
    return { ok: true, json: async () => body };
  };
  const reply = await answerWithTools('Còn bao nhiêu ngày nữa thi Toán?', [], 'jwt-user-2');
  assert.match(reply, /12 ngày/);
  assert.equal(requestedUserIds.at(-1), 'jwt-user-2');
  global.fetch = originalFetch;
});

test('Khai báo đủ bốn function tools', () => {
  assert.deepEqual(functionDeclarations.map(item => item.name), [
    'get_tasks_due_today',
    'get_topic_mastery',
    'get_upcoming_exams',
    'get_recent_sessions',
  ]);
});
