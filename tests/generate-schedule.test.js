const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlan, RESPONSE_SCHEMA } = require('../api/generate-schedule');

const input = {
  openTasks: [{ id: 'task-1', title: 'Toán', minutes: 45, status: 'open' }],
  fixedSchedules: [{ day: 1, title: 'Học thêm', start: '18:00', end: '19:00' }],
  availability: { days: [1], start: '17:00', end: '20:00' },
};

test('API loại session AI trùng lịch cố định và báo lý do', () => {
  const result = validatePlan({
    days: [{ date: '2026-09-14', sessions: [{ taskId: 'task-1', start: '2026-09-14T18:15', end: '2026-09-14T19:00' }] }],
    unscheduled: [],
  }, input);
  assert.equal(result.days[0].sessions.length, 0);
  assert.match(result.unscheduled[0].reason, /trùng lịch/);
});

test('schema yêu cầu days và unscheduled', () => {
  assert.deepEqual(RESPONSE_SCHEMA.required, ['days', 'unscheduled']);
});
