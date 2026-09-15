'use strict';

const PatternDetector = require('../src/execution/pattern-detector');

function createSampleTask(overrides = {}) {
  return {
    id: 'task-' + Math.random().toString(36).slice(2, 7),
    title: 'Ôn bài',
    subjectId: 'math',
    scheduledDate: '2026-09-15',
    startTime: '19:00',
    endTime: '20:00',
    durationMinutes: 60,
    actualStart: '19:00',
    actualEnd: '20:00',
    actualDuration: 60,
    status: 'completed',
    ...overrides
  };
}

describe('P1.4 Pattern Detector - PatternDetector', () => {
  describe('1. Sample Size Protection (N >= 3)', () => {
    test('does NOT detect patterns if sample size is below threshold (N < 3)', () => {
      const insufficientTasks = [
        createSampleTask({ actualStart: '19:25', durationMinutes: 60, actualDuration: 85 }),
        createSampleTask({ actualStart: '19:30', durationMinutes: 60, actualDuration: 90 })
      ];

      const patterns = PatternDetector.detectPatterns(insufficientTasks);
      expect(patterns).toEqual([]);
    });
  });

  describe('2. Pattern Detection with Evidence and Confidence', () => {
    test('detects late_start_pattern when N >= 3 tasks start significantly late', () => {
      const lateTasks = [
        createSampleTask({ startTime: '19:00', actualStart: '19:20' }), // 20m late
        createSampleTask({ startTime: '19:00', actualStart: '19:25' }), // 25m late
        createSampleTask({ startTime: '19:00', actualStart: '19:15' })  // 15m late
      ];

      const patterns = PatternDetector.detectPatterns(lateTasks);
      const latePattern = patterns.find(p => p.type === 'late_start_pattern');
      expect(latePattern).toBeDefined();
      expect(latePattern.sampleSize).toBe(3);
      expect(latePattern.confidence).toBeGreaterThanOrEqual(0.7);
      expect(latePattern.evidence).toBeDefined();
      expect(latePattern.evidence.averageDelayMinutes).toBeGreaterThanOrEqual(15);
    });

    test('detects duration_underestimate_pattern when N >= 3 tasks overrun estimated duration', () => {
      const overrunTasks = [
        createSampleTask({ subjectId: 'physics', durationMinutes: 45, actualDuration: 65 }), // +20m
        createSampleTask({ subjectId: 'physics', durationMinutes: 50, actualDuration: 75 }), // +25m
        createSampleTask({ subjectId: 'physics', durationMinutes: 60, actualDuration: 90 })  // +30m
      ];

      const patterns = PatternDetector.detectPatterns(overrunTasks);
      const underPattern = patterns.find(p => p.type === 'duration_underestimate_pattern' && p.subjectId === 'physics');
      expect(underPattern).toBeDefined();
      expect(underPattern.sampleSize).toBe(3);
      expect(underPattern.confidence).toBeGreaterThanOrEqual(0.7);
      expect(underPattern.evidence.averageDurationMultiplier).toBeGreaterThan(1.2);
    });

    test('detects underperforming_time_block_pattern when N >= 3 in same window fail/skip', () => {
      const eveningTasks = [
        createSampleTask({ startTime: '21:00', endTime: '22:00', status: 'skipped' }),
        createSampleTask({ startTime: '21:15', endTime: '22:00', status: 'skipped' }),
        createSampleTask({ startTime: '21:30', endTime: '22:30', status: 'planned' }) // uncompleted late
      ];

      const patterns = PatternDetector.detectPatterns(eveningTasks);
      const blockPattern = patterns.find(p => p.type === 'underperforming_time_block_pattern');
      expect(blockPattern).toBeDefined();
      expect(blockPattern.timeBlock).toBe('21:00–23:00');
      expect(blockPattern.evidence.completionRate).toBe(0);
    });
  });
});
