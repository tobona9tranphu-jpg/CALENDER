'use strict';

/**
 * @file intent-router.js
 * Intent Classification, Schema Validation & Ambiguity Detection for P1.5 AI Assistant.
 *
 * Core Principles:
 * - 9 Standardized Intent Categories:
 *   1. plan: Sắp xếp / lên lịch học môn mới
 *   2. reschedule: Dời / đổi lịch một hoặc nhiều ca
 *   3. fix_day: Sửa lịch, xử lý xung đột / quá tải
 *   4. review_day: Đánh giá và tổng kết ngày
 *   5. review_week: Đánh giá hiệu suất tuần
 *   6. capture_task: Thêm bài tập / nhiệm vụ mới
 *   7. find_time: Tìm khoảng trống / slot rảnh
 *   8. deadline_help: Quản lý và lập kế hoạch theo hạn chót
 *   9. explain_schedule: Giải thích lý do lịch dày / phân tích lịch
 * - LLM output is strictly validated against schema.
 * - Deterministic fallback handles all 9 categories offline.
 * - Detects ambiguity and prompts for clarification if safety is impacted.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    const exportsObj = factory(AppDate);
    exportsObj.IntentRouter = exportsObj;
    module.exports = exportsObj;
  } else {
    root.IntentRouter = factory(root.AppDate);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (DateUtil) {

  const INTENT_CATEGORIES = [
    'plan',
    'reschedule',
    'fix_day',
    'review_day',
    'review_week',
    'capture_task',
    'find_time',
    'deadline_help',
    'explain_schedule'
  ];

  function getToday() {
    return (DateUtil && DateUtil.getTodayAppDate) ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10);
  }

  function addDays(dateStr, n) {
    if (DateUtil && DateUtil.addAppDays) return DateUtil.addAppDays(dateStr, n);
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Validates a structured intent object from LLM or heuristic.
   *
   * @param {Object} rawIntent
   * @returns {{ valid: boolean, intent: Object|null, errors: string[] }}
   */
  function validateIntentSchema(rawIntent) {
    const errors = [];
    if (!rawIntent || typeof rawIntent !== 'object') {
      return { valid: false, intent: null, errors: ['Intent must be a non-null object.'] };
    }

    const intentType = String(rawIntent.intent || '').toLowerCase().trim();
    if (!INTENT_CATEGORIES.includes(intentType)) {
      errors.push(`Invalid intent category: "${intentType}". Expected one of: ${INTENT_CATEGORIES.join(', ')}.`);
    }

    const confidence = typeof rawIntent.confidence === 'number'
      ? Math.max(0, Math.min(1, rawIntent.confidence))
      : 0.5;

    const entities = (rawIntent.entities && typeof rawIntent.entities === 'object') ? rawIntent.entities : {};
    const constraints = Array.isArray(rawIntent.constraints) ? rawIntent.constraints : [];

    if (errors.length > 0) {
      return { valid: false, intent: null, errors };
    }

    const sanitizedIntent = {
      intent: intentType,
      confidence,
      entities: {
        subject: entities.subject ? String(entities.subject).trim() : null,
        taskTitle: entities.taskTitle ? String(entities.taskTitle).trim() : (entities.title ? String(entities.title).trim() : null),
        durationMinutes: (typeof entities.durationMinutes === 'number' && entities.durationMinutes > 0)
          ? entities.durationMinutes
          : (typeof entities.duration === 'number' && entities.duration > 0 ? entities.duration : null),
        date: entities.date ? String(entities.date).trim() : null,
        targetTime: entities.targetTime ? String(entities.targetTime).trim() : null,
        timePreference: entities.timePreference ? String(entities.timePreference).trim() : null,
        deadlineDate: entities.deadlineDate ? String(entities.deadlineDate).trim() : (entities.deadline ? String(entities.deadline).trim() : null),
        priority: (typeof entities.priority === 'number' && entities.priority >= 1 && entities.priority <= 5) ? entities.priority : 3,
        taskId: entities.taskId ? String(entities.taskId).trim() : null
      },
      constraints: constraints.map(c => ({
        type: c.type || 'preference',
        description: String(c.description || '').trim(),
        value: c.value !== undefined ? c.value : null
      })),
      source: rawIntent.source === 'ai' ? 'ai' : 'deterministic',
      rawText: String(rawIntent.rawText || '').trim()
    };

    return { valid: true, intent: sanitizedIntent, errors: [] };
  }

  /**
   * Parses natural language Vietnamese date references.
   * e.g., "hôm nay", "mai", "ngày mai", "ngày kia", "thứ 6", "thứ sáu", "2026-09-20"
   */
  function parseDateReference(text, baseDate) {
    const today = baseDate || getToday();
    const lower = (text || '').toLowerCase();

    if (lower.includes('hôm nay') || lower.includes('nay')) return today;
    if (lower.includes('ngày mai') || lower.includes('mai')) return addDays(today, 1);
    if (lower.includes('ngày kia') || lower.includes('mốt')) return addDays(today, 2);

    // Explicit ISO date
    const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoMatch) return isoMatch[1];

    // Day of week: "thứ 2", "thứ hai", ..., "chủ nhật"
    const dowMap = {
      'thứ 2': 1, 'thứ hai': 1,
      'thứ 3': 2, 'thứ ba': 2,
      'thứ 4': 3, 'thứ tư': 3,
      'thứ 5': 4, 'thứ năm': 4,
      'thứ 6': 5, 'thứ sáu': 5,
      'thứ 7': 6, 'thứ bảy': 6,
      'chủ nhật': 0, 'cn': 0
    };

    for (const [kw, targetDow] of Object.entries(dowMap)) {
      if (lower.includes(kw)) {
        const currDow = new Date(today + 'T00:00:00').getDay();
        let diff = targetDow - currDow;
        if (diff <= 0) diff += 7; // Next occurrence
        return addDays(today, diff);
      }
    }

    return null;
  }

  /**
   * Extracts duration in minutes from Vietnamese text.
   * e.g., "2 tiếng", "1.5 giờ", "90 phút", "45p", "1h30"
   */
  function parseDurationMinutes(text) {
    const lower = (text || '').toLowerCase();

    // "1h30" or "1h 30m"
    const compoundMatch = lower.match(/(\d+)\s*h\s*(\d+)\s*(?:p|m|phút)?/);
    if (compoundMatch) {
      return Number(compoundMatch[1]) * 60 + Number(compoundMatch[2]);
    }

    // "2 tiếng", "2 giờ", "1.5 tiếng"
    const hoursMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:tiếng|giờ|h\b)/);
    if (hoursMatch) {
      const h = parseFloat(hoursMatch[1].replace(',', '.'));
      return Math.round(h * 60);
    }

    // "90 phút", "45p", "45 m"
    const minsMatch = lower.match(/(\d+)\s*(?:phút|p\b|m\b)/);
    if (minsMatch) {
      return parseInt(minsMatch[1], 10);
    }

    return null;
  }

  /**
   * Extracts known subjects or general topic title.
   */
  function extractSubject(text, knownSubjects = []) {
    const lower = (text || '').toLowerCase();
    const commonSubjects = [
      { name: 'Toán', keywords: ['toán', 'đại số', 'hình học', 'giải tích'] },
      { name: 'Vật lí', keywords: ['vật lí', 'vật lý', 'lý', 'lí'] },
      { name: 'Hóa học', keywords: ['hóa học', 'hóa'] },
      { name: 'Sinh học', keywords: ['sinh học', 'sinh'] },
      { name: 'Ngữ văn', keywords: ['ngữ văn', 'văn', 'nghị luận'] },
      { name: 'Tiếng Anh', keywords: ['tiếng anh', 'anh văn', 'tiếng anh 12', 'ielts'] },
      { name: 'Lịch sử', keywords: ['lịch sử', 'sử'] },
      { name: 'Địa lí', keywords: ['địa lí', 'địa lý', 'địa'] },
      { name: 'Tin học', keywords: ['tin học', 'tin', 'lập trình'] }
    ];

    // Check user's actual registered subjects first
    for (const sub of (knownSubjects || [])) {
      const subName = (sub.name || '').toLowerCase();
      if (subName && lower.includes(subName)) return sub.name;
    }

    for (const sub of commonSubjects) {
      for (const kw of sub.keywords) {
        const regex = new RegExp(`(?:\\b|\\s)${kw}(?:\\b|\\s|[.,!?]|$)`, 'i');
        if (regex.test(lower)) return sub.name;
      }
    }
    return null;
  }

  /**
   * Extracts time preference (morning, afternoon, evening).
   */
  function extractTimePreference(text) {
    const lower = (text || '').toLowerCase();
    if (lower.includes('sáng') || lower.includes('buổi sáng')) return 'morning';
    if (lower.includes('chiều') || lower.includes('buổi chiều')) return 'afternoon';
    if (lower.includes('tối') || lower.includes('buổi tối') || lower.includes('đêm')) return 'evening';
    return null;
  }

  /**
   * Deterministic Intent Classifier.
   * Classifies user query into one of the 9 categories with high precision using regex & keywords.
   *
   * @param {string} text
   * @param {Object} [context]
   * @returns {Object} Structured intent object
   */
  function classifyDeterministic(text, context = {}) {
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();
    const baseDate = context.currentDate || getToday();
    const knownSubjects = context.subjects || [];

    const duration = parseDurationMinutes(raw);
    const dateRef = parseDateReference(raw, baseDate);
    const subject = extractSubject(raw, knownSubjects);
    const timePref = extractTimePreference(raw);

    // 1. Fix My Day
    if (
      lower.includes('fix my day') ||
      lower.includes('sửa lịch') ||
      lower.includes('sửa ngày') ||
      lower.includes('rối quá') ||
      lower.includes('bị rối') ||
      lower.includes('xung đột') ||
      lower.includes('quá tải') ||
      lower.includes('sắp xếp lại ngày') ||
      lower.includes('cứu lịch') ||
      lower.includes('chỉnh lại hôm nay')
    ) {
      return {
        intent: 'fix_day',
        confidence: 0.95,
        entities: {
          date: dateRef || baseDate
        },
        constraints: [],
        source: 'deterministic',
        rawText: raw
      };
    }

    // 2. Review Week
    if (
      lower.includes('review tuần') ||
      lower.includes('tuần này') ||
      lower.includes('tổng kết tuần') ||
      lower.includes('sao tuần này') ||
      lower.includes('hiệu suất tuần') ||
      lower.includes('học thế nào tuần này')
    ) {
      return {
        intent: 'review_week',
        confidence: 0.95,
        entities: {
          date: baseDate
        },
        constraints: [],
        source: 'deterministic',
        rawText: raw
      };
    }

    // 3. Review Day
    if (
      lower.includes('review ngày') ||
      lower.includes('tổng kết ngày') ||
      lower.includes('hôm nay tôi học thế nào') ||
      lower.includes('đánh giá ngày') ||
      lower.includes('kết quả hôm nay') ||
      lower.includes('hôm nay làm được gì')
    ) {
      return {
        intent: 'review_day',
        confidence: 0.95,
        entities: {
          date: dateRef || baseDate
        },
        constraints: [],
        source: 'deterministic',
        rawText: raw
      };
    }

    // 4. Find Time
    if (
      lower.includes('rảnh') ||
      lower.includes('chỗ trống') ||
      lower.includes('tìm slot') ||
      lower.includes('khi nào rảnh') ||
      (lower.includes('tìm') && (lower.includes('thời gian') || lower.includes('khung giờ') || lower.includes('giờ')))
    ) {
      return {
        intent: 'find_time',
        confidence: 0.92,
        entities: {
          subject,
          durationMinutes: duration || 60,
          date: dateRef || baseDate,
          timePreference: timePref
        },
        constraints: [],
        source: 'deterministic',
        rawText: raw
      };
    }

    // 5. Deadline Help
    if (
      lower.includes('deadline') ||
      lower.includes('hạn chót') ||
      lower.includes('nộp bài') ||
      lower.includes('hạn nộp') ||
      lower.includes('phải nộp') ||
      lower.includes('sắp nộp') ||
      lower.includes('trước ngày') ||
      lower.includes('trước thứ') ||
      lower.includes('hạn')
    ) {
      return {
        intent: 'deadline_help',
        confidence: 0.90,
        entities: {
          subject,
          taskTitle: subject ? `Nộp bài tập ${subject}` : 'Nộp bài tập',
          deadlineDate: dateRef || addDays(baseDate, 2),
          durationMinutes: duration || 90
        },
        constraints: [],
        source: 'deterministic',
        rawText: raw
      };
    }

    // 6. Explain Schedule
    if (
      lower.includes('tại sao hôm nay') ||
      lower.includes('tại sao tôi phải học nhiều') ||
      lower.includes('sao nhiều bài') ||
      lower.includes('giải thích lịch') ||
      lower.includes('lịch hôm nay thế nào') ||
      lower.includes('sao bận thế') ||
      lower.includes('phân tích lịch')
    ) {
      return {
        intent: 'explain_schedule',
        confidence: 0.92,
        entities: {
          date: dateRef || baseDate
        },
        constraints: [],
        source: 'deterministic',
        rawText: raw
      };
    }

    // 7. Reschedule
    if (
      lower.includes('dời') ||
      lower.includes('đổi lịch') ||
      lower.includes('đổi ca') ||
      lower.includes('hoãn') ||
      lower.includes('lùi lịch') ||
      lower.includes('chuyển sang') ||
      lower.includes('đổi sang') ||
      lower.includes('dời sang') ||
      (lower.includes('đổi') && (lower.includes('sang') || lower.includes('chiều') || lower.includes('tối') || lower.includes('sáng') || lower.includes('mai')))
    ) {
      return {
        intent: 'reschedule',
        confidence: 0.88,
        entities: {
          subject,
          date: dateRef || baseDate,
          timePreference: timePref
        },
        constraints: [],
        source: 'deterministic',
        rawText: raw
      };
    }

    // 8. Capture Task
    if (
      lower.startsWith('thêm ') ||
      lower.startsWith('tạo ') ||
      lower.includes('nhắc tôi') ||
      lower.includes('thêm bài tập') ||
      lower.includes('thêm task')
    ) {
      return {
        intent: 'capture_task',
        confidence: 0.85,
        entities: {
          subject,
          taskTitle: raw.replace(/^(thêm|tạo|nhắc tôi)\s+/i, '').trim(),
          durationMinutes: duration || 45,
          date: dateRef || null,
          deadlineDate: dateRef || null
        },
        constraints: [],
        source: 'deterministic',
        rawText: raw
      };
    }

    // 9. Plan (Default for study request)
    return {
      intent: 'plan',
      confidence: (subject || duration || dateRef) ? 0.85 : 0.60,
      entities: {
        subject: subject || (raw.length < 30 ? raw : 'Học tập'),
        taskTitle: subject ? `Học ${subject}` : raw,
        durationMinutes: duration || null, // Might be ambiguous
        date: dateRef || baseDate,
        timePreference: timePref
      },
      constraints: [],
      source: 'deterministic',
      rawText: raw
    };
  }

  /**
   * Evaluates whether an intent has ambiguous or missing parameters that require user clarification.
   *
   * @param {Object} intent
   * @param {Object} [userPreferences]
   * @returns {{ needsClarification: boolean, question: string|null, missingField: string|null }}
   */
  function detectAmbiguity(intent, userPreferences = {}) {
    if (!intent || !intent.entities) {
      return { needsClarification: false, question: null, missingField: null };
    }

    const { intent: intentType, entities } = intent;

    // For 'plan', if duration is missing and no learned preference exists
    if (intentType === 'plan') {
      if (!entities.durationMinutes) {
        const subId = entities.subject;
        const learnedMult = userPreferences.durationMultipliers && subId ? userPreferences.durationMultipliers[subId] : null;
        if (!learnedMult) {
          return {
            needsClarification: true,
            missingField: 'durationMinutes',
            question: `Bạn muốn dành khoảng bao lâu cho môn ${entities.subject || 'này'}? (Ví dụ: 45 phút, 1.5 tiếng)`
          };
        }
      }
    }

    // For 'find_time', duration is required
    if (intentType === 'find_time' && !entities.durationMinutes) {
      return {
        needsClarification: true,
        missingField: 'durationMinutes',
        question: 'Bạn muốn tìm khoảng trống bao nhiêu phút? (Ví dụ: 60 phút, 90 phút)'
      };
    }

    return { needsClarification: false, question: null, missingField: null };
  }

  return {
    INTENT_CATEGORIES,
    validateIntentSchema,
    classifyDeterministic,
    detectAmbiguity,
    _parseDurationMinutes: parseDurationMinutes,
    _parseDateReference: parseDateReference,
    _extractSubject: extractSubject
  };
}));
