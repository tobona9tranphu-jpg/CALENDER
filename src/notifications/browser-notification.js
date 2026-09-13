'use strict';

/**
 * Browser Notification Adapter - Safe wrapper around standard Web Notification API.
 *
 * Designed to be UMD compliant (usable in both Node.js / Jest tests and Browser environments).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BrowserNotification = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {

  class BrowserNotificationAdapter {
    constructor() {
      this._api = typeof window !== 'undefined' && 'Notification' in window ? window.Notification : null;
    }

    /**
     * Checks if browser notifications are supported in current environment.
     * @returns {boolean}
     */
    isSupported() {
      return Boolean(this._api);
    }

    /**
     * Gets current permission state: 'granted', 'denied', or 'default'.
     * @returns {string}
     */
    getPermission() {
      if (!this.isSupported()) return 'denied';
      return this._api.permission || 'default';
    }

    /**
     * Requests user permission to display browser notifications.
     * @returns {Promise<string>} 'granted', 'denied', or 'default'
     */
    async requestPermission() {
      if (!this.isSupported()) return 'denied';
      try {
        const result = await this._api.requestPermission();
        return result;
      } catch (err) {
        console.warn('Could not request notification permission:', err);
        return 'denied';
      }
    }

    /**
     * Shows a native OS / browser notification if permitted.
     *
     * @param {string} title
     * @param {Object} [options]
     * @param {string} [options.body]
     * @param {string} [options.icon]
     * @param {string} [options.tag]
     * @param {Function} [options.onClick]
     * @returns {Notification|null} Native notification instance or null
     */
    show(title, options = {}) {
      if (!this.isSupported() || this.getPermission() !== 'granted') {
        return null;
      }

      try {
        const notif = new this._api(title, {
          body: options.body || '',
          icon: options.icon || '/icon.png',
          tag: options.tag || undefined
        });

        if (typeof options.onClick === 'function') {
          notif.onclick = (event) => {
            try {
              window.focus();
              options.onClick(event);
            } catch (e) {
              console.warn('Error in browser notification click handler:', e);
            }
          };
        }

        return notif;
      } catch (err) {
        console.warn('Could not display browser notification:', err);
        return null;
      }
    }
  }

  return {
    BrowserNotificationAdapter
  };
}));
