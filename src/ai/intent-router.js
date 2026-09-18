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
   * CRITICAL: Must NOT mistake start-of-day clock times (e.g., "lúc 17h", "17h", "7h sáng") as durations.
   */
  function parseDurationMinutes(text) {
    const lower = (text || '').toLowerCase();

    // 1. Strip out explicit time-of-day phrases like "lúc 17h", "vào lúc 17h", "vào 17h", "lúc 7 giờ tối", "7h tối", "5pm", etc.
    let cleanText = lower
      .replace(/(?:vào\s*lúc|lúc|vào|từ|đến)\s*\d{1,2}(?::\d{2})?\s*(?:h\b|giờ)?(?:\s*(?:sáng|trưa|chiều|tối|đêm))?/gi, ' ')
      .replace(/\d{1,2}\s*(?:am|pm)/gi, ' ')
      .replace(/\d{1,2}\s*giờ\s*(?:sáng|trưa|chiều|tối|đêm)/gi, ' ')
      .replace(/\b(?:1[0-9]|2[0-3]|[7-9])\s*h\b/gi, ' '); // Standalone >= 7h is clock time (17h = 17:00), not duration

    // "1h30" or "1h 30m"
    const compoundMatch = cleanText.match(/(\d+)\s*h\s*(\d+)\s*(?:p|m|phút)?/);
    if (compoundMatch) {
      return Number(compoundMatch[1]) * 60 + Number(compoundMatch[2]);
    }

    // "2 tiếng", "2 giờ", "1.5 tiếng"
    const hoursMatch = cleanText.match(/(\d+(?:[.,]\d+)?)\s*(?:tiếng|giờ)/);
    if (hoursMatch) {
      const h = parseFloat(hoursMatch[1].replace(',', '.'));
      return Math.round(h * 60);
    }

    // "90 phút", "45p", "45 m"
    const minsMatch = cleanText.match(/(\d+)\s*(?:phút|p\b|m\b)/);
    if (minsMatch) {
      return parseInt(minsMatch[1], 10);
    }

    // "2h" or "1h" (short duration <= 6h)
    const shortHMatch = cleanText.match(/\b([1-6])\s*h\b/);
    if (shortHMatch) {
      return parseInt(shortHMatch[1], 10) * 60;
    }

    return null;
  }

  /**
   * Extracts MULTIPLE date references from Vietnamese text.
   * e.g., "thứ 2, 4, 6" → ['2026-09-22', '2026-09-24', '2026-09-26']
   * Returns array of ISO date strings.
   */
  function parseDateReferences(text, baseDate) {
    const today = baseDate || getToday();
    const lower = (text || '').toLowerCase();
    const dates = [];
    const seen = new Set();

    // Check for comma-separated weekday numbers: "2, 4, 6" or "thứ 2, 4, 6" or "T2, T4, T6"
    const weekdayListMatch = lower.match(/(?:thứ\s*)?(\d(?:\s*,\s*\d)+)/g);
    if (weekdayListMatch) {
      for (const match of weekdayListMatch) {
        const nums = match.replace(/thứ\s*/g, '').split(/\s*,\s*/).map(Number);
        for (const n of nums) {
          if (n >= 2 && n <= 7) {
            // Vietnamese weekday: thứ 2 = Monday (JS day 1)
            const jsDow = n >= 2 && n <= 7 ? n - 1 : 0; // thứ 2→1(Mon), thứ 7→6(Sat)
            const currDow = new Date(today + 'T00:00:00').getDay();
            let diff = jsDow - currDow;
            if (diff <= 0) diff += 7;
            const dateStr = addDays(today, diff);
            if (!seen.has(dateStr)) {
              seen.add(dateStr);
              dates.push(dateStr);
            }
          }
        }
      }
    }

    // Also check for T2/T4/T6 style (e.g. "T2, T4, T6" or "T2 T4 T6" or "T2/T4/T6")
    const tStyleMatch = lower.match(/t([2-7])(?:\s*[,/]?\s*t([2-7]))+/gi);
    if (tStyleMatch && dates.length === 0) {
      for (const match of tStyleMatch) {
        const nums = match.match(/\d/g).map(Number);
        for (const n of nums) {
          if (n >= 2 && n <= 7) {
            const jsDow = n - 1;
            const currDow = new Date(today + 'T00:00:00').getDay();
            let diff = jsDow - currDow;
            if (diff <= 0) diff += 7;
            const dateStr = addDays(today, diff);
            if (!seen.has(dateStr)) {
              seen.add(dateStr);
              dates.push(dateStr);
            }
          }
        }
      }
    }

    // If no multi-date found, fall back to single date
    if (dates.length === 0) {
      const single = parseDateReference(text, baseDate);
      if (single) dates.push(single);
    }

    return dates;
  }

  /**
   * Extracts a target time from Vietnamese text.
   * e.g., "17h" → "17:00", "5pm" → "17:00", "7 giờ tối" → "19:00", "lúc 15:00" → "15:00"
   */
  function parseTimeReference(text) {
    const lower = (text || '').toLowerCase();

    // Explicit HH:MM: "15:00", "lúc 17:30"
    const explicitMatch = lower.match(/\b(\d{1,2}):(\d{2})\b/);
    if (explicitMatch) {
      const h = parseInt(explicitMatch[1], 10);
      const m = parseInt(explicitMatch[2], 10);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      }
    }

    // "5pm", "5 pm", "5am", "5h pm"
    const ampmMatch = lower.match(/\b(\d{1,2})\s*(?:h\s*)?(am|pm)\b/);
    if (ampmMatch) {
      let h = parseInt(ampmMatch[1], 10);
      if (ampmMatch[2] === 'pm' && h < 12) h += 12;
      if (ampmMatch[2] === 'am' && h === 12) h = 0;
      return String(h).padStart(2, '0') + ':00';
    }

    // "17h", "17h30", "7h30" (must have word boundary so "t6 học" is not treated as 6h)
    const hMatch = lower.match(/\b(\d{1,2})\s*h(?:\s*(\d{1,2})\b|\b)/);
    if (hMatch) {
      let h = parseInt(hMatch[1], 10);
      const m = hMatch[2] ? parseInt(hMatch[2], 10) : 0;
      // Adjust for context: if "tối" is in text and h < 12, add 12
      if (h < 12 && (lower.includes('tối') || lower.includes('đêm'))) h += 12;
      if (h < 12 && lower.includes('chiều') && h !== 12) h += 12;
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      }
    }

    // "7 giờ tối" / "3 giờ chiều" / "9 giờ sáng"
    const gioMatch = lower.match(/(\d{1,2})\s*giờ/);
    if (gioMatch) {
      let h = parseInt(gioMatch[1], 10);
      if (h < 12 && (lower.includes('tối') || lower.includes('đêm'))) h += 12;
      if (h < 12 && lower.includes('chiều') && h !== 12) h += 12;
      if (h >= 0 && h <= 23) {
        return String(h).padStart(2, '0') + ':00';
      }
    }

    return null;
  }

  /**
   * Extracts known subjects or general topic title.
   */
  function extractSubject(text, knownSubjects = []) {
    const lower = (text || '').toLowerCase().trim();
    if (!lower) return null;

    // Priority 1: Exact match on user's registered subjects
    for (const sub of (knownSubjects || [])) {
      const subName = (sub.name || '').toLowerCase();
      if (subName && lower.includes(subName)) return sub.name;
      // Also check aliases if the user defined any
      if (Array.isArray(sub.aliases)) {
        for (const alias of sub.aliases) {
          if (alias && lower.includes(alias.toLowerCase())) return sub.name;
        }
      }
    }

    // Priority 2: Exact subject name matches (longest first to avoid substring issues)
    const exactMatches = [
      { name: 'Tiếng Anh', patterns: ['tiếng anh', 'anh văn', 'ielts'] },
      { name: 'Ngữ văn',   patterns: ['ngữ văn'] },
      { name: 'Vật lí',    patterns: ['vật lí', 'vật lý'] },
      { name: 'Hóa học',   patterns: ['hóa học'] },
      { name: 'Sinh học',  patterns: ['sinh học'] },
      { name: 'Lịch sử',  patterns: ['lịch sử'] },
      { name: 'Địa lí',   patterns: ['địa lí', 'địa lý'] },
      { name: 'Tin học',   patterns: ['tin học'] },
      { name: 'Toán',      patterns: ['toán', 'đại số', 'hình học', 'giải tích'] },
    ];
    for (const entry of exactMatches) {
      for (const pat of entry.patterns) {
        if (lower.includes(pat)) return entry.name;
      }
    }

    // Priority 3: Standalone short keywords (single Vietnamese syllables)
    // These are ambiguous so we only match them when they appear as standalone words
    const shortKeywords = [
      { name: 'Hóa học', keywords: ['hóa'] },
      { name: 'Ngữ văn', keywords: ['văn'] },
      { name: 'Lịch sử', keywords: ['sử'] },
      { name: 'Địa lí',  keywords: ['địa'] },
      { name: 'Sinh học', keywords: ['sinh'] },
      { name: 'Tin học',  keywords: ['tin'] },
      { name: 'Vật lí',  keywords: ['lý', 'lí'] },
    ];

    // Compounds that contain "lý"/"lí" but do NOT refer to physics
    const lyCompounds = ['lý thuyết', 'tâm lý', 'lý do', 'lý luận', 'quản lý', 'xử lý', 'lí thuyết', 'tâm lí', 'lí do', 'lí luận'];

    // Standalone check: keyword must be surrounded by spaces, start/end, or punctuation
    for (const entry of shortKeywords) {
      for (const kw of entry.keywords) {
        // Guard: skip 'lý'/'lí' if it appears as part of a compound word
        if ((kw === 'lý' || kw === 'lí') && lyCompounds.some(c => lower.includes(c))) {
          continue;
        }
        const standaloneRegex = new RegExp('(?:^|[\\s,;.!?])' + kw + '(?:$|[\\s,;.!?])', 'i');
        // Also match if keyword is at very start or end with no other chars
        if (standaloneRegex.test(' ' + lower + ' ')) {
          return entry.name;
        }
      }
    }

    // Priority 4: Special compound patterns
    if (lower.includes('nghị luận')) return 'Ngữ văn';
    if (lower.includes('lập trình')) return 'Tin học';
    if (lower.includes('tiếng anh 12')) return 'Tiếng Anh';

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
    const targetTime = parseTimeReference(raw);
    const multiDates = parseDateReferences(raw, baseDate);

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
          timePreference: timePref,
          targetTime: targetTime || null
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
      (lower.includes('hạn') && (lower.includes('nộp') || lower.includes('bài') || lower.includes('ngày')))
    ) {
      return {
        intent: 'deadline_help',
        confidence: 0.90,
        entities: {
          subject,
          taskTitle: subject ? `Nộp bài tập ${subject}` : 'Nộp bài tập',
          deadlineDate: dateRef || addDays(baseDate, 2),
          durationMinutes: duration || 90,
          targetTime: targetTime || null
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
          timePreference: timePref,
          targetTime: targetTime || null
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
    const planDates = multiDates.length > 0 ? multiDates : (dateRef ? [dateRef] : [baseDate]);
    const isMultiDayOrTimed = (multiDates.length > 1) || Boolean(targetTime);
    return {
      intent: 'plan',
      confidence: (subject || duration || dateRef || targetTime) ? 0.85 : 0.60,
      entities: {
        subject: subject || (raw.length < 30 ? raw : 'Học tập'),
        taskTitle: subject ? `Học ${subject}` : raw,
        durationMinutes: duration || (isMultiDayOrTimed ? 60 : null),
        date: planDates[0],
        dates: planDates.length > 1 ? planDates : undefined,
        targetTime: targetTime || null,
        timePreference: timePref,
        recurrence: multiDates.length > 1 ? {
          type: 'weekly',
          days: multiDates.map(d => new Date(d + 'T00:00:00').getDay())
        } : undefined
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
        if (entities.targetTime || entities.recurrence || (entities.dates && entities.dates.length > 1)) {
          entities.durationMinutes = 60;
        } else {
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
    _parseDateReferences: parseDateReferences,
    _parseTimeReference: parseTimeReference,
    _extractSubject: extractSubject
  };
}));
