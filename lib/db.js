'use strict';

const { Pool } = require('pg');

/**
 * Builds pg.Pool configuration.
 *
 * Supabase IPv4 compatibility note:
 * Direct connection hosts (db.<ref>.supabase.co:5432) have only IPv6 AAAA records.
 * Serverless environments (like AWS Lambda on Vercel) and some local dev setups
 * without IPv6 egress cannot resolve or reach IPv6-only addresses.
 *
 * This helper detects direct Supabase hosts and routes through the Supabase connection pooler
 * with explicit user ('postgres.<ref>') on port 6543, which has reliable IPv4 support.
 */
function buildPoolConfig(rawUrl) {
  if (!rawUrl) return {};
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname;
    const match = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
    if (match) {
      const projectRef = match[1];
      return {
        host: 'aws-0-ap-southeast-1.pooler.supabase.com',
        port: 6543,
        user: `postgres.${projectRef}`,
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname ? parsed.pathname.replace(/^\//, '') : 'postgres',
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      };
    }
    return {
      connectionString: rawUrl,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  } catch {
    return { connectionString: rawUrl, ssl: { rejectUnauthorized: false } };
  }
}

const pool = new Pool(buildPoolConfig(process.env.DATABASE_URL));

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction, buildPoolConfig };
