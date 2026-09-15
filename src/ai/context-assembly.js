'use strict';

/**
 * @file context-assembly.js
 * Intent-Tailored Context Assembly for P1.5 AI Assistant.
 *
 * Core Principles:
 * - Gathers ONLY what each intent actually needs (zero database bloat).
 * - Sanitizes fields: whitelists only schedule-relevant attributes.
 * - Computes deterministic context revision hashes.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    const CapacityEngine = require('./capacity-engine');
    const exportsObj = factory(AppDate, CapacityEngine);
    exportsObj.ContextAssembly = exportsObj;
    module.exports = exportsObj;
  } else {
    root.ContextAssembly = factory(root.AppDate, root.CapacityEngine);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (DateUtil, CapacityEngine) {

  function getToday() {
    return (DateUtil && DateUtil.getTodayAppDate) ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10);
  }

  function addDays(dateStr, n) {
    if (DateUtil && DateUtil.addAppDays) return DateUtil.addAppDays(dateStr, n);
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

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
   * Deterministic simple hash for context state revision.
   */
  function computeContextRevision(payload) {
    const str = JSON.stringify(payload || {});
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return 'rev-' + Math.abs(hash).toString(36) + '-' + str.length;
  }

  /**
   * Builds an intent-tailored planning context from the user record.
   *
   * @param {Object} user
   * @param {string} intentType
   * @param {Object} [options]
   * @returns {Object} Lean, sanitized context
   */
  function buildIntentContext(user, intentType, options = {}) {
    const today = options.currentDate || getToday();
    const curTime = options.currentTime || (DateUtil && DateUtil.getCurrentAppTime ? DateUtil.getCurrentAppTime() : new Date().toTimeString().slice(0, 5));
    const targetDate = options.targetDate || today;

    const baseAvail = (user && user.availability) || { start: '15:00', end: '21:30', days: [1, 2, 3, 4, 5, 6, 0] };
    const learnedPrefs = (user && user.settings && user.settings.learnedPreferences) || {};

    const allTasks = Array.isArray(user && user.tasks) ? user.tasks : [];
    const allFixed = Array.isArray(user && user.fixedSchedules) ? user.fixedSchedules : [];
    const allSessions = Array.isArray(user && user.sessions) ? user.sessions : [];
    const allMilestones = Array.isArray(user && user.examMilestones) ? user.examMilestones : [];
    const subjects = (user && user.subjects) || [];

    // Base sanitized context
    const baseContext = {
      currentDate: today,
      currentTime: curTime,
      targetDate,
      timezone: 'Asia/Ho_Chi_Minh',
      availability: {
        start: baseAvail.start || '15:00',
        end: baseAvail.end || '21:30',
        days: Array.isArray(baseAvail.days) ? baseAvail.days : [1, 2, 3, 4, 5, 6, 0]
      },
      learnedPreferences: learnedPrefs,
      subjects: subjects.map(s => ({ id: s.id, name: s.name, color: s.color || 'blue' }))
    };

    switch (intentType) {
      case 'capture_task': {
        // Minimal: Only existing tasks titles/deadlines for dedup & subjects
        return {
          ...baseContext,
          existingTaskTitles: allTasks.map(t => t.title),
          revision: computeContextRevision({ today, count: allTasks.length })
        };
      }

      case 'review_week': {
        // 7-day history window
        const sevenDaysAgo = addDays(today, -7);
        const pastWeekSessions = allSessions.filter(s => s.date >= sevenDaysAgo && s.date <= today);
        const pastWeekTasks = allTasks.filter(t => (t.scheduledDate && t.scheduledDate >= sevenDaysAgo && t.scheduledDate <= today) || (t.date && t.date >= sevenDaysAgo && t.date <= today));

        return {
          ...baseContext,
          startDate: sevenDaysAgo,
          endDate: today,
          sessions: pastWeekSessions,
          tasks: pastWeekTasks,
          revision: computeContextRevision({ sevenDaysAgo, today, sCount: pastWeekSessions.length, tCount: pastWeekTasks.length })
        };
      }

      case 'review_day': {
        // Today's execution data only
        const todayTasks = allTasks.filter(t => (t.scheduledDate === targetDate || t.date === targetDate));
        const todaySessions = allSessions.filter(s => s.date === targetDate);

        return {
          ...baseContext,
          date: targetDate,
          tasks: todayTasks,
          sessions: todaySessions,
          revision: computeContextRevision({ targetDate, tCount: todayTasks.length, sCount: todaySessions.length })
        };
      }

      case 'find_time': {
        // Slots on target date: availability, fixed on target date, timed tasks on target date
        const targetDow = new Date(targetDate + 'T00:00:00').getDay();
        const dateFixed = allFixed.filter(f => Number(f.day) === targetDow || f.date === targetDate);
        const dateTasks = allTasks.filter(t => (t.scheduledDate === targetDate || t.date === targetDate) && t.status !== 'done');

        return {
          ...baseContext,
          targetDate,
          fixedEvents: dateFixed.map(f => ({ id: f.id, title: f.title, date: targetDate, start: f.start, end: f.end })),
          scheduledTasks: dateTasks.map(t => ({ id: t.id, title: t.title, date: targetDate, scheduledDate: targetDate, startTime: t.startTime, endTime: t.endTime, durationMinutes: t.durationMinutes || 45 })),
          revision: computeContextRevision({ targetDate, fCount: dateFixed.length, tCount: dateTasks.length })
        };
      }

      case 'deadline_help': {
        // Tasks with active deadlines + upcoming exam milestones + upcoming 7 days capacity
        const activeDeadlines = allTasks.filter(t => t.deadline && t.status !== 'done');
        return {
          ...baseContext,
          deadlines: activeDeadlines.map(t => ({ id: t.id, title: t.title, deadline: t.deadline, priority: t.priority || 3, durationMinutes: t.durationMinutes || 60 })),
          examMilestones: allMilestones,
          scheduledTasks: allTasks.filter(t => t.status !== 'done'),
          fixedSchedules: allFixed,
          revision: computeContextRevision({ today, dCount: activeDeadlines.length, mCount: allMilestones.length })
        };
      }

      case 'explain_schedule': {
        // Target date breakdown
        const targetDow = new Date(targetDate + 'T00:00:00').getDay();
        const dateFixed = allFixed.filter(f => Number(f.day) === targetDow || f.date === targetDate);
        const dateTasks = allTasks.filter(t => (t.scheduledDate === targetDate || t.date === targetDate));
        const dateDeadlines = allTasks.filter(t => t.deadline === targetDate && t.status !== 'done');

        return {
          ...baseContext,
          targetDate,
          fixedEvents: dateFixed,
          scheduledTasks: dateTasks,
          deadlines: dateDeadlines,
          revision: computeContextRevision({ targetDate, fCount: dateFixed.length, tCount: dateTasks.length })
        };
      }

      case 'fix_day':
      case 'plan':
      case 'reschedule':
      default: {
        // Full daily context needed for scheduling & repair
        const targetDow = new Date(targetDate + 'T00:00:00').getDay();
        const dateFixed = allFixed.filter(f => Number(f.day) === targetDow || f.date === targetDate);
        const dateTasks = allTasks.filter(t => (t.scheduledDate === targetDate || t.date === targetDate || !t.scheduledDate));

        return {
          ...baseContext,
          targetDate,
          fixedEvents: dateFixed.map(f => ({
            id: f.id,
            title: f.title,
            start: f.start,
            end: f.end,
            fixed: true
          })),
          fixedSchedules: allFixed,
          scheduledTasks: dateTasks.map(t => ({
            id: t.id,
            title: t.title,
            subjectId: t.subjectId || null,
            scheduledDate: t.scheduledDate || targetDate,
            startTime: t.startTime || null,
            endTime: t.endTime || null,
            durationMinutes: Number(t.durationMinutes || t.minutes || 45),
            priority: t.priority || 3,
            deadline: t.deadline || null,
            status: t.status || 'planned',
            locked: Boolean(t.locked)
          })),
          examMilestones: allMilestones,
          revision: computeContextRevision({ targetDate, fCount: dateFixed.length, tCount: dateTasks.length })
        };
      }
    }
  }

  return {
    buildIntentContext,
    computeContextRevision
  };
}));
