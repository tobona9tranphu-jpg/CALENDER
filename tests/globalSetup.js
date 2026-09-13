'use strict';

/**
 * Jest global setup — runs once before any test suite.
 *
 * Loads .env.local so that JWT_SECRET and DATABASE_URL are available.
 * Tests that exercise database routes are skipped automatically when
 * DATABASE_URL is absent (CI without DB access).
 */
module.exports = async function globalSetup() {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
  // Ensure we're always in test mode
  process.env.NODE_ENV = 'test';
};
