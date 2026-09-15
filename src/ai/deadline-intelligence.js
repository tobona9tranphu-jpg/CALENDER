'use strict';

/**
 * @file deadline-intelligence.js
 * Deterministic Deadline Intelligence Engine (Product Phase P1.3).
 *
 * Evaluates deadline urgency levels based on deterministic capacity calculations:
 *   Urgency Tiers:
 *   - 'overdue':   Deadline has already passed (daysLeft < 0)
 *   - 'critical':  Insufficient capacity (< 0.7x required duration) or due today without enough time
 *   - 'urgent':    Capacity is very tight (0.7x - 1.2x required duration)
 *   - 'upcoming':  Capacity is moderate (1.2x - 1.5x required duration), due within 2-3 days
 *   - 'safe':      Capacity is ample (>= 1.5x required duration)
 *
 * Features:
 * - Flags deadlineRisk = true when task is at risk.
 * - Factors in task duration, days remaining, free capacity, priority, fixed events.
 * - Generates human-readable, explainable Vietnamese explanations with exact durations.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    const CapacityEngine = require('./capacity-engine');
    module.exports = factory(AppDate, CapacityEngine);
  } else {
    root.DeadlineIntelligence = factory(root.AppDate, root.CapacityEngine);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (DateUtil, CapacityEngine) {

  function minFromTime(t) {
    if (DateUtil && typeof DateUtil.minFromTime === 'function') return DateUtil.minFromTime(t);
    const parts = (t || '0:0').split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
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

  function formatDurationVi(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0) return `${h} giờ ${m} phút`;
    if (h > 0) return `${h} giờ`;
    return `${m} phút`;
  }

  /**
   * Calculates free capacity in minutes on a given date taking into account
   * fixed events and current time if the date is today.
   */
  function getDailyCapacityMinutes(date, context, currentTimeMin = null) {
    if (CapacityEngine && typeof CapacityEngine.analyzeCapacity === 'function') {
      const cap = CapacityEngine.analyzeCapacity(date, context, {
        currentTime: currentTimeMin !== null ? (DateUtil && DateUtil.timeFromMin ? DateUtil.timeFromMin(currentTimeMin) : null) : null
      });
      return cap.freeMinutes;
    }

    const avail = context.availability || { start: '15:00', end: '21:30' };
    let startMin = minFromTime(avail.start || '15:00');
    const endMin = minFromTime(avail.end || '21:30');

    if (currentTimeMin !== null && date === context.currentDate) {
      startMin = Math.max(startMin, currentTimeMin);
    }

    if (endMin <= startMin) return 0;
    let capacity = endMin - startMin;

    const fixed = (context.fixedEvents || []).filter(e => e.date === date);
    for (const fe of fixed) {
      const fs = Math.max(minFromTime(fe.start), startMin);
      const feEnd = Math.min(minFromTime(fe.end), endMin);
      if (feEnd > fs) {
        capacity = Math.max(0, capacity - (feEnd - fs));
      }
    }
    return capacity;
  }

  /**
   * Evaluates deadline risks across all tasks and milestones.
   *
   * @param {Object} context - Standard planning context
   * @param {Object} [options]
   * @returns {Object} Deadline risk evaluation
   */
  function evaluateDeadlineRisks(context = {}, options = {}) {
    const curDate = options.currentDate || context.currentDate || (DateUtil && DateUtil.getTodayAppDate ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10));
    const curTime = options.currentTime || context.currentTime || '08:00';
    const curTimeMin = minFromTime(curTime);

    const tasks = context.scheduledTasks || [];
    const milestones = context.deadlines || [];

    const items = [];
    const URGENCY_RANKS = {
      overdue: 5,
      critical: 4,
      urgent: 3,
      upcoming: 2,
      safe: 1,
      // Synonyms for backwards compatibility
      impossible: 5,
      at_risk: 3,
      watch: 2
    };

    let maxRank = 1;
    let highestUrgency = 'safe';

    // 1. Evaluate tasks with an explicit deadline
    for (const task of tasks) {
      if (!task || task.status === 'done') continue;
      const deadline = task.deadline || task.deadlineDate;
      if (!deadline) continue;

      const duration = Number(task.durationMinutes || task.minutes || 45);
      const daysLeft = diffDays(deadline, curDate);

      if (daysLeft < 0) {
        const item = {
          taskId: task.id,
          title: task.title,
          deadline,
          daysLeft,
          requiredMinutes: duration,
          availableCapacityMinutes: 0,
          ratio: 0,
          urgency: 'overdue',
          risk: 'overdue', // compatible
          deadlineRisk: true,
          message: `Hạn chót cho "${task.title}" đã trôi qua (${deadline}).`,
          explanation: `Cần ${formatDurationVi(duration)} nhưng hạn chót đã quá hạn.`
        };
        items.push(item);
        if (URGENCY_RANKS.overdue > maxRank) {
          maxRank = URGENCY_RANKS.overdue;
          highestUrgency = 'overdue';
        }
        continue;
      }

      // Calculate total available capacity between curDate and deadlineDate
      let totalCapacity = 0;
      for (let i = 0; i <= daysLeft && i < 14; i++) {
        const d = addDays(curDate, i);
        totalCapacity += getDailyCapacityMinutes(d, context, i === 0 ? curTimeMin : null);
      }

      const ratio = duration > 0 ? totalCapacity / duration : 10;
      let urgency = 'safe';

      if (daysLeft === 0) {
        // Due today!
        if (totalCapacity < duration) {
          urgency = 'critical';
        } else if (totalCapacity < duration * 1.2) {
          urgency = 'urgent';
        } else if (totalCapacity < duration * 1.5) {
          urgency = 'upcoming';
        } else {
          urgency = 'safe';
        }
      } else if (ratio < 0.7 || totalCapacity < duration * 0.7) {
        urgency = 'critical';
      } else if (ratio < 1.2) {
        urgency = 'urgent';
      } else if (ratio < 1.5) {
        urgency = 'upcoming';
      } else {
        urgency = 'safe';
      }

      const isRisk = urgency === 'overdue' || urgency === 'critical' || urgency === 'urgent';

      if (URGENCY_RANKS[urgency] > maxRank) {
        maxRank = URGENCY_RANKS[urgency];
        highestUrgency = urgency;
      }

      const reqStr = formatDurationVi(duration);
      const capStr = formatDurationVi(totalCapacity);
      let message = `"${task.title}" có tiến độ an toàn trước hạn ${deadline}.`;
      let explanation = `Cần ${reqStr}, hiện còn ${capStr} khả dụng.`;

      if (urgency === 'critical') {
        message = `⚠️ Không đủ thời gian hoàn thành "${task.title}" trước hạn (${deadline}).`;
        explanation = `Cần ${reqStr} nhưng chỉ còn ${capStr} dung lượng rảnh trước hạn chót.`;
      } else if (urgency === 'urgent') {
        message = `⚠️ Dung lượng học cho "${task.title}" rất sát hạn chót (${deadline}).`;
        explanation = `Cần ${reqStr} trong khi tổng dung lượng rảnh chỉ là ${capStr}.`;
      } else if (urgency === 'upcoming') {
        message = `Cần chú ý tiến độ của "${task.title}" (hạn: ${deadline}).`;
        explanation = `Cần ${reqStr}, khả dụng ${capStr} (đệm thời gian vừa đủ).`;
      }

      items.push({
        taskId: task.id,
        title: task.title,
        deadline,
        daysLeft,
        requiredMinutes: duration,
        availableCapacityMinutes: totalCapacity,
        ratio: Math.round(ratio * 100) / 100,
        urgency,
        risk: urgency, // compatible
        deadlineRisk: isRisk,
        message,
        explanation
      });
    }

    // 2. Evaluate milestone exams if any
    for (const ms of milestones) {
      if (!ms || !ms.date) continue;
      const daysLeft = diffDays(ms.date, curDate);
      if (daysLeft >= 0 && daysLeft <= 3) {
        if (URGENCY_RANKS.urgent > maxRank) {
          maxRank = URGENCY_RANKS.urgent;
          if (highestUrgency === 'safe' || highestUrgency === 'upcoming') {
            highestUrgency = 'urgent';
          }
        }
      }
    }

    const isSafe = highestUrgency === 'safe' || highestUrgency === 'upcoming';
    const hasAtRisk = highestUrgency === 'urgent' || highestUrgency === 'critical' || highestUrgency === 'overdue';

    return {
      items,
      highestUrgency,
      highestRisk: highestUrgency, // compatible
      isSafe,
      totalCount: items.length,
      hasAtRisk
    };
  }

  return {
    evaluateDeadlineRisks,
    formatDurationVi,
    getDailyCapacityMinutes
  };
}));
