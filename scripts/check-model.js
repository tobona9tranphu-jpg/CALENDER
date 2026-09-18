'use strict';

/**
 * Model Health Check Script
 * Reads configured model from src/config/ai.js and process.env.
 * If GEMINI_API_KEY is present, issues a lightweight ping (countTokens or minimal generation)
 * to verify model availability without leaking credentials.
 */

const https = require('https');
const path = require('path');
const fs = require('fs');

// Load environment variables if available
const envLocalPath = path.join(__dirname, '../.env.local');
const envPath = path.join(__dirname, '../.env');

if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const { resolveGeminiModel, validateGeminiModel, DEFAULT_GEMINI_MODEL } = require('../src/config/ai');

async function main() {
  const model = resolveGeminiModel();
  const validation = validateGeminiModel(model);

  console.log(`[ModelCheck] Configured Model: ${model}`);

  if (!validation.valid) {
    console.error(`[ModelCheck] FAIL: Model ${model} is unsupported or shut down: ${validation.error}`);
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[ModelCheck] NOT_CONFIGURED: GEMINI_API_KEY is not set');
    process.exit(0);
  }

  console.log(`[ModelCheck] API Key detected (length: ${apiKey.length}). Validating endpoint...`);

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
        console.log(`[ModelCheck] PASS: Model ${model} is ONLINE and HEALTHY`);
        process.exit(0);
      }

      let errorMsg = `HTTP ${res.statusCode}`;
      try {
        const errObj = JSON.parse(data);
        if (errObj.error && errObj.error.message) {
          errorMsg = errObj.error.message;
        }
      } catch (_) {}

      if (res.statusCode === 404 || res.statusCode === 400) {
        console.error(`[ModelCheck] FAIL: Model ${model} is unsupported or shut down: ${errorMsg}`);
        process.exit(1);
      } else if (res.statusCode === 429 || res.statusCode === 503 || res.statusCode >= 500) {
        console.error(`[ModelCheck] PROVIDER_UNAVAILABLE: Gemini service returned ${res.statusCode} (${errorMsg})`);
        process.exit(1);
      } else {
        console.error(`[ModelCheck] FAIL: Model check failed with HTTP ${res.statusCode}: ${errorMsg}`);
        process.exit(1);
      }
    });
  });

  req.on('timeout', () => {
    req.destroy();
    console.error('[ModelCheck] PROVIDER_UNAVAILABLE: Model check timed out after 10s');
    process.exit(1);
  });

  req.on('error', (err) => {
    console.error(`[ModelCheck] PROVIDER_UNAVAILABLE: Network error contacting Gemini API (${err.message})`);
    process.exit(1);
  });

  req.write(postData);
  req.end();
}

main().catch(err => {
  console.error('[ModelCheck] Unexpected failure:', err);
  process.exit(1);
});
