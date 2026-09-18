'use strict';

const { send, readBody, preflight } = require('../lib/http');
const { getUserId } = require('../lib/auth');
const { GeminiServerProvider, DeterministicFallbackProvider, AITelemetry } = require('../src/ai/ai-provider');
const { generateReschedulePlan } = require('../src/ai/reschedule-engine');
const AppDate = require('../src/utils/date');
const Clock = require('../src/utils/clock');
const AIConfig = require('../src/config/ai');

/**
 * Serverless handler for /api/ai
 * Provides authenticated AI intent parsing and plan proposal generation.
 *
 * Privacy Guarantees:
 * - Requires active session (HttpOnly TB-auth-token).
 * - Context is strictly sanitized before processing.
 * - Credentials, tokens, hashes, and emails are never accessible or transmitted.
 */
module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;

  const userId = getUserId(req);
  if (!userId) {
    return send(res, 401, { ok: false, error: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.' });
  }

  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    const body = await readBody(req);
    const { action = 'generate_plan', input, context = {} } = body || {};

    // Lightweight operational health check endpoint
    if (action === 'health') {
      const signal = AITelemetry ? AITelemetry.getHealthSignal() : {};
      const configuredModel = AIConfig.resolveGeminiModel();
      return send(res, 200, {
        ok: true,
        configuredModel,
        hasApiKey: !!process.env.GEMINI_API_KEY,
        telemetry: signal
      });
    }

    if (!input) {
      return send(res, 400, { ok: false, error: 'Thiếu nội dung yêu cầu.' });
    }

    // Resolve unified planning context via Clock (avoids half-injected date/time bugs)
    const planningTime = Clock.getPlanningContext({
      currentDate: typeof context.currentDate === 'string' ? context.currentDate : undefined,
      currentTime: typeof context.currentTime === 'string' ? context.currentTime : undefined
    });

    // Ensure context is sanitized: whitelist only schedule-relevant attributes
    const sanitizedContext = {
      currentInstant: planningTime.currentInstant,
      currentDate: planningTime.currentDate,
      currentTime: planningTime.currentTime,
      timezone: 'Asia/Ho_Chi_Minh',
      availability: context.availability || { start: '15:00', end: '21:30' },
      fixedEvents: Array.isArray(context.fixedEvents) ? context.fixedEvents.map(e => ({
        id: e.id,
        title: String(e.title || '').slice(0, 120),
        date: e.date,
        start: e.start,
        end: e.end,
        fixed: true
      })) : [],
      scheduledTasks: Array.isArray(context.scheduledTasks) ? context.scheduledTasks.map(t => ({
        id: t.id,
        title: String(t.title || '').slice(0, 120),
        durationMinutes: t.durationMinutes || 30,
        scheduledDate: t.scheduledDate,
        startTime: t.startTime,
        endTime: t.endTime,
        priority: t.priority
      })) : [],
      inboxItems: Array.isArray(context.inboxItems) ? context.inboxItems.map(i => ({
        id: i.id,
        title: String(i.title || '').slice(0, 120),
        durationMinutes: i.durationMinutes || 30,
        priority: i.priority
      })) : []
    };

    const apiKey = process.env.GEMINI_API_KEY;
    const configuredModel = AIConfig.resolveGeminiModel();
    const modelValidation = AIConfig.validateGeminiModel(configuredModel);
    if (!modelValidation.valid) {
      console.warn(`[API /api/ai] Model validation warning: ${modelValidation.error}`);
    }

    if (!apiKey) {
      // 503 Service Unavailable — server is not configured to handle live Gemini AI requests
      // Check if caller can take deterministic fallback directly
      if (action === 'ask_assistant') {
        const fallback = new DeterministicFallbackProvider();
        const fallbackResult = await fallback.parseAssistantIntent(input, sanitizedContext);
        return send(res, 200, {
          ok: true,
          source: 'deterministic',
          provider: 'deterministic',
          fallbackReason: AIConfig.AI_ERROR_TYPES.PROVIDER_UNAVAILABLE,
          intent: fallbackResult ? fallbackResult.intent : null
        });
      }

      return send(res, 503, {
        ok: false,
        status: 'NOT_CONFIGURED',
        errorType: AIConfig.AI_ERROR_TYPES.PROVIDER_UNAVAILABLE,
        message: 'Máy chủ chưa cấu hình GEMINI_API_KEY.'
      });
    }

    const provider = new GeminiServerProvider({
      apiKey,
      model: configuredModel,
      timeoutMs: AIConfig.AI_TIMEOUT_MS
    });

    const fallback = new DeterministicFallbackProvider();

    if (action === 'parse_intent') {
      const result = await provider.parseIntent(input, sanitizedContext);
      if (result.status === 'SUCCESS') {
        return send(res, 200, { ok: true, source: 'ai', provider: 'gemini', model: configuredModel, intent: result.intent });
      }
      // Fall back to deterministic intent parser
      const fallbackResult = await fallback.parseIntent(input, sanitizedContext);
      return send(res, 200, {
        ok: true,
        source: 'deterministic',
        provider: 'deterministic',
        fallbackReason: result.errorType || result.status,
        intent: fallbackResult.intent
      });
    }

    if (action === 'generate_plan') {
      const result = await provider.generatePlan(input, sanitizedContext);
      if (result.status === 'SUCCESS') {
        return send(res, 200, { ok: true, source: 'ai', provider: 'gemini', model: configuredModel, proposal: result.proposal });
      }
      // Fall back to deterministic plan scheduler
      const fallbackResult = await fallback.generatePlan(input, sanitizedContext);
      return send(res, 200, {
        ok: true,
        source: 'deterministic',
        provider: 'deterministic',
        fallbackReason: result.errorType || result.status,
        proposal: fallbackResult.proposal
      });
    }

    if (action === 'ask_assistant') {
      let result = null;
      if (provider && typeof provider.parseAssistantIntent === 'function') {
        try {
          result = await provider.parseAssistantIntent(input, sanitizedContext);
        } catch (e) {
          result = { status: 'ERROR', errorType: AIConfig.AI_ERROR_TYPES.PROVIDER_UNAVAILABLE, error: e.message };
        }
      }
      if (result && result.status === 'SUCCESS') {
        return send(res, 200, { ok: true, source: 'ai', provider: 'gemini', model: configuredModel, intent: result.intent });
      }
      // Fall back to deterministic intent parser
      const fallbackResult = await fallback.parseAssistantIntent(input, sanitizedContext);
      return send(res, 200, {
        ok: true,
        source: 'deterministic',
        provider: 'deterministic',
        fallbackReason: (result && (result.errorType || result.status)) || AIConfig.AI_ERROR_TYPES.PROVIDER_UNAVAILABLE,
        intent: fallbackResult ? fallbackResult.intent : null
      });
    }

    if (action === 'fix_day' || action === 'reschedule' || action === 'resolve_conflict') {
      const proposal = generateReschedulePlan(sanitizedContext, {
        currentDate: sanitizedContext.currentDate,
        currentTime: sanitizedContext.currentTime
      });
      return send(res, 200, {
        ok: true,
        source: 'deterministic',
        provider: 'reschedule_engine',
        proposal
      });
    }

    return send(res, 400, { ok: false, error: 'Hành động không hợp lệ.' });
  } catch (error) {
    console.error('API /api/ai failed:', error);
    return send(res, 500, { ok: false, error: error.message || 'Lỗi xử lý AI.' });
  }
};
