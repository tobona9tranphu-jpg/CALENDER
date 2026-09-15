'use strict';

/**
 * @file adaptive-learning.js
 * P1.4 Adaptive Learning Engine.
 *
 * Translates observed execution patterns into rule-based soft planner preferences:
 * - preferredStartBuffer (min)
 * - durationMultipliers (per subject)
 * - eveningLoadAdjustment (%)
 * - preferredBreakMinutes (min)
 *
 * Rules:
 * - Gradual Updates: New value = 0.7 * old + 0.3 * observed.
 * - Non-destructive Reset: Clears learned parameters without deleting task history.
 * - Transparency: Emits explicit recommendation proposals that the user can accept or decline.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const PatternDetector = require('./pattern-detector');
    module.exports = factory(PatternDetector);
  } else {
    root.AdaptiveLearning = factory(root.PatternDetector);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (PatternDetector) {

  const DEFAULT_PREFERENCES = Object.freeze({
    enabled: true,
    preferredStartBuffer: 0,
    durationMultipliers: {},
    eveningLoadAdjustment: 0,
    preferredBreakMinutes: 10,
    acceptedRecommendations: []
  });

  function getBasePreferences(current) {
    const cur = current || {};
    return {
      enabled: cur.enabled !== false,
      preferredStartBuffer: Number(cur.preferredStartBuffer || 0),
      durationMultipliers: { ...(cur.durationMultipliers || {}) },
      eveningLoadAdjustment: Number(cur.eveningLoadAdjustment || 0),
      preferredBreakMinutes: Number(cur.preferredBreakMinutes || 10),
      acceptedRecommendations: Array.isArray(cur.acceptedRecommendations) ? [...cur.acceptedRecommendations] : []
    };
  }

  /**
   * Resets learned preferences to defaults without modifying task history.
   *
   * @param {Object} [current]
   * @returns {Object} Clean default preferences
   */
  function resetLearnedPreferences(current = {}) {
    return {
      enabled: current.enabled !== false,
      preferredStartBuffer: 0,
      durationMultipliers: {},
      eveningLoadAdjustment: 0,
      preferredBreakMinutes: 10,
      acceptedRecommendations: [],
      lastResetAt: new Date().toISOString()
    };
  }

  /**
   * Generates actionable recommendations from detected patterns.
   *
   * @param {Array<Object>} patterns - Output from PatternDetector.detectPatterns
   * @param {Object} currentPreferences - Active learned preferences
   * @returns {Array<Object>} Actionable recommendation objects
   */
  function generateRecommendations(patterns = [], currentPreferences = {}) {
    const prefs = getBasePreferences(currentPreferences);
    const recs = [];

    patterns.forEach(p => {
      if (!p || p.confidence < 0.70) return;

      if (p.type === 'late_start_pattern') {
        const proposedBuffer = Math.min(25, Math.max(10, Math.round((p.evidence?.averageDelayMinutes || 15) / 5) * 5));
        if (prefs.preferredStartBuffer < proposedBuffer) {
          recs.push({
            id: `rec-buffer-${p.window || 'evening'}`,
            type: 'start_buffer',
            title: `Tăng đệm bắt đầu buổi học (+${proposedBuffer}p)`,
            description: `Hệ thống ghi nhận bạn thường bắt đầu ca học muộn khoảng ${p.evidence?.averageDelayMinutes} phút. Thêm đệm sẽ giúp bạn không bị trễ lịch.`,
            confidence: p.confidence,
            sampleSize: p.sampleSize,
            key: 'preferredStartBuffer',
            value: proposedBuffer,
            applied: prefs.preferredStartBuffer === proposedBuffer
          });
        }
      } else if (p.type === 'duration_underestimate_pattern') {
        const subId = p.subjectId || 'general';
        const observedRatio = p.evidence?.averageDurationMultiplier || 1.25;
        const currentMultiplier = prefs.durationMultipliers[subId] || 1.0;
        // Gradual smoothing: 70% current + 30% observed
        const smoothed = Number(Math.min(1.5, Math.max(1.05, currentMultiplier * 0.7 + observedRatio * 0.3)).toFixed(2));

        if (Math.abs(smoothed - currentMultiplier) >= 0.05) {
          recs.push({
            id: `rec-duration-${subId}`,
            type: 'duration_multiplier',
            subjectId: subId,
            title: `Tăng dự toán thời gian môn ${subId} (x${smoothed})`,
            description: `Thực tế bạn thường mất nhiều thời gian hơn dự kiến cho môn này. Điều chỉnh hệ số giúp tránh bị dồn toa ca sau.`,
            confidence: p.confidence,
            sampleSize: p.sampleSize,
            key: `durationMultipliers.${subId}`,
            value: smoothed,
            applied: prefs.durationMultipliers[subId] === smoothed
          });
        }
      } else if (p.type === 'underperforming_time_block_pattern') {
        if (prefs.eveningLoadAdjustment > -20) {
          recs.push({
            id: `rec-evening-load`,
            type: 'evening_load',
            title: `Giảm 20% tải trọng học khung giờ ${p.timeBlock || 'buổi tối'}`,
            description: `Tỉ lệ hoàn thành trong khung giờ này khá thấp (${p.evidence?.completionRate}%). Giảm tải trọng giúp bạn tập trung hiệu quả hơn.`,
            confidence: p.confidence,
            sampleSize: p.sampleSize,
            key: 'eveningLoadAdjustment',
            value: -20,
            applied: prefs.eveningLoadAdjustment === -20
          });
        }
      }
    });

    return recs;
  }

  /**
   * Applies a specific recommendation value into preferences.
   *
   * @param {Object} currentPreferences
   * @param {string} key - e.g. 'preferredStartBuffer' or 'durationMultipliers.math'
   * @param {*} value
   * @returns {Object} Updated preferences
   */
  function applyRecommendation(currentPreferences, key, value) {
    const updated = getBasePreferences(currentPreferences);

    if (key.startsWith('durationMultipliers.')) {
      const subId = key.split('.')[1];
      updated.durationMultipliers[subId] = Number(value);
    } else if (key === 'preferredStartBuffer') {
      updated.preferredStartBuffer = Number(value);
    } else if (key === 'eveningLoadAdjustment') {
      updated.eveningLoadAdjustment = Number(value);
    } else if (key === 'preferredBreakMinutes') {
      updated.preferredBreakMinutes = Number(value);
    }

    if (!updated.acceptedRecommendations.includes(key)) {
      updated.acceptedRecommendations.push(key);
    }

    updated.lastUpdated = new Date().toISOString();
    return updated;
  }

  /**
   * Calculates the adapted duration for a task using learned preferences.
   * Strictly enforces constraint bounding so it does not explode schedule length.
   *
   * @param {Object} task
   * @param {Object} preferences
   * @returns {number} Adapted duration in minutes
   */
  function getAdaptedTaskDuration(task, preferences = {}) {
    if (!task) return 30;
    const base = Number(task.durationMinutes !== undefined ? task.durationMinutes : (task.minutes || 30));
    if (!preferences || preferences.enabled === false) return base;

    const multipliers = preferences.durationMultipliers || {};
    const mult = (task.subjectId && multipliers[task.subjectId])
      ? Number(multipliers[task.subjectId])
      : (multipliers.default || 1.0);

    const adapted = Math.round(base * mult);
    // Safety clamp: maximum 1.5x of original duration or +45 minutes
    return Math.min(base + 45, Math.min(240, Math.max(base, adapted)));
  }

  return {
    DEFAULT_PREFERENCES,
    getBasePreferences,
    resetLearnedPreferences,
    generateRecommendations,
    applyRecommendation,
    getAdaptedTaskDuration
  };
}));
