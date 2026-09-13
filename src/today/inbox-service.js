'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const exportsObj = factory();
    exportsObj.InboxService = exportsObj;
    module.exports = exportsObj;
  } else {
    root.InboxService = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {

  const DateUtil = (typeof AppDate !== 'undefined')
    ? AppDate
    : (typeof require === 'function' ? (function() { try { return require('../utils/date'); } catch { return null; } })() : null);

  function isInboxItem(task) {
    if (!task) return false;
    if (task.isInbox === true) return true;
    if (task.isInbox === false) return false;
    return !task.deadline && !task.scheduledDate;
  }

  function getInboxItems(tasks = []) {
    return (tasks || []).filter(t => t && t.status !== 'done' && isInboxItem(t));
  }

  function scheduleItem(task, targetDate) {
    if (!task) return null;
    task.deadline = targetDate;
    task.scheduledDate = targetDate;
    task.isInbox = false;
    return task;
  }

  function moveToInbox(task) {
    if (!task) return null;
    task.deadline = null;
    task.scheduledDate = null;
    task.isInbox = true;
    return task;
  }

  function postponeItem(task, daysOrDate, baseDate = null) {
    if (!task) return null;
    let target = null;
    if (typeof daysOrDate === 'number') {
      const base = baseDate || task.scheduledDate || task.deadline || (DateUtil ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10));
      target = DateUtil && DateUtil.addAppDays ? DateUtil.addAppDays(base, daysOrDate) : base;
    } else {
      target = daysOrDate;
    }
    task.deadline = target;
    task.scheduledDate = target;
    task.isInbox = false;
    return task;
  }

  return {
    isInboxItem,
    getInboxItems,
    scheduleItem,
    moveToInbox,
    postponeItem
  };
}));
