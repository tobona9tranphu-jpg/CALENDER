'use strict';

/**
 * @file capacity-engine.js
 * Deterministic Capacity Intelligence Engine (Product Phase P1.3).
 *
 * Computes deterministic daily capacity:
 * {
 *   date: string,
 *   availableMinutes: number,
 *   remainingAvailableMinutes: number,
 *   scheduledMinutes: number,
 *   taskMinutes: number,
 *   freeMinutes: number,
 *   remainingFreeMinutes: number,
 *   overloadMinutes: number,
 *   utilization: number,
 *   isOverloaded: boolean,
 *   blocks: { fixed, school, study, tasks, gaps }
 * }
 *
 * Rules:
 * - Distinguishes fixed events, school timetable, study sessions, tasks, and breaks.
 * - Respects user availability window (start to end), active days, and quiet hours.
 * - Never assumes unallocated time outside availability is usable.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    module.exports = factory(AppDate);
  } else {
    root.CapacityEngine = factory(root.AppDate);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (DateUtil) {

  function minFromTime(t) {
    if (DateUtil && typeof DateUtil.minFromTime === 'function') return DateUtil.minFromTime(t);
    const parts = (t || '0:0').split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }

  function timeFromMin(m) {
    if (DateUtil && typeof DateUtil.timeFromMin === 'function') return DateUtil.timeFromMin(m);
    const h = String(Math.floor(m / 60) % 24).padStart(2, '0');
    const min = String(m % 60).padStart(2, '0');
    return h + ':' + min;
  }

  function getAppDayOfWeek(dateStr) {
    if (DateUtil && typeof DateUtil.getAppDayOfWeek === 'function') return DateUtil.getAppDayOfWeek(dateStr);
    return new Date(dateStr + 'T00:00:00').getDay();
  }

  /**
   * Merges an array of [startMin, endMin] intervals to avoid double-counting.
   */
  function mergeIntervals(intervals) {
    if (!intervals.length) return [];
    const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = merged[merged.length - 1];
      const cur = sorted[i];
      if (cur[0] <= prev[1]) {
        prev[1] = Math.max(prev[1], cur[1]);
      } else {
        merged.push(cur);
      }
    }
    return merged;
  }

  /**
   * Analyzes daily capacity deterministically for a single date.
   *
   * @param {string} date - Date string 'YYYY-MM-DD'
   * @param {Object} context - Standardized planning context
   * @param {Object} [options]
   * @param {number} [options.maxDailyWorkMinutes=300]
   * @param {string} [options.currentTime] - Current wall clock time 'HH:mm'
   * @returns {Object} Capacity analysis report
   */
  function analyzeCapacity(date, context = {}, options = {}) {
    const maxDayWork = options.maxDailyWorkMinutes !== undefined ? options.maxDailyWorkMinutes : 300;
    const isToday = date === (context.currentDate || (DateUtil && DateUtil.getTodayAppDate ? DateUtil.getTodayAppDate() : ''));
    const curTime = options.currentTime || (isToday ? context.currentTime : null);
    const curTimeMin = curTime ? minFromTime(curTime) : null;

    const avail = context.availability || { start: '15:00', end: '21:30', days: [1, 2, 3, 4, 5, 6, 0] };
    const availStartMin = minFromTime(avail.start || '15:00');
    const availEndMin = minFromTime(avail.end || '21:30');

    // Day of week check
    const dayOfWeek = getAppDayOfWeek(date);
    const activeDays = Array.isArray(avail.days) ? avail.days : [1, 2, 3, 4, 5, 6, 0];
    const isAvailableDay = activeDays.includes(dayOfWeek);

    const totalWindowMinutes = isAvailableDay ? Math.max(0, availEndMin - availStartMin) : 0;
    const usableStartMin = (isToday && curTimeMin !== null)
      ? Math.max(availStartMin, curTimeMin)
      : availStartMin;
    const remainingWindowMinutes = (isAvailableDay && availEndMin > usableStartMin)
      ? availEndMin - usableStartMin
      : 0;

    // Fixed Events
    const rawFixed = (context.fixedEvents || []).filter(e => e && e.date === date);
    const fixedBlocks = [];
    const schoolBlocks = [];
    const studyBlocks = [];

    rawFixed.forEach(fe => {
      const s = minFromTime(fe.start);
      const e = minFromTime(fe.end);
      const item = {
        id: fe.id,
        title: fe.title,
        type: fe.type || 'activity',
        start: fe.start,
        end: fe.end,
        startMin: s,
        endMin: e,
        durationMinutes: Math.max(0, e - s)
      };
      fixedBlocks.push(item);
      if (fe.type === 'school') {
        schoolBlocks.push(item);
      } else if (fe.type === 'tutoring' || fe.type === 'study') {
        studyBlocks.push(item);
      }
    });

    // Scheduled Tasks
    const rawTasks = (context.scheduledTasks || []).filter(t => t && (t.scheduledDate === date || t.date === date));
    const taskBlocks = [];
    let taskMinutes = 0;

    rawTasks.forEach(t => {
      if (t.status === 'done') return;
      const dur = Number(t.durationMinutes || t.minutes || 45);
      taskMinutes += dur;

      let sMin = null;
      let eMin = null;
      if (t.startTime) {
        sMin = minFromTime(t.startTime);
        eMin = t.endTime ? minFromTime(t.endTime) : sMin + dur;
      }

      taskBlocks.push({
        id: t.id,
        title: t.title,
        priority: t.priority || 3,
        durationMinutes: dur,
        startTime: t.startTime || null,
        endTime: t.endTime || (sMin !== null ? timeFromMin(eMin) : null),
        startMin: sMin,
        endMin: eMin,
        status: t.status || 'open',
        deadline: t.deadline || null
      });
    });

    // Compute occupied intervals within the availability window
    const occupiedIntervals = [];

    // Add fixed events inside availability
    fixedBlocks.forEach(fb => {
      const oStart = Math.max(fb.startMin, availStartMin);
      const oEnd = Math.min(fb.endMin, availEndMin);
      if (oEnd > oStart) {
        occupiedIntervals.push([oStart, oEnd]);
      }
    });

    // Add timed tasks inside availability
    taskBlocks.forEach(tb => {
      if (tb.startMin !== null && tb.endMin !== null) {
        const oStart = Math.max(tb.startMin, availStartMin);
        const oEnd = Math.min(tb.endMin, availEndMin);
        if (oEnd > oStart) {
          occupiedIntervals.push([oStart, oEnd]);
        }
      }
    });

    const mergedOccupied = mergeIntervals(occupiedIntervals);
    let occupiedWithinAvailMinutes = 0;
    mergedOccupied.forEach(int => {
      occupiedWithinAvailMinutes += (int[1] - int[0]);
    });

    // Add untimed tasks to occupied total (they will need to fit within availability)
    let untimedTaskMinutes = 0;
    taskBlocks.forEach(tb => {
      if (tb.startMin === null) {
        untimedTaskMinutes += tb.durationMinutes;
      }
    });

    const totalOccupiedMinutes = occupiedWithinAvailMinutes + untimedTaskMinutes;

    // Remaining usable time
    const freeMinutes = Math.max(0, totalWindowMinutes - totalOccupiedMinutes);

    // Remaining usable time from now (for today)
    let occupiedFromNowMinutes = 0;
    mergedOccupied.forEach(int => {
      const oStart = Math.max(int[0], usableStartMin);
      const oEnd = Math.min(int[1], availEndMin);
      if (oEnd > oStart) {
        occupiedFromNowMinutes += (oEnd - oStart);
      }
    });
    const remainingFreeMinutes = Math.max(0, remainingWindowMinutes - occupiedFromNowMinutes - untimedTaskMinutes);

    let fixedWithinAvailMinutes = 0;
    mergeIntervals(fixedBlocks.map(fb => [Math.max(fb.startMin, availStartMin), Math.min(fb.endMin, availEndMin)]).filter(i => i[1] > i[0]))
      .forEach(int => { fixedWithinAvailMinutes += (int[1] - int[0]); });

    const netAvailableForTasks = Math.max(0, totalWindowMinutes - fixedWithinAvailMinutes);

    // Overload calculation
    let overloadMinutes = 0;
    if (taskMinutes > netAvailableForTasks) {
      overloadMinutes += (taskMinutes - netAvailableForTasks);
    }
    if (totalOccupiedMinutes > totalWindowMinutes) {
      overloadMinutes = Math.max(overloadMinutes, totalOccupiedMinutes - totalWindowMinutes);
    }
    if (taskMinutes > maxDayWork) {
      overloadMinutes = Math.max(overloadMinutes, taskMinutes - maxDayWork);
    }

    const demandMinutes = Math.max(totalOccupiedMinutes, fixedWithinAvailMinutes + taskMinutes);
    const utilization = totalWindowMinutes > 0
      ? Math.round((demandMinutes / totalWindowMinutes) * 100) / 100
      : (demandMinutes > 0 ? 1.0 : 0.0);

    const isOverloaded = overloadMinutes > 0 || utilization > 0.95 || taskMinutes > maxDayWork;

    // Compute continuous free gaps
    const gaps = [];
    if (isAvailableDay && totalWindowMinutes > 0) {
      let cursor = usableStartMin;
      for (const int of mergedOccupied) {
        if (int[1] <= cursor) continue;
        if (int[0] > cursor) {
          const gapDur = int[0] - cursor;
          if (gapDur >= 15) {
            gaps.push({
              start: timeFromMin(cursor),
              end: timeFromMin(int[0]),
              startMin: cursor,
              endMin: int[0],
              durationMinutes: gapDur
            });
          }
        }
        cursor = Math.max(cursor, int[1]);
      }
      if (availEndMin - cursor >= 15) {
        gaps.push({
          start: timeFromMin(cursor),
          end: timeFromMin(availEndMin),
          startMin: cursor,
          endMin: availEndMin,
          durationMinutes: availEndMin - cursor
        });
      }
    }

    // Total scheduled minutes on that day (including outside availability)
    let allScheduledMinutes = 0;
    fixedBlocks.forEach(fb => { allScheduledMinutes += fb.durationMinutes; });
    taskBlocks.forEach(tb => { allScheduledMinutes += tb.durationMinutes; });

    return {
      date,
      availableMinutes: totalWindowMinutes,
      remainingAvailableMinutes: remainingWindowMinutes,
      scheduledMinutes: allScheduledMinutes,
      taskMinutes,
      freeMinutes,
      remainingFreeMinutes,
      overloadMinutes,
      utilization,
      isOverloaded,
      blocks: {
        fixed: fixedBlocks,
        school: schoolBlocks,
        study: studyBlocks,
        tasks: taskBlocks,
        gaps
      }
    };
  }

  return {
    analyzeCapacity,
    _minFromTime: minFromTime,
    _timeFromMin: timeFromMin,
    _mergeIntervals: mergeIntervals
  };
}));
