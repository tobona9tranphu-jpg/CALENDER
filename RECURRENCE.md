# Recurrence Engine & Data Integrity Architecture (P0.5)

## Overview

The calendar application previously relied on a primitive fixed schedule model: each entry had a simple `day: 0..6` integer representing a single day of the week, with no support for multi-day schedules, intervals (e.g. bi-weekly), monthly patterns, occurrence-level exceptions, or bounded evaluation windows. Furthermore, client-side data persistence lacked schema validation, version migrations, duplicate ID resolution, orphan cleanup, and emergency recovery against malformed `localStorage` JSON payloads.

**P0.5 establishes a rock-solid foundation for future Smart Scheduling and AI Planner features without implementing any AI features in this phase.**

---

## 1. Recurrence Engine (`src/recurrence/recurrence-engine.js`)

### Core Principles
1. **Timezone Determinism:** Built strictly on `AppDate` (`Asia/Ho_Chi_Minh` / UTC+7). Midnight boundaries, weekdays, and calendar days are calculated consistently without machine timezone drift.
2. **Strictly Bounded Expansion:** Occurrences can only be generated within an explicit `[rangeStart, rangeEnd]` window. Unbounded expansion is strictly prohibited. To prevent Denial of Service (DoS) attacks from arbitrarily large ranges, an explicit upper bound of **366 days** is enforced.
3. **Supported Recurrence Patterns:**
   - `WEEKLY`: Single-day (e.g. every Monday), multi-day (e.g. Monday, Wednesday, Friday via `daysOfWeek: [1, 3, 5]`), and custom interval weeks (e.g. `interval: 2` for bi-weekly).
   - `DAILY`: Every day (`interval: 1`) or every $N$ days (`interval: N`).
   - `MONTHLY`: Same day of each month (e.g. 15th of every month). Gracefully accounts for varying month lengths (e.g. 31st collapses to 28th/29th in February and 30th in April).
4. **Termination Conditions:**
   - `untilDate`: Occurrences strictly stop after the specified date (`YYYY-MM-DD`).
   - `count`: Maximum number of occurrences to generate across the series.
5. **First-Class Occurrence Exceptions:**
   - `skip`: Omit a specific occurrence date from the series (e.g. holiday or one-off cancellation).
   - `modify`: Override properties (`start`, `end`, `title`, `flexible`) for a specific date while preserving the rest of the recurring series intact.
6. **Backward Compatibility:**
   - Any legacy schedule with only `day: 0..6` automatically expands as a standard weekly recurrence.
   - Non-recurring single events with `startDate` expand only on that date.

### Module API
```javascript
const { RecurrenceEngine } = require('./src/recurrence');

// Validation
const { valid, error } = RecurrenceEngine.validateRecurrenceRule(rule);

// Bounded expansion (max window: 366 days)
const occurrences = RecurrenceEngine.expandOccurrences(event, '2026-09-01', '2026-09-30');

// Adding exceptions
const updatedSkip = RecurrenceEngine.addSkipException(event, '2026-09-21');
const updatedModify = RecurrenceEngine.addModifyException(event, '2026-09-21', {
  start: '19:00',
  end: '20:30',
  title: 'Ca học dời giờ'
});
```

---

## 2. Data Integrity & Migration Pipeline (`src/recurrence/data-integrity.js`)

### Pipeline Workflow
$$\text{load} \longrightarrow \text{parse} \longrightarrow \text{validate} \longrightarrow \text{migrate} \longrightarrow \text{normalize} \longrightarrow \text{clean orphans \& duplicate IDs}$$

### Key Capabilities
1. **Resilient Corrupted Storage Recovery (`safeLoadStorage`):**
   - Automatically catches `JSON.parse` syntax errors from malformed `localStorage`.
   - Writes an emergency backup copy to `TB_CORRUPT_BACKUP_<key>_<timestamp>`.
   - Safely returns a fallback without crashing the UI.
2. **Schema Versioning & Migration (`migrateUserData`):**
   - Upgrades legacy v1 data to v2 (`dataVersion: 2`).
   - Ensures `fixedSchedules` have `flexible: boolean` and `exceptions: []`.
   - Ensures `studyNotes: []` and `examMilestones: []` exist.
3. **Duplicate ID Deduplication (`resolveDuplicateIds`):**
   - Preserves canonical first entry.
   - Re-keys duplicate collision IDs with deterministic timestamp and random suffixes (e.g. `task-dup-1789...`).
4. **Orphan Sanitization (`sanitizeOrphans`):**
   - Disconnects `subjectId` and `topicId` from tasks if they point to deleted subjects or topics.
   - Prunes review schedules referencing non-existent topics.
5. **Unified Processing Pipeline (`processUserDataPipeline`):**
   - Single point of truth for sanitizing any user object loaded from storage or server.

---

## 3. System Integrations

### 1. Notification Engine (`src/notifications/notification-scheduler.js`)
- `NotificationScheduler.reconcile(user)` expands fixed schedules bounded to `[today, today]`.
- Honors `skip` exceptions: if today's occurrence has a skip exception, no reminder is scheduled.
- Honors `modify` exceptions: if today's occurrence start time is altered, the 15-minute advance reminder trigger recalculates automatically based on the new start time.
- Deletion: Calling `handleItemDeleted('event', seriesId)` invalidates all tracked states and deduplication keys.

### 2. Smart Planning (`createPlan` in `app.js`)
- `createPlan(viewDate)` expands occurrences for `[viewDate, viewDate]`.
- If an occurrence has a `skip` exception, the time slot is immediately freed, allowing flexible study tasks to be planned in that space.
- If an occurrence has a `modify` exception, study tasks adjust automatically around the modified start and end time.

### 3. User Interface (`app.js`, `enhancements.css`, `index.html`)
- **Day Timeline View (`#scheduleTimeline`):** Displays a `Bỏ qua hôm nay` button for fixed occurrences on that date, invoking `skipFixedOccurrence(seriesId, date)`.
- **Fixed Schedule Cards (`#fixedSchedulesList`):** Displays badges indicating active exceptions (`X ngoại lệ`).

---

## 4. Automated Verification Matrix

The test suite in `tests/recurrence-integrity.test.js` covers:
- Recurrence rule validation (frequencies, intervals 1–52, weekdays 0–6, `untilDate`).
- Maximum boundary safety guard (> 366 days throws error).
- Weekly single-day, multi-day, and bi-weekly recurrence.
- Daily interval recurrence.
- Monthly recurrence on same day of month, including month-end boundary wrapping.
- Termination conditions (`untilDate` and `count`).
- First-class occurrence exceptions (`skip` and `modify`).
- Backward compatibility with legacy `day: 0..6` and single events.
- Data integrity validation, ID deduplication, and orphan reference cleanup.
- Schema migration from v1 to v2.
- Resilient storage recovery with emergency backup.
- Scheduler reminder reconciliation with recurring occurrences and exceptions.
- Calendar planning integration (`createPlan`) with recurring fixed events and exceptions.
