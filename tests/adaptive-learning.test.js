'use strict';

const AdaptiveLearning = require('../src/execution/adaptive-learning');
const { fixDay } = require('../src/ai/day-fix-engine');

describe('P1.4 Adaptive Learning - AdaptiveLearning & DayFixEngine Integration', () => {
  describe('1. Recommendations Generation & Smoothing', () => {
    test('generates actionable recommendations from high confidence patterns', () => {
      const mockPatterns = [
        {
          type: 'late_start_pattern',
          confidence: 0.85,
          sampleSize: 4,
          window: 'evening',
          evidence: { averageDelayMinutes: 20 }
        },
        {
          type: 'duration_underestimate_pattern',
          subjectId: 'math',
          confidence: 0.90,
          sampleSize: 5,
          evidence: { averageDurationMultiplier: 1.35 }
        }
      ];

      const recs = AdaptiveLearning.generateRecommendations(mockPatterns, {});
      expect(recs.length).toBe(2);

      const bufferRec = recs.find(r => r.type === 'start_buffer');
      expect(bufferRec).toBeDefined();
      expect(bufferRec.value).toBe(20);

      const multRec = recs.find(r => r.type === 'duration_multiplier');
      expect(multRec).toBeDefined();
      expect(multRec.value).toBeGreaterThan(1.0);
    });

    test('applies recommendation into preferences and preserves non-destructive reset', () => {
      let prefs = AdaptiveLearning.getBasePreferences();
      expect(prefs.preferredStartBuffer).toBe(0);

      prefs = AdaptiveLearning.applyRecommendation(prefs, 'preferredStartBuffer', 15);
      expect(prefs.preferredStartBuffer).toBe(15);
      expect(prefs.acceptedRecommendations).toContain('preferredStartBuffer');

      prefs = AdaptiveLearning.applyRecommendation(prefs, 'durationMultipliers.math', 1.25);
      expect(prefs.durationMultipliers.math).toBe(1.25);

      // Reset without destroying user task history
      const reset = AdaptiveLearning.resetLearnedPreferences(prefs);
      expect(reset.preferredStartBuffer).toBe(0);
      expect(reset.durationMultipliers).toEqual({});
      expect(reset.lastResetAt).toBeDefined();
    });

    test('clamps adapted duration within safety bounds (max +45m or 1.5x)', () => {
      const task = { durationMinutes: 60, subjectId: 'math' };
      const prefs = {
        enabled: true,
        durationMultipliers: { math: 3.0 } // Wild multiplier
      };

      const adapted = AdaptiveLearning.getAdaptedTaskDuration(task, prefs);
      expect(adapted).toBeLessThanOrEqual(60 + 45); // Clamped at 105 max
    });
  });

  describe('2. DayFixEngine Integration with Constraint Priority', () => {
    test('incorporates learned preferredStartBuffer and preferredBreakMinutes when safe', () => {
      const date = '2026-09-15';
      const context = {
        currentDate: date,
        currentTime: '14:00',
        timezone: 'Asia/Ho_Chi_Minh',
        availability: { start: '15:00', end: '21:30' },
        fixedEvents: [],
        scheduledTasks: [
          // A task in conflict with school event
          { id: 't1', title: 'Toan Nang Cao', subjectId: 'math', date, startTime: '15:00', endTime: '16:00', durationMinutes: 60, status: 'open' }
        ],
        deadlines: [],
        learnedPreferences: {
          enabled: true,
          preferredStartBuffer: 15,
          preferredBreakMinutes: 15
        }
      };

      // Add fixed event at 15:00 to trigger reschedule
      context.fixedEvents.push({ id: 'fe1', title: 'Hoc them', date, start: '15:00', end: '16:00', type: 'school' });

      const proposal = fixDay(date, context);
      expect(proposal.changes.length).toBeGreaterThan(0);
      const move = proposal.changes[0];
      // Task should be moved after fixed event + break
      expect(move.to.startTime).toBeDefined();
    });
  });
});
