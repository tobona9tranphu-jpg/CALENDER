'use strict';

/**
 * @file pattern-detector.js
 * P1.4 Personal Pattern Detection Engine.
 *
 * Deterministic detection of recurring study patterns:
 * 1. late_start_pattern: Repeated delayed starts (>= 15m).
 * 2. duration_underestimate_pattern: Tasks consistently taking >20% longer than planned.
 * 3. underperforming_time_block: Specific hours with low completion rate (<50%).
 *
 * Requirements:
 * - Minimum sample size threshold (N >= 3) to prevent noisy single-case hallucinations.
 * - Confidence score (0.0 to 1.0) mathematically calculated from evidence.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const ExecutionTracker = require('./execution-tracker');
    module.exports = factory(ExecutionTracker);
  } else {
    root.PatternDetector = factory(root.ExecutionTracker);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (ExecutionTracker) {

  const MIN_SAMPLE_SIZE = 3;

  function minFromTime(t) {
    if (!t) return 0;
    const parts = String(t).split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }

  function getTimeWindowLabel(timeStr) {
    if (!timeStr) return 'khác';
    const m = minFromTime(timeStr);
    if (m >= 300 && m < 720) return 'buổi sáng (05:00–12:00)';
    if (m >= 720 && m < 1080) return 'buổi chiều (12:00–18:00)';
    if (m >= 1080 && m < 1320) return 'buổi tối (18:00–22:00)';
    return 'đêm muộn (sau 22:00)';
  }

  function getTimeWindowKey(timeStr) {
    if (!timeStr) return 'other';
    const m = minFromTime(timeStr);
    if (m >= 300 && m < 720) return 'morning';
    if (m >= 720 && m < 1080) return 'afternoon';
    if (m >= 1080 && m < 1320) return 'evening';
    return 'late_night';
  }

  /**
   * Detects patterns across task execution history.
   *
   * @param {Array<Object>} tasks - Task records with planned/actual metrics
   * @param {Object} [options]
   * @param {number} [options.minSampleSize=3]
   * @returns {Array<Object>} Detected patterns with confidence and evidence
   */
  function detectPatterns(tasks = [], options = {}) {
    const minSample = options.minSampleSize || MIN_SAMPLE_SIZE;
    const patterns = [];

    // Filter tasks that have execution data
    const executedTasks = (tasks || []).filter(t => {
      if (!t) return false;
      return t.actualStart || t.actualEnd || t.status === 'completed' || t.status === 'done' || t.status === 'postponed' || t.status === 'skipped';
    });

    if (executedTasks.length < minSample) {
      return patterns; // Insufficient data to form reliable patterns
    }

    // ── 1. Late Start Pattern ────────────────────────────────────────────────
    // Group by time window (morning / afternoon / evening / late_night)
    const windowDelays = {};
    executedTasks.forEach(t => {
      const pStart = t.plannedStart || t.startTime;
      const aStart = t.actualStart;
      if (!pStart || !aStart) return;

      const wKey = getTimeWindowKey(pStart);
      if (!windowDelays[wKey]) {
        windowDelays[wKey] = {
          label: getTimeWindowLabel(pStart),
          delays: [],
          lateCount: 0,
          total: 0
        };
      }

      const delay = minFromTime(aStart) - minFromTime(pStart);
      windowDelays[wKey].total++;
      windowDelays[wKey].delays.push(delay);
      if (delay >= 15) {
        windowDelays[wKey].lateCount++;
      }
    });

    Object.keys(windowDelays).forEach(wKey => {
      const g = windowDelays[wKey];
      if (g.total >= minSample) {
        const lateRatio = g.lateCount / g.total;
        const avgDelay = Math.round(g.delays.reduce((a, b) => a + b, 0) / g.total);

        // Pattern triggers if >= 60% of tasks started >= 15m late and avgDelay >= 12m
        if (lateRatio >= 0.6 && avgDelay >= 12) {
          const confidence = Number(Math.min(0.96, 0.60 + (lateRatio * 0.25) + (Math.min(g.total, 10) / 10) * 0.15).toFixed(2));
          patterns.push({
            type: 'late_start_pattern',
            confidence,
            sampleSize: g.total,
            window: wKey,
            windowLabel: g.label,
            evidence: {
              lateCount: g.lateCount,
              totalSamples: g.total,
              lateRatio: Number(lateRatio.toFixed(2)),
              averageDelayMinutes: avgDelay
            },
            message: `Bạn thường bắt đầu các ca học ${g.label} muộn hơn khoảng ${avgDelay} phút so với giờ hẹn.`,
            actionableRecommendation: `Tăng khoảng đệm bắt đầu (start buffer) thêm ${Math.min(20, Math.ceil(avgDelay / 5) * 5)} phút cho ca học ${g.label}.`
          });
        }
      }
    });

    // ── 2. Duration Underestimate Pattern ────────────────────────────────────
    // Group by subjectId or global
    const subjectDurations = {};
    let globalPlannedDur = 0;
    let globalActualDur = 0;
    let globalDurSamples = 0;
    let globalUnderCount = 0;

    executedTasks.forEach(t => {
      const pDur = Number(t.plannedDuration !== undefined ? t.plannedDuration : (t.durationMinutes || t.minutes || 0));
      const aDur = Number(t.actualDuration !== undefined ? t.actualDuration : (t.actualStart && t.actualEnd ? Math.max(0, minFromTime(t.actualEnd) - minFromTime(t.actualStart)) : 0));

      if (pDur <= 0 || aDur <= 0) return;

      const subId = t.subjectId || 'general';
      if (!subjectDurations[subId]) {
        subjectDurations[subId] = {
          subjectId: subId,
          title: t.subjectName || subId,
          plannedTotal: 0,
          actualTotal: 0,
          samples: 0,
          underCount: 0
        };
      }

      subjectDurations[subId].plannedTotal += pDur;
      subjectDurations[subId].actualTotal += aDur;
      subjectDurations[subId].samples++;
      if (aDur > pDur * 1.15) {
        subjectDurations[subId].underCount++;
      }

      globalPlannedDur += pDur;
      globalActualDur += aDur;
      globalDurSamples++;
      if (aDur > pDur * 1.15) {
        globalUnderCount++;
      }
    });

    // Check by subject
    Object.keys(subjectDurations).forEach(subId => {
      const sd = subjectDurations[subId];
      if (sd.samples >= minSample) {
        const ratio = Number((sd.actualTotal / sd.plannedTotal).toFixed(2));
        const underRatio = sd.underCount / sd.samples;

        if (ratio >= 1.2 && underRatio >= 0.6) {
          const confidence = Number(Math.min(0.95, 0.65 + (underRatio * 0.2) + (Math.min(sd.samples, 8) / 8) * 0.1).toFixed(2));
          patterns.push({
            type: 'duration_underestimate_pattern',
            confidence,
            sampleSize: sd.samples,
            subjectId: subId,
            evidence: {
              underestimatedCount: sd.underCount,
              totalSamples: sd.samples,
              averageDurationMultiplier: ratio
            },
            message: `Các ca học môn "${sd.title}" thường mất nhiều thời gian hơn dự kiến khoảng ${Math.round((ratio - 1) * 100)}%.`,
            actionableRecommendation: `Tăng hệ số thời lượng cho môn này lên x${ratio} khi lập kế hoạch.`
          });
        }
      }
    });

    // ── 3. Underperforming Time Block Pattern ────────────────────────────────
    // Check specific hour ranges (e.g. 20:00-22:00 or 14:00-16:00) with poor completion
    const blockPerformance = {};
    executedTasks.forEach(t => {
      const pStart = t.plannedStart || t.startTime;
      if (!pStart) return;

      const m = minFromTime(pStart);
      const hour = Math.floor(m / 60);
      const blockKey = `${String(hour).padStart(2, '0')}:00–${String(hour + 2).padStart(2, '0')}:00`;

      if (!blockPerformance[blockKey]) {
        blockPerformance[blockKey] = { block: blockKey, total: 0, completed: 0, postponedOrSkipped: 0 };
      }

      blockPerformance[blockKey].total++;
      const isComp = (t.status === 'completed' || t.status === 'done');
      if (isComp) {
        blockPerformance[blockKey].completed++;
      } else if (t.status === 'postponed' || t.status === 'skipped') {
        blockPerformance[blockKey].postponedOrSkipped++;
      }
    });

    Object.keys(blockPerformance).forEach(bKey => {
      const bp = blockPerformance[bKey];
      if (bp.total >= minSample) {
        const compRate = bp.completed / bp.total;
        if (compRate < 0.5) {
          const confidence = Number(Math.min(0.92, 0.60 + ((1 - compRate) * 0.25) + (Math.min(bp.total, 8) / 8) * 0.1).toFixed(2));
          patterns.push({
            type: 'underperforming_time_block_pattern',
            confidence,
            sampleSize: bp.total,
            timeBlock: bp.block,
            evidence: {
              totalTasks: bp.total,
              completedCount: bp.completed,
              completionRate: Number((compRate * 100).toFixed(1))
            },
            message: `Khung giờ ${bp.block} có tỉ lệ hoàn thành thấp (chỉ ${Math.round(compRate * 100)}%).`,
            actionableRecommendation: `Giảm tải trọng học hoặc chuyển các bài tập khó sang khung giờ có năng lượng cao hơn.`
          });
        }
      }
    });

    // Sort by confidence descending
    patterns.sort((a, b) => b.confidence - a.confidence);
    return patterns;
  }

  return {
    MIN_SAMPLE_SIZE,
    detectPatterns
  };
}));
