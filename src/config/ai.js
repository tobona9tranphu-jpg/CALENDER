'use strict';

/**
 * AI Configuration & Standards
 * Single source of truth for Gemini model name, allowed models,
 * error codes, timeouts, and bounded retry configuration.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AIConfig = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {

  const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

  const ALLOWED_GEMINI_MODELS = [
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-2.0-pro',
    'gemini-3.6-flash' // legacy alias
  ];

  const AI_ERROR_TYPES = {
    PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
    TIMEOUT: 'AI_TIMEOUT',
    RATE_LIMIT: 'AI_RATE_LIMIT',
    MODEL_NOT_FOUND: 'AI_MODEL_NOT_FOUND',
    INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
    SCHEMA_ERROR: 'AI_SCHEMA_ERROR'
  };

  const AI_TIMEOUT_MS = 14000;

  const RETRY_CONFIG = {
    MAX_RETRIES: 2,
    INITIAL_DELAY_MS: 500,
    MAX_DELAY_MS: 2000,
    RETRYABLE_STATUS_CODES: [429, 503]
  };

  /**
   * Resolves configured Gemini model name from environment or argument.
   * @param {string} [candidate]
   * @returns {string}
   */
  function resolveGeminiModel(candidate) {
    const raw = candidate || (typeof process !== 'undefined' && process.env && process.env.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;
    return typeof raw === 'string' ? raw.trim() : DEFAULT_GEMINI_MODEL;
  }

  /**
   * Validates whether a model identifier is well-formed.
   * @param {string} model
   * @returns {{ valid: boolean, error?: string }}
   */
  function validateGeminiModel(model) {
    if (!model || typeof model !== 'string') {
      return { valid: false, error: 'Model name must be a non-empty string' };
    }
    const trimmed = model.trim();
    if (!trimmed.startsWith('gemini-')) {
      return { valid: false, error: `Invalid model format: "${trimmed}". Must start with "gemini-"` };
    }
    return { valid: true, model: trimmed };
  }

  return {
    DEFAULT_GEMINI_MODEL,
    ALLOWED_GEMINI_MODELS,
    AI_ERROR_TYPES,
    AI_TIMEOUT_MS,
    RETRY_CONFIG,
    resolveGeminiModel,
    validateGeminiModel
  };
}));
