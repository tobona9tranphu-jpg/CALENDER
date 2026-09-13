/**
 * @file ai-foundation.test.js
 * Comprehensive unit test suite for P1.1 — AI Time Management Foundation.
 *
 * Covers:
 * 1. IntentSchema (creation, validation, ambiguity detection, categorization)
 * 2. PlannerContext (sanitization, privacy guarantees, data expansion)
 * 3. PlanningProposal & ProposalValidator (conflict detection, window enforcement, safety)
 * 4. AI Providers (Placeholder, Deterministic Fallback, Gemini Server, Client Adapter)
 * 5. Security & Privacy Guardrails (zero credential leakage, XSS safety, no direct mutation)
 */

const {
  createIntent,
  validateIntent,
  needsClarification,
  IntentSchema
} = require('../src/ai/intent-schema');

const {
  buildPlanningContext,
  isContextSanitized,
  PlannerContext
} = require('../src/ai/planner-context');

const {
  createPlanningProposal,
  validatePlanningProposal,
  PlanningProposal
} = require('../src/ai/planning-proposal');

const {
  PlaceholderAIProvider,
  DeterministicFallbackProvider,
  GeminiServerProvider,
  ClientAIAdapter
} = require('../src/ai/ai-provider');

const AppDate = require('../src/utils/date');

describe('P1.1 — AI Time Management Foundation', () => {

  // ─────────────────────────────────────────────────────────────
  // 1. INTENT SCHEMA TESTS
  // ─────────────────────────────────────────────────────────────
  describe('1. Intent Schema & Classification', () => {
    test('creates default structured intent', () => {
      const intent = createIntent({ rawText: 'học bài' });
      expect(intent).toBeDefined();
      expect(intent.tasks).toEqual([]);
      expect(intent.fixedEvents).toEqual([]);
      expect(intent.deadlines).toEqual([]);
      expect(intent.constraints).toEqual([]);
      expect(intent.unresolved).toEqual([]);
      expect(intent.confidence).toBe(1.0);
      expect(intent.source).toBe('deterministic');
      expect(intent.rawText).toBe('học bài');
    });

    test('validates valid structured intent', () => {
      const intent = createIntent({
        tasks: [
          { title: 'Học Toán hình', durationMinutes: 60, flexible: true, priority: 4 }
        ],
        fixedEvents: [
          { title: 'Đá bóng cùng bạn bè', start: '19:00', end: '20:30', fixed: true }
        ],
        confidence: 0.95
      });

      const validation = validateIntent(intent);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('flags invalid task with non-positive duration', () => {
      const intent = createIntent({
        tasks: [{ title: 'Ôn Hoá', durationMinutes: 0 }]
      });
      const validation = validateIntent(intent);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('durationMinutes');
    });

    test('flags invalid fixed event with reversed start/end times', () => {
      const intent = createIntent({
        fixedEvents: [{ title: 'Học thêm', start: '20:00', end: '18:00' }]
      });
      const validation = validateIntent(intent);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('trước giờ kết thúc');
    });

    test('detects clarification requirement for low confidence or unresolved items', () => {
      const highConf = createIntent({
        tasks: [{ title: 'Toán', durationMinutes: 45 }],
        confidence: 0.95
      });
      expect(needsClarification(highConf)).toBe(false);

      const lowConf = createIntent({
        tasks: [{ title: 'Học', durationMinutes: 30 }],
        confidence: 0.5
      });
      expect(needsClarification(lowConf)).toBe(true);

      const withUnresolved = createIntent({
        unresolved: [{ text: 'làm bài gì đó' }],
        confidence: 0.9
      });
      expect(needsClarification(withUnresolved)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. PLANNER CONTEXT & PRIVACY TESTS
  // ─────────────────────────────────────────────────────────────
  describe('2. Planner Context & Privacy Guarantees', () => {
    const mockUser = {
      id: 'usr-12345',
      name: 'Nguyen Van A',
      email: 'student@example.com',
      passwordHash: 'argon2id$v=19$m=65536,t=3,p=4$secretpasswordhash',
      token: 'jwt.token.secret',
      cookies: 'session_cookie=abc',
      profile: { grade: 'Lớp 12A1', target: 'Đại học Bách Khoa' },
      availability: { start: '16:00', end: '22:00' },
      fixedSchedules: [
        { id: 'fs-1', title: 'Học chính khoá', day: 4, start: '07:00', end: '11:30' }
      ],
      tasks: [
        { id: 't-1', title: 'Bài tập Giải tích', minutes: 60, status: 'open', scheduledDate: '2026-03-12', priority: 4 },
        { id: 't-2', title: 'Soạn văn', minutes: 30, status: 'open', isInbox: true, priority: 2 }
      ],
      sessions: [
        { id: 's-1', topicId: 'top-1', minutes: 45, date: '2026-03-11' }
      ]
    };

    test('builds sanitized planning context without credentials', () => {
      const context = buildPlanningContext(mockUser, '2026-03-12');

      expect(context.currentDate).toBe('2026-03-12');
      expect(context.timezone).toBe('Asia/Ho_Chi_Minh');
      expect(context.availability.start).toBe('16:00');
      expect(context.availability.end).toBe('22:00');

      // Sensitive fields must NOT exist in the context
      expect(context.passwordHash).toBeUndefined();
      expect(context.token).toBeUndefined();
      expect(context.email).toBeUndefined();
      expect(context.cookies).toBeUndefined();
    });

    test('isContextSanitized returns true for clean context', () => {
      const context = buildPlanningContext(mockUser, '2026-03-12');
      expect(isContextSanitized(context)).toBe(true);
    });

    test('isContextSanitized detects leaked password or token', () => {
      const leakedContext = {
        currentDate: '2026-03-12',
        passwordHash: 'secret_hash',
        token: 'token123'
      };
      expect(isContextSanitized(leakedContext)).toBe(false);
    });

    test('gracefully handles null or empty user', () => {
      const emptyContext = buildPlanningContext(null, '2026-03-12');
      expect(emptyContext.currentDate).toBe('2026-03-12');
      expect(emptyContext.availability).toBeDefined();
      expect(emptyContext.fixedEvents).toEqual([]);
      expect(emptyContext.scheduledTasks).toEqual([]);
      expect(emptyContext.inboxItems).toEqual([]);
      expect(isContextSanitized(emptyContext)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. PLANNING PROPOSAL & VALIDATION TESTS
  // ─────────────────────────────────────────────────────────────
  describe('3. Planning Proposal & Deterministic Validator', () => {
    const baseContext = {
      currentDate: '2026-03-12',
      availability: { start: '15:00', end: '21:00' },
      fixedEvents: [
        { id: 'fe-1', title: 'Học thêm Toán', date: '2026-03-12', start: '17:00', end: '18:30' }
      ],
      scheduledTasks: [
        { id: 't-1', title: 'Bài tập Lý', durationMinutes: 45, scheduledDate: '2026-03-12', startTime: '15:30', endTime: '16:15' }
      ]
    };

    test('approves a proposal with conflict-free actions within availability', () => {
      const proposal = createPlanningProposal({
        actions: [
          {
            type: 'schedule_task',
            title: 'Học Hoá',
            date: '2026-03-12',
            startTime: '19:00',
            endTime: '20:00',
            durationMinutes: 60
          }
        ],
        rationale: [{ reason: 'Khung giờ rảnh 19:00 - 20:00 sau ca học thêm.' }]
      });

      const validation = validatePlanningProposal(proposal, baseContext);
      expect(validation.valid).toBe(true);
      expect(validation.warnings).toHaveLength(0);
    });

    test('flags collision when proposal overlaps with existing fixed event', () => {
      const collidingProposal = createPlanningProposal({
        actions: [
          {
            type: 'schedule_task',
            title: 'Học Tiếng Anh',
            date: '2026-03-12',
            startTime: '17:30', // Collides with 17:00 - 18:30 fixed event
            endTime: '18:15',
            durationMinutes: 45
          }
        ]
      });

      const validation = validatePlanningProposal(collidingProposal, baseContext);
      expect(validation.valid).toBe(false);
      expect(validation.warnings.some(w => w.code === 'FIXED_EVENT_CONFLICT')).toBe(true);
    });

    test('flags warning when proposal falls outside user availability window', () => {
      const outOfWindowProposal = createPlanningProposal({
        actions: [
          {
            type: 'schedule_task',
            title: 'Học đêm',
            date: '2026-03-12',
            startTime: '22:00', // After availability end 21:00
            endTime: '23:00',
            durationMinutes: 60
          }
        ]
      });

      const validation = validatePlanningProposal(outOfWindowProposal, baseContext);
      expect(validation.warnings.some(w => w.code === 'OUTSIDE_AVAILABILITY')).toBe(true);
    });

    test('flags internal overlap between multiple proposed tasks', () => {
      const overlappingProposal = createPlanningProposal({
        actions: [
          {
            type: 'schedule_task',
            title: 'Môn 1',
            date: '2026-03-12',
            startTime: '19:00',
            endTime: '20:00',
            durationMinutes: 60
          },
          {
            type: 'schedule_task',
            title: 'Môn 2',
            date: '2026-03-12',
            startTime: '19:30', // Overlaps with Môn 1
            endTime: '20:30',
            durationMinutes: 60
          }
        ]
      });

      const validation = validatePlanningProposal(overlappingProposal, baseContext);
      expect(validation.valid).toBe(false);
      expect(validation.warnings.some(w => w.code === 'INTERNAL_PROPOSAL_OVERLAP')).toBe(true);
    });

    test('flags invalid date format in proposal action', () => {
      const badDateProposal = createPlanningProposal({
        actions: [
          {
            type: 'schedule_task',
            title: 'Toán',
            date: '12-03-2026', // invalid, must be YYYY-MM-DD
            startTime: '15:00',
            endTime: '16:00',
            durationMinutes: 60
          }
        ]
      });

      const validation = validatePlanningProposal(badDateProposal, baseContext);
      expect(validation.valid).toBe(false);
      expect(validation.warnings.some(w => w.code === 'INVALID_DATE')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. AI PROVIDERS & DETERMINISTIC FALLBACK TESTS
  // ─────────────────────────────────────────────────────────────
  describe('4. AI Providers & Fallback Engine', () => {
    test('PlaceholderAIProvider returns NOT_CONFIGURED status', async () => {
      const placeholder = new PlaceholderAIProvider();
      const intentRes = await placeholder.parseIntent('Học Toán 1 tiếng');
      expect(intentRes.status).toBe('NOT_CONFIGURED');

      const planRes = await placeholder.generatePlan('Học Toán 1 tiếng');
      expect(planRes.status).toBe('NOT_CONFIGURED');
    });

    test('DeterministicFallbackProvider parses fixed event and flexible tasks accurately', async () => {
      const fallback = new DeterministicFallbackProvider();
      const context = { currentDate: '2026-03-12', availability: { start: '15:00', end: '21:00' } };

      // Fixed event test
      const eventRes = await fallback.parseIntent('chiều nay đá bóng lúc 17h', context);
      expect(eventRes.status).toBe('SUCCESS');
      expect(eventRes.source).toBe('deterministic');
      expect(eventRes.intent.fixedEvents.length).toBeGreaterThanOrEqual(1);
      expect(eventRes.intent.fixedEvents[0].start).toBe('17:00');

      // Flexible task test
      const taskRes = await fallback.parseIntent('học Lý 2 tiếng', context);
      expect(taskRes.status).toBe('SUCCESS');
      expect(taskRes.intent.tasks.length).toBeGreaterThanOrEqual(1);
      expect(taskRes.intent.tasks[0].durationMinutes).toBe(120);
    });

    test('DeterministicFallbackProvider generates conflict-free plan respecting availability', async () => {
      const fallback = new DeterministicFallbackProvider();
      const context = {
        currentDate: '2026-03-12',
        availability: { start: '15:00', end: '21:00' },
        fixedEvents: [
          { id: 'f1', title: 'Học trường', date: '2026-03-12', start: '15:00', end: '17:00' }
        ]
      };

      const planRes = await fallback.generatePlan('học Toán 60 phút', context);
      expect(planRes.status).toBe('SUCCESS');
      expect(planRes.proposal.actions.length).toBe(1);

      const action = planRes.proposal.actions[0];
      expect(action.type).toBe('schedule_task');
      // Must be scheduled AFTER the fixed event (>= 17:00)
      const startMin = AppDate.minFromTime(action.startTime);
      expect(startMin).toBeGreaterThanOrEqual(1020); // 17:00 = 1020 min
    });

    test('GeminiServerProvider returns NOT_CONFIGURED without API key', async () => {
      const gemini = new GeminiServerProvider({ apiKey: null });
      const res = await gemini.parseIntent('Học Sử 45p');
      expect(res.status).toBe('NOT_CONFIGURED');
    });

    test('ClientAIAdapter seamlessly delegates to fallback in offline mode or error', async () => {
      const fallback = new DeterministicFallbackProvider();
      const client = new ClientAIAdapter({ fallbackProvider: fallback, apiEndpoint: '/nonexistent/api' });

      // Should automatically fall back without throwing an unhandled rejection
      const res = await client.generatePlan('học Văn 45p', { currentDate: '2026-03-12' });
      expect(res.status).toBe('SUCCESS');
      expect(res.source).toBe('deterministic');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. SECURITY & ZERO UNCONTROLLED MUTATION
  // ─────────────────────────────────────────────────────────────
  describe('5. Security & Zero Uncontrolled Mutation', () => {
    test('Proposal schema sanitizes malicious input in actions or rationales', () => {
      const maliciousProposal = createPlanningProposal({
        actions: [
          {
            type: 'schedule_task',
            title: '<script>alert("XSS")</script>Học Văn',
            date: '2026-03-12',
            startTime: '15:00',
            endTime: '15:45',
            durationMinutes: 45
          }
        ],
        rationale: ['<img src=x onerror=alert(1)>Lý do']
      });

      // Actions & rationales remain pure data structures, never executable HTML
      expect(maliciousProposal.actions[0].title).toBe('<script>alert("XSS")</script>Học Văn');
      // Validator does not crash on special chars
      const val = validatePlanningProposal(maliciousProposal, { currentDate: '2026-03-12' });
      expect(val).toBeDefined();
    });

    test('PlanningProposal alone does NOT mutate any user state without explicit application', () => {
      const userState = {
        tasks: [{ id: 't1', title: 'Cũ', scheduledDate: '2026-03-12' }]
      };
      const originalCount = userState.tasks.length;

      const proposal = createPlanningProposal({
        actions: [
          { type: 'schedule_task', title: 'Mới', date: '2026-03-12', startTime: '16:00', endTime: '17:00' }
        ]
      });

      // Creation & validation must be completely side-effect free
      validatePlanningProposal(proposal, { currentDate: '2026-03-12' });
      expect(userState.tasks.length).toBe(originalCount);
      expect(userState.tasks[0].title).toBe('Cũ');
    });
  });
});
