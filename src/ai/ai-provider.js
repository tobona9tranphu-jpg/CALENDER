'use strict';

/**
 * @file ai-provider.js
 * AI Provider Abstraction with Gemini Integration, Client Adapter & Deterministic Fallback.
 *
 * Capabilities:
 * - AIProvider: Base contract
 * - PlaceholderAIProvider: Clean unconfigured state
 * - GeminiServerProvider: Server-side Gemini API provider with strict JSON output & timeout
 * - DeterministicFallbackProvider: Safe offline/local fallback using existing algorithms
 * - ClientAIAdapter: Frontend bridge connecting to /api/ai with automatic fallback
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    const IntentSchema = require('./intent-schema');
    const PlanningProposal = require('./planning-proposal');
    const QuickCapture = require('../today/quick-capture');
    const TodayEngine = require('../today/today-engine');
    const exportsObj = factory(AppDate, IntentSchema, PlanningProposal, QuickCapture, TodayEngine);
    exportsObj.AIProvider = exportsObj;
    module.exports = exportsObj;
  } else {
    root.AIProvider = factory(
      root.AppDate,
      root.IntentSchema,
      root.PlanningProposal,
      root.QuickCapture,
      root.TodayEngine
    );
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (
  DateUtil,
  IntentSchemaUtil,
  PlanningProposalUtil,
  QuickCaptureUtil,
  TodayEngineUtil
) {

  /**
   * Base AI Provider Interface
   */
  class AIProvider {
    /**
     * Parse natural language input into structured intent.
     * @param {string} input
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async parseIntent(input, context) {
      throw new Error('parseIntent must be implemented by subclass.');
    }

    /**
     * Generate structured plan proposal from intent or request.
     * @param {string|Object} input
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generatePlan(input, context) {
      throw new Error('generatePlan must be implemented by subclass.');
    }
  }

  /**
   * Placeholder Provider when no AI service is configured.
   */
  class PlaceholderAIProvider extends AIProvider {
    async parseIntent() {
      return {
        status: 'NOT_CONFIGURED',
        error: 'AI Provider is not configured.',
        intent: null
      };
    }

    async generatePlan() {
      return {
        status: 'NOT_CONFIGURED',
        error: 'AI Provider is not configured.',
        proposal: null
      };
    }
  }

  /**
   * Deterministic Fallback Provider.
   * Reuses QuickCapture & TodayEngine to parse and plan deterministically.
   */
  class DeterministicFallbackProvider extends AIProvider {
    async parseIntent(input, context = {}) {
      const baseDate = context.currentDate || (DateUtil && DateUtil.getTodayAppDate ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10));
      const parsed = QuickCaptureUtil && QuickCaptureUtil.parseCaptureInput
        ? QuickCaptureUtil.parseCaptureInput(input, baseDate)
        : { cleanTitle: input, durationMinutes: 30, targetDate: null, priority: 3, destination: 'Inbox' };

      const tasks = [];
      const fixedEvents = [];
      const unresolved = [];

      // Check if user mentioned football / đá bóng / meeting with a time
      const timeMatch = input.match(/\b(\d{1,2})\s*(?:h|:|giờ)\s*(\d{2})?\b/i);
      const isEvent = /(đá bóng|da bong|họp|hop|meeting|sinh nhật|sinh nhat|khám|kham)\b/i.test(input);

      if (isEvent && timeMatch) {
        const hour = parseInt(timeMatch[1], 10);
        const min = parseInt(timeMatch[2], 10) || 0;
        const start = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        const endHour = (hour + 1) % 24;
        const end = `${String(endHour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        fixedEvents.push({
          title: parsed.cleanTitle || 'Sự kiện cố định',
          date: parsed.targetDate || baseDate,
          start,
          end,
          fixed: true
        });
      } else {
        tasks.push({
          title: parsed.cleanTitle || input,
          durationMinutes: parsed.durationMinutes || 30,
          date: parsed.targetDate || null,
          priority: parsed.priority || 3,
          flexible: true
        });
      }

      const intent = IntentSchemaUtil.createIntent({
        tasks,
        fixedEvents,
        unresolved,
        confidence: 0.95,
        source: 'deterministic',
        rawText: input
      });

      return {
        status: 'SUCCESS',
        source: 'deterministic',
        intent
      };
    }

    async generatePlan(input, context = {}) {
      const intentRes = typeof input === 'string' ? await this.parseIntent(input, context) : { intent: input };
      const intent = intentRes.intent || {};
      const targetDate = context.currentDate || (DateUtil && DateUtil.getTodayAppDate ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10));
      const avail = context.availability || { start: '15:00', end: '21:30' };

      const actions = [];
      const rationale = [];

      // Current fixed events on target date
      const existingFixed = (context.fixedEvents || []).filter(f => f.date === targetDate);
      const existingTasks = (context.scheduledTasks || []).filter(t => t.scheduledDate === targetDate);

      // Start cursor inside availability window
      let cursorMin = DateUtil && DateUtil.minFromTime ? DateUtil.minFromTime(avail.start) : 900;
      const availEndMin = DateUtil && DateUtil.minFromTime ? DateUtil.minFromTime(avail.end) : 1290;

      // Plan new fixed events first
      for (const fe of (intent.fixedEvents || [])) {
        actions.push({
          type: 'create_event',
          title: fe.title,
          date: fe.date || targetDate,
          startTime: fe.start,
          endTime: fe.end,
          durationMinutes: 60
        });
        rationale.push({
          reason: `Lịch cố định: "${fe.title}" lúc ${fe.start} - ${fe.end}.`
        });
      }

      // Slot flexible tasks into available free gaps
      for (const t of (intent.tasks || [])) {
        const dur = t.durationMinutes || 45;
        // Skip over fixed events
        for (const fixed of existingFixed) {
          const fs = DateUtil && DateUtil.minFromTime ? DateUtil.minFromTime(fixed.start) : 0;
          const fe = DateUtil && DateUtil.minFromTime ? DateUtil.minFromTime(fixed.end) : 0;
          if (cursorMin < fe && cursorMin + dur > fs) {
            cursorMin = fe + 10;
          }
        }

        if (cursorMin + dur <= availEndMin) {
          const startTime = DateUtil && DateUtil.timeFromMin ? DateUtil.timeFromMin(cursorMin) : '15:00';
          const endTime = DateUtil && DateUtil.timeFromMin ? DateUtil.timeFromMin(cursorMin + dur) : '15:45';
          actions.push({
            type: 'schedule_task',
            title: t.title,
            date: t.date || targetDate,
            startTime,
            endTime,
            durationMinutes: dur
          });
          rationale.push({
            reason: `Xếp "${t.title}" vào khoảng trống ${startTime} - ${endTime} (${dur} phút) phù hợp khung giờ rảnh.`
          });
          cursorMin += dur + 10; // 10 min buffer
        } else {
          // If cannot fit today, recommend moving to inbox
          rationale.push({
            reason: `Không đủ thời gian rảnh hôm nay cho "${t.title}". Đề xuất lưu vào Hộp thư.`
          });
        }
      }

      const proposal = PlanningProposalUtil.createPlanningProposal({
        actions,
        rationale,
        confidence: 0.9,
        source: 'deterministic'
      });

      return {
        status: 'SUCCESS',
        source: 'deterministic',
        proposal
      };
    }
  }

  /**
   * Gemini Server-side Provider.
   * Runs in Node.js serverless environment using process.env.GEMINI_API_KEY.
   */
  class GeminiServerProvider extends AIProvider {
    constructor({ apiKey = undefined, model = 'gemini-3.6-flash', timeoutMs = 10000 } = {}) {
      super();
      this.apiKey = (apiKey !== undefined) ? apiKey : (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : null);
      this.model = model;
      this.timeoutMs = timeoutMs;
    }

    async parseIntent(input, context = {}) {
      if (!this.apiKey) {
        return { status: 'NOT_CONFIGURED', error: 'Máy chủ chưa cấu hình GEMINI_API_KEY.' };
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

      const systemInstruction = `Bạn là trợ lý AI phân tích ý định thời gian (AI Time Management Assistant) cho học sinh.
Nhiệm vụ: Phân tích câu nói tự nhiên của người dùng thành đối tượng JSON chuẩn theo đúng định dạng sau:
{
  "tasks": [{"title": "Lý", "durationMinutes": 120, "date": "YYYY-MM-DD", "priority": 4, "flexible": true}],
  "fixedEvents": [{"title": "Đá bóng", "start": "19:00", "end": "20:00", "date": "YYYY-MM-DD"}],
  "deadlines": [],
  "constraints": [],
  "unresolved": [],
  "confidence": 0.95
}
Quy tắc:
- Múi giờ Việt Nam UTC+7. Ngày hiện tại: ${context.currentDate || new Date().toISOString().slice(0, 10)}.
- Phân biệt rõ sự kiện cố định (đá bóng, học thêm, giờ cố định) và nhiệm vụ linh hoạt (học bài, ôn tập).
- Chỉ trả về JSON duy nhất, không markdown, không giải thích.`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: 'user', parts: [{ text: input }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json' }
          })
        });

        clearTimeout(timer);

        if (!response.ok) {
          return { status: 'UNAVAILABLE', error: `Gemini API returned HTTP ${response.status}` };
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string')?.text;
        if (!text) {
          return { status: 'MALFORMED_OUTPUT', error: 'Empty candidate from Gemini.' };
        }

        const parsed = JSON.parse(text);
        const intent = IntentSchemaUtil.createIntent({
          ...parsed,
          source: 'ai',
          rawText: input
        });

        const validation = IntentSchemaUtil.validateIntent(intent);
        if (!validation.valid) {
          return { status: 'INVALID_SCHEMA', errors: validation.errors, intent };
        }

        return { status: 'SUCCESS', source: 'ai', intent };
      } catch (err) {
        clearTimeout(timer);
        const isTimeout = err.name === 'AbortError';
        return {
          status: isTimeout ? 'TIMEOUT' : 'ERROR',
          error: isTimeout ? 'Yêu cầu AI quá thời gian (timeout).' : err.message
        };
      }
    }

    async generatePlan(input, context = {}) {
      if (!this.apiKey) {
        return { status: 'NOT_CONFIGURED', error: 'Máy chủ chưa cấu hình GEMINI_API_KEY.' };
      }

      // Can be extended in P1.2; for P1.1 foundation, uses prompt template with JSON output
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

      const systemInstruction = `Bạn là trợ lý AI lập kế hoạch học tập. Hãy dựa vào khung giờ rảnh và lịch cố định để đề xuất lịch học phù hợp.
Trả về duy nhất JSON:
{
  "actions": [{"type": "schedule_task", "title": "Tên", "date": "YYYY-MM-DD", "startTime": "HH:MM", "endTime": "HH:MM", "durationMinutes": 45}],
  "warnings": [],
  "rationale": [{"reason": "Lý do ngắn gọn"}],
  "confidence": 0.92
}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{
              role: 'user',
              parts: [{ text: `Yêu cầu: ${typeof input === 'string' ? input : JSON.stringify(input)}. Ngữ cảnh: ${JSON.stringify(context)}` }]
            }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json' }
          })
        });

        clearTimeout(timer);

        if (!response.ok) {
          return { status: 'UNAVAILABLE', error: `Gemini API returned HTTP ${response.status}` };
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string')?.text;
        if (!text) {
          return { status: 'MALFORMED_OUTPUT', error: 'Empty output from Gemini.' };
        }

        const parsed = JSON.parse(text);
        const proposal = PlanningProposalUtil.createPlanningProposal({
          ...parsed,
          source: 'ai'
        });

        return { status: 'SUCCESS', source: 'ai', proposal };
      } catch (err) {
        clearTimeout(timer);
        return { status: err.name === 'AbortError' ? 'TIMEOUT' : 'ERROR', error: err.message };
      }
    }
  }

  /**
   * Client-side Adapter.
   * Calls authenticated /api/ai on the server with credentials:'include'.
   * Falls back to DeterministicFallbackProvider automatically if server is unconfigured or fails.
   */
  class ClientAIAdapter extends AIProvider {
    constructor({ fallbackProvider = null, apiEndpoint = '/api/ai', timeoutMs = 8000 } = {}) {
      super();
      this.fallback = fallbackProvider || new DeterministicFallbackProvider();
      this.apiEndpoint = apiEndpoint;
      this.timeoutMs = timeoutMs;
    }

    async parseIntent(input, context = {}) {
      // In offline / demo mode, or file: protocol, immediately use deterministic fallback
      if (typeof window !== 'undefined' && (window.location.protocol === 'file:' || (typeof isOfflineMode === 'function' && isOfflineMode()))) {
        return this.fallback.parseIntent(input, context);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(this.apiEndpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            action: 'parse_intent',
            input,
            context
          })
        });

        clearTimeout(timer);

        if (!response.ok) {
          // Upstream failed -> fallback
          return this.fallback.parseIntent(input, context);
        }

        const data = await response.json();
        if (data.ok && data.intent) {
          return {
            status: 'SUCCESS',
            source: data.source || 'ai',
            intent: data.intent
          };
        }

        // Server returned NOT_CONFIGURED or other non-ok status -> fallback
        return this.fallback.parseIntent(input, context);
      } catch {
        clearTimeout(timer);
        // Network failure / timeout -> fallback cleanly
        return this.fallback.parseIntent(input, context);
      }
    }

    async generatePlan(input, context = {}) {
      if (typeof window !== 'undefined' && (window.location.protocol === 'file:' || (typeof isOfflineMode === 'function' && isOfflineMode()))) {
        return this.fallback.generatePlan(input, context);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(this.apiEndpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            action: 'generate_plan',
            input,
            context
          })
        });

        clearTimeout(timer);

        if (!response.ok) {
          return this.fallback.generatePlan(input, context);
        }

        const data = await response.json();
        if (data.ok && data.proposal) {
          return {
            status: 'SUCCESS',
            source: data.source || 'ai',
            proposal: data.proposal
          };
        }

        return this.fallback.generatePlan(input, context);
      } catch {
        clearTimeout(timer);
        return this.fallback.generatePlan(input, context);
      }
    }
  }

  return {
    AIProvider,
    PlaceholderAIProvider,
    DeterministicFallbackProvider,
    GeminiServerProvider,
    ClientAIAdapter
  };
}));
