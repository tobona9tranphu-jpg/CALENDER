'use strict';

/**
 * @file day-fix-engine.js
 * Deterministic "Fix My Day" Engine (Product Phase P1.3).
 *
 * Core Capabilities:
 * 1. analyzeDay(date, context, options):
 *    Comprehensive diagnostic of conflicts, deadline risks, and capacity.
 * 2. fixDay(date, context, options):
 *    Generates safe, explainable reschedule proposals across 5 levels:
 *    - Level 1: Same-day gap shift
 *    - Level 2: Cross-day move before deadline
 *    - Level 3: Task splitting (e.g. 120m -> 50m + break + 40m + break + 30m)
 *    - Level 4: Move low priority to free capacity
 *    - Level 5: Duration adjustment proposal
 *
 * Guarantees:
 * - Deterministic scoring and candidate selection.
 * - Never modifies fixed events, school timetable, completed tasks, or locked items.
 * - Enforces constraint priority hierarchy:
 *   HARD CONSTRAINT > EXPLICIT USER CONSTRAINT > FIXED EVENT > DEADLINE >
 *   PRIORITY > AVAILABILITY > USER PREFERENCE > OPTIMIZATION
 * - Explains "WHAT", "WHY", "TRADEOFF", and "IMPACT" for every change.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    const { detectConflicts } = require('./conflict-intelligence');
    const { evaluateDeadlineRisks } = require('./deadline-intelligence');
    const CapacityEngine = require('./capacity-engine');
    const { computePlanningContextRevision } = require('./planner-context');
    const { evaluatePlanQuality } = require('./plan-evaluator');
    const AdaptiveLearning = require('../execution/adaptive-learning');
    module.exports = factory(
      AppDate,
      detectConflicts,
      evaluateDeadlineRisks,
      CapacityEngine,
      computePlanningContextRevision,
      evaluatePlanQuality,
      AdaptiveLearning
    );
  } else {
    root.DayFixEngine = factory(
      root.AppDate,
      root.ConflictIntelligence ? root.ConflictIntelligence.detectConflicts : null,
      root.DeadlineIntelligence ? root.DeadlineIntelligence.evaluateDeadlineRisks : null,
      root.CapacityEngine,
      root.PlannerContext ? root.PlannerContext.computePlanningContextRevision : null,
      root.PlanEvaluator ? root.PlanEvaluator.evaluatePlanQuality : null,
      root.AdaptiveLearning
    );
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (
  DateUtil,
  detectConflictsFn,
  evaluateDeadlineRisksFn,
  CapacityEngine,
  computeRevisionFn,
  evaluatePlanQualityFn,
  AdaptiveLearning
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
   * Diagnostic: Analyzes a single day for conflicts, deadline risks, and capacity.
   *
   * @param {string} date - Date string 'YYYY-MM-DD'
   * @param {Object} context - Standard planning context
   * @param {Object} [options]
   * @returns {Object} Day analysis report
   */
  function analyzeDay(date, context = {}, options = {}) {
    const curDate = date || context.currentDate || (DateUtil && DateUtil.getTodayAppDate ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10));

    // 1. Capacity Intelligence
    const capAnalysis = (CapacityEngine && CapacityEngine.analyzeCapacity)
      ? CapacityEngine.analyzeCapacity(curDate, context, options)
      : { availableMinutes: 300, scheduledMinutes: 0, taskMinutes: 0, freeMinutes: 300, overloadMinutes: 0, utilization: 0, isOverloaded: false, blocks: { fixed: [], school: [], tasks: [], gaps: [] } };

    // 2. Conflict Intelligence
    const conflictReport = detectConflictsFn
      ? detectConflictsFn(context.scheduledTasks, context, options)
      : { hardConflicts: [], softConflicts: [], allConflicts: [] };

    const conflictsOnDate = (conflictReport.allConflicts || []).filter(c => c.date === curDate || !c.date);
    const hardOnDate = conflictsOnDate.filter(c => c.type === 'hard');
    const softOnDate = conflictsOnDate.filter(c => c.type === 'soft');

    // 3. Deadline Intelligence
    const deadlineReport = evaluateDeadlineRisksFn
      ? evaluateDeadlineRisksFn(context, { currentDate: curDate, currentTime: context.currentTime })
      : { items: [] };

    const deadlineRisksOnDate = (deadlineReport.items || []).filter(it => {
      if (!it.deadlineRisk) return false;
      // Relevant if deadline is today or tomorrow, or scheduled for today
      const isDueSoon = it.deadline === curDate || it.daysLeft <= 1;
      const isScheduledToday = (context.scheduledTasks || []).some(t => t.id === it.taskId && (t.scheduledDate === curDate || t.date === curDate));
      return isDueSoon || isScheduledToday;
    });

    // 4. Compute Health Score (0 - 100)
    let score = 100;
    score -= hardOnDate.length * 25;
    score -= softOnDate.length * 10;
    score -= deadlineRisksOnDate.filter(d => d.urgency === 'overdue' || d.urgency === 'critical').length * 20;
    score -= deadlineRisksOnDate.filter(d => d.urgency === 'urgent').length * 10;
    if (capAnalysis.isOverloaded) {
      score -= Math.min(25, 10 + Math.floor((capAnalysis.overloadMinutes || 30) / 15) * 5);
    }
    score = Math.max(0, Math.min(100, score));

    // 5. Recommendations
    const recommendations = [];
    if (hardOnDate.length > 0) {
      recommendations.push(`Có ${hardOnDate.length} xung đột lịch học nghiêm trọng cần dời giờ ngay.`);
    }
    if (deadlineRisksOnDate.length > 0) {
      recommendations.push(`Có ${deadlineRisksOnDate.length} nhiệm vụ có rủi ro trễ hạn chót cần ưu tiên.`);
    }
    if (capAnalysis.isOverloaded) {
      recommendations.push(`Khối lượng học hôm nay quá tải (vượt ${capAnalysis.overloadMinutes} phút), nên san sẻ sang ngày mai.`);
    }
    if (softOnDate.some(c => c.category === 'INSUFFICIENT_BREAK')) {
      recommendations.push('Cần chèn đệm nghỉ ngơi 10 phút giữa các ca học liên tiếp.');
    }
    if (recommendations.length === 0) {
      recommendations.push('Lịch trình hôm nay cân đối và an toàn.');
    }

    return {
      date: curDate,
      score,
      conflicts: conflictsOnDate,
      hardConflicts: hardOnDate,
      softConflicts: softOnDate,
      deadlineRisks: deadlineRisksOnDate,
      capacity: capAnalysis,
      overloaded: capAnalysis.isOverloaded,
      recommendations
    };
  }

  /**
   * Generates an actionable, explainable "Fix My Day" proposal without mutating calendar.
   *
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @param {Object} context - Standard planning context
   * @param {Object} [options]
   * @returns {Object} Day fix proposal
   */
  function fixDay(date, context = {}, options = {}) {
    const curDate = date || context.currentDate || (DateUtil && DateUtil.getTodayAppDate ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10));

    let curTime = options.currentTime || context.currentTime || (typeof globalThis !== 'undefined' && globalThis.SIMULATED_TIME) || (typeof window !== 'undefined' && window.SIMULATED_TIME);
    if (!curTime) {
      if (DateUtil && DateUtil.getNowVietnam) {
        const nowVn = DateUtil.getNowVietnam();
        curTime = `${String(nowVn.getHours()).padStart(2, '0')}:${String(nowVn.getMinutes()).padStart(2, '0')}`;
      } else {
        curTime = '08:00';
      }
    }
    const curTimeMin = minFromTime(curTime);

    // Initial Day Diagnostic
    const analysis = analyzeDay(curDate, context, { ...options, currentTime: curTime });

    // Snapshot of current items on curDate
    const currentTasksOnDate = (context.scheduledTasks || [])
      .filter(t => t && (t.scheduledDate === curDate || t.date === curDate))
      .map(t => ({
        id: t.id,
        title: t.title,
        date: curDate,
        startTime: t.startTime || null,
        endTime: t.endTime || null,
        durationMinutes: Number(t.durationMinutes || t.minutes || 45),
        priority: t.priority || 3,
        deadline: t.deadline || null,
        status: t.status || 'open',
        locked: Boolean(t.locked)
      }));

    const revision = computeRevisionFn ? computeRevisionFn(context) : '00000000';

    // If completely healthy, return empty changes with high score
    if (analysis.conflicts.length === 0 && analysis.deadlineRisks.length === 0 && !analysis.overloaded) {
      return {
        type: 'day_fix',
        date: curDate,
        before: currentTasksOnDate,
        after: currentTasksOnDate,
        changes: [],
        resolvedConflicts: [],
        improvedDeadlines: [],
        scoreBefore: analysis.score,
        scoreAfter: analysis.score,
        warnings: ['Ngày của bạn không có xung đột hay quá tải nào cần sửa.'],
        planningContextRevision: revision
      };
    }

    // ── Reschedule Logic ─────────────────────────────────────────────────────
    const learnedBreak = (context.learnedPreferences?.enabled !== false && context.learnedPreferences?.preferredBreakMinutes)
      ? Number(context.learnedPreferences.preferredBreakMinutes)
      : null;
    const bufferMin = options.minBreakMinutes !== undefined
      ? options.minBreakMinutes
      : (learnedBreak || 10);
    const horizonDays = Math.min(options.horizonDays || 3, 7);

    // Collect task IDs that must be rescheduled
    const conflictedTaskIds = new Set();
    analysis.hardConflicts.forEach(c => (c.taskIds || c.affectedTaskIds || []).forEach(id => conflictedTaskIds.add(id)));

    const tasksToReschedule = [];
    const preservedTasks = [];

    currentTasksOnDate.forEach(task => {
      // Completed and locked tasks are never moved
      if (task.status === 'done' || task.locked) {
        preservedTasks.push(task);
        return;
      }

      const tStartMin = task.startTime ? minFromTime(task.startTime) : null;
      const isLateToday = (tStartMin !== null && tStartMin < curTimeMin && curDate === context.currentDate);
      const isConflicted = conflictedTaskIds.has(task.id);
      const isOverloaded = analysis.overloaded;

      if (isLateToday || isConflicted || isOverloaded) {
        tasksToReschedule.push({
          ...task,
          isLate: isLateToday,
          isConflicted,
          previousDate: curDate,
          previousStartTime: task.startTime,
          previousEndTime: task.endTime
        });
      } else {
        preservedTasks.push(task);
      }
    });

    // Sort tasksToReschedule by Constraint Priority:
    // 1. Imminent deadline first
    // 2. High priority first (5 -> 1)
    // 3. Duration larger first
    tasksToReschedule.sort((a, b) => {
      const dDaysA = a.deadline ? diffDays(a.deadline, curDate) : 999;
      const dDaysB = b.deadline ? diffDays(b.deadline, curDate) : 999;
      if (dDaysA !== dDaysB) return dDaysA - dDaysB;

      const pA = Number(a.priority || 3);
      const pB = Number(b.priority || 3);
      if (pB !== pA) return pB - pA;

      return b.durationMinutes - a.durationMinutes;
    });

    const changes = [];
    const resolvedConflicts = [];
    const improvedDeadlines = [];
    const warnings = [];

    // Track placements per date: array of [startMin, endMin]
    const placementsByDate = {};
    for (let d = 0; d < horizonDays; d++) {
      const dStr = addDays(curDate, d);
      placementsByDate[dStr] = [];

      // Add fixed events
      (context.fixedEvents || []).filter(fe => fe.date === dStr).forEach(fe => {
        placementsByDate[dStr].push({
          startMin: minFromTime(fe.start),
          endMin: minFromTime(fe.end)
        });
      });

      // Add preserved tasks on that date
      preservedTasks.filter(pt => pt.date === dStr && pt.startTime && pt.endTime).forEach(pt => {
        placementsByDate[dStr].push({
          startMin: minFromTime(pt.startTime),
          endMin: minFromTime(pt.endTime)
        });
      });
    }

    const avail = context.availability || { start: '15:00', end: '21:30' };
    const availStartMin = minFromTime(avail.start || '15:00');
    const availEndMin = minFromTime(avail.end || '21:30');

    const learnedPrefs = context.learnedPreferences || {};
    const useAdaptive = learnedPrefs.enabled !== false && AdaptiveLearning && typeof AdaptiveLearning.getAdaptedTaskDuration === 'function';

    // Helper: find first available free gap on a date that fits required duration
    function findFreeGap(targetDate, duration, minStartFrom = 0) {
      const isTargetToday = targetDate === curDate;
      const startBuffer = (isTargetToday && learnedPrefs.preferredStartBuffer && curTimeMin > 0) ? Number(learnedPrefs.preferredStartBuffer) : 0;
      const dayStart = isTargetToday ? Math.max(availStartMin, curTimeMin + startBuffer, minStartFrom) : Math.max(availStartMin, minStartFrom);
      const dayEnd = availEndMin;

      const occupied = [...(placementsByDate[targetDate] || [])].sort((a, b) => a.startMin - b.startMin);

      let cursor = snapTo15(dayStart);
      for (const block of occupied) {
        if (block.endMin <= cursor) continue;
        if (block.startMin > cursor) {
          const gap = block.startMin - cursor;
          if (gap >= duration) {
            return { startMin: cursor, endMin: cursor + duration };
          }
        }
        cursor = snapTo15(Math.max(cursor, block.endMin + bufferMin));
      }

      if (dayEnd - cursor >= duration) {
        return { startMin: cursor, endMin: cursor + duration };
      }

      // If failed with start buffer, fallback without buffer (constraint hierarchy: AVAILABILITY > LEARNED PREFERENCE)
      if (startBuffer > 0) {
        const fallbackStart = Math.max(availStartMin, curTimeMin, minStartFrom);
        let fbCursor = snapTo15(fallbackStart);
        for (const block of occupied) {
          if (block.endMin <= fbCursor) continue;
          if (block.startMin > fbCursor) {
            const gap = block.startMin - fbCursor;
            if (gap >= duration) {
              return { startMin: fbCursor, endMin: fbCursor + duration };
            }
          }
          fbCursor = snapTo15(Math.max(fbCursor, block.endMin + bufferMin));
        }
        if (dayEnd - fbCursor >= duration) {
          return { startMin: fbCursor, endMin: fbCursor + duration };
        }
      }

      return null;
    }

    // Process each task needing reschedule across the 5 levels
    for (const task of tasksToReschedule) {
      let placed = false;

      const baseDuration = task.durationMinutes;
      const adaptedDuration = useAdaptive ? AdaptiveLearning.getAdaptedTaskDuration(task, learnedPrefs) : baseDuration;
      let effectiveDuration = adaptedDuration;

      // ── Level 1: Same-day move into another free gap ───────────────────────
      let level1Slot = findFreeGap(curDate, effectiveDuration);
      if (!level1Slot && effectiveDuration !== baseDuration) {
        effectiveDuration = baseDuration;
        level1Slot = findFreeGap(curDate, effectiveDuration);
      }
      if (level1Slot) {
        placementsByDate[curDate].push(level1Slot);
        const sTime = timeFromMin(level1Slot.startMin);
        const eTime = timeFromMin(level1Slot.endMin);

        changes.push({
          id: `change-${task.id || task.title}`,
          taskId: task.id,
          title: task.title,
          level: 1,
          what: `Dời "${task.title}" sang khung giờ ${sTime}–${eTime} cùng ngày`,
          why: task.isLate
            ? `Khung giờ cũ (${task.previousStartTime || 'chưa xếp'}) đã trôi qua`
            : 'Tránh xung đột giờ với sự kiện cố định / ca học khác',
          tradeoff: `Học muộn hơn vào lúc ${sTime}`,
          impact: 'Giải quyết 1 xung đột lịch và giữ trọn vẹn việc học trong ngày',
          from: { date: curDate, startTime: task.previousStartTime, endTime: task.previousEndTime },
          to: { date: curDate, startTime: sTime, endTime: eTime },
          action: {
            type: 'move_task',
            taskId: task.id,
            title: task.title,
            date: curDate,
            startTime: sTime,
            endTime: eTime,
            durationMinutes: effectiveDuration
          }
        });

        if (task.isConflicted) resolvedConflicts.push(task.title);
        placed = true;
        continue;
      }

      // ── Level 2: Cross-day move before deadline (or Level 4 if low priority bumped for high priority) ──
      const rescuedTask = (Number(task.priority || 3) <= 2)
        ? tasksToReschedule.find(t => t.id !== task.id && (Number(t.priority || 3) >= 4 || t.deadline))
        : null;

      let level2Placed = false;
      for (let offset = 1; offset < horizonDays; offset++) {
        const nextDate = addDays(curDate, offset);
        if (task.deadline && nextDate > task.deadline) break; // Must not violate deadline

        const slot = findFreeGap(nextDate, task.durationMinutes);
        if (slot) {
          placementsByDate[nextDate].push(slot);
          const sTime = timeFromMin(slot.startMin);
          const eTime = timeFromMin(slot.endMin);

          const isLevel4Bump = Boolean(rescuedTask);
          const changeLevel = isLevel4Bump ? 4 : 2;

          changes.push({
            id: `change-${task.id || task.title}`,
            taskId: task.id,
            title: task.title,
            level: changeLevel,
            what: isLevel4Bump
              ? `Dời việc ưu tiên thấp "${task.title}" sang ngày mai để nhường chỗ cho "${rescuedTask.title}"`
              : `Chuyển "${task.title}" sang ngày mai (${nextDate}) lúc ${sTime}–${eTime}`,
            why: isLevel4Bump
              ? `"${rescuedTask.title}" có mức ưu tiên cao (${rescuedTask.priority || 5}/5) và hạn chót cấp bách`
              : `Lịch hôm nay đã kín ${analysis.capacity.taskMinutes} phút học, không còn chỗ trống đủ ${task.durationMinutes} phút`,
            tradeoff: `Dời sang ${nextDate} (vẫn an toàn trước hạn chót ${task.deadline || 'sắp tới'})`,
            impact: isLevel4Bump
              ? `Bảo vệ hạn chót cho nhiệm vụ khẩn cấp "${rescuedTask.title}"`
              : `Giải phóng ${task.durationMinutes} phút giúp giảm quá tải cho hôm nay`,
            from: { date: curDate, startTime: task.previousStartTime, endTime: task.previousEndTime },
            to: { date: nextDate, startTime: sTime, endTime: eTime },
            action: {
              type: 'move_task',
              taskId: task.id,
              title: task.title,
              date: nextDate,
              startTime: sTime,
              endTime: eTime,
              durationMinutes: task.durationMinutes
            }
          });

          if (task.isConflicted) resolvedConflicts.push(task.title);
          if (isLevel4Bump && rescuedTask) improvedDeadlines.push(rescuedTask.title);
          level2Placed = true;
          placed = true;
          break;
        }
      }
      if (level2Placed) continue;

      // ── Level 3: Task Splitting ────────────────────────────────────────────
      // If task duration >= 60m and can be split into smaller blocks (e.g. 45m + remaining)
      if (task.durationMinutes >= 60) {
        const split1Dur = Math.max(30, Math.floor(task.durationMinutes / 2));
        const split2Dur = task.durationMinutes - split1Dur;

        const slot1 = findFreeGap(curDate, split1Dur);
        if (slot1) {
          placementsByDate[curDate].push(slot1);
          const sTime1 = timeFromMin(slot1.startMin);
          const eTime1 = timeFromMin(slot1.endMin);

          // Find slot for part 2 (either later today or tomorrow)
          let slot2 = findFreeGap(curDate, split2Dur, slot1.endMin + bufferMin);
          let date2 = curDate;
          if (!slot2) {
            date2 = addDays(curDate, 1);
            slot2 = findFreeGap(date2, split2Dur);
          }

          if (slot2) {
            placementsByDate[date2].push(slot2);
            const sTime2 = timeFromMin(slot2.startMin);
            const eTime2 = timeFromMin(slot2.endMin);

            changes.push({
              id: `change-${task.id || task.title}-split`,
              taskId: task.id,
              title: task.title,
              level: 3,
              what: `Tách "${task.title}" thành 2 phiên: Phần 1 (${split1Dur}m lúc ${sTime1}) và Phần 2 (${split2Dur}m lúc ${sTime2} ngày ${date2})`,
              why: `Không có khoảng trống liên tục ${task.durationMinutes} phút nhưng có các khoảng trống nhỏ hơn`,
              tradeoff: 'Học chia làm 2 giai đoạn thay vì một phiên liên tục',
              impact: 'Vừa giữ được tiến độ học vừa không làm vỡ các lịch cố định khác',
              from: { date: curDate, startTime: task.previousStartTime, endTime: task.previousEndTime },
              to: { date: curDate, startTime: sTime1, endTime: eTime1 },
              action: {
                type: 'move_task',
                taskId: task.id,
                title: `${task.title} (Phần 1)`,
                date: curDate,
                startTime: sTime1,
                endTime: eTime1,
                durationMinutes: split1Dur
              }
            });

            if (task.isConflicted) resolvedConflicts.push(task.title);
            placed = true;
            continue;
          }
        }
      }

      // ── Level 4: Move Low Priority Tasks to free capacity ──────────────────
      // If task is high priority (>= 4) and has upcoming deadline, find lower priority task on curDate
      if (Number(task.priority || 3) >= 4) {
        const lowerPrio = preservedTasks.find(pt => Number(pt.priority || 3) <= 2 && pt.durationMinutes >= task.durationMinutes);
        if (lowerPrio) {
          // Bumping lowerPrio to tomorrow
          const tomorrow = addDays(curDate, 1);
          const bumpSlot = findFreeGap(tomorrow, lowerPrio.durationMinutes);
          if (bumpSlot) {
            placementsByDate[tomorrow].push(bumpSlot);
            // Replace lowerPrio slot on curDate with task
            const sTime = lowerPrio.startTime || timeFromMin(availStartMin);
            const sMin = minFromTime(sTime);
            const eTime = timeFromMin(sMin + task.durationMinutes);

            changes.push({
              id: `change-${lowerPrio.id}-bump`,
              taskId: lowerPrio.id,
              title: lowerPrio.title,
              level: 4,
              what: `Dời việc ưu tiên thấp "${lowerPrio.title}" sang ngày mai để nhường chỗ cho "${task.title}"`,
              why: `"${task.title}" có mức ưu tiên cao (${task.priority}/5) và hạn chót cấp bách`,
              tradeoff: `Tạm hoãn "${lowerPrio.title}" sang ${tomorrow}`,
              impact: `Bảo vệ hạn chót cho nhiệm vụ khẩn cấp "${task.title}"`,
              from: { date: curDate, startTime: lowerPrio.startTime, endTime: lowerPrio.endTime },
              to: { date: tomorrow, startTime: timeFromMin(bumpSlot.startMin), endTime: timeFromMin(bumpSlot.endMin) },
              action: {
                type: 'move_task',
                taskId: lowerPrio.id,
                title: lowerPrio.title,
                date: tomorrow,
                startTime: timeFromMin(bumpSlot.startMin),
                endTime: timeFromMin(bumpSlot.endMin),
                durationMinutes: lowerPrio.durationMinutes
              }
            });

            changes.push({
              id: `change-${task.id}-priority-place`,
              taskId: task.id,
              title: task.title,
              level: 4,
              what: `Xếp "${task.title}" vào khung giờ ${sTime}–${eTime} hôm nay`,
              why: 'Đã giải phóng khoảng trống từ nhiệm vụ ưu tiên thấp hơn',
              tradeoff: 'Thay đổi vị trí của các nhiệm vụ khác trong ngày',
              impact: 'Đảm bảo hoàn thành bài học quan trọng đúng hạn',
              from: { date: curDate, startTime: task.previousStartTime, endTime: task.previousEndTime },
              to: { date: curDate, startTime: sTime, endTime: eTime },
              action: {
                type: 'move_task',
                taskId: task.id,
                title: task.title,
                date: curDate,
                startTime: sTime,
                endTime: eTime,
                durationMinutes: task.durationMinutes
              }
            });

            improvedDeadlines.push(task.title);
            placed = true;
            continue;
          }
        }
      }

      // ── Level 5: Duration adjustment proposal ──────────────────────────────
      // If task couldn't be placed, propose a 30m or 45m sprint
      if (!placed && task.durationMinutes > 45) {
        const reducedDur = 45;
        const slot = findFreeGap(curDate, reducedDur);
        if (slot) {
          placementsByDate[curDate].push(slot);
          const sTime = timeFromMin(slot.startMin);
          const eTime = timeFromMin(slot.endMin);

          changes.push({
            id: `change-${task.id}-duration-adjust`,
            taskId: task.id,
            title: task.title,
            level: 5,
            what: `Điều chỉnh phiên học "${task.title}" từ ${task.durationMinutes}m còn ${reducedDur}m (Sprint)`,
            why: `Quỹ thời gian trống hôm nay chỉ vừa khít ${reducedDur} phút`,
            tradeoff: 'Cần tập trung cao độ hơn để giải quyết cốt lõi bài học trong thời gian ngắn',
            impact: 'Tránh bị bỏ lỡ hoàn toàn buổi học trong ngày',
            from: { date: curDate, startTime: task.previousStartTime, endTime: task.previousEndTime },
            to: { date: curDate, startTime: sTime, endTime: eTime },
            action: {
              type: 'move_task',
              taskId: task.id,
              title: task.title,
              date: curDate,
              startTime: sTime,
              endTime: eTime,
              durationMinutes: reducedDur
            }
          });

          warnings.push(`⚠️ Đã rút gọn thời lượng của "${task.title}" xuống ${reducedDur} phút để vừa vặn với lịch rảnh còn lại.`);
          placed = true;
          continue;
        }
      }

      // If still not placed:
      if (!placed) {
        warnings.push(`⛔ Không tìm thấy phương án tự động an toàn cho "${task.title}" mà không vi phạm lịch cố định.`);
      }
    }

    // Build "After" Schedule
    const afterSchedule = [...preservedTasks];
    changes.forEach(c => {
      if (c.action && c.action.type === 'move_task' && c.to.date === curDate) {
        afterSchedule.push({
          id: c.taskId,
          title: c.title,
          date: curDate,
          startTime: c.to.startTime,
          endTime: c.to.endTime,
          durationMinutes: c.action.durationMinutes || 45,
          status: 'open'
        });
      }
    });
    afterSchedule.sort((a, b) => minFromTime(a.startTime || '00:00') - minFromTime(b.startTime || '00:00'));

    // Score After Fix
    let scoreAfter = Math.min(95, analysis.score + (resolvedConflicts.length * 20) + (improvedDeadlines.length * 15) + (changes.length > 0 ? 15 : 0));
    if (warnings.length > 0) scoreAfter = Math.max(50, scoreAfter - 10);

    return {
      type: 'day_fix',
      date: curDate,
      before: currentTasksOnDate,
      after: afterSchedule,
      changes,
      resolvedConflicts,
      improvedDeadlines,
      scoreBefore: analysis.score,
      scoreAfter,
      warnings,
      planningContextRevision: revision
    };
  }

  return {
    analyzeDay,
    fixDay,
    _minFromTime: minFromTime,
    _timeFromMin: timeFromMin,
    _findFreeGap: function() {} // for tests if needed
  };
}));
