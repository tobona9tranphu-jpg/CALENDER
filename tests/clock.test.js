'use strict';

const Clock = require('../src/utils/clock');
const AppDate = require('../src/utils/date');

describe('Deterministic Central Clock (src/utils/clock.js)', () => {
  afterEach(() => {
    Clock.restore();
  });

  test('reports canonical timezone Asia/Ho_Chi_Minh', () => {
    expect(Clock.getTimezone()).toBe('Asia/Ho_Chi_Minh');
    expect(Clock.TIMEZONE).toBe('Asia/Ho_Chi_Minh');
  });

  test('returns valid Date instance for Clock.now()', () => {
    const n = Clock.now();
    expect(n instanceof Date).toBe(true);
    expect(Number.isNaN(n.getTime())).toBe(false);
  });

  test('returns valid date string for Clock.today()', () => {
    const t = Clock.today();
    expect(/^\d{4}-\d{2}-\d{2}$/.test(t)).toBe(true);
  });

  test('returns valid time string for Clock.getCurrentAppTime()', () => {
    const time = Clock.getCurrentAppTime();
    expect(/^\d{2}:\d{2}$/.test(time)).toBe(true);
  });

  describe('setFixed & restore', () => {
    test('fixes time using Date object', () => {
      // 2026-09-15 10:30 UTC+7 = 2026-09-15 03:30 UTC
      const fixed = new Date('2026-09-15T03:30:00.000Z');
      Clock.setFixed(fixed);

      expect(Clock.isFixed()).toBe(true);
      expect(Clock.now().toISOString()).toBe(fixed.toISOString());
      expect(Clock.today()).toBe('2026-09-15');
      expect(Clock.getCurrentAppTime()).toBe('10:30');
    });

    test('fixes time using date string YYYY-MM-DD with custom time', () => {
      Clock.setFixed('2026-11-20', '16:45');
      expect(Clock.isFixed()).toBe(true);
      expect(Clock.today()).toBe('2026-11-20');
      expect(Clock.getCurrentAppTime()).toBe('16:45');
    });

    test('fixes time using date string YYYY-MM-DD with default time 08:00', () => {
      Clock.setFixed('2026-11-20');
      expect(Clock.isFixed()).toBe(true);
      expect(Clock.today()).toBe('2026-11-20');
      expect(Clock.getCurrentAppTime()).toBe('08:00');
    });

    test('restores live clock', () => {
      Clock.setFixed('2025-01-01', '01:00');
      expect(Clock.today()).toBe('2025-01-01');
      Clock.restore();
      expect(Clock.isFixed()).toBe(false);
      expect(Clock.today()).not.toBe('2025-01-01');
    });
  });

  describe('getPlanningContext (No Half-Injected Date/Time)', () => {
    test('derives both currentDate and currentTime from explicit instant', () => {
      const inst = new Date('2026-09-15T07:15:00.000Z'); // 14:15 in VN
      const ctx = Clock.getPlanningContext({ currentInstant: inst });

      expect(ctx.currentDate).toBe('2026-09-15');
      expect(ctx.currentTime).toBe('14:15');
      expect(ctx.timezone).toBe('Asia/Ho_Chi_Minh');
      expect(ctx.currentInstant.getTime()).toBe(inst.getTime());
    });

    test('derives consistent instant when both currentDate and currentTime provided', () => {
      const ctx = Clock.getPlanningContext({
        currentDate: '2026-09-15',
        currentTime: '16:00'
      });

      expect(ctx.currentDate).toBe('2026-09-15');
      expect(ctx.currentTime).toBe('16:00');
      expect(ctx.timezone).toBe('Asia/Ho_Chi_Minh');
      expect(AppDate.getTodayAppDate(ctx.currentInstant)).toBe('2026-09-15');
      expect(AppDate.getCurrentAppTime(ctx.currentInstant)).toBe('16:00');
    });

    test('derives deterministic baseline time when ONLY currentDate provided (no wall-clock leakage)', () => {
      // Set fixed clock to some other date/time in the past
      Clock.setFixed('2024-01-01', '23:59');

      const ctx = Clock.getPlanningContext({
        currentDate: '2026-09-15'
      });

      expect(ctx.currentDate).toBe('2026-09-15');
      // Should derive a deterministic morning time (08:00), NEVER leaking 23:59 or real system time
      expect(ctx.currentTime).toBe('08:00');
      expect(AppDate.getTodayAppDate(ctx.currentInstant)).toBe('2026-09-15');
      expect(AppDate.getCurrentAppTime(ctx.currentInstant)).toBe('08:00');
    });

    test('uses Clock instant when no options provided', () => {
      Clock.setFixed('2026-10-05', '09:45');
      const ctx = Clock.getPlanningContext();

      expect(ctx.currentDate).toBe('2026-10-05');
      expect(ctx.currentTime).toBe('09:45');
      expect(ctx.timezone).toBe('Asia/Ho_Chi_Minh');
    });

    test('guarantees identical output regardless of external time changes', () => {
      Clock.setFixed('2026-09-15', '14:00');
      const ctx1 = Clock.getPlanningContext({ currentDate: '2026-09-15', currentTime: '14:00' });

      Clock.setFixed('2028-12-31', '23:59');
      const ctx2 = Clock.getPlanningContext({ currentDate: '2026-09-15', currentTime: '14:00' });

      expect(ctx1.currentDate).toBe(ctx2.currentDate);
      expect(ctx1.currentTime).toBe(ctx2.currentTime);
      expect(ctx1.currentInstant.getTime()).toBe(ctx2.currentInstant.getTime());
    });
  });
});
