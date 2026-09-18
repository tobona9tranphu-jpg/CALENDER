'use strict';

/**
 * @file ai-provider-fallback.test.js
 * Comprehensive tests for AI Provider Fallback, Observability, Bounded Retry & Telemetry.
 */

const {
  GeminiServerProvider,
  DeterministicFallbackProvider,
  ClientAIAdapter,
  AITelemetry
} = require('../src/ai/ai-provider');
const AIConfig = require('../src/config/ai');

describe('AI Provider Fallback & Observability Suite', () => {
  beforeEach(() => {
    AITelemetry.reset();
  });

  describe('1. Distinguishable Source Metadata', () => {
    test('deterministic fallback returns source: "deterministic" and provider metadata', async () => {
      const fallback = new DeterministicFallbackProvider();
      const res = await fallback.parseAssistantIntent('Lên lịch học Toán 45p');

      expect(res.status).toBe('SUCCESS');
      expect(res.source).toBe('deterministic');
      expect(res.intent).toBeDefined();
      expect(res.intent.intent).toBe('plan');
    });

    test('GeminiServerProvider returns typed NOT_CONFIGURED when API key is missing', async () => {
      const gemini = new GeminiServerProvider({ apiKey: null });
      const res = await gemini.parseAssistantIntent('Tìm giờ rảnh');

      expect(res.status).toBe('NOT_CONFIGURED');
      expect(res.errorType).toBe(AIConfig.AI_ERROR_TYPES.PROVIDER_UNAVAILABLE);
      expect(res.error).toContain('chưa cấu hình');
    });
  });

  describe('2. ClientAIAdapter Fallback & Telemetry', () => {
    test('falls back cleanly with fallbackReason when upstream server is unavailable', async () => {
      // Point adapter to unreachable endpoint to simulate network / server down
      const adapter = new ClientAIAdapter({ apiEndpoint: 'http://127.0.0.1:59999/api/ai', timeoutMs: 1000 });
      const res = await adapter.parseAssistantIntent('Lên lịch học Sử');

      expect(res.status).toBe('SUCCESS');
      expect(res.source).toBe('deterministic');
      expect(res.provider).toBe('deterministic');
      expect(res.fallbackReason).toBe('AI_PROVIDER_UNAVAILABLE');
      expect(res.intent).toBeDefined();

      // Check telemetry
      const signal = AITelemetry.getHealthSignal();
      expect(signal.aiRequests).toBe(1);
      expect(signal.aiFallback).toBe(1);
      expect(signal.aiSuccess).toBe(0);
      expect(signal.aiAvailabilityRate).toBe(0);
    });

    test('records telemetry correctly on simulated successful AI response', () => {
      AITelemetry.record({ source: 'ai', provider: 'gemini', intent: 'plan' });
      AITelemetry.record({ source: 'deterministic', provider: 'deterministic', failureReason: 'AI_TIMEOUT', intent: 'fix_day' });

      const signal = AITelemetry.getHealthSignal();
      expect(signal.aiRequests).toBe(2);
      expect(signal.aiSuccess).toBe(1);
      expect(signal.aiFallback).toBe(1);
      expect(signal.aiAvailabilityRate).toBe(50.0);

      const events = AITelemetry.getRecentEvents();
      expect(events.length).toBe(2);
      expect(events[0].source).toBe('ai');
      expect(events[1].failureReason).toBe('AI_TIMEOUT');
    });
  });

  describe('3. Bounded Retry Behavior on 503 / 429', () => {
    test('GeminiServerProvider defines bounded retry configuration', () => {
      expect(AIConfig.RETRY_CONFIG.MAX_RETRIES).toBe(2);
      expect(AIConfig.RETRY_CONFIG.RETRYABLE_STATUS_CODES).toContain(503);
      expect(AIConfig.RETRY_CONFIG.RETRYABLE_STATUS_CODES).toContain(429);
    });
  });
});
