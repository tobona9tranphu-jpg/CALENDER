'use strict';

/**
 * @file planner-context.js
 * Standardized, privacy-safe Planning Context for AI Time Management.
 *
 * Privacy Guarantees:
 * - NEVER includes passwords, hashes, email, tokens, auth cookies, or credentials.
 * - Extracts only temporal and schedule-related data required for planning.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    const RecurrenceEngine = require('../recurrence/recurrence-engine');
    const exportsObj = factory(AppDate, RecurrenceEngine);
    exportsObj.PlannerContext = exportsObj;
    module.exports = exportsObj;
  } else {
    root.PlannerContext = factory(root.AppDate, root.RecurrenceEngine);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (DateUtil, RecurrenceUtil) {

  /**
   * Computes a deterministic fingerprint of the user's calendar state.
   * Used for stale-proposal detection: if the calendar changes after a proposal
   * is generated, the revision will differ and the proposal is rejected.
   *
   * @param {Object} user
   * @returns {string} Hex string revision fingerprint
   */
  function computeCalendarRevision(user) {
    // Normalize fixed schedules
    const fixedNorm = (user?.fixedSchedules || []).map(s => ({
      id: s.id || '',
      title: String(s.title || ''),
      day: s.day,
      start: s.start,
      end: s.end,
      type: s.type || 'fixed'
    })).sort((a, b) => (a.id > b.id ? 1 : -1));

    // Normalize scheduled tasks (non-inbox)
    const tasksNorm = (user?.tasks || [])
      .filter(t => t && t.status !== 'done')
      .map(t => ({
        id: t.id || '',
        title: String(t.title || ''),
        minutes: Number(t.minutes || 0),
        scheduledDate: t.scheduledDate || null,
        deadline: t.deadline || null,
        status: t.status || 'pending'
      }))
      .sort((a, b) => (a.id > b.id ? 1 : -1));

    const canonical = JSON.stringify({ fixedNorm, tasksNorm });

    // Deterministic djb2 hash (no crypto dependency)
    let hash = 5381;
    for (let i = 0; i < canonical.length; i++) {
      hash = ((hash << 5) + hash) ^ canonical.charCodeAt(i);
      hash = hash >>> 0; // keep unsigned 32-bit
    }
    return hash.toString(16).padStart(8, '0');
  }

  /**
   * Builds a standardized, sanitized planning context from the active user state.
   *
   * @param {Object} user
   * @param {string} [baseDate] - 'YYYY-MM-DD'
   * @param {Object} [options]
   * @param {number} [options.horizonDays=2] - Days forward to expand (max 7)
   * @returns {Object} Clean planning context
   */
  function buildPlanningContext(user = {}, baseDate = null, { horizonDays = 2 } = {}) {
    // Clamp horizon: minimum 1, maximum 7 days
    const horizon = Math.max(1, Math.min(7, horizonDays));

    const currentDate = baseDate
      ? (DateUtil && DateUtil.parseAppDate ? DateUtil.parseAppDate(baseDate) : baseDate)
      : (DateUtil && DateUtil.getTodayAppDate ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10));

    let currentTime = '08:00';
    if (DateUtil && DateUtil.getNowVietnam) {
      const nowVn = DateUtil.getNowVietnam();
      currentTime = `${String(nowVn.getHours()).padStart(2, '0')}:${String(nowVn.getMinutes()).padStart(2, '0')}`;
    }

    const availability = {
      start: user?.availability?.start || '15:00',
      end: user?.availability?.end || '21:30',
      days: Array.isArray(user?.availability?.days) ? [...user.availability.days] : [1, 2, 3, 4, 5, 6, 0]
    };

    // Expand fixed schedules across planning horizon
    const fixedEvents = [];
    const fixedRaw = user?.fixedSchedules || [];
    for (let i = 0; i < horizon; i++) {
      const targetDate = DateUtil && DateUtil.addAppDays ? DateUtil.addAppDays(currentDate, i) : currentDate;
      for (const item of fixedRaw) {
        if (RecurrenceUtil && RecurrenceUtil.expandOccurrences) {
          const occs = RecurrenceUtil.expandOccurrences(item, targetDate, targetDate);
          occs.forEach(occ => {
            fixedEvents.push({
              id: occ.id,
              title: occ.title,
              date: targetDate,
              start: occ.start,
              end: occ.end,
              type: occ.type || 'fixed'
            });
          });
        } else {
          const targetDay = DateUtil && DateUtil.getAppDayOfWeek ? DateUtil.getAppDayOfWeek(targetDate) : new Date(targetDate).getDay();
          if (Number(item.day) === targetDay) {
            fixedEvents.push({
              id: item.id,
              title: item.title,
              date: targetDate,
              start: item.start,
              end: item.end,
              type: item.type || 'fixed'
            });
          }
        }
      }
    }

    // Segregate scheduled tasks vs unscheduled inbox items
    const allTasks = user?.tasks || [];
    const scheduledTasks = [];
    const inboxItems = [];

    for (const t of allTasks) {
      if (!t || t.status === 'done') continue;
      const isInbox = t.isInbox === true || (!t.scheduledDate && !t.deadline);
      const sanitizedTask = {
        id: t.id,
        title: t.title,
        minutes: Number(t.minutes || 30),
        priority: Number(t.priority || 3),
        subjectId: t.subjectId || null,
        scheduledDate: t.scheduledDate || null,
        deadline: t.deadline || null
      };

      if (isInbox) {
        inboxItems.push(sanitizedTask);
      } else {
        scheduledTasks.push(sanitizedTask);
      }
    }

    // Deadlines & Milestones
    const deadlines = [];
    for (const m of (user?.examMilestones || [])) {
      if (!m || !m.date) continue;
      const daysUntil = DateUtil && DateUtil.diffAppDays ? DateUtil.diffAppDays(m.date, currentDate) : 999;
      if (daysUntil >= 0 && daysUntil <= 60) {
        deadlines.push({
          title: m.title,
          date: m.date,
          daysUntil,
          subjects: m.subjects || ''
        });
      }
    }

    // Completed today stats
    const todaySessions = (user?.sessions || []).filter(s => s && s.date === currentDate && s.status === 'complete');
    const completedWork = {
      completedSessionsCount: todaySessions.length,
      completedMinutesTotal: todaySessions.reduce((sum, s) => sum + Number(s.minutes || 0), 0)
    };

    const userPreferences = {
      reminders: user?.settings?.reminders !== false,
      coach: user?.settings?.coach !== false
    };

    return {
      currentDate,
      currentTime,
      timezone: 'Asia/Ho_Chi_Minh',
      availability,
      fixedEvents,
      scheduledTasks,
      inboxItems,
      deadlines,
      completedWork,
      userPreferences,
      calendarRevision: computeCalendarRevision(user),
      horizonDays: horizon
    };
  }

  /**
   * Deep sanitization check verifying no sensitive credentials leak into an AI payload.
   *
   * @param {Object} context
   * @returns {boolean} True if context is clean
   */
  function isContextSanitized(context) {
    if (!context || typeof context !== 'object') return false;
    const serialized = JSON.stringify(context);
    const forbiddenPatterns = [
      /password/i,
      /token/i,
      /cookie/i,
      /secret/i,
      /authorization/i,
      /bearer/i,
      /@tb\.demo/i,
      /sessionid/i
    ];
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(serialized)) return false;
    }
    return true;
  }

  return {
    buildPlanningContext,
    computeCalendarRevision,
    isContextSanitized
  };
}));
