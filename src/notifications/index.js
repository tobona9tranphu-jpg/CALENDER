'use strict';

/**
 * Composite Index for Notifications Module.
 * Bundles types, store, policy, browser adapter, toast UI, scheduler, and service.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const types = require('./notification-types');
    const store = require('./notification-store');
    const policy = require('./notification-policy');
    const browser = require('./browser-notification');
    const toast = require('./toast-ui');
    const scheduler = require('./notification-scheduler');
    const service = require('./notification-service');
    module.exports = factory(types, store, policy, browser, toast, scheduler, service);
  } else {
    root.AppNotification = factory(
      root.NotificationTypes,
      root.NotificationStore,
      root.NotificationPolicy,
      root.BrowserNotification,
      root.ToastUI,
      root.NotificationScheduler,
      root.NotificationService
    );
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (
  types,
  store,
  policy,
  browser,
  toast,
  scheduler,
  service
) {
  return {
    ...types,
    ...store,
    ...policy,
    ...browser,
    ...toast,
    ...scheduler,
    ...service
  };
}));
