'use strict';

/**
 * P0.4 Notification Engine Comprehensive Test Suite
 *
 * Tests:
 * 1. Notification model creation & validation
 * 2. NotificationStore persistence, read/unread, and firedKeys deduplication tracking
 * 3. NotificationPolicy dedupeKey deterministic generation & Quiet Hours logic
 * 4. NotificationScheduler reminder trigger calculation with AppDate (UTC+7)
 * 5. Rescheduling on event move & cancellation on deletion/completion
 * 6. NotificationService end-to-end integration & quiet hours priority suppression
 */

const { NotificationType, NotificationPriority, NotificationSeverity, createNotification } = require('../src/notifications/notification-types');
const { NotificationStore } = require('../src/notifications/notification-store');
const { generateDedupeKey, isQuietHours, evaluateDeliveryPolicy } = require('../src/notifications/notification-policy');
const { NotificationScheduler } = require('../src/notifications/notification-scheduler');
const { NotificationService } = require('../src/notifications/notification-service');
const AppDate = require('../src/utils/date');

// In-memory mock storage
function createMockStorage() {
  const store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };
}

describe('P0.4 Notification Engine', () => {

  describe('Notification Types & Factory', () => {
    test('creates standardized notification with defaults', () => {
      const notif = createNotification({
        title: 'Nhắc học',
        message: 'Chuẩn bị bắt đầu phiên Toán'
      });

      expect(notif.id).toMatch(/^notif-/);
      expect(notif.title).toBe('Nhắc học');
      expect(notif.message).toBe('Chuẩn bị bắt đầu phiên Toán');
      expect(notif.type).toBe(NotificationType.SYSTEM_FEEDBACK);
      expect(notif.severity).toBe(NotificationSeverity.INFO);
      expect(notif.priority).toBe(NotificationPriority.MEDIUM);
      expect(notif.read).toBe(false);
      expect(notif.dismissed).toBe(false);
    });

    test('throws error if title or message is missing', () => {
      expect(() => createNotification({ title: 'Only title' })).toThrow();
      expect(() => createNotification({ message: 'Only msg' })).toThrow();
    });
  });

  describe('NotificationStore', () => {
    let mockStorage;
    let store;

    beforeEach(() => {
      mockStorage = createMockStorage();
      store = new NotificationStore({ storage: mockStorage });
    });

    test('adds notification and tracks unread count', () => {
      const notif1 = createNotification({ title: 'T1', message: 'M1' });
      const notif2 = createNotification({ title: 'T2', message: 'M2' });

      store.add(notif1);
      store.add(notif2);

      expect(store.getAll().length).toBe(2);
      expect(store.getUnreadCount()).toBe(2);

      store.markAsRead(notif1.id);
      expect(store.getUnreadCount()).toBe(1);

      store.markAllAsRead();
      expect(store.getUnreadCount()).toBe(0);
    });

    test('deduplicates based on dedupeKey', () => {
      const key = 'event:ev-01:reminder:2026-09-13T08:00';
      const notif1 = createNotification({ title: 'T1', message: 'M1', dedupeKey: key });
      const notif2 = createNotification({ title: 'T1 duplicate', message: 'M1 dup', dedupeKey: key });

      const res1 = store.add(notif1);
      const res2 = store.add(notif2);

      expect(res1).not.toBeNull();
      expect(res2).toBeNull();
      expect(store.getAll().length).toBe(1);
    });

    test('clears fired keys by prefix when item is rescheduled', () => {
      store.recordFiredKey('event:ev-school:reminder:2026-09-13T07:00');
      expect(store.hasFiredKey('event:ev-school:reminder:2026-09-13T07:00')).toBe(true);

      store.clearFiredKeysPrefix('event:ev-school:');
      expect(store.hasFiredKey('event:ev-school:reminder:2026-09-13T07:00')).toBe(false);
    });

    test('persists to storage across instances', () => {
      const notif = createNotification({ title: 'Persist Test', message: 'Msg' });
      store.add(notif);

      const store2 = new NotificationStore({ storage: mockStorage });
      expect(store2.getAll().length).toBe(1);
      expect(store2.getAll()[0].title).toBe('Persist Test');
    });
  });

  describe('NotificationPolicy & Quiet Hours', () => {
    test('generates deterministic dedupeKey scheme', () => {
      const key = generateDedupeKey({
        sourceType: 'Event',
        sourceId: 'ev-101',
        type: NotificationType.EVENT_REMINDER,
        timingKey: '2026-09-13T18:00'
      });
      expect(key).toBe('event:ev-101:event_reminder:2026-09-13T18:00');
    });

    test('identifies Quiet Hours correctly in Vietnam time (22:00 to 07:00)', () => {
      // 23:30 Vietnam time (UTC+7) -> 16:30 UTC
      const nightInstant = new Date('2026-09-13T16:30:00.000Z');
      expect(isQuietHours(nightInstant)).toBe(true);

      // 03:00 Vietnam time (UTC+7) -> 20:00 UTC previous day
      const earlyMorningInstant = new Date('2026-09-12T20:00:00.000Z');
      expect(isQuietHours(earlyMorningInstant)).toBe(true);

      // 09:00 Vietnam time (UTC+7) -> 02:00 UTC
      const dayInstant = new Date('2026-09-13T02:00:00.000Z');
      expect(isQuietHours(dayInstant)).toBe(false);
    });

    test('evaluates delivery policy: CRITICAL bypasses quiet hours', () => {
      const nightInstant = new Date('2026-09-13T16:30:00.000Z'); // 23:30 VN

      const normalNotif = createNotification({
        title: 'Normal',
        message: 'Msg',
        priority: NotificationPriority.MEDIUM
      });

      const criticalNotif = createNotification({
        title: 'Critical Alert',
        message: 'Urgent',
        priority: NotificationPriority.CRITICAL
      });

      const normalPolicy = evaluateDeliveryPolicy(normalNotif, { now: nightInstant });
      expect(normalPolicy.deliverToast).toBe(false);
      expect(normalPolicy.deliverStore).toBe(true);

      const criticalPolicy = evaluateDeliveryPolicy(criticalNotif, { now: nightInstant });
      expect(criticalPolicy.deliverToast).toBe(true);
      expect(criticalPolicy.deliverStore).toBe(true);
    });
  });

  describe('NotificationScheduler', () => {
    let mockStorage;
    let store;
    let triggeredNotifs;
    let scheduler;

    beforeEach(() => {
      mockStorage = createMockStorage();
      store = new NotificationStore({ storage: mockStorage });
      triggeredNotifs = [];
      scheduler = new NotificationScheduler({
        store,
        onTrigger: (n) => triggeredNotifs.push(n)
      });
    });

    test('calculates event reminder timing using AppDate (15m advance)', () => {
      const result = scheduler.calculateEventTrigger('2026-09-13', '08:00', 15);
      expect(result.triggerDate).toBe('2026-09-13');
      expect(result.triggerTime).toBe('07:45');
    });

    test('calculates event reminder crossing previous midnight correctly', () => {
      const result = scheduler.calculateEventTrigger('2026-09-13', '00:10', 15);
      expect(result.triggerDate).toBe('2026-09-12');
      expect(result.triggerTime).toBe('23:55');
    });

    test('reconciles and triggers overdue tasks', () => {
      // Simulated now: 2026-09-13 10:00 VN -> 03:00 UTC
      const nowInstant = new Date('2026-09-13T03:00:00.000Z');

      const mockUser = {
        fixedSchedules: [],
        tasks: [
          { id: 't-overdue', title: 'Bài tập Sinh', date: '2026-09-11', status: 'open', minutes: 45 }
        ],
        reviewSchedules: []
      };

      const results = scheduler.reconcile(mockUser, nowInstant);
      expect(results.length).toBe(1);
      expect(results[0].type).toBe(NotificationType.TASK_OVERDUE);
      expect(results[0].title).toContain('quá hạn');
      expect(results[0].message).toContain('2 ngày');

      // Second reconciliation run should be deduplicated
      const rerun = scheduler.reconcile(mockUser, nowInstant);
      expect(rerun.length).toBe(0);
    });

    test('cancels tracking when an item is deleted', () => {
      store.recordFiredKey('task:t-deleted:task_overdue:2026-09-13');
      expect(store.hasFiredKey('task:t-deleted:task_overdue:2026-09-13')).toBe(true);

      scheduler.handleItemDeleted('task', 't-deleted');
      expect(store.hasFiredKey('task:t-deleted:task_overdue:2026-09-13')).toBe(false);
    });

    test('reconciles fixed schedules and reschedules if slot time changes', () => {
      // 2026-09-13 is Sunday (weekday 0)
      // Test event on Sunday at 10:00 -> reminder at 09:45
      // Current simulated time: 09:50 VN -> 02:50 UTC
      const nowInstant = new Date('2026-09-13T02:50:00.000Z');

      const mockUser = {
        fixedSchedules: [
          { id: 'slot-1', title: 'Học Toán', day: 0, start: '10:00', end: '11:30' }
        ],
        tasks: [],
        reviewSchedules: []
      };

      const results = scheduler.reconcile(mockUser, nowInstant);
      expect(results.length).toBe(1);
      expect(results[0].title).toContain('Học Toán');
      expect(results[0].message).toContain('10:00');

      // Now user moves event to 10:02 and now is 09:50
      mockUser.fixedSchedules[0].start = '10:02';
      // Moving slot clears previous fired keys for slot-1
      const rerun = scheduler.reconcile(mockUser, nowInstant);
      expect(rerun.length).toBe(1);
      expect(rerun[0].message).toContain('10:02');
    });
  });

  describe('NotificationService Integration', () => {
    let mockStorage;
    let store;
    let service;
    let toastMock;

    beforeEach(() => {
      mockStorage = createMockStorage();
      store = new NotificationStore({ storage: mockStorage });
      toastMock = {
        show: jest.fn(),
        dismiss: jest.fn(),
        dismissAll: jest.fn()
      };
      service = new NotificationService({
        store,
        toast: toastMock,
        quietHours: { start: '22:00', end: '07:00', enabled: true }
      });
    });

    test('notify() delivers to store and calls toast outside quiet hours', () => {
      // 14:00 VN time (07:00 UTC)
      const dayInstant = new Date('2026-09-13T07:00:00.000Z');

      const notif = service.notify('Đã lưu bài học thành công', { now: dayInstant });

      expect(notif).not.toBeNull();
      expect(store.getAll().length).toBe(1);
      expect(toastMock.show).toHaveBeenCalledTimes(1);
    });

    test('notify() suppresses toast but keeps in store during quiet hours', () => {
      // 23:00 VN time (16:00 UTC)
      const nightInstant = new Date('2026-09-13T16:00:00.000Z');

      const notif = service.notify({
        title: 'Nhắc học nhẹ',
        message: 'Tin nhắn đêm',
        priority: NotificationPriority.LOW
      }, { now: nightInstant });

      expect(notif).not.toBeNull();
      expect(store.getAll().length).toBe(1);
      expect(toastMock.show).not.toHaveBeenCalled();
    });

    test('shorthand helper methods create appropriate severities', () => {
      service.success('Saved');
      service.error('Failed');
      service.warning('Check timing');

      const all = store.getAll();
      expect(all.length).toBe(3);
      expect(all.find(n => n.message === 'Saved').severity).toBe(NotificationSeverity.SUCCESS);
      expect(all.find(n => n.message === 'Failed').severity).toBe(NotificationSeverity.DANGER);
      expect(all.find(n => n.message === 'Check timing').severity).toBe(NotificationSeverity.WARNING);
    });
  });

  describe('ToastUI DOM & ARIA Accessibility', () => {
    const { ToastUI } = require('../src/notifications/toast-ui');

    let mockContainer;
    let originalDoc;

    beforeEach(() => {
      // Mock DOM element factory
      function createMockElement(tagName) {
        const attributes = {};
        const classes = new Set();
        const listeners = {};
        let innerHtmlContent = '';
        let parent = null;
        const children = [];

        return {
          tagName: tagName.toUpperCase(),
          id: '',
          className: '',
          style: {},
          setAttribute: (k, v) => { attributes[k] = String(v); },
          getAttribute: (k) => attributes[k] || null,
          classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c)
          },
          addEventListener: (evt, fn) => {
            listeners[evt] = listeners[evt] || [];
            listeners[evt].push(fn);
          },
          appendChild: function (child) {
            child.parentNode = this;
            children.push(child);
            return child;
          },
          removeChild: function (child) {
            const idx = children.indexOf(child);
            if (idx >= 0) children.splice(idx, 1);
            child.parentNode = null;
            return child;
          },
          querySelector: (sel) => {
            if (sel === '.tb-toast-close') {
              const btn = createMockElement('button');
              btn.setAttribute('aria-label', 'Đóng thông báo');
              return btn;
            }
            if (sel === '.tb-toast-action') {
              const btn = createMockElement('button');
              return btn;
            }
            return null;
          },
          querySelectorAll: () => [],
          set innerHTML(val) { innerHtmlContent = val; },
          get innerHTML() { return innerHtmlContent; },
          parentNode: null
        };
      }

      mockContainer = createMockElement('div');
      mockContainer.id = 'toastContainer';

      originalDoc = global.document;
      global.document = {
        querySelector: (sel) => {
          if (sel === '#toastContainer') return mockContainer;
          return null;
        },
        createElement: (tag) => createMockElement(tag),
        body: {
          appendChild: (el) => mockContainer.appendChild(el)
        }
      };
      global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    });

    afterEach(() => {
      global.document = originalDoc;
    });

    test('renders standard notification with role="status" and aria-live="polite"', () => {
      const toastUI = new ToastUI({ container: mockContainer });
      const notif = createNotification({
        title: 'Thành công',
        message: 'Đã lưu ghi chú',
        severity: NotificationSeverity.SUCCESS,
        priority: NotificationPriority.LOW
      });

      const el = toastUI.show(notif);
      expect(el).not.toBeNull();
      expect(el.getAttribute('role')).toBe('status');
      expect(el.getAttribute('aria-live')).toBe('polite');
      expect(el.getAttribute('aria-atomic')).toBe('true');
      expect(el.innerHTML).toContain('Thành công');
      expect(el.innerHTML).toContain('Đã lưu ghi chú');
      toastUI.dismissAll();
    });

    test('renders critical notification with role="alert" and aria-live="assertive"', () => {
      const toastUI = new ToastUI({ container: mockContainer });
      const notif = createNotification({
        title: 'Báo động',
        message: 'Trùng lịch nghiêm trọng',
        severity: NotificationSeverity.DANGER,
        priority: NotificationPriority.CRITICAL
      });

      const el = toastUI.show(notif);
      expect(el).not.toBeNull();
      expect(el.getAttribute('role')).toBe('alert');
      expect(el.getAttribute('aria-live')).toBe('assertive');
      expect(el.className).toContain('tb-toast-priority-critical');
      toastUI.dismissAll();
    });

    test('dismiss cleans up toast from active list and triggers callback', (done) => {
      const toastUI = new ToastUI({ container: mockContainer });
      const notif = createNotification({
        title: 'Test',
        message: 'Dismiss me'
      });

      const el = toastUI.show(notif);
      expect(toastUI.activeToasts.has(notif.id)).toBe(true);

      toastUI.dismiss(notif.id, (dismissedId) => {
        expect(dismissedId).toBe(notif.id);
        expect(toastUI.activeToasts.has(notif.id)).toBe(false);
        done();
      });
    });
  });

});

