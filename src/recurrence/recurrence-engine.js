'use strict';

/**
 * P0.5 Recurrence Engine
 *
 * Implements a bounded, timezone-deterministic recurrence expansion model
 * for Vietnam time (Asia/Ho_Chi_Minh / UTC+7).
 *
 * Architecture Principles:
 * 1. Bounded expansion only (requires rangeStart and rangeEnd; never infinite).
 * 2. Supported patterns:
 *    - WEEKLY (every Monday, every Tue/Thu, every weekday, interval: 1, 2, 3 weeks)
 *    - DAILY (every day, every N days)
 *    - MONTHLY (same day of month, e.g. 15th of each month)
 *    - End conditions: count, untilDate
 * 3. First-class Exceptions:
 *    - 'skip': drops an occurrence date.
 *    - 'modify': alters start/end time or title for a specific occurrence date.
 * 4. UMD Pattern: Runs identically in Node.js (CommonJS / Jest) and browser (window.RecurrenceEngine).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    module.exports = factory(AppDate);
  } else {
    root.RecurrenceEngine = factory(root.AppDate);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (AppDate) {

  const RecurrenceFrequency = Object.freeze({
    DAILY: 'DAILY',
    WEEKLY: 'WEEKLY',
    MONTHLY: 'MONTHLY'
  });

  const ExceptionType = Object.freeze({
    SKIP: 'skip',
    MODIFY: 'modify'
  });

  /**
   * Validates a recurrence definition.
   *
   * @param {Object} rule
   * @returns {{ valid: boolean, error?: string }}
   */
  function validateRecurrenceRule(rule) {
    if (!rule) return { valid: false, error: 'Rule object is required' };
    if (!rule.frequency || !RecurrenceFrequency[rule.frequency]) {
      return { valid: false, error: `Invalid frequency: ${rule.frequency}` };
    }

    const interval = rule.interval !== undefined ? Number(rule.interval) : 1;
    if (!Number.isInteger(interval) || interval < 1 || interval > 52) {
      return { valid: false, error: `Interval must be integer between 1 and 52: ${rule.interval}` };
    }

    if (rule.frequency === RecurrenceFrequency.WEEKLY) {
      if (rule.daysOfWeek !== undefined) {
        if (!Array.isArray(rule.daysOfWeek) || !rule.daysOfWeek.length) {
          return { valid: false, error: 'daysOfWeek must be a non-empty array of integers (0-6)' };
        }
        for (const day of rule.daysOfWeek) {
          if (!Number.isInteger(day) || day < 0 || day > 6) {
            return { valid: false, error: `Invalid day of week: ${day} (must be 0-6)` };
          }
        }
      }
    }

    if (rule.untilDate && AppDate) {
      const parsedUntil = AppDate.parseAppDate(rule.untilDate);
      if (!parsedUntil) {
        return { valid: false, error: `Invalid untilDate format: ${rule.untilDate}` };
      }
    }

    return { valid: true };
  }

  /**
   * Expands occurrences for a recurring event within a bounded date window [rangeStart, rangeEnd].
   *
   * @param {Object} event - The recurring event definition
   * @param {string} event.id
   * @param {string} event.title
   * @param {string} [event.startDate] - First occurrence date 'YYYY-MM-DD'
   * @param {string} [event.start] - 'HH:mm'
   * @param {string} [event.end] - 'HH:mm'
   * @param {number} [event.day] - Legacy single weekday (0-6)
   * @param {Object} [event.recurrence] - Modern recurrence rule
   * @param {string} [event.recurrence.frequency='WEEKLY']
   * @param {number} [event.recurrence.interval=1]
   * @param {number[]} [event.recurrence.daysOfWeek]
   * @param {string} [event.recurrence.untilDate]
   * @param {number} [event.recurrence.count]
   * @param {Array<{ occurrenceDate: string, type: string, override?: Object }>} [event.exceptions=[]]
   * @param {string} rangeStart - Window start 'YYYY-MM-DD'
   * @param {string} rangeEnd - Window end 'YYYY-MM-DD'
   * @returns {Array<Object>} Bounded occurrence instances
   */
  function expandOccurrences(event, rangeStart, rangeEnd) {
    if (!event || !rangeStart || !rangeEnd || !AppDate) return [];

    const validStart = AppDate.parseAppDate(rangeStart);
    const validEnd = AppDate.parseAppDate(rangeEnd);
    if (!validStart || !validEnd || validStart > validEnd) return [];

    // Max boundary safety guard: prevent DOS from arbitrarily large ranges (max 366 days)
    const spanDays = AppDate.diffAppCalendarDays(validEnd, validStart);
    if (spanDays > 366) {
      throw new Error(`Expansion window exceeds maximum limit of 366 days (${spanDays} days requested)`);
    }

    // Build or normalize rule
    let rule = event.recurrence;
    let eventStart = event.startDate;

    if (!rule) {
      // Legacy fixed schedule compatibility: weekday (0-6)
      const numDay = (event.day !== undefined && event.day !== null && event.day !== '') ? Number(event.day) : NaN;
      const normalizedDay = numDay === 7 ? 0 : numDay;
      if (!isNaN(normalizedDay) && Number.isInteger(normalizedDay) && normalizedDay >= 0 && normalizedDay <= 6) {
        rule = {
          frequency: RecurrenceFrequency.WEEKLY,
          interval: 1,
          daysOfWeek: [normalizedDay]
        };
        eventStart = eventStart || rangeStart;
      } else {
        // Non-recurring single event
        if (event.startDate && event.startDate >= validStart && event.startDate <= validEnd) {
          return [{
            id: `${event.id}:${event.startDate}`,
            seriesId: event.id,
            occurrenceDate: event.startDate,
            title: event.title,
            start: event.start,
            end: event.end,
            type: event.type || 'study',
            flexible: Boolean(event.flexible)
          }];
        }
        return [];
      }
    }

    const validation = validateRecurrenceRule(rule);
    if (!validation.valid) {
      console.warn(`Invalid recurrence rule for event ${event.id}:`, validation.error);
      return [];
    }

    // Index exceptions by occurrenceDate
    const exceptionsMap = new Map();
    if (Array.isArray(event.exceptions)) {
      for (const exc of event.exceptions) {
        if (exc && exc.occurrenceDate) {
          exceptionsMap.set(exc.occurrenceDate, exc);
        }
      }
    }

    const occurrences = [];
    const freq = rule.frequency;
    const interval = Math.max(1, Number(rule.interval || 1));
    const untilDate = rule.untilDate ? AppDate.parseAppDate(rule.untilDate) : null;
    const maxCount = rule.count ? Number(rule.count) : Infinity;

    // Determine starting date for iteration
    const effectiveSeriesStart = eventStart ? AppDate.parseAppDate(eventStart) : validStart;
    let currDate = effectiveSeriesStart < validStart && freq === RecurrenceFrequency.WEEKLY
      ? validStart
      : effectiveSeriesStart;

    // If series start is after window, nothing to expand
    if (effectiveSeriesStart > validEnd) return [];

    let countTracker = 0;

    // Daily Expansion
    if (freq === RecurrenceFrequency.DAILY) {
      let iterDate = effectiveSeriesStart;
      while (iterDate <= validEnd && countTracker < maxCount) {
        if (untilDate && iterDate > untilDate) break;

        if (iterDate >= validStart) {
          countTracker++;
          const exc = exceptionsMap.get(iterDate);
          if (!exc || exc.type !== ExceptionType.SKIP) {
            const override = (exc && exc.type === ExceptionType.MODIFY && exc.override) || {};
            occurrences.push({
              id: `${event.id}:${iterDate}`,
              seriesId: event.id,
              occurrenceDate: iterDate,
              title: override.title || event.title,
              start: override.start || event.start,
              end: override.end || event.end,
              type: event.type || 'study',
              flexible: override.flexible !== undefined ? override.flexible : Boolean(event.flexible),
              isModifiedOccurrence: Boolean(exc && exc.type === ExceptionType.MODIFY)
            });
          }
        } else {
          countTracker++;
        }
        iterDate = AppDate.addAppDays(iterDate, interval);
      }
    }

    // Weekly Expansion
    else if (freq === RecurrenceFrequency.WEEKLY) {
      const activeDays = Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length
        ? rule.daysOfWeek
        : [AppDate.getAppDayOfWeek(effectiveSeriesStart)];

      // Scan each day in the bounding window
      let iterDate = validStart;
      while (iterDate <= validEnd) {
        if (untilDate && iterDate > untilDate) break;

        if (iterDate >= effectiveSeriesStart) {
          const weekday = AppDate.getAppDayOfWeek(iterDate);
          if (activeDays.includes(weekday)) {
            // Check interval (weeks elapsed from series start)
            const daysDiff = AppDate.diffAppCalendarDays(iterDate, effectiveSeriesStart);
            const weeksDiff = Math.floor(daysDiff / 7);

            if (interval === 1 || (weeksDiff >= 0 && weeksDiff % interval === 0)) {
              countTracker++;
              if (countTracker <= maxCount) {
                const exc = exceptionsMap.get(iterDate);
                if (!exc || exc.type !== ExceptionType.SKIP) {
                  const override = (exc && exc.type === ExceptionType.MODIFY && exc.override) || {};
                  occurrences.push({
                    id: `${event.id}:${iterDate}`,
                    seriesId: event.id,
                    occurrenceDate: iterDate,
                    day: weekday,
                    title: override.title || event.title,
                    start: override.start || event.start,
                    end: override.end || event.end,
                    type: event.type || 'school',
                    flexible: override.flexible !== undefined ? override.flexible : Boolean(event.flexible),
                    isModifiedOccurrence: Boolean(exc && exc.type === ExceptionType.MODIFY)
                  });
                }
              }
            }
          }
        }
        iterDate = AppDate.addAppDays(iterDate, 1);
      }
    }

    // Monthly Expansion
    else if (freq === RecurrenceFrequency.MONTHLY) {
      const [startY, startM, startD] = effectiveSeriesStart.split('-').map(Number);
      const [winEndY, winEndM] = validEnd.split('-').map(Number);

      let currY = startY;
      let currM = startM; // 1-12

      while (currY < winEndY || (currY === winEndY && currM <= winEndM)) {
        if (countTracker >= maxCount) break;

        // Check if day exists in target month (e.g. 31st in Feb falls back or skips)
        const daysInTargetMonth = new Date(Date.UTC(currY, currM, 0)).getUTCDate();
        const actualD = Math.min(startD, daysInTargetMonth);
        const iterDate = `${currY}-${String(currM).padStart(2, '0')}-${String(actualD).padStart(2, '0')}`;

        if (untilDate && iterDate > untilDate) break;

        if (iterDate >= effectiveSeriesStart) {
          countTracker++;
          if (iterDate >= validStart && iterDate <= validEnd) {
            const exc = exceptionsMap.get(iterDate);
            if (!exc || exc.type !== ExceptionType.SKIP) {
              const override = (exc && exc.type === ExceptionType.MODIFY && exc.override) || {};
              occurrences.push({
                id: `${event.id}:${iterDate}`,
                seriesId: event.id,
                occurrenceDate: iterDate,
                day: AppDate.getAppDayOfWeek(iterDate),
                title: override.title || event.title,
                start: override.start || event.start,
                end: override.end || event.end,
                type: event.type || 'personal',
                flexible: override.flexible !== undefined ? override.flexible : Boolean(event.flexible),
                isModifiedOccurrence: Boolean(exc && exc.type === ExceptionType.MODIFY)
              });
            }
          }
        }

        // Advance by interval months
        currM += interval;
        while (currM > 12) {
          currM -= 12;
          currY += 1;
        }
      }
    }

    return occurrences;
  }

  /**
   * Adds a skip exception for a specific occurrence date.
   *
   * @param {Object} event - The series event
   * @param {string} occurrenceDate - 'YYYY-MM-DD'
   * @returns {Object} Updated event
   */
  function addSkipException(event, occurrenceDate) {
    if (!event || !occurrenceDate) return event;
    const updated = { ...event };
    updated.exceptions = Array.isArray(updated.exceptions) ? [...updated.exceptions] : [];

    // Replace or add skip
    const idx = updated.exceptions.findIndex(e => e.occurrenceDate === occurrenceDate);
    const newExc = { occurrenceDate, type: ExceptionType.SKIP };
    if (idx >= 0) {
      updated.exceptions[idx] = newExc;
    } else {
      updated.exceptions.push(newExc);
    }
    return updated;
  }

  /**
   * Adds or updates a modify exception for a specific occurrence date.
   *
   * @param {Object} event - The series event
   * @param {string} occurrenceDate - 'YYYY-MM-DD'
   * @param {Object} override - { start, end, title, flexible }
   * @returns {Object} Updated event
   */
  function addModifyException(event, occurrenceDate, override = {}) {
    if (!event || !occurrenceDate) return event;
    const updated = { ...event };
    updated.exceptions = Array.isArray(updated.exceptions) ? [...updated.exceptions] : [];

    const idx = updated.exceptions.findIndex(e => e.occurrenceDate === occurrenceDate);
    const newExc = { occurrenceDate, type: ExceptionType.MODIFY, override };
    if (idx >= 0) {
      updated.exceptions[idx] = newExc;
    } else {
      updated.exceptions.push(newExc);
    }
    return updated;
  }

  return {
    RecurrenceFrequency,
    ExceptionType,
    validateRecurrenceRule,
    expandOccurrences,
    addSkipException,
    addModifyException
  };
}));
