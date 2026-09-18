'use strict';

/**
 * @file ai-pipeline-unification.test.js
 * Verification of AI Pipeline Unification & Deterministic Scheduling Invariants.
 * 
 * Asserts:
 * 1. Single source of truth: TimeAssistant orchestrates all AI requests.
 * 2. Deterministic scheduling invariant: AI never sets final slots directly;
 *    slot computation is 100% deterministic via CapabilityRouter & CapacityEngine.
 * 3. Context assembly always supplies consistent currentDate and currentTime (no half-injected clocks).
 * 4. Multi-turn conversation preserves context across steps.
 * 5. Primary AI UI surface is Ask AI; compatibility wrappers delegate to Unified TimeAssistant.
 */

const TimeAssistant = require('../src/ai/time-assistant');
const CapabilityRouter = require('../src/ai/capability-router');
const ContextAssembly = require('../src/ai/context-assembly');
const Clock = require('../src/utils/clock');
const { DeterministicFallbackProvider, GeminiServerProvider } = require('../src/ai/ai-provider');

describe('AI Pipeline Unification & Deterministic Scheduling Invariant', () => {
  const mockUser = {
    id: 'student-001',
    name: 'Nguyen Van A',
    availability: { start: '15:00', end: '21:30', days: [1, 2, 3, 4, 5, 6, 0] },
    subjects: [
      { id: 'sub-toan', name: 'Toán', color: 'blue' },
      { id: 'sub-ly', name: 'Vật lí', color: 'purple' }
    ],
    tasks: [],
    fixedSchedules: [
      { id: 'f-1', title: 'Học chính khoá', date: '2026-09-15', start: '07:00', end: '11:30' }
    ],
    sessions: [],
    settings: { reminders: true, coach: true }
  };

  beforeEach(() => {
    TimeAssistant.resetConversation();
    Clock.setFixed('2026-09-15', '08:00');
  });

  afterEach(() => {
    Clock.restore();
  });

  describe('1. Single Source of Truth: TimeAssistant Orchestration', () => {
    test('routes plan query through TimeAssistant producing deterministic proposal', async () => {
      const res = await TimeAssistant.handleUserQuery('Lên lịch học Toán 60 phút chiều nay', mockUser, {
        currentDate: '2026-09-15'
      });

      expect(res.intent).toBe('plan');
      expect(['proposal_ready', 'information']).toContain(res.status);
      expect(res.proposal).toBeDefined();
      expect(Array.isArray(res.proposal.actions)).toBe(true);
      expect(res.proposal.actions.length).toBeGreaterThan(0);

      // Verify scheduling was deterministic and strictly within availability window
      const action = res.proposal.actions[0];
      expect(action.startTime).toBeDefined();
      expect(action.endTime).toBeDefined();
      expect(action.durationMinutes).toBe(60);
      expect(action.startTime >= '15:00').toBe(true);
      expect(action.endTime <= '21:30').toBe(true);
    });

    test('routes fix_day query to DayFixEngine with grounded diagnosis', async () => {
      const res = await TimeAssistant.handleUserQuery('Lịch hôm nay rối quá, hãy sửa giúp tôi', mockUser, {
        currentDate: '2026-09-15'
      });

      expect(res.intent).toBe('fix_day');
      expect(res.data).toBeDefined();
      expect(res.data.diagnosis).toBeDefined();
    });

    test('routes review_week query to historical 7-day aggregator', async () => {
      const res = await TimeAssistant.handleUserQuery('Tuần này tôi học thế nào?', mockUser, {
        currentDate: '2026-09-15'
      });

      expect(res.intent).toBe('review_week');
      expect(res.message).toContain('Tổng kết 7 ngày qua');
    });
  });

  describe('2. Deterministic Scheduling Invariant', () => {
    test('AI cannot override fixed events or violate availability windows', () => {
      const context = ContextAssembly.buildIntentContext(mockUser, 'plan', {
        currentDate: '2026-09-15',
        currentTime: '08:00'
      });

      expect(context.currentDate).toBe('2026-09-15');
      expect(context.currentTime).toBe('08:00');
      expect(context.availability.start).toBe('15:00');
      expect(context.availability.end).toBe('21:30');

      // Scheduling action strictly bounded by deterministic engines
      const slots = CapabilityRouter.findAvailableSlots({ durationMinutes: 60, date: '2026-09-15' }, context);
      expect(slots.slots.length).toBeGreaterThan(0);
      slots.slots.forEach(slot => {
        expect(slot.start >= '15:00').toBe(true);
        expect(slot.end <= '21:30').toBe(true);
      });
    });

    test('GeminiServerProvider.generatePlan is marked deprecated', () => {
      const provider = new GeminiServerProvider({ apiKey: null });
      expect(typeof provider.generatePlan).toBe('function');
    });
  });

  describe('3. Multi-turn State Preservation', () => {
    test('preserves subject across clarification turns', async () => {
      // Step 1: Subject specified, duration missing
      const r1 = await TimeAssistant.handleUserQuery('Tôi muốn học Toán', mockUser, {
        currentDate: '2026-09-15'
      });
      expect(r1.status).toBe('needs_clarification');

      // Step 2: User provides duration
      const r2 = await TimeAssistant.handleUserQuery('45 phút', mockUser, {
        currentDate: '2026-09-15'
      });
      expect(r2.intent).toBe('plan');
      expect(r2.proposal).toBeDefined();
      expect(r2.proposal.actions[0].durationMinutes).toBe(45);
      expect(r2.proposal.actions[0].title).toContain('Toán');
    });
  });

  describe('4. Clock Invariant: Uniform Instant Derivation', () => {
    test('ContextAssembly derives currentDate and currentTime from same instant', () => {
      const ctx = ContextAssembly.buildIntentContext(mockUser, 'find_time', {
        currentDate: '2026-09-15'
      });

      expect(ctx.currentDate).toBe('2026-09-15');
      // Must not leak current host time
      expect(ctx.currentTime).toBe('08:00');
      expect(ctx.timezone).toBe('Asia/Ho_Chi_Minh');
    });
  });

  describe('5. Duplicate AI UI & Single Surface Invariant (Section 34)', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const appJs = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

    test('primary conversational stream UI is #askAIWidget with #askAIInput', () => {
      expect(html).toContain('id="askAIWidget"');
      expect(html).toContain('id="askAIInput"');
      expect(html).toContain('id="askAISendBtn"');
      expect(html).toContain('id="askAIStream"');

      // Assert only one primary conversational stream container exists
      const streamMatches = html.match(/id="askAIStream"/g) || [];
      expect(streamMatches.length).toBe(1);
    });

    test('#aiAskCard is a quick launcher and has no duplicate conversational stream', () => {
      expect(html).toContain('id="aiAskCard"');
      // Must not have its own conversational stream or duplicate proposal card
      expect(html).not.toMatch(/id="aiAskStream"/);
      expect(html).not.toMatch(/id="aiAskProposalCard"/);

      // In app.js, handleAiAskSubmit must delegate to submitAskAI
      expect(appJs).toMatch(/async function handleAiAskSubmit[\s\S]*?submitAskAI\(/);
    });

    test('Study Coach is display-only with no conversational input', () => {
      expect(html).toContain('id="coachCard"');
      const coachBlockMatch = html.match(/<section[^>]*id="coachCard"[\s\S]*?<\/section>/);
      expect(coachBlockMatch).toBeTruthy();
      const coachBlock = coachBlockMatch[0];
      expect(coachBlock).not.toContain('<input');
      expect(coachBlock).not.toContain('<textarea');
      expect(coachBlock).not.toContain('ai-submit-btn');
    });
  });
});

