'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    const exportsObj = factory(AppDate);
    exportsObj.TodayEngine = exportsObj;
    module.exports = exportsObj;
  } else {
    root.TodayEngine = factory(root.AppDate);
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

  function formatMinutes(m) {
    if (DateUtil && typeof DateUtil.formatMinutes === 'function') return DateUtil.formatMinutes(m);
    const h = Math.floor(m / 60);
    const min = m % 60;
    return h + 'h ' + String(min).padStart(2, '0') + 'm';
  }

  /**
   * 1. calculateNextEvent
   * Supports both positional: (nowOrMinutes, fixedEvents, scheduledTasks)
   * and object: ({ fixedEvents, scheduledTasks, currentMinutes })
   */
  function calculateNextEvent(arg1, arg2, arg3) {
    let fixedEvents = [];
    let scheduledTasks = [];
    let currentMinutes = 0;

    if (arg1 && typeof arg1 === 'object' && !(arg1 instanceof Date) && (arg1.fixedEvents || arg1.scheduledTasks || arg1.currentMinutes !== undefined)) {
      fixedEvents = arg1.fixedEvents || [];
      scheduledTasks = arg1.scheduledTasks || [];
      currentMinutes = arg1.currentMinutes !== undefined ? arg1.currentMinutes : 0;
    } else {
      if (arg1 instanceof Date) {
        currentMinutes = arg1.getHours() * 60 + arg1.getMinutes();
      } else if (typeof arg1 === 'number') {
        currentMinutes = arg1;
      }
      fixedEvents = arg2 || [];
      scheduledTasks = arg3 || [];
    }

    const all = [];

    for (const f of fixedEvents) {
      if (!f || !f.start) continue;
      const startMin = minFromTime(f.start);
      const endMin = f.end ? minFromTime(f.end) : startMin + (f.minutes || 45);
      all.push({
        ...f,
        isFixed: true,
        type: f.type || 'fixed',
        startMin,
        endMin
      });
    }

    for (const t of scheduledTasks) {
      if (!t || !t.start || t.status === 'done') continue;
      const startMin = minFromTime(t.start);
      const endMin = t.end ? minFromTime(t.end) : startMin + (t.minutes || 45);
      all.push({
        ...t,
        isFixed: false,
        type: 'task',
        startMin,
        endMin
      });
    }

    if (!all.length) {
      return null;
    }

    all.sort((a, b) => a.startMin - b.startMin);

    // 1. Active current event
    const current = all.find(e => currentMinutes >= e.startMin && currentMinutes < e.endMin);
    if (current) {
      return {
        ...current,
        title: current.title,
        start: current.start,
        end: current.end,
        status: 'active',
        state: 'CURRENT',
        minutesUntil: 0,
        minutesRemaining: current.endMin - currentMinutes
      };
    }

    // 2. Earliest upcoming event
    const upcoming = all.find(e => e.startMin > currentMinutes);
    if (upcoming) {
      return {
        ...upcoming,
        title: upcoming.title,
        start: upcoming.start,
        end: upcoming.end,
        status: 'upcoming',
        state: 'UPCOMING',
        minutesUntil: upcoming.startMin - currentMinutes,
        minutesRemaining: 0
      };
    }

    // 3. Clear
    return null;
  }

  /**
   * 2. calculateDailyProgress
   * Supports both: (allTodayTasks, doneTodayTasks)
   * and: ({ completedSessions, todayTasks })
   */
  function calculateDailyProgress(arg1, arg2) {
    if (Array.isArray(arg1)) {
      const allTasks = arg1 || [];
      const doneTasks = arg2 || [];
      const totalCount = allTasks.length;
      const completedCount = doneTasks.length;
      const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
      return {
        percent,
        percentage: percent,
        totalCount,
        completedCount,
        remainingCount: Math.max(0, totalCount - completedCount)
      };
    }

    const { completedSessions = [], todayTasks = [] } = arg1 || {};
    const completedSet = new Set();
    const allSet = new Set();

    for (const s of completedSessions) {
      if (s && s.status === 'complete') {
        const id = s.taskId ? ('task-' + s.taskId) : ('session-' + s.id);
        completedSet.add(id);
        allSet.add(id);
      }
    }

    for (const t of todayTasks) {
      if (!t || !t.id) continue;
      const key = 'task-' + t.id;
      allSet.add(key);
      if (t.status === 'done') {
        completedSet.add(key);
      }
    }

    const totalCount = allSet.size;
    const completedCount = completedSet.size;
    const remainingCount = Math.max(0, totalCount - completedCount);
    const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    return {
      percent,
      percentage: percent,
      completedCount,
      totalCount,
      remainingCount
    };
  }

  /**
   * 3. calculateFreeTime
   * Supports both: (availability, fixedEvents, scheduledTasks, nowOrCurrentMinutes)
   * and: ({ availability, busySegments, currentMinutes, isAvailableDay })
   */
  function calculateFreeTime(arg1, arg2, arg3, arg4) {
    let availability = { start: '15:00', end: '21:00' };
    let busyList = [];
    let currentMinutes = 0;
    let isAvailableDay = true;

    if (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) && (arg1.busySegments || arg1.currentMinutes !== undefined || arg1.isAvailableDay !== undefined)) {
      availability = arg1.availability || availability;
      busyList = arg1.busySegments || [];
      currentMinutes = arg1.currentMinutes !== undefined ? arg1.currentMinutes : 0;
      isAvailableDay = arg1.isAvailableDay !== undefined ? arg1.isAvailableDay : true;
    } else {
      availability = arg1 || availability;
      const fixed = arg2 || [];
      const tasks = arg3 || [];
      busyList = [...fixed, ...tasks];
      if (arg4 instanceof Date) {
        currentMinutes = arg4.getHours() * 60 + arg4.getMinutes();
      } else if (typeof arg4 === 'number') {
        currentMinutes = arg4;
      }
    }

    if (!isAvailableDay) return 0;

    const availStart = minFromTime(availability.start || '15:00');
    const availEnd = minFromTime(availability.end || '21:00');

    if (availEnd <= availStart) return 0;

    const windowStart = Math.max(availStart, currentMinutes);
    if (windowStart >= availEnd) return 0;

    const rawIntervals = [];
    for (const b of busyList) {
      if (!b || !b.start) continue;
      const s = minFromTime(b.start);
      const e = b.end ? minFromTime(b.end) : s + (b.minutes || 45);
      if (e <= s) continue;
      const clippedStart = Math.max(s, windowStart);
      const clippedEnd = Math.min(e, availEnd);
      if (clippedEnd > clippedStart) {
        rawIntervals.push({ start: clippedStart, end: clippedEnd });
      }
    }

    rawIntervals.sort((a, b) => a.start - b.start);

    const merged = [];
    for (const interval of rawIntervals) {
      if (!merged.length) {
        merged.push(interval);
      } else {
        const last = merged[merged.length - 1];
        if (interval.start <= last.end) {
          last.end = Math.max(last.end, interval.end);
        } else {
          merged.push(interval);
        }
      }
    }

    let busyTotal = 0;
    for (const m of merged) {
      busyTotal += (m.end - m.start);
    }

    const freeMinutes = Math.max(0, (availEnd - windowStart) - busyTotal);
    return freeMinutes;
  }

  /**
   * 4. recommendNextAction
   * Supports both: (tasks, freeMinutes, fixedEvents, todayDate)
   * and: ({ tasks, freeSegments, nextFixedEvent, todayDate })
   */
  function recommendNextAction(arg1, arg2, arg3, arg4) {
    let tasks = [];
    let freeCap = 120;
    let nextFixed = null;
    let todayDate = null;

    if (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) && arg1.tasks) {
      tasks = arg1.tasks || [];
      const firstSeg = (arg1.freeSegments && arg1.freeSegments[0]) ? arg1.freeSegments[0].duration : 120;
      freeCap = firstSeg;
      nextFixed = arg1.nextFixedEvent || null;
      todayDate = arg1.todayDate || null;
    } else {
      tasks = arg1 || [];
      freeCap = typeof arg2 === 'number' ? arg2 : 120;
      const fixed = arg3 || [];
      nextFixed = fixed[0] || null;
      todayDate = arg4 || null;
    }

    const unfinished = tasks.filter(t => t && t.status !== 'done');
    if (!unfinished.length) {
      return {
        recommended: null,
        task: null,
        rationale: 'Không còn nhiệm vụ mở. Bạn đã hoàn thành tất cả mục tiêu!',
        duration: 0,
        score: 0
      };
    }

    const scored = unfinished.map(task => {
      const minutes = Number(task.minutes || 45);
      const priority = Number(task.priority || 3);
      let baseScore = priority * 20;

      let deadlineBonus = 0;
      if (task.deadline && todayDate && DateUtil) {
        const diff = DateUtil.diffAppCalendarDays(task.deadline, todayDate);
        if (diff < 0) deadlineBonus = 40;
        else if (diff === 0) deadlineBonus = 35;
        else if (diff === 1) deadlineBonus = 20;
        else if (diff <= 3) deadlineBonus = 10;
      }

      let fitScore = 0;
      let fits = true;
      if (freeCap > 0) {
        if (minutes <= freeCap) {
          fitScore = 25;
        } else {
          fitScore = -30;
          fits = false;
        }
      }

      const totalScore = baseScore + deadlineBonus + fitScore;

      return {
        task,
        minutes,
        fits,
        baseScore,
        deadlineBonus,
        fitScore,
        totalScore
      };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);
    const top = scored[0];
    if (!top) {
      return { recommended: null, task: null, rationale: 'Chưa có nhiệm vụ phù hợp.', duration: 0, score: 0 };
    }

    const reasons = [];
    if (top.deadlineBonus >= 35) reasons.push('hạn chót hôm nay');
    else if (top.deadlineBonus >= 20) reasons.push('hạn chót ngày mai');
    else if (top.deadlineBonus > 0) reasons.push('hạn chót sắp tới');

    if (top.baseScore >= 80) reasons.push('Ưu tiên cao nhất');
    else if (top.baseScore >= 60) reasons.push('ưu tiên cao');

    if (top.fits && freeCap > 0) {
      reasons.push('Phù hợp thời gian rảnh');
    }

    const rationale = reasons.length
      ? reasons.join(' · ')
      : 'Ưu tiên học tập hàng đầu';

    return {
      recommended: top.task,
      task: top.task,
      rationale,
      duration: top.minutes,
      score: top.totalScore
    };
  }

  /**
   * 5. getTimeGreeting
   * (dateOrMinutes, name)
   */
  function getTimeGreeting(dateOrMinutes = 0, name = '') {
    let minutes = 0;
    if (dateOrMinutes instanceof Date) {
      minutes = dateOrMinutes.getHours() * 60 + dateOrMinutes.getMinutes();
    } else if (typeof dateOrMinutes === 'number') {
      minutes = dateOrMinutes;
    }
    const trimmed = (name || '').trim();
    const nameSuffix = trimmed ? (', ' + trimmed) : '';

    if (minutes >= 240 && minutes < 720) {
      return 'Chào buổi sáng' + nameSuffix + ' ☀️';
    }
    if (minutes >= 720 && minutes < 1080) {
      return 'Chào buổi chiều' + nameSuffix + ' 🌤️';
    }
    if (minutes >= 1080 && minutes < 1320) {
      return 'Chào buổi tối' + nameSuffix + ' 🌙';
    }
    return 'Chào đêm muộn' + nameSuffix + ' ✦';
  }

  return {
    calculateNextEvent,
    calculateDailyProgress,
    calculateFreeTime,
    recommendNextAction,
    getTimeGreeting,
    minFromTime,
    timeFromMin,
    formatMinutes
  };
}));
