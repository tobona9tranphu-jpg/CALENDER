'use strict';

/**
 * @file planning-proposal.js
 * Schedule Proposal Schema & Deterministic Proposal Validator.
 *
 * Core Principle:
 * - AI CANNOT directly mutate user calendar state.
 * - AI output is strictly a proposed plan (PlanningProposal).
 * - Every proposal MUST pass validatePlanningProposal() before user review.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    const exportsObj = factory(AppDate);
    exportsObj.PlanningProposal = exportsObj;
    module.exports = exportsObj;
  } else {
    root.PlanningProposal = factory(root.AppDate);
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
   * Constructs a structured Planning Proposal.
   */
  function createPlanningProposal({
    actions = [],
    warnings = [],
    rationale = [],
    confidence = 1.0,
    source = 'deterministic',
    contextVersion = null,
    quality = null
  } = {}) {
    return {
      actions: (actions || []).map((act, index) => {
        const type = act.type || 'schedule_task';
        const date = act.date || null;
        const durationMinutes = Number(act.durationMinutes || act.minutes || 30);
        let startTime = act.startTime || act.start || '08:00';
        let endTime = act.endTime || act.end || null;
        if (!endTime && startTime && durationMinutes > 0) {
          endTime = timeFromMin(minFromTime(startTime) + durationMinutes);
        }

        return {
          id: act.id || ('action-' + (index + 1)),
          type,
          taskId: act.taskId || null,
          title: String(act.title || '').trim(),
          date,
          startTime,
          endTime,
          durationMinutes
        };
      }),
      warnings: (warnings || []).map(w => String(w).trim()),
      rationale: (rationale || []).map(r => {
        if (typeof r === 'string') return { reason: r.trim() };
        return {
          targetId: r.targetId || null,
          reason: String(r.reason || '').trim()
        };
      }),
      confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
      source: source === 'ai' ? 'ai' : 'deterministic',
      contextVersion: contextVersion || null,
      quality: quality || null
    };
  }

  /**
   * Validates a planning proposal against physical constraints in planning context.
   *
   * Rules:
   * 1. Rejects overlap with fixed events (fixed schedules are immutable).
   * 2. Rejects violations of availability window bounds (start < availStart or end > availEnd).
   * 3. Rejects invalid date formats (not YYYY-MM-DD).
   * 4. Rejects non-positive durations.
   * 5. Rejects actions referencing non-existent task IDs (if taskId provided).
   * 6. Rejects duplicate conflicting actions.
   *
   * @param {Object} proposal
   * @param {Object} context
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  function validatePlanningProposal(proposal, context = {}) {
    const errors = [];
    const warnings = [];

    if (!proposal || typeof proposal !== 'object') {
      return { valid: false, errors: ['Proposal must be an object.'], warnings: [] };
    }

    if (!Array.isArray(proposal.actions)) {
      return { valid: false, errors: ['Proposal must contain an actions array.'], warnings: [] };
    }

    const avail = context.availability || { start: '06:00', end: '23:00' };
    const availStartMin = minFromTime(avail.start || '06:00');
    const availEndMin = minFromTime(avail.end || '23:00');

    const knownTaskIds = new Set();
    (context.scheduledTasks || []).forEach(t => knownTaskIds.add(t.id));
    (context.inboxItems || []).forEach(t => knownTaskIds.add(t.id));

    const scheduledIntervalsByDate = {};

    for (let i = 0; i < proposal.actions.length; i++) {
      const act = proposal.actions[i];
      const prefix = `Action #${i + 1} (${act.title || act.taskId || act.type}):`;

      // 1. Duration check
      if (typeof act.durationMinutes !== 'number' || isNaN(act.durationMinutes) || act.durationMinutes <= 0) {
        const msg = `${prefix} durationMinutes must be a positive number.`;
        errors.push(msg);
        warnings.push({ code: 'INVALID_DURATION', message: msg });
        continue;
      }

      // 2. Date check
      if (!act.date || !/^\d{4}-\d{2}-\d{2}$/.test(act.date)) {
        const msg = `${prefix} invalid date format (must be YYYY-MM-DD).`;
        errors.push(msg);
        warnings.push({ code: 'INVALID_DATE', message: msg });
        continue;
      }

      // 3. Time format & interval
      if (!act.startTime || !/^\d{1,2}:\d{2}$/.test(act.startTime)) {
        const msg = `${prefix} invalid startTime format (HH:MM).`;
        errors.push(msg);
        warnings.push({ code: 'INVALID_TIME_FORMAT', message: msg });
        continue;
      }
      if (!act.endTime || !/^\d{1,2}:\d{2}$/.test(act.endTime)) {
        const msg = `${prefix} invalid endTime format (HH:MM).`;
        errors.push(msg);
        warnings.push({ code: 'INVALID_TIME_FORMAT', message: msg });
        continue;
      }

      const actStartMin = minFromTime(act.startTime);
      const actEndMin = minFromTime(act.endTime);

      if (actEndMin <= actStartMin) {
        const msg = `${prefix} endTime (${act.endTime}) must be strictly after startTime (${act.startTime}).`;
        errors.push(msg);
        warnings.push({ code: 'INVALID_INTERVAL', message: msg });
        continue;
      }

      // 4. Availability Window bounds
      if (actStartMin < availStartMin || actEndMin > availEndMin) {
        const msg = `${prefix} falls outside availability window (${avail.start} - ${avail.end}).`;
        warnings.push({ code: 'OUTSIDE_AVAILABILITY', message: msg });
      }

      // 5. Existing task reference check
      if (act.taskId && knownTaskIds.size > 0 && !knownTaskIds.has(act.taskId)) {
        const msg = `${prefix} references non-existent taskId "${act.taskId}".`;
        errors.push(msg);
        warnings.push({ code: 'NON_EXISTENT_TASK', message: msg });
      }

      // 6. Conflict with fixed events on the same date
      const fixedEventsOnDate = (context.fixedEvents || []).filter(f => f.date === act.date);
      for (const fixed of fixedEventsOnDate) {
        const fixedStartMin = minFromTime(fixed.start);
        const fixedEndMin = minFromTime(fixed.end);
        // Overlap condition: actStart < fixedEnd && actEnd > fixedStart
        if (actStartMin < fixedEndMin && actEndMin > fixedStartMin) {
          const msg = `${prefix} conflicts with fixed event "${fixed.title}" (${fixed.start} - ${fixed.end}) on ${act.date}.`;
          errors.push(msg);
          warnings.push({ code: 'FIXED_EVENT_CONFLICT', message: msg });
        }
      }

      // 7. Check internal collision against other actions in the same proposal
      if (!scheduledIntervalsByDate[act.date]) {
        scheduledIntervalsByDate[act.date] = [];
      }
      for (const existing of scheduledIntervalsByDate[act.date]) {
        if (act.taskId && existing.taskId && act.taskId === existing.taskId) {
          const msg = `${prefix} duplicate action scheduling the same task twice.`;
          errors.push(msg);
          warnings.push({ code: 'DUPLICATE_ACTION', message: msg });
        } else if (actStartMin < existing.endMin && actEndMin > existing.startMin) {
          const msg = `${prefix} overlaps with another action in this proposal (${existing.title}).`;
          errors.push(msg);
          warnings.push({ code: 'INTERNAL_PROPOSAL_OVERLAP', message: msg });
        }
      }

      scheduledIntervalsByDate[act.date].push({
        taskId: act.taskId,
        title: act.title,
        startMin: actStartMin,
        endMin: actEndMin
      });
    }

    // Pass through proposal warnings
    if (Array.isArray(proposal.warnings)) {
      proposal.warnings.forEach(w => {
        if (typeof w === 'string') {
          warnings.push({ code: 'PROPOSAL_WARNING', message: w });
        } else {
          warnings.push(w);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  return {
    createPlanningProposal,
    validatePlanningProposal
  };
}));
