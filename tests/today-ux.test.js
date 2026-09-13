/**
 * @file today-ux.test.js
 * Comprehensive unit tests for PRODUCT UX PHASE 1:
 * - TodayEngine (Next Event, Daily Progress, Free Time, Next Best Action, Greeting)
 * - QuickCapture (Shorthand parsing, duration, relative date, priority, title cleanup)
 * - InboxService (Inbox identification, scheduling, postponing, moving to inbox)
 */

const { TodayEngine } = require('../src/today/today-engine');
const { QuickCapture } = require('../src/today/quick-capture');
const { InboxService } = require('../src/today/inbox-service');
const { AppDate } = require('../src/utils/date');

describe('PRODUCT UX PHASE 1 — Today Engine & UX Architecture', () => {

  describe('1. TodayEngine: getTimeGreeting', () => {
    test('returns morning greeting for 08:00', () => {
      const d = new Date('2026-03-12T08:00:00+07:00');
      const greeting = TodayEngine.getTimeGreeting(d, 'Minh Anh');
      expect(greeting).toContain('Chào buổi sáng');
      expect(greeting).toContain('Minh Anh');
    });

    test('returns afternoon greeting for 14:00', () => {
      const d = new Date('2026-03-12T14:30:00+07:00');
      const greeting = TodayEngine.getTimeGreeting(d, 'Minh Anh');
      expect(greeting).toContain('Chào buổi chiều');
    });

    test('returns evening greeting for 19:00', () => {
      const d = new Date('2026-03-12T19:00:00+07:00');
      const greeting = TodayEngine.getTimeGreeting(d, 'Minh Anh');
      expect(greeting).toContain('Chào buổi tối');
    });

    test('returns night greeting for 23:00', () => {
      const d = new Date('2026-03-12T23:00:00+07:00');
      const greeting = TodayEngine.getTimeGreeting(d, 'Minh Anh');
      expect(greeting).toContain('Chào đêm muộn');
    });
  });

  describe('2. TodayEngine: calculateNextEvent', () => {
    const fixed = [
      { id: 'f1', title: 'Học trên trường', start: '07:00', end: '11:30' },
      { id: 'f2', title: 'Học thêm Toán', start: '17:30', end: '19:00' }
    ];
    const tasks = [
      { id: 't1', title: 'Ôn tập Tích phân', start: '14:00', end: '14:45' }
    ];

    test('detects active ongoing event', () => {
      // 10:00 -> within 07:00 - 11:30
      const now = new Date('2026-03-12T10:00:00+07:00');
      const next = TodayEngine.calculateNextEvent(now, fixed, tasks);
      expect(next).not.toBeNull();
      expect(next.title).toBe('Học trên trường');
      expect(next.status).toBe('active');
      expect(next.minutesRemaining).toBe(90); // 11:30 - 10:00 = 90 mins
    });

    test('detects upcoming event when currently free', () => {
      // 13:00 -> next is task at 14:00
      const now = new Date('2026-03-12T13:00:00+07:00');
      const next = TodayEngine.calculateNextEvent(now, fixed, tasks);
      expect(next).not.toBeNull();
      expect(next.title).toBe('Ôn tập Tích phân');
      expect(next.status).toBe('upcoming');
      expect(next.minutesUntil).toBe(60); // 14:00 - 13:00 = 60 mins
    });

    test('returns null (clear state) when all events have passed', () => {
      // 20:00 -> past 19:00
      const now = new Date('2026-03-12T20:00:00+07:00');
      const next = TodayEngine.calculateNextEvent(now, fixed, tasks);
      expect(next).toBeNull();
    });
  });

  describe('3. TodayEngine: calculateDailyProgress', () => {
    test('handles empty task list gracefully (0%)', () => {
      const res = TodayEngine.calculateDailyProgress([], []);
      expect(res.percent).toBe(0);
      expect(res.totalCount).toBe(0);
      expect(res.completedCount).toBe(0);
    });

    test('calculates accurate percentage for partial completion', () => {
      const todayTasks = [
        { id: '1', title: 'Task 1' },
        { id: '2', title: 'Task 2' },
        { id: '3', title: 'Task 3' },
        { id: '4', title: 'Task 4' }
      ];
      const doneTasks = [
        { id: '1', title: 'Task 1' },
        { id: '2', title: 'Task 2' },
        { id: '3', title: 'Task 3' }
      ];
      const res = TodayEngine.calculateDailyProgress(todayTasks, doneTasks);
      expect(res.percent).toBe(75);
      expect(res.totalCount).toBe(4);
      expect(res.completedCount).toBe(3);
    });

    test('caps at 100% when all tasks are complete', () => {
      const tasks = [{ id: '1' }, { id: '2' }];
      const res = TodayEngine.calculateDailyProgress(tasks, tasks);
      expect(res.percent).toBe(100);
    });
  });

  describe('4. TodayEngine: calculateFreeTime', () => {
    const availability = { start: '14:00', end: '20:00' }; // 6 hours = 360 mins

    test('calculates full capacity when no events exist and now is before start', () => {
      const now = new Date('2026-03-12T12:00:00+07:00');
      const free = TodayEngine.calculateFreeTime(availability, [], [], now);
      expect(free).toBe(360);
    });

    test('subtracts merged busy intervals from free time', () => {
      const now = new Date('2026-03-12T12:00:00+07:00');
      const fixed = [{ start: '15:00', end: '16:30' }]; // 90 mins
      const tasks = [{ start: '16:00', end: '17:00' }]; // overlaps 30m with fixed: union 15:00 - 17:00 = 120 mins
      const free = TodayEngine.calculateFreeTime(availability, fixed, tasks, now);
      expect(free).toBe(240); // 360 - 120 = 240 mins
    });

    test('returns 0 if current time has passed availability end', () => {
      const now = new Date('2026-03-12T21:00:00+07:00');
      const free = TodayEngine.calculateFreeTime(availability, [], [], now);
      expect(free).toBe(0);
    });
  });

  describe('5. TodayEngine: recommendNextAction', () => {
    test('returns highest priority task that fits in free time', () => {
      const tasks = [
        { id: 't1', title: 'Bài tập lớn', minutes: 120, priority: 5 },
        { id: 't2', title: 'Luyện 20 câu trắc nghiệm', minutes: 45, priority: 4 },
        { id: 't3', title: 'Đọc tài liệu', minutes: 30, priority: 2 }
      ];
      // If free time is only 60 mins, t1 (120m) does not fit, so t2 (45m) is recommended
      const rec = TodayEngine.recommendNextAction(tasks, 60, []);
      expect(rec.recommended).not.toBeNull();
      expect(rec.recommended.id).toBe('t2');
      expect(rec.rationale).toContain('Phù hợp thời gian rảnh');
    });

    test('recommends top priority task if plenty of free time', () => {
      const tasks = [
        { id: 't1', title: 'Bài tập lớn', minutes: 60, priority: 5 },
        { id: 't2', title: 'Luyện đề', minutes: 45, priority: 4 }
      ];
      const rec = TodayEngine.recommendNextAction(tasks, 180, []);
      expect(rec.recommended.id).toBe('t1');
      expect(rec.rationale).toContain('Ưu tiên cao nhất');
    });

    test('returns null if task list is empty', () => {
      const rec = TodayEngine.recommendNextAction([], 120, []);
      expect(rec.recommended).toBeNull();
    });
  });

  describe('6. QuickCapture: parseCaptureInput', () => {
    const baseDate = '2026-03-12'; // Thursday

    test('parses full shorthand: title, duration, relative date, priority', () => {
      const text = 'Làm đề Hóa 45p ngày mai !';
      const parsed = QuickCapture.parseCaptureInput(text, baseDate);
      expect(parsed.cleanTitle).toBe('Làm đề Hóa');
      expect(parsed.durationMinutes).toBe(45);
      expect(parsed.targetDate).toBe('2026-03-13'); // tomorrow
      expect(parsed.priority).toBe(4);
      expect(parsed.destination).toBe('Tomorrow');
    });

    test('parses hour duration: 1h, 2 tiếng', () => {
      const p1 = QuickCapture.parseCaptureInput('Ôn thi đại học 1h hôm nay', baseDate);
      expect(p1.cleanTitle).toBe('Ôn thi đại học');
      expect(p1.durationMinutes).toBe(60);
      expect(p1.targetDate).toBe('2026-03-12');
      expect(p1.destination).toBe('Today');

      const p2 = QuickCapture.parseCaptureInput('Viết luận 2 tiếng', baseDate);
      expect(p2.cleanTitle).toBe('Viết luận');
      expect(p2.durationMinutes).toBe(120);
      expect(p2.destination).toBe('Inbox');
    });

    test('routes to Inbox by default when no date is specified', () => {
      const text = 'Mua sách tham khảo Toán 12';
      const parsed = QuickCapture.parseCaptureInput(text, baseDate);
      expect(parsed.cleanTitle).toBe('Mua sách tham khảo Toán 12');
      expect(parsed.targetDate).toBeNull();
      expect(parsed.destination).toBe('Inbox');
      expect(parsed.priority).toBe(3);
    });

    test('parses urgent keyword "gấp"', () => {
      const text = 'Nộp học phí gấp';
      const parsed = QuickCapture.parseCaptureInput(text, baseDate);
      expect(parsed.cleanTitle).toBe('Nộp học phí');
      expect(parsed.priority).toBe(4);
    });

    test('parses weekday shorthand (e.g. t6 -> Friday)', () => {
      // 2026-03-12 is Thursday (t5). Next t6 is 2026-03-13.
      const text = 'Học nhóm t6';
      const parsed = QuickCapture.parseCaptureInput(text, baseDate);
      expect(parsed.cleanTitle).toBe('Học nhóm');
      expect(parsed.targetDate).toBe('2026-03-13');
      expect(parsed.destination).toBe('Tomorrow');
    });
  });

  describe('7. InboxService: item management', () => {
    test('identifies inbox items correctly', () => {
      const inbox1 = { id: '1', title: 'Unscheduled item' };
      const inbox2 = { id: '2', title: 'Explicit inbox', isInbox: true };
      const scheduled = { id: '3', title: 'Scheduled task', scheduledDate: '2026-03-12', isInbox: false };
      const withDeadline = { id: '4', title: 'Has deadline', deadline: '2026-03-15', isInbox: false };

      expect(InboxService.isInboxItem(inbox1)).toBe(true);
      expect(InboxService.isInboxItem(inbox2)).toBe(true);
      expect(InboxService.isInboxItem(scheduled)).toBe(false);
      expect(InboxService.isInboxItem(withDeadline)).toBe(false);
    });

    test('schedules an item onto a specific date', () => {
      const item = { id: '1', title: 'Read book', isInbox: true };
      const updated = InboxService.scheduleItem(item, '2026-03-13');
      expect(updated.scheduledDate).toBe('2026-03-13');
      expect(updated.deadline).toBe('2026-03-13');
      expect(updated.isInbox).toBe(false);
    });

    test('postpones an item by specified days', () => {
      const item = { id: '1', title: 'Do homework', scheduledDate: '2026-03-12' };
      const updated = InboxService.postponeItem(item, 1, '2026-03-12');
      expect(updated.scheduledDate).toBe('2026-03-13');
      expect(updated.isInbox).toBe(false);
    });

    test('moves an item back to inbox', () => {
      const item = { id: '1', title: 'Task', scheduledDate: '2026-03-12', deadline: '2026-03-12', isInbox: false };
      const updated = InboxService.moveToInbox(item);
      expect(updated.isInbox).toBe(true);
      expect(updated.scheduledDate).toBeNull();
      expect(updated.deadline).toBeNull();
    });
  });
});
