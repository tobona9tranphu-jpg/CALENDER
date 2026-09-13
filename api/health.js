'use strict';

const { send } = require('../lib/http');

/**
 * GET /api/health
 *
 * Minimal liveness probe. Does not expose any internal details.
 * Vercel serverless function.
 */
module.exports = async function handler(req, res) {
  return send(res, 200, { ok: true });
};
