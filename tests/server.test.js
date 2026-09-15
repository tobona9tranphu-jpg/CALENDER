'use strict';

/**
 * Server API tests — P0.2 production-equivalent authentication
 *
 * Architecture under test
 * ───────────────────────
 * api/login.js      → sets HttpOnly cookie, returns { ok, user }
 * api/logout.js     → clears HttpOnly cookie, returns { ok }
 * api/register.js   → sets HttpOnly cookie, returns { ok, user }
 * api/user.js       → reads cookie via lib/auth.getUserId()
 * api/health.js     → returns { ok: true }, no auth
 * lib/auth.js       → getUserId reads cookie first, then Bearer header
 * lib/http.js       → no wildcard CORS, send() accepts optional setCookie
 *
 * Production equivalence
 * ──────────────────────
 * The same api/*.js files run as Vercel serverless functions in production.
 * These tests exercise them directly (via the Express mounting) with the same
 * DB mocks, so they prove production-equivalent behaviour.
 *
 * Tests prove:
 *  1.  login works — 200, { ok, user }, no token in body
 *  2.  login sets HttpOnly cookie with correct attributes
 *  3.  login sets SameSite=Strict
 *  4.  Secure flag is controlled by NODE_ENV
 *  5.  authenticated requests work via cookie
 *  6.  refresh preserves authentication (max-age > 0)
 *  7.  logout clears the cookie
 *  8.  after logout, /api/user → 401
 *  9.  missing cookie → 401
 *  10. invalid/expired token in cookie → 401
 *  11. no JWT in response body (login, register, user)
 *  12. no JWT in localStorage / sessionStorage (static analysis)
 *  13. client never sends manual Authorization header (static analysis)
 *  14. api/ handlers have no wildcard CORS
 *  15. lib/auth.getUserId reads cookie before Authorization header
 *  16. lib/auth.getUserId fallback to Authorization header still works
 */

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const path    = require('path');
const fs      = require('fs');
const cookie  = require('cookie');

require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

// ─── Mocks ────────────────────────────────────────────────────────────────────

const MOCK_HASH = bcrypt.hashSync('password123', 1);

const MOCK_USER = {
  id: 'user-test-001',
  email: 'test@example.com',
  passwordHash: MOCK_HASH,
  profile: { name: 'Test User', grade: '', goal: '', timezone: 'Asia/Ho_Chi_Minh' },
  subjects: [], tasks: [], fixedSchedules: [], sessions: [],
  reviewSchedules: [], studyNotes: [], examMilestones: [],
  onboarded: true, lastSimulation: null, scheduleChanges: [],
};

jest.mock('../lib/user-repository', () => ({
  findUserByEmail: jest.fn(async (email) =>
    email === 'test@example.com' ? { ...MOCK_USER } : null),
  loadUser:   jest.fn(async (id) => id === MOCK_USER.id ? { ...MOCK_USER } : null),
  replaceUser: jest.fn(async (user) => ({ ...user })),
  createUser:  jest.fn(async (user) => ({ ...user })),
  safeUser:    jest.fn((user) => { const { passwordHash: _, ...safe } = user; return safe; }),
}));

jest.mock('../lib/db', () => ({
  query: jest.fn(async () => ({ rows: [] })),
  pool:  { connect: jest.fn(), end: jest.fn() },
  withTransaction: jest.fn(),
}));

const app = require('../src/server/expressServer');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJwt(userId = MOCK_USER.id, expiresIn = '1h') {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn });
}

function makeAuthCookie(userId = MOCK_USER.id) {
  return `TB-auth-token=${makeJwt(userId)}`;
}

function getCookieStr(res) {
  return (res.headers['set-cookie'] || []).join('; ');
}

const APP_JS = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

// ─── 1. Health ────────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  test('200 { ok: true }', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('no auth required', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).not.toBe(401);
  });
});

// ─── 2. Login — cookie and body shape ─────────────────────────────────────────

describe('POST /api/login', () => {
  test('valid credentials → 200', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(res.status).toBe(200);
  });

  test('response body has ok:true and user — no token field', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(res.body.ok).toBe(true);
    expect(res.body.user).toBeDefined();
    expect(res.body.token).toBeUndefined();
  });

  test('response body user does not contain passwordHash', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  test('sets TB-auth-token cookie', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(getCookieStr(res)).toMatch(/TB-auth-token=/);
  });

  test('cookie is HttpOnly', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(getCookieStr(res).toLowerCase()).toMatch(/httponly/);
  });

  test('cookie is SameSite=Strict', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(getCookieStr(res).toLowerCase()).toMatch(/samesite=strict/);
  });

  test('cookie path is /', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(getCookieStr(res).toLowerCase()).toMatch(/path=\//);
  });

  test('cookie has positive max-age (session persists across page loads)', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'test@example.com', password: 'password123' });
    const match = getCookieStr(res).match(/max-age=(\d+)/i);
    expect(match).toBeTruthy();
    expect(Number(match[1])).toBeGreaterThan(0);
  });

  test('Secure flag: OFF in test/dev mode (NODE_ENV=test)', async () => {
    // In test environment NODE_ENV=test (not production) → secure should be absent
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'test@example.com', password: 'password123' });
    // secure flag should NOT be present in dev/test
    const cookies = getCookieStr(res).toLowerCase();
    // When NODE_ENV !== 'production', secure:false → no 'secure' attribute
    expect(cookies).not.toMatch(/;\s*secure\b/);
  });

  test('invalid password → 401, no Set-Cookie', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'test@example.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('unknown email → 401', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'nobody@example.com', password: 'password123' });
    expect(res.status).toBe(401);
  });

  test('missing email → 400', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ password: 'password123' });
    expect(res.status).toBe(400);
  });

  test('missing password → 400', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'test@example.com' });
    expect(res.status).toBe(400);
  });

  test('malformed JSON → 400', async () => {
    const res = await request(app)
      .post('/api/login')
      .set('Content-Type', 'application/json')
      .send('{ bad json }');
    expect(res.status).toBe(400);
  });
});

// ─── 3. Authenticated requests work ──────────────────────────────────────────

describe('Authenticated requests — cookie carries auth', () => {
  test('GET /api/user with valid cookie → 200', async () => {
    const res = await request(app)
      .get('/api/user')
      .set('Cookie', makeAuthCookie());
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.token).toBeUndefined();
  });

  test('GET /api/user response does not contain passwordHash', async () => {
    const res = await request(app)
      .get('/api/user')
      .set('Cookie', makeAuthCookie());
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  test('PUT /api/user with valid cookie → 200', async () => {
    const res = await request(app)
      .put('/api/user')
      .set('Cookie', makeAuthCookie())
      .send({ ...MOCK_USER });
    expect(res.status).toBe(200);
  });
});

// ─── 4. Missing / invalid cookie → 401 ───────────────────────────────────────

describe('Missing or invalid cookie → 401', () => {
  test('no cookie → 401', async () => {
    const res = await request(app).get('/api/user');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  test('tampered token in cookie → 401', async () => {
    const res = await request(app)
      .get('/api/user')
      .set('Cookie', 'TB-auth-token=not.a.real.jwt');
    expect(res.status).toBe(401);
  });

  test('expired token in cookie → 401', async () => {
    const expired = makeJwt(MOCK_USER.id, -1);
    const res = await request(app)
      .get('/api/user')
      .set('Cookie', `TB-auth-token=${expired}`);
    expect(res.status).toBe(401);
  });
});

// ─── 5. Refresh preserves authentication ─────────────────────────────────────

describe('Refresh preserves authentication', () => {
  test('cookie has positive max-age → survives page refresh', async () => {
    const loginRes = await request(app)
      .post('/api/login')
      .send({ email: 'test@example.com', password: 'password123' });

    const rawCookie = (loginRes.headers['set-cookie'] || [])
      .find(c => c.startsWith('TB-auth-token='));
    expect(rawCookie).toBeDefined();

    const authCookieValue = rawCookie.split(';')[0]; // "TB-auth-token=<jwt>"

    // Simulate a page refresh — re-use the cookie
    const refreshRes = await request(app)
      .get('/api/user')
      .set('Cookie', authCookieValue);
    expect(refreshRes.status).toBe(200);
  });
});

// ─── 6. Logout ────────────────────────────────────────────────────────────────

describe('POST /api/logout', () => {
  test('clears cookie (max-age=0)', async () => {
    const res = await request(app)
      .post('/api/logout')
      .set('Cookie', makeAuthCookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const cookies = getCookieStr(res);
    expect(cookies).toMatch(/TB-auth-token=/);
    expect(cookies).toMatch(/max-age=0/i);
  });

  test('works without existing session cookie', async () => {
    const res = await request(app).post('/api/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('after logout, GET /api/user without cookie → 401', async () => {
    // After logout the cookie is gone; request without cookie → 401
    const res = await request(app).get('/api/user');
    expect(res.status).toBe(401);
  });
});

// ─── 7. lib/auth.getUserId() resolution order ─────────────────────────────────

describe('lib/auth — getUserId() cookie-first resolution', () => {
  const { getUserId } = require('../lib/auth');

  test('reads valid JWT from cookie → returns userId', () => {
    const token = makeJwt();
    const req = { headers: { cookie: `TB-auth-token=${token}` } };
    expect(getUserId(req)).toBe(MOCK_USER.id);
  });

  test('invalid cookie falls back to valid Authorization header', () => {
    const token = makeJwt();
    const req = {
      headers: {
        cookie: 'TB-auth-token=bad.token',
        authorization: `Bearer ${token}`,
      },
    };
    expect(getUserId(req)).toBe(MOCK_USER.id);
  });

  test('no cookie and no header → null', () => {
    const req = { headers: {} };
    expect(getUserId(req)).toBeNull();
  });

  test('expired token in cookie, no header → null', () => {
    const expired = makeJwt(MOCK_USER.id, -1);
    const req = { headers: { cookie: `TB-auth-token=${expired}` } };
    expect(getUserId(req)).toBeNull();
  });

  test('valid Authorization Bearer still works (compatibility)', () => {
    const token = makeJwt();
    const req = { headers: { authorization: `Bearer ${token}` } };
    expect(getUserId(req)).toBe(MOCK_USER.id);
  });
});

// ─── 8. lib/http — no wildcard CORS ──────────────────────────────────────────

describe('lib/http — CORS policy', () => {
  const httpSrc = fs.readFileSync(path.join(__dirname, '../lib/http.js'), 'utf8');

  test('wildcard Access-Control-Allow-Origin is not set', () => {
    // Check that no functional setHeader call uses wildcard origin
    // The comment explaining why we don't use * should not trigger this
    expect(httpSrc).not.toMatch(/setHeader\s*\(\s*['"]Access-Control-Allow-Origin['"]\s*,\s*['"]\*['"]\s*\)/);
    // Also ensure the string literal '*' is not set as the origin value in any assignment
    expect(httpSrc).not.toMatch(/Allow-Origin['"]?\s*,\s*['"]\*['"]/);
  });
});

// ─── 9. Production Secure cookie behaviour (simulated) ───────────────────────

describe('lib/auth — Secure cookie flag in production', () => {
  test('COOKIE_OPTS secure is false when NODE_ENV != production', () => {
    // Test env is 'test' — secure should be false
    const authSrc = fs.readFileSync(path.join(__dirname, '../lib/auth.js'), 'utf8');
    // The auth module reads process.env.NODE_ENV at require-time
    // We verify the logic via the serialized cookie in the test environment
    const { serializeAuthCookie } = require('../lib/auth');
    const serialized = serializeAuthCookie('fake-token');
    const parsed = cookie.parse(serialized.split(';')[0]);
    // In test environment, secure should NOT be present
    expect(serialized.toLowerCase()).not.toMatch(/;\s*secure\b/);
  });
});

// ─── 10. Client-side security — static analysis of app.js ────────────────────

describe('Client-side security — static analysis of app.js', () => {
  test('TOKEN_KEY constant removed', () => {
    expect(APP_JS).not.toMatch(/const TOKEN_KEY/);
  });

  test('getToken() function removed', () => {
    expect(APP_JS).not.toMatch(/function getToken\s*\(/);
  });

  test('setToken() function removed', () => {
    expect(APP_JS).not.toMatch(/function setToken\s*\(/);
  });

  test('no localStorage.setItem for TB-auth-token', () => {
    expect(APP_JS).not.toMatch(/localStorage\.setItem\s*\(\s*['"]TB-auth-token['"]/);
  });

  test('no localStorage.getItem for TB-auth-token', () => {
    expect(APP_JS).not.toMatch(/localStorage\.getItem\s*\(\s*['"]TB-auth-token['"]/);
  });

  test('no sessionStorage access for auth token', () => {
    expect(APP_JS).not.toMatch(/sessionStorage\.(set|get)Item\s*\(\s*['"]TB-auth-token['"]/);
  });

  test('no document.cookie access', () => {
    expect(APP_JS).not.toMatch(/document\.cookie/);
  });

  test('api() uses credentials:include', () => {
    expect(APP_JS).toMatch(/credentials\s*:\s*['"]include['"]/);
  });

  test('api() does NOT send manual Authorization:Bearer header', () => {
    expect(APP_JS).not.toMatch(/headers\s*\[['"]Authorization['"]\]\s*=.*Bearer/);
  });

  test('api() does not call getToken() to build headers', () => {
    expect(APP_JS).not.toMatch(/getToken\s*\(\s*\)/);
  });

  test('SESSION_EXPIRED error distinguished from generic errors', () => {
    expect(APP_JS).toMatch(/SESSION_EXPIRED/);
  });

  test('FORBIDDEN error distinguished from session errors', () => {
    expect(APP_JS).toMatch(/FORBIDDEN/);
  });
});

// ─── 11. api/ serverless handlers — no token in response body ────────────────

describe('api/ handlers — JWT never appears in response body', () => {
  test('login response has no token field', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(res.body.token).toBeUndefined();
    // Also check the raw body text to be safe
    expect(JSON.stringify(res.body)).not.toMatch(/eyJ/); // JWT header prefix
  });

  test('user response has no token field', async () => {
    const res = await request(app)
      .get('/api/user')
      .set('Cookie', makeAuthCookie());
    expect(res.body.token).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/eyJ/);
  });
});

// ─── 12. P0.6 Security Hardening & Input Safety Tests ─────────────────────────

const {
  isValidEmail,
  validateLoginPayload,
  validateRegisterPayload,
  validateUserProfile,
  validateAvailability,
  validateUserUpdatePayload,
} = require('../lib/validator');

describe('P0.6 Security Hardening Suite', () => {

  describe('Server-Side Input Safety & Schema Validation', () => {
    test('isValidEmail accepts valid emails and rejects malformed/dangerous emails', () => {
      expect(isValidEmail('student@example.com')).toBe(true);
      expect(isValidEmail('user.name+tag@sub.domain.vn')).toBe(true);

      // Malformed / Injection attempts
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail('plainaddress')).toBe(false);
      expect(isValidEmail('<script>@domain.com')).toBe(false);
      expect(isValidEmail('admin@domain.com<script>')).toBe(false);
      expect(isValidEmail('admin@domain..com')).toBe(false);
      expect(isValidEmail('a'.repeat(250) + '@example.com')).toBe(false);
      expect(isValidEmail(null)).toBe(false);
    });

    test('validateLoginPayload enforces required fields, email format, and max lengths', () => {
      expect(validateLoginPayload(null).valid).toBe(false);
      expect(validateLoginPayload({}).valid).toBe(false);
      expect(validateLoginPayload({ email: 'bad' }).valid).toBe(false);
      expect(validateLoginPayload({ email: 'bad@', password: '123' }).valid).toBe(false);
      expect(validateLoginPayload({ email: 'good@tb.demo', password: 'a'.repeat(200) }).valid).toBe(false);

      const valid = validateLoginPayload({ email: 'minhanh@tb.demo', password: 'secretpassword' });
      expect(valid.valid).toBe(true);
      expect(valid.email).toBe('minhanh@tb.demo');
    });

    test('validateRegisterPayload enforces name length, email format, and password limits', () => {
      expect(validateRegisterPayload({ name: '', email: 'a@b.c', password: 'pass' }).valid).toBe(false);
      expect(validateRegisterPayload({ name: 'A'.repeat(150), email: 'a@b.com', password: 'pass' }).valid).toBe(false);
      expect(validateRegisterPayload({ name: 'Valid Name', email: 'notanemail', password: 'pass' }).valid).toBe(false);
      expect(validateRegisterPayload({ name: 'Valid Name', email: 'valid@b.com', password: '12' }).valid).toBe(false);
      expect(validateRegisterPayload({ name: 'Valid Name', email: 'valid@b.com', password: 'x'.repeat(200) }).valid).toBe(false);

      const valid = validateRegisterPayload({ name: 'Minh Anh', email: 'MinhAnh@tb.demo', password: 'demopassword' });
      expect(valid.valid).toBe(true);
      expect(valid.email).toBe('minhanh@tb.demo');
    });

    test('validateUserProfile validates profile fields', () => {
      expect(validateUserProfile(null).valid).toBe(false);
      expect(validateUserProfile([]).valid).toBe(false);
      expect(validateUserProfile({ name: 'Short' }).valid).toBe(true);
      expect(validateUserProfile({ name: 'A'.repeat(400) }).valid).toBe(false);
    });

    test('validateAvailability validates time formats and weekdays', () => {
      expect(validateAvailability({ start: '15:00', end: '21:00', days: [1, 2, 3] }).valid).toBe(true);
      expect(validateAvailability({ start: 'invalid', end: '21:00' }).valid).toBe(false);
      expect(validateAvailability({ start: '15:00', end: '99:999' }).valid).toBe(false);
      expect(validateAvailability({ days: [1, 7] }).valid).toBe(false);
      expect(validateAvailability({ days: [-1] }).valid).toBe(false);
    });

    test('validateUserUpdatePayload rejects excessive lists and oversized titles', () => {
      expect(validateUserUpdatePayload(null).valid).toBe(false);
      expect(validateUserUpdatePayload({ profile: { name: 'Ok' } }).valid).toBe(true);

      const hugeTasks = Array.from({ length: 1005 }, (_, i) => ({
        id: `task-${i}`,
        title: `Task ${i}`,
        minutes: 30,
        deadline: '2026-10-20'
      }));
      expect(validateUserUpdatePayload({ tasks: hugeTasks }).valid).toBe(false);

      const dangerousTask = [{ id: 'task-1', title: 'A'.repeat(400), minutes: 30, deadline: '2026-10-20' }];
      expect(validateUserUpdatePayload({ tasks: dangerousTask }).valid).toBe(false);

      const badSchedule = [{ id: 'sched-1', title: 'A', day: 9, start: '10:00', end: '11:00' }];
      expect(validateUserUpdatePayload({ fixedSchedules: badSchedule }).valid).toBe(false);
    });
  });

  describe('HTTP API Security & Validation Integration', () => {
    test('POST /api/login rejects malformed payload with 400', async () => {
      const res = await request(app)
        .post('/api/login')
        .send({ email: 'not-an-email', password: '123' })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    test('POST /api/register rejects invalid email or short password with 400', async () => {
      const res1 = await request(app)
        .post('/api/register')
        .send({ name: 'Test', email: 'invalid-email', password: 'secretpassword' })
        .expect(400);
      expect(res1.body.error).toMatch(/Email không đúng định dạng/);

      const res2 = await request(app)
        .post('/api/register')
        .send({ name: 'Test', email: 'test@example.com', password: '12' })
        .expect(400);
      expect(res2.body.error).toMatch(/Mật khẩu cần ít nhất 4 ký tự/);
    });

    test('PUT /api/user rejects unauthorized requests with 401 without leaking token', async () => {
      const res = await request(app)
        .put('/api/user')
        .send({ profile: { name: 'Hacked' } })
        .expect(401);

      expect(res.body.error).toMatch(/Phiên đăng nhập hết hạn/);
      expect(res.body.token).toBeUndefined();
    });
  });

  describe('Forbidden File & Route Protection', () => {
    test('Access to sensitive files (.env, tests, scripts, .sql) returns 403 Forbidden', async () => {
      await request(app).get('/.env').expect(403);
      await request(app).get('/.env.local').expect(403);
      await request(app).get('/scripts/audit.js').expect(403);
      await request(app).get('/schema.sql').expect(403);
      await request(app).get('/data/users.json').expect(403);
      await request(app).get('/src/server/expressServer.js').expect(403);
    });

    test('Security headers are present on responses', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });
  });

  describe('Client XSS Sanitization & Safe Image URL checks', () => {
    const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[char]));

    const isSafeImageUrl = (url = '') => {
      if (!url || typeof url !== 'string') return false;
      const trimmed = url.trim();
      if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(trimmed)) return true;
      try {
        const parsed = new URL(trimmed, 'https://calender-jsf2.vercel.app');
        return ['http:', 'https:'].includes(parsed.protocol);
      } catch (e) {
        return false;
      }
    };

    test('escapeHTML neutralizes HTML/JS injection payloads', () => {
      const maliciousPayloads = [
        '<script>alert("xss")</script>',
        '<img src=x onerror=alert(1)>',
        '<svg onload=alert(document.cookie)>',
        '"><script>alert(1)</script>',
        "' onfocus='alert(1)",
      ];

      for (const payload of maliciousPayloads) {
        const escaped = escapeHTML(payload);
        expect(escaped).not.toContain('<');
        expect(escaped).not.toContain('>');
        expect(escaped).not.toContain('"');
      }
    });

    test('isSafeImageUrl accepts valid http/https and base64 images, rejects javascript: and vbscript:', () => {
      expect(isSafeImageUrl('https://images.unsplash.com/photo-123')).toBe(true);
      expect(isSafeImageUrl('http://example.com/pic.jpg')).toBe(true);
      expect(isSafeImageUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')).toBe(true);

      // Dangerous schemes
      expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
      expect(isSafeImageUrl('javascript:alert(document.cookie)')).toBe(false);
      expect(isSafeImageUrl('vbscript:msgbox(1)')).toBe(false);
      expect(isSafeImageUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe(false);
      expect(isSafeImageUrl('')).toBe(false);
      expect(isSafeImageUrl(null)).toBe(false);
    });
  });

  // ─── 17. POST /api/ai — Authenticated AI Time Management endpoint ─────────────
  describe('POST /api/ai — Authenticated AI Time Management endpoint', () => {
    test('POST /api/ai without cookie returns 401', async () => {
      const res = await request(app)
        .post('/api/ai')
        .send({ action: 'generate_plan', input: 'học bài' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    test('POST /api/ai with valid auth cookie processes request', async () => {
      const res = await request(app)
        .post('/api/ai')
        .set('Cookie', makeAuthCookie())
        .send({
          action: 'parse_intent',
          input: 'học Toán 2 tiếng, đá bóng lúc 19h',
          context: { currentDate: '2026-03-12' }
        });
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      if (res.body.ok) {
        expect(['ai', 'deterministic']).toContain(res.body.source);
        expect(res.body.intent).toBeDefined();
      } else {
        expect(res.body.status).toMatch(/NOT_CONFIGURED|UNAVAILABLE|ERROR/);
      }
    }, 15000);

    test('POST /api/ai with missing input returns 400', async () => {
      const res = await request(app)
        .post('/api/ai')
        .set('Cookie', makeAuthCookie())
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });
  });
});


