'use strict';

const { send, readBody, preflight } = require('../lib/http');
const { getUserId } = require('../lib/auth');
const { GeminiServerProvider, DeterministicFallbackProvider } = require('../src/ai/ai-provider');
const { generateReschedulePlan } = require('../src/ai/reschedule-engine');
const AppDate = require('../src/utils/date');

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

    if (!input) {
      return send(res, 400, { ok: false, error: 'Thiếu nội dung yêu cầu.' });
    }

    // Resolve current date: prefer valid client-supplied date, then server-side Vietnam time
    const clientDate = typeof context.currentDate === 'string' ? context.currentDate : null;
    const isValidDate = clientDate && /^\d{4}-\d{2}-\d{2}$/.test(clientDate);
    const resolvedDate = isValidDate ? clientDate : (AppDate && AppDate.getTodayAppDate ? AppDate.getTodayAppDate() : new Date().toISOString().slice(0, 10));

    // Ensure context is sanitized: whitelist only schedule-relevant attributes
    const sanitizedContext = {
      currentDate: resolvedDate,
      currentTime: typeof context.currentTime === 'string' ? context.currentTime : null,
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
    if (!apiKey) {
      // 503 Service Unavailable — server is not configured to handle AI requests
      return send(res, 503, {
        ok: false,
        status: 'NOT_CONFIGURED',
        message: 'Máy chủ chưa cấu hình GEMINI_API_KEY.'
      });
    }

    const provider = new GeminiServerProvider({
      apiKey,
      model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      timeoutMs: 14000
    });

    const fallback = new DeterministicFallbackProvider();

    if (action === 'parse_intent') {
      const result = await provider.parseIntent(input, sanitizedContext);
      if (result.status === 'SUCCESS') {
        return send(res, 200, { ok: true, source: 'ai', intent: result.intent });
      }
      // Fall back to deterministic intent parser
      const fallbackResult = await fallback.parseIntent(input, sanitizedContext);
      return send(res, 200, {
        ok: true,
        source: 'deterministic',
        fallbackReason: result.status,
        intent: fallbackResult.intent
      });
    }

    if (action === 'generate_plan') {
      const result = await provider.generatePlan(input, sanitizedContext);
      if (result.status === 'SUCCESS') {
        return send(res, 200, { ok: true, source: 'ai', proposal: result.proposal });
      }
      // Fall back to deterministic plan scheduler
      const fallbackResult = await fallback.generatePlan(input, sanitizedContext);
      return send(res, 200, {
        ok: true,
        source: 'deterministic',
        fallbackReason: result.status,
        proposal: fallbackResult.proposal
      });
    }

    if (action === 'ask_assistant') {
      let result = null;
      if (provider && typeof provider.parseAssistantIntent === 'function') {
        try {
          result = await provider.parseAssistantIntent(input, sanitizedContext);
        } catch (e) {
          result = { status: 'ERROR', error: e.message };
        }
      }
      if (result && result.status === 'SUCCESS') {
        return send(res, 200, { ok: true, source: 'ai', intent: result.intent });
      }
      // Fall back to deterministic intent parser
      const fallbackResult = await fallback.parseAssistantIntent(input, sanitizedContext);
      return send(res, 200, {
        ok: true,
        source: 'deterministic',
        fallbackReason: result ? result.status : 'FALLBACK',
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
        source: 'smart_engine',
        proposal
      });
    }

    return send(res, 400, { ok: false, error: 'Hành động không hợp lệ.' });
  } catch (error) {
    console.error('API /api/ai failed:', error);
    return send(res, 500, { ok: false, error: error.message || 'Lỗi xử lý AI.' });
  }
};
