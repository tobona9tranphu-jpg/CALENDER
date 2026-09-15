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
   * Stably canonicalizes a planning context object:
   * - Strips sensitive / transient fields
   * - Recursively sorts object keys alphabetically
   * - Stably sorts all arrays by deterministic compound keys
   *
   * @param {Object} context
   * @returns {Object} Canonical object
   */
  function canonicalizePlanningContext(context) {
    if (!context || typeof context !== 'object') return {};

    // 1. Availability
    const rawAvail = context.availability || {};
    const availability = {
      days: Array.isArray(rawAvail.days) ? [...rawAvail.days].map(Number).sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6],
      end: String(rawAvail.end || '21:30'),
      start: String(rawAvail.start || '15:00')
    };

    // 2. Fixed events (stable sort: date -> start -> end -> title -> id)
    const fixedEvents = (context.fixedEvents || []).map(e => ({
      date: String(e.date || ''),
      end: String(e.end || ''),
      id: String(e.id || ''),
      start: String(e.start || ''),
      title: String(e.title || '').trim(),
      type: String(e.type || 'fixed')
    })).sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.start !== b.start) return a.start.localeCompare(b.start);
      if (a.end !== b.end) return a.end.localeCompare(b.end);
      if (a.title !== b.title) return a.title.localeCompare(b.title);
      return a.id.localeCompare(b.id);
    });

    // 3. Scheduled tasks (stable sort: scheduledDate -> startTime -> id -> title)
    const scheduledTasks = (context.scheduledTasks || []).map(t => ({
      deadline: t.deadline ? String(t.deadline) : null,
      durationMinutes: Number(t.durationMinutes || t.minutes || 0),
      endTime: t.endTime ? String(t.endTime) : null,
      id: String(t.id || ''),
      priority: Number(t.priority || 3),
      scheduledDate: t.scheduledDate ? String(t.scheduledDate) : null,
      startTime: t.startTime ? String(t.startTime) : null,
      title: String(t.title || '').trim()
    })).sort((a, b) => {
      const dateA = a.scheduledDate || '';
      const dateB = b.scheduledDate || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const timeA = a.startTime || '';
      const timeB = b.startTime || '';
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      if (a.id !== b.id) return a.id.localeCompare(b.id);
      return a.title.localeCompare(b.title);
    });

    // 4. Inbox items (stable sort: priority desc -> id -> title)
    const inboxItems = (context.inboxItems || []).map(i => ({
      durationMinutes: Number(i.durationMinutes || i.minutes || 0),
      id: String(i.id || ''),
      priority: Number(i.priority || 3),
      title: String(i.title || '').trim()
    })).sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.id !== b.id) return a.id.localeCompare(b.id);
      return a.title.localeCompare(b.title);
    });

    // 5. Deadlines (stable sort: date -> title)
    const deadlines = (context.deadlines || []).map(d => ({
      date: String(d.date || ''),
      daysUntil: Number(d.daysUntil || 0),
      subjects: String(d.subjects || ''),
      title: String(d.title || '').trim()
    })).sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.title.localeCompare(b.title);
    });

    // 6. Preferences
    const userPreferences = {
      coach: context.userPreferences?.coach !== false,
      reminders: context.userPreferences?.reminders !== false
    };

    // 7. Learned Preferences (P1.4 Adaptive Learning)
    const rawLearned = context.learnedPreferences || {};
    const learnedPreferences = {
      durationMultipliers: rawLearned.durationMultipliers ? Object.keys(rawLearned.durationMultipliers).sort().reduce((acc, k) => {
        acc[k] = Number(rawLearned.durationMultipliers[k]);
        return acc;
      }, {}) : {},
      enabled: rawLearned.enabled !== false,
      eveningLoadAdjustment: Number(rawLearned.eveningLoadAdjustment || 0),
      preferredBreakMinutes: Number(rawLearned.preferredBreakMinutes || 10),
      preferredStartBuffer: Number(rawLearned.preferredStartBuffer || 0)
    };

    return {
      availability,
      currentDate: String(context.currentDate || ''),
      deadlines,
      fixedEvents,
      inboxItems,
      learnedPreferences,
      scheduledTasks,
      timezone: 'Asia/Ho_Chi_Minh',
      userPreferences
    };
  }

  /**
   * Computes a high-precision deterministic revision hash for the entire planning context.
   * Changes whenever ANY planner-affecting state changes (durations, priorities, deadlines,
   * events, availability, etc.), but produces identical hashes for reordered inputs.
   *
   * @param {Object} context
   * @returns {string} 16-char hex fingerprint
   */
  function computePlanningContextRevision(context) {
    const canonical = canonicalizePlanningContext(context);
    const serialized = JSON.stringify(canonical);

    // Double djb2 hash to produce a 64-bit hexadecimal string (16 chars)
    let h1 = 5381;
    let h2 = 52711;
    for (let i = 0; i < serialized.length; i++) {
      const code = serialized.charCodeAt(i);
      h1 = ((h1 << 5) + h1) ^ code;
      h1 = h1 >>> 0;
      h2 = ((h2 << 5) + h2) ^ (code + i);
      h2 = h2 >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  /**
   * Computes a deterministic fingerprint of the user's calendar state.
   * Used for backward-compatibility in P1.1 / P1.2.
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

    let hash = 5381;
    for (let i = 0; i < canonical.length; i++) {
      hash = ((hash << 5) + hash) ^ canonical.charCodeAt(i);
      hash = hash >>> 0;
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
        minutes: Number(t.minutes || t.durationMinutes || 30),
        durationMinutes: Number(t.durationMinutes || t.minutes || 30),
        priority: Number(t.priority || 3),
        subjectId: t.subjectId || null,
        scheduledDate: t.scheduledDate || null,
        startTime: t.startTime || null,
        endTime: t.endTime || null,
        deadline: t.deadline || null,
        status: t.status || 'open',
        locked: Boolean(t.locked)
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

    const resultContext = {
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
      learnedPreferences: user?.settings?.learnedPreferences || {},
      calendarRevision: computeCalendarRevision(user),
      horizonDays: horizon
    };

    resultContext.planningContextRevision = computePlanningContextRevision(resultContext);
    return resultContext;
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
    canonicalizePlanningContext,
    computePlanningContextRevision,
    computeCalendarRevision,
    isContextSanitized
  };
}));
