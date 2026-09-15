'use strict';

const { detectConflicts } = require('../src/ai/conflict-intelligence');
const { analyzeCapacity } = require('../src/ai/capacity-engine');
const { evaluateDeadlineRisks } = require('../src/ai/deadline-intelligence');
const { analyzeDay, fixDay } = require('../src/ai/day-fix-engine');
const { computePlanningContextRevision } = require('../src/ai/planner-context');

const TEST_DATE = '2026-09-14';
const TEST_TOMORROW = '2026-09-15';

function createMockContext(overrides = {}) {
  return {
    currentDate: TEST_DATE,
    currentTime: '15:00',
    timezone: 'Asia/Ho_Chi_Minh',
    availability: { start: '15:00', end: '21:30', days: [1, 2, 3, 4, 5, 6, 0] },
    fixedEvents: [],
    scheduledTasks: [],
    inboxItems: [],
    deadlines: [],
    horizonDays: 3,
    ...overrides
  };
}

describe('P1.3 Comprehensive Engine Tests - Fix My Day', () => {
  describe('1. Conflict Intelligence Contract & Detection', () => {
    test('detects HARD overlap between two study tasks and outputs standard contract', () => {
      const ctx = createMockContext();
      const tasks = [
        { id: 't1', title: 'Toan', scheduledDate: TEST_DATE, startTime: '15:30', endTime: '17:00', durationMinutes: 90 },
        { id: 't2', title: 'Ly', scheduledDate: TEST_DATE, startTime: '16:30', endTime: '17:30', durationMinutes: 60 }
      ];
      const res = detectConflicts(tasks, ctx);
      expect(res.hasHardConflicts).toBe(true);
      expect(res.hardConflicts.length).toBeGreaterThan(0);
      const c = res.hardConflicts[0];
      expect(c.type).toBe('hard');
      expect(c.severity).toBe('high');
      expect(Array.isArray(c.taskIds)).toBe(true);
      expect(c.taskIds).toContain('t1');
      expect(c.taskIds).toContain('t2');
      expect(typeof c.reason).toBe('string');
      expect(typeof c.suggestedAction).toBe('string');
    });

    test('detects HARD overlap between study task and school timetable / fixed event', () => {
      const ctx = createMockContext({
        fixedEvents: [{ id: 'fe-school', title: 'Hoc truong', date: TEST_DATE, start: '15:00', end: '17:00', type: 'school' }]
      });
      const tasks = [
        { id: 't1', title: 'Hoc Them', scheduledDate: TEST_DATE, startTime: '16:00', endTime: '17:30', durationMinutes: 90 }
      ];
      const res = detectConflicts(tasks, ctx);
      expect(res.hasHardConflicts).toBe(true);
      const conf = res.hardConflicts.find(item => item.category === 'FIXED_EVENT_OVERLAP');
      expect(conf).toBeDefined();
      expect(conf.type).toBe('hard');
      expect(conf.severity).toBe('critical');
      expect(conf.eventIds).toContain('fe-school');
      expect(conf.taskIds).toContain('t1');
      expect(conf.message).toContain('Hoc truong');
    });

    test('detects SOFT conflict: insufficient break between consecutive tasks', () => {
      const ctx = createMockContext();
      const tasks = [
        { id: 't1', title: 'Toan', scheduledDate: TEST_DATE, startTime: '15:00', endTime: '16:00', durationMinutes: 60 },
        { id: 't2', title: 'Ly', scheduledDate: TEST_DATE, startTime: '16:05', endTime: '17:00', durationMinutes: 55 }
      ];
      const res = detectConflicts(tasks, ctx);
      const soft = res.softConflicts.find(item => item.category === 'INSUFFICIENT_BREAK');
      expect(soft).toBeDefined();
      expect(soft.type).toBe('soft');
      expect(soft.severity).toBe('medium');
      expect(soft.taskIds).toContain('t1');
      expect(soft.taskIds).toContain('t2');
    });

    test('returns zero conflicts when day schedule is clean', () => {
      const ctx = createMockContext();
      const tasks = [
        { id: 't1', title: 'Toan', scheduledDate: TEST_DATE, startTime: '15:00', endTime: '16:00', durationMinutes: 60 },
        { id: 't2', title: 'Ly', scheduledDate: TEST_DATE, startTime: '16:30', endTime: '17:30', durationMinutes: 60 }
      ];
      const res = detectConflicts(tasks, ctx);
      expect(res.hasHardConflicts).toBe(false);
      expect(res.hardConflicts.length).toBe(0);
      expect(res.softConflicts.length).toBe(0);
    });
  });

  describe('2. Capacity Intelligence Engine', () => {
    test('computes correct capacity for an empty day', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '20:00', days: [1, 2, 3, 4, 5, 6, 0] }
      });
      const cap = analyzeCapacity(TEST_DATE, ctx);
      expect(cap.availableMinutes).toBe(300);
      expect(cap.scheduledMinutes).toBe(0);
      expect(cap.taskMinutes).toBe(0);
      expect(cap.freeMinutes).toBe(300);
      expect(cap.overloadMinutes).toBe(0);
      expect(cap.utilization).toBe(0);
      expect(cap.isOverloaded).toBe(false);
      expect(cap.blocks.gaps.length).toBe(1);
      expect(cap.blocks.gaps[0].durationMinutes).toBe(300);
    });

    test('accounts for fixed events and school timetable in capacity', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '21:00', days: [1, 2, 3, 4, 5, 6, 0] },
        fixedEvents: [
          { id: 'school', title: 'Hoc chieu', date: TEST_DATE, start: '15:00', end: '17:00', type: 'school' },
          { id: 'dinner', title: 'An toi', date: TEST_DATE, start: '19:00', end: '20:00', type: 'personal' }
        ],
        scheduledTasks: [
          { id: 't1', title: 'Toan', scheduledDate: TEST_DATE, startTime: '17:30', endTime: '18:30', durationMinutes: 60 }
        ]
      });
      const cap = analyzeCapacity(TEST_DATE, ctx);
      expect(cap.availableMinutes).toBe(360);
      expect(cap.taskMinutes).toBe(60);
      expect(cap.blocks.school.length).toBe(1);
      expect(cap.blocks.fixed.length).toBe(2);
      expect(cap.freeMinutes).toBe(120);
      expect(cap.isOverloaded).toBe(false);
    });

    test('detects overloaded day when tasks exceed available window', () => {
      const ctx = createMockContext({
        availability: { start: '18:00', end: '20:00', days: [1, 2, 3, 4, 5, 6, 0] },
        scheduledTasks: [
          { id: 't1', title: 'Luyen de', scheduledDate: TEST_DATE, startTime: '18:00', endTime: '21:30', durationMinutes: 210 }
        ]
      });
      const cap = analyzeCapacity(TEST_DATE, ctx);
      expect(cap.isOverloaded).toBe(true);
      expect(cap.overloadMinutes).toBeGreaterThan(0);
      expect(cap.utilization).toBeGreaterThan(1.0);
    });
  });

  describe('3. Deadline Intelligence Urgency Tiers', () => {
    test('classifies overdue tasks (daysLeft < 0)', () => {
      const ctx = createMockContext({
        scheduledTasks: [
          { id: 't-past', title: 'Bao cao Ly', deadline: '2026-09-10', durationMinutes: 60, status: 'open' }
        ]
      });
      const res = evaluateDeadlineRisks(ctx, { currentDate: TEST_DATE });
      const item = res.items.find(i => i.taskId === 't-past');
      expect(item).toBeDefined();
      expect(item.urgency).toBe('overdue');
      expect(item.deadlineRisk).toBe(true);
      expect(item.explanation).toContain('quá hạn');
    });

    test('classifies as critical when due today but insufficient capacity', () => {
      const ctx = createMockContext({
        availability: { start: '19:00', end: '20:00' },
        scheduledTasks: [
          { id: 't-crit', title: 'De thi thu', deadline: TEST_DATE, durationMinutes: 180, status: 'open' }
        ]
      });
      const res = evaluateDeadlineRisks(ctx, { currentDate: TEST_DATE, currentTime: '19:00' });
      const item = res.items.find(i => i.taskId === 't-crit');
      expect(item).toBeDefined();
      expect(item.urgency).toBe('critical');
      expect(item.deadlineRisk).toBe(true);
      expect(item.message).toContain('Không đủ thời gian');
    });

    test('classifies as safe when ample capacity exists before deadline', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '21:00' },
        scheduledTasks: [
          { id: 't-safe', title: 'Doc bai', deadline: '2026-09-20', durationMinutes: 45, status: 'open' }
        ]
      });
      const res = evaluateDeadlineRisks(ctx, { currentDate: TEST_DATE });
      const item = res.items.find(i => i.taskId === 't-safe');
      expect(item).toBeDefined();
      expect(item.urgency).toBe('safe');
      expect(item.deadlineRisk).toBe(false);
    });
  });

  describe('4. Fix My Day Engine', () => {
    test('analyzeDay calculates health score and summarizes issues', () => {
      const ctx = createMockContext({
        fixedEvents: [{ id: 'fe1', title: 'Hoc truong', date: TEST_DATE, start: '15:00', end: '17:00', type: 'school' }],
        scheduledTasks: [
          { id: 't1', title: 'Toan', scheduledDate: TEST_DATE, startTime: '16:00', endTime: '17:30', durationMinutes: 90 }
        ]
      });
      const report = analyzeDay(TEST_DATE, ctx);
      expect(report.hardConflicts.length).toBe(1);
      expect(report.score).toBeLessThan(100);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    test('Level 1: shifts conflicting task to free gap on the SAME day', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '21:30' },
        fixedEvents: [{ id: 'fe1', title: 'Hoc co dinh', date: TEST_DATE, start: '15:00', end: '17:00' }],
        scheduledTasks: [
          { id: 't1', title: 'Toan', scheduledDate: TEST_DATE, startTime: '16:00', endTime: '17:30', durationMinutes: 90, priority: 3 }
        ]
      });
      const fix = fixDay(TEST_DATE, ctx, { currentTime: '15:00' });
      expect(fix.changes.length).toBe(1);
      const c = fix.changes[0];
      expect(c.level).toBe(1);
      expect(c.to.date).toBe(TEST_DATE);
      expect(c.to.startTime).toBe('17:15');
      expect(c.what).toBeDefined();
      expect(c.why).toBeDefined();
      expect(c.tradeoff).toBeDefined();
      expect(c.impact).toBeDefined();
      expect(fix.resolvedConflicts).toContain('Toan');
      expect(fix.scoreAfter).toBeGreaterThan(fix.scoreBefore);
    });

    test('Level 2: shifts task to TOMORROW when today has zero capacity left', () => {
      const ctx = createMockContext({
        availability: { start: '18:00', end: '20:00' },
        fixedEvents: [{ id: 'fe1', title: 'Hoc truong', date: TEST_DATE, start: '18:00', end: '20:00' }],
        scheduledTasks: [
          { id: 't1', title: 'Vat ly', scheduledDate: TEST_DATE, startTime: '18:00', endTime: '19:30', durationMinutes: 90, deadline: TEST_TOMORROW }
        ]
      });
      const fix = fixDay(TEST_DATE, ctx);
      expect(fix.changes.length).toBe(1);
      const c = fix.changes[0];
      expect(c.level).toBe(2);
      expect(c.to.date).toBe(TEST_TOMORROW);
      expect(c.impact).toContain('giảm quá tải');
    });

    test('Level 3: splits large task (120m) into multiple sessions when continuous gap is lacking', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '21:00' },
        fixedEvents: [
          { id: 'fe1', title: 'Su kien 1', date: TEST_DATE, start: '16:00', end: '18:00' },
          { id: 'fe2', title: 'Su kien 2', date: TEST_DATE, start: '19:00', end: '21:00' }
        ],
        scheduledTasks: [
          { id: 't-big', title: 'Luyen de Tong hop', scheduledDate: TEST_DATE, startTime: '15:00', endTime: '17:00', durationMinutes: 120, deadline: TEST_DATE }
        ]
      });
      const fix = fixDay(TEST_DATE, ctx);
      expect(fix.changes.length).toBeGreaterThan(0);
      const splitChange = fix.changes.find(c => c.level === 3);
      expect(splitChange).toBeDefined();
      expect(splitChange.what).toContain('Tách');
      expect(splitChange.tradeoff).toContain('chia làm 2');
    });

    test('Level 4: moves low-priority task to tomorrow to rescue imminent-deadline high-priority task', () => {
      const ctx = createMockContext({
        availability: { start: '18:00', end: '20:00' },
        scheduledTasks: [
          { id: 't-low', title: 'Doc truyen', scheduledDate: TEST_DATE, startTime: '18:00', endTime: '20:00', durationMinutes: 120, priority: 1, deadline: null },
          { id: 't-urgent', title: 'Nop bai tap Toan', scheduledDate: TEST_DATE, durationMinutes: 120, priority: 5, deadline: TEST_DATE }
        ]
      });
      const fix = fixDay(TEST_DATE, ctx);
      const bumpChange = fix.changes.find(c => c.taskId === 't-low' && c.level === 4);
      expect(bumpChange).toBeDefined();
      expect(bumpChange.to.date).toBe(TEST_TOMORROW);
      expect(bumpChange.why).toContain('Nop bai tap Toan');
    });

    test('IMMUTABILITY: never moves fixed events, school timetable, or completed tasks', () => {
      const ctx = createMockContext({
        fixedEvents: [{ id: 'fe-locked', title: 'TKB Toan Truong', date: TEST_DATE, start: '15:00', end: '16:30', type: 'school' }],
        scheduledTasks: [
          { id: 't-done', title: 'Da hoc xong', scheduledDate: TEST_DATE, startTime: '15:00', endTime: '16:00', status: 'done' },
          { id: 't-open', title: 'Trung gio', scheduledDate: TEST_DATE, startTime: '15:30', endTime: '17:00', durationMinutes: 90, status: 'open' }
        ]
      });
      const fix = fixDay(TEST_DATE, ctx);
      const movedIds = fix.changes.map(c => c.taskId);
      expect(movedIds).toContain('t-open');
      expect(movedIds).not.toContain('t-done');
      expect(movedIds).not.toContain('fe-locked');
    });

    test('STALE PROTECTION: embeds canonical revision and detects changes', () => {
      const ctx1 = createMockContext({
        scheduledTasks: [{ id: 't1', title: 'Hoc', scheduledDate: TEST_DATE, startTime: '15:00', endTime: '16:00', durationMinutes: 60 }]
      });
      const fix = fixDay(TEST_DATE, ctx1);
      expect(fix.planningContextRevision).toBeDefined();
      const ctx2 = {
        ...ctx1,
        scheduledTasks: [{ id: 't1', title: 'Hoc', scheduledDate: TEST_DATE, startTime: '17:00', endTime: '18:00', durationMinutes: 60 }]
      };
      const freshRev = computePlanningContextRevision(ctx2);
      expect(fix.planningContextRevision).not.toBe(freshRev);
    });
  });
});
