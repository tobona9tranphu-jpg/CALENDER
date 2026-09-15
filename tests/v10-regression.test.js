'use strict';

const AppDate = require('../src/utils/date');
const { NotificationType, NotificationSeverity, NotificationPriority } = require('../src/notifications/notification-types');
const { NotificationScheduler } = require('../src/notifications/notification-scheduler');
const { NotificationStore } = require('../src/notifications/notification-store');

describe('V1.0 Hardening & Regression Suite', () => {
  describe('1. Date Utility & Vietnam Timezone (Fix B1)', () => {
    test('getCurrentAppTime() returns HH:mm format', () => {
      const timeStr = AppDate.getCurrentAppTime();
      expect(typeof timeStr).toBe('string');
      expect(timeStr).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    });

    test('getCurrentAppTime() formats deterministic UTC instant to Vietnam UTC+7 time', () => {
      // 2026-09-16 03:30:00 UTC -> 10:30:00 UTC+7 in Vietnam
      const fixedInstant = new Date('2026-09-16T03:30:00.000Z');
      const timeStr = AppDate.getCurrentAppTime(fixedInstant);
      expect(timeStr).toBe('10:30');
    });

    test('getCurrentAppTime() handles midnight crossing correctly', () => {
      // 2026-09-15 17:05:00 UTC -> 00:05:00 UTC+7 in Vietnam
      const midnightInstant = new Date('2026-09-15T17:05:00.000Z');
      const timeStr = AppDate.getCurrentAppTime(midnightInstant);
      expect(timeStr).toBe('00:05');
    });
  });

  describe('2. Notification Scheduler Overdue Checking (Fix B10)', () => {
    let store;
    let scheduler;

    beforeEach(() => {
      store = new NotificationStore();
      scheduler = new NotificationScheduler({ store });
    });

    test('detects overdue task using task.deadline', () => {
      const nowInstant = new Date('2026-09-16T03:00:00.000Z'); // 2026-09-16 in VN
      const mockUser = {
        tasks: [
          { id: 't-deadline-overdue', title: 'Luyện đề Toán', deadline: '2026-09-14', status: 'open', minutes: 60 }
        ],
        fixedSchedules: [],
        reviewSchedules: []
      };

      const triggered = scheduler.reconcile(mockUser, nowInstant);
      expect(triggered.length).toBe(1);
      expect(triggered[0].type).toBe(NotificationType.TASK_OVERDUE);
      expect(triggered[0].title).toContain('Luyện đề Toán');
      expect(triggered[0].message).toContain('2 ngày');
    });

    test('detects overdue task using task.scheduledDate when deadline is absent', () => {
      const nowInstant = new Date('2026-09-16T03:00:00.000Z'); // 2026-09-16 in VN
      const mockUser = {
        tasks: [
          { id: 't-sched-overdue', title: 'Học từ vựng Anh', scheduledDate: '2026-09-15', status: 'open', minutes: 30 }
        ],
        fixedSchedules: [],
        reviewSchedules: []
      };

      const triggered = scheduler.reconcile(mockUser, nowInstant);
      expect(triggered.length).toBe(1);
      expect(triggered[0].type).toBe(NotificationType.TASK_OVERDUE);
      expect(triggered[0].message).toContain('1 ngày');
    });

    test('detects task due today using task.deadline', () => {
      const nowInstant = new Date('2026-09-16T03:00:00.000Z'); // 2026-09-16 in VN
      const mockUser = {
        tasks: [
          { id: 't-today', title: 'Đọc văn bài Chiếc Thuyền', deadline: '2026-09-16', status: 'open', minutes: 45 }
        ],
        fixedSchedules: [],
        reviewSchedules: []
      };

      const triggered = scheduler.reconcile(mockUser, nowInstant);
      expect(triggered.length).toBe(1);
      expect(triggered[0].type).toBe(NotificationType.TASK_REMINDER);
      expect(triggered[0].title).toContain('Hôm nay cần làm');
    });

    test('ignores completed tasks from overdue alerts', () => {
      const nowInstant = new Date('2026-09-16T03:00:00.000Z');
      const mockUser = {
        tasks: [
          { id: 't-done', title: 'Bài cũ đã xong', deadline: '2026-09-10', status: 'done', minutes: 45 }
        ],
        fixedSchedules: [],
        reviewSchedules: []
      };

      const triggered = scheduler.reconcile(mockUser, nowInstant);
      expect(triggered.length).toBe(0);
    });
  });

  describe('3. API Server Security & Error Status Codes (Fix B3, B4)', () => {
    test('api/ai returns HTTP 503 when GEMINI_API_KEY is not set', async () => {
      const aiHandler = require('../api/ai');
      const { signUser } = require('../lib/auth');

      process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-jwt-signing-12345';
      const token = signUser('user-test-001');
      const prevKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const req = {
        method: 'POST',
        headers: {
          cookie: `TB-auth-token=${token}`,
          'content-type': 'application/json'
        },
        body: { action: 'generate_plan', input: 'Ngày mai học 2 tiếng' }
      };

      const res = {
        statusCode: 200,
        headers: {},
        writeHead: (status) => { res.statusCode = status; },
        setHeader: (k, v) => { res.headers[k] = v; },
        end: (payload) => { res.body = payload ? JSON.parse(payload) : null; }
      };

      try {
        await aiHandler(req, res);
        expect(res.statusCode).toBe(503);
        expect(res.body.ok).toBe(false);
        expect(res.body.status).toBe('NOT_CONFIGURED');
      } finally {
        if (prevKey) process.env.GEMINI_API_KEY = prevKey;
      }
    });

    test('api/user returns 401 when unauthorized', async () => {
      const userHandler = require('../api/user');
      const req = {
        method: 'GET',
        headers: {}
      };

      const res = {
        statusCode: 200,
        headers: {},
        writeHead: (status) => { res.statusCode = status; },
        setHeader: (k, v) => { res.headers[k] = v; },
        end: (payload) => { res.body = payload ? JSON.parse(payload) : null; }
      };

      await userHandler(req, res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    test('api/user returns 405 for unsupported method', async () => {
      const userHandler = require('../api/user');
      const { signUser } = require('../lib/auth');
      process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-jwt-signing-12345';
      const token = signUser('user-test-001');

      const req = {
        method: 'DELETE',
        headers: { cookie: `TB-auth-token=${token}` }
      };

      const res = {
        statusCode: 200,
        headers: {},
        writeHead: (status) => { res.statusCode = status; },
        setHeader: (k, v) => { res.headers[k] = v; },
        end: (payload) => { res.body = payload ? JSON.parse(payload) : null; }
      };

      await userHandler(req, res);
      expect(res.statusCode).toBe(405);
    });
  });

  describe('4. Calendar Integrity & Deduplication', () => {
    test('store deduplicates notifications so same alert is not fired twice', () => {
      const store = new NotificationStore();
      const notif = {
        id: 'notif-1',
        type: NotificationType.TASK_OVERDUE,
        severity: NotificationSeverity.WARNING,
        priority: NotificationPriority.HIGH,
        title: 'Quá hạn',
        message: 'Làm bài ngay',
        dedupeKey: 'task:task-1:overdue:2026-09-16',
        createdAt: new Date().toISOString(),
        read: false
      };

      const addedFirst = store.add(notif);
      expect(addedFirst).toBeTruthy();
      expect(store.hasFiredKey('task:task-1:overdue:2026-09-16')).toBe(true);

      const addedSecond = store.add(notif);
      expect(addedSecond).toBeNull();
      expect(store.getAll().length).toBe(1);
    });
  });
});
