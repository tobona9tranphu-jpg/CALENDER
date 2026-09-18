'use strict';

const AIConfig = require('../src/config/ai');

describe('AI Configuration & Model Synchronization (src/config/ai.js)', () => {
  test('exports DEFAULT_GEMINI_MODEL as gemini-3.5-flash', () => {
    expect(AIConfig.DEFAULT_GEMINI_MODEL).toBe('gemini-3.5-flash');
  });

  test('ALLOWED_GEMINI_MODELS includes supported production models and excludes shutdown models', () => {
    expect(AIConfig.ALLOWED_GEMINI_MODELS).toContain('gemini-3.5-flash');
    expect(AIConfig.ALLOWED_GEMINI_MODELS).toContain('gemini-3.5-flash-lite');
    expect(AIConfig.ALLOWED_GEMINI_MODELS).not.toContain('gemini-2.0-flash');
    expect(AIConfig.ALLOWED_GEMINI_MODELS).not.toContain('gemini-1.5-flash');
  });

  test('validateGeminiModel correctly validates well-formed model names and rejects shutdown models', () => {
    expect(AIConfig.validateGeminiModel('gemini-3.5-flash').valid).toBe(true);
    expect(AIConfig.validateGeminiModel('gemini-3.5-flash-lite').valid).toBe(true);

    // Shutdown models must be rejected with AI_MODEL_NOT_FOUND
    const shutdownRes = AIConfig.validateGeminiModel('gemini-2.0-flash');
    expect(shutdownRes.valid).toBe(false);
    expect(shutdownRes.code).toBe(AIConfig.AI_ERROR_TYPES.MODEL_NOT_FOUND);
    expect(shutdownRes.error).toMatch(/shut down/i);

    const shutdownRes15 = AIConfig.validateGeminiModel('gemini-1.5-pro');
    expect(shutdownRes15.valid).toBe(false);
    expect(shutdownRes15.code).toBe(AIConfig.AI_ERROR_TYPES.MODEL_NOT_FOUND);

    expect(AIConfig.validateGeminiModel('gpt-4o').valid).toBe(false);
    expect(AIConfig.validateGeminiModel('').valid).toBe(false);
    expect(AIConfig.validateGeminiModel(null).valid).toBe(false);
  });

  test('resolveGeminiModel resolves default when no override', () => {
    const originalEnv = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL;

    expect(AIConfig.resolveGeminiModel()).toBe('gemini-3.5-flash');

    process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';
    expect(AIConfig.resolveGeminiModel()).toBe('gemini-3.5-flash-lite');

    if (originalEnv) {
      process.env.GEMINI_MODEL = originalEnv;
    } else {
      delete process.env.GEMINI_MODEL;
    }
  });

  test('defines standardized typed error codes', () => {
    expect(AIConfig.AI_ERROR_TYPES).toEqual({
      PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
      TIMEOUT: 'AI_TIMEOUT',
      RATE_LIMIT: 'AI_RATE_LIMIT',
      MODEL_NOT_FOUND: 'AI_MODEL_NOT_FOUND',
      INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
      SCHEMA_ERROR: 'AI_SCHEMA_ERROR'
    });
  });

  test('defines bounded retry config (max 2 retries)', () => {
    expect(AIConfig.RETRY_CONFIG.MAX_RETRIES).toBe(2);
    expect(AIConfig.RETRY_CONFIG.RETRYABLE_STATUS_CODES).toEqual([429, 503]);
    expect(AIConfig.RETRY_CONFIG.INITIAL_DELAY_MS).toBeGreaterThanOrEqual(500);
  });
});
