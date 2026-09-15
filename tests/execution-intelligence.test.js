'use strict';

const ExecutionTracker = require('../src/execution/execution-tracker');

const TEST_DATE = '2026-09-15';

function createMockTask(overrides = {}) {
  return {
    id: 't-test',
    title: 'Ôn tập Toán',
    subjectId: 'math',
    scheduledDate: TEST_DATE,
    startTime: '19:00',
    endTime: '20:00',
    durationMinutes: 60,
    status: 'planned',
    priority: 4,
    ...overrides
  };
}

describe('P1.4 Execution Intelligence - ExecutionTracker', () => {
  describe('1. Execution States & Backward Compatibility', () => {
    test('standardizes legacy "open" status to "planned"', () => {
      const task = createMockTask({ status: 'open' });
      const state = ExecutionTracker.getStandardExecutionState(task);
      expect(state).toBe(ExecutionTracker.EXECUTION_STATES.PLANNED);
    });

    test('standardizes legacy "done" status to "completed"', () => {
      const task = createMockTask({ status: 'done' });
      const state = ExecutionTracker.getStandardExecutionState(task);
      expect(state).toBe(ExecutionTracker.EXECUTION_STATES.COMPLETED);
    });

    test('supports in_progress, skipped, and postponed states', () => {
      expect(ExecutionTracker.getStandardExecutionState(createMockTask({ status: 'in_progress' }))).toBe('in_progress');
      expect(ExecutionTracker.getStandardExecutionState(createMockTask({ status: 'skipped' }))).toBe('skipped');
      expect(ExecutionTracker.getStandardExecutionState(createMockTask({ status: 'postponed' }))).toBe('postponed');
    });

    test('detects overdue state if scheduled time has passed and task is uncompleted', () => {
      const pastTask = createMockTask({
        scheduledDate: '2026-09-14',
        startTime: '10:00',
        endTime: '11:00',
        status: 'planned'
      });
      const state = ExecutionTracker.getStandardExecutionState(pastTask, {
        currentDate: TEST_DATE,
        currentTime: '15:00'
      });
      expect(state).toBe(ExecutionTracker.EXECUTION_STATES.OVERDUE);
    });
  });

  describe('2. Plan vs Actual Metrics Computation', () => {
    test('computes startDelay, durationVariance, and scheduleVariance accurately', () => {
      const task = createMockTask({
        startTime: '19:00',
        endTime: '20:00',
        durationMinutes: 60,
        actualStart: '19:15',
        actualEnd: '20:30',
        actualDuration: 75,
        status: 'completed'
      });

      const metrics = ExecutionTracker.computeTaskExecutionMetrics(task);
      expect(metrics.plannedDuration).toBe(60);
      expect(metrics.actualDuration).toBe(75);
      expect(metrics.startDelay).toBe(15);
      expect(metrics.durationVariance).toBe(15);
      expect(metrics.scheduleVariance).toBe(30);
      expect(metrics.isOnTime).toBe(false);
    });

    test('marks task as on time when delay and variance are within tolerance (<= 5 min)', () => {
      const task = createMockTask({
        startTime: '19:00',
        endTime: '20:00',
        durationMinutes: 60,
        actualStart: '19:03',
        actualEnd: '20:02',
        actualDuration: 59,
        status: 'completed'
      });

      const metrics = ExecutionTracker.computeTaskExecutionMetrics(task);
      expect(metrics.startDelay).toBe(3);
      expect(metrics.isOnTime).toBe(true);
    });
  });

  describe('3. Execution Aggregation: analyzeExecution', () => {
    test('calculates completionRate, adherenceRate, and averages across a period', () => {
      const tasks = [
        createMockTask({
          id: 't1',
          startTime: '18:00',
          endTime: '19:00',
          durationMinutes: 60,
          actualStart: '18:00',
          actualEnd: '19:00',
          actualDuration: 60,
          status: 'completed'
        }),
        createMockTask({
          id: 't2',
          startTime: '19:15',
          endTime: '20:15',
          durationMinutes: 60,
          actualStart: '19:30',
          actualEnd: '20:45',
          actualDuration: 75,
          status: 'completed'
        }),
        createMockTask({
          id: 't3',
          startTime: '20:30',
          endTime: '21:30',
          durationMinutes: 60,
          status: 'skipped'
        })
      ];

      const report = ExecutionTracker.analyzeExecution(
        { startDate: TEST_DATE, endDate: TEST_DATE },
        { scheduledTasks: tasks, currentDate: TEST_DATE, currentTime: '22:00' }
      );

      expect(report.summary.totalTasks).toBe(3);
      expect(report.summary.completedTasks).toBe(2);
      expect(report.summary.skippedTasks).toBe(1);
      expect(report.metrics.completionRate).toBe(67);
      expect(report.metrics.adherenceRate).toBe(50);
      expect(report.metrics.avgDelayMinutes).toBe(8);
      expect(report.metrics.avgDurationVarianceMinutes).toBe(8);
    });

    test('strictly labels root causes as DATA (facts) vs INFERENCE (deductions)', () => {
      const tasks = [
        createMockTask({
          id: 't1',
          startTime: '19:00',
          endTime: '20:00',
          durationMinutes: 60,
          actualStart: '19:30',
          actualDuration: 60,
          status: 'completed'
        }),
        createMockTask({
          id: 't2',
          startTime: '20:15',
          endTime: '21:15',
          durationMinutes: 60,
          actualDuration: 90,
          status: 'completed'
        }),
        createMockTask({
          id: 't3',
          startTime: '21:30',
          endTime: '22:30',
          durationMinutes: 60,
          status: 'skipped'
        })
      ];

      const report = ExecutionTracker.analyzeExecution(
        { startDate: TEST_DATE, endDate: TEST_DATE },
        { scheduledTasks: tasks, currentDate: TEST_DATE, currentTime: '23:00' }
      );

      expect(Array.isArray(report.rootCauses)).toBe(true);
      expect(report.rootCauses.length).toBeGreaterThan(0);

      report.rootCauses.forEach(cause => {
        expect(['data', 'inference']).toContain(cause.type);
        expect(typeof cause.title).toBe('string');
        expect(typeof cause.description).toBe('string');
      });

      const dataFact = report.rootCauses.find(c => c.type === 'data');
      expect(dataFact).toBeDefined();

      const inference = report.rootCauses.find(c => c.type === 'inference');
      expect(inference).toBeDefined();
    });

    test('never invents completion data: unexecuted past tasks remain open or overdue', () => {
      const pastTask = createMockTask({
        id: 't-past',
        scheduledDate: '2026-09-14',
        startTime: '10:00',
        endTime: '11:00',
        status: 'open'
      });

      const report = ExecutionTracker.analyzeExecution(
        { startDate: '2026-09-14', endDate: '2026-09-14' },
        { scheduledTasks: [pastTask], currentDate: TEST_DATE, currentTime: '15:00' }
      );

      expect(report.summary.completedTasks).toBe(0);
      expect(report.summary.overdueTasks).toBe(1);
      expect(report.metrics.completionRate).toBe(0);
    });
  });
});
