'use strict';

const CapabilityRouter = require('../src/ai/capability-router');

describe('P1.5: CapabilityRouter & Deterministic Execution', () => {
  const mockContext = {
    currentDate: '2026-09-15',
    currentTime: '14:00',
    targetDate: '2026-09-15',
    availability: { start: '17:00', end: '22:00', days: [1, 2, 3, 4, 5, 6, 0] },
    fixedEvents: [
      { id: 'f-1', title: 'Học thêm', start: '18:00', end: '19:30' }
    ],
    scheduledTasks: [
      { id: 't-1', title: 'Toán', startTime: '20:00', endTime: '21:00', durationMinutes: 60, status: 'planned' }
    ],
    deadlines: [
      { id: 't-dl', title: 'Bài tập Lý', deadline: '2026-09-17', durationMinutes: 60 }
    ]
  };

  describe('findAvailableSlots', () => {
    test('finds unoccupied slots matching duration', () => {
      const res = CapabilityRouter.findAvailableSlots({ durationMinutes: 60 }, mockContext);
      expect(res.slots.length).toBeGreaterThan(0);
      expect(res.slots.length).toBeLessThanOrEqual(3);

      const firstSlot = res.slots[0];
      expect(firstSlot.durationMinutes).toBe(60);
      expect(firstSlot.available).toBe(true);
      expect(firstSlot.suitabilityScore).toBeGreaterThanOrEqual(0);
      expect(firstSlot.suitabilityScore).toBeLessThanOrEqual(100);
    });

    test('rewards slots matching timePreference', () => {
      const resEvening = CapabilityRouter.findAvailableSlots({ durationMinutes: 30, timePreference: 'evening' }, mockContext);
      const eveningSlot = resEvening.slots.find(s => s.timeOfDay === 'evening');
      if (eveningSlot) {
        expect(eveningSlot.suitabilityScore).toBeGreaterThanOrEqual(80);
      }
    });
  });

  describe('explainSchedule', () => {
    test('produces grounded factual breakdown of daily schedule', () => {
      const expl = CapabilityRouter.explainSchedule(mockContext);
      expect(expl.fixedCount).toBe(1);
      expect(expl.taskCount).toBe(1);
      expect(typeof expl.utilizationPercentage).toBe('number');
      expect(expl.explanationText).toContain('Ngày 2026-09-15 có 1 lịch cố định');
    });
  });

  describe('handleDeadlineHelp', () => {
    test('proposes a scheduled slot prior to the deadline', () => {
      const res = CapabilityRouter.handleDeadlineHelp({
        subject: 'Vật lí',
        deadlineDate: '2026-09-17',
        durationMinutes: 60
      }, mockContext);

      expect(res.status).toBe('proposal_ready');
      expect(res.proposal).toBeDefined();
      expect(res.requiresConfirmation).toBe(true);
      expect(res.message).toContain('hạn: 2026-09-17');
    });
  });

  describe('routeIntent Unified Response Model', () => {
    test('routes find_time correctly', () => {
      const intent = {
        intent: 'find_time',
        entities: { durationMinutes: 45, date: '2026-09-15' }
      };
      const resp = CapabilityRouter.routeIntent(intent, mockContext);
      expect(resp.intent).toBe('find_time');
      expect(resp.status).toBe('information');
      expect(Array.isArray(resp.actions)).toBe(true);
    });

    test('routes explain_schedule correctly', () => {
      const intent = {
        intent: 'explain_schedule',
        entities: { date: '2026-09-15' }
      };
      const resp = CapabilityRouter.routeIntent(intent, mockContext);
      expect(resp.intent).toBe('explain_schedule');
      expect(resp.status).toBe('information');
      expect(resp.data.fixedCount).toBe(1);
    });

    test('routes fix_day through DayFixEngine', () => {
      const intent = {
        intent: 'fix_day',
        entities: { date: '2026-09-15' }
      };
      const resp = CapabilityRouter.routeIntent(intent, mockContext);
      expect(resp.intent).toBe('fix_day');
      expect(['proposal_ready', 'information']).toContain(resp.status);
    });

    test('routes plan intent and returns structured proposal', () => {
      const intent = {
        intent: 'plan',
        entities: { subject: 'Hóa', durationMinutes: 45, date: '2026-09-15' }
      };
      const resp = CapabilityRouter.routeIntent(intent, mockContext);
      expect(resp.intent).toBe('plan');
      if (resp.status === 'proposal_ready') {
        expect(resp.proposal.actions.length).toBe(1);
        expect(resp.requiresConfirmation).toBe(true);
      }
    });

    test('handles unknown/invalid intent safely', () => {
      const resp = CapabilityRouter.routeIntent(null, mockContext);
      expect(resp.status).toBe('error');
      expect(resp.message).toContain('Không xác định');
    });
  });
});
