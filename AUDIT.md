# AUDIT.md

## Repository Overview
- **Root directory:** `c:/Users/admin/OneDrive/Documents/ChatGPT/app`
- **Key entry points:**
  - `server.js` – simple static HTTP server (Node.js `http` module).
  - `app.js` – client‑side application (vanilla JavaScript, no framework).
  - `index.html` – main HTML page.
  - `styles.css`, `mobile.css`, `conflict.css`, `enhancements.css` – styling layers.
  - `database-schema.sql` – PostgreSQL schema for user, tasks, schedules, etc.
  - `scripts/seed-demo-account.js` – seeds a demo account.
- **Package manager:** npm (see `package.json`).
- **Runtime:** Node.js (v14+ assumed) for the static server; client runs in modern browsers.
- **Build tool:** None – the app is served as static files. No bundler (e.g., Webpack, Vite) is configured.
- **Routing:** Client‑side routing is performed manually by `activePage` state and DOM manipulation; there is no SPA router library.
- **Tests:** Located under `tests/` (e.g., `priority-engine.test.js`). Currently only a few unit‑style tests exist.

## Technical Stack
| Layer               | Technology / Library                                    |
|---------------------|----------------------------------------------------------|
| Server               | Node.js `http`, `fs`, `path`                              |
| Client               | Vanilla JS (no framework), ES6 modules (`import` not used) |
| Styling              | Plain CSS (multiple files)                               |
| Database             | PostgreSQL (`pg` npm package)                             |
| Authentication       | Simple token stored in `localStorage` (`TB-auth-token`)   |
| Persistence          | LocalStorage for demo data; server API for real users     |
| Build / Bundle       | None (static files served directly)                      |
| Testing framework    | Node's built‑in `assert` (tests are plain JS files)       |

## Initial Findings (Repository Discovery)
- **Framework:** None – the UI is handcrafted with direct DOM queries (`$`, `$$`).
- **State Management:** Global mutable variables (e.g., `currentUser`, `activePage`). No centralized store (Redux/Vuex/etc.).
- **Hooks / Observers:** None – the code uses manual event listeners and direct function calls.
- **API Layer:** Wrapper `api(method, path, body)` that uses `fetch`. Authentication token handling is minimal.
- **Date/Time handling:** Custom helpers (`dateFrom`, `minFromTime`, `formatMinutes`, etc.) built on native `Date`. No dedicated library like `date-fns` or `luxon`.
- **Calendar implementation:** `renderCalendar`, `renderSchedule`, `createPlan` functions generate UI and schedule logic.
- **Drag‑and‑drop:** Not present in the current codebase (no DnD libraries, no mouse event handling for moving events).
- **Recurring events:** Handled via `fixedSchedules` objects with a `day` field (0‑6). No full recurrence rule engine.
- **Responsive design:** Separate `mobile.css` and `styles.css`; media queries are used, but no mobile‑first component system.
- **Theming / Design tokens:** None – colors & icons are hard‑coded in `SUBJECT_METADATA` and CSS classes.
- **Accessibility:** No ARIA attributes observed; button elements often lack `aria-label`.
- **Performance:** No lazy loading, code splitting, or memoization. All JS is loaded in a single bundle.
- **Security:** Token stored in `localStorage`; no CSRF protection; API keys are hard‑coded in comments (e.g., `$env:GEMINI_API_KEY` placeholder).
- **Testing coverage:** Only a handful of tests covering the priority engine; no UI, integration, or end‑to‑end tests.

## Technical Audit (Phase 1) – Detailed Checklist
### 1. Duplicate / Dead Code
- Search for identical function definitions across files – none found yet.
- Unused utility functions: `seedAccount`, `blankAccount` are only used for demo seeding.
- `api` contains duplicated error handling for `OFFLINE_MODE` – could be refactored.

### 2. Giant Components
- `app.js` is **~2000 lines** – a massive monolithic component handling rendering, state, logic, and utilities. This should be split into modules (e.g., renderers, services, models).
- No other files exceed 500 lines.

### 3. Prop Drilling / Excessive State
- Global mutable state (`currentUser`, `activePage`, numerous flags) is accessed directly throughout the file. This leads to tight coupling and makes testing hard.
- Functions often read/write the same globals instead of receiving parameters.

### 4. State Ownership & Mutations
- Functions like `createPlan` modify local variables but also rely on globals (`currentUser.availability`). No immutable patterns.
- Direct mutation of objects (e.g., `task.status = 'done'` in UI handlers) without copying.

### 5. Naming Consistency
- Mixed naming conventions: `camelCase` for functions, but some constants use `ALL_CAPS` (e.g., `API`, `TOKEN_KEY`). Generally consistent but could be unified.

### 6. API Calls Duplication
- `api` is the sole wrapper, but several places manually construct URLs and query parameters – could consolidate.

### 7. Notification Logic (Audited & Resolved in P0.4)
- **Findings during Audit:**
  - Primitive single `#toast` element with basic `setTimeout(3000)` and no queuing or stacking.
  - Toast lacked accessible ARIA live regions (`role="status"`, `aria-live="polite"` / `role="alert"`, `aria-live="assertive"`).
  - No background reminder scheduler existed: events and tasks had deadlines and start times, but notifications were never calculated or triggered before events.
  - `#notificationButton` and `#notificationPopover` only rendered a static text string checking the first review due today; no notification center, history, or read/unread state.
  - No deduplication engine: actions could trigger repetitive or duplicate alerts across renders.
  - No quiet hours suppression (critical vs. non-critical notifications treated identically).
  - No native browser Web Notification API integration.
- **Resolution (P0.4):**
  - Built centralized, modular notification architecture under `src/notifications/`:
    - `notification-types.js`: Standard notification models, severities (`info`, `success`, `warning`, `danger`), and priorities (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
    - `notification-store.js`: Persistent state in `localStorage` (`TB_NOTIFICATIONS_STATE`), unread count tracking, and `firedKeys` set tracking for deterministic deduplication.
    - `notification-policy.js`: Deterministic dedupe key generation (`${sourceType}:${sourceId}:${type}:${timingKey}`), quiet hours evaluation (`22:00`–`07:00` in Vietnam time), priority escalation (CRITICAL bypasses quiet hours).
    - `browser-notification.js`: Safe wrapper for native Web Notification API with permission handling and graceful degradation.
    - `toast-ui.js`: Accessible non-blocking Toast UI with ARIA live regions (`polite` vs `assertive`), dismiss button with `aria-label`, pause-on-hover, focus-pause, and reduced motion check.
    - `notification-scheduler.js`: Automated background reconciliation loop (30s) calculating 15-minute advance reminders via `AppDate`, overdue task tracking, Spaced Repetition review reminders, automatic reschedule on event time changes, and cancellation on item deletions.
    - `notification-service.js`: Central facade coordinating store, policy, scheduler, toast, and browser notifications.
  - Integrated into `index.html` and `app.js` with zero-regression fallback for existing `toast()` calls.
  - Added comprehensive automated tests in `tests/notifications.test.js` (store, policy, scheduler, service, and accessible DOM rendering).

### 8. Date/Time Bugs & Timezone (Audited & Resolved in P0.3)
- **Findings during Audit:**
  - Scattered `+07:00` string concatenations in `dateFrom`, `relDate`, `createPlan`, `renderSchedule`, and date navigators.
  - `getToday()`, `renderCalendar()`, and date math relied on host machine's `new Date()`, causing calendar day and weekday shifts when accessed from non-Vietnam system timezones.
  - `scheduleReviewForTopic` used `dueDate.toISOString().slice(0, 10)`, which converts to UTC and caused off-by-one calendar day shifts near day boundaries.
  - Deadline urgency used floating-point millisecond division `(d1 - d2) / 86400000` instead of integer calendar day differences.
  - `renderCalendar()` used browser local date getters (`getDay()`, `getDate()`) creating inconsistent grid displays across system timezones.
- **Resolution (P0.3):**
  - Centralized application timezone in `src/utils/date.js` (`APP_TIMEZONE = 'Asia/Ho_Chi_Minh'`).
  - Standardized pure calendar date format (`YYYY-MM-DD`), wall-clock time (`HH:mm`), and UTC instants.
  - Removed all hardcoded `+07:00` concatenations from application and helper logic.
  - Implemented deterministic calendar math: `addAppDays`, `diffAppCalendarDays`, `getAppDayOfWeek`, `startOfAppDay`, `endOfAppDay`, `formatDeadlineText`, `calculateReminderTiming`, and `generateCalendarGrid`.
  - Added comprehensive test coverage (41 tests in `tests/date.test.js`) including simulated foreign timezones (`America/New_York`, `Europe/London`, `UTC`, `Asia/Tokyo`).

### 9. Recurring Events & Data Integrity (Audited & Resolved in P0.5)
- **Findings during Audit:**
  - Fixed schedules used only a primitive `day` integer (0–6), with no support for multi-day recurring events, intervals (e.g., bi-weekly), monthly patterns, or end conditions (`count`, `untilDate`).
  - No occurrence-level exceptions: if a student canceled or rescheduled a single session of a recurring class, they had to either delete the entire recurring series or create conflicting manual entries.
  - No bounded evaluation window: potential risk of unbounded expansion causing browser freezes / DoS.
  - `localStorage` lacked schema versioning, validation, duplicate ID resolution, orphan cleanup, and error-recovery against corrupted JSON payloads.
- **Resolution (P0.5):**
  - Created `src/recurrence/recurrence-engine.js`:
    - Timezone-deterministic expansion using `AppDate` (`Asia/Ho_Chi_Minh` / UTC+7).
    - Strictly bounded expansion window with a maximum boundary safety guard (366 days).
    - Full support for `WEEKLY` (single and multi-day, custom intervals), `DAILY` ($N$-day intervals), and `MONTHLY` patterns.
    - End condition support (`untilDate`, `count`).
    - First-class occurrence exceptions: `skip` (drops date) and `modify` (overrides times, title, or flexibility for a specific date).
    - 100% backward compatibility with legacy `day: 0..6` and the database schema.
  - Created `src/recurrence/data-integrity.js`:
    - Unified pipeline: `load -> parse -> validate -> migrate -> normalize -> use`.
    - Resilient corrupted storage loader `safeLoadStorage` with automatic emergency backup creation (`TB_CORRUPT_BACKUP_<key>_<timestamp>`).
    - Schema versioning and migration from v1 to v2.
    - Automatic collision resolution and re-keying for duplicate entity IDs.
    - Orphan reference detection and sanitization for deleted subjects/topics.
  - Integrated with `NotificationScheduler`:
    - Evaluates occurrences for today, honoring `skip` (suppressing reminders) and `modify` (recalculating 15-minute advance trigger for altered times).
  - Integrated with `createPlan` & Calendar UI:
    - Study tasks automatically adapt around active recurring events and modified occurrences.
    - Skipping an occurrence immediately frees the time slot for flexible study tasks.
    - Added UI action `Bỏ qua hôm nay` and exception indicators on schedule cards.
  - Detailed architectural guide documented in `RECURRENCE.md`.
  - Comprehensive automated test coverage in `tests/recurrence-integrity.test.js` (32 new test cases).

### 10. Responsive Issues
- `mobile.css` provides overrides, but no component-level responsive logic – UI may break on certain viewport widths (e.g., calendar grid).

### 11. Accessibility Problems
- Buttons lack `aria-label` (e.g., the check button, delete buttons). No focus management for dynamic content. Contrast not verified.
- No `role` attributes for landmarks (`nav`, `main`).

### 12. Performance Bottlenecks
- Large monolithic `app.js` causes the browser to parse and execute a big script on every load.
- Repeated DOM queries (`$('#element')`) inside loops could be optimized.
- No virtual DOM or diffing – each render rewrites large sections (`innerHTML = ...`).

### 13. Security Issues (Audited & Resolved in P0.1, P0.2 & P0.6)
- **Findings during Audit:**
  - Authentication tokens stored in `localStorage` were vulnerable to client-side token exfiltration.
  - Client manually injected `Authorization: Bearer <token>` in requests.
  - Transitive dependencies (`qs`) had moderate vulnerabilities.
  - Server endpoints lacked schema and size validation (vulnerable to oversized payload DoS and malformed data injection).
  - Unsanitized HTML sinks (`openPhotoLightbox`, unescaped badge and orb styles, unescaped timetable period labels).
  - Missing standard HTTP security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS).
  - Public static server did not explicitly restrict access to internal files (`.env`, `schema.sql`, `/tests/`, `/scripts/`).
- **Resolution (P0.1, P0.2 & P0.6):**
  - **P0.1 & P0.2 Client Auth Removal & Production Cookie Auth:**
    - Completely removed JWT tokens from `localStorage`, `sessionStorage`, `document.cookie`, and manual `Authorization` headers.
    - Switched all client requests to `credentials: 'include'`.
    - Server generates `TB-auth-token` as an `HttpOnly`, `SameSite=Strict`, `Path=/` cookie (with `Secure` enabled in production).
    - Tokens are never returned in JSON response bodies.
  - **P0.6 Dependency & Secret Audit:**
    - Resolved `qs` vulnerabilities via `overrides` in `package.json`; `npm audit` reports **0 vulnerabilities**.
    - Audited Git history and tracked files: verified `.env` and `.env.local` were never committed, and no secrets or tokens exist in client assets.
  - **P0.6 Server-Side Input Safety & Schema Validation:**
    - Created `lib/validator.js` with strict validators for login, registration, user profiles, availabilities, subjects, tasks, and recurring schedules.
    - Integrated validation into `api/login.js`, `api/register.js`, and `api/user.js`.
    - Integrated `DataIntegrity.processUserDataPipeline()` into `api/user.js` to normalize, migrate, and sanitize incoming schedules before database persistence.
    - Added a 1MB payload size guard (`maxBytes`) in `lib/http.js` (`readBody`).
  - **P0.6 Client XSS & Image Sanitization:**
    - Defined `isSafeImageUrl()` restricting image URIs to valid base64 image data URIs or `http:`/`https:` protocols, neutralizing `javascript:` and `vbscript:` vectors.
    - Refactored `openPhotoLightbox()` to use DOM element creation (`document.createElement`) rather than `innerHTML`.
    - Escaped `style.badge`, `style.icon`, `slot.periodLabel`, and `task.id` data attributes across all UI templates.
  - **P0.6 Security Headers & Path Protection:**
    - Configured security headers in `vercel.json` and `src/server/expressServer.js`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Strict-Transport-Security`.
    - Added middleware to block access to sensitive internal paths (`.env*`, `*.sql`, `/tests/*`, `/scripts/*`, `/data/*`, `/src/server/*`).
  - **Verification:**
    - Automated security tests in `tests/server.test.js` covering email validation, auth rejection, route protection, security headers, XSS escaping, and safe image validation (155/155 tests green).

### 14. Tests Gaps (Addressed in P0.1 - P0.6)
- Expanded automated test coverage across 5 comprehensive test suites (155 tests total):
  - `tests/priority-engine.test.js`: Study planning and task priority logic.
  - `tests/date.test.js`: Centralized Vietnam timezone (UTC+7) calendar math.
  - `tests/notifications.test.js`: Notification engine, policies, deduplication, and accessible toast UI.
  - `tests/recurrence-integrity.test.js`: Recurrence engine, bounded expansion, occurrence exceptions, and resilient JSON storage recovery.
  - `tests/server.test.js`: Production-equivalent auth flows, cookie security, input validation, forbidden route protection, and XSS prevention.

## Open Questions for the User
> [!NOTE]
> All core P0 foundations (Auth, Date/Time UTC+7, Notifications, Recurrence/Integrity, and Security/XSS) are now fully implemented, verified, and passing 100% of automated tests with 0 audit vulnerabilities.

