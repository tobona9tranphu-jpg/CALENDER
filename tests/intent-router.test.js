'use strict';

const IntentRouter = require('../src/ai/intent-router');

describe('P1.5: IntentRouter & Schema Validation', () => {
  test('defines all 9 mandatory intent categories', () => {
    expect(IntentRouter.INTENT_CATEGORIES).toEqual([
      'plan',
      'reschedule',
      'fix_day',
      'review_day',
      'review_week',
      'capture_task',
      'find_time',
      'deadline_help',
      'explain_schedule'
    ]);
  });

  describe('validateIntentSchema', () => {
    test('accepts valid intent schema', () => {
      const raw = {
        intent: 'plan',
        confidence: 0.9,
        entities: { subject: 'Toán', durationMinutes: 60, date: '2026-09-20' },
        constraints: []
      };
      const res = IntentRouter.validateIntentSchema(raw);
      expect(res.valid).toBe(true);
      expect(res.intent.intent).toBe('plan');
      expect(res.intent.entities.subject).toBe('Toán');
      expect(res.intent.entities.durationMinutes).toBe(60);
    });

    test('rejects non-object or missing intent', () => {
      expect(IntentRouter.validateIntentSchema(null).valid).toBe(false);
      expect(IntentRouter.validateIntentSchema({}).valid).toBe(false);
    });

    test('rejects unapproved intent category', () => {
      const res = IntentRouter.validateIntentSchema({ intent: 'order_pizza' });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('Invalid intent category');
    });

    test('clamps confidence between 0.0 and 1.0', () => {
      const res1 = IntentRouter.validateIntentSchema({ intent: 'fix_day', confidence: 1.5 });
      expect(res1.intent.confidence).toBe(1.0);
      const res2 = IntentRouter.validateIntentSchema({ intent: 'fix_day', confidence: -0.2 });
      expect(res2.intent.confidence).toBe(0.0);
    });
  });

  describe('Deterministic Fallback Classification (NLP & Regex)', () => {
    const context = { currentDate: '2026-09-15', subjects: [{ id: 's1', name: 'Vật lí' }] };

    test('classifies fix_day intents', () => {
      expect(IntentRouter.classifyDeterministic('Lịch hôm nay rối quá', context).intent).toBe('fix_day');
      expect(IntentRouter.classifyDeterministic('Hãy sửa lịch giúp tôi (Fix My Day)', context).intent).toBe('fix_day');
      expect(IntentRouter.classifyDeterministic('Xung đột lịch trình rồi', context).intent).toBe('fix_day');
    });

    test('classifies review_week intents', () => {
      expect(IntentRouter.classifyDeterministic('Sao tuần này tôi cứ trễ?', context).intent).toBe('review_week');
      expect(IntentRouter.classifyDeterministic('Review tuần này giúp tôi', context).intent).toBe('review_week');
      expect(IntentRouter.classifyDeterministic('Tổng kết tuần', context).intent).toBe('review_week');
    });

    test('classifies review_day intents', () => {
      expect(IntentRouter.classifyDeterministic('Hôm nay tôi học thế nào?', context).intent).toBe('review_day');
      expect(IntentRouter.classifyDeterministic('Đánh giá ngày hôm nay', context).intent).toBe('review_day');
    });

    test('classifies find_time intents', () => {
      const res = IntentRouter.classifyDeterministic('Tìm cho tôi 90 phút rảnh để học Lý ngày mai', context);
      expect(res.intent).toBe('find_time');
      expect(res.entities.durationMinutes).toBe(90);
      expect(res.entities.subject).toBe('Vật lí');
      expect(res.entities.date).toBe('2026-09-16');
    });

    test('classifies deadline_help intents', () => {
      const res = IntentRouter.classifyDeterministic('Mai tôi có deadline nộp bài tập Toán', context);
      expect(res.intent).toBe('deadline_help');
      expect(res.entities.subject).toBe('Toán');
      expect(res.entities.deadlineDate).toBe('2026-09-16');
    });

    test('classifies explain_schedule intents', () => {
      expect(IntentRouter.classifyDeterministic('Tại sao hôm nay tôi phải học nhiều thế?', context).intent).toBe('explain_schedule');
      expect(IntentRouter.classifyDeterministic('Giải thích lịch hôm nay', context).intent).toBe('explain_schedule');
    });

    test('classifies reschedule intents', () => {
      expect(IntentRouter.classifyDeterministic('Dời lịch học Toán sang tối mai', context).intent).toBe('reschedule');
      expect(IntentRouter.classifyDeterministic('Đổi ca học sang chiều', context).intent).toBe('reschedule');
    });

    test('classifies capture_task intents', () => {
      const res = IntentRouter.classifyDeterministic('Thêm bài tập Tiếng Anh nộp thứ 6', context);
      expect(res.intent).toBe('capture_task');
      expect(res.entities.subject).toBe('Tiếng Anh');
    });

    test('classifies plan intents with extracted entities', () => {
      const res = IntentRouter.classifyDeterministic('Sắp xếp cho tôi 2 tiếng học Toán ngày mai', context);
      expect(res.intent).toBe('plan');
      expect(res.entities.subject).toBe('Toán');
      expect(res.entities.durationMinutes).toBe(120);
      expect(res.entities.date).toBe('2026-09-16');
    });
  });

  describe('Duration & Date Parsing Utilities', () => {
    test('parses hours, minutes, and compound times', () => {
      expect(IntentRouter._parseDurationMinutes('2 tiếng')).toBe(120);
      expect(IntentRouter._parseDurationMinutes('1.5 giờ')).toBe(90);
      expect(IntentRouter._parseDurationMinutes('90 phút')).toBe(90);
      expect(IntentRouter._parseDurationMinutes('45p')).toBe(45);
      expect(IntentRouter._parseDurationMinutes('1h30')).toBe(90);
    });

    test('parses relative dates in Vietnamese', () => {
      expect(IntentRouter._parseDateReference('hôm nay', '2026-09-15')).toBe('2026-09-15');
      expect(IntentRouter._parseDateReference('ngày mai', '2026-09-15')).toBe('2026-09-16');
      expect(IntentRouter._parseDateReference('ngày kia', '2026-09-15')).toBe('2026-09-17');
      expect(IntentRouter._parseDateReference('lịch ngày 2026-09-25', '2026-09-15')).toBe('2026-09-25');
    });
  });

  describe('Ambiguity Detection', () => {
    test('flags missing duration for plan when no learned preference exists', () => {
      const intent = {
        intent: 'plan',
        entities: { subject: 'Toán', durationMinutes: null }
      };
      const amb = IntentRouter.detectAmbiguity(intent, {});
      expect(amb.needsClarification).toBe(true);
      expect(amb.missingField).toBe('durationMinutes');
      expect(amb.question).toContain('Bạn muốn dành khoảng bao lâu');
    });

    test('does not flag missing duration for plan if learned preference exists', () => {
      const intent = {
        intent: 'plan',
        entities: { subject: 'Toán', durationMinutes: null }
      };
      const amb = IntentRouter.detectAmbiguity(intent, { durationMultipliers: { Toán: 1.2 } });
      expect(amb.needsClarification).toBe(false);
    });

    test('does not flag when duration is already provided', () => {
      const intent = {
        intent: 'plan',
        entities: { subject: 'Toán', durationMinutes: 60 }
      };
      expect(IntentRouter.detectAmbiguity(intent, {}).needsClarification).toBe(false);
    });
  });
});
