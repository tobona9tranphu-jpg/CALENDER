'use strict';

/**
 * Centralized Application Clock
 * 
 * Provides a single source of truth for:
 * 1. Current instant (Date)
 * 2. Today calendar date in Vietnam timezone ('YYYY-MM-DD')
 * 3. Current wall-clock time in Vietnam timezone ('HH:mm')
 * 4. Deterministic mocking / fixed clock for tests
 * 5. Consistent planning context derivation (avoiding half-injected date/time bugs)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node.js
    const AppDate = require('./date');
    module.exports = factory(AppDate);
  } else {
    // Browser
    const AppDate = root.AppDate || root.DateUtil;
    const Clock = factory(AppDate);
    root.AppClock = Clock;
    root.Clock = Clock;
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (AppDate) {
  const TIMEZONE = 'Asia/Ho_Chi_Minh';
  let _fixedInstant = null;

  /**
   * Return the current Date instant.
   * If fixed in test/mock mode, returns fixed instant.
   * Otherwise returns current system instant.
   * @returns {Date}
   */
  function now() {
    if (_fixedInstant !== null) {
      return new Date(_fixedInstant.getTime());
    }
    return new Date();
  }

  /**
   * Returns today's date string ('YYYY-MM-DD') in Asia/Ho_Chi_Minh.
   * Derived from now().
   * @returns {string}
   */
  function today() {
    const n = now();
    return AppDate && AppDate.getTodayAppDate
      ? AppDate.getTodayAppDate(n)
      : n.toISOString().slice(0, 10);
  }

  /**
   * Returns current time string ('HH:mm') in Asia/Ho_Chi_Minh.
   * Derived from now().
   * @returns {string}
   */
  function getCurrentAppTime() {
    const n = now();
    return AppDate && AppDate.getCurrentAppTime
      ? AppDate.getCurrentAppTime(n)
      : `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  }

  /**
   * Returns the canonical application timezone.
   * @returns {string}
   */
  function getTimezone() {
    return TIMEZONE;
  }

  /**
   * Sets a fixed instant for deterministic testing.
   * Accepts:
   * - Date object
   * - timestamp number
   * - ISO string
   * - Date string 'YYYY-MM-DD' with optional time string 'HH:mm' (default '08:00')
   *
   * @param {Date|string|number} instantOrDate
   * @param {string} [optionalTime]
   */
  function setFixed(instantOrDate, optionalTime) {
    if (instantOrDate instanceof Date) {
      if (Number.isNaN(instantOrDate.getTime())) {
        throw new Error('Invalid Date provided to Clock.setFixed');
      }
      _fixedInstant = new Date(instantOrDate.getTime());
      return;
    }

    if (typeof instantOrDate === 'number') {
      _fixedInstant = new Date(instantOrDate);
      return;
    }

    if (typeof instantOrDate === 'string') {
      const trimmed = instantOrDate.trim();
      // Bare date YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const t = optionalTime || '08:00';
        _fixedInstant = new Date(`${trimmed}T${t}:00+07:00`);
        return;
      }
      // ISO or other parsable string
      const parsed = Date.parse(trimmed);
      if (Number.isNaN(parsed)) {
        throw new Error(`Cannot parse string date for Clock.setFixed: ${instantOrDate}`);
      }
      _fixedInstant = new Date(parsed);
      return;
    }

    throw new Error(`Unsupported type passed to Clock.setFixed: ${typeof instantOrDate}`);
  }

  /**
   * Restores clock to live system time.
   */
  function restore() {
    _fixedInstant = null;
  }

  /**
   * Checks whether clock is currently fixed.
   * @returns {boolean}
   */
  function isFixed() {
    return _fixedInstant !== null;
  }

  /**
   * Derives a fully consistent planning context from options.
   * Guarantees that currentDate and currentTime are ALWAYS derived
   * from the same instant and never mixes an explicit date with a system clock time.
   *
   * @param {Object} [options]
   * @param {Date|string|number} [options.currentInstant]
   * @param {string} [options.currentDate]
   * @param {string} [options.currentTime]
   * @returns {{ currentInstant: Date, currentDate: string, currentTime: string, timezone: string }}
   */
  function getPlanningContext(options = {}) {
    // Case 1: Explicit instant provided
    if (options.currentInstant) {
      const inst = (options.currentInstant instanceof Date)
        ? new Date(options.currentInstant.getTime())
        : new Date(options.currentInstant);
      return {
        currentInstant: inst,
        currentDate: AppDate.getTodayAppDate(inst),
        currentTime: AppDate.getCurrentAppTime(inst),
        timezone: TIMEZONE
      };
    }

    // Case 2: Both currentDate and currentTime provided explicitly
    if (options.currentDate && options.currentTime) {
      const inst = new Date(`${options.currentDate}T${options.currentTime}:00+07:00`);
      return {
        currentInstant: inst,
        currentDate: options.currentDate,
        currentTime: options.currentTime,
        timezone: TIMEZONE
      };
    }

    // Case 3: Only currentDate provided -> Prevent half-injected clock bug!
    if (options.currentDate && !options.currentTime) {
      // If Clock is fixed to this same date, use Clock's time.
      // Otherwise, use a deterministic morning baseline ('08:00') for the day.
      const currentClockDate = today();
      const derivedTime = (currentClockDate === options.currentDate)
        ? getCurrentAppTime()
        : '08:00';
      const inst = new Date(`${options.currentDate}T${derivedTime}:00+07:00`);
      return {
        currentInstant: inst,
        currentDate: options.currentDate,
        currentTime: derivedTime,
        timezone: TIMEZONE
      };
    }

    // Case 4: Only currentTime provided
    if (!options.currentDate && options.currentTime) {
      const d = today();
      const inst = new Date(`${d}T${options.currentTime}:00+07:00`);
      return {
        currentInstant: inst,
        currentDate: d,
        currentTime: options.currentTime,
        timezone: TIMEZONE
      };
    }

    // Case 5: Neither provided -> Use Clock instant
    const inst = now();
    return {
      currentInstant: inst,
      currentDate: today(),
      currentTime: getCurrentAppTime(),
      timezone: TIMEZONE
    };
  }

  return {
    TIMEZONE,
    now,
    today,
    getCurrentAppTime,
    getTimezone,
    setFixed,
    restore,
    isFixed,
    getPlanningContext
  };
}));
