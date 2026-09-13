'use strict';

/**
 * Notification Store - Handles notification persistence, reading, filtering, and fired-keys tracking.
 *
 * Designed to be UMD compliant (usable in both Node.js / Jest tests and Browser environments).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NotificationStore = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {

  const STORAGE_KEY_NOTIFICATIONS = 'TB_NOTIFICATIONS_STATE';
  const STORAGE_KEY_FIRED_KEYS = 'TB_NOTIFICATIONS_FIRED_KEYS';
  const MAX_STORED_NOTIFICATIONS = 100;
  const MAX_FIRED_KEYS = 500;

  class NotificationStore {
    /**
     * @param {Object} [options]
     * @param {Storage} [options.storage] - Defaults to global localStorage if present, or in-memory fallback
     */
    constructor(options = {}) {
      this.storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      this.notifications = [];
      this.firedKeys = new Set();
      this.listeners = new Set();
      this.load();
    }

    /**
     * Loads notifications and deduplication keys from storage.
     */
    load() {
      if (!this.storage) return;

      try {
        const rawNotifs = this.storage.getItem(STORAGE_KEY_NOTIFICATIONS);
        if (rawNotifs) {
          const parsed = JSON.parse(rawNotifs);
          if (Array.isArray(parsed)) {
            this.notifications = parsed;
          }
        }
      } catch (err) {
        console.warn('Could not parse stored notifications:', err);
        this.notifications = [];
      }

      try {
        const rawFired = this.storage.getItem(STORAGE_KEY_FIRED_KEYS);
        if (rawFired) {
          const parsed = JSON.parse(rawFired);
          if (Array.isArray(parsed)) {
            this.firedKeys = new Set(parsed);
          }
        }
      } catch (err) {
        console.warn('Could not parse stored fired keys:', err);
        this.firedKeys = new Set();
      }
    }

    /**
     * Persists notifications and deduplication keys to storage.
     */
    save() {
      if (!this.storage) return;

      try {
        // Keep within bounds
        if (this.notifications.length > MAX_STORED_NOTIFICATIONS) {
          this.notifications = this.notifications.slice(0, MAX_STORED_NOTIFICATIONS);
        }
        this.storage.setItem(STORAGE_KEY_NOTIFICATIONS, JSON.stringify(this.notifications));

        const keysArray = Array.from(this.firedKeys);
        const prunedKeys = keysArray.length > MAX_FIRED_KEYS
          ? keysArray.slice(keysArray.length - MAX_FIRED_KEYS)
          : keysArray;
        this.storage.setItem(STORAGE_KEY_FIRED_KEYS, JSON.stringify(prunedKeys));
      } catch (err) {
        console.warn('Could not persist notifications:', err);
      }
    }

    /**
     * Subscribes a listener to store changes.
     * @param {Function} listener
     * @returns {Function} Unsubscribe callback
     */
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    /**
     * Notifies all registered listeners.
     */
    notifyListeners() {
      for (const listener of this.listeners) {
        try {
          listener(this.notifications);
        } catch (err) {
          console.error('Error in notification listener:', err);
        }
      }
    }

    /**
     * Adds a new notification to the store if it's not already fired or expired.
     *
     * @param {Object} notification
     * @returns {Object|null} The stored notification, or null if deduplicated
     */
    add(notification) {
      if (!notification || !notification.id) return null;

      if (notification.dedupeKey && this.hasFiredKey(notification.dedupeKey)) {
        return null; // Already delivered or recorded
      }

      // Add to front of list
      this.notifications.unshift(notification);

      if (notification.dedupeKey) {
        this.recordFiredKey(notification.dedupeKey);
      }

      this.save();
      this.notifyListeners();
      return notification;
    }

    /**
     * Checks if a dedupe key has already been recorded.
     * @param {string} key
     * @returns {boolean}
     */
    hasFiredKey(key) {
      return this.firedKeys.has(key);
    }

    /**
     * Records a dedupe key into the fired set.
     * @param {string} key
     */
    recordFiredKey(key) {
      if (!key) return;
      this.firedKeys.add(key);
      this.save();
    }

    /**
     * Removes a fired key (e.g. when an event is modified or rescheduled).
     * @param {string} key
     */
    removeFiredKey(key) {
      if (this.firedKeys.delete(key)) {
        this.save();
      }
    }

    /**
     * Clears all fired keys matching a prefix (e.g. "event:ev-123:").
     * @param {string} prefix
     */
    clearFiredKeysPrefix(prefix) {
      let changed = false;
      for (const key of this.firedKeys) {
        if (key.startsWith(prefix)) {
          this.firedKeys.delete(key);
          changed = true;
        }
      }
      if (changed) this.save();
    }

    /**
     * Returns all notifications (excluding dismissed ones if filterDismissed is true).
     * @param {boolean} [filterDismissed=false]
     * @returns {Array<Object>}
     */
    getAll(filterDismissed = false) {
      if (filterDismissed) {
        return this.notifications.filter(n => !n.dismissed);
      }
      return [...this.notifications];
    }

    /**
     * Returns unread, non-dismissed notifications.
     * @returns {Array<Object>}
     */
    getUnread() {
      return this.notifications.filter(n => !n.read && !n.dismissed);
    }

    /**
     * Gets the total unread count.
     * @returns {number}
     */
    getUnreadCount() {
      return this.getUnread().length;
    }

    /**
     * Marks a notification as read.
     * @param {string} id
     * @returns {boolean}
     */
    markAsRead(id) {
      const item = this.notifications.find(n => n.id === id);
      if (item && !item.read) {
        item.read = true;
        this.save();
        this.notifyListeners();
        return true;
      }
      return false;
    }

    /**
     * Marks all notifications as read.
     */
    markAllAsRead() {
      let changed = false;
      for (const item of this.notifications) {
        if (!item.read) {
          item.read = true;
          changed = true;
        }
      }
      if (changed) {
        this.save();
        this.notifyListeners();
      }
    }

    /**
     * Dismisses a notification by ID.
     * @param {string} id
     * @returns {boolean}
     */
    dismiss(id) {
      const item = this.notifications.find(n => n.id === id);
      if (item && !item.dismissed) {
        item.dismissed = true;
        this.save();
        this.notifyListeners();
        return true;
      }
      return false;
    }

    /**
     * Clears all notifications.
     */
    clear() {
      this.notifications = [];
      this.save();
      this.notifyListeners();
    }
  }

  return {
    NotificationStore,
    STORAGE_KEY_NOTIFICATIONS,
    STORAGE_KEY_FIRED_KEYS
  };
}));
