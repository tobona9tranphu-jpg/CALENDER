'use strict';

const TimeAssistant = require('../src/ai/time-assistant');

describe('P1.5: TimeAssistant End-to-End Orchestration', () => {
  const mockUser = {
    id: 'user-assistant-test',
    availability: { start: '17:00', end: '22:00', days: [1, 2, 3, 4, 5, 6, 0] },
    subjects: [{ id: 'sub-math', name: 'Toán' }, { id: 'sub-phys', name: 'Vật lí' }],
    fixedSchedules: [
      { id: 'f-1', title: 'Học ở trường', day: 2, start: '17:30', end: '19:00' }
    ],
    tasks: [
      { id: 't-1', title: 'Ôn tập Toán', scheduledDate: '2026-09-15', startTime: '19:30', endTime: '20:30', durationMinutes: 60, status: 'planned' }
    ],
    settings: {
      learnedPreferences: {
        durationMultipliers: { Toán: 1.0 }
      }
    }
  };

  beforeEach(() => {
    TimeAssistant.resetConversation();
  });

  test('handles empty query gracefully', async () => {
    const res = await TimeAssistant.handleUserQuery('', mockUser);
    expect(res.status).toBe('information');
    expect(res.message).toContain('Bạn muốn tôi giúp gì');
  });

  test('Flow A (Plan): Plans a study session and produces proposal', async () => {
    const res = await TimeAssistant.handleUserQuery('Sắp xếp cho tôi 60 phút học Vật lí tối nay', mockUser, {
      currentDate: '2026-09-15',
      currentTime: '14:00'
    });

    expect(res.intent).toBe('plan');
    expect(['proposal_ready', 'information']).toContain(res.status);
    if (res.status === 'proposal_ready') {
      expect(res.proposal.actions.length).toBe(1);
      expect(res.requiresConfirmation).toBe(true);
      expect(res.proposal.actions[0].durationMinutes).toBe(60);
    }
  });

  test('Flow B (Fix Day): Dispatches to Fix My Day', async () => {
    const res = await TimeAssistant.handleUserQuery('Lịch hôm nay rối quá, hãy sửa giúp tôi', mockUser, {
      currentDate: '2026-09-15'
    });

    expect(res.intent).toBe('fix_day');
    expect(['proposal_ready', 'information']).toContain(res.status);
    expect(res.data).toHaveProperty('diagnosis');
  });

  test('Flow C (Find Time): Returns up to 3 candidate slots', async () => {
    const res = await TimeAssistant.handleUserQuery('Tìm cho tôi 45 phút rảnh để học bài', mockUser, {
      currentDate: '2026-09-15'
    });

    expect(res.intent).toBe('find_time');
    expect(res.status).toBe('information');
    expect(res.data.slots.length).toBeGreaterThan(0);
    expect(res.data.slots.length).toBeLessThanOrEqual(3);
  });

  test('Flow D (Review Week): Summarizes past 7 days', async () => {
    const res = await TimeAssistant.handleUserQuery('Tuần này tôi học thế nào?', mockUser, {
      currentDate: '2026-09-15'
    });

    expect(res.intent).toBe('review_week');
    expect(res.status).toBe('information');
    expect(res.message).toContain('Tổng kết 7 ngày qua');
  });

  test('Flow E (Deadline): Plans ahead of deadline date', async () => {
    const res = await TimeAssistant.handleUserQuery('Tôi phải nộp bài tập Toán trước ngày 2026-09-18', mockUser, {
      currentDate: '2026-09-15'
    });

    expect(res.intent).toBe('deadline_help');
    expect(['proposal_ready', 'action_preview']).toContain(res.status);
  });

  test('Flow F (Multi-turn Follow-up & Ambiguity Clarification)', async () => {
    // User without duration preference asks to study subject without specifying duration
    const userNoPrefs = { ...mockUser, settings: { learnedPreferences: {} } };

    // Turn 1: Vague request
    const turn1 = await TimeAssistant.handleUserQuery('Mai tôi muốn học Vật lí', userNoPrefs, {
      currentDate: '2026-09-15'
    });

    expect(turn1.status).toBe('needs_clarification');
    expect(turn1.message).toContain('Bạn muốn dành khoảng bao lâu cho môn Vật lí?');
    expect(turn1.data.missingField).toBe('durationMinutes');

    // Turn 2: User responds with duration
    const turn2 = await TimeAssistant.handleUserQuery('90 phút', userNoPrefs, {
      currentDate: '2026-09-15'
    });

    expect(turn2.intent).toBe('plan');
    expect(['proposal_ready', 'information']).toContain(turn2.status);
    if (turn2.proposal) {
      expect(turn2.proposal.actions[0].durationMinutes).toBe(90);
    }
  });

  test('AI Failure & Timeout Fallback: Functions 100% deterministically when AI adapter fails', async () => {
    const failingAIAdapter = {
      parseAssistantIntent: async () => {
        throw new Error('Network timeout');
      }
    };

    const res = await TimeAssistant.handleUserQuery('Tìm cho tôi 30 phút rảnh', mockUser, {
      aiAdapter: failingAIAdapter,
      currentDate: '2026-09-15'
    });

    expect(res.intent).toBe('find_time');
    expect(res.status).toBe('information');
    expect(res.data.slots.length).toBeGreaterThan(0);
  });
});
