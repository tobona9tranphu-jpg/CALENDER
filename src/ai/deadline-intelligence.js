'use strict';

/**
 * @file deadline-intelligence.js
 * Deterministic Deadline Intelligence Engine.
 *
 * Evaluates deadline risk levels based on deterministic capacity calculations:
 *   Risk Tiers:
 *   - 'safe':        Capacity >= 1.4x required effort
 *   - 'watch':       Capacity 1.0x - 1.4x required effort (acceptable buffer)
 *   - 'at_risk':     Capacity 0.7x - 1.0x required effort (tight, little room for delay)
 *   - 'critical':    Capacity 0.3x - 0.7x required effort (requires prompt rescheduling)
 *   - 'impossible':  Capacity < 0.3x required effort or deadline already passed
 *
 * Generates human-readable, explainable Vietnamese explanations with exact durations.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    module.exports = factory(AppDate);
  } else {
    root.DeadlineIntelligence = factory(root.AppDate);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (DateUtil) {

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
   * Calculates free availability in minutes on a given date taking into account
   * fixed events and current time if the date is today.
   */
  function getDailyCapacityMinutes(date, context, currentTimeMin = null) {
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
    const RISK_RANKS = { impossible: 5, critical: 4, at_risk: 3, watch: 2, safe: 1 };
    let maxRank = 1;
    let highestRisk = 'safe';

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
          risk: 'impossible',
          message: `Hạn chót cho "${task.title}" đã trôi qua (${deadline}).`,
          explanation: `Cần ${formatDurationVi(duration)} nhưng hạn chót đã quá hạn.`
        };
        items.push(item);
        if (RISK_RANKS.impossible > maxRank) { maxRank = RISK_RANKS.impossible; highestRisk = 'impossible'; }
        continue;
      }

      // Calculate total available capacity between curDate and deadlineDate
      let totalCapacity = 0;
      for (let i = 0; i <= daysLeft && i < 14; i++) {
        const d = addDays(curDate, i);
        totalCapacity += getDailyCapacityMinutes(d, context, i === 0 ? curTimeMin : null);
      }

      const ratio = duration > 0 ? totalCapacity / duration : 10;
      let risk = 'safe';
      if (ratio < 0.3 || totalCapacity < duration * 0.3) {
        risk = 'impossible';
      } else if (ratio < 0.7) {
        risk = 'critical';
      } else if (ratio < 1.0) {
        risk = 'at_risk';
      } else if (ratio < 1.4) {
        risk = 'watch';
      }

      if (RISK_RANKS[risk] > maxRank) {
        maxRank = RISK_RANKS[risk];
        highestRisk = risk;
      }

      const reqStr = formatDurationVi(duration);
      const capStr = formatDurationVi(totalCapacity);
      let message = `"${task.title}" có tiến độ an toàn trước hạn ${deadline}.`;
      let explanation = `Cần ${reqStr}, hiện còn ${capStr} khả dụng.`;

      if (risk === 'impossible' || risk === 'critical') {
        message = `⚠️ Không đủ thời gian để hoàn thành "${task.title}" trước ${deadline}.`;
        explanation = `Cần ${reqStr} nhưng chỉ còn ${capStr} khả dụng trước hạn chót.`;
      } else if (risk === 'at_risk') {
        message = `⚠️ Khung giờ học cho "${task.title}" rất sát hạn chót (${deadline}).`;
        explanation = `Cần ${reqStr} trong khi tổng dung lượng rảnh chỉ là ${capStr}.`;
      } else if (risk === 'watch') {
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
        risk,
        message,
        explanation
      });
    }

    // 2. Evaluate milestone exams if any
    for (const ms of milestones) {
      if (!ms || !ms.date) continue;
      const daysLeft = diffDays(ms.date, curDate);
      if (daysLeft >= 0 && daysLeft <= 3) {
        if (RISK_RANKS.at_risk > maxRank) {
          maxRank = RISK_RANKS.at_risk;
          if (highestRisk === 'safe' || highestRisk === 'watch') highestRisk = 'at_risk';
        }
      }
    }

    const isSafe = highestRisk === 'safe' || highestRisk === 'watch';

    return {
      items,
      highestRisk,
      isSafe,
      totalCount: items.length,
      hasAtRisk: highestRisk === 'at_risk' || highestRisk === 'critical' || highestRisk === 'impossible'
    };
  }

  return {
    evaluateDeadlineRisks,
    formatDurationVi,
    getDailyCapacityMinutes
  };
}));
