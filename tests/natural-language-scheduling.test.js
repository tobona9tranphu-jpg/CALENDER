'use strict';
const IntentRouter = require('../src/ai/intent-router');

describe('Natural Language Scheduling', () => {

  describe('Time Parsing', () => {
    test('"17h" → "17:00"', () => {
      expect(IntentRouter._parseTimeReference('17h')).toBe('17:00');
    });

    test('"17h30" → "17:30"', () => {
      expect(IntentRouter._parseTimeReference('17h30')).toBe('17:30');
    });

    test('"5pm" → "17:00"', () => {
      expect(IntentRouter._parseTimeReference('5pm')).toBe('17:00');
    });

    test('"9am" → "09:00"', () => {
      expect(IntentRouter._parseTimeReference('9am')).toBe('09:00');
    });

    test('"lúc 15:00" → "15:00"', () => {
      expect(IntentRouter._parseTimeReference('lúc 15:00')).toBe('15:00');
    });

    test('"7 giờ tối" → "19:00"', () => {
      expect(IntentRouter._parseTimeReference('7 giờ tối')).toBe('19:00');
    });

    test('"3 giờ chiều" → "15:00"', () => {
      expect(IntentRouter._parseTimeReference('3 giờ chiều')).toBe('15:00');
    });

    test('"8 giờ sáng" → "08:00"', () => {
      expect(IntentRouter._parseTimeReference('8 giờ sáng')).toBe('08:00');
    });

    test('no time → null', () => {
      expect(IntentRouter._parseTimeReference('học Toán ngày mai')).toBe(null);
    });
  });

  describe('Multi-Day Date Parsing', () => {
    const baseDate = '2026-09-16'; // Wednesday (JS day 3)

    test('"thứ 2, 4, 6" extracts 3 dates', () => {
      const dates = IntentRouter._parseDateReferences('thứ 2, 4, 6', baseDate);
      expect(dates.length).toBe(3);
    });

    test('"2, 4, 6" extracts 3 dates', () => {
      const dates = IntentRouter._parseDateReferences('học toán 2, 4, 6', baseDate);
      expect(dates.length).toBe(3);
    });

    test('single date still works', () => {
      const dates = IntentRouter._parseDateReferences('ngày mai', baseDate);
      expect(dates.length).toBe(1);
    });

    test('"hôm nay" returns today', () => {
      const dates = IntentRouter._parseDateReferences('hôm nay', baseDate);
      expect(dates).toEqual([baseDate]);
    });
  });

  describe('Integrated Plan with Multi-Day', () => {
    test('"Học Toán thứ 2, 4, 6" creates plan with multiple dates', () => {
      const result = IntentRouter.classifyDeterministic('Học Toán thứ 2, 4, 6', {
        currentDate: '2026-09-16',
        subjects: [{ id: 'math', name: 'Toán' }]
      });
      expect(result.intent).toBe('plan');
      expect(result.entities.subject).toBe('Toán');
      expect(result.entities.dates).toBeDefined();
      expect(result.entities.dates.length).toBe(3);
    });

    test('"Học Lý lúc 17h" extracts time', () => {
      const result = IntentRouter.classifyDeterministic('Học Lý lúc 17h', {
        currentDate: '2026-09-16',
        subjects: [{ id: 'physics', name: 'Vật lí' }]
      });
      expect(result.intent).toBe('plan');
      expect(result.entities.targetTime).toBe('17:00');
    });

    test('"2,4,6 tôi học Toán lúc 17h" regression (Section 26)', () => {
      const result = IntentRouter.classifyDeterministic('2,4,6 tôi học Toán lúc 17h', {
        currentDate: '2026-09-16',
        subjects: [{ id: 'math', name: 'Toán' }]
      });
      expect(result.intent).toBe('plan');
      expect(result.entities.subject).toBe('Toán');
      expect(result.entities.dates.length).toBe(3);
      expect(result.entities.targetTime).toBe('17:00');
      // Must NOT convert 17h into 17 hours (1020 minutes)
      expect(result.entities.durationMinutes).toBeLessThanOrEqual(60);
      expect(result.entities.durationMinutes).not.toBe(1020);
    });

    test('"2,4,6 tôi học toán vào lúc 17h hoặc 5h pm" regression', () => {
      const result = IntentRouter.classifyDeterministic('2,4,6 tôi học toán vào lúc 17h hoặc 5h pm', {
        currentDate: '2026-09-16',
        subjects: [{ id: 'math', name: 'Toán' }]
      });
      expect(result.intent).toBe('plan');
      expect(result.entities.subject).toBe('Toán');
      expect(result.entities.dates.length).toBe(3);
      expect(result.entities.targetTime).toBe('17:00');
      expect(result.entities.durationMinutes).not.toBe(1020);
    });

    test('"T2 T4 T6 học Lý 1 tiếng lúc 7pm" regression', () => {
      const result = IntentRouter.classifyDeterministic('T2 T4 T6 học Lý 1 tiếng lúc 7pm', {
        currentDate: '2026-09-16',
        subjects: [{ id: 'physics', name: 'Vật lí' }]
      });
      expect(result.intent).toBe('plan');
      expect(result.entities.subject).toBe('Vật lí');
      expect(result.entities.dates.length).toBe(3);
      expect(result.entities.durationMinutes).toBe(60);
      expect(result.entities.targetTime).toBe('19:00');
    });
  });

  describe('Duration Parsing (existing)', () => {
    test('"2 tiếng" → 120', () => {
      expect(IntentRouter._parseDurationMinutes('2 tiếng')).toBe(120);
    });

    test('"45 phút" → 45', () => {
      expect(IntentRouter._parseDurationMinutes('45 phút')).toBe(45);
    });

    test('"1h30" → 90', () => {
      expect(IntentRouter._parseDurationMinutes('1h30')).toBe(90);
    });
  });

  describe('Deadline keyword guard', () => {
    test('standalone "hạn" does NOT trigger deadline_help', () => {
      const result = IntentRouter.classifyDeterministic('giới hạn thời gian', {
        currentDate: '2026-09-16'
      });
      expect(result.intent).not.toBe('deadline_help');
    });

    test('"hạn nộp" DOES trigger deadline_help', () => {
      const result = IntentRouter.classifyDeterministic('hạn nộp bài là thứ 6', {
        currentDate: '2026-09-16'
      });
      expect(result.intent).toBe('deadline_help');
    });
  });
});
