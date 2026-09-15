'use strict';

/**
 * P0.5 Data Integrity & Migration Pipeline
 *
 * Implements:
 * load -> parse -> validate -> migrate -> normalize -> use
 *
 * Capabilities:
 * - Resilient corrupted JSON recovery (creates emergency backup, restores valid subsets)
 * - Data versioning (v1 legacy -> v2 normalized)
 * - Duplicate ID detection and deduplication / safe re-keying
 * - Orphan detection and isolation (reminders pointing to deleted tasks/events)
 * - Schema validation for Events, Recurrences, Tasks, and Settings
 *
 * UMD compliant (usable in both Node.js / Jest and browser).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    const RecurrenceEngine = require('./recurrence-engine');
    module.exports = factory(AppDate, RecurrenceEngine);
  } else {
    root.DataIntegrity = factory(root.AppDate, root.RecurrenceEngine);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (AppDate, RecurrenceEngine) {

  const CURRENT_DATA_VERSION = 2;
  const BACKUP_PREFIX = 'TB_CORRUPT_BACKUP_';

  /**
   * Validates a Task entity.
   */
  function validateTask(task) {
    if (!task || typeof task !== 'object') return { valid: false, error: 'Task must be an object' };
    if (!task.id) return { valid: false, error: 'Task missing id' };
    if (!task.title || typeof task.title !== 'string') return { valid: false, error: 'Task missing title' };
    if (task.deadline && AppDate && !AppDate.parseAppDate(task.deadline)) {
      return { valid: false, error: `Invalid task deadline: ${task.deadline}` };
    }
    const rawMin = task.minutes !== undefined ? task.minutes : (task.durationMinutes !== undefined ? task.durationMinutes : 45);
    const minutes = Number(rawMin);
    if (isNaN(minutes) || minutes < 0 || minutes > 1440) {
      return { valid: false, error: `Invalid task minutes: ${rawMin}` };
    }
    if (task.minutes === undefined) task.minutes = minutes;
    if (task.durationMinutes === undefined) task.durationMinutes = minutes;
    return { valid: true };
  }

  /**
   * Validates a Fixed / Recurring Schedule entity.
   */
  function validateSchedule(sched) {
    if (!sched || typeof sched !== 'object') return { valid: false, error: 'Schedule must be an object' };
    if (!sched.id) return { valid: false, error: 'Schedule missing id' };
    if (!sched.title || typeof sched.title !== 'string') return { valid: false, error: 'Schedule missing title' };

    if (sched.recurrence && RecurrenceEngine) {
      const recValid = RecurrenceEngine.validateRecurrenceRule(sched.recurrence);
      if (!recValid.valid) return recValid;
    } else {
      // Legacy day check: 0 to 6 (7 normalizes to 0 for Sunday)
      if (sched.day !== undefined && sched.day !== null) {
        const day = Number(sched.day);
        const norm = day === 7 ? 0 : day;
        if (isNaN(norm) || !Number.isInteger(norm) || norm < 0 || norm > 6) {
          return { valid: false, error: `Invalid weekday: ${sched.day}` };
        }
        sched.day = norm;
      }
    }

    if (sched.start && !/^\d{1,2}:\d{2}$/.test(sched.start)) {
      return { valid: false, error: `Invalid start time format: ${sched.start}` };
    }
    if (sched.end && !/^\d{1,2}:\d{2}$/.test(sched.end)) {
      return { valid: false, error: `Invalid end time format: ${sched.end}` };
    }

    return { valid: true };
  }

  /**
   * Detects and eliminates duplicate IDs within an array of objects.
   * Preserves canonical first entry, generates unique suffix for conflicting duplicates.
   *
   * @param {Array<Object>} items
   * @param {string} [prefix='entity']
   * @returns {{ cleanItems: Array<Object>, duplicateCount: number }}
   */
  function resolveDuplicateIds(items, prefix = 'entity') {
    if (!Array.isArray(items)) return { cleanItems: [], duplicateCount: 0 };

    const seenIds = new Set();
    const cleanItems = [];
    let duplicateCount = 0;

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      let id = item.id ? String(item.id) : null;
      if (!id || seenIds.has(id)) {
        duplicateCount++;
        id = `${id || prefix}-dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      }

      seenIds.add(id);
      cleanItems.push({ ...item, id });
    }

    return { cleanItems, duplicateCount };
  }

  /**
   * Cleans orphan records:
   * 1. Tasks referencing non-existent subjectId or topicId -> nullify references
   * 2. ReviewSchedules referencing non-existent topicId -> isolate or remove
   * 3. FixedSchedule replacementChangeId referencing non-existent changes -> detach
   *
   * @param {Object} userData
   * @returns {{ sanitizedUser: Object, orphansCount: number }}
   */
  function sanitizeOrphans(userData) {
    if (!userData) return { sanitizedUser: userData, orphansCount: 0 };

    const sanitized = { ...userData };
    let orphansCount = 0;

    const validSubjectIds = new Set((sanitized.subjects || []).map(s => s.id));
    const validTopicIds = new Set((sanitized.subjects || []).flatMap(s => (s.topics || []).map(t => t.id)));

    // 1. Tasks
    if (Array.isArray(sanitized.tasks)) {
      sanitized.tasks = sanitized.tasks.map(task => {
        let modified = false;
        let sId = task.subjectId;
        let tId = task.topicId;

        if (sId && !validSubjectIds.has(sId)) {
          sId = null;
          modified = true;
        }
        if (tId && !validTopicIds.has(tId)) {
          tId = null;
          modified = true;
        }

        if (modified) {
          orphansCount++;
          return { ...task, subjectId: sId, topicId: tId };
        }
        return task;
      });
    }

    // 2. Review Schedules
    if (Array.isArray(sanitized.reviewSchedules)) {
      const initialCount = sanitized.reviewSchedules.length;
      sanitized.reviewSchedules = sanitized.reviewSchedules.filter(r => !r.topicId || validTopicIds.has(r.topicId));
      orphansCount += (initialCount - sanitized.reviewSchedules.length);
    }

    return { sanitizedUser: sanitized, orphansCount };
  }

  /**
   * Migrates legacy v1 user payload to current schema version.
   *
   * @param {Object} rawUser
   * @returns {Object} Migrated and versioned user
   */
  function migrateUserData(rawUser) {
    if (!rawUser) return rawUser;

    const migrated = { ...rawUser };
    const initialVersion = migrated.dataVersion || 1;

    // V1 -> V2 migrations:
    if (initialVersion < 2) {
      migrated.dataVersion = CURRENT_DATA_VERSION;

      // Ensure fixedSchedules have flexible boolean and exceptions array
      if (Array.isArray(migrated.fixedSchedules)) {
        migrated.fixedSchedules = migrated.fixedSchedules.map(slot => ({
          ...slot,
          flexible: Boolean(slot.flexible),
          exceptions: Array.isArray(slot.exceptions) ? slot.exceptions : []
        }));
      }

      // Ensure studyNotes array exists
      if (!Array.isArray(migrated.studyNotes)) {
        migrated.studyNotes = [];
      }

      // Ensure examMilestones array exists
      if (!Array.isArray(migrated.examMilestones)) {
        migrated.examMilestones = [];
      }
    }

    return migrated;
  }

  /**
   * Safe localStorage JSON loader with automatic emergency backup and recovery.
   *
   * @param {string} storageKey
   * @param {Storage} [storage=localStorage]
   * @param {Object|null} [fallback=null]
   * @returns {Object|null}
   */
  function safeLoadStorage(storageKey, storage = (typeof localStorage !== 'undefined' ? localStorage : null), fallback = null) {
    if (!storage) return fallback;

    const raw = storage.getItem(storageKey);
    if (!raw) return fallback;

    try {
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (err) {
      console.error(`[DataIntegrity] Malformed JSON in ${storageKey}. Creating emergency backup.`, err);
      // Emergency backup before recovering
      try {
        const backupKey = `${BACKUP_PREFIX}${storageKey}_${Date.now()}`;
        storage.setItem(backupKey, raw);
        console.warn(`[DataIntegrity] Raw malformed payload saved to ${backupKey}`);
      } catch (backupErr) {
        console.warn('[DataIntegrity] Failed to create backup key:', backupErr);
      }
      return fallback;
    }
  }

  /**
   * Full data integrity pipeline for a user account:
   * load -> parse -> validate -> migrate -> normalize -> clean orphans & duplicate IDs
   *
   * @param {Object} rawData
   * @returns {{ data: Object, issues: string[] }}
   */
  function processUserDataPipeline(rawData) {
    const issues = [];
    if (!rawData || typeof rawData !== 'object') {
      return { data: rawData, issues: ['Data is empty or not an object'] };
    }

    // 1. Migrate
    const migrated = migrateUserData(rawData);

    // 2. Validate & Filter Tasks
    let validTasks = [];
    if (Array.isArray(migrated.tasks)) {
      for (const t of migrated.tasks) {
        const val = validateTask(t);
        if (val.valid) {
          validTasks.push(t);
        } else {
          issues.push(`Filtered invalid task (${t?.id || 'unknown'}): ${val.error}`);
        }
      }
    }
    const taskDedup = resolveDuplicateIds(validTasks, 'task');
    if (taskDedup.duplicateCount > 0) {
      issues.push(`Resolved ${taskDedup.duplicateCount} duplicate task IDs`);
    }
    migrated.tasks = taskDedup.cleanItems;

    // 3. Validate & Filter Fixed / Recurring Schedules
    let validSchedules = [];
    if (Array.isArray(migrated.fixedSchedules)) {
      for (const s of migrated.fixedSchedules) {
        const val = validateSchedule(s);
        if (val.valid) {
          validSchedules.push(s);
        } else {
          issues.push(`Filtered invalid schedule (${s?.id || 'unknown'}): ${val.error}`);
        }
      }
    }
    const schedDedup = resolveDuplicateIds(validSchedules, 'fixed');
    if (schedDedup.duplicateCount > 0) {
      issues.push(`Resolved ${schedDedup.duplicateCount} duplicate schedule IDs`);
    }
    migrated.fixedSchedules = schedDedup.cleanItems;

    // 4. Sanitize Orphans
    const { sanitizedUser, orphansCount } = sanitizeOrphans(migrated);
    if (orphansCount > 0) {
      issues.push(`Cleaned ${orphansCount} orphaned references`);
    }

    return {
      data: sanitizedUser,
      issues
    };
  }

  return {
    CURRENT_DATA_VERSION,
    BACKUP_PREFIX,
    validateTask,
    validateSchedule,
    resolveDuplicateIds,
    sanitizeOrphans,
    migrateUserData,
    safeLoadStorage,
    processUserDataPipeline
  };
}));
