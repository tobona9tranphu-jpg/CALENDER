'use strict';

/**
 * Shared HTTP helpers for Vercel serverless handlers.
 *
 * CORS policy
 * ───────────
 * The frontend and API are same-origin on Vercel (calender-jsf2.vercel.app).
 * Locally, the Express server serves both on the same port (same-origin too).
 *
 * We DO NOT set Access-Control-Allow-Origin: * because:
 *  (a) the client uses credentials: 'include' — wildcard is invalid in that case
 *  (b) same-origin requests don't need CORS headers at all
 *
 * If a cross-origin client is ever needed, configure an explicit allowed origin
 * here rather than using the wildcard.
 */

async function readBody(req, maxBytes = 1024 * 1024) { // Default 1MB
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > maxBytes) {
      const err = new Error('Payload Too Large');
      err.statusCode = 413;
      throw err;
    }
    return JSON.parse(req.body || '{}');
  }
  let raw = '';
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error('Payload Too Large');
      err.statusCode = 413;
      throw err;
    }
    raw += chunk;
  }
  return JSON.parse(raw || '{}');
}

/**
 * Send a JSON response.
 *
 * @param {object} res       Node/Vercel response object
 * @param {number} status    HTTP status code
 * @param {object} data      JSON-serialisable response body
 * @param {object} [opts]
 * @param {string} [opts.setCookie]  Value for a Set-Cookie header (use auth helpers)
 */
function send(res, status, data, opts = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // Set-Cookie must be set before res.end()
  if (opts.setCookie) {
    res.setHeader('Set-Cookie', opts.setCookie);
  }

  res.end(JSON.stringify(data));
}

/**
 * Handle CORS preflight (OPTIONS) requests.
 * Returns true if the request was a preflight and has been handled.
 */
function preflight(req, res) {
  if (req.method !== 'OPTIONS') return false;
  // Reflect sensible preflight response — no wildcard origin
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end('');
  return true;
}

module.exports = { readBody, send, preflight };
