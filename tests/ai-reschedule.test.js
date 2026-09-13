/**
 * @file ai-reschedule.test.js
 * Comprehensive unit test suite for P1.3:
 * Smart Reschedule + Conflict Intelligence + Deadline Intelligence ("Fix My Day").
 */

const { detectConflicts } = require('../src/ai/conflict-intelligence');
const { analyzeScheduleDrift } = require('../src/ai/schedule-drift');
const { evaluateDeadlineRisks } = require('../src/ai/deadline-intelligence');
const { generateReschedulePlan } = require('../src/ai/reschedule-engine');
const {
  canonicalizePlanningContext,
  computePlanningContextRevision,
  buildPlanningContext
} = require('../src/ai/planner-context');
const { evaluatePlanQuality, evaluateRescheduleComparison } = require('../src/ai/plan-evaluator');
const { validatePlanningProposal } = require('../src/ai/planning-proposal');
const AppDate = require('../src/utils/date');

// Injected test clock (never hardcoded in production)
const TEST_DATE = '2026-09-14';
const TEST_DATE_TOMORROW = '2026-09-15';
const TEST_TIME_AFTERNOON = '15:20';

function createMockContext(overrides = {}) {
  return {
    currentDate: TEST_DATE,
    currentTime: TEST_TIME_AFTERNOON,
    timezone: 'Asia/Ho_Chi_Minh',
    availability: { start: '15:00', end: '21:30', days: [1, 2, 3, 4, 5, 6, 0] },
    fixedEvents: [],
    scheduledTasks: [],
    inboxItems: [],
    deadlines: [],
    completedWork: { completedSessionsCount: 0, completedMinutesTotal: 0 },
    userPreferences: { reminders: true, coach: true },
    horizonDays: 3,
    ...overrides
  };
}

describe('P1.3 — Smart Reschedule + Conflict Intelligence + Deadline Intelligence', () => {

  // ─────────────────────────────────────────────────────────────
  // 1. CONTEXT CANONICALIZATION & REVISION FINGERPRINT
  // ─────────────────────────────────────────────────────────────
  describe('1. Canonicalization & Revision Fingerprint', () => {
    test('canonicalizePlanningContext normalizes arrays and keys', () => {
      const ctx = createMockContext({
        scheduledTasks: [
          { id: 't2', title: 'Anh', priority: 2, scheduledDate: TEST_DATE, startTime: '17:00' },
          { id: 't1', title: 'Toán', priority: 5, scheduledDate: TEST_DATE, startTime: '15:30' }
        ]
      });
      const canonical = canonicalizePlanningContext(ctx);
      expect(canonical.scheduledTasks[0].id).toBe('t1'); // Sorted by startTime
      expect(canonical.scheduledTasks[1].id).toBe('t2');
    });

    test('reordered arrays produce the exact same revision hash', () => {
      const ctx1 = createMockContext({
        scheduledTasks: [
          { id: 't1', title: 'Toán', durationMinutes: 60, priority: 5, scheduledDate: TEST_DATE, startTime: '15:30' },
          { id: 't2', title: 'Lý', durationMinutes: 45, priority: 4, scheduledDate: TEST_DATE, startTime: '17:00' }
        ],
        fixedEvents: [
          { id: 'fe1', title: 'Học trường', date: TEST_DATE, start: '07:00', end: '11:30' },
          { id: 'fe2', title: 'Ăn tối', date: TEST_DATE, start: '19:00', end: '20:00' }
        ]
      });

      const ctx2 = createMockContext({
        scheduledTasks: [
          { id: 't2', title: 'Lý', durationMinutes: 45, priority: 4, scheduledDate: TEST_DATE, startTime: '17:00' },
          { id: 't1', title: 'Toán', durationMinutes: 60, priority: 5, scheduledDate: TEST_DATE, startTime: '15:30' }
        ],
        fixedEvents: [
          { id: 'fe2', title: 'Ăn tối', date: TEST_DATE, start: '19:00', end: '20:00' },
          { id: 'fe1', title: 'Học trường', date: TEST_DATE, start: '07:00', end: '11:30' }
        ]
      });

      const rev1 = computePlanningContextRevision(ctx1);
      const rev2 = computePlanningContextRevision(ctx2);
      expect(rev1).toBe(rev2);
    });

    test('changing duration alters revision hash', () => {
      const ctx1 = createMockContext({
        scheduledTasks: [{ id: 't1', title: 'Toán', durationMinutes: 60, scheduledDate: TEST_DATE }]
      });
      const ctx2 = createMockContext({
        scheduledTasks: [{ id: 't1', title: 'Toán', durationMinutes: 90, scheduledDate: TEST_DATE }]
      });
      expect(computePlanningContextRevision(ctx1)).not.toBe(computePlanningContextRevision(ctx2));
    });

    test('changing deadline alters revision hash', () => {
      const ctx1 = createMockContext({
        scheduledTasks: [{ id: 't1', title: 'Toán', deadline: '2026-09-15', scheduledDate: TEST_DATE }]
      });
      const ctx2 = createMockContext({
        scheduledTasks: [{ id: 't1', title: 'Toán', deadline: '2026-09-18', scheduledDate: TEST_DATE }]
      });
      expect(computePlanningContextRevision(ctx1)).not.toBe(computePlanningContextRevision(ctx2));
    });

    test('changing fixed event alters revision hash', () => {
      const ctx1 = createMockContext({
        fixedEvents: [{ id: 'fe1', title: 'Bóng đá', date: TEST_DATE, start: '17:00', end: '18:00' }]
      });
      const ctx2 = createMockContext({
        fixedEvents: [{ id: 'fe1', title: 'Bóng đá', date: TEST_DATE, start: '17:30', end: '18:30' }]
      });
      expect(computePlanningContextRevision(ctx1)).not.toBe(computePlanningContextRevision(ctx2));
    });

    test('changing availability alters revision hash', () => {
      const ctx1 = createMockContext({ availability: { start: '15:00', end: '21:30', days: [1, 2, 3] } });
      const ctx2 = createMockContext({ availability: { start: '16:00', end: '21:30', days: [1, 2, 3] } });
      expect(computePlanningContextRevision(ctx1)).not.toBe(computePlanningContextRevision(ctx2));
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. CONFLICT INTELLIGENCE
  // ─────────────────────────────────────────────────────────────
  describe('2. Conflict Intelligence Engine', () => {
    test('detects HARD conflict: task overlaps fixed event', () => {
      const ctx = createMockContext({
        fixedEvents: [{ id: 'fe1', title: 'Lớp Anh cố định', date: TEST_DATE, start: '16:00', end: '17:30' }]
      });
      const tasks = [
        { id: 't1', title: 'Học Toán', scheduledDate: TEST_DATE, startTime: '16:30', endTime: '18:00', durationMinutes: 90 }
      ];
      const result = detectConflicts(tasks, ctx);
      expect(result.hasHardConflicts).toBe(true);
      const overlap = result.hardConflicts.find(c => c.type === 'FIXED_EVENT_OVERLAP');
      expect(overlap).toBeDefined();
      expect(overlap.severity).toBe('critical');
      expect(overlap.message).toContain('Lớp Anh cố định');
    });

    test('detects HARD conflict: availability violation', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '21:00' }
      });
      const tasks = [
        { id: 't1', title: 'Học Đêm', scheduledDate: TEST_DATE, startTime: '21:30', endTime: '22:30', durationMinutes: 60 }
      ];
      const result = detectConflicts(tasks, ctx);
      expect(result.hasHardConflicts).toBe(true);
      const availConf = result.hardConflicts.find(c => c.type === 'AVAILABILITY_VIOLATION');
      expect(availConf).toBeDefined();
      expect(availConf.severity).toBe('high');
    });

    test('detects HARD conflict: internal task collision on same day', () => {
      const ctx = createMockContext();
      const tasks = [
        { id: 't1', title: 'Học Toán', scheduledDate: TEST_DATE, startTime: '15:30', endTime: '17:00', durationMinutes: 90 },
        { id: 't2', title: 'Học Lý', scheduledDate: TEST_DATE, startTime: '16:30', endTime: '17:30', durationMinutes: 60 }
      ];
      const result = detectConflicts(tasks, ctx);
      expect(result.hasHardConflicts).toBe(true);
      const internalConf = result.hardConflicts.find(c => c.type === 'INTERNAL_OVERLAP');
      expect(internalConf).toBeDefined();
      expect(internalConf.affectedActionIds).toContain('t1');
      expect(internalConf.affectedActionIds).toContain('t2');
    });

    test('detects SOFT conflict: insufficient break (< 10 minutes)', () => {
      const ctx = createMockContext();
      const tasks = [
        { id: 't1', title: 'Học Toán', scheduledDate: TEST_DATE, startTime: '15:00', endTime: '16:00', durationMinutes: 60 },
        { id: 't2', title: 'Học Lý', scheduledDate: TEST_DATE, startTime: '16:02', endTime: '17:00', durationMinutes: 58 }
      ];
      const result = detectConflicts(tasks, ctx);
      const breakConf = result.softConflicts.find(c => c.type === 'INSUFFICIENT_BREAK');
      expect(breakConf).toBeDefined();
      expect(breakConf.severity).toBe('medium');
    });

    test('detects SOFT conflict: overloaded day (> 5 hours study)', () => {
      const ctx = createMockContext({ availability: { start: '08:00', end: '22:00' } });
      const tasks = [
        { id: 't1', title: 'Toán', scheduledDate: TEST_DATE, startTime: '08:00', endTime: '12:00', durationMinutes: 240 },
        { id: 't2', title: 'Lý', scheduledDate: TEST_DATE, startTime: '14:00', endTime: '18:00', durationMinutes: 240 }
      ];
      const result = detectConflicts(tasks, ctx);
      const overloadConf = result.softConflicts.find(c => c.type === 'OVERLOADED_DAY');
      expect(overloadConf).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. SCHEDULE DRIFT ANALYSIS
  // ─────────────────────────────────────────────────────────────
  describe('3. Schedule Drift Analysis Engine', () => {
    test('identifies late task whose start time has elapsed today', () => {
      const ctx = createMockContext({
        scheduledTasks: [
          { id: 't1', title: 'Học Toán', scheduledDate: TEST_DATE, startTime: '10:00', durationMinutes: 90, status: 'open' }
        ]
      });
      // Current time is 15:20
      const drift = analyzeScheduleDrift(ctx, { currentDate: TEST_DATE, currentTime: TEST_TIME_AFTERNOON });
      expect(drift.hasDrift).toBe(true);
      expect(drift.lateTasks.length).toBe(1);
      expect(drift.lateTasks[0].title).toBe('Học Toán');
      expect(drift.lateTasks[0].minutesLate).toBe(320); // 15:20 (920m) - 10:00 (600m) = 320m
    });

    test('preserves completed tasks without flagging them as late', () => {
      const ctx = createMockContext({
        scheduledTasks: [
          { id: 't1', title: 'Học Sáng', scheduledDate: TEST_DATE, startTime: '09:00', durationMinutes: 60, status: 'done' }
        ]
      });
      const drift = analyzeScheduleDrift(ctx, { currentDate: TEST_DATE, currentTime: TEST_TIME_AFTERNOON });
      expect(drift.completedTasks.length).toBe(1);
      expect(drift.lateTasks.length).toBe(0);
      expect(drift.hasDrift).toBe(false);
    });

    test('identifies upcoming task today correctly', () => {
      const ctx = createMockContext({
        scheduledTasks: [
          { id: 't1', title: 'Học Tối', scheduledDate: TEST_DATE, startTime: '19:00', durationMinutes: 60, status: 'open' }
        ]
      });
      const drift = analyzeScheduleDrift(ctx, { currentDate: TEST_DATE, currentTime: TEST_TIME_AFTERNOON });
      expect(drift.upcomingTasks.length).toBe(1);
      expect(drift.lateTasks.length).toBe(0);
    });

    test('calculates remaining free availability from current time', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '21:30' },
        fixedEvents: [
          { id: 'fe1', title: 'Ăn tối', date: TEST_DATE, start: '19:00', end: '20:00' }
        ]
      });
      // Time is 15:20. Total window: 15:20 to 21:30 = 370m. Minus dinner 60m = 310m.
      const drift = analyzeScheduleDrift(ctx, { currentDate: TEST_DATE, currentTime: TEST_TIME_AFTERNOON });
      expect(drift.remainingAvailabilityMinutes).toBe(310);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. DEADLINE INTELLIGENCE
  // ─────────────────────────────────────────────────────────────
  describe('4. Deadline Intelligence Engine', () => {
    test('classifies risk as safe when capacity far exceeds duration', () => {
      const ctx = createMockContext({
        scheduledTasks: [
          { id: 't1', title: 'Ôn Lý', durationMinutes: 60, deadline: TEST_DATE_TOMORROW, status: 'open' }
        ]
      });
      const report = evaluateDeadlineRisks(ctx, { currentDate: TEST_DATE, currentTime: '15:00' });
      expect(report.highestRisk).toBe('safe');
      expect(report.isSafe).toBe(true);
    });

    test('classifies risk as critical / impossible when duration exceeds capacity', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '17:00' }, // Only 2h (120m) capacity today
        scheduledTasks: [
          { id: 't1', title: 'Luyện đề Sử', durationMinutes: 300, deadline: TEST_DATE, status: 'open' } // Needs 5h today!
        ]
      });
      const report = evaluateDeadlineRisks(ctx, { currentDate: TEST_DATE, currentTime: '15:00' });
      expect(report.isSafe).toBe(false);
      expect(['critical', 'impossible', 'at_risk']).toContain(report.highestRisk);
      expect(report.items[0].explanation).toMatch(/giờ|phút/);
    });

    test('provides human-readable Vietnamese explanation with exact durations', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '18:00' },
        scheduledTasks: [
          { id: 't1', title: 'Luyện đề Sử', durationMinutes: 180, deadline: TEST_DATE, status: 'open' }
        ]
      });
      const report = evaluateDeadlineRisks(ctx, { currentDate: TEST_DATE, currentTime: '17:30' }); // Only 30m left
      expect(report.items[0].explanation).toContain('Cần');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. SMART RESCHEDULE ENGINE ("FIX MY DAY")
  // ─────────────────────────────────────────────────────────────
  describe('5. Smart Reschedule Engine', () => {
    test('reschedules late task to earliest available free slot today', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '21:30' },
        scheduledTasks: [
          { id: 't1', title: 'Học Toán', scheduledDate: TEST_DATE, startTime: '10:00', durationMinutes: 60, status: 'open' }
        ]
      });
      // Time is 15:20
      const proposal = generateReschedulePlan(ctx, { currentDate: TEST_DATE, currentTime: TEST_TIME_AFTERNOON });
      expect(proposal.actions.length).toBe(1);
      const action = proposal.actions[0];
      expect(action.type).toBe('move_task');
      expect(action.title).toBe('Học Toán');
      expect(action.date).toBe(TEST_DATE);
      // Earliest available start time after 15:20 is 15:30 (snapped to 15m)
      expect(action.startTime).toBe('15:30');
      expect(action.endTime).toBe('16:30');
      expect(action.previousStartTime).toBe('10:00');
    });

    test('preserves immutable fixed events without moving them', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '21:30' },
        fixedEvents: [
          { id: 'fe1', title: 'Lớp cố định', date: TEST_DATE, start: '16:00', end: '17:30' }
        ],
        scheduledTasks: [
          { id: 't1', title: 'Học Toán', scheduledDate: TEST_DATE, startTime: '10:00', durationMinutes: 60, status: 'open' }
        ]
      });
      // Time is 15:20. Task takes 60m. Gaps: 15:30-16:00 (only 30m, too small). Next gap: after 17:30 + 10m buffer = 17:45.
      const proposal = generateReschedulePlan(ctx, { currentDate: TEST_DATE, currentTime: TEST_TIME_AFTERNOON });
      const action = proposal.actions.find(a => a.title === 'Học Toán');
      expect(action).toBeDefined();
      expect(action.startTime).toBe('17:45');
      // Zero actions should modify the fixed event
      const feAction = proposal.actions.find(a => a.title === 'Lớp cố định');
      expect(feAction).toBeUndefined();
    });

    test('preserves completed tasks untouched', () => {
      const ctx = createMockContext({
        scheduledTasks: [
          { id: 't1', title: 'Học Sáng', scheduledDate: TEST_DATE, startTime: '09:00', durationMinutes: 60, status: 'done' },
          { id: 't2', title: 'Học Chiều', scheduledDate: TEST_DATE, startTime: '13:00', durationMinutes: 60, status: 'open' }
        ]
      });
      const proposal = generateReschedulePlan(ctx, { currentDate: TEST_DATE, currentTime: TEST_TIME_AFTERNOON });
      const doneAction = proposal.actions.find(a => a.id.includes('t1'));
      expect(doneAction).toBeUndefined();
    });

    test('prioritizes task with urgent deadline over distant task', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '21:30' },
        scheduledTasks: [
          { id: 't_distant', title: 'Bài tập tuần sau', priority: 4, deadline: '2026-09-30', scheduledDate: TEST_DATE, startTime: '10:00', durationMinutes: 60, status: 'open' },
          { id: 't_urgent', title: 'Luyện thi ngày mai', priority: 3, deadline: TEST_DATE_TOMORROW, scheduledDate: TEST_DATE, startTime: '11:00', durationMinutes: 60, status: 'open' }
        ]
      });
      const proposal = generateReschedulePlan(ctx, { currentDate: TEST_DATE, currentTime: TEST_TIME_AFTERNOON });
      // Urgent task should be placed earlier in the actions
      const urgentAct = proposal.actions.find(a => a.title === 'Luyện thi ngày mai');
      const distantAct = proposal.actions.find(a => a.title === 'Bài tập tuần sau');
      expect(urgentAct).toBeDefined();
      expect(distantAct).toBeDefined();
      expect(urgentAct.startTime < distantAct.startTime).toBe(true);
    });

    test('spills remaining workload over to tomorrow when today is full (multi-day spillover)', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '17:30' }, // Only 2h 10m left today after 15:20
        scheduledTasks: [
          { id: 't1', title: 'Task 1', scheduledDate: TEST_DATE, startTime: '09:00', durationMinutes: 90, status: 'open' },
          { id: 't2', title: 'Task 2', scheduledDate: TEST_DATE, startTime: '10:30', durationMinutes: 90, status: 'open' }
        ]
      });
      // 180 min total work cannot fit into ~130 min remaining today.
      const proposal = generateReschedulePlan(ctx, { currentDate: TEST_DATE, currentTime: TEST_TIME_AFTERNOON });
      expect(proposal.actions.length).toBe(2);
      const dates = proposal.actions.map(a => a.date);
      expect(dates).toContain(TEST_DATE);
      expect(dates).toContain(TEST_DATE_TOMORROW);
    });

    test('measures changeCost (minimum necessary changes)', () => {
      const ctx = createMockContext({
        availability: { start: '15:00', end: '21:30' },
        scheduledTasks: [
          { id: 't1', title: 'Task Late', scheduledDate: TEST_DATE, startTime: '10:00', durationMinutes: 45, status: 'open' },
          { id: 't2', title: 'Task Future OK', scheduledDate: TEST_DATE, startTime: '20:00', durationMinutes: 45, status: 'open' }
        ]
      });
      // Only t1 is late; t2 is well in the future and does not collide.
      const proposal = generateReschedulePlan(ctx, { currentDate: TEST_DATE, currentTime: TEST_TIME_AFTERNOON });
      // Should only move 1 task (t1)
      expect(proposal.changeCost).toBe(1);
      expect(proposal.actions[0].title).toBe('Task Late');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. PLAN EVALUATOR RESCHEDULE COMPARISON
  // ─────────────────────────────────────────────────────────────
  describe('6. Plan Evaluator: Reschedule Comparison', () => {
    test('computes beforeScore and afterScore comparison', () => {
      const ctx = createMockContext();
      const currentTasks = [
        { id: 't1', title: 'Toán', scheduledDate: TEST_DATE, startTime: '10:00', endTime: '11:00', durationMinutes: 60 }
      ];
      const proposal = {
        actions: [
          { id: 'a1', type: 'move_task', title: 'Toán', date: TEST_DATE, startTime: '16:00', endTime: '17:00', durationMinutes: 60 }
        ],
        changeCost: 1
      };
      const comp = evaluateRescheduleComparison(currentTasks, proposal, ctx);
      expect(comp).toHaveProperty('beforeScore');
      expect(comp).toHaveProperty('afterScore');
      expect(comp.changeCost).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. DETERMINISTIC VALIDATION & PROPOSAL SAFETY
  // ─────────────────────────────────────────────────────────────
  describe('7. Deterministic Proposal Validation', () => {
    test('validates that reschedule proposal passes validatePlanningProposal', () => {
      const ctx = createMockContext();
      const proposal = generateReschedulePlan(ctx, { currentDate: TEST_DATE, currentTime: TEST_TIME_AFTERNOON });
      const validation = validatePlanningProposal(proposal, ctx);
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });
  });

});
