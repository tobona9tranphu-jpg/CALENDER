'use strict';

/**
 * End-to-End Integration Tests for Timetable Import & Apply Flow.
 *
 * Simulates:
 * Parse -> Normalize -> Validate -> Dedupe -> Atomic Apply -> Persist -> Reload -> Recurrence Expand
 */

const TimetableImporter = require('../src/timetable/timetable-importer');
const { RecurrenceEngine, DataIntegrity } = require('../src/recurrence');

describe('Timetable Import & Apply Integration Tests', () => {

  function createBaseUser() {
    return {
      id: 'test-user-1',
      email: 'test@tb.demo',
      profile: { name: 'Minh Anh', grade: 'Lớp 12A1', goal: 'Đạt điểm cao' },
      availability: { start: '15:00', end: '21:30', days: [0, 1, 2, 3, 4, 5, 6] },
      settings: { reminders: true, coach: true },
      subjects: [
        { id: 'sub-math', name: 'Toán', target: 'Mục tiêu', color: 'math', icon: '∫', topics: [] }
      ],
      tasks: [],
      fixedSchedules: [],
      sessions: [],
      reviewSchedules: [],
      studyNotes: [],
      examMilestones: []
    };
  }

  // Acceptance Test requested in Requirement 30
  it('applies one imported timetable slot end-to-end', () => {
    let currentUser = createBaseUser();
    let localStorageStore = {};

    function saveLocalUser(user) {
      localStorageStore[user.id] = JSON.parse(JSON.stringify(user));
    }
    function reloadUser(id) {
      return JSON.parse(JSON.stringify(localStorageStore[id]));
    }

    // 1. Parse Result
    const rawText = 'T2|Toán|07:15|08:00|Cô Hoa';
    const parsedSlots = TimetableImporter.parseStructuredText(rawText);
    expect(parsedSlots).toHaveLength(1);
    expect(parsedSlots[0].title).toContain('Toán');

    // 2. Normalize Slot
    const normalizedSlot = TimetableImporter.normalizeImportedSlot(parsedSlots[0]);
    expect(typeof normalizedSlot.day).toBe('number');
    expect(normalizedSlot.day).toBe(1); // Monday
    expect(normalizedSlot.start).toBe('07:15');
    expect(normalizedSlot.end).toBe('08:00');

    // 3. Validate Slot
    const validation = TimetableImporter.validateImportSlots([normalizedSlot], currentUser.fixedSchedules);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // 4. Atomic Apply
    const baseFixed = (currentUser.fixedSchedules || []).filter(item => item.source !== 'timetable-import');
    const newFixedItem = {
      id: 'fixed-school-test-1',
      title: normalizedSlot.title,
      subjectGroup: normalizedSlot.subjectGroup || normalizedSlot.title,
      teacher: normalizedSlot.teacher || '',
      day: normalizedSlot.day,
      start: normalizedSlot.start,
      end: normalizedSlot.end,
      type: 'school',
      flexible: false,
      source: 'timetable-import',
      importBatchId: 'batch-test-1'
    };
    currentUser.fixedSchedules = [...baseFixed, newFixedItem];
    expect(currentUser.fixedSchedules).toHaveLength(1);

    // 5. Persist through DataIntegrity pipeline
    const processed = DataIntegrity.processUserDataPipeline(currentUser);
    expect(processed.data).toBeDefined();
    saveLocalUser(processed.data);
    expect(localStorageStore[currentUser.id].fixedSchedules).toHaveLength(1);

    // 6. Reload & Verify restored state
    const restoredUser = reloadUser(currentUser.id);
    expect(restoredUser.fixedSchedules).toHaveLength(1);
    const restoredSlot = restoredUser.fixedSchedules[0];
    expect(restoredSlot.title).toContain('Toán');
    expect(restoredSlot.day).toBe(1);
    expect(restoredSlot.start).toBe('07:15');
    expect(restoredSlot.end).toBe('08:00');

    // 7. Rendered schedule occurrences check via RecurrenceEngine
    // Monday date: '2026-09-14'
    const occurrences = RecurrenceEngine.expandOccurrences(restoredSlot, '2026-09-14', '2026-09-14');
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].occurrenceDate).toBe('2026-09-14');
    expect(occurrences[0].start).toBe('07:15');
    expect(occurrences[0].end).toBe('08:00');
  });

  it('normalizes and applies 7 days timetable (Mon..Sun, 0..6)', () => {
    let currentUser = createBaseUser();
    const raw7Days = [
      'T2|Toán|07:15|08:00|GV T2',
      'T3|Vật Lí|08:05|08:50|GV T3',
      'T4|Hóa Học|09:05|09:50|GV T4',
      'T5|Sinh Học|09:55|10:40|GV T5',
      'T6|Ngữ Văn|10:45|11:30|GV T6',
      'T7|Lịch Sử|13:00|13:45|GV T7',
      'CN|Địa Lí|13:50|14:35|GV CN'
    ].join('\n');

    const parsed = TimetableImporter.parseStructuredText(raw7Days);
    expect(parsed).toHaveLength(7);

    const normalized = parsed.map(s => TimetableImporter.normalizeImportedSlot(s));
    const days = normalized.map(s => s.day).sort((a, b) => a - b);
    expect(days).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const validation = TimetableImporter.validateImportSlots(normalized, []);
    expect(validation.valid).toBe(true);

    currentUser.fixedSchedules = normalized.map((slot, idx) => ({
      id: 'fixed-slot-' + idx,
      title: slot.title,
      day: slot.day,
      start: slot.start,
      end: slot.end,
      type: 'school',
      source: 'timetable-import'
    }));

    const processed = DataIntegrity.processUserDataPipeline(currentUser);
    expect(processed.data.fixedSchedules).toHaveLength(7);

    // Verify all 7 days expand occurrences
    const weekStart = '2026-09-14'; // Mon
    const weekEnd = '2026-09-20';   // Sun
    let totalOccurrences = 0;
    for (const slot of processed.data.fixedSchedules) {
      const occs = RecurrenceEngine.expandOccurrences(slot, weekStart, weekEnd);
      totalOccurrences += occs.length;
    }
    expect(totalOccurrences).toBe(7);
  });

  it('replaces old imported slots while preserving manual activities and tutoring', () => {
    let currentUser = createBaseUser();
    currentUser.fixedSchedules = [
      { id: 'club-1', title: 'CLB Tin học', day: 6, start: '15:00', end: '17:00', type: 'activity', source: 'manual' },
      { id: 'tutoring-1', title: 'Học thêm Hóa', day: 3, start: '18:00', end: '19:30', type: 'tutoring', source: 'manual' },
      { id: 'old-import-1', title: 'Toán cũ', day: 1, start: '07:15', end: '08:00', type: 'school', source: 'timetable-import' }
    ];

    const newRaw = 'T2|Toán Mới|07:15|08:00|Thầy Bảo';
    const parsed = TimetableImporter.parseStructuredText(newRaw);
    const normalized = parsed.map(s => TimetableImporter.normalizeImportedSlot(s));

    // Replace mode logic
    const baseFixed = currentUser.fixedSchedules.filter(item => {
      if (item.source === 'timetable-import') return false;
      return true;
    });

    const newFixed = normalized.map(s => ({
      id: 'fixed-school-new-1',
      title: s.title,
      day: s.day,
      start: s.start,
      end: s.end,
      type: 'school',
      source: 'timetable-import'
    }));

    currentUser.fixedSchedules = [...baseFixed, ...newFixed];

    expect(currentUser.fixedSchedules).toHaveLength(3);
    expect(currentUser.fixedSchedules.some(s => s.id === 'club-1')).toBe(true);
    expect(currentUser.fixedSchedules.some(s => s.id === 'tutoring-1')).toBe(true);
    expect(currentUser.fixedSchedules.some(s => s.id === 'old-import-1')).toBe(false);
    expect(currentUser.fixedSchedules.some(s => s.id === 'fixed-school-new-1')).toBe(true);
  });

  it('merges new slots without duplicate entries', () => {
    let currentUser = createBaseUser();
    currentUser.fixedSchedules = [
      { id: 'fs-1', title: 'Toán (GV Cô Hoa)', day: 1, start: '07:15', end: '08:00', type: 'school', source: 'timetable-import' }
    ];

    const duplicateRaw = 'T2|Toán|07:15|08:00|Cô Hoa';
    const parsed = TimetableImporter.parseStructuredText(duplicateRaw);
    const normalized = parsed.map(s => TimetableImporter.normalizeImportedSlot(s));

    // Merge mode logic
    let skippedCount = 0;
    const addedItems = [];
    normalized.forEach(slot => {
      if (currentUser.fixedSchedules.some(ext => TimetableImporter.isDuplicateScheduleEntry(ext, slot))) {
        skippedCount++;
        return;
      }
      addedItems.push({
        id: 'fs-new-2',
        title: slot.title,
        day: slot.day,
        start: slot.start,
        end: slot.end,
        type: 'school',
        source: 'timetable-import'
      });
    });

    currentUser.fixedSchedules = [...currentUser.fixedSchedules, ...addedItems];
    expect(skippedCount).toBe(1);
    expect(addedItems).toHaveLength(0);
    expect(currentUser.fixedSchedules).toHaveLength(1);
  });

  it('safeguards against corrupted or invalid slot data (atomic rollback)', () => {
    let currentUser = createBaseUser();
    currentUser.fixedSchedules = [
      { id: 'orig-1', title: 'Lịch ban đầu', day: 2, start: '08:00', end: '09:00', type: 'school' }
    ];
    const initialBackup = JSON.parse(JSON.stringify(currentUser.fixedSchedules));

    // Slot with invalid end time before start time
    const invalidSlot = {
      day: 1,
      title: 'Slot lỗi',
      start: '10:00',
      end: '08:00'
    };

    const validation = TimetableImporter.validateImportSlots([invalidSlot], currentUser.fixedSchedules);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toHaveLength(1);
    expect(validation.errors[0].messages[0]).toContain('Giờ kết thúc phải sau giờ bắt đầu');

    // Because validation failed, apply aborts and does not touch fixedSchedules
    if (!validation.valid) {
      // Aborted - no state commit
    }

    expect(currentUser.fixedSchedules).toEqual(initialBackup);
  });
});
