'use strict';

/**
 * @file schedule-drift.js
 * Deterministic Schedule Drift Analysis Engine.
 *
 * Compares current temporal reality (currentDate, currentTime) against
 * the user's planned schedule to identify:
 * - Completed tasks (sessions done)
 * - Overdue tasks (scheduled before today or deadline in past)
 * - Late tasks (scheduled today with start time in the past, unfinished)
 * - Remaining free availability today
 * - Total accumulated drift minutes
 *
 * Output is completely deterministic and explainable.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    module.exports = factory(AppDate);
  } else {
    root.ScheduleDrift = factory(root.AppDate);
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

  /**
   * Analyzes schedule drift given the planning context and optional current time overrides.
   *
   * @param {Object} context - Standard planning context
   * @param {Object} [options]
   * @param {string} [options.currentDate] - 'YYYY-MM-DD'
   * @param {string} [options.currentTime] - 'HH:mm'
   * @returns {Object} Drift report
   */
  function analyzeScheduleDrift(context = {}, options = {}) {
    const curDate = options.currentDate || context.currentDate || (DateUtil && DateUtil.getTodayAppDate ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10));

    let curTime = options.currentTime || context.currentTime;
    if (!curTime) {
      if (DateUtil && DateUtil.getNowVietnam) {
        const nowVn = DateUtil.getNowVietnam();
        curTime = `${String(nowVn.getHours()).padStart(2, '0')}:${String(nowVn.getMinutes()).padStart(2, '0')}`;
      } else {
        curTime = '08:00';
      }
    }

    const curTimeMin = minFromTime(curTime);
    const avail = context.availability || { start: '15:00', end: '21:30' };
    const availStartMin = minFromTime(avail.start || '15:00');
    const availEndMin = minFromTime(avail.end || '21:30');

    const scheduledTasks = context.scheduledTasks || [];
    const fixedEvents = context.fixedEvents || [];
    const deadlines = context.deadlines || [];

    const completedTasks = [];
    const overdueTasks = [];
    const lateTasks = [];
    const upcomingTasks = [];

    let totalDriftMinutes = 0;
    let unfinishedWorkloadMinutes = 0;

    for (const task of scheduledTasks) {
      if (!task) continue;
      const isDone = task.status === 'done' || task.isDone === true;
      const taskDate = task.scheduledDate || curDate;
      const taskStartStr = task.startTime || '08:00';
      const taskStartMin = minFromTime(taskStartStr);
      const duration = Number(task.durationMinutes || task.minutes || 30);

      if (isDone) {
        completedTasks.push({ ...task, status: 'completed' });
        continue;
      }

      // Past date -> overdue
      if (taskDate < curDate) {
        overdueTasks.push({
          ...task,
          reason: `Được xếp vào ngày cũ (${taskDate}) nhưng chưa hoàn thành`,
          minutesLate: duration
        });
        totalDriftMinutes += duration;
        unfinishedWorkloadMinutes += duration;
        continue;
      }

      // Today
      if (taskDate === curDate) {
        // Start time has already elapsed
        if (taskStartMin < curTimeMin) {
          const minLate = curTimeMin - taskStartMin;
          lateTasks.push({
            ...task,
            reason: `Đã dự kiến bắt đầu lúc ${taskStartStr}, hiện tại là ${curTime} (trễ ${minLate} phút)`,
            minutesLate: minLate,
            scheduledStart: taskStartStr,
            duration
          });
          totalDriftMinutes += minLate;
          unfinishedWorkloadMinutes += duration;
        } else {
          upcomingTasks.push({
            ...task,
            scheduledStart: taskStartStr,
            duration
          });
          unfinishedWorkloadMinutes += duration;
        }
      } else {
        // Future date
        upcomingTasks.push(task);
      }
    }

    // Remaining Fixed Events today (ending after current time)
    const remainingFixedEvents = fixedEvents.filter(fe => {
      if (fe.date !== curDate) return false;
      const feEndMin = minFromTime(fe.end || fe.start);
      return feEndMin > curTimeMin;
    });

    // Calculate Remaining Free Availability today
    // Effective window from max(curTimeMin, availStartMin) to availEndMin
    const windowStartMin = Math.max(curTimeMin, availStartMin);
    let remainingAvailMins = Math.max(0, availEndMin - windowStartMin);

    // Subtract remaining fixed event durations within this window
    for (const fe of remainingFixedEvents) {
      const s = Math.max(minFromTime(fe.start), windowStartMin);
      const e = Math.min(minFromTime(fe.end), availEndMin);
      if (e > s) {
        remainingAvailMins = Math.max(0, remainingAvailMins - (e - s));
      }
    }

    const hasDrift = lateTasks.length > 0 || overdueTasks.length > 0 || totalDriftMinutes > 15;

    // Build human-friendly Vietnamese summary
    let summary = 'Lịch trình hôm nay đang đúng tiến độ.';
    if (lateTasks.length > 0 && overdueTasks.length > 0) {
      summary = `⚠️ Có ${lateTasks.length} việc bị trễ giờ và ${overdueTasks.length} việc quá hạn từ ngày trước.`;
    } else if (lateTasks.length > 0) {
      const firstLate = lateTasks[0];
      summary = `⚠️ "${firstLate.title}" đã quá giờ bắt đầu (${firstLate.scheduledStart}) và cần được xếp lại.`;
    } else if (overdueTasks.length > 0) {
      summary = `⚠️ Có ${overdueTasks.length} việc từ ngày trước chưa hoàn thành.`;
    }

    return {
      hasDrift,
      currentDate: curDate,
      currentTime: curTime,
      driftMinutes: totalDriftMinutes,
      unfinishedWorkloadMinutes,
      remainingAvailabilityMinutes: remainingAvailMins,
      completedTasks,
      overdueTasks,
      lateTasks,
      upcomingTasks,
      remainingFixedEvents,
      remainingDeadlines: deadlines,
      summary
    };
  }

  return {
    analyzeScheduleDrift,
    _minFromTime: minFromTime,
    _timeFromMin: timeFromMin
  };
}));
