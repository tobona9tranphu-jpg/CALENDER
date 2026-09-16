'use strict';

/**
 * @file intent-schema.js
 * Structured User Intent Schema for AI Time Management Foundation.
 *
 * Core Principle:
 * - Decouples raw user natural language from scheduling execution.
 * - Distinguishes between:
 *   1. Flexible tasks (can be scheduled into free slots)
 *   2. Fixed events (rigid anchors, cannot be moved)
 *   3. Deadlines (hard boundaries)
 *   4. Constraints (rules like "before 18:00")
 *   5. Unresolved items (ambiguities flagged for clarification)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const exportsObj = factory();
    exportsObj.IntentSchema = exportsObj;
    module.exports = exportsObj;
  } else {
    root.IntentSchema = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {

  /**
   * Constructs a structured user intent object.
   *
   * @param {Object} params
   * @param {Array} [params.tasks]
   * @param {Array} [params.fixedEvents]
   * @param {Array} [params.deadlines]
   * @param {Array} [params.constraints]
   * @param {Array} [params.unresolved]
   * @param {number} [params.confidence]
   * @param {'ai'|'deterministic'} [params.source]
   * @param {string} [params.rawText]
   */
  function createIntent({
    tasks = [],
    fixedEvents = [],
    deadlines = [],
    constraints = [],
    unresolved = [],
    confidence = 1.0,
    source = 'deterministic',
    rawText = ''
  } = {}) {
    return {
      tasks: (tasks || []).map((t, index) => ({
        id: t.id || ('intent-task-' + (index + 1)),
        title: String(t.title || '').trim(),
        durationMinutes: (t.durationMinutes !== undefined && t.durationMinutes !== null)
          ? Number(t.durationMinutes)
          : (t.minutes !== undefined ? Number(t.minutes) : 30),
        date: t.date || null,
        priority: t.priority || 3,
        flexible: t.flexible !== false,
        subjectId: t.subjectId || null,
        dates: Array.isArray(t.dates) ? t.dates : undefined,
        recurrence: (t.recurrence && typeof t.recurrence === 'object') ? t.recurrence : undefined
      })),
      fixedEvents: (fixedEvents || []).map((f, index) => ({
        id: f.id || ('intent-fixed-' + (index + 1)),
        title: String(f.title || '').trim(),
        date: f.date || null,
        start: f.start || '08:00',
        end: f.end || '09:00',
        type: f.type || 'fixed',
        fixed: true
      })),
      deadlines: (deadlines || []).map(d => ({
        title: String(d.title || '').trim(),
        deadlineDate: d.deadlineDate || d.date || null,
        taskId: d.taskId || null
      })),
      constraints: (constraints || []).map(c => ({
        type: c.type || 'general',
        description: String(c.description || '').trim(),
        value: c.value !== undefined ? c.value : null
      })),
      unresolved: (unresolved || []).map(u => String(u).trim()),
      confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
      source: source === 'ai' ? 'ai' : 'deterministic',
      rawText: String(rawText || '').trim()
    };
  }

  /**
   * Validates a structured intent object against schema rules.
   *
   * @param {Object} intent
   * @returns {{ valid: boolean, errors: string[] }}
   */
  function validateIntent(intent) {
    const errors = [];

    if (!intent || typeof intent !== 'object') {
      return { valid: false, errors: ['Intent must be a non-null object.'] };
    }

    if (typeof intent.confidence !== 'number' || isNaN(intent.confidence) || intent.confidence < 0 || intent.confidence > 1) {
      errors.push('Confidence must be a number between 0.0 and 1.0.');
    }

    if (intent.source !== 'ai' && intent.source !== 'deterministic') {
      errors.push('Source must be either "ai" or "deterministic".');
    }

    if (!Array.isArray(intent.tasks)) {
      errors.push('Tasks must be an array.');
    } else {
      intent.tasks.forEach((t, i) => {
        if (!t || typeof t !== 'object') {
          errors.push(`Task at index ${i} must be an object.`);
          return;
        }
        if (!t.title || typeof t.title !== 'string' || !t.title.trim()) {
          errors.push(`Task at index ${i} must have a non-empty title.`);
        }
        if (typeof t.durationMinutes !== 'number' || isNaN(t.durationMinutes) || t.durationMinutes <= 0) {
          errors.push(`Task "${t.title || i}" must have a positive durationMinutes.`);
        }
        if (t.date && typeof t.date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
          errors.push(`Task "${t.title}" date must be YYYY-MM-DD format.`);
        }
      });
    }

    if (!Array.isArray(intent.fixedEvents)) {
      errors.push('FixedEvents must be an array.');
    } else {
      intent.fixedEvents.forEach((f, i) => {
        if (!f || typeof f !== 'object') {
          errors.push(`Fixed event at index ${i} must be an object.`);
          return;
        }
        if (!f.title || typeof f.title !== 'string' || !f.title.trim()) {
          errors.push(`Fixed event at index ${i} must have a non-empty title.`);
        }
        if (!f.start || !/^\d{1,2}:\d{2}$/.test(f.start)) {
          errors.push(`Fixed event "${f.title || i}" has invalid start time format (HH:MM).`);
        }
        if (!f.end || !/^\d{1,2}:\d{2}$/.test(f.end)) {
          errors.push(`Fixed event "${f.title || i}" has invalid end time format (HH:MM).`);
        }
        if (f.start && f.end && f.start >= f.end) {
          errors.push(`Fixed event "${f.title || i}" có giờ bắt đầu phải trước giờ kết thúc.`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Evaluates whether an intent has insufficient confidence or unresolved elements
   * that require requesting user clarification.
   *
   * @param {Object} intent
   * @param {number} [threshold=0.7]
   * @returns {boolean}
   */
  function needsClarification(intent, threshold = 0.7) {
    if (!intent) return true;
    if (intent.confidence < threshold) return true;
    if (Array.isArray(intent.unresolved) && intent.unresolved.length > 0) return true;
    return false;
  }

  return {
    createIntent,
    validateIntent,
    needsClarification
  };
}));
