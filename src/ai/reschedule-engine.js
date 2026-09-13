'use strict';

/**
 * @file reschedule-engine.js
 * Deterministic Smart Reschedule Engine ("Fix My Day").
 *
 * Core Principles:
 * 1. Constraint Priority:
 *    Hard constraints > Explicit user constraints > Hard deadlines > Priority >
 *    Availability > Preferences > Workload optimization (changeCost)
 * 2. Immutable Guarantees:
 *    - Fixed events are NEVER modified.
 *    - Completed tasks are NEVER modified.
 *    - No tasks are silently deleted or marked done.
 * 3. Minimum Necessary Change:
 *    - Preserves upcoming non-conflicted tasks when possible to minimize disruption.
 * 4. Multi-Day Spillover:
 *    - When remaining capacity today is full, gracefully shifts lower-priority/distant-deadline tasks to tomorrow.
 * 5. Duplicate Event Protection:
 *    - Never creates redundant events matching existing ones.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    const { analyzeScheduleDrift } = require('./schedule-drift');
    const { detectConflicts } = require('./conflict-intelligence');
    const { evaluateDeadlineRisks } = require('./deadline-intelligence');
    const { computePlanningContextRevision } = require('./planner-context');
    const { createPlanningProposal } = require('./planning-proposal');
    module.exports = factory(
      AppDate,
      analyzeScheduleDrift,
      detectConflicts,
      evaluateDeadlineRisks,
      computePlanningContextRevision,
      createPlanningProposal
    );
  } else {
    root.RescheduleEngine = factory(
      root.AppDate,
      root.ScheduleDrift ? root.ScheduleDrift.analyzeScheduleDrift : null,
      root.ConflictIntelligence ? root.ConflictIntelligence.detectConflicts : null,
      root.DeadlineIntelligence ? root.DeadlineIntelligence.evaluateDeadlineRisks : null,
      root.PlannerContext ? root.PlannerContext.computePlanningContextRevision : null,
      root.PlanningProposal ? root.PlanningProposal.createPlanningProposal : null
    );
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (
  DateUtil,
  analyzeScheduleDriftFn,
  detectConflictsFn,
  evaluateDeadlineRisksFn,
  computeRevisionFn,
  createProposalFn
) {

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

  function addDays(dateStr, n) {
    if (DateUtil && typeof DateUtil.addAppDays === 'function') return DateUtil.addAppDays(dateStr, n);
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function diffDays(a, b) {
    if (DateUtil && typeof DateUtil.diffAppDays === 'function') return DateUtil.diffAppDays(a, b);
    return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
  }

  function snapTo15(m) {
    return Math.ceil(m / 15) * 15;
  }

  /**
   * Generates a smart reschedule plan to "Fix My Day".
   *
   * @param {Object} context - Standard planning context
   * @param {Object} [options]
   * @returns {Object} PlanningProposal with reschedule actions, diffs, and rationales
   */
  function generateReschedulePlan(context = {}, options = {}) {
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
    const bufferMin = options.bufferMinutes !== undefined ? options.bufferMinutes : 10;
    const minBlockMin = options.minBlockMinutes !== undefined ? options.minBlockMinutes : 45;
    const horizonDays = Math.min(options.horizonDays || context.horizonDays || 3, 7);

    // 1. Run diagnostic engines
    const drift = analyzeScheduleDriftFn ? analyzeScheduleDriftFn(context, { currentDate: curDate, currentTime: curTime }) : {};
    const conflictReport = detectConflictsFn ? detectConflictsFn(context.scheduledTasks, context) : { hardConflicts: [], softConflicts: [] };
    const deadlineReport = evaluateDeadlineRisksFn ? evaluateDeadlineRisksFn(context, { currentDate: curDate, currentTime: curTime }) : {};

    const avail = context.availability || { start: '15:00', end: '21:30' };
    const availStartMin = minFromTime(avail.start || '15:00');
    const availEndMin = minFromTime(avail.end || '21:30');

    // Earliest possible start time today: max(curTimeMin, availStartMin) snapped to 15m
    const earliestTodayStart = snapTo15(Math.max(curTimeMin, availStartMin));

    // 2. Classify tasks into Locked vs In-Need-Of-Rescheduling
    const tasks = context.scheduledTasks || [];
    const conflictedTaskIds = new Set();
    (conflictReport.hardConflicts || []).forEach(c => (c.affectedTaskIds || []).forEach(id => conflictedTaskIds.add(id)));

    const tasksToReschedule = [];
    const preservedTasks = [];

    for (const task of tasks) {
      if (!task || task.status === 'done') continue; // Completed tasks are locked

      const taskDate = task.scheduledDate || curDate;
      const taskStartMin = minFromTime(task.startTime || '00:00');
      const taskEndMin = minFromTime(task.endTime || timeFromMin(taskStartMin + (task.durationMinutes || 45)));

      // Needs reschedule if:
      // a) Date is in the past (overdue)
      // b) Date is today and startTime has elapsed (late)
      // c) In hard conflict with a fixed event or other task
      const isPastDate = taskDate < curDate;
      const isLateToday = taskDate === curDate && taskStartMin < curTimeMin;
      const isConflicted = conflictedTaskIds.has(task.id);

      if (isPastDate || isLateToday || isConflicted) {
        tasksToReschedule.push({
          ...task,
          duration: Number(task.durationMinutes || task.minutes || 45),
          isOverdue: isPastDate,
          isLate: isLateToday,
          isConflicted,
          previousDate: taskDate,
          previousStartTime: task.startTime,
          previousEndTime: task.endTime
        });
      } else {
        // Candidate for preservation (upcoming on today or future date)
        preservedTasks.push(task);
      }
    }

    // 3. Sort tasksToReschedule by Constraint Priority:
    //    1. Earliest deadline
    //    2. Priority (5 -> 1)
    //    3. Duration (larger first)
    tasksToReschedule.sort((a, b) => {
      const dDaysA = a.deadline ? diffDays(a.deadline, curDate) : 999;
      const dDaysB = b.deadline ? diffDays(b.deadline, curDate) : 999;
      if (dDaysA !== dDaysB) return dDaysA - dDaysB;

      const prioA = Number(a.priority || 3);
      const prioB = Number(b.priority || 3);
      if (prioB !== prioA) return prioB - prioA;

      return b.duration - a.duration;
    });

    // 4. Build schedule actions across days
    const actions = [];
    const rationale = [];
    const fixedEvents = context.fixedEvents || [];

    // Helper: find next available free interval on a given day
    function findFreeInterval(targetDate, duration, placedOnDay, startFromMin) {
      const isToday = targetDate === curDate;
      const dayStart = isToday ? Math.max(startFromMin, earliestTodayStart) : Math.max(startFromMin, availStartMin);
      const dayEnd = availEndMin;

      // Occupied blocks on targetDate (fixed events + placed actions + preserved tasks on that date)
      const occupied = [];

      fixedEvents.filter(fe => fe.date === targetDate).forEach(fe => {
        occupied.push({ start: minFromTime(fe.start), end: minFromTime(fe.end) });
      });

      placedOnDay.forEach(p => {
        occupied.push({ start: p.startMin, end: p.endMin });
      });

      preservedTasks.filter(pt => pt.scheduledDate === targetDate).forEach(pt => {
        const s = minFromTime(pt.startTime || '08:00');
        const e = minFromTime(pt.endTime || timeFromMin(s + (pt.durationMinutes || 45)));
        occupied.push({ start: s, end: e });
      });

      occupied.sort((a, b) => a.start - b.start);

      // Search gaps
      let cursor = dayStart;
      for (const block of occupied) {
        if (block.end <= cursor) continue;
        if (block.start > cursor) {
          const gap = block.start - cursor;
          if (gap >= duration) {
            return { startMin: cursor, endMin: cursor + duration };
          }
        }
        cursor = Math.max(cursor, snapTo15(block.end + bufferMin));
      }

      if (dayEnd - cursor >= duration) {
        return { startMin: cursor, endMin: cursor + duration };
      }
      return null;
    }

    const placedByDate = {};
    const unplacedTasks = [];

    for (const task of tasksToReschedule) {
      let placed = false;

      for (let dayOffset = 0; dayOffset < horizonDays; dayOffset++) {
        const targetDate = addDays(curDate, dayOffset);
        if (!placedByDate[targetDate]) placedByDate[targetDate] = [];

        const slot = findFreeInterval(targetDate, task.duration, placedByDate[targetDate], 0);
        if (slot) {
          placedByDate[targetDate].push(slot);

          const startTimeStr = timeFromMin(slot.startMin);
          const endTimeStr = timeFromMin(slot.endMin);

          // Rationale generation
          let reason = '';
          if (task.isLate) {
            reason = `Dời sang ${startTimeStr} vì lịch cũ (${task.previousStartTime}) đã trôi qua.`;
          } else if (task.isOverdue) {
            reason = `Xếp lại vào ${targetDate} vì là nhiệm vụ quá hạn từ ${task.previousDate}.`;
          } else if (task.isConflicted) {
            reason = `Dời sang ${startTimeStr} để giải quyết xung đột lịch học.`;
          } else if (targetDate !== task.previousDate) {
            reason = `Dời sang ${targetDate} do lịch hôm nay đã kín thời gian khả dụng.`;
          } else {
            reason = `Điều chỉnh thời gian tối ưu (${startTimeStr}–${endTimeStr}).`;
          }

          if (task.deadline) {
            const dlDays = diffDays(task.deadline, curDate);
            if (dlDays <= 1) {
              reason += ` Ưu tiên cao do hạn chót là ${task.deadline}.`;
            }
          }

          actions.push({
            id: `action-resched-${task.id || task.title}`,
            type: 'move_task',
            taskId: task.id || null,
            title: task.title,
            date: targetDate,
            startTime: startTimeStr,
            endTime: endTimeStr,
            durationMinutes: task.duration,
            previousDate: task.previousDate,
            previousStartTime: task.previousStartTime,
            previousEndTime: task.previousEndTime
          });

          rationale.push({
            targetId: task.id || task.title,
            reason
          });

          placed = true;
          break;
        }
      }

      if (!placed) {
        unplacedTasks.push(task);
      }
    }

    // 5. Calculate changeCost metric
    const changeCost = actions.length;

    // 6. Construct PlanningProposal
    const warnings = [];
    if (unplacedTasks.length > 0) {
      warnings.push(`⚠️ Không đủ thời gian trống để xếp ${unplacedTasks.length} nhiệm vụ trong ${horizonDays} ngày tới.`);
    }

    const revision = computeRevisionFn ? computeRevisionFn(context) : '00000000';

    const proposal = createProposalFn ? createProposalFn({
      actions,
      warnings,
      rationale,
      confidence: 0.95,
      source: 'smart_engine',
      contextVersion: revision
    }) : {
      actions,
      warnings,
      rationale,
      confidence: 0.95,
      source: 'smart_engine',
      contextVersion: revision
    };

    proposal.changeCost = changeCost;
    proposal.driftSummary = drift.summary || '';
    proposal.deadlineRisk = deadlineReport.highestRisk || 'safe';
    proposal.unplacedCount = unplacedTasks.length;

    return proposal;
  }

  return {
    generateReschedulePlan,
    _minFromTime: minFromTime,
    _timeFromMin: timeFromMin,
    _addDays: addDays,
    _diffDays: diffDays,
    _snapTo15: snapTo15
  };
}));
