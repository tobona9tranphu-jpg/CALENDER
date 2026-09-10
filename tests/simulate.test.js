const test = require('node:test');
const assert = require('node:assert/strict');
const { validateResult, simulate } = require('../api/simulate');

const fixedSchedules = [{ id: 'tutoring', title: 'Học thêm', day: 1, start: '18:00', end: '19:30' }];

test('tình huống bình thường chấp nhận phương án không đụng lịch cố định', () => {
  const result = validateResult({
    riskBefore: 42,
    riskAfter: 30,
    planSummary: 'Chia nhiệm vụ thành hai phiên.',
    sessions: [{ taskId: 'task-1', start: '2026-09-14T16:00', end: '2026-09-14T17:00' }],
  }, fixedSchedules);
  assert.equal(result.riskAfter, 30);
});

test('lịch rảnh gần như bằng 0 vẫn chấp nhận phương án không tạo phiên', () => {
  const result = validateResult({
    riskBefore: 80,
    riskAfter: 80,
    planSummary: 'Không đủ thời gian rảnh để xếp thêm phiên.',
    sessions: [],
  }, fixedSchedules);
  assert.deepEqual(result.sessions, []);
});

test('yêu cầu dời lịch cố định bị từ chối nếu Gemini vẫn vi phạm sau lần sửa', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                riskBefore: 50,
                riskAfter: 40,
                planSummary: 'Dời buổi học thêm.',
                sessions: [{ taskId: 'task-1', start: '2026-09-14T18:15', end: '2026-09-14T19:00' }],
              }),
            }],
          },
        }],
      }),
    };
  };
  await assert.rejects(
    simulate({ situation: 'Dời buổi học thêm', fixedSchedules, openTasks: [], availability: {} }),
    error => error.statusCode === 422 && error.code === 'FIXED_SCHEDULE_CONFLICT',
  );
  assert.equal(calls, 2);
  global.fetch = originalFetch;
});
