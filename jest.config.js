/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // Ensure dotenv is loaded before any test
  globalSetup: '<rootDir>/tests/globalSetup.js',
};
