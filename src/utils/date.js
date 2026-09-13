'use strict';

/**
 * Centralized Date/Time Utility Module for Vietnam (Asia/Ho_Chi_Minh / UTC+7).
 *
 * Architecture Principles:
 * 1. Single source of truth for timezone: APP_TIMEZONE = 'Asia/Ho_Chi_Minh'.
 * 2. Distinction between:
 *    - Calendar dates: YYYY-MM-DD (pure calendar dates, invariant across timezones).
 *    - Wall-clock times: HH:mm (24-hour time within a day).
 *    - Instants: UTC Date objects or ISO 8601 strings representing exact point in time.
 * 3. Never rely on host browser/server local timezone for calendar arithmetic.
 * 4. Deterministic day boundaries (00:00:00 to 23:59:59.999).
 * 5. Works in both Node.js / Jest (CommonJS) and browser (via window.AppDate or globalThis.AppDate).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node.js / CommonJS
    module.exports = factory();
  } else {
    // Browser / Global
    const mod = factory();
    root.AppDate = mod;
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {

  const APP_TIMEZONE = 'Asia/Ho_Chi_Minh';
  const APP_OFFSET_HOURS = 7;
  const APP_OFFSET_STR = '+07:00';

  const DAY_NAMES_VI = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const DAY_NAMES_UPPER_VI = ['CHỦ NHẬT', 'THỨ HAI', 'THỨ BA', 'THỨ TƯ', 'THỨ NĂM', 'THỨ SÁU', 'THỨ BẢY'];
  const MONTH_NAMES_VI = [
    'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
    'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'
  ];

  /**
   * Returns the centralized application timezone identifier.
   */
  function getAppTimezone() {
    return APP_TIMEZONE;
  }

  /**
   * Returns today's date in Vietnam time as 'YYYY-MM-DD'.
   * Independent of client machine's local timezone.
   *
   * @param {Date} [nowInstant] - Optional date instant (defaults to new Date())
   * @returns {string} 'YYYY-MM-DD'
   */
  function getTodayAppDate(nowInstant = new Date()) {
    if (!(nowInstant instanceof Date) || Number.isNaN(nowInstant.getTime())) {
      nowInstant = new Date();
    }
    // Use Intl with Asia/Ho_Chi_Minh to guarantee exact Vietnam calendar date
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(nowInstant); // 'YYYY-MM-DD' in en-CA locale
  }

  /**
   * Validates and normalizes an input into a standard calendar date string 'YYYY-MM-DD'.
   * Returns null if input is invalid or cannot be parsed.
   *
   * @param {string|Date|number} value
   * @returns {string|null} 'YYYY-MM-DD' or null
   */
  function parseAppDate(value) {
    if (!value) return null;

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return getTodayAppDate(value);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();

      // If it contains 'T' or time info, parse as instant and convert to Vietnam date
      if (trimmed.includes('T') || trimmed.includes('Z')) {
        const parsedTs = Date.parse(trimmed);
        if (!Number.isNaN(parsedTs)) {
          return getTodayAppDate(new Date(parsedTs));
        }
        return null;
      }

      // Match exact bare calendar date YYYY-MM-DD
      const dateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateMatch) {
        const y = Number(dateMatch[1]);
        const m = Number(dateMatch[2]);
        const d = Number(dateMatch[3]);
        if (m < 1 || m > 12 || d < 1 || d > 31) return null;

        // Verify valid day in month (e.g. leap year check)
        const check = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        if (check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d) {
          return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
        return null;
      }

      // Try parsing other string formats as instant
      const parsedTs = Date.parse(trimmed);
      if (!Number.isNaN(parsedTs)) {
        return getTodayAppDate(new Date(parsedTs));
      }
    }

    return null;
  }

  /**
   * Adds or subtracts integer days to/from a 'YYYY-MM-DD' calendar date.
   * Uses UTC calendar math to avoid any DST or timezone boundary skews.
   *
   * @param {string} dateStr - 'YYYY-MM-DD'
   * @param {number} days - Integer number of days to add (can be negative)
   * @returns {string} 'YYYY-MM-DD'
   */
  function addAppDays(dateStr, days) {
    const valid = parseAppDate(dateStr);
    if (!valid) throw new Error(`Invalid date passed to addAppDays: ${dateStr}`);

    const [y, m, d] = valid.split('-').map(Number);
    const utcDate = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
    const newY = utcDate.getUTCFullYear();
    const newM = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
    const newD = String(utcDate.getUTCDate()).padStart(2, '0');
    return `${newY}-${newM}-${newD}`;
  }

  /**
   * Returns the integer difference in calendar days between targetDate and baseDate (target - base).
   * Positive if target is after base, negative if target is before base, 0 if same day.
   *
   * @param {string} targetDate - 'YYYY-MM-DD'
   * @param {string} baseDate - 'YYYY-MM-DD'
   * @returns {number}
   */
  function diffAppCalendarDays(targetDate, baseDate) {
    const validTarget = parseAppDate(targetDate);
    const validBase = parseAppDate(baseDate);
    if (!validTarget || !validBase) return 0;

    const [y1, m1, d1] = validTarget.split('-').map(Number);
    const [y2, m2, d2] = validBase.split('-').map(Number);

    const utc1 = Date.UTC(y1, m1 - 1, d1);
    const utc2 = Date.UTC(y2, m2 - 1, d2);

    return Math.round((utc1 - utc2) / 86400000);
  }

  /**
   * Checks if two dates represent the same calendar day.
   *
   * @param {string|Date} date1
   * @param {string|Date} date2
   * @returns {boolean}
   */
  function isSameAppDay(date1, date2) {
    const p1 = parseAppDate(date1);
    const p2 = parseAppDate(date2);
    if (!p1 || !p2) return false;
    return p1 === p2;
  }

  /**
   * Returns day of the week (0 = Sunday, 1 = Monday, ..., 6 = Saturday) in Vietnam time.
   *
   * @param {string} dateStr - 'YYYY-MM-DD'
   * @returns {number} 0-6
   */
  function getAppDayOfWeek(dateStr) {
    const valid = parseAppDate(dateStr);
    if (!valid) return 0;
    const [y, m, d] = valid.split('-').map(Number);
    const utcDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return utcDate.getUTCDay();
  }

  /**
   * Returns start of day instant (00:00:00.000 in Vietnam time) as a UTC Date object.
   * E.g. '2026-09-13' -> 2026-09-12T17:00:00.000Z
   *
   * @param {string} dateStr - 'YYYY-MM-DD'
   * @returns {Date}
   */
  function startOfAppDay(dateStr) {
    const valid = parseAppDate(dateStr);
    if (!valid) throw new Error(`Invalid date passed to startOfAppDay: ${dateStr}`);
    const [y, m, d] = valid.split('-').map(Number);
    // 00:00:00 in UTC+7 is 17:00:00 on the previous day in UTC
    return new Date(Date.UTC(y, m - 1, d, 0 - APP_OFFSET_HOURS, 0, 0, 0));
  }

  /**
   * Returns end of day instant (23:59:59.999 in Vietnam time) as a UTC Date object.
   * E.g. '2026-09-13' -> 2026-09-13T16:59:59.999Z
   *
   * @param {string} dateStr - 'YYYY-MM-DD'
   * @returns {Date}
   */
  function endOfAppDay(dateStr) {
    const valid = parseAppDate(dateStr);
    if (!valid) throw new Error(`Invalid date passed to endOfAppDay: ${dateStr}`);
    const [y, m, d] = valid.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 23 - APP_OFFSET_HOURS, 59, 59, 999));
  }

  /**
   * Converts hours and minutes into minutes from midnight (0 to 1439).
   *
   * @param {string} timeStr - 'HH:mm'
   * @returns {number}
   */
  function minFromTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const parts = timeStr.split(':').map(Number);
    const h = Number.isFinite(parts[0]) ? parts[0] : 0;
    const m = Number.isFinite(parts[1]) ? parts[1] : 0;
    return h * 60 + m;
  }

  /**
   * Returns current time of day as minutes from midnight (0 to 1439) in Vietnam time.
   *
   * @param {Date} [instant=new Date()]
   * @returns {number}
   */
  function getAppTimeMinutes(instant = new Date()) {
    if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
      instant = new Date();
    }
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIMEZONE,
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    const parts = formatter.formatToParts(instant);
    const h = Number(parts.find(p => p.type === 'hour')?.value || 0);
    const m = Number(parts.find(p => p.type === 'minute')?.value || 0);
    return h * 60 + m;
  }

  /**
   * Converts minutes from midnight into 'HH:mm'.
   *
   * @param {number} totalMinutes
   * @returns {string}
   */
  function timeFromMin(totalMinutes) {
    const normalized = Math.max(0, Math.floor(Number(totalMinutes) || 0));
    const hours = Math.floor(normalized / 60) % 24;
    const mins = normalized % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  /**
   * Formats duration in minutes to 'Xh Ym'.
   *
   * @param {number} minutes
   * @returns {string}
   */
  function formatMinutes(minutes) {
    const mins = Math.max(0, Math.floor(Number(minutes) || 0));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }

  /**
   * Combines a calendar date 'YYYY-MM-DD' and time 'HH:mm' into an ISO 8601 string
   * with Vietnam timezone offset (+07:00).
   *
   * @param {string} dateStr - 'YYYY-MM-DD'
   * @param {string} [timeStr='00:00'] - 'HH:mm'
   * @returns {string} 'YYYY-MM-DDTHH:mm:00+07:00'
   */
  function combineAppDateAndTime(dateStr, timeStr = '00:00') {
    const validDate = parseAppDate(dateStr);
    if (!validDate) throw new Error(`Invalid date: ${dateStr}`);
    const parts = (timeStr || '00:00').split(':');
    const hh = String(Number(parts[0]) || 0).padStart(2, '0');
    const mm = String(Number(parts[1]) || 0).padStart(2, '0');
    return `${validDate}T${hh}:${mm}:00${APP_OFFSET_STR}`;
  }

  /**
   * Converts date and time to ISO 8601 UTC timestamp for API/DB storage.
   *
   * @param {string} dateStr - 'YYYY-MM-DD'
   * @param {string} [timeStr='00:00'] - 'HH:mm'
   * @returns {string} 'YYYY-MM-DDTHH:mm:ss.sssZ'
   */
  function toApiDateTime(dateStr, timeStr = '00:00') {
    const isoWithOffset = combineAppDateAndTime(dateStr, timeStr);
    const date = new Date(isoWithOffset);
    return date.toISOString();
  }

  /**
   * Converts an ISO API/DB timestamp to Vietnam date and time components.
   *
   * @param {string} isoString
   * @returns {{ date: string, time: string }}
   */
  function fromApiDateTime(isoString) {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) {
      return { date: getTodayAppDate(), time: '00:00' };
    }
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = formatter.formatToParts(d);
    const get = type => parts.find(p => p.type === type)?.value || '';
    const date = `${get('year')}-${get('month')}-${get('day')}`;
    const time = `${get('hour')}:${get('minute')}`;
    return { date, time };
  }

  /**
   * Formats a date string 'YYYY-MM-DD' into Vietnamese short date format 'DD/MM'.
   *
   * @param {string} dateStr
   * @returns {string} 'DD/MM'
   */
  function formatShortDate(dateStr) {
    const valid = parseAppDate(dateStr);
    if (!valid) return '—';
    const [, m, d] = valid.split('-');
    return `${d}/${m}`;
  }

  /**
   * Formats a date string 'YYYY-MM-DD' or Date into full Vietnamese uppercase header.
   * E.g. 'THỨ HAI, 13 THÁNG 9'
   *
   * @param {string|Date} dateInput
   * @returns {string}
   */
  function formatVietnameseDate(dateInput) {
    const valid = parseAppDate(dateInput) || getTodayAppDate();
    const [y, m, d] = valid.split('-').map(Number);
    const dayOfWeek = getAppDayOfWeek(valid);
    return `${DAY_NAMES_UPPER_VI[dayOfWeek]}, ${d} THÁNG ${m}`;
  }

  /**
   * Formats a date string for schedule navigation header.
   * E.g. 'Thứ hai, 13 tháng 9'
   *
   * @param {string} dateStr
   * @returns {string}
   */
  function formatScheduleHeaderDate(dateStr) {
    const valid = parseAppDate(dateStr) || getTodayAppDate();
    const [, m, d] = valid.split('-').map(Number);
    const dayOfWeek = getAppDayOfWeek(valid);
    return `${DAY_NAMES_VI[dayOfWeek]}, ${d} tháng ${m}`;
  }

  /**
   * Formats human-readable relative deadline text.
   * E.g.:
   *   'Quá hạn 2 ngày'
   *   'Hạn chót hôm nay'
   *   'Hạn chót ngày mai'
   *   'Hạn chót 15/09'
   *
   * @param {string} deadlineDate - 'YYYY-MM-DD'
   * @param {string} [todayDate] - Optional baseline (defaults to current Vietnam today)
   * @returns {string}
   */
  function formatDeadlineText(deadlineDate, todayDate = getTodayAppDate()) {
    const validDeadline = parseAppDate(deadlineDate);
    if (!validDeadline) return 'Không có hạn';

    const diff = diffAppCalendarDays(validDeadline, todayDate);
    if (diff < 0) return `Quá hạn ${Math.abs(diff)} ngày`;
    if (diff === 0) return 'Hạn chót hôm nay';
    if (diff === 1) return 'Hạn chót ngày mai';
    return `Hạn chót ${formatShortDate(validDeadline)}`;
  }

  /**
   * Calculates reminder time for an event.
   * Returns a Vietnam date and time.
   * E.g. Event on '2026-09-13' at '19:00' with 15min advance -> { date: '2026-09-13', time: '18:45' }
   * E.g. Event on '2026-09-13' at '00:10' with 15min advance -> { date: '2026-09-12', time: '23:55' }
   *
   * @param {string} eventDate - 'YYYY-MM-DD'
   * @param {string} eventStartTime - 'HH:mm'
   * @param {number} advanceMinutes - Number of minutes before event (e.g. 15)
   * @returns {{ date: string, time: string }}
   */
  function calculateReminderTiming(eventDate, eventStartTime, advanceMinutes = 15) {
    const validDate = parseAppDate(eventDate);
    if (!validDate) throw new Error(`Invalid eventDate: ${eventDate}`);
    const eventMins = minFromTime(eventStartTime);
    const reminderMinsTotal = eventMins - advanceMinutes;

    if (reminderMinsTotal >= 0) {
      return {
        date: validDate,
        time: timeFromMin(reminderMinsTotal),
      };
    }

    // Crossed previous midnight
    const prevDate = addAppDays(validDate, -1);
    const wrappedMins = 1440 + reminderMinsTotal;
    return {
      date: prevDate,
      time: timeFromMin(wrappedMins),
    };
  }

  /**
   * Generates calendar grid cells for a given year and month (0-indexed).
   * Deterministic regardless of host timezone.
   *
   * @param {number} year - Full year (e.g. 2026)
   * @param {number} month - 0-11
   * @param {string} [todayDateStr] - Current today YYYY-MM-DD
   * @returns {Array<{ day: number, date: string, muted: boolean, isToday: boolean }>}
   */
  function generateCalendarGrid(year, month, todayDateStr = getTodayAppDate()) {
    // Determine first day of month (0 = Sun, 1 = Mon ... 6 = Sat)
    const firstDateStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const firstDayOfWeek = getAppDayOfWeek(firstDateStr);
    // Grid starts on Monday (1). Offset: Mon=0, Tue=1, ..., Sun=6
    const startOffset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

    // Days in current month
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    // Days in previous month
    const daysInPrev = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const cells = [];

    // Previous month padding
    for (let i = startOffset - 1; i >= 0; i--) {
      const dayNum = daysInPrev - i;
      const prevMonthStr = month === 0 ? `${year - 1}-12` : `${year}-${String(month).padStart(2, '0')}`;
      cells.push({
        day: dayNum,
        date: `${prevMonthStr}-${String(dayNum).padStart(2, '0')}`,
        muted: true,
        isToday: false,
      });
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      cells.push({
        day: i,
        date: dateStr,
        muted: false,
        isToday: dateStr === todayDateStr,
      });
    }

    // Next month padding to fill standard 42 cells (6 rows)
    let nextDayNum = 1;
    while (cells.length < 42) {
      const nextMonthStr = month === 11 ? `${year + 1}-01` : `${year}-${String(month + 2).padStart(2, '0')}`;
      cells.push({
        day: nextDayNum,
        date: `${nextMonthStr}-${String(nextDayNum).padStart(2, '0')}`,
        muted: true,
        isToday: false,
      });
      nextDayNum++;
    }

    return cells;
  }

  return {
    APP_TIMEZONE,
    APP_OFFSET_STR,
    DAY_NAMES_VI,
    DAY_NAMES_UPPER_VI,
    MONTH_NAMES_VI,
    getAppTimezone,
    getTodayAppDate,
    parseAppDate,
    addAppDays,
    diffAppCalendarDays,
    isSameAppDay,
    getAppDayOfWeek,
    startOfAppDay,
    endOfAppDay,
    minFromTime,
    getAppTimeMinutes,
    timeFromMin,
    formatMinutes,
    combineAppDateAndTime,
    toApiDateTime,
    fromApiDateTime,
    formatShortDate,
    formatVietnameseDate,
    formatScheduleHeaderDate,
    formatDeadlineText,
    calculateReminderTiming,
    generateCalendarGrid,
  };
}));
