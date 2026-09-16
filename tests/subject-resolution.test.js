'use strict';
const IntentRouter = require('../src/ai/intent-router');

describe('Subject Resolution', () => {
  const knownSubjects = [
    { id: 'math', name: 'Toán' },
    { id: 'physics', name: 'Vật lí' },
    { id: 'chemistry', name: 'Hóa học' },
    { id: 'literature', name: 'Ngữ văn' },
    { id: 'english', name: 'Tiếng Anh' },
    { id: 'biology', name: 'Sinh học' },
    { id: 'history', name: 'Lịch sử' },
    { id: 'geography', name: 'Địa lí' },
    { id: 'informatics', name: 'Tin học' },
  ];

  test('"học Toán" resolves to Toán, not Lý', () => {
    expect(IntentRouter._extractSubject('học Toán', knownSubjects)).toBe('Toán');
  });

  test('"học lý" resolves to Vật lí', () => {
    expect(IntentRouter._extractSubject('học lý', knownSubjects)).toBe('Vật lí');
  });

  test('"học vật lý" resolves to Vật lí', () => {
    expect(IntentRouter._extractSubject('học vật lý', knownSubjects)).toBe('Vật lí');
  });

  test('"toán" resolves to Toán', () => {
    expect(IntentRouter._extractSubject('toán', knownSubjects)).toBe('Toán');
  });

  test('"Toán 2 tiếng" resolves to Toán', () => {
    expect(IntentRouter._extractSubject('Toán 2 tiếng', knownSubjects)).toBe('Toán');
  });

  test('"lý thuyết" does NOT match Vật lí', () => {
    const result = IntentRouter._extractSubject('lý thuyết về phương trình', knownSubjects);
    expect(result).not.toBe('Vật lí');
  });

  test('"tâm lý" does NOT match Vật lí', () => {
    const result = IntentRouter._extractSubject('tâm lý học', knownSubjects);
    expect(result).not.toBe('Vật lí');
  });

  test('"hóa" resolves to Hóa học', () => {
    expect(IntentRouter._extractSubject('học hóa 1 tiếng', knownSubjects)).toBe('Hóa học');
  });

  test('"sinh" resolves to Sinh học', () => {
    expect(IntentRouter._extractSubject('ôn sinh', knownSubjects)).toBe('Sinh học');
  });

  test('"văn" resolves to Ngữ văn', () => {
    expect(IntentRouter._extractSubject('làm bài văn', knownSubjects)).toBe('Ngữ văn');
  });

  test('user subject exact match takes priority', () => {
    const customSubjects = [
      { id: 'custom-math', name: 'Toán cao cấp' },
      ...knownSubjects
    ];
    expect(IntentRouter._extractSubject('ôn toán cao cấp', customSubjects)).toBe('Toán cao cấp');
  });

  test('deterministic classifier resolves Toán correctly', () => {
    const result = IntentRouter.classifyDeterministic('Học Toán 2 tiếng', { subjects: knownSubjects });
    expect(result.entities.subject).toBe('Toán');
  });

  test('deterministic classifier resolves Lý correctly', () => {
    const result = IntentRouter.classifyDeterministic('Ôn lý 45 phút', { subjects: knownSubjects });
    expect(result.entities.subject).toBe('Vật lí');
  });
});
