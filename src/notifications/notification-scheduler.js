'use strict';

/**
 * Notification Scheduler - Reconciles events, tasks, and reviews against current time.
 * Calculates trigger timings, detects overdue items, reschedules when items move, and cancels deleted items.
 *
 * Uses AppDate (UTC+7 / Asia/Ho_Chi_Minh) strictly for all date/time calculations.
 *
 * Designed to be UMD compliant (usable in both Node.js / Jest tests and Browser environments).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const types = require('./notification-types');
    const policy = require('./notification-policy');
    const dateUtil = require('../utils/date');
    const recurrence = require('../recurrence/recurrence-engine');
    module.exports = factory(types, policy, dateUtil, recurrence);
  } else {
    root.NotificationScheduler = factory(root.NotificationTypes, root.NotificationPolicy, root.AppDate, root.RecurrenceEngine);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (types, policy, AppDate, RecurrenceEngine) {

  const { NotificationType, NotificationPriority, NotificationSeverity, createNotification } = types || {};
  const { generateDedupeKey } = policy || {};

  const DEFAULT_REMINDER_ADVANCE_MINUTES = 15;

  class NotificationScheduler {
    /**
     * @param {Object} options
     * @param {Object} options.store - Instance of NotificationStore
     * @param {Function} options.onTrigger - Callback when a notification is triggered: (notification) => void
     * @param {number} [options.advanceMinutes=15]
     */
    constructor(options = {}) {
      this.store = options.store;
      this.onTrigger = options.onTrigger || (() => {});
      this.advanceMinutes = options.advanceMinutes || DEFAULT_REMINDER_ADVANCE_MINUTES;
      this._timer = null;
      this._lastKnownState = new Map(); // entityId -> snapshotString
    }

    /**
     * Calculates the scheduled trigger time for a calendar event or fixed schedule.
     *
     * @param {string} eventDate - 'YYYY-MM-DD'
     * @param {string} startTime - 'HH:mm'
     * @param {number} [advanceMinutes]
     * @returns {{ triggerDate: string, triggerTime: string, isDueNow: boolean }}
     */
    calculateEventTrigger(eventDate, startTime, advanceMinutes = this.advanceMinutes) {
      if (!AppDate) throw new Error('AppDate is required for NotificationScheduler');

      const reminder = AppDate.calculateReminderTiming(eventDate, startTime, advanceMinutes);
      const today = AppDate.getTodayAppDate();
      const nowMinutes = AppDate.getAppTimeMinutes();
      const triggerMinutes = AppDate.minFromTime(reminder.time);

      let isDueNow = false;
      // If reminder date is today and now is at or past the trigger time (within a 30m window)
      if (reminder.date === today) {
        if (nowMinutes >= triggerMinutes && nowMinutes <= triggerMinutes + 30) {
          isDueNow = true;
        }
      }

      return {
        triggerDate: reminder.date,
        triggerTime: reminder.time,
        isDueNow
      };
    }

    /**
     * Reconciles current user data (fixedSchedules, tasks, reviewSchedules) and triggers due notifications.
     *
     * @param {Object} currentUser
     * @param {Date} [nowInstant=new Date()]
     * @returns {Array<Object>} List of newly triggered notifications
     */
    reconcile(currentUser, nowInstant = new Date()) {
      if (!currentUser || !this.store || !AppDate) return [];

      const triggered = [];
      const today = AppDate.getTodayAppDate(nowInstant);
      const nowMinutes = AppDate.getAppTimeMinutes(nowInstant);
      const currentWeekday = AppDate.getAppDayOfWeek(today); // 0 = Sun, 1 = Mon ...

      // 1. Check Fixed Schedules / School periods / Recurring Events for today
      const fixedSchedules = Array.isArray(currentUser.fixedSchedules) ? currentUser.fixedSchedules : [];
      
      // Expand occurrences for today [today, today]
      let todaysSlots = [];
      for (const series of fixedSchedules) {
        if (RecurrenceEngine && (series.recurrence || Array.isArray(series.exceptions))) {
          const expanded = RecurrenceEngine.expandOccurrences(series, today, today);
          for (const occ of expanded) {
            todaysSlots.push({
              ...occ,
              id: occ.id,
              seriesId: series.id,
              title: occ.title || series.title,
              start: occ.start || series.start,
              end: occ.end || series.end
            });
          }
        } else {
          // Standard / legacy fixed slot by weekday
          if (series.day === currentWeekday && series.start) {
            todaysSlots.push({
              ...series,
              id: series.id || `${series.title}-${series.day}-${series.start}`,
              seriesId: series.id
            });
          }
        }
      }

      for (const slot of todaysSlots) {
        if (!slot.start) continue;

        const slotId = slot.id;
        const currentSnapshot = `${slot.title}|${slot.start}|${slot.end}`;
        const previousSnapshot = this._lastKnownState.get(slotId);

        // If slot moved or modified, invalidate previous dedupe keys so the new time can fire
        if (previousSnapshot && previousSnapshot !== currentSnapshot) {
          this.store.clearFiredKeysPrefix(`event:${slotId}:`);
        }
        this._lastKnownState.set(slotId, currentSnapshot);

        const eventMins = AppDate.minFromTime(slot.start);
        const triggerMins = eventMins - this.advanceMinutes;

        // Is it time to fire the reminder? (window: from triggerMins to triggerMins + 20 mins, and before slot ends)
        if (nowMinutes >= triggerMins && nowMinutes < eventMins + 15) {
          const dedupeKey = generateDedupeKey({
            sourceType: 'event',
            sourceId: slotId,
            type: NotificationType.EVENT_REMINDER,
            timingKey: `${today}T${slot.start}`
          });

          if (!this.store.hasFiredKey(dedupeKey)) {
            const notif = createNotification({
              type: NotificationType.EVENT_REMINDER,
              severity: NotificationSeverity.INFO,
              priority: NotificationPriority.HIGH,
              title: `Sắp đến giờ: ${slot.title}`,
              message: `Bắt đầu lúc ${slot.start} (còn ${Math.max(0, eventMins - nowMinutes)} phút)`,
              sourceType: 'event',
              sourceId: slotId,
              dedupeKey,
              metadata: { slot, today }
            });
            triggered.push(notif);
          }
        }
      }

      // 2. Check Overdue Tasks & Deadlines
      const tasks = Array.isArray(currentUser.tasks) ? currentUser.tasks : [];
      for (const task of tasks) {
        if (task.status === 'done') {
          // If completed, ensure any pending overdue keys are cleared if needed
          continue;
        }

        const taskId = task.id;
        // Support task.deadline, task.scheduledDate, or legacy task.date
        const taskDeadline = task.deadline || task.scheduledDate || task.date || null;
        const currentTaskSnapshot = `${task.title}|${taskDeadline}|${task.priority}|${task.status}`;
        this._lastKnownState.set(`task-${taskId}`, currentTaskSnapshot);

        // Check overdue (task deadline is before today)
        if (taskDeadline && taskDeadline < today) {
          const dedupeKey = generateDedupeKey({
            sourceType: 'task',
            sourceId: taskId,
            type: NotificationType.TASK_OVERDUE,
            timingKey: `${today}` // Fire at most once per day for overdue tasks
          });

          if (!this.store.hasFiredKey(dedupeKey)) {
            const daysOverdue = AppDate.diffAppCalendarDays(today, taskDeadline);
            const notif = createNotification({
              type: NotificationType.TASK_OVERDUE,
              severity: NotificationSeverity.WARNING,
              priority: NotificationPriority.HIGH,
              title: `Nhiệm vụ quá hạn: ${task.title}`,
              message: `Đã quá hạn ${daysOverdue} ngày (${AppDate.formatShortDate(taskDeadline)}). Hãy hoàn thành hoặc điều chỉnh lịch.`,
              sourceType: 'task',
              sourceId: taskId,
              dedupeKey,
              metadata: { task, daysOverdue }
            });
            triggered.push(notif);
          }
        } else if (taskDeadline === today) {
          // Due today
          const dedupeKey = generateDedupeKey({
            sourceType: 'task',
            sourceId: taskId,
            type: NotificationType.TASK_REMINDER,
            timingKey: `${today}`
          });

          if (!this.store.hasFiredKey(dedupeKey)) {
            const notif = createNotification({
              type: NotificationType.TASK_REMINDER,
              severity: NotificationSeverity.INFO,
              priority: NotificationPriority.MEDIUM,
              title: `Hôm nay cần làm: ${task.title}`,
              message: `Thời lượng dự kiến ${task.minutes || 30} phút · Ưu tiên ${task.priority || 'vừa'}`,
              sourceType: 'task',
              sourceId: taskId,
              dedupeKey,
              metadata: { task }
            });
            triggered.push(notif);
          }
        }
      }


      // 3. Check Spaced Repetition Reviews
      const reviewSchedules = Array.isArray(currentUser.reviewSchedules) ? currentUser.reviewSchedules : [];
      for (const review of reviewSchedules) {
        if (review.status !== 'scheduled') continue;

        if (review.due && review.due <= today) {
          const dedupeKey = generateDedupeKey({
            sourceType: 'review',
            sourceId: review.id,
            type: NotificationType.TASK_REMINDER,
            timingKey: `${today}`
          });

          if (!this.store.hasFiredKey(dedupeKey)) {
            const notif = createNotification({
              type: NotificationType.TASK_REMINDER,
              severity: NotificationSeverity.INFO,
              priority: NotificationPriority.MEDIUM,
              title: 'Đến lịch ôn Spaced Repetition',
              message: `Bạn có chủ đề cần ôn theo chu kỳ ${review.interval || 1} ngày để củng cố trí nhớ.`,
              sourceType: 'review',
              sourceId: review.id,
              dedupeKey,
              metadata: { review }
            });
            triggered.push(notif);
          }
        }
      }

      // Deliver triggered notifications and record their dedupeKeys
      for (const notif of triggered) {
        if (notif.dedupeKey) {
          this.store.recordFiredKey(notif.dedupeKey);
        }
        this.onTrigger(notif);
      }

      return triggered;
    }

    /**
     * Handles removal or deletion of an event/task.
     * Cleans up tracked state and dedupe keys.
     *
     * @param {string} sourceType - 'event' or 'task'
     * @param {string|number} sourceId
     */
    handleItemDeleted(sourceType, sourceId) {
      if (!this.store) return;
      this.store.clearFiredKeysPrefix(`${sourceType}:${sourceId}:`);
      this._lastKnownState.delete(`${sourceType}-${sourceId}`);
    }

    /**
     * Starts periodic reconciliation loop.
     * @param {Function} getCurrentUserFn - Function returning currentUser
     * @param {number} [intervalMs=30000] - Default 30s
     */
    start(getCurrentUserFn, intervalMs = 30000) {
      this.stop();
      // Run once immediately
      try {
        const user = getCurrentUserFn();
        if (user) this.reconcile(user);
      } catch (err) {
        console.error('Error in initial reconciliation run:', err);
      }

      this._timer = setInterval(() => {
        try {
          const user = getCurrentUserFn();
          if (user) this.reconcile(user);
        } catch (err) {
          console.error('Error during scheduled reconciliation:', err);
        }
      }, intervalMs);
    }

    /**
     * Stops the periodic reconciliation loop.
     */
    stop() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    }
  }

  return {
    NotificationScheduler,
    DEFAULT_REMINDER_ADVANCE_MINUTES
  };
}));
