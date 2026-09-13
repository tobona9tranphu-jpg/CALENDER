'use strict';

/**
 * Test Suite for Centralized Date/Time Utilities (P0.3 - Vietnam Timezone UTC+7)
 */

const AppDate = require('../src/utils/date');

describe('src/utils/date.js — Core Date/Time Utilities', () => {

  // ─── 1. Application Timezone ───────────────────────────────────────────────
  describe('Application Timezone', () => {
    test('getAppTimezone returns Asia/Ho_Chi_Minh', () => {
      expect(AppDate.getAppTimezone()).toBe('Asia/Ho_Chi_Minh');
    });

    test('APP_OFFSET_STR is +07:00', () => {
      expect(AppDate.APP_OFFSET_STR).toBe('+07:00');
    });
  });

  // ─── 2. Input Parsing & Validation ─────────────────────────────────────────
  describe('Input Parsing & Validation (parseAppDate)', () => {
    test('parses valid YYYY-MM-DD string', () => {
      expect(AppDate.parseAppDate('2026-09-13')).toBe('2026-09-13');
      expect(AppDate.parseAppDate('2024-02-29')).toBe('2024-02-29'); // leap year valid
    });

    test('rejects invalid leap year dates', () => {
      expect(AppDate.parseAppDate('2026-02-29')).toBeNull(); // 2026 is not a leap year
    });

    test('rejects out-of-range months and days', () => {
      expect(AppDate.parseAppDate('2026-13-01')).toBeNull();
      expect(AppDate.parseAppDate('2026-04-31')).toBeNull(); // April has 30 days
      expect(AppDate.parseAppDate('2026-00-10')).toBeNull();
      expect(AppDate.parseAppDate('2026-05-00')).toBeNull();
    });

    test('parses Date object into Vietnam date string', () => {
      // 2026-09-12T17:30:00Z is 2026-09-13 00:30 in Vietnam
      const instant = new Date('2026-09-12T17:30:00Z');
      expect(AppDate.parseAppDate(instant)).toBe('2026-09-13');
    });

    test('parses full ISO timestamp string into Vietnam date string', () => {
      expect(AppDate.parseAppDate('2026-09-12T17:30:00.000Z')).toBe('2026-09-13');
    });

    test('handles malformed inputs gracefully without crashing', () => {
      expect(AppDate.parseAppDate('')).toBeNull();
      expect(AppDate.parseAppDate(null)).toBeNull();
      expect(AppDate.parseAppDate(undefined)).toBeNull();
      expect(AppDate.parseAppDate('not-a-date')).toBeNull();
      expect(AppDate.parseAppDate('abc-def-ghij')).toBeNull();
      expect(AppDate.parseAppDate(NaN)).toBeNull();
      expect(AppDate.parseAppDate(new Date('invalid'))).toBeNull();
    });
  });

  // ─── 3. Formatting ─────────────────────────────────────────────────────────
  describe('Formatting (formatShortDate, formatVietnameseDate, formatScheduleHeaderDate)', () => {
    test('formatShortDate formats as DD/MM', () => {
      expect(AppDate.formatShortDate('2026-09-13')).toBe('13/09');
      expect(AppDate.formatShortDate('2026-01-05')).toBe('05/01');
      expect(AppDate.formatShortDate(null)).toBe('—');
    });

    test('formatVietnameseDate returns full uppercase header with correct weekday', () => {
      // 2026-09-13 is Sunday
      expect(AppDate.formatVietnameseDate('2026-09-13')).toBe('CHỦ NHẬT, 13 THÁNG 9');
      // 2026-09-14 is Monday
      expect(AppDate.formatVietnameseDate('2026-09-14')).toBe('THỨ HAI, 14 THÁNG 9');
    });

    test('formatScheduleHeaderDate returns mixed-case header', () => {
      expect(AppDate.formatScheduleHeaderDate('2026-09-13')).toBe('Chủ nhật, 13 tháng 9');
      expect(AppDate.formatScheduleHeaderDate('2026-09-15')).toBe('Thứ ba, 15 tháng 9');
    });
  });

  // ─── 4. Calendar Arithmetic ────────────────────────────────────────────────
  describe('Calendar Arithmetic (addAppDays, diffAppCalendarDays)', () => {
    test('adds one day correctly', () => {
      expect(AppDate.addAppDays('2026-09-13', 1)).toBe('2026-09-14');
    });

    test('subtracts one day correctly', () => {
      expect(AppDate.addAppDays('2026-09-13', -1)).toBe('2026-09-12');
    });

    test('handles month boundaries correctly', () => {
      expect(AppDate.addAppDays('2026-01-31', 1)).toBe('2026-02-01');
      expect(AppDate.addAppDays('2026-03-01', -1)).toBe('2026-02-28');
      expect(AppDate.addAppDays('2026-04-30', 1)).toBe('2026-05-01');
    });

    test('handles leap year boundaries correctly', () => {
      expect(AppDate.addAppDays('2024-02-28', 1)).toBe('2024-02-29');
      expect(AppDate.addAppDays('2024-02-29', 1)).toBe('2024-03-01');
      expect(AppDate.addAppDays('2026-02-28', 1)).toBe('2026-03-01'); // non-leap
    });

    test('handles year boundaries correctly', () => {
      expect(AppDate.addAppDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(AppDate.addAppDays('2027-01-01', -1)).toBe('2026-12-31');
    });

    test('diffAppCalendarDays computes exact day differences', () => {
      expect(AppDate.diffAppCalendarDays('2026-09-15', '2026-09-13')).toBe(2);
      expect(AppDate.diffAppCalendarDays('2026-09-13', '2026-09-13')).toBe(0);
      expect(AppDate.diffAppCalendarDays('2026-09-12', '2026-09-13')).toBe(-1);
      expect(AppDate.diffAppCalendarDays('2027-01-01', '2026-12-31')).toBe(1);
      expect(AppDate.diffAppCalendarDays('2026-09-13', '2026-09-20')).toBe(-7);
    });

    test('isSameAppDay identifies matching dates', () => {
      expect(AppDate.isSameAppDay('2026-09-13', '2026-09-13')).toBe(true);
      expect(AppDate.isSameAppDay('2026-09-13', '2026-09-14')).toBe(false);
      expect(AppDate.isSameAppDay('2026-09-13', null)).toBe(false);
    });
  });

  // ─── 5. Day Boundaries & Instants ──────────────────────────────────────────
  describe('Day Boundaries & Instants (startOfAppDay, endOfAppDay)', () => {
    test('startOfAppDay returns UTC Date at 00:00:00 Vietnam time', () => {
      const start = AppDate.startOfAppDay('2026-09-13');
      // 00:00 on Sept 13 in UTC+7 is 17:00 on Sept 12 in UTC
      expect(start.toISOString()).toBe('2026-09-12T17:00:00.000Z');
    });

    test('endOfAppDay returns UTC Date at 23:59:59.999 Vietnam time', () => {
      const end = AppDate.endOfAppDay('2026-09-13');
      // 23:59:59.999 on Sept 13 in UTC+7 is 16:59:59.999 on Sept 13 in UTC
      expect(end.toISOString()).toBe('2026-09-13T16:59:59.999Z');
    });

    test('crossing midnight has exact 1ms boundary distance', () => {
      const endSept13 = AppDate.endOfAppDay('2026-09-13');
      const startSept14 = AppDate.startOfAppDay('2026-09-14');
      expect(startSept14.getTime() - endSept13.getTime()).toBe(1);
    });
  });

  // ─── 6. Time Conversions ───────────────────────────────────────────────────
  describe('Time Conversions (minFromTime, timeFromMin, formatMinutes)', () => {
    test('minFromTime converts HH:mm to minutes', () => {
      expect(AppDate.minFromTime('00:00')).toBe(0);
      expect(AppDate.minFromTime('00:01')).toBe(1);
      expect(AppDate.minFromTime('08:30')).toBe(510);
      expect(AppDate.minFromTime('12:00')).toBe(720);
      expect(AppDate.minFromTime('19:00')).toBe(1140);
      expect(AppDate.minFromTime('23:59')).toBe(1439);
    });

    test('timeFromMin converts minutes to HH:mm', () => {
      expect(AppDate.timeFromMin(0)).toBe('00:00');
      expect(AppDate.timeFromMin(1)).toBe('00:01');
      expect(AppDate.timeFromMin(510)).toBe('08:30');
      expect(AppDate.timeFromMin(720)).toBe('12:00');
      expect(AppDate.timeFromMin(1140)).toBe('19:00');
      expect(AppDate.timeFromMin(1439)).toBe('23:59');
    });

    test('formatMinutes outputs Xh Ym', () => {
      expect(AppDate.formatMinutes(90)).toBe('1h 30m');
      expect(AppDate.formatMinutes(45)).toBe('0h 45m');
      expect(AppDate.formatMinutes(120)).toBe('2h 00m');
      expect(AppDate.formatMinutes(0)).toBe('0h 00m');
    });
  });

  // ─── 7. API / DB Conversions ───────────────────────────────────────────────
  describe('API and DB DateTime Conversions (combineAppDateAndTime, toApiDateTime, fromApiDateTime)', () => {
    test('combineAppDateAndTime formats with +07:00 offset', () => {
      expect(AppDate.combineAppDateAndTime('2026-09-13', '19:00')).toBe('2026-09-13T19:00:00+07:00');
      expect(AppDate.combineAppDateAndTime('2026-09-13', '00:00')).toBe('2026-09-13T00:00:00+07:00');
    });

    test('toApiDateTime converts Vietnam date+time to UTC ISO timestamp', () => {
      // 19:00 in UTC+7 is 12:00 UTC
      expect(AppDate.toApiDateTime('2026-09-13', '19:00')).toBe('2026-09-13T12:00:00.000Z');
      // 00:00 in UTC+7 is 17:00 on previous day in UTC
      expect(AppDate.toApiDateTime('2026-09-13', '00:00')).toBe('2026-09-12T17:00:00.000Z');
    });

    test('fromApiDateTime parses UTC ISO timestamp back to Vietnam date+time', () => {
      const { date, time } = AppDate.fromApiDateTime('2026-09-13T12:00:00.000Z');
      expect(date).toBe('2026-09-13');
      expect(time).toBe('19:00');

      const midnight = AppDate.fromApiDateTime('2026-09-12T17:00:00.000Z');
      expect(midnight.date).toBe('2026-09-13');
      expect(midnight.time).toBe('00:00');
    });
  });

  // ─── 8. Deadline Text ──────────────────────────────────────────────────────
  describe('Deadline Calculations (formatDeadlineText)', () => {
    const today = '2026-09-13';

    test('same day deadline', () => {
      expect(AppDate.formatDeadlineText('2026-09-13', today)).toBe('Hạn chót hôm nay');
    });

    test('tomorrow deadline', () => {
      expect(AppDate.formatDeadlineText('2026-09-14', today)).toBe('Hạn chót ngày mai');
    });

    test('future deadline formatted as short date', () => {
      expect(AppDate.formatDeadlineText('2026-09-20', today)).toBe('Hạn chót 20/09');
    });

    test('overdue deadline formatted with days count', () => {
      expect(AppDate.formatDeadlineText('2026-09-11', today)).toBe('Quá hạn 2 ngày');
      expect(AppDate.formatDeadlineText('2026-09-12', today)).toBe('Quá hạn 1 ngày');
    });
  });

  // ─── 9. Reminder / Event Timing ───────────────────────────────────────────
  describe('Reminder Timing Calculations (calculateReminderTiming)', () => {
    test('calculates reminder 15 minutes before event', () => {
      const timing = AppDate.calculateReminderTiming('2026-09-13', '19:00', 15);
      expect(timing.date).toBe('2026-09-13');
      expect(timing.time).toBe('18:45');
    });

    test('moving event from 19:00 to 20:00 updates reminder to 19:45', () => {
      const timing = AppDate.calculateReminderTiming('2026-09-13', '20:00', 15);
      expect(timing.date).toBe('2026-09-13');
      expect(timing.time).toBe('19:45');
    });

    test('event near midnight crossing into previous day (00:10 - 15m = 23:55 previous day)', () => {
      const timing = AppDate.calculateReminderTiming('2026-09-13', '00:10', 15);
      expect(timing.date).toBe('2026-09-12');
      expect(timing.time).toBe('23:55');
    });
  });

  // ─── 10. Calendar Grid ─────────────────────────────────────────────────────
  describe('Calendar Grid Generation (generateCalendarGrid)', () => {
    test('generates exactly 42 cells (6 rows of 7 days)', () => {
      const grid = AppDate.generateCalendarGrid(2026, 8, '2026-09-13'); // Sept 2026
      expect(grid.length).toBe(42);
    });

    test('marks today correctly within the grid', () => {
      const grid = AppDate.generateCalendarGrid(2026, 8, '2026-09-13');
      const todayCell = grid.find(c => c.isToday);
      expect(todayCell).toBeDefined();
      expect(todayCell.day).toBe(13);
      expect(todayCell.date).toBe('2026-09-13');
      expect(todayCell.muted).toBe(false);
    });

    test('first day of Sept 2026 is Tuesday (grid start offset = 1 for Monday)', () => {
      // 2026-09-01 is Tuesday. If Monday is column 0, Tuesday is column 1.
      // Column 0 should be Aug 31 (muted)
      const grid = AppDate.generateCalendarGrid(2026, 8, '2026-09-13');
      expect(grid[0].day).toBe(31);
      expect(grid[0].muted).toBe(true);
      expect(grid[1].day).toBe(1);
      expect(grid[1].muted).toBe(false);
      expect(grid[1].date).toBe('2026-09-01');
    });
  });

  // ─── 11. System Timezone Invariance Simulation ─────────────────────────────
  describe('System Timezone Invariance (Simulation)', () => {
    // Tests that calendar day operations do not alter meaning under other system timezones
    const foreignTimezones = ['America/New_York', 'Europe/London', 'UTC', 'Asia/Tokyo'];

    foreignTimezones.forEach(tz => {
      test(`date arithmetic and day-of-week are identical in simulated ${tz}`, () => {
        const originalTz = process.env.TZ;
        try {
          process.env.TZ = tz;

          // Sept 13, 2026 is Sunday (0)
          expect(AppDate.getAppDayOfWeek('2026-09-13')).toBe(0);
          // Adding 1 day is Sept 14, 2026 (Monday = 1)
          expect(AppDate.addAppDays('2026-09-13', 1)).toBe('2026-09-14');
          expect(AppDate.getAppDayOfWeek(AppDate.addAppDays('2026-09-13', 1))).toBe(1);
          // Calendar difference is exactly 2
          expect(AppDate.diffAppCalendarDays('2026-09-15', '2026-09-13')).toBe(2);
          // Start of day in UTC is always 17:00 on previous day
          expect(AppDate.startOfAppDay('2026-09-13').toISOString()).toBe('2026-09-12T17:00:00.000Z');
        } finally {
          process.env.TZ = originalTz;
        }
      });
    });
  });

});
