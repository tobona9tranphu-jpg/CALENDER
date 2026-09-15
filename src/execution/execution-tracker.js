'use strict';

/**
 * @file execution-tracker.js
 * P1.4 Execution Intelligence & State Model.
 *
 * Core Principles:
 * 1. Plan vs Actual tracking: plannedStart, plannedEnd, actualStart, actualEnd, actualDuration.
 * 2. Strict Grounding: Never fabricate task completion or execution data.
 * 3. Root Cause Analysis: Rigorously distinguishes between DATA (facts) and INFERENCE (deductions).
 * 4. Backward Compatibility: 'open' <-> 'planned', 'done' <-> 'completed'.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    module.exports = factory(AppDate);
  } else {
    root.ExecutionTracker = factory(root.AppDate);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (DateUtil) {

  const EXECUTION_STATES = Object.freeze({
    PLANNED: 'planned',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    SKIPPED: 'skipped',
    POSTPONED: 'postponed',
    OVERDUE: 'overdue'
  });

  function minFromTime(t) {
    if (!t) return 0;
    if (DateUtil && typeof DateUtil.minFromTime === 'function') return DateUtil.minFromTime(t);
    const parts = String(t).split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }

  function timeFromMin(m) {
    if (DateUtil && typeof DateUtil.timeFromMin === 'function') return DateUtil.timeFromMin(m);
    const h = String(Math.floor(m / 60) % 24).padStart(2, '0');
    const min = String(m % 60).padStart(2, '0');
    return `${h}:${min}`;
  }

  function diffDays(a, b) {
    if (!a || !b) return 0;
    if (DateUtil && typeof DateUtil.diffAppDays === 'function') return DateUtil.diffAppDays(a, b);
    return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
  }

  /**
   * Normalizes task status with full backward compatibility.
   * 'open' -> 'planned'
   * 'done' -> 'completed'
   *
   * @param {string|Object} statusOrTask
   * @param {Object} [context]
   * @returns {string} Standardized status
   */
  function normalizeStatus(statusOrTask, context = null) {
    if (!statusOrTask) return EXECUTION_STATES.PLANNED;
    const taskObj = (typeof statusOrTask === 'object' && statusOrTask !== null) ? statusOrTask : null;
    let status = taskObj ? taskObj.status : statusOrTask;
    if (!status) status = EXECUTION_STATES.PLANNED;

    const s = String(status).toLowerCase().trim();
    if (s === 'done' || s === 'completed') return EXECUTION_STATES.COMPLETED;
    if (s === 'in_progress' || s === 'running' || s === 'active') return EXECUTION_STATES.IN_PROGRESS;
    if (s === 'skipped' || s === 'skip') return EXECUTION_STATES.SKIPPED;
    if (s === 'postponed' || s === 'delayed') return EXECUTION_STATES.POSTPONED;
    if (s === 'overdue') return EXECUTION_STATES.OVERDUE;

    // Check overdue against reference/context if task object provided
    if (taskObj && context) {
      const refDate = context.currentDate || context.referenceDate;
      const refTime = context.currentTime || context.referenceTime;
      const taskDate = taskObj.scheduledDate || taskObj.date;
      if (refDate && taskDate && refDate > taskDate) {
        return EXECUTION_STATES.OVERDUE;
      }
      if (refDate && taskDate && refDate === taskDate && refTime && taskObj.endTime) {
        if (minFromTime(refTime) > minFromTime(taskObj.endTime) + 15) {
          return EXECUTION_STATES.OVERDUE;
        }
      }
    }

    if (s === 'open' || s === 'planned') return EXECUTION_STATES.PLANNED;
    return EXECUTION_STATES.PLANNED;
  }

  function isCompleted(task) {
    if (!task) return false;
    const s = normalizeStatus(task);
    return s === EXECUTION_STATES.COMPLETED;
  }

  function isOpen(task) {
    if (!task) return false;
    const s = normalizeStatus(task);
    return s === EXECUTION_STATES.PLANNED || s === EXECUTION_STATES.IN_PROGRESS;
  }

  /**
   * Calculates individual execution metrics for a task.
   *
   * @param {Object} task
   * @param {string} [referenceDate] - 'YYYY-MM-DD'
   * @param {string} [referenceTime] - 'HH:mm'
   * @returns {Object} Metric breakdown
   */
  function calculateTaskMetrics(task, referenceDate = null, referenceTime = null) {
    if (!task) return null;

    const plannedStart = task.plannedStart || task.startTime || null;
    const plannedEnd = task.plannedEnd || task.endTime || null;
    const plannedDuration = Number(task.plannedDuration !== undefined ? task.plannedDuration : (task.durationMinutes !== undefined ? task.durationMinutes : (task.minutes || 0)));

    const actualStart = task.actualStart || null;
    const actualEnd = task.actualEnd || null;
    let actualDuration = (task.actualDuration !== undefined && task.actualDuration !== null)
      ? Number(task.actualDuration)
      : null;

    if (actualDuration === null && actualStart && actualEnd) {
      actualDuration = Math.max(0, minFromTime(actualEnd) - minFromTime(actualStart));
    }

    const startDelay = (actualStart && plannedStart)
      ? minFromTime(actualStart) - minFromTime(plannedStart)
      : null;

    const durationVariance = (actualDuration !== null && plannedDuration > 0)
      ? actualDuration - plannedDuration
      : null;

    const scheduleVariance = (actualEnd && plannedEnd)
      ? minFromTime(actualEnd) - minFromTime(plannedEnd)
      : null;

    const isOnTime = startDelay !== null
      ? (Math.abs(startDelay) <= 10 && Math.abs(durationVariance || 0) <= 10)
      : null;

    const normStatus = normalizeStatus(task);
    let effectiveStatus = normStatus;

    // Evaluate overdue if open and passed deadline/date
    if (referenceDate && !isCompleted(task) && normStatus !== EXECUTION_STATES.SKIPPED && normStatus !== EXECUTION_STATES.POSTPONED) {
      const taskDate = task.scheduledDate || task.date;
      if (task.deadline && referenceDate > task.deadline) {
        effectiveStatus = EXECUTION_STATES.OVERDUE;
      } else if (taskDate && referenceDate > taskDate) {
        effectiveStatus = EXECUTION_STATES.OVERDUE;
      } else if (taskDate === referenceDate && referenceTime && plannedEnd) {
        if (minFromTime(referenceTime) > minFromTime(plannedEnd) + 15 && normStatus === EXECUTION_STATES.PLANNED) {
          effectiveStatus = EXECUTION_STATES.OVERDUE;
        }
      }
    }

    return {
      taskId: task.id,
      title: task.title,
      status: effectiveStatus,
      rawStatus: task.status,
      plannedStart,
      plannedEnd,
      plannedDuration,
      actualStart,
      actualEnd,
      actualDuration,
      startDelay,
      durationVariance,
      scheduleVariance,
      isOnTime,
      isCompleted: isCompleted({ status: effectiveStatus }),
      deadline: task.deadline || null,
      scheduledDate: task.scheduledDate || task.date || null
    };
  }

  /**
   * Analyzes execution performance over a specified period (single date or date range).
   *
   * @param {string|Object} period - 'YYYY-MM-DD' or { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
   * @param {Object} context - Standard planning context or object with tasks array
   * @param {Object} [options]
   * @returns {Object} Comprehensive execution report
   */
  function analyzeExecution(period, context = {}, options = {}) {
    let startDate, endDate;
    if (typeof period === 'string') {
      startDate = period;
      endDate = period;
    } else if (period && typeof period === 'object') {
      startDate = period.start || period.startDate || (DateUtil && DateUtil.getTodayAppDate ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10));
      endDate = period.end || period.endDate || startDate;
    } else {
      const today = (DateUtil && DateUtil.getTodayAppDate ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10));
      startDate = today;
      endDate = today;
    }

    const refDate = options.currentDate || context.currentDate || endDate;
    const refTime = options.currentTime || context.currentTime || '23:59';

    const allTasks = context.scheduledTasks || context.tasks || [];

    // Filter tasks that fall within the period
    const periodTasks = allTasks.filter(t => {
      if (!t) return false;
      const tDate = t.scheduledDate || t.date;
      if (!tDate) return false;
      return tDate >= startDate && tDate <= endDate;
    });

    const metricItems = periodTasks.map(t => calculateTaskMetrics(t, refDate, refTime));

    let plannedTasksCount = 0;
    let completedTasksCount = 0;
    let postponedTasksCount = 0;
    let skippedTasksCount = 0;
    let inProgressTasksCount = 0;
    let overdueTasksCount = 0;

    let plannedMinutes = 0;
    let actualMinutes = 0;

    const startDelays = [];
    const durationVariances = [];
    let completedBeforeDeadlineCount = 0;
    let deadlineTrackedCount = 0;

    metricItems.forEach(m => {
      plannedTasksCount++;
      plannedMinutes += m.plannedDuration || 0;

      if (m.actualDuration !== null) {
        actualMinutes += m.actualDuration;
      } else if (m.isCompleted) {
        actualMinutes += m.plannedDuration;
      }

      if (m.status === EXECUTION_STATES.COMPLETED) {
        completedTasksCount++;
        if (m.startDelay !== null) startDelays.push(m.startDelay);
        if (m.durationVariance !== null) durationVariances.push(m.durationVariance);

        if (m.deadline) {
          deadlineTrackedCount++;
          const finishedDate = m.scheduledDate || refDate;
          if (finishedDate <= m.deadline) {
            completedBeforeDeadlineCount++;
          }
        }
      } else if (m.status === EXECUTION_STATES.POSTPONED) {
        postponedTasksCount++;
      } else if (m.status === EXECUTION_STATES.SKIPPED) {
        skippedTasksCount++;
      } else if (m.status === EXECUTION_STATES.IN_PROGRESS) {
        inProgressTasksCount++;
        if (m.startDelay !== null) startDelays.push(m.startDelay);
      } else if (m.status === EXECUTION_STATES.OVERDUE) {
        overdueTasksCount++;
      }
    });

    const completionRate = plannedTasksCount > 0
      ? Math.round((completedTasksCount / plannedTasksCount) * 100)
      : 100;

    const onTimeTasksCount = metricItems.filter(m => m.isCompleted && m.isOnTime === true).length;
    const adherenceRate = completedTasksCount > 0
      ? Math.round((onTimeTasksCount / completedTasksCount) * 100)
      : 100;

    const deadlineSuccessRate = deadlineTrackedCount > 0
      ? Math.round((completedBeforeDeadlineCount / deadlineTrackedCount) * 100)
      : 100;

    const averageStartDelay = startDelays.length > 0
      ? Math.round(startDelays.reduce((a, b) => a + b, 0) / startDelays.length)
      : 0;

    const averageDurationVariance = durationVariances.length > 0
      ? Math.round(durationVariances.reduce((a, b) => a + b, 0) / durationVariances.length)
      : 0;

    // ── Root Cause Analysis (Differentiating DATA vs INFERENCE) ───────────────
    const rootCauses = [];

    // 1. Facts directly from records (DATA)
    metricItems.forEach(m => {
      if (m.startDelay !== null && m.startDelay >= 20) {
        const msg = `Nhiệm vụ "${m.title}" bắt đầu trễ ${m.startDelay} phút (Kế hoạch: ${m.plannedStart}, Thực tế: ${m.actualStart}).`;
        rootCauses.push({
          type: 'data',
          category: 'late_start',
          taskId: m.taskId,
          title: `Trễ giờ: ${m.title}`,
          description: msg,
          message: msg
        });
      }
      if (m.durationVariance !== null && m.durationVariance >= 20) {
        const msg = `Nhiệm vụ "${m.title}" kéo dài thêm ${m.durationVariance} phút so với dự kiến (${m.actualDuration}m / ${m.plannedDuration}m).`;
        rootCauses.push({
          type: 'data',
          category: 'duration_overrun',
          taskId: m.taskId,
          title: `Vượt thời lượng: ${m.title}`,
          description: msg,
          message: msg
        });
      }
      if (m.status === EXECUTION_STATES.POSTPONED) {
        const msg = `Nhiệm vụ "${m.title}" đã được dời lịch sang ngày khác.`;
        rootCauses.push({
          type: 'data',
          category: 'task_postponed',
          taskId: m.taskId,
          title: `Dời lịch: ${m.title}`,
          description: msg,
          message: msg
        });
      }
      if (m.status === EXECUTION_STATES.SKIPPED) {
        const msg = `Nhiệm vụ "${m.title}" đã bị bỏ qua.`;
        rootCauses.push({
          type: 'data',
          category: 'task_skipped',
          taskId: m.taskId,
          title: `Bỏ qua: ${m.title}`,
          description: msg,
          message: msg
        });
      }
      if (m.status === EXECUTION_STATES.OVERDUE) {
        const msg = `Nhiệm vụ "${m.title}" chưa hoàn thành và đã qua khung giờ dự kiến.`;
        rootCauses.push({
          type: 'data',
          category: 'task_overdue',
          taskId: m.taskId,
          title: `Quá hạn: ${m.title}`,
          description: msg,
          message: msg
        });
      }
    });

    // 2. System deductions based on data correlation (INFERENCE)
    if (skippedTasksCount > 0 || overdueTasksCount > 0) {
      const msg = 'Có nhiệm vụ bị bỏ qua hoặc quá hạn, thường do thiếu hụt năng lượng hoặc phân bổ thời gian chưa hợp lý.';
      rootCauses.push({
        type: 'inference',
        category: 'uncompleted_fatigue',
        title: 'Suy giảm hoàn thành về cuối ca',
        description: msg,
        message: msg
      });
    }

    if (startDelays.filter(d => d >= 20).length >= 2) {
      const msg = 'Các ca học bị dồn toa: Khi một ca bắt đầu hoặc kết thúc muộn, các ca liền kề sau đó đều bị đẩy lùi theo.';
      rootCauses.push({
        type: 'inference',
        category: 'cascade_delay',
        title: 'Hiệu ứng dồn toa dây chuyền',
        description: msg,
        message: msg
      });
    }

    if (durationVariances.filter(v => v >= 20).length >= 2) {
      const msg = 'Ước lượng thời gian quá lạc quan: Thời lượng thực tế thường lớn hơn kế hoạch trung bình 20–30%.';
      rootCauses.push({
        type: 'inference',
        category: 'optimistic_estimation',
        title: 'Ước tính thời gian quá lạc quan',
        description: msg,
        message: msg
      });
    }

    if (plannedMinutes > 300 && completionRate < 70) {
      const msg = 'Tải trọng ngày quá lớn (> 5 tiếng học) dẫn đến suy giảm năng lượng vào cuối ngày.';
      rootCauses.push({
        type: 'inference',
        category: 'overloaded_day',
        title: 'Lịch học quá tải',
        description: msg,
        message: msg
      });
    }

    // ── High-Level Insights ──────────────────────────────────────────────────
    const insights = [];
    if (completionRate >= 85) {
      insights.push({
        type: 'success',
        message: `Xuất sắc! Bạn đã hoàn thành ${completionRate}% kế hoạch học tập trong giai đoạn này.`
      });
    } else if (completionRate < 60) {
      insights.push({
        type: 'warning',
        message: `Tỉ lệ hoàn thành đạt ${completionRate}%. Có ${postponedTasksCount + skippedTasksCount + overdueTasksCount} nhiệm vụ chưa thực hiện trọn vẹn.`
      });
    }

    if (averageStartDelay > 15) {
      insights.push({
        type: 'observation',
        message: `Bạn có xu hướng bắt đầu trễ trung bình ${averageStartDelay} phút so với giờ hẹn.`
      });
    }

    if (averageDurationVariance > 15) {
      insights.push({
        type: 'observation',
        message: `Các ca học thực tế thường mất nhiều hơn ${averageDurationVariance} phút so với ước lượng ban đầu.`
      });
    }

    return {
      period: { start: startDate, end: endDate },
      summary: {
        totalTasks: plannedTasksCount,
        completedTasks: completedTasksCount,
        postponedTasks: postponedTasksCount,
        skippedTasks: skippedTasksCount,
        inProgressTasks: inProgressTasksCount,
        overdueTasks: overdueTasksCount,
        plannedMinutes,
        actualMinutes
      },
      metrics: {
        completionRate,
        adherenceRate,
        deadlineSuccessRate,
        avgDelayMinutes: averageStartDelay,
        avgDurationVarianceMinutes: averageDurationVariance
      },
      plannedTasksCount,
      completedTasksCount,
      postponedTasksCount,
      skippedTasksCount,
      inProgressTasksCount,
      overdueTasksCount,
      plannedMinutes,
      actualMinutes,
      completionRate,
      adherenceRate,
      deadlineSuccessRate,
      averageStartDelay,
      averageDurationVariance,
      taskMetrics: metricItems,
      rootCauses,
      insights
    };
  }

  return {
    EXECUTION_STATES,
    normalizeStatus,
    getStandardExecutionState: normalizeStatus,
    isCompleted,
    isOpen,
    calculateTaskMetrics,
    computeTaskExecutionMetrics: calculateTaskMetrics,
    analyzeExecution
  };
}));
