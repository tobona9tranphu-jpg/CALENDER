'use strict';

/**
 * Timetable Importer Core Module for TB Smart Study Planner.
 *
 * Handles:
 * 1. Period time profiles (getPeriodTime, no fake invented fallback times).
 * 2. Class name normalization (normalizeClassName).
 * 3. DOCX logical grid reconstruction (handling w:gridSpan and w:vMerge).
 * 4. Structured TXT parser (pipe schema: period|subject|start|end|teacher).
 * 5. Vietnamese subject & teacher parsing (parseSubjectAndTeacher).
 * 6. Duplicate checking and deduplication (isDuplicateScheduleEntry, dedupeScheduleEntries).
 * 7. Realtime slot validation (validateImportSlots).
 *
 * UMD Pattern: Works in Node.js/Jest and Browser (globalThis.TimetableImporter).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TimetableImporter = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {

  const PERIOD_TIMES = {
    1: { start: '07:15', end: '08:00' },
    2: { start: '08:05', end: '08:50' },
    3: { start: '09:05', end: '09:50' },
    4: { start: '09:55', end: '10:40' },
    5: { start: '10:45', end: '11:30' },
    6: { start: '13:00', end: '13:45' },
    7: { start: '13:50', end: '14:35' },
    8: { start: '14:50', end: '15:35' },
    9: { start: '15:40', end: '16:25' },
    10: { start: '16:30', end: '17:15' },
  };

  const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

  /**
   * Returns configured start/end times for a period, or null if beyond profile.
   */
  function getPeriodTime(period) {
    const p = Number(period);
    if (PERIOD_TIMES[p]) {
      return { ...PERIOD_TIMES[p] };
    }
    return null;
  }

  /**
   * Normalizes a class name for exact matching (e.g. "Lớp 12A1", "12 A1", "12-A1" -> "12A1").
   */
  function normalizeClassName(value) {
    if (!value || typeof value !== 'string') return '';
    let str = value.trim().toUpperCase();
    str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    str = str.replace(/^(?:LOP|KHOI|CLS|CLASS)\s*/i, '');
    str = str.replace(/[\s\-_.]+/g, '');
    return str;
  }

  /**
   * Converts "HH:MM" string to total minutes from 00:00.
   */
  function timeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const parts = timeStr.split(':');
    if (parts.length < 2) return 0;
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

  /**
   * Reconstructs a 2D logical grid from raw DOCX table XML string.
   * Resolves <w:gridSpan w:val="N"/> (horizontal span) and <w:vMerge> (vertical merge).
   */
  function extractDocxLogicalGrid(tableXml) {
    const rowMatches = tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
    const grid = [];
    const activeVMerges = {}; // colIdx -> { text, gridSpan }

    for (let rIdx = 0; rIdx < rowMatches.length; rIdx++) {
      const tr = rowMatches[rIdx];
      const cellMatches = tr.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
      const row = [];
      let cIdx = 0;

      for (let cellXml of cellMatches) {
        // Check gridSpan
        const gridSpanMatch = cellXml.match(/<w:gridSpan[^>]*w:val=["'](\d+)["']/i);
        const gridSpan = gridSpanMatch ? parseInt(gridSpanMatch[1], 10) : 1;

        // Check vMerge
        const vMergeMatch = cellXml.match(/<w:vMerge([^>]*)\/>/i);
        let vMergeType = null;
        if (vMergeMatch) {
          const valMatch = vMergeMatch[1].match(/w:val=["']([^"']+)["']/i);
          vMergeType = valMatch ? valMatch[1].toLowerCase() : 'continue';
        }

        // Extract text paragraphs
        const pMatches = cellXml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
        let text = '';
        if (pMatches.length > 0) {
          text = pMatches.map(p => {
            const textMatches = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
            return textMatches.map(t => t.replace(/<[^>]+>/g, '')).join(' ').trim();
          }).filter(Boolean).join('\n').trim();
        } else {
          const textMatches = cellXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
          text = textMatches.map(t => t.replace(/<[^>]+>/g, '')).join(' ').trim();
        }

        // Process vertical merge inheritance
        if (vMergeType === 'restart') {
          activeVMerges[cIdx] = { text, gridSpan };
        } else if (vMergeType === 'continue') {
          if (activeVMerges[cIdx] && !text) {
            text = activeVMerges[cIdx].text;
          }
        } else {
          // No vertical merge on this cell
          delete activeVMerges[cIdx];
        }

        // Fill current logical cell and any gridSpan columns
        row[cIdx] = text;
        for (let span = 1; span < gridSpan; span++) {
          row[cIdx + span] = text;
        }

        cIdx += gridSpan;
      }

      grid.push(row);
    }

    return grid;
  }

  /**
   * Parses subject and teacher name from raw cell text.
   */
  function parseSubjectAndTeacher(raw) {
    if (!raw) return null;
    const str = String(raw).trim().replace(/[ \t]+/g, ' ');
    if (!str || str.toLowerCase() === 'nghỉ' || str === '-' || str === 'x' || str.length < 2) return null;

    let subjectPart = str;
    let teacherPart = '';

    if (str.includes('\n')) {
      const lines = str.split('\n').map(l => l.trim()).filter(Boolean);
      subjectPart = lines[0] || '';
      teacherPart = lines.slice(1).join(' ');
    } else if (str.includes('-') && str.indexOf('-') > 0) {
      const dashIdx = str.indexOf('-');
      subjectPart = str.slice(0, dashIdx).trim();
      teacherPart = str.slice(dashIdx + 1).trim();
    } else if (/\((.*?)\)/.test(str)) {
      const parenMatch = str.match(/\((.*?)\)/);
      subjectPart = str.replace(/\(.*?\)/, '').trim();
      teacherPart = parenMatch ? parenMatch[1].trim() : '';
    } else if (str.includes(':') && str.indexOf(':') > 0) {
      const colonIdx = str.indexOf(':');
      subjectPart = str.slice(0, colonIdx).trim();
      teacherPart = str.slice(colonIdx + 1).trim();
    }

    if (teacherPart) {
      teacherPart = teacherPart.replace(/^gv[\s.:-]*/i, '').trim();
    }

    const sLower = subjectPart.toLowerCase();
    let cleanSubject = subjectPart;
    let subjectGroup = subjectPart;

    const normWords = ' ' + sLower.replace(/[^a-z0-9&àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/g, ' ') + ' ';
    const has = (...keywords) => keywords.some(k => normWords.includes(' ' + k.toLowerCase() + ' '));

    if (has('chào cờ', 'chao co')) {
      cleanSubject = 'Chào cờ';
      subjectGroup = 'Chào cờ';
    } else if (has('sinh hoạt', 'sinh hoạt lớp', 'shl', 'sinh hoat')) {
      cleanSubject = 'Sinh hoạt lớp';
      subjectGroup = 'Sinh hoạt lớp';
    } else if (has('hđtn', 'trải nghiệm', 'trai nghiem')) {
      cleanSubject = 'HĐ Trải nghiệm';
      subjectGroup = 'Hoạt động trải nghiệm';
    } else if (has('cđ toán', 'chuyên đề toán', 'cd toan')) {
      cleanSubject = 'Chuyên đề Toán';
      subjectGroup = 'Toán';
    } else if (has('cđ anh', 'chuyên đề tiếng anh', 'chuyên đề anh')) {
      cleanSubject = 'Chuyên đề Tiếng Anh';
      subjectGroup = 'Tiếng Anh';
    } else if (has('cđ văn', 'chuyên đề ngữ văn', 'chuyên đề văn')) {
      cleanSubject = 'Chuyên đề Ngữ văn';
      subjectGroup = 'Ngữ văn';
    } else if (has('cđ lý', 'chuyên đề vật lí', 'chuyên đề vật lý', 'chuyên đề lý')) {
      cleanSubject = 'Chuyên đề Vật lí';
      subjectGroup = 'Vật lí';
    } else if (has('cđ hóa', 'chuyên đề hóa học', 'chuyên đề hóa')) {
      cleanSubject = 'Chuyên đề Hóa học';
      subjectGroup = 'Hóa học';
    } else if (has('cđ sinh', 'chuyên đề sinh học', 'chuyên đề sinh')) {
      cleanSubject = 'Chuyên đề Sinh học';
      subjectGroup = 'Sinh học';
    } else if (has('cđ sử', 'chuyên đề lịch sử', 'chuyên đề sử')) {
      cleanSubject = 'Chuyên đề Lịch sử';
      subjectGroup = 'Lịch sử';
    } else if (has('cđ địa', 'chuyên đề địa lí', 'chuyên đề địa lý', 'chuyên đề địa')) {
      cleanSubject = 'Chuyên đề Địa lí';
      subjectGroup = 'Địa lí';
    } else if (has('toán', 'toan', 'đại số', 'hình học')) {
      cleanSubject = 'Toán';
      subjectGroup = 'Toán';
    } else if (has('ngữ văn', 'văn học', 'văn', 'van')) {
      cleanSubject = 'Ngữ văn';
      subjectGroup = 'Ngữ văn';
    } else if (has('tiếng anh', 'anh văn', 'english', 'tieng anh', 'anh', 'en')) {
      cleanSubject = 'Tiếng Anh';
      subjectGroup = 'Tiếng Anh';
    } else if (has('vật lí', 'vật lý', 'vat li', 'vat ly', 'lý', 'ly')) {
      cleanSubject = 'Vật lí';
      subjectGroup = 'Vật lí';
    } else if (has('hóa học', 'hoa hoc', 'hóa', 'hoa')) {
      cleanSubject = 'Hóa học';
      subjectGroup = 'Hóa học';
    } else if (has('sinh học', 'sinh hoc', 'sinh')) {
      cleanSubject = 'Sinh học';
      subjectGroup = 'Sinh học';
    } else if (has('lịch sử', 'lich su', 'sử', 'su')) {
      cleanSubject = 'Lịch sử';
      subjectGroup = 'Lịch sử';
    } else if (has('địa lí', 'địa lý', 'dia li', 'dia ly', 'địa', 'dia')) {
      cleanSubject = 'Địa lí';
      subjectGroup = 'Địa lí';
    } else if (has('tin học', 'tin hoc', 'tin', 'cntt')) {
      cleanSubject = 'Tin học';
      subjectGroup = 'Tin học';
    } else if (has('gdkt', 'kt&pl', 'ktpl', 'gdcd', 'pháp luật')) {
      cleanSubject = 'GDCD / KT&PL';
      subjectGroup = 'GDCD';
    } else if (has('quốc phòng', 'gdqp', 'qp')) {
      cleanSubject = 'Giáo dục quốc phòng';
      subjectGroup = 'Thể dục / GDQP';
    } else if (has('thể dục', 'the duc', 'gd thể chất', 'thể chất', 'td')) {
      cleanSubject = 'Thể dục';
      subjectGroup = 'Thể dục / GDQP';
    } else if (has('công nghệ', 'cong nghe', 'cn')) {
      cleanSubject = 'Công nghệ';
      subjectGroup = 'Công nghệ';
    } else if (has('khoa học tự nhiên', 'khtn')) {
      cleanSubject = 'KHTN';
      subjectGroup = 'KHTN';
    } else if (has('âm nhạc', 'am nhac')) {
      cleanSubject = 'Âm nhạc';
      subjectGroup = 'Âm nhạc';
    } else if (has('mĩ thuật', 'mỹ thuật', 'mi thuat')) {
      cleanSubject = 'Mĩ thuật';
      subjectGroup = 'Mĩ thuật';
    } else {
      cleanSubject = cleanSubject.trim();
      if (cleanSubject.length > 0) {
        cleanSubject = cleanSubject.charAt(0).toUpperCase() + cleanSubject.slice(1);
      }
      subjectGroup = cleanSubject || 'Môn học';
    }

    const title = teacherPart ? `${cleanSubject} (GV ${teacherPart})` : cleanSubject;
    return { subject: cleanSubject, subjectGroup, teacher: teacherPart, title };
  }

  /**
   * Merges consecutive periods of the same subject.
   */
  function mergeConsecutiveSlots(slots) {
    if (!slots || !slots.length) return [];
    const copy = [...slots].sort((a, b) => {
      if (a.day !== b.day) return a.day - b.day;
      return timeToMinutes(a.start) - timeToMinutes(b.start);
    });

    const merged = [];
    for (const slot of copy) {
      const last = merged[merged.length - 1];
      if (
        last &&
        last.day === slot.day &&
        last.title === slot.title &&
        slot.start &&
        last.end &&
        timeToMinutes(slot.start) <= timeToMinutes(last.end) + 25
      ) {
        last.end = slot.end;
        if (last.periodEnd && slot.period) {
          last.periodEnd = slot.period;
          last.periodLabel = `Tiết ${last.periodStart}-${last.periodEnd}`;
        }
      } else {
        merged.push({
          ...slot,
          periodStart: slot.period || slot.periodStart || null,
          periodEnd: slot.period || slot.periodEnd || null,
          periodLabel: slot.period ? `Tiết ${slot.period}` : (slot.periodLabel || '')
        });
      }
    }

    return merged;
  }

  /**
   * Parses structured TXT format:
   *
   * Thứ 2
   * 1|Toán|07:15|08:00|Nguyễn Văn A
   * 2|Vật lí|08:05|08:50|
   */
  function parseStructuredText(text) {
    if (!text || typeof text !== 'string') return [];
    const lines = text.split(/\r?\n/);
    const slots = [];
    let currentDay = 1;
    let hasPipeLines = false;

    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;
      const lower = line.toLowerCase();

      // Day headers
      if (lower.includes('chủ nhật') || lower === 'cn' || lower === 't8' || lower === '8') {
        currentDay = 0;
        continue;
      } else if (lower.includes('thứ 2') || lower === 't2' || lower === '2') { currentDay = 1; continue; }
      else if (lower.includes('thứ 3') || lower === 't3' || lower === '3') { currentDay = 2; continue; }
      else if (lower.includes('thứ 4') || lower === 't4' || lower === '4') { currentDay = 3; continue; }
      else if (lower.includes('thứ 5') || lower === 't5' || lower === '5') { currentDay = 4; continue; }
      else if (lower.includes('thứ 6') || lower === 't6' || lower === '6') { currentDay = 5; continue; }
      else if (lower.includes('thứ 7') || lower === 't7' || lower === '7') { currentDay = 6; continue; }

      // Check pipe format: period|subject|start|end|teacher
      if (line.includes('|')) {
        hasPipeLines = true;
        const parts = line.split('|').map(p => p.trim());
        const periodNum = parseInt(parts[0], 10);
        const subjectStr = parts[1] || '';
        let startTime = parts[2] || '';
        let endTime = parts[3] || '';
        const teacherStr = parts[4] || '';

        if (!subjectStr) continue;

        // If time is omitted but period is provided, resolve from profile
        if (!startTime || !endTime) {
          const profile = getPeriodTime(periodNum);
          if (profile) {
            startTime = startTime || profile.start;
            endTime = endTime || profile.end;
          }
        }

        const parsed = parseSubjectAndTeacher(teacherStr ? `${subjectStr} (${teacherStr})` : subjectStr);
        if (!parsed) continue;

        slots.push({
          day: currentDay,
          period: Number.isInteger(periodNum) && periodNum > 0 ? periodNum : null,
          title: parsed.title,
          subjectGroup: parsed.subjectGroup,
          teacher: parsed.teacher || teacherStr,
          start: startTime,
          end: endTime,
          unresolvedTime: !TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime),
          type: 'school'
        });
      }
    }

    // If file did not use pipe schema, throw clear error with instructions
    if (!hasPipeLines && slots.length === 0) {
      throw new Error('Định dạng tệp văn bản không đúng cấu trúc chuẩn.\n\nVui lòng nhập theo định dạng:\nThứ 2\n1|Toán|07:15|08:00|Thầy Nam\n2|Vật lí|08:05|08:50|Cô Lan');
    }

    return mergeConsecutiveSlots(slots);
  }

  /**
   * Checks whether two schedule entries are semantic duplicates.
   */
  function isDuplicateScheduleEntry(existing, incoming) {
    if (!existing || !incoming) return false;
    const dayA = Number(existing.day) === 7 ? 0 : Number(existing.day);
    const dayB = Number(incoming.day) === 7 ? 0 : Number(incoming.day);
    if (dayA !== dayB) return false;

    const startA = (existing.start || '').trim();
    const startB = (incoming.start || '').trim();
    const endA = (existing.end || '').trim();
    const endB = (incoming.end || '').trim();
    if (startA !== startB || endA !== endB) return false;

    const titleA = (existing.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const titleB = (incoming.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (titleA !== titleB) return false;

    return true;
  }

  /**
   * Deduplicates incoming slots within the same batch.
   */
  function dedupeScheduleEntries(slots) {
    if (!slots || !slots.length) return [];
    const unique = [];
    for (const slot of slots) {
      if (!unique.some(u => isDuplicateScheduleEntry(u, slot))) {
        unique.push(slot);
      }
    }
    return unique;
  }

  /**
   * Validates import slots for inline preview & realtime error checking.
   * Returns { valid: boolean, errors: [], warnings: [], summary: { total, validCount, warningCount, errorCount } }
   */
  function validateImportSlots(slots, existingSchedules = []) {
    const errors = [];
    const warnings = [];
    let validCount = 0;
    let warningCount = 0;
    let errorCount = 0;

    if (!Array.isArray(slots) || slots.length === 0) {
      return {
        valid: false,
        errors: [{ index: -1, message: 'Chưa có ca học nào trong tệp.' }],
        warnings: [],
        summary: { total: 0, validCount: 0, warningCount: 0, errorCount: 1 }
      };
    }

    slots.forEach((slot, idx) => {
      const slotErrors = [];
      const slotWarnings = [];

      // 1. Validate Day
      const day = Number(slot.day);
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        slotErrors.push(`Ngày không hợp lệ (${slot.day}).`);
      }

      // 2. Validate Title
      if (!slot.title || !String(slot.title).trim()) {
        slotErrors.push('Chưa nhập tên môn học.');
      }

      // 3. Validate Start/End Time
      if (!slot.start || !slot.end || !TIME_PATTERN.test(slot.start) || !TIME_PATTERN.test(slot.end)) {
        if (slot.period) {
          slotErrors.push(`⚠️ Chưa xác định giờ cho tiết ${slot.period}. Vui lòng điền giờ.`);
        } else {
          slotErrors.push('Giờ bắt đầu/kết thúc không đúng định dạng HH:MM.');
        }
      } else {
        const startMin = timeToMinutes(slot.start);
        const endMin = timeToMinutes(slot.end);
        if (startMin >= endMin) {
          slotErrors.push('Giờ kết thúc phải sau giờ bắt đầu.');
        }
      }

      // 4. Check internal overlap with other slots in the same batch
      slots.forEach((other, oIdx) => {
        if (oIdx === idx) return;
        if (Number(other.day) === day && slot.start && slot.end && other.start && other.end) {
          if (TIME_PATTERN.test(slot.start) && TIME_PATTERN.test(slot.end) && TIME_PATTERN.test(other.start) && TIME_PATTERN.test(other.end)) {
            const s1 = timeToMinutes(slot.start);
            const e1 = timeToMinutes(slot.end);
            const s2 = timeToMinutes(other.start);
            const e2 = timeToMinutes(other.end);
            if (Math.max(s1, s2) < Math.min(e1, e2)) {
              slotErrors.push(`Bị trùng giờ với ca "${other.title}" (${other.start}–${other.end}).`);
            }
          }
        }
      });

      // 5. Check duplicate with existing schedules
      if (existingSchedules.some(ext => isDuplicateScheduleEntry(ext, slot))) {
        slotWarnings.push('Ca học này đã có sẵn trong lịch của bạn (sẽ tự động bỏ qua nếu gộp).');
      }

      if (slotErrors.length > 0) {
        errorCount++;
        errors.push({ index: idx, slot, messages: slotErrors });
      } else if (slotWarnings.length > 0) {
        warningCount++;
        validCount++;
        warnings.push({ index: idx, slot, messages: slotWarnings });
      } else {
        validCount++;
      }
    });

    return {
      valid: errorCount === 0,
      errors,
      warnings,
      summary: {
        total: slots.length,
        validCount,
        warningCount,
        errorCount
      }
    };
  }

  return {
    PERIOD_TIMES,
    getPeriodTime,
    normalizeClassName,
    extractDocxLogicalGrid,
    parseSubjectAndTeacher,
    mergeConsecutiveSlots,
    parseStructuredText,
    isDuplicateScheduleEntry,
    dedupeScheduleEntries,
    validateImportSlots,
    timeToMinutes
  };
}));
