'use strict';

/**
 * Model Health Check Script
 * Reads configured model from src/config/ai.js and process.env.
 * If GEMINI_API_KEY is present, issues a lightweight ping (countTokens or minimal generation)
 * to verify model availability without leaking credentials.
 */

const https = require('https');
const { resolveGeminiModel, validateGeminiModel, DEFAULT_GEMINI_MODEL } = require('../src/config/ai');

async function main() {
  const model = resolveGeminiModel();
  const validation = validateGeminiModel(model);

  console.log(`[ModelCheck] Configured Model: ${model}`);

  if (!validation.valid) {
    console.error(`[ModelCheck] Configuration Error: ${validation.error}`);
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[ModelCheck] Status: NOT_CONFIGURED (GEMINI_API_KEY is not set in environment). Deterministic fallback will be active.');
    // Exit 0 so local builds / deployments without keys do not fail
    process.exit(0);
  }

  console.log(`[ModelCheck] API Key detected (length: ${apiKey.length}). Validating model endpoint...`);

  // Lightweight request to Gemini REST API endpoint: countTokens
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:countTokens?key=${apiKey}`;

  const postData = JSON.stringify({
    contents: [{ parts: [{ text: 'ping' }] }]
  });

  const parsedUrl = new URL(url);
  const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    },
    timeout: 10000
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log(`[ModelCheck] Model ${model} is ONLINE and HEALTHY (HTTP 200).`);
        process.exit(0);
      } else {
        console.error(`[ModelCheck] Model check FAILED with HTTP ${res.statusCode}.`);
        try {
          const errObj = JSON.parse(data);
          console.error(`[ModelCheck] Error Details: ${errObj.error && errObj.error.message ? errObj.error.message : data}`);
        } catch (e) {
          console.error(`[ModelCheck] Error Response: ${data}`);
        }
        process.exit(1);
      }
    });
  });

  req.on('timeout', () => {
    req.destroy();
    console.error('[ModelCheck] Model check TIMED OUT after 10s.');
    process.exit(1);
  });

  req.on('error', (err) => {
    console.error(`[ModelCheck] Network error while contacting Gemini API: ${err.message}`);
    process.exit(1);
  });

  req.write(postData);
  req.end();
}

main().catch(err => {
  console.error('[ModelCheck] Unexpected failure:', err);
  process.exit(1);
});
