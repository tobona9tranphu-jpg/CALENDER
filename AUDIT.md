# TB Smart Study Planner Audit

## Scope and current architecture

- **Runtime:** vanilla browser JavaScript, static HTML/CSS, Node.js CommonJS Vercel functions.
- **Package manager:** npm; `node --test` is the test runner.
- **Frontend:** one large `app.js` file (~2,000 lines) with delegated DOM events and a mutable `currentUser` object.
- **UI:** one `index.html` containing auth, onboarding, home, schedule, subjects, progress, tasks, insights, settings, and modal flows.
- **Styles:** dense tokenized CSS in `styles.css`, with `mobile.css`, `enhancements.css`, and `conflict.css` layered on top.
- **Backend:** `/api/*.js` serverless handlers; shared HTTP parsing, JWT auth, PostgreSQL access, and repository code under `lib/`.
- **Persistence:** PostgreSQL when configured; browser `localStorage` fallback for demo/offline mode.
- **AI:** server-side Gemini proxy handlers for timetable parsing, what-if simulation, chat, and schedule generation.

## Existing strengths

- Existing user flows cover authentication, onboarding, subjects/topics, tasks, fixed schedules, study sessions, reviews, exams, timetable import, simulation, insights, and settings.
- Fixed schedules already have a shared `overlaps()` implementation.
- API keys are server-side; the browser does not receive Gemini credentials.
- Existing tests cover priority scoring, schedule conflicts, simulation validation, chat tools, and schedule planning.
- The visual language is coherent: warm paper background, purple action color, restrained radii, serif display type, and responsive mobile stylesheet.

## Findings

### P0 stability and correctness

1. `app.js` is a monolith: state, persistence, rendering, scheduling, event delegation, import parsing, timers, and API calls are interleaved. This increases regression risk and makes async planner updates difficult to reason about.
2. Most renders are full-page section renders. A schedule cache refresh can trigger another complete `renderApp()`, creating duplicate work and potential stale async responses.
3. The UI uses `innerHTML` extensively. Most user content is escaped, but this remains a high-risk pattern for future features such as notes, memories, search, and natural-language summaries.
4. Local fallback silently changes the persistence model. Users can believe data is synced when it is only in one browser; the product needs a visible “local demo mode” indicator.
5. Error handling has historically collapsed infrastructure failures into validation errors. API errors should preserve status and show a retryable, user-friendly state.
6. Date handling is mostly local `Date` construction with string concatenation. `TODAY`, ISO timestamps, weekday mapping, and timezone conversion need one shared date policy.
7. `renderApp()` invokes scheduling and rendering synchronously while AI refresh is asynchronous. Cache invalidation and race protection must be centralized.

### P1 product and UX

1. Home is insight-first rather than action-first. The strongest hierarchy should be: next action, next event/countdown, today progress, free time, then supporting insight.
2. The current dashboard has many sections but no explicit free-time budget, overdue state, or “behind schedule” recovery action.
3. Notifications are a popover with derived content, not a durable priority-aware notification center. There is no deduplication, quiet-hours policy, browser permission flow, or reschedule invalidation.
4. Calendar interaction is primarily display plus modal forms. Month/calendar navigation exists, but week/day views, drag/resize, quick create, keyboard movement, and undo are not implemented as a unified interaction model.
5. Empty and error states are inconsistent: some use `emptyHTML`, some use toasts, and some leave the prior UI in place.
6. Mobile CSS exists, but mobile is a compressed desktop experience rather than an intentional Today/Agenda/Quick Add/Focus flow.

### P2/P3 capability gaps

- No robust natural-language event/task parser abstraction.
- No smart rescheduling preview with undo.
- No time-budget aggregation or narrative weekly/monthly insights.
- No year activity heatmap.
- Notes exist, but memories/photos/locations are not attached to calendar events as a separate model.
- No “On this day” historical surface.
- Focus timer exists, but completion analytics and a dedicated focus mode are limited.
- No optional energy model or balanced, non-childish consistency milestones.
- No universal search across tasks, topics, sessions, exams, and notes.

### Security and privacy

- JWT verification is server-side and AI calls are proxied server-side.
- Local storage contains the full demo user object, including user-entered study data; this is acceptable only when explicitly labeled demo/local mode.
- API handlers must continue deriving identity exclusively from JWT, never from model arguments or client-provided user IDs.
- Any future HTML-rendered user text must pass through one escaping/sanitization helper.
- Gemini prompts may contain sensitive task/note data; the UI and documentation should disclose this when AI features are enabled.

### Performance

- Full `renderApp()` calls and repeated `createPlan()` calls are the largest current client costs.
- `renderToday()` calls `createPlan()` for today and each of the next three days; AI planning must be cached and not run during every render.
- CSS is delivered as several large unminified files; this is acceptable for the demo but should be consolidated after behavior stabilizes.
- There is no request cancellation for stale AI calls.

## Recommended architecture

1. Keep the vanilla frontend for now; introduce small modules by responsibility rather than a risky framework rewrite.
2. Create shared pure utilities for dates, schedule conflicts, planning, notification priority, and escaped rendering.
3. Add a `planner-store` boundary for cache keys, stale request guards, provisional plans, and AI fallback state.
4. Treat `Event`, `Task`, `FixedSchedule`, `FocusSession`, `Memory`, `Notification`, and `Reminder` as distinct concepts even when local persistence serializes them together.
5. Use server-side provider adapters (`GeminiPlannerProvider`) behind stable API contracts. Never fake AI success when the provider is unavailable.
6. Add structured, versioned persistence fields instead of expanding the existing user object ad hoc.
7. Make Today the primary product surface; keep analytics and emotional features progressive and optional.

## Audit conclusion

The project has a usable foundation and should be evolved incrementally. The highest-value work is not a visual rewrite: it is stabilizing date/schedule primitives, isolating async planner state, making fallback mode explicit, and turning Today into an action-oriented agenda. P2/P3 features should follow only after those foundations are tested.
