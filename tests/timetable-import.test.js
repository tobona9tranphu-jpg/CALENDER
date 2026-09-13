'use strict';

const { validateSlots, parseModelJSON } = require('../api/parse-timetable');
const fs = require('fs');
const path = require('path');

// Extract parseSubjectAndTeacher from app.js for unit testing
const appJs = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const parseSubjectFnMatch = appJs.match(/function parseSubjectAndTeacher\([\s\S]*?\n\}/);
if (!parseSubjectFnMatch) {
  throw new Error('Could not find parseSubjectAndTeacher in app.js');
}
const parseSubjectAndTeacher = new Function('raw', `${parseSubjectFnMatch[0]}; return parseSubjectAndTeacher(raw);`);

describe('Timetable Import System', () => {

  describe('api/parse-timetable.js - validateSlots', () => {
    test('normalizes valid slots, formats single-digit hours, and sorts by day/time', () => {
      const input = [
        { day: 2, title: 'Vật lí', start: '8:05', end: '08:50' },
        { day: 1, title: 'Toán', start: '07:15', end: '08:00' },
      ];
      const result = validateSlots(input);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ day: 1, title: 'Toán', start: '07:15', end: '08:00' });
      expect(result[1]).toEqual({ day: 2, title: 'Vật lí', start: '08:05', end: '08:50' });
    });

    test('normalizes Sunday day: 7 -> day: 0', () => {
      const input = [
        { day: 7, title: 'Học thêm Anh', start: '08:00', end: '09:30' },
        { day: 0, title: 'Ôn thi Toán', start: '10:00', end: '11:30' }
      ];
      const result = validateSlots(input);
      expect(result).toHaveLength(2);
      expect(result[0].day).toBe(0);
      expect(result[1].day).toBe(0);
    });

    test('gracefully merges consecutive double periods of the same subject', () => {
      const input = [
        { day: 1, title: 'Toán', start: '07:15', end: '08:00' },
        { day: 1, title: 'Toán', start: '08:00', end: '08:50' }
      ];
      const result = validateSlots(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        day: 1,
        title: 'Toán',
        start: '07:15',
        end: '08:50'
      });
    });

    test('gracefully resolves overlapping periods of different subjects without throwing 422', () => {
      const input = [
        { day: 1, title: 'Chào cờ', start: '07:15', end: '08:00' },
        { day: 1, title: 'Toán', start: '07:55', end: '08:45' }
      ];
      expect(() => {
        const result = validateSlots(input);
        expect(result).toHaveLength(2);
        expect(result[1].start).toBe('08:00');
        expect(result[1].end).toBe('08:45');
      }).not.toThrow();
    });

    test('throws validationError only when no valid slots exist', () => {
      expect(validateSlots([])).toEqual([]);
      expect(() => validateSlots([{ day: 9, title: '', start: 'xx', end: 'yy' }])).toThrow();
    });
  });

  describe('api/parse-timetable.js - parseModelJSON', () => {
    test('parses pure JSON array', () => {
      const jsonStr = '[{"day":1,"title":"Toán","start":"07:15","end":"08:00"}]';
      expect(parseModelJSON(jsonStr)).toEqual([{ day: 1, title: 'Toán', start: '07:15', end: '08:00' }]);
    });

    test('extracts JSON from markdown code block with surrounding conversational text', () => {
      const raw = `Chào bạn, đây là kết quả đọc TKB:
\`\`\`json
[
  {"day": 2, "title": "Hóa học", "start": "08:05", "end": "08:50"}
]
\`\`\`
Chúc bạn học tốt!`;
      const result = parseModelJSON(raw);
      expect(result).toEqual([{ day: 2, title: 'Hóa học', start: '08:05', end: '08:50' }]);
    });

    test('extracts JSON array without code fence embedded in text', () => {
      const raw = `Kết quả: [{"day": 3, "title": "Sinh học", "start": "09:05", "end": "09:50"}]`;
      const result = parseModelJSON(raw);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Sinh học');
    });

    test('extracts array from object with slots key', () => {
      const raw = `{"slots": [{"day": 4, "title": "Lịch sử", "start": "09:55", "end": "10:40"}]}`;
      const result = parseModelJSON(raw);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Lịch sử');
    });
  });

  describe('app.js - parseSubjectAndTeacher', () => {
    test('parses standard subjects and groups them accurately', () => {
      const subjects = [
        { raw: 'Toán', expectedSubject: 'Toán', expectedGroup: 'Toán' },
        { raw: 'Đại số 12', expectedSubject: 'Toán', expectedGroup: 'Toán' },
        { raw: 'Ngữ văn', expectedSubject: 'Ngữ văn', expectedGroup: 'Ngữ văn' },
        { raw: 'Văn 12', expectedSubject: 'Ngữ văn', expectedGroup: 'Ngữ văn' },
        { raw: 'Tiếng Anh', expectedSubject: 'Tiếng Anh', expectedGroup: 'Tiếng Anh' },
        { raw: 'Vật lí', expectedSubject: 'Vật lí', expectedGroup: 'Vật lí' },
        { raw: 'Vật lý 12', expectedSubject: 'Vật lí', expectedGroup: 'Vật lí' },
        { raw: 'Hóa học', expectedSubject: 'Hóa học', expectedGroup: 'Hóa học' },
        { raw: 'Sinh học', expectedSubject: 'Sinh học', expectedGroup: 'Sinh học' },
        { raw: 'Lịch sử', expectedSubject: 'Lịch sử', expectedGroup: 'Lịch sử' },
        { raw: 'Địa lí', expectedSubject: 'Địa lí', expectedGroup: 'Địa lí' },
        { raw: 'Tin học', expectedSubject: 'Tin học', expectedGroup: 'Tin học' },
        { raw: 'GDCD', expectedSubject: 'GDCD / KT&PL', expectedGroup: 'GDCD' },
        { raw: 'KT&PL', expectedSubject: 'GDCD / KT&PL', expectedGroup: 'GDCD' },
        { raw: 'GDQP', expectedSubject: 'Giáo dục quốc phòng', expectedGroup: 'Thể dục / GDQP' },
        { raw: 'Thể dục', expectedSubject: 'Thể dục', expectedGroup: 'Thể dục / GDQP' },
        { raw: 'Công nghệ', expectedSubject: 'Công nghệ', expectedGroup: 'Công nghệ' },
        { raw: 'Chào cờ', expectedSubject: 'Chào cờ', expectedGroup: 'Chào cờ' },
        { raw: 'Sinh hoạt', expectedSubject: 'Sinh hoạt lớp', expectedGroup: 'Sinh hoạt lớp' },
        { raw: 'HĐTN', expectedSubject: 'HĐ Trải nghiệm', expectedGroup: 'Hoạt động trải nghiệm' }
      ];

      for (const item of subjects) {
        const parsed = parseSubjectAndTeacher(item.raw);
        expect(parsed).not.toBeNull();
        expect(parsed.subject).toBe(item.expectedSubject);
        expect(parsed.subjectGroup).toBe(item.expectedGroup);
      }
    });

    test('extracts teacher from hyphen, parentheses, colon, and newline', () => {
      const t1 = parseSubjectAndTeacher('Toán - Thầy Hùng');
      expect(t1.subject).toBe('Toán');
      expect(t1.teacher).toBe('Thầy Hùng');
      expect(t1.title).toBe('Toán (GV Thầy Hùng)');

      const t2 = parseSubjectAndTeacher('Văn (Cô Lan)');
      expect(t2.subject).toBe('Ngữ văn');
      expect(t2.teacher).toBe('Cô Lan');
      expect(t2.title).toBe('Ngữ văn (GV Cô Lan)');

      const t3 = parseSubjectAndTeacher('Tin học: Tuấn');
      expect(t3.subject).toBe('Tin học');
      expect(t3.teacher).toBe('Tuấn');
      expect(t3.title).toBe('Tin học (GV Tuấn)');

      const t4 = parseSubjectAndTeacher('Hóa học\nCô Mai');
      expect(t4.subject).toBe('Hóa học');
      expect(t4.teacher).toBe('Cô Mai');
      expect(t4.title).toBe('Hóa học (GV Cô Mai)');
    });

    test('does NOT default non-core subjects to "Toán"', () => {
      const nonCore = parseSubjectAndTeacher('Kỹ năng sống - Thầy Nam');
      expect(nonCore.subject).toBe('Kỹ năng sống');
      expect(nonCore.subjectGroup).toBe('Kỹ năng sống');
      expect(nonCore.subjectGroup).not.toBe('Toán');

      const german = parseSubjectAndTeacher('Tiếng Đức');
      expect(german.subjectGroup).toBe('Tiếng Đức');
      expect(german.subjectGroup).not.toBe('Toán');
    });

    test('ignores empty or off days (nghỉ, -, x)', () => {
      expect(parseSubjectAndTeacher('')).toBeNull();
      expect(parseSubjectAndTeacher('Nghỉ')).toBeNull();
      expect(parseSubjectAndTeacher('-')).toBeNull();
      expect(parseSubjectAndTeacher('x')).toBeNull();
    });
  });

});
