'use strict';

/**
 * Centralised Express error handler.
 *
 * Placed last in the middleware chain (four-argument signature).
 *
 * Security rules:
 *  - Never log tokens or passwords (scrub authorization headers from logs).
 *  - Stack traces only appear in development.
 *  - Production errors show a safe generic message.
 */
function errorHandler(err, req, res, _next) {
  const isProd = process.env.NODE_ENV === 'production';

  // Determine status code
  const status = err.status || err.statusCode || 500;

  // Scrub sensitive data from log context
  const safeHeaders = { ...req.headers };
  delete safeHeaders['authorization'];
  delete safeHeaders['cookie'];

  // Log server errors (≥500) with context, never log 4xx as errors
  if (status >= 500) {
    console.error('[error]', {
      method: req.method,
      path: req.path,
      status,
      message: err.message,
      stack: isProd ? undefined : err.stack,
    });
  }

  // Handle malformed JSON body (SyntaxError from express.json)
  if (err instanceof SyntaxError && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ (JSON parse error).' });
  }

  // Safe response — never leak internals in production
  const message = isProd && status >= 500
    ? 'Đã xảy ra lỗi. Vui lòng thử lại.'
    : err.message || 'Đã xảy ra lỗi.';

  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
