const test = require('node:test');
const assert = require('node:assert/strict');
const { generateWeeklyPlan, dateKey, addDays } = require('../lib/schedule-utils');

const base = {
  fixedSchedules: [{ day: 1, start: '18:00', end: '19:00', title: 'Học thêm' }],
  availability: { start: '17:00', end: '20:00', days: [1] },
  examMilestones: [],
  rangeStart: '2026-09-14',
  rangeDays: 1,
};

test('xếp được vài nhiệm vụ trong khoảng rảnh', () => {
  const plan = generateWeeklyPlan({ ...base, openTasks: [{ id: 'a', title: 'Toán', minutes: 45, priority: 5 }, { id: 'b', title: 'Văn', minutes: 45, priority: 3 }] });
  assert.equal(plan.days[0].sessions.length, 2);
  assert.equal(plan.unscheduled.length, 0);
  assert.equal(plan.days[0].sessions[0].end, '2026-09-14T17:45');
});

test('đánh dấu nhiệm vụ quá tải là chưa xếp được', () => {
  const plan = generateWeeklyPlan({ ...base, openTasks: [{ id: 'a', title: 'Toán', minutes: 180, priority: 5 }, { id: 'b', title: 'Văn', minutes: 45, priority: 3 }] });
  assert.equal(plan.days[0].sessions.length, 1);
  assert.equal(plan.unscheduled[0].taskId, 'a');
});

test('ưu tiên nhiệm vụ có hạn hôm nay theo thứ tự đầu vào ưu tiên', () => {
  const plan = generateWeeklyPlan({ ...base, openTasks: [{ id: 'today', title: 'Thi hôm nay', deadline: '2026-09-14', minutes: 45, priority: 5 }, { id: 'later', title: 'Làm sau', deadline: '2026-09-20', minutes: 45, priority: 1 }] });
  assert.equal(plan.days[0].sessions[0].taskId, 'today');
});

test('giữ ngày theo lịch địa phương qua ranh giới tháng', () => {
  const baseDate = new Date('2026-01-31T12:00:00');
  assert.equal(dateKey(addDays(baseDate, 1)), '2026-02-01');
});

test('không tạo session chạm vào lịch cố định', () => {
  const plan = generateWeeklyPlan({
    ...base,
    availability: { start: '18:00', end: '20:00', days: [1] },
    openTasks: [{ id: 'a', title: 'Toán', minutes: 45, priority: 5 }],
  });
  assert.equal(plan.days[0].sessions[0].start, '2026-09-14T19:10');
});
