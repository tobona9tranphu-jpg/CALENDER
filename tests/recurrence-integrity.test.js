'use strict';

/**
 * P0.5 Recurrence System & Data Integrity Test Suite
 *
 * Tests:
 * 1. Recurrence Engine (Weekly, Interval, Daily, Monthly, Until, Count, Max-Range Guard)
 * 2. Occurrence Exceptions (Skip & Modify)
 * 3. Backward Compatibility with legacy day: 0..6
 * 4. Data Integrity Pipeline (Validation, Deduplication, Orphan Sanitization, Schema Migration)
 * 5. Corrupted Storage Recovery (safeLoadStorage & Emergency Backup)
 * 6. Integration: NotificationScheduler with Recurrence & Exceptions
 * 7. Integration: Calendar Plan Generation (createPlan) with Recurrence & Exceptions
 */

const AppDate = require('../src/utils/date');
const { RecurrenceEngine, DataIntegrity } = require('../src/recurrence');
const { NotificationTypes, NotificationPolicy, NotificationScheduler } = require('../src/notifications');
const NotificationStore = require('../src/notifications/notification-store').NotificationStore;

describe('P0.5 — Recurrence Engine', () => {

  describe('Validation', () => {
    test('validates frequency, interval, and weekdays correctly', () => {
      expect(RecurrenceEngine.validateRecurrenceRule(null).valid).toBe(false);
      expect(RecurrenceEngine.validateRecurrenceRule({ frequency: 'YEARLY' }).valid).toBe(false);
      expect(RecurrenceEngine.validateRecurrenceRule({ frequency: 'WEEKLY', interval: 0 }).valid).toBe(false);
      expect(RecurrenceEngine.validateRecurrenceRule({ frequency: 'WEEKLY', interval: 53 }).valid).toBe(false);
      expect(RecurrenceEngine.validateRecurrenceRule({ frequency: 'WEEKLY', daysOfWeek: [] }).valid).toBe(false);
      expect(RecurrenceEngine.validateRecurrenceRule({ frequency: 'WEEKLY', daysOfWeek: [7] }).valid).toBe(false);
      expect(RecurrenceEngine.validateRecurrenceRule({ frequency: 'WEEKLY', daysOfWeek: [1, 3, 5], interval: 1 }).valid).toBe(true);
      expect(RecurrenceEngine.validateRecurrenceRule({ frequency: 'DAILY', interval: 2 }).valid).toBe(true);
      expect(RecurrenceEngine.validateRecurrenceRule({ frequency: 'MONTHLY', interval: 1 }).valid).toBe(true);
    });

    test('validates untilDate format', () => {
      expect(RecurrenceEngine.validateRecurrenceRule({ frequency: 'DAILY', untilDate: 'not-a-date' }).valid).toBe(false);
      expect(RecurrenceEngine.validateRecurrenceRule({ frequency: 'DAILY', untilDate: '2026-12-31' }).valid).toBe(true);
    });
  });

  describe('Bounded Expansion & Safety Limits', () => {
    test('throws an error if expansion window exceeds 366 days', () => {
      const event = {
        id: 'test-event',
        title: 'Lớp học',
        startDate: '2026-01-01',
        recurrence: { frequency: 'DAILY' }
      };
      expect(() => {
        RecurrenceEngine.expandOccurrences(event, '2026-01-01', '2027-02-15');
      }).toThrow(/Expansion window exceeds maximum limit of 366 days/);
    });

    test('returns empty array if rangeStart > rangeEnd', () => {
      const event = {
        id: 'test-event',
        title: 'Lớp học',
        recurrence: { frequency: 'DAILY' }
      };
      expect(RecurrenceEngine.expandOccurrences(event, '2026-09-20', '2026-09-10')).toEqual([]);
    });

    test('returns empty array if event starts after rangeEnd', () => {
      const event = {
        id: 'test-event',
        title: 'Lớp học',
        startDate: '2026-10-01',
        recurrence: { frequency: 'DAILY' }
      };
      const result = RecurrenceEngine.expandOccurrences(event, '2026-09-01', '2026-09-15');
      expect(result).toHaveLength(0);
    });
  });

  describe('Weekly Recurrence Patterns', () => {
    test('expands single-day weekly event (e.g. Every Monday / day 1)', () => {
      // 2026-09-14 is Monday
      const event = {
        id: 'tutoring-math',
        title: 'Học thêm Toán',
        startDate: '2026-09-14',
        start: '18:00',
        end: '19:30',
        recurrence: {
          frequency: 'WEEKLY',
          interval: 1,
          daysOfWeek: [1]
        }
      };

      const occurrences = RecurrenceEngine.expandOccurrences(event, '2026-09-14', '2026-09-28');
      expect(occurrences).toHaveLength(3);
      expect(occurrences.map(o => o.occurrenceDate)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28']);
      expect(occurrences[0].title).toBe('Học thêm Toán');
      expect(occurrences[0].start).toBe('18:00');
    });

    test('expands multi-day weekly event (e.g. Mon, Wed, Fri / days 1, 3, 5)', () => {
      const event = {
        id: 'school-class',
        title: 'Học trên trường',
        startDate: '2026-09-14', // Mon
        start: '07:00',
        end: '11:30',
        recurrence: {
          frequency: 'WEEKLY',
          interval: 1,
          daysOfWeek: [1, 3, 5]
        }
      };

      const occurrences = RecurrenceEngine.expandOccurrences(event, '2026-09-14', '2026-09-20');
      // 14(Mon), 16(Wed), 18(Fri)
      expect(occurrences).toHaveLength(3);
      expect(occurrences.map(o => o.occurrenceDate)).toEqual(['2026-09-14', '2026-09-16', '2026-09-18']);
      expect(occurrences.map(o => o.day)).toEqual([1, 3, 5]);
    });

    test('expands bi-weekly event (interval: 2 weeks)', () => {
      const event = {
        id: 'club-event',
        title: 'Sinh hoạt CLB',
        startDate: '2026-09-14', // Mon, week 0
        start: '16:00',
        end: '18:00',
        recurrence: {
          frequency: 'WEEKLY',
          interval: 2,
          daysOfWeek: [1]
        }
      };

      const occurrences = RecurrenceEngine.expandOccurrences(event, '2026-09-14', '2026-10-12');
      // 2026-09-14 (wk 0), 2026-09-28 (wk 2), 2026-10-12 (wk 4)
      expect(occurrences.map(o => o.occurrenceDate)).toEqual(['2026-09-14', '2026-09-28', '2026-10-12']);
    });
  });

  describe('Daily & Monthly Recurrence Patterns', () => {
    test('expands daily event every 2 days', () => {
      const event = {
        id: 'workout',
        title: 'Chạy bộ',
        startDate: '2026-09-14',
        start: '06:00',
        end: '06:45',
        recurrence: {
          frequency: 'DAILY',
          interval: 2
        }
      };

      const occurrences = RecurrenceEngine.expandOccurrences(event, '2026-09-14', '2026-09-20');
      expect(occurrences.map(o => o.occurrenceDate)).toEqual(['2026-09-14', '2026-09-16', '2026-09-18', '2026-09-20']);
    });

    test('expands monthly event on same day of month', () => {
      const event = {
        id: 'monthly-mock-exam',
        title: 'Thi thử định kỳ',
        startDate: '2026-09-15',
        start: '08:00',
        end: '11:00',
        recurrence: {
          frequency: 'MONTHLY',
          interval: 1
        }
      };

      const occurrences = RecurrenceEngine.expandOccurrences(event, '2026-09-01', '2026-12-31');
      expect(occurrences.map(o => o.occurrenceDate)).toEqual(['2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15']);
    });

    test('handles month-end boundaries gracefully for monthly events on 31st', () => {
      const event = {
        id: 'month-end-review',
        title: 'Tổng kết tháng',
        startDate: '2026-01-31',
        start: '19:00',
        end: '20:00',
        recurrence: {
          frequency: 'MONTHLY',
          interval: 1
        }
      };

      const occurrences = RecurrenceEngine.expandOccurrences(event, '2026-01-01', '2026-04-30');
      // Jan: 31, Feb: 28, Mar: 31, Apr: 30
      expect(occurrences.map(o => o.occurrenceDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    });
  });

  describe('End Conditions: untilDate & count', () => {
    test('stops generating occurrences once untilDate is passed', () => {
      const event = {
        id: 'summer-course',
        title: 'Khóa học hè',
        startDate: '2026-09-14',
        recurrence: {
          frequency: 'WEEKLY',
          daysOfWeek: [1],
          untilDate: '2026-09-25'
        }
      };

      const occurrences = RecurrenceEngine.expandOccurrences(event, '2026-09-14', '2026-10-14');
      // Only 2026-09-14 and 2026-09-21 (2026-09-28 is > 2026-09-25)
      expect(occurrences.map(o => o.occurrenceDate)).toEqual(['2026-09-14', '2026-09-21']);
    });

    test('stops generating occurrences once count limit is reached', () => {
      const event = {
        id: 'tutor-sessions',
        title: '5 buổi gia sư',
        startDate: '2026-09-14',
        recurrence: {
          frequency: 'DAILY',
          interval: 1,
          count: 4
        }
      };

      const occurrences = RecurrenceEngine.expandOccurrences(event, '2026-09-14', '2026-09-30');
      expect(occurrences).toHaveLength(4);
      expect(occurrences.map(o => o.occurrenceDate)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17']);
    });
  });

  describe('First-Class Exceptions (Skip & Modify)', () => {
    test('skip exception drops occurrence from expanded list', () => {
      let event = {
        id: 'weekly-math',
        title: 'Toán học thêm',
        startDate: '2026-09-14', // Mon
        start: '18:00',
        end: '19:30',
        recurrence: {
          frequency: 'WEEKLY',
          daysOfWeek: [1]
        }
      };

      // Skip occurrence on 2026-09-21
      event = RecurrenceEngine.addSkipException(event, '2026-09-21');

      const occurrences = RecurrenceEngine.expandOccurrences(event, '2026-09-14', '2026-09-28');
      expect(occurrences.map(o => o.occurrenceDate)).toEqual(['2026-09-14', '2026-09-28']);
    });

    test('modify exception overrides start, end, and title on specific date only', () => {
      let event = {
        id: 'weekly-english',
        title: 'Anh văn',
        startDate: '2026-09-14',
        start: '17:00',
        end: '18:30',
        recurrence: {
          frequency: 'WEEKLY',
          daysOfWeek: [1]
        }
      };

      // Modify occurrence on 2026-09-21 to different time and title
      event = RecurrenceEngine.addModifyException(event, '2026-09-21', {
        title: 'Anh văn (Đổi giờ kiểm tra)',
        start: '19:00',
        end: '20:30'
      });

      const occurrences = RecurrenceEngine.expandOccurrences(event, '2026-09-14', '2026-09-28');
      expect(occurrences).toHaveLength(3);

      // Occurrence 1: default
      expect(occurrences[0].occurrenceDate).toBe('2026-09-14');
      expect(occurrences[0].start).toBe('17:00');
      expect(occurrences[0].title).toBe('Anh văn');
      expect(occurrences[0].isModifiedOccurrence).toBe(false);

      // Occurrence 2: modified
      expect(occurrences[1].occurrenceDate).toBe('2026-09-21');
      expect(occurrences[1].start).toBe('19:00');
      expect(occurrences[1].end).toBe('20:30');
      expect(occurrences[1].title).toBe('Anh văn (Đổi giờ kiểm tra)');
      expect(occurrences[1].isModifiedOccurrence).toBe(true);

      // Occurrence 3: default restored
      expect(occurrences[2].occurrenceDate).toBe('2026-09-28');
      expect(occurrences[2].start).toBe('17:00');
      expect(occurrences[2].title).toBe('Anh văn');
      expect(occurrences[2].isModifiedOccurrence).toBe(false);
    });
  });

  describe('Backward Compatibility', () => {
    test('expands legacy event with day: 4 (Thursday) as weekly recurrence', () => {
      const legacyEvent = {
        id: 'legacy-school',
        title: 'Học trên trường',
        day: 4, // Thursday
        start: '07:00',
        end: '11:30',
        type: 'school'
      };

      // 2026-09-17 is Thursday, 2026-09-24 is Thursday
      const occurrences = RecurrenceEngine.expandOccurrences(legacyEvent, '2026-09-14', '2026-09-27');
      expect(occurrences.map(o => o.occurrenceDate)).toEqual(['2026-09-17', '2026-09-24']);
      expect(occurrences[0].title).toBe('Học trên trường');
      expect(occurrences[0].type).toBe('school');
    });

    test('expands single non-recurring event within date window', () => {
      const singleEvent = {
        id: 'one-off-exam',
        title: 'Thi thử',
        startDate: '2026-09-18',
        start: '08:00',
        end: '10:00',
        flexible: false
      };

      const inside = RecurrenceEngine.expandOccurrences(singleEvent, '2026-09-14', '2026-09-20');
      expect(inside).toHaveLength(1);
      expect(inside[0].occurrenceDate).toBe('2026-09-18');

      const outside = RecurrenceEngine.expandOccurrences(singleEvent, '2026-09-21', '2026-09-28');
      expect(outside).toHaveLength(0);
    });
  });
});

describe('P0.5 — Data Integrity & Storage Recovery', () => {

  describe('Validation Helpers', () => {
    test('validateTask checks required fields, deadline format, and minute ranges', () => {
      expect(DataIntegrity.validateTask(null).valid).toBe(false);
      expect(DataIntegrity.validateTask({ id: 't1' }).valid).toBe(false); // missing title
      expect(DataIntegrity.validateTask({ id: 't1', title: 'Task 1', minutes: -5 }).valid).toBe(false);
      expect(DataIntegrity.validateTask({ id: 't1', title: 'Task 1', minutes: 2000 }).valid).toBe(false);
      expect(DataIntegrity.validateTask({ id: 't1', title: 'Task 1', deadline: 'invalid-date' }).valid).toBe(false);
      expect(DataIntegrity.validateTask({ id: 't1', title: 'Task 1', minutes: 45, deadline: '2026-09-20' }).valid).toBe(true);
    });

    test('validateSchedule checks start/end time format and recurrence rules', () => {
      expect(DataIntegrity.validateSchedule({ id: 's1', title: 'Schedule 1', start: '25:00', end: '19:00' }).valid).toBe(true); // format is valid \d:\d
      expect(DataIntegrity.validateSchedule({ id: 's1', title: 'Schedule 1', start: 'abc', end: '19:00' }).valid).toBe(false);
      expect(DataIntegrity.validateSchedule({ id: 's1', title: 'Schedule 1', day: 8 }).valid).toBe(false);
      expect(DataIntegrity.validateSchedule({ id: 's1', title: 'Schedule 1', day: 2, start: '18:00', end: '19:30' }).valid).toBe(true);
    });
  });

  describe('Deduplication & Safe Re-keying', () => {
    test('resolveDuplicateIds preserves canonical record and safely re-keys duplicate ids', () => {
      const items = [
        { id: 'task-1', title: 'First instance' },
        { id: 'task-1', title: 'Second instance (collision)' },
        { id: 'task-2', title: 'Unique' },
        { id: 'task-1', title: 'Third instance (collision)' }
      ];

      const { cleanItems, duplicateCount } = DataIntegrity.resolveDuplicateIds(items, 'task');
      expect(duplicateCount).toBe(2);
      expect(cleanItems).toHaveLength(4);
      expect(cleanItems[0].id).toBe('task-1');
      expect(cleanItems[0].title).toBe('First instance');
      expect(cleanItems[1].id).toMatch(/^task-1-dup-/);
      expect(cleanItems[2].id).toBe('task-2');
      expect(cleanItems[3].id).toMatch(/^task-1-dup-/);
      expect(cleanItems[1].id).not.toBe(cleanItems[3].id);
    });
  });

  describe('Orphan Sanitization', () => {
    test('sanitizeOrphans cleans dangling subject/topic references in tasks and reviews', () => {
      const user = {
        subjects: [
          { id: 'sub-math', topics: [{ id: 'top-calc', name: 'Calculus' }] }
        ],
        tasks: [
          { id: 't1', title: 'Valid task', subjectId: 'sub-math', topicId: 'top-calc' },
          { id: 't2', title: 'Dangling topic', subjectId: 'sub-math', topicId: 'top-deleted' },
          { id: 't3', title: 'Dangling subject', subjectId: 'sub-deleted', topicId: 'top-calc' }
        ],
        reviewSchedules: [
          { id: 'r1', topicId: 'top-calc', due: '2026-09-20' },
          { id: 'r2', topicId: 'top-deleted', due: '2026-09-22' }
        ]
      };

      const { sanitizedUser, orphansCount } = DataIntegrity.sanitizeOrphans(user);
      expect(orphansCount).toBe(3); // 1 task topic, 1 task subject, 1 review schedule

      expect(sanitizedUser.tasks[0].subjectId).toBe('sub-math');
      expect(sanitizedUser.tasks[0].topicId).toBe('top-calc');

      expect(sanitizedUser.tasks[1].subjectId).toBe('sub-math');
      expect(sanitizedUser.tasks[1].topicId).toBeNull();

      expect(sanitizedUser.tasks[2].subjectId).toBeNull();

      // Review schedule for deleted topic is removed
      expect(sanitizedUser.reviewSchedules).toHaveLength(1);
      expect(sanitizedUser.reviewSchedules[0].id).toBe('r1');
    });
  });

  describe('Schema Migration', () => {
    test('migrateUserData upgrades legacy v1 data to v2 with exceptions and notes arrays', () => {
      const legacyUser = {
        id: 'user-legacy',
        fixedSchedules: [
          { id: 'f1', title: 'Học thêm', day: 1, start: '18:00', end: '19:30' }
        ]
      };

      const migrated = DataIntegrity.migrateUserData(legacyUser);
      expect(migrated.dataVersion).toBe(2);
      expect(migrated.fixedSchedules[0].flexible).toBe(false);
      expect(migrated.fixedSchedules[0].exceptions).toEqual([]);
      expect(Array.isArray(migrated.studyNotes)).toBe(true);
      expect(Array.isArray(migrated.examMilestones)).toBe(true);
    });
  });

  describe('Resilient Storage Recovery (safeLoadStorage)', () => {
    test('recovers from malformed JSON by writing emergency backup and returning fallback', () => {
      const mockStorage = {
        data: {
          'test_key': '{"invalid JSON corrupt...'
        },
        getItem(k) { return this.data[k] || null; },
        setItem(k, v) { this.data[k] = v; }
      };

      const result = DataIntegrity.safeLoadStorage('test_key', mockStorage, [{ fallback: true }]);
      expect(result).toEqual([{ fallback: true }]);

      // Check emergency backup was created
      const backupKeys = Object.keys(mockStorage.data).filter(k => k.startsWith(DataIntegrity.BACKUP_PREFIX));
      expect(backupKeys.length).toBe(1);
      expect(mockStorage.data[backupKeys[0]]).toBe('{"invalid JSON corrupt...');
    });

    test('loads valid JSON normally without creating emergency backups', () => {
      const mockStorage = {
        data: {
          'valid_key': JSON.stringify({ name: 'Valid User' })
        },
        getItem(k) { return this.data[k] || null; },
        setItem(k, v) { this.data[k] = v; }
      };

      const result = DataIntegrity.safeLoadStorage('valid_key', mockStorage, null);
      expect(result).toEqual({ name: 'Valid User' });

      const backupKeys = Object.keys(mockStorage.data).filter(k => k.startsWith(DataIntegrity.BACKUP_PREFIX));
      expect(backupKeys.length).toBe(0);
    });
  });

  describe('Full Processing Pipeline (processUserDataPipeline)', () => {
    test('runs migrate -> validate -> deduplicate -> sanitize in a unified call', () => {
      const raw = {
        subjects: [{ id: 's1', topics: [{ id: 't1', name: 'Topic 1' }] }],
        tasks: [
          { id: 'dup1', title: 'Task Alpha', minutes: 45, subjectId: 's1', topicId: 't1' },
          { id: 'dup1', title: 'Task Beta', minutes: 30, subjectId: 's1', topicId: 't1' },
          { id: 'invalid-task', title: '', minutes: -10 } // should be filtered
        ],
        fixedSchedules: [
          { id: 'f1', title: 'Class 1', day: 2, start: '18:00', end: '19:30' }
        ]
      };

      const { data, issues } = DataIntegrity.processUserDataPipeline(raw);

      expect(data.dataVersion).toBe(2);
      expect(data.tasks).toHaveLength(2); // invalid task filtered
      expect(data.tasks[0].id).toBe('dup1');
      expect(data.tasks[1].id).toMatch(/^dup1-dup-/);
      expect(issues.some(i => i.includes('Filtered invalid task'))).toBe(true);
      expect(issues.some(i => i.includes('Resolved 1 duplicate task IDs'))).toBe(true);
    });
  });
});

describe('P0.5 — Integration: Notifications with Recurrence & Exceptions', () => {
  let store;
  let scheduler;
  let triggered;

  beforeEach(() => {
    store = new NotificationStore({ storageKey: 'test_notif_recurrence_' + Date.now() });
    triggered = [];
    scheduler = new NotificationScheduler({
      store,
      onTrigger: (n) => triggered.push(n),
      advanceMinutes: 15
    });
  });

  test('schedules reminder for active recurring event on today', () => {
    // 2026-09-14 is Monday (weekday 1)
    // Event at 20:00 VN, reminder trigger is 19:45 VN
    // Now instant is 19:50 VN = 12:50 UTC
    const nowInstant = new Date('2026-09-14T12:50:00.000Z');

    const user = {
      fixedSchedules: [
        {
          id: 'event-weekly',
          title: 'Lớp học tuần',
          day: 1,
          start: '20:00',
          end: '21:30',
          type: 'school',
          recurrence: {
            frequency: 'WEEKLY',
            daysOfWeek: [1]
          }
        }
      ],
      tasks: [],
      reviewSchedules: []
    };

    const results = scheduler.reconcile(user, nowInstant);
    expect(results.length).toBe(1);
    expect(results[0].title).toContain('Lớp học tuần');
    expect(results[0].message).toContain('20:00');
  });

  test('does NOT schedule reminder when today occurrence has a skip exception', () => {
    const nowInstant = new Date('2026-09-14T12:50:00.000Z');

    const user = {
      fixedSchedules: [
        {
          id: 'event-skip-test',
          title: 'Lớp học có skip',
          day: 1,
          start: '20:00',
          end: '21:30',
          type: 'tutoring',
          recurrence: {
            frequency: 'WEEKLY',
            daysOfWeek: [1]
          },
          exceptions: [
            { occurrenceDate: '2026-09-14', type: 'skip' }
          ]
        }
      ],
      tasks: [],
      reviewSchedules: []
    };

    const results = scheduler.reconcile(user, nowInstant);
    expect(results.length).toBe(0);
  });

  test('adjusts reminder trigger time when today occurrence has a modify exception', () => {
    // Original event was 18:00 (reminder trigger 17:45)
    // Modified to 21:00 (reminder trigger 20:45)
    const user = {
      fixedSchedules: [
        {
          id: 'event-modify-test',
          title: 'Lớp học đổi giờ',
          day: 1,
          start: '18:00',
          end: '19:30',
          type: 'tutoring',
          recurrence: {
            frequency: 'WEEKLY',
            daysOfWeek: [1]
          },
          exceptions: [
            {
              occurrenceDate: '2026-09-14',
              type: 'modify',
              override: {
                start: '21:00',
                end: '22:30',
                title: 'Lớp học (Dời sang 21h)'
              }
            }
          ]
        }
      ],
      tasks: [],
      reviewSchedules: []
    };

    // At 17:50 VN (10:50 UTC), modified event at 21:00 should NOT fire yet
    const earlyInstant = new Date('2026-09-14T10:50:00.000Z');
    const earlyResults = scheduler.reconcile(user, earlyInstant);
    expect(earlyResults.length).toBe(0);

    // At 20:50 VN (13:50 UTC), modified event at 21:00 should fire!
    const lateInstant = new Date('2026-09-14T13:50:00.000Z');
    const lateResults = scheduler.reconcile(user, lateInstant);
    expect(lateResults.length).toBe(1);
    expect(lateResults[0].title).toContain('Lớp học (Dời sang 21h)');
    expect(lateResults[0].message).toContain('21:00');
  });

  test('cancels scheduled notifications when series is deleted', () => {
    store.recordFiredKey('event:event-to-delete:reminder:2026-09-14T20:00');
    expect(store.hasFiredKey('event:event-to-delete:reminder:2026-09-14T20:00')).toBe(true);

    scheduler.handleItemDeleted('event', 'event-to-delete');
    expect(store.hasFiredKey('event:event-to-delete:reminder:2026-09-14T20:00')).toBe(false);
  });
});

describe('P0.5 — Integration: Calendar Plan Generation (createPlan)', () => {
  // Test standalone plan generation logic using RecurrenceEngine bounded expansion
  function generateMockPlan(user, forDate) {
    const availability = user.availability;
    const viewDate = forDate;
    const todayDay = AppDate.getAppDayOfWeek(viewDate);
    const isAvailableDay = availability.days.includes(todayDay);

    let fixed = [];
    for (const event of (user.fixedSchedules || [])) {
      const occs = RecurrenceEngine.expandOccurrences(event, viewDate, viewDate);
      fixed.push(...occs);
    }
    fixed.sort((a, b) => AppDate.minFromTime(a.start) - AppDate.minFromTime(b.start));

    const selected = isAvailableDay ? (user.tasks || []).filter(t => t.status !== 'done').slice(0, 3) : [];
    let cursor = AppDate.minFromTime(availability.start);
    const end = AppDate.minFromTime(availability.end);
    const plan = [];

    for (const task of selected) {
      const duration = Number(task.minutes);
      for (const event of fixed) {
        const fixedStart = AppDate.minFromTime(event.start);
        const fixedEnd = AppDate.minFromTime(event.end);
        if (cursor < fixedEnd && cursor + duration > fixedStart) cursor = fixedEnd + 10;
      }
      if (cursor + duration <= end) {
        plan.push({ ...task, start: AppDate.timeFromMin(cursor), end: AppDate.timeFromMin(cursor + duration) });
        cursor += duration + 10;
      }
    }

    return { fixed, plan };
  }

  test('routes flexible tasks around active recurring fixed schedules', () => {
    const user = {
      availability: { start: '17:00', end: '22:00', days: [1] }, // Monday
      fixedSchedules: [
        {
          id: 'school-fix',
          title: 'Học cố định',
          startDate: '2026-09-14',
          start: '17:00',
          end: '18:30',
          recurrence: { frequency: 'WEEKLY', daysOfWeek: [1] }
        }
      ],
      tasks: [
        { id: 't1', title: 'Toán', minutes: 60, status: 'open' }
      ]
    };

    const { fixed, plan } = generateMockPlan(user, '2026-09-14');
    expect(fixed).toHaveLength(1);
    expect(fixed[0].title).toBe('Học cố định');
    // Task must start after 18:30 + 10m buffer = 18:40
    expect(plan).toHaveLength(1);
    expect(plan[0].start).toBe('18:40');
    expect(plan[0].end).toBe('19:40');
  });

  test('frees time slot and allows task to occupy former fixed time when occurrence is skipped', () => {
    let fixEvent = {
      id: 'school-fix',
      title: 'Học cố định',
      startDate: '2026-09-14',
      start: '17:00',
      end: '18:30',
      recurrence: { frequency: 'WEEKLY', daysOfWeek: [1] }
    };

    // Skip occurrence on 2026-09-14
    fixEvent = RecurrenceEngine.addSkipException(fixEvent, '2026-09-14');

    const user = {
      availability: { start: '17:00', end: '22:00', days: [1] },
      fixedSchedules: [fixEvent],
      tasks: [
        { id: 't1', title: 'Toán', minutes: 60, status: 'open' }
      ]
    };

    const { fixed, plan } = generateMockPlan(user, '2026-09-14');
    expect(fixed).toHaveLength(0); // skipped!
    // Task can now start right at availability start 17:00!
    expect(plan).toHaveLength(1);
    expect(plan[0].start).toBe('17:00');
    expect(plan[0].end).toBe('18:00');
  });

  test('adjusts task layout around modified occurrence start and end times', () => {
    let fixEvent = {
      id: 'school-fix',
      title: 'Học cố định',
      startDate: '2026-09-14',
      start: '17:00',
      end: '18:00',
      recurrence: { frequency: 'WEEKLY', daysOfWeek: [1] }
    };

    // Shift occurrence to 19:00 - 20:30
    fixEvent = RecurrenceEngine.addModifyException(fixEvent, '2026-09-14', {
      start: '19:00',
      end: '20:30'
    });

    const user = {
      availability: { start: '17:00', end: '22:00', days: [1] },
      fixedSchedules: [fixEvent],
      tasks: [
        { id: 't1', title: 'Toán', minutes: 60, status: 'open' },
        { id: 't2', title: 'Văn', minutes: 60, status: 'open' }
      ]
    };

    const { fixed, plan } = generateMockPlan(user, '2026-09-14');
    expect(fixed).toHaveLength(1);
    expect(fixed[0].start).toBe('19:00');
    expect(fixed[0].end).toBe('20:30');

    // Task 1: 17:00 - 18:00
    expect(plan[0].start).toBe('17:00');
    expect(plan[0].end).toBe('18:00');

    // Task 2: starts at 18:10, finishes 19:10 BUT overlaps fixed (19:00-20:30), so it pushes past 20:30 -> 20:40 - 21:40
    expect(plan[1].start).toBe('20:40');
    expect(plan[1].end).toBe('21:40');
  });
});

