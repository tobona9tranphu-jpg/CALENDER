'use strict';

/**
 * Notification Service - Central facade coordinating Store, Policy, Scheduler, ToastUI, and BrowserNotification.
 *
 * Designed to be UMD compliant (usable in both Node.js / Jest tests and Browser environments).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const types = require('./notification-types');
    const { NotificationStore } = require('./notification-store');
    const policy = require('./notification-policy');
    const { BrowserNotificationAdapter } = require('./browser-notification');
    const { ToastUI } = require('./toast-ui');
    const { NotificationScheduler } = require('./notification-scheduler');
    module.exports = factory(types, NotificationStore, policy, BrowserNotificationAdapter, ToastUI, NotificationScheduler);
  } else {
    root.NotificationService = factory(
      root.NotificationTypes,
      root.NotificationStore ? root.NotificationStore.NotificationStore : null,
      root.NotificationPolicy,
      root.BrowserNotification ? root.BrowserNotification.BrowserNotificationAdapter : null,
      root.ToastUI ? root.ToastUI.ToastUI : null,
      root.NotificationScheduler ? root.NotificationScheduler.NotificationScheduler : null
    );
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (
  types,
  NotificationStore,
  policy,
  BrowserNotificationAdapter,
  ToastUI,
  NotificationScheduler
) {

  const { NotificationType, NotificationSeverity, NotificationPriority, createNotification } = types || {};
  const { evaluateDeliveryPolicy } = policy || {};

  class NotificationService {
    /**
     * @param {Object} [options]
     * @param {Object} [options.store]
     * @param {Object} [options.toast]
     * @param {Object} [options.browser]
     * @param {Object} [options.scheduler]
     * @param {Object} [options.quietHours]
     */
    constructor(options = {}) {
      this.store = options.store || (NotificationStore ? new NotificationStore() : null);
      this.toast = options.toast || (ToastUI ? new ToastUI() : null);
      this.browser = options.browser || (BrowserNotificationAdapter ? new BrowserNotificationAdapter() : null);
      this.quietHours = options.quietHours || { start: '22:00', end: '07:00', enabled: true };

      if (NotificationScheduler && this.store) {
        this.scheduler = options.scheduler || new NotificationScheduler({
          store: this.store,
          onTrigger: (notif) => this.deliver(notif)
        });
      } else {
        this.scheduler = options.scheduler || null;
      }
    }

    /**
     * Creates and dispatches a notification through policy checks.
     *
     * @param {Object} params - Creation params or full notification
     * @param {Object} [options]
     * @returns {Object|null} The stored notification or null
     */
    notify(params, options = {}) {
      if (!params) return null;

      let notif;
      if (typeof params === 'string') {
        // Shorthand for simple toast string: notify("Xin chào")
        notif = createNotification({
          title: 'Thông báo',
          message: params,
          type: NotificationType?.SYSTEM_FEEDBACK || 'SYSTEM_FEEDBACK',
          severity: NotificationSeverity?.INFO || 'info'
        });
      } else {
        notif = params.id ? params : createNotification(params);
      }

      return this.deliver(notif, options);
    }

    /**
     * Internal delivery pipeline:
     * 1. Evaluates quiet hours & priority
     * 2. Saves to store (checking dedupe key)
     * 3. If policy permits, displays accessible Toast
     * 4. If policy permits and browser notifications enabled, sends system alert
     *
     * @param {Object} notif
     * @param {Object} [options]
     * @returns {Object|null}
     */
    deliver(notif, options = {}) {
      if (!notif) return null;

      // Evaluate delivery policy
      const decision = (options.forceToast || notif.priority === (NotificationPriority?.CRITICAL || 'CRITICAL')) ? {
        deliverToast: true,
        deliverStore: true,
        reason: 'Forced or CRITICAL delivery'
      } : (evaluateDeliveryPolicy ? evaluateDeliveryPolicy(notif, {
        now: options.now || new Date(),
        quietHoursConfig: this.quietHours
      }) : { deliverToast: true, deliverStore: true });

      let stored = notif;
      if (this.store && decision.deliverStore) {
        stored = this.store.add(notif);
        if (!stored) {
          // Deduplicated by store
          return null;
        }
      }

      // Deliver toast if permitted
      if (decision.deliverToast && this.toast) {
        this.toast.show(stored, options);
      }

      // Deliver native browser notification if permitted and appropriate
      if (decision.deliverToast && this.browser && this.browser.isSupported() && this.browser.getPermission() === 'granted') {
        // Only fire native browser notification for event/task alerts, not mundane UI feedback
        if (stored.type !== NotificationType.SYSTEM_FEEDBACK) {
          this.browser.show(stored.title, {
            body: stored.message,
            tag: stored.dedupeKey || undefined
          });
        }
      }

      return stored;
    }

    /**
     * Shorthand for success notification.
     */
    success(message, title = 'Thành công', options = {}) {
      return this.notify({
        title,
        message,
        type: NotificationType.SYSTEM_FEEDBACK,
        severity: NotificationSeverity.SUCCESS,
        priority: NotificationPriority.LOW
      }, options);
    }

    /**
     * Shorthand for error / danger notification.
     */
    error(message, title = 'Lỗi', options = {}) {
      return this.notify({
        title,
        message,
        type: NotificationType.SYSTEM_FEEDBACK,
        severity: NotificationSeverity.DANGER,
        priority: NotificationPriority.HIGH
      }, options);
    }

    /**
     * Shorthand for warning notification.
     */
    warning(message, title = 'Lưu ý', options = {}) {
      return this.notify({
        title,
        message,
        type: NotificationType.SYSTEM_FEEDBACK,
        severity: NotificationSeverity.WARNING,
        priority: NotificationPriority.MEDIUM
      }, options);
    }

    /**
     * Shorthand for info notification.
     */
    info(message, title = 'Thông báo', options = {}) {
      return this.notify({
        title,
        message,
        type: NotificationType.SYSTEM_FEEDBACK,
        severity: NotificationSeverity.INFO,
        priority: NotificationPriority.LOW
      }, options);
    }
  }

  return {
    NotificationService
  };
}));
