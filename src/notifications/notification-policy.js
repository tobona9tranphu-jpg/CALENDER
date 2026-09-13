'use strict';

/**
 * Notification Policy - Manages deduplication keys, quiet hours evaluation, and priority resolution.
 *
 * Designed to be UMD compliant (usable in both Node.js / Jest tests and Browser environments).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const types = require('./notification-types');
    const dateUtil = require('../utils/date');
    module.exports = factory(types, dateUtil);
  } else {
    root.NotificationPolicy = factory(root.NotificationTypes, root.AppDate);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (types, AppDate) {

  const { NotificationType, NotificationPriority, NotificationSeverity } = types || {};

  // Default Quiet Hours in Vietnam Time (22:00 to 07:00)
  const DEFAULT_QUIET_HOURS_START = '22:00';
  const DEFAULT_QUIET_HOURS_END = '07:00';

  /**
   * Generates a deterministic deduplication key for a notification.
   *
   * Scheme: `${sourceType}:${sourceId}:${type}:${timingKey}`
   *
   * @param {Object} params
   * @param {string} params.sourceType - 'event', 'task', 'review', 'system'
   * @param {string|number} params.sourceId - ID of the entity
   * @param {string} params.type - NotificationType enum
   * @param {string} [params.timingKey=''] - Date or timestamp (e.g. '2026-09-13T18:45')
   * @returns {string} Deterministic key
   */
  function generateDedupeKey({ sourceType, sourceId, type, timingKey = '' }) {
    const sType = String(sourceType || 'system').toLowerCase();
    const sId = String(sourceId || 'general');
    const nType = String(type || 'notice').toLowerCase();
    const tKey = timingKey ? `:${timingKey}` : '';
    return `${sType}:${sId}:${nType}${tKey}`;
  }

  /**
   * Checks whether a given instant falls inside Quiet Hours.
   * Uses AppDate for Vietnam time (UTC+7) calculations.
   *
   * @param {Date} [instant=new Date()]
   * @param {Object} [config]
   * @param {string} [config.start='22:00']
   * @param {string} [config.end='07:00']
   * @param {boolean} [config.enabled=true]
   * @returns {boolean} True if quiet hours active
   */
  function isQuietHours(instant = new Date(), config = {}) {
    if (config.enabled === false) return false;

    const startStr = config.start || DEFAULT_QUIET_HOURS_START;
    const endStr = config.end || DEFAULT_QUIET_HOURS_END;

    let minNow = 0;
    if (AppDate && typeof AppDate.getAppTimeMinutes === 'function') {
      minNow = AppDate.getAppTimeMinutes(instant);
    } else {
      // Fallback: calculate minutes from local date if AppDate not provided
      minNow = instant.getHours() * 60 + instant.getMinutes();
    }

    const [startH, startM] = startStr.split(':').map(Number);
    const [endH, endM] = endStr.split(':').map(Number);
    const minStart = startH * 60 + (startM || 0);
    const minEnd = endH * 60 + (endM || 0);

    if (minStart > minEnd) {
      // Overnight range, e.g. 22:00 to 07:00
      return minNow >= minStart || minNow < minEnd;
    } else {
      // Same-day range, e.g. 13:00 to 14:00
      return minNow >= minStart && minNow < minEnd;
    }
  }

  /**
   * Evaluates notification delivery policy given current time and quiet hours setting.
   *
   * Rules:
   * 1. CRITICAL priority notifications bypass quiet hours and are delivered immediately with toast/alert.
   * 2. During quiet hours, non-critical notifications are saved to store (unread badge) but toast/sound is suppressed.
   * 3. Outside quiet hours, all valid notifications are delivered to both UI toast and notification store.
   *
   * @param {Object} notification
   * @param {Object} [options]
   * @param {Date} [options.now=new Date()]
   * @param {Object} [options.quietHoursConfig]
   * @returns {Object} { deliverToast: boolean, deliverStore: boolean, reason: string }
   */
  function evaluateDeliveryPolicy(notification, options = {}) {
    const now = options.now || new Date();
    const quietHoursActive = isQuietHours(now, options.quietHoursConfig);

    if (notification.priority === (NotificationPriority?.CRITICAL || 'CRITICAL')) {
      return {
        deliverToast: true,
        deliverStore: true,
        reason: 'CRITICAL priority bypasses quiet hours'
      };
    }

    if (quietHoursActive) {
      return {
        deliverToast: false,
        deliverStore: true,
        reason: 'Quiet hours active: suppressed toast, saved to store'
      };
    }

    return {
      deliverToast: true,
      deliverStore: true,
      reason: 'Normal delivery'
    };
  }

  return {
    DEFAULT_QUIET_HOURS_START,
    DEFAULT_QUIET_HOURS_END,
    generateDedupeKey,
    isQuietHours,
    evaluateDeliveryPolicy
  };
}));
