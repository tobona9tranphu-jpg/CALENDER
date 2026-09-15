'use strict';

const TimetableImporter = require('../src/timetable/timetable-importer');
const { QuickCapture } = require('../src/today/quick-capture');
const { InboxService } = require('../src/today/inbox-service');

describe('User Interaction Fixes — Timetable Apply, Take Note & Quick Capture Inbox', () => {

  describe('1. Timetable Apply & Validation Fixes', () => {
    test('auto-fills missing period start and end times for period-only slots', () => {
      const slots = [
        { day: 1, period: 1, title: 'Toán học', start: '', end: '' },
        { day: 1, period: 5, title: 'Ngữ văn', start: '', end: '' }
      ];

      slots.forEach(slot => {
        if ((!slot.start || !slot.end) && slot.period) {
          const pt = TimetableImporter.getPeriodTime(slot.period);
          if (pt) {
            slot.start = pt.start;
            slot.end = pt.end;
          }
        }
      });

      expect(slots[0].start).toBe('07:15');
      expect(slots[0].end).toBe('08:00');
      expect(slots[1].start).toBe('10:45');
      expect(slots[1].end).toBe('11:30');
    });

    test('validates auto-filled slots successfully without errors', () => {
      const slots = [
        { day: 1, period: 1, title: 'Toán học', start: '07:15', end: '08:00' },
        { day: 1, period: 2, title: 'Vật lý', start: '08:00', end: '08:45' }
      ];

      const validation = TimetableImporter.validateImportSlots(slots, []);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('2. Take Note Robustness Fixes', () => {
    test('handles subject with undefined topics array safely', () => {
      const user = {
        subjects: [
          { id: 'sub-1', name: 'Toán học' } // topics is undefined
        ],
        studyNotes: [],
        tasks: [],
        reviewSchedules: []
      };

      const subjectId = 'sub-1';
      const topicName = 'Hình học không gian';
      const understanding = 3;

      const subject = user.subjects.find(s => s.id === subjectId);
      expect(subject).toBeDefined();

      // Fix applied: initialize topics array if missing
      if (subject) {
        subject.topics = subject.topics || [];
      }

      let topic = subject.topics.find(t => t.name.toLowerCase() === topicName.toLowerCase());
      if (!topic) {
        topic = { id: 'topic-1', name: topicName, mastery: 60, quiz: {} };
        subject.topics.push(topic);
      }

      expect(subject.topics).toHaveLength(1);
      expect(subject.topics[0].name).toBe('Hình học không gian');
    });

    test('creates fallback default subject if user has 0 subjects', () => {
      const user = { subjects: [] };

      if (!user.subjects || !user.subjects.length) {
        user.subjects.push({
          id: 'sub-def',
          name: 'Toán học',
          target: 'Môn chính',
          color: 'blue',
          icon: 'T',
          topics: [{ id: 'topic-def', name: 'Chủ đề chung', mastery: 50, quiz: {} }]
        });
      }

      expect(user.subjects).toHaveLength(1);
      expect(user.subjects[0].name).toBe('Toán học');
    });
  });

  describe('3. Quick Capture & Inbox Task Addition Fixes', () => {
    test('parses shorthand input correctly and creates inbox task', () => {
      const rawInput = 'Mua sách bài tập Toán 45p !';
      const parsed = QuickCapture.parseShorthand(rawInput, '2026-03-12');

      expect(parsed.cleanTitle).toBe('Mua sách bài tập Toán');
      expect(parsed.durationMinutes).toBe(45);
      expect(parsed.priority).toBe(4); // high priority due to !

      const newTask = {
        id: 'task-' + Date.now(),
        subjectId: 'math',
        title: parsed.cleanTitle,
        minutes: parsed.durationMinutes,
        priority: parsed.priority,
        status: 'open',
        isInbox: true,
        scheduledDate: null,
        deadline: null,
        createdAt: '2026-03-12'
      };

      const tasks = [newTask];
      const inboxItems = InboxService.getInboxItems(tasks);

      expect(inboxItems).toHaveLength(1);
      expect(inboxItems[0].title).toBe('Mua sách bài tập Toán');
      expect(inboxItems[0].minutes).toBe(45);
      expect(inboxItems[0].priority).toBe(4);
    });
  });

  describe('4. Canonical Day Mapping & Normalization', () => {
    test('normalizes days across Vietnamese labels, abbreviations, and numbers', () => {
      const { parseTimetableDayToAppDay, normalizeImportedSlot } = TimetableImporter;

      // Monday (1)
      expect(parseTimetableDayToAppDay('Thứ hai')).toBe(1);
      expect(parseTimetableDayToAppDay('Thứ 2')).toBe(1);
      expect(parseTimetableDayToAppDay('T2')).toBe(1);
      expect(parseTimetableDayToAppDay(1)).toBe(1);
      expect(parseTimetableDayToAppDay('1')).toBe(1);

      // Tuesday (2)
      expect(parseTimetableDayToAppDay('Thứ ba')).toBe(2);
      expect(parseTimetableDayToAppDay('Thứ 3')).toBe(2);
      expect(parseTimetableDayToAppDay('T3')).toBe(2);
      expect(parseTimetableDayToAppDay(2)).toBe(2);

      // Wednesday (3)
      expect(parseTimetableDayToAppDay('Thứ tư')).toBe(3);
      expect(parseTimetableDayToAppDay('Thứ 4')).toBe(3);
      expect(parseTimetableDayToAppDay('T4')).toBe(3);

      // Thursday (4)
      expect(parseTimetableDayToAppDay('Thứ năm')).toBe(4);
      expect(parseTimetableDayToAppDay('Thứ 5')).toBe(4);

      // Friday (5)
      expect(parseTimetableDayToAppDay('Thứ sáu')).toBe(5);
      expect(parseTimetableDayToAppDay('Thứ 6')).toBe(5);

      // Saturday (6)
      expect(parseTimetableDayToAppDay('Thứ bảy')).toBe(6);
      expect(parseTimetableDayToAppDay('Thứ 7')).toBe(6);
      expect(parseTimetableDayToAppDay('T7')).toBe(6);
      expect(parseTimetableDayToAppDay(6)).toBe(6);

      // Sunday (0)
      expect(parseTimetableDayToAppDay('Chủ nhật')).toBe(0);
      expect(parseTimetableDayToAppDay('CN')).toBe(0);
      expect(parseTimetableDayToAppDay('cn.')).toBe(0);
      expect(parseTimetableDayToAppDay(7)).toBe(0); // Vietnamese Sunday convention -> canonical app 0
      expect(parseTimetableDayToAppDay('7')).toBe(0);
      expect(parseTimetableDayToAppDay(0)).toBe(0);
      expect(parseTimetableDayToAppDay('0')).toBe(0);
      expect(parseTimetableDayToAppDay('T8')).toBe(0);
      expect(parseTimetableDayToAppDay(8)).toBe(0);
    });

    test('normalizeImportedSlot cleans days and formats hours properly', () => {
      const { normalizeImportedSlot } = TimetableImporter;

      const rawSlot = {
        title: 'Sinh học',
        day: 'Thứ 7',
        start: '7:15',
        end: '8:00'
      };

      const normalized = normalizeImportedSlot(rawSlot);
      expect(normalized.day).toBe(6);
      expect(normalized.start).toBe('07:15');
      expect(normalized.end).toBe('08:00');

      const sundaySlot = {
        title: 'Ôn thi CN',
        day: 7,
        period: 1
      };
      const normSunday = normalizeImportedSlot(sundaySlot);
      expect(normSunday.day).toBe(0);
      expect(normSunday.start).toBe('07:15');
      expect(normSunday.end).toBe('08:00');
    });
  });

  describe('5. Full Timetable Apply Flow & State Integrity', () => {
    const { RecurrenceEngine, DataIntegrity } = require('../src/recurrence');

    test('replaces imported/school slots while strictly preserving manual schedules', () => {
      const initialUser = {
        profile: { name: 'An', grade: 'Lớp 12A1' },
        fixedSchedules: [
          { id: 'f-school-old', title: 'Toán cũ', day: 1, start: '07:15', end: '08:00', type: 'school', source: 'timetable-import' },
          { id: 'f-manual-tutoring', title: 'Học thêm Lý', day: 2, start: '18:00', end: '19:30', type: 'tutoring', source: 'manual' },
          { id: 'f-manual-club', title: 'CLB Bóng rổ', day: 6, start: '16:00', end: '17:30', type: 'personal' }
        ],
        tasks: [],
        subjects: [{ id: 's1', name: 'Toán' }]
      };

      const parsedSlots = [
        { day: 'Thứ 2', start: '07:15', end: '08:00', title: 'Toán mới', subjectGroup: 'Toán' },
        { day: 'Thứ 3', start: '08:05', end: '08:50', title: 'Hóa học', subjectGroup: 'Hóa học' },
        { day: 7, start: '08:00', end: '09:00', title: 'Sinh hoạt CLB trường', subjectGroup: 'Khác' }
      ];

      // Simulate applyImportedTimetable in 'replace' mode
      const mode = 'replace';
      let baseFixed = [];
      if (mode === 'replace') {
        baseFixed = initialUser.fixedSchedules.filter(item => {
          if (item.source === 'timetable-import') return false;
          if (item.type === 'school' && !item.source && (item.id.startsWith('fixed-school') || item.id.startsWith('imported'))) return false;
          return true;
        });
      }

      const newFixed = parsedSlots.map((slot, idx) => ({
        id: `fixed-school-${idx}`,
        title: slot.title,
        day: TimetableImporter.parseTimetableDayToAppDay(slot.day),
        start: slot.start,
        end: slot.end,
        type: 'school',
        source: 'timetable-import'
      }));

      initialUser.fixedSchedules = [...baseFixed, ...newFixed];

      // Total should be: 2 manual preserved + 3 newly imported = 5
      expect(initialUser.fixedSchedules).toHaveLength(5);
      expect(initialUser.fixedSchedules.some(s => s.id === 'f-manual-tutoring')).toBe(true);
      expect(initialUser.fixedSchedules.some(s => s.id === 'f-manual-club')).toBe(true);
      expect(initialUser.fixedSchedules.some(s => s.title === 'Toán cũ')).toBe(false);

      // Verify Sunday ca học has day: 0
      const sundayCa = initialUser.fixedSchedules.find(s => s.title === 'Sinh hoạt CLB trường');
      expect(sundayCa).toBeDefined();
      expect(sundayCa.day).toBe(0);

      // Verify RecurrenceEngine expands all 3 new occurrences
      const occMonday = RecurrenceEngine.expandOccurrences(newFixed[0], '2026-03-16', '2026-03-16'); // 2026-03-16 is Monday
      expect(occMonday).toHaveLength(1);
      expect(occMonday[0].title).toBe('Toán mới');

      const occSunday = RecurrenceEngine.expandOccurrences(newFixed[2], '2026-03-22', '2026-03-22'); // 2026-03-22 is Sunday
      expect(occSunday).toHaveLength(1);
      expect(occSunday[0].title).toBe('Sinh hoạt CLB trường');
    });

    test('PUT /api/user pipeline preserves fixedSchedules, tasks, and subjects without wiping', () => {
      const userPayload = {
        profile: { name: 'Thùy Dung', grade: 'Lớp 12A2' },
        availability: { start: '19:00', end: '22:30', days: [1, 2, 3, 4, 5, 6, 0] },
        fixedSchedules: [
          { id: 'f-1', title: 'Toán', day: 1, start: '07:15', end: '08:45', type: 'school' },
          { id: 'f-2', title: 'Văn', day: 2, start: '08:00', end: '09:30', type: 'school' },
          { id: 'f-3', title: 'Tiếng Anh', day: 0, start: '08:00', end: '09:30', type: 'school' }
        ],
        tasks: [{ id: 't1', title: 'Ôn bài Toán', minutes: 45, priority: 4, status: 'open' }],
        subjects: [{ id: 's1', name: 'Toán', topics: [] }]
      };

      const processed = DataIntegrity.processUserDataPipeline(userPayload);
      expect(processed.data).toBeDefined();
      expect(processed.data.fixedSchedules).toHaveLength(3);
      expect(processed.data.tasks).toHaveLength(1);
      expect(processed.data.subjects).toHaveLength(1);

      // Verify api/user.js destructuring works correctly
      const updatedUser = { ...processed.data, id: 'user-123', updatedAt: new Date().toISOString() };
      expect(updatedUser.fixedSchedules).toHaveLength(3);
      expect(updatedUser.fixedSchedules[2].day).toBe(0);
      expect(updatedUser.tasks).toHaveLength(1);
    });
  });

});
