'use strict';

const TimetableImporter = require('../src/timetable/timetable-importer');
const fs = require('fs');
const path = require('path');

describe('Timetable Import System - Full Specification Suite', () => {

  describe('1. Class Name Normalization (normalizeClassName)', () => {
    test('normalizes various class formats to exact uppercase alphanumeric strings', () => {
      expect(TimetableImporter.normalizeClassName('12A1')).toBe('12A1');
      expect(TimetableImporter.normalizeClassName('Lớp 12A1')).toBe('12A1');
      expect(TimetableImporter.normalizeClassName('12 A1')).toBe('12A1');
      expect(TimetableImporter.normalizeClassName('12-A1')).toBe('12A1');
      expect(TimetableImporter.normalizeClassName('12A-1')).toBe('12A1');
      expect(TimetableImporter.normalizeClassName('LỚP 12 A-1')).toBe('12A1');
      expect(TimetableImporter.normalizeClassName('Khối 12A1')).toBe('12A1');
      expect(TimetableImporter.normalizeClassName('Class 11B2')).toBe('11B2');
    });

    test('exact matching prevents false positive substring inclusion', () => {
      const userProfileGrade = 'Lớp 11B1';
      const fileClasses = ['12A1', '12A2', '11B10', '11B1'];

      const normUser = TimetableImporter.normalizeClassName(userProfileGrade);
      const exactMatches = fileClasses.filter(c => TimetableImporter.normalizeClassName(c) === normUser);
      
      expect(exactMatches).toHaveLength(1);
      expect(exactMatches[0]).toBe('11B1');
      expect(exactMatches).not.toContain('11B10');
    });
  });

  describe('2. Period Time Profile (getPeriodTime)', () => {
    test('returns exact configured start and end times for periods 1 to 10', () => {
      expect(TimetableImporter.getPeriodTime(1)).toEqual({ start: '07:15', end: '08:00' });
      expect(TimetableImporter.getPeriodTime(5)).toEqual({ start: '10:45', end: '11:30' });
      expect(TimetableImporter.getPeriodTime(6)).toEqual({ start: '13:00', end: '13:45' });
      expect(TimetableImporter.getPeriodTime(10)).toEqual({ start: '16:30', end: '17:15' });
    });

    test('returns null for periods beyond profile (e.g. period 11) without inventing fake fallback times', () => {
      expect(TimetableImporter.getPeriodTime(11)).toBeNull();
      expect(TimetableImporter.getPeriodTime(12)).toBeNull();
      expect(TimetableImporter.getPeriodTime(0)).toBeNull();
    });
  });

  describe('3. DOCX Logical Grid Reconstruction (extractDocxLogicalGrid)', () => {
    test('reconstructs normal 2x2 table grid accurately', () => {
      const xml = `
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:t>Thứ 2</w:t></w:p></w:tc>
            <w:tc><w:p><w:t>Thứ 3</w:t></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:p><w:t>Toán</w:t></w:p></w:tc>
            <w:tc><w:p><w:t>Văn</w:t></w:p></w:tc>
          </w:tr>
        </w:tbl>
      `;
      const grid = TimetableImporter.extractDocxLogicalGrid(xml);
      expect(grid).toHaveLength(2);
      expect(grid[0]).toEqual(['Thứ 2', 'Thứ 3']);
      expect(grid[1]).toEqual(['Toán', 'Văn']);
    });

    test('handles horizontal column merges (<w:gridSpan w:val="2"/>) without column shift', () => {
      const xml = `
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:t>Tiết</w:t></w:p></w:tc>
            <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:t>Sáng</w:t></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:p><w:t>1</w:t></w:p></w:tc>
            <w:tc><w:p><w:t>Toán</w:t></w:p></w:tc>
            <w:tc><w:p><w:t>Lý</w:t></w:p></w:tc>
          </w:tr>
        </w:tbl>
      `;
      const grid = TimetableImporter.extractDocxLogicalGrid(xml);
      expect(grid[0]).toEqual(['Tiết', 'Sáng', 'Sáng']);
      expect(grid[1]).toEqual(['1', 'Toán', 'Lý']);
    });

    test('handles vertical merges (<w:vMerge w:val="restart"/> and <w:vMerge/>) inheriting cell content', () => {
      const xml = `
        <w:tbl>
          <w:tr>
            <w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:t>Thứ 2</w:t></w:p></w:tc>
            <w:tc><w:p><w:t>Toán</w:t></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p></w:p></w:tc>
            <w:tc><w:p><w:t>Văn</w:t></w:p></w:tc>
          </w:tr>
        </w:tbl>
      `;
      const grid = TimetableImporter.extractDocxLogicalGrid(xml);
      expect(grid[0]).toEqual(['Thứ 2', 'Toán']);
      expect(grid[1]).toEqual(['Thứ 2', 'Văn']);
    });
  });

  describe('4. Structured TXT Parsing (parseStructuredText)', () => {
    test('parses valid structured pipe format with day headers, period times, and teacher', () => {
      const txt = `
        # Thời khóa biểu tuần mới
        Thứ 2
        1|Toán|07:15|08:00|Nguyễn Văn A
        2|Vật lí|08:05|08:50|Trần Văn B

        Thứ 3
        1|Hóa học|07:15|08:00|
      `;

      const slots = TimetableImporter.parseStructuredText(txt);
      expect(slots).toHaveLength(3);
      
      expect(slots[0]).toMatchObject({
        day: 1,
        periodStart: 1,
        title: 'Toán (GV Nguyễn Văn A)',
        subjectGroup: 'Toán',
        teacher: 'Nguyễn Văn A',
        start: '07:15',
        end: '08:00'
      });

      expect(slots[1]).toMatchObject({
        day: 1,
        periodStart: 2,
        title: 'Vật lí (GV Trần Văn B)',
        subjectGroup: 'Vật lí',
        teacher: 'Trần Văn B',
        start: '08:05',
        end: '08:50'
      });

      expect(slots[2]).toMatchObject({
        day: 2,
        periodStart: 1,
        title: 'Hóa học',
        subjectGroup: 'Hóa học',
        start: '07:15',
        end: '08:00'
      });
    });

    test('resolves time from period profile when start/end times are omitted in pipe format', () => {
      const txt = `
        Thứ 4
        3|Tiếng Anh|||Cô Mai
      `;
      const slots = TimetableImporter.parseStructuredText(txt);
      expect(slots).toHaveLength(1);
      expect(slots[0].start).toBe('09:05');
      expect(slots[0].end).toBe('09:50');
      expect(slots[0].unresolvedTime).toBe(false);
    });

    test('throws structured error with format guidelines when text does not use pipe schema', () => {
      const malformedText = `
        Thu 2: Toan, Van, Anh
        Thu 3: Ly, Hoa, Sinh
      `;
      expect(() => TimetableImporter.parseStructuredText(malformedText)).toThrow(/Định dạng tệp văn bản không đúng cấu trúc chuẩn/);
    });
  });

  describe('5. Duplicate Protection & Deduplication', () => {
    test('isDuplicateScheduleEntry identifies same day, start, end, and normalized title', () => {
      const slotA = { day: 1, start: '07:15', end: '08:00', title: 'Toán' };
      const slotB = { day: 1, start: '07:15', end: '08:00', title: 'toán ' };
      const slotC = { day: 1, start: '08:05', end: '08:50', title: 'Toán' };

      expect(TimetableImporter.isDuplicateScheduleEntry(slotA, slotB)).toBe(true);
      expect(TimetableImporter.isDuplicateScheduleEntry(slotA, slotC)).toBe(false);
    });

    test('dedupeScheduleEntries strips duplicates within the same import batch', () => {
      const rawBatch = [
        { day: 1, start: '07:15', end: '08:00', title: 'Toán' },
        { day: 1, start: '07:15', end: '08:00', title: 'Toán' },
        { day: 2, start: '08:05', end: '08:50', title: 'Lý' }
      ];
      const deduped = TimetableImporter.dedupeScheduleEntries(rawBatch);
      expect(deduped).toHaveLength(2);
      expect(deduped[0].title).toBe('Toán');
      expect(deduped[1].title).toBe('Lý');
    });
  });

  describe('6. Realtime Slot Validation (validateImportSlots)', () => {
    test('flags hard errors: start >= end, missing title, invalid HH:MM, and internal batch overlaps', () => {
      const slots = [
        { day: 1, title: 'Toán', start: '08:00', end: '07:15' }, // start >= end
        { day: 1, title: '', start: '08:05', end: '08:50' }, // empty title
        { day: 2, title: 'Văn', start: '09:00', end: '10:00' }, // valid
        { day: 2, title: 'Anh', start: '09:30', end: '10:30' }  // internal overlap with Văn
      ];

      const res = TimetableImporter.validateImportSlots(slots, []);
      expect(res.valid).toBe(false);
      expect(res.summary.errorCount).toBe(4);
      expect(res.summary.validCount).toBe(0);
    });

    test('flags warnings for existing duplicates without marking proposal invalid', () => {
      const existing = [{ day: 1, start: '07:15', end: '08:00', title: 'Toán', source: 'timetable-import' }];
      const incoming = [
        { day: 1, title: 'Toán', start: '07:15', end: '08:00' },
        { day: 2, title: 'Lý', start: '08:05', end: '08:50' }
      ];

      const res = TimetableImporter.validateImportSlots(incoming, existing);
      expect(res.valid).toBe(true); // Warnings do NOT block valid
      expect(res.summary.warningCount).toBe(1);
      expect(res.warnings[0].messages[0]).toMatch(/đã có sẵn/);
    });

    test('flags unresolved time for slots beyond period profile (e.g. period 11)', () => {
      const slots = [
        { day: 1, period: 11, title: 'Học buổi tối', start: '', end: '' }
      ];
      const res = TimetableImporter.validateImportSlots(slots, []);
      expect(res.valid).toBe(false);
      expect(res.errors[0].messages[0]).toMatch(/Chưa xác định giờ cho tiết 11/);
    });
  });

  describe('7. App Integration Contract Check (app.js)', () => {
    const appJsContent = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

    test('app.js rejects .doc files immediately with user-facing guidance', () => {
      expect(appJsContent).toMatch(/Tệp \.doc không được hỗ trợ trực tiếp/);
    });

    test('Replace mode in app.js preserves manual schedules (source === "manual")', () => {
      expect(appJsContent).toMatch(/item\.source === 'timetable-import'/);
    });

    test('app.js integrates TimetableImporter.validateImportSlots and dedupeScheduleEntries', () => {
      expect(appJsContent).toMatch(/validateImportSlots/);
      expect(appJsContent).toMatch(/dedupeScheduleEntries/);
    });
  });

});
