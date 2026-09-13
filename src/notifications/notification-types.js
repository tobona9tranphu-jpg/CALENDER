'use strict';

/**
 * Standard Notification Types, Severities, Priorities, and Factory for the Calendar App.
 *
 * Designed to be UMD compliant (usable in both Node.js / Jest tests and Browser environments).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NotificationTypes = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {

  const NotificationType = Object.freeze({
    EVENT_REMINDER: 'EVENT_REMINDER',
    TASK_REMINDER: 'TASK_REMINDER',
    TASK_OVERDUE: 'TASK_OVERDUE',
    DEADLINE_ALERT: 'DEADLINE_ALERT',
    CONFLICT_WARNING: 'CONFLICT_WARNING',
    SYSTEM_FEEDBACK: 'SYSTEM_FEEDBACK'
  });

  const NotificationSeverity = Object.freeze({
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    DANGER: 'danger'
  });

  const NotificationPriority = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL'
  });

  /**
   * Generates a unique notification ID.
   */
  function generateId(prefix = 'notif') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Creates a standardized notification payload object.
   *
   * @param {Object} params
   * @param {string} [params.id]
   * @param {string} params.type - One of NotificationType
   * @param {string} [params.severity=NotificationSeverity.INFO]
   * @param {string} [params.priority=NotificationPriority.MEDIUM]
   * @param {string} params.title
   * @param {string} params.message
   * @param {string} [params.createdAt] - ISO timestamp or Date string
   * @param {string|null} [params.expiresAt=null]
   * @param {string|null} [params.sourceType=null] - e.g. 'event', 'task', 'review', 'system'
   * @param {string|null} [params.sourceId=null]
   * @param {Object|null} [params.action=null] - { label: string, onClick: function|string }
   * @param {string|null} [params.dedupeKey=null]
   * @param {Object} [params.metadata={}]
   * @returns {Object} Standardized notification
   */
  function createNotification(params) {
    if (!params || !params.title || !params.message) {
      throw new Error('createNotification requires at least title and message');
    }

    const type = params.type || NotificationType.SYSTEM_FEEDBACK;
    const severity = params.severity || NotificationSeverity.INFO;
    const priority = params.priority || NotificationPriority.MEDIUM;
    const createdAt = params.createdAt || new Date().toISOString();
    const id = params.id || generateId();

    return {
      id,
      type,
      severity,
      priority,
      title: String(params.title),
      message: String(params.message),
      createdAt,
      expiresAt: params.expiresAt || null,
      sourceType: params.sourceType || null,
      sourceId: params.sourceId ? String(params.sourceId) : null,
      action: params.action || null,
      dedupeKey: params.dedupeKey || null,
      metadata: params.metadata || {},
      read: Boolean(params.read),
      dismissed: Boolean(params.dismissed)
    };
  }

  return {
    NotificationType,
    NotificationSeverity,
    NotificationPriority,
    generateId,
    createNotification
  };
}));
