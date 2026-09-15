'use strict';

/**
 * @file conflict-intelligence.js
 * Deterministic Conflict Intelligence Engine (Product Phase P1.3).
 *
 * Classifies scheduling conflicts into:
 * - HARD CONFLICTS:
 *   - Overlapping time between tasks or events (e.g. 08:00–09:30 Math and 08:30–10:00 Physics)
 *   - Overlap with immutable fixed events or school timetable
 *   - Boundary violation with availability / quiet hours
 *   - Invalid intervals (endTime <= startTime)
 *
 * - SOFT CONFLICTS:
 *   - Insufficient break buffer between consecutive tasks (< minBreak)
 *   - Excessive consecutive tasks causing fatigue
 *   - Task fragmentation (< minBlock)
 *   - Overloaded day exceeding maximum recommended workload
 *   - Capacity overflow
 *
 * Contract per requirement:
 * {
 *   type: "hard" | "soft",
 *   category: string,
 *   severity: "critical" | "high" | "medium" | "low",
 *   eventIds: string[],
 *   taskIds: string[],
 *   reason: string,
 *   suggestedAction: string
 * }
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    module.exports = factory(AppDate);
  } else {
    root.ConflictIntelligence = factory(root.AppDate);
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
   * Detects all hard and soft conflicts across an item set or proposal actions
   * evaluated against the planning context.
   *
   * @param {Object|Array} proposalOrActions - PlanningProposal or array of actions/tasks
   * @param {Object} context - Standardized planning context
   * @param {Object} [options]
   * @param {number} [options.minBreakMinutes=10]
   * @param {number} [options.minBlockMinutes=45]
   * @param {number} [options.maxDailyWorkMinutes=300]
   * @returns {{ hardConflicts: Array, softConflicts: Array, allConflicts: Array, hasHardConflicts: boolean, totalCount: number }}
   */
  function detectConflicts(proposalOrActions, context = {}, options = {}) {
    const minBreak = options.minBreakMinutes !== undefined ? options.minBreakMinutes : 10;
    const minBlock = options.minBlockMinutes !== undefined ? options.minBlockMinutes : 45;
    const maxDayWork = options.maxDailyWorkMinutes !== undefined ? options.maxDailyWorkMinutes : 300;

    const actions = Array.isArray(proposalOrActions)
      ? proposalOrActions
      : (proposalOrActions?.actions || context.scheduledTasks || []);

    const fixedEvents = context.fixedEvents || [];
    const avail = context.availability || { start: '06:00', end: '23:59' };
    const availStartMin = minFromTime(avail.start || '06:00');
    const availEndMin = minFromTime(avail.end || '23:59');

    const hardConflicts = [];
    const softConflicts = [];

    // Group items by date
    const itemsByDate = {};
    for (const act of actions) {
      if (!act) continue;
      const date = act.date || act.scheduledDate || context.currentDate;
      if (!itemsByDate[date]) itemsByDate[date] = [];
      itemsByDate[date].push(act);
    }

    // ── 1. Check Fixed Events against each other ─────────────────────────────
    const fixedByDate = {};
    for (const fe of fixedEvents) {
      if (!fe || !fe.date) continue;
      if (!fixedByDate[fe.date]) fixedByDate[fe.date] = [];
      fixedByDate[fe.date].push(fe);
    }

    for (const date of Object.keys(fixedByDate)) {
      const list = fixedByDate[date];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const aStart = minFromTime(a.start);
          const aEnd = minFromTime(a.end);
          const bStart = minFromTime(b.start);
          const bEnd = minFromTime(b.end);

          if (aStart < bEnd && aEnd > bStart) {
            const evIds = [a.id, b.id].filter(Boolean);
            hardConflicts.push({
              type: 'hard',
              category: 'RIGID_EVENTS_OVERLAP',
              code: 'RIGID_EVENTS_OVERLAP',
              severity: 'critical',
              date,
              eventIds: evIds,
              taskIds: [],
              affectedActionIds: evIds,
              affectedTaskIds: [],
              message: `Hai sự kiện cố định trùng lịch: "${a.title}" (${a.start}–${a.end}) và "${b.title}" (${b.start}–${b.end}) vào ngày ${date}`,
              reason: 'Lịch học/sự kiện cố định không thể diễn ra cùng một lúc.',
              suggestedAction: 'Kiểm tra lại thời khóa biểu cố định để điều chỉnh khung giờ.',
              suggestedResolution: 'Kiểm tra lại thời khóa biểu cố định để điều chỉnh khung giờ.'
            });
          }
        }
      }
    }

    // ── 2. Evaluate Actions / Tasks ──────────────────────────────────────────
    for (const date of Object.keys(itemsByDate)) {
      const dayItems = itemsByDate[date];
      const fixedOnDate = fixedByDate[date] || [];
      let totalDailyMinutes = 0;

      for (let i = 0; i < dayItems.length; i++) {
        const item = dayItems[i];
        const title = item.title || 'Nhiệm vụ';
        const startStr = item.startTime || item.start;
        const endStr = item.endTime || item.end;
        const duration = Number(item.durationMinutes || item.minutes || 0);
        const actionId = item.id || `action-${i + 1}`;
        const taskId = item.taskId || item.id || null;

        totalDailyMinutes += duration;

        // Check: Invalid interval
        if (startStr && endStr) {
          const sMin = minFromTime(startStr);
          const eMin = minFromTime(endStr);
          if (eMin <= sMin) {
            hardConflicts.push({
              type: 'hard',
              category: 'INVALID_INTERVAL',
              code: 'INVALID_INTERVAL',
              severity: 'critical',
              date,
              eventIds: [],
              taskIds: [taskId].filter(Boolean),
              affectedActionIds: [actionId],
              affectedTaskIds: [taskId].filter(Boolean),
              message: `Khung giờ không hợp lệ cho "${title}": kết thúc ${endStr} trước hoặc bằng giờ bắt đầu ${startStr}`,
              reason: 'Thời gian kết thúc phải diễn ra sau thời gian bắt đầu.',
              suggestedAction: `Chỉnh sửa giờ kết thúc thành sau ${startStr}.`,
              suggestedResolution: `Chỉnh sửa giờ kết thúc thành sau ${startStr}.`
            });
            continue;
          }

          // Check: Availability Violation
          if (sMin < availStartMin || eMin > availEndMin) {
            hardConflicts.push({
              type: 'hard',
              category: 'AVAILABILITY_VIOLATION',
              code: 'AVAILABILITY_VIOLATION',
              severity: 'high',
              date,
              eventIds: [],
              taskIds: [taskId].filter(Boolean),
              affectedActionIds: [actionId],
              affectedTaskIds: [taskId].filter(Boolean),
              message: `"${title}" (${startStr}–${endStr}) nằm ngoài khung giờ khả dụng (${avail.start}–${avail.end})`,
              reason: 'Lịch học không nên xếp vào thời gian người dùng không sẵn sàng hoặc đang ngủ/nghỉ ngơi.',
              suggestedAction: `Dời nhiệm vụ vào trong khoảng từ ${avail.start} đến ${avail.end}.`,
              suggestedResolution: `Dời nhiệm vụ vào trong khoảng từ ${avail.start} đến ${avail.end}.`
            });
          }

          // Check: Conflict with Fixed Events
          for (const fe of fixedOnDate) {
            const feStart = minFromTime(fe.start);
            const feEnd = minFromTime(fe.end);
            if (sMin < feEnd && eMin > feStart) {
              hardConflicts.push({
                type: 'hard',
                category: 'FIXED_EVENT_OVERLAP',
                code: 'FIXED_EVENT_OVERLAP',
                severity: 'critical',
                date,
                eventIds: [fe.id].filter(Boolean),
                taskIds: [taskId].filter(Boolean),
                affectedActionIds: [actionId],
                affectedTaskIds: [taskId].filter(Boolean),
                message: `"${title}" (${startStr}–${endStr}) trùng với sự kiện cố định "${fe.title}" (${fe.start}–${fe.end})`,
                reason: 'Sự kiện cố định và thời khóa biểu trường học là bất khả biến và không thể di dời.',
                suggestedAction: `Dời "${title}" sang trước ${fe.start} hoặc sau ${fe.end}.`,
                suggestedResolution: `Dời "${title}" sang trước ${fe.start} hoặc sau ${fe.end}.`
              });
            }
          }

          // Check: Internal Overlap with other actions on the same day
          for (let j = i + 1; j < dayItems.length; j++) {
            const other = dayItems[j];
            const otherStartStr = other.startTime || other.start;
            const otherEndStr = other.endTime || other.end;
            if (otherStartStr && otherEndStr) {
              const osMin = minFromTime(otherStartStr);
              const oeMin = minFromTime(otherEndStr);
              if (sMin < oeMin && eMin > osMin) {
                const tIds = [taskId, other.taskId || other.id].filter(Boolean);
                hardConflicts.push({
                  type: 'hard',
                  category: 'INTERNAL_OVERLAP',
                  code: 'INTERNAL_OVERLAP',
                  severity: 'high',
                  date,
                  eventIds: [],
                  taskIds: tIds,
                  affectedActionIds: [actionId, other.id].filter(Boolean),
                  affectedTaskIds: tIds,
                  message: `Xung đột trùng giờ giữa "${title}" (${startStr}–${endStr}) và "${other.title || 'Nhiệm vụ khác'}" (${otherStartStr}–${otherEndStr})`,
                  reason: 'Không thể học hai nhiệm vụ cùng một lúc.',
                  suggestedAction: `Xếp lại một trong hai nhiệm vụ vào khung giờ trống kế tiếp.`,
                  suggestedResolution: `Xếp lại một trong hai nhiệm vụ vào khung giờ trống kế tiếp.`
                });
              }
            }
          }
        }

        // Soft Conflict: Task Fragmentation
        if (duration > 0 && duration < minBlock && item.type !== 'create_event') {
          softConflicts.push({
            type: 'soft',
            category: 'TASK_FRAGMENTATION',
            code: 'TASK_FRAGMENTATION',
            severity: 'low',
            date,
            eventIds: [],
            taskIds: [taskId].filter(Boolean),
            affectedActionIds: [actionId],
            affectedTaskIds: [taskId].filter(Boolean),
            message: `"${title}" bị chia nhỏ (${duration} phút) dưới mức khuyến nghị ${minBlock} phút`,
            reason: 'Các phiên học quá ngắn làm giảm sự tập trung sâu.',
            suggestedAction: `Gộp phiên học thành khối liên tục từ ${minBlock} phút trở lên.`,
            suggestedResolution: `Gộp phiên học thành khối liên tục từ ${minBlock} phút trở lên.`
          });
        }
      }

      // Soft Conflict: Insufficient Break between consecutive tasks
      const sortedTimed = dayItems
        .filter(it => (it.startTime || it.start) && (it.endTime || it.end))
        .sort((a, b) => minFromTime(a.startTime || a.start) - minFromTime(b.startTime || b.start));

      for (let k = 0; k < sortedTimed.length - 1; k++) {
        const cur = sortedTimed[k];
        const next = sortedTimed[k + 1];
        const curEnd = minFromTime(cur.endTime || cur.end);
        const nextStart = minFromTime(next.startTime || next.start);
        const gap = nextStart - curEnd;

        if (gap >= 0 && gap < minBreak) {
          const tIds = [cur.taskId || cur.id, next.taskId || next.id].filter(Boolean);
          softConflicts.push({
            type: 'soft',
            category: 'INSUFFICIENT_BREAK',
            code: 'INSUFFICIENT_BREAK',
            severity: 'medium',
            date,
            eventIds: [],
            taskIds: tIds,
            affectedActionIds: [cur.id, next.id].filter(Boolean),
            affectedTaskIds: tIds,
            message: `Thiếu thời gian nghỉ (${gap} phút) giữa "${cur.title}" và "${next.title}"`,
            reason: `Cần ít nhất ${minBreak} phút nghỉ ngơi để phục hồi năng lượng giữa các phiên.`,
            suggestedAction: `Cách giờ bắt đầu của "${next.title}" thêm ${minBreak - gap} phút.`,
            suggestedResolution: `Cách giờ bắt đầu của "${next.title}" thêm ${minBreak - gap} phút.`
          });
        }
      }

      // Soft Conflict: Overloaded Day
      if (totalDailyMinutes > maxDayWork) {
        const hours = Math.round(totalDailyMinutes / 60 * 10) / 10;
        const allTIds = dayItems.map(it => it.taskId || it.id).filter(Boolean);
        softConflicts.push({
          type: 'soft',
          category: 'OVERLOADED_DAY',
          code: 'OVERLOADED_DAY',
          severity: 'high',
          date,
          eventIds: [],
          taskIds: allTIds,
          affectedActionIds: dayItems.map(it => it.id).filter(Boolean),
          affectedTaskIds: allTIds,
          message: `Khối lượng học tập ngày ${date} quá dày (${hours} giờ / tối đa ${Math.round(maxDayWork / 60)}h)`,
          reason: 'Học quá nhiều trong một ngày dễ gây mệt mỏi và giảm hiệu suất.',
          suggestedAction: 'Chuyển bớt các nhiệm vụ ít ưu tiên sang ngày tiếp theo.',
          suggestedResolution: 'Chuyển bớt các nhiệm vụ ít ưu tiên sang ngày tiếp theo.'
        });
      }
    }

    const allConflicts = [...hardConflicts, ...softConflicts];

    return {
      hardConflicts,
      softConflicts,
      allConflicts,
      hasHardConflicts: hardConflicts.length > 0,
      totalCount: allConflicts.length
    };
  }

  return {
    detectConflicts,
    _minFromTime: minFromTime,
    _timeFromMin: timeFromMin
  };
}));
