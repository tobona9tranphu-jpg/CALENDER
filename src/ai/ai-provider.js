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
    const AIConfig = require('../config/ai');
    const exportsObj = factory(AppDate, IntentSchema, PlanningProposal, QuickCapture, TodayEngine, AIConfig);
    exportsObj.AIProvider = exportsObj;
    module.exports = exportsObj;
  } else {
    root.AIProvider = factory(
      root.AppDate,
      root.IntentSchema,
      root.PlanningProposal,
      root.QuickCapture,
      root.TodayEngine,
      root.AIConfig
    );
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (
  DateUtil,
  IntentSchemaUtil,
  PlanningProposalUtil,
  QuickCaptureUtil,
  TodayEngineUtil,
  AIConfig
) {

  /**
   * Operational Telemetry & AI Health Signal Tracker.
   * Tracks call volume, success rates, fallbacks, and typed failure reasons.
   * Zero credential, password, or sensitive calendar payload leakage.
   */
  const AITelemetry = {
    _stats: {
      aiRequests: 0,
      aiSuccess: 0,
      aiFallback: 0,
      aiFailure: 0,
      recentEvents: []
    },
    record(event = {}) {
      this._stats.aiRequests++;
      if (event.source === 'ai') {
        this._stats.aiSuccess++;
      } else if (event.source === 'deterministic') {
        this._stats.aiFallback++;
      } else {
        this._stats.aiFailure++;
      }
      this._stats.recentEvents.push({
        source: event.source || 'deterministic',
        provider: event.provider || (event.source === 'ai' ? 'gemini' : 'deterministic'),
        failureReason: event.failureReason || null,
        intent: event.intent || null,
        timestamp: new Date().toISOString()
      });
      if (this._stats.recentEvents.length > 50) {
        this._stats.recentEvents.shift();
      }
    },
    getHealthSignal() {
      const total = this._stats.aiRequests;
      const rate = total > 0 ? Number(((this._stats.aiSuccess / total) * 100).toFixed(1)) : 100.0;
      return {
        aiRequests: this._stats.aiRequests,
        aiSuccess: this._stats.aiSuccess,
        aiFallback: this._stats.aiFallback,
        aiFailure: this._stats.aiFailure,
        aiAvailabilityRate: rate
      };
    },
    getRecentEvents() {
      return [...this._stats.recentEvents];
    },
    reset() {
      this._stats.aiRequests = 0;
      this._stats.aiSuccess = 0;
      this._stats.aiFallback = 0;
      this._stats.aiFailure = 0;
      this._stats.recentEvents = [];
    }
  };

  /**
   * Helper for bounded retries with exponential backoff on HTTP 429/503.
   */
  async function fetchWithBoundedRetry(url, fetchOptions, retryConfig = {}) {
    const maxRetries = retryConfig.maxRetries ?? (AIConfig ? AIConfig.RETRY_CONFIG.MAX_RETRIES : 2);
    const retryableStatuses = retryConfig.retryableStatuses || (AIConfig ? AIConfig.RETRY_CONFIG.RETRYABLE_STATUS_CODES : [429, 503]);
    let lastResponse = null;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, fetchOptions);
        if (response.ok) {
          return { ok: true, response };
        }
        lastResponse = response;
        if (retryableStatuses.includes(response.status) && attempt < maxRetries) {
          const baseDelay = retryConfig.initialDelayMs || (AIConfig ? AIConfig.RETRY_CONFIG.INITIAL_DELAY_MS : 500);
          const maxDelay = retryConfig.maxDelayMs || (AIConfig ? AIConfig.RETRY_CONFIG.MAX_DELAY_MS : 2000);
          const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
          await new Promise(res => setTimeout(res, delay));
          continue;
        }
        return { ok: false, response };
      } catch (err) {
        lastError = err;
        if (err.name === 'AbortError') {
          return { ok: false, error: err, isTimeout: true };
        }
        if (attempt < maxRetries) {
          const baseDelay = retryConfig.initialDelayMs || (AIConfig ? AIConfig.RETRY_CONFIG.INITIAL_DELAY_MS : 500);
          const maxDelay = retryConfig.maxDelayMs || (AIConfig ? AIConfig.RETRY_CONFIG.MAX_DELAY_MS : 2000);
          const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
          await new Promise(res => setTimeout(res, delay));
          continue;
        }
        return { ok: false, error: err };
      }
    }
    return { ok: false, response: lastResponse, error: lastError };
  }

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

    async parseAssistantIntent(input, context = {}) {
      const IntentRouterUtil = (typeof IntentRouter !== 'undefined' && IntentRouter)
        ? IntentRouter
        : (typeof require === 'function' ? require('./intent-router') : null);

      if (IntentRouterUtil && IntentRouterUtil.classifyDeterministic) {
        return {
          status: 'SUCCESS',
          source: 'deterministic',
          intent: IntentRouterUtil.classifyDeterministic(input, context)
        };
      }
      return { status: 'ERROR', error: 'IntentRouter not found' };
    }

  }

  /**
   * Gemini Server-side Provider.
   * Runs in Node.js serverless environment using process.env.GEMINI_API_KEY.
   */
  class GeminiServerProvider extends AIProvider {
    constructor({ apiKey = undefined, model = undefined, timeoutMs = undefined } = {}) {
      super();
      this.apiKey = (apiKey !== undefined) ? apiKey : (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : null);
      this.model = model || (AIConfig ? AIConfig.resolveGeminiModel() : 'gemini-2.0-flash');
      this.timeoutMs = timeoutMs || (AIConfig ? AIConfig.AI_TIMEOUT_MS : 14000);
    }

    async parseIntent(input, context = {}) {
      if (!this.apiKey) {
        return { status: 'NOT_CONFIGURED', errorType: 'AI_PROVIDER_UNAVAILABLE', error: 'Máy chủ chưa cấu hình GEMINI_API_KEY.' };
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
        const fetchResult = await fetchWithBoundedRetry(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: 'user', parts: [{ text: input }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json' }
          })
        }, AIConfig ? AIConfig.RETRY_CONFIG : {});

        clearTimeout(timer);

        if (fetchResult.isTimeout) {
          return { status: 'TIMEOUT', errorType: 'AI_TIMEOUT', error: 'Yêu cầu AI quá thời gian (timeout).' };
        }

        if (!fetchResult.ok || !fetchResult.response || !fetchResult.response.ok) {
          const st = fetchResult.response ? fetchResult.response.status : 503;
          let errType = 'AI_PROVIDER_UNAVAILABLE';
          if (st === 429) errType = 'AI_RATE_LIMIT';
          else if (st === 404) errType = 'AI_MODEL_NOT_FOUND';
          else if (st === 400) errType = 'AI_INVALID_RESPONSE';
          return { status: 'UNAVAILABLE', errorType: errType, error: `Gemini API returned HTTP ${st}` };
        }

        const data = await fetchResult.response.json();
        const text = data?.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string')?.text;
        if (!text) {
          return { status: 'MALFORMED_OUTPUT', errorType: 'AI_INVALID_RESPONSE', error: 'Empty candidate from Gemini.' };
        }

        const parsed = JSON.parse(text);
        const intent = IntentSchemaUtil.createIntent({
          ...parsed,
          source: 'ai',
          rawText: input
        });

        const validation = IntentSchemaUtil.validateIntent(intent);
        if (!validation.valid) {
          return { status: 'INVALID_SCHEMA', errorType: 'AI_SCHEMA_ERROR', errors: validation.errors, intent };
        }

        return { status: 'SUCCESS', source: 'ai', provider: 'gemini', model: this.model, intent };
      } catch (err) {
        clearTimeout(timer);
        const isTimeout = err.name === 'AbortError';
        return {
          status: isTimeout ? 'TIMEOUT' : 'ERROR',
          errorType: isTimeout ? 'AI_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE',
          error: isTimeout ? 'Yêu cầu AI quá thời gian (timeout).' : err.message
        };
      }
    }

    /**
     * @deprecated Legacy schedule generation. New UI uses TimeAssistant + CapabilityRouter deterministic engines.
     */
    async generatePlan(input, context = {}) {
      if (!this.apiKey) {
        return { status: 'NOT_CONFIGURED', errorType: 'AI_PROVIDER_UNAVAILABLE', error: 'Máy chủ chưa cấu hình GEMINI_API_KEY.' };
      }

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
        const fetchResult = await fetchWithBoundedRetry(endpoint, {
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
        }, AIConfig ? AIConfig.RETRY_CONFIG : {});

        clearTimeout(timer);

        if (fetchResult.isTimeout) {
          return { status: 'TIMEOUT', errorType: 'AI_TIMEOUT', error: 'Yêu cầu AI quá thời gian (timeout).' };
        }

        if (!fetchResult.ok || !fetchResult.response || !fetchResult.response.ok) {
          const st = fetchResult.response ? fetchResult.response.status : 503;
          let errType = 'AI_PROVIDER_UNAVAILABLE';
          if (st === 429) errType = 'AI_RATE_LIMIT';
          else if (st === 404) errType = 'AI_MODEL_NOT_FOUND';
          return { status: 'UNAVAILABLE', errorType: errType, error: `Gemini API returned HTTP ${st}` };
        }

        const data = await fetchResult.response.json();
        const text = data?.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string')?.text;
        if (!text) {
          return { status: 'MALFORMED_OUTPUT', errorType: 'AI_INVALID_RESPONSE', error: 'Empty output from Gemini.' };
        }

        const parsed = JSON.parse(text);
        const proposal = PlanningProposalUtil.createPlanningProposal({
          ...parsed,
          source: 'ai'
        });

        return { status: 'SUCCESS', source: 'ai', provider: 'gemini', model: this.model, proposal };
      } catch (err) {
        clearTimeout(timer);
        const isTimeout = err.name === 'AbortError';
        return {
          status: isTimeout ? 'TIMEOUT' : 'ERROR',
          errorType: isTimeout ? 'AI_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE',
          error: err.message
        };
      }
    }

    async parseAssistantIntent(input, context = {}) {
      if (!this.apiKey) {
        return { status: 'NOT_CONFIGURED', errorType: 'AI_PROVIDER_UNAVAILABLE', error: 'Máy chủ chưa cấu hình GEMINI_API_KEY.' };
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

      const systemInstruction = `Bạn là Trợ lý Thời gian AI thông minh (AI Time Assistant) cho học sinh.
Nhiệm vụ: Phân loại câu nói của học sinh vào ĐÚNG 1 trong 9 ý định sau:
1. "plan": Sắp xếp / lên lịch học môn mới
2. "reschedule": Dời / đổi giờ ca học
3. "fix_day": Lịch bị rối, quá tải, xung đột
4. "review_day": Đánh giá, tổng kết hôm nay
5. "review_week": Đánh giá, tổng kết tuần
6. "capture_task": Thêm bài tập / ghi chú việc cần làm
7. "find_time": Tìm khoảng trống rảnh
8. "deadline_help": Quản lý hạn chót, bài tập sắp đến hạn
9. "explain_schedule": Giải thích tại sao lịch dày, bận rộn

Trả về JSON duy nhất theo schema:
{
  "intent": "plan" | "reschedule" | "fix_day" | "review_day" | "review_week" | "capture_task" | "find_time" | "deadline_help" | "explain_schedule",
  "confidence": 0.95,
  "entities": {
    "subject": "Toán" | null,
    "taskTitle": "Học Toán" | null,
    "durationMinutes": 120 | null,
    "date": "YYYY-MM-DD" | null,
    "targetTime": "HH:mm" | null,
    "timePreference": "morning" | "afternoon" | "evening" | null,
    "deadlineDate": "YYYY-MM-DD" | null,
    "priority": 3
  },
  "constraints": []
}
Ngày hiện tại: ${context.currentDate || new Date().toISOString().slice(0, 10)}.`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const fetchResult = await fetchWithBoundedRetry(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: 'user', parts: [{ text: input }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json' }
          })
        }, AIConfig ? AIConfig.RETRY_CONFIG : {});

        clearTimeout(timer);

        if (fetchResult.isTimeout) {
          return { status: 'TIMEOUT', errorType: 'AI_TIMEOUT', error: 'Yêu cầu AI quá thời gian (timeout).' };
        }

        if (!fetchResult.ok || !fetchResult.response || !fetchResult.response.ok) {
          const st = fetchResult.response ? fetchResult.response.status : 503;
          let errType = 'AI_PROVIDER_UNAVAILABLE';
          if (st === 429) errType = 'AI_RATE_LIMIT';
          else if (st === 404) errType = 'AI_MODEL_NOT_FOUND';
          else if (st === 400) errType = 'AI_INVALID_RESPONSE';
          return { status: 'UNAVAILABLE', errorType: errType, error: `Gemini API returned HTTP ${st}` };
        }

        const data = await fetchResult.response.json();
        const text = data?.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string')?.text;
        if (!text) {
          return { status: 'MALFORMED_OUTPUT', errorType: 'AI_INVALID_RESPONSE', error: 'Empty candidate from Gemini.' };
        }

        const parsed = JSON.parse(text);
        if (!parsed || !parsed.intent) {
          return { status: 'INVALID_SCHEMA', errorType: 'AI_SCHEMA_ERROR', error: 'Intent output format invalid.' };
        }

        return { status: 'SUCCESS', source: 'ai', provider: 'gemini', model: this.model, intent: parsed };
      } catch (err) {
        clearTimeout(timer);
        const isTimeout = err.name === 'AbortError';
        return {
          status: isTimeout ? 'TIMEOUT' : 'ERROR',
          errorType: isTimeout ? 'AI_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE',
          error: isTimeout ? 'Yêu cầu AI quá thời gian (timeout).' : err.message
        };
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

    async parseAssistantIntent(input, context = {}) {
      if (typeof window !== 'undefined' && (window.location.protocol === 'file:' || (typeof isOfflineMode === 'function' && isOfflineMode()))) {
        const fallbackRes = await this.fallback.parseAssistantIntent(input, context);
        AITelemetry.record({ source: 'deterministic', provider: 'deterministic', failureReason: 'OFFLINE_MODE', intent: fallbackRes.intent?.intent });
        return {
          ...fallbackRes,
          source: 'deterministic',
          provider: 'deterministic',
          fallbackReason: 'OFFLINE_MODE'
        };
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
            action: 'ask_assistant',
            input,
            context
          })
        });

        clearTimeout(timer);

        if (!response.ok) {
          const fallbackRes = await this.fallback.parseAssistantIntent(input, context);
          const reason = response.status === 503 ? 'AI_PROVIDER_UNAVAILABLE' : (response.status === 429 ? 'AI_RATE_LIMIT' : `HTTP_${response.status}`);
          AITelemetry.record({ source: 'deterministic', provider: 'deterministic', failureReason: reason, intent: fallbackRes.intent?.intent });
          return {
            ...fallbackRes,
            source: 'deterministic',
            provider: 'deterministic',
            fallbackReason: reason
          };
        }

        const data = await response.json();
        if (data.ok && data.intent) {
          if (data.source === 'ai') {
            AITelemetry.record({ source: 'ai', provider: data.provider || 'gemini', intent: data.intent?.intent });
            return {
              status: 'SUCCESS',
              source: 'ai',
              provider: data.provider || 'gemini',
              model: data.model,
              intent: data.intent
            };
          } else {
            // Server-side fallback occurred
            AITelemetry.record({ source: 'deterministic', provider: 'deterministic', failureReason: data.fallbackReason || 'SERVER_FALLBACK', intent: data.intent?.intent });
            return {
              status: 'SUCCESS',
              source: 'deterministic',
              provider: 'deterministic',
              fallbackReason: data.fallbackReason || 'SERVER_FALLBACK',
              intent: data.intent
            };
          }
        }

        const fallbackRes = await this.fallback.parseAssistantIntent(input, context);
        AITelemetry.record({ source: 'deterministic', provider: 'deterministic', failureReason: data.fallbackReason || 'AI_INVALID_RESPONSE', intent: fallbackRes.intent?.intent });
        return {
          ...fallbackRes,
          source: 'deterministic',
          provider: 'deterministic',
          fallbackReason: data.fallbackReason || 'AI_INVALID_RESPONSE'
        };
      } catch (err) {
        clearTimeout(timer);
        const reason = (err && err.name === 'AbortError') ? 'AI_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE';
        const fallbackRes = await this.fallback.parseAssistantIntent(input, context);
        AITelemetry.record({ source: 'deterministic', provider: 'deterministic', failureReason: reason, intent: fallbackRes.intent?.intent });
        return {
          ...fallbackRes,
          source: 'deterministic',
          provider: 'deterministic',
          fallbackReason: reason
        };
      }
    }

  }

  return {
    AIProvider,
    PlaceholderAIProvider,
    DeterministicFallbackProvider,
    GeminiServerProvider,
    ClientAIAdapter,
    AITelemetry
  };
}));
