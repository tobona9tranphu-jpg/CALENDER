# Product and Engineering Roadmap

## P0 — Core stability

1. Extract shared date/time helpers with explicit local timezone behavior.
2. Add planner store/cache with deterministic input hashes, request versioning, and stale-response protection.
3. Normalize API errors into validation/auth/provider/database categories.
4. Make local demo mode visible and explain that data is browser-local.
5. Add conflict, boundary, recurring-date, and timezone tests.
6. Centralize safe text rendering and loading/error/empty states.
7. Verify mobile keyboard/focus behavior and basic ARIA labels.

## P1 — Core “wow”

1. Reorder Today around next best action, next event/countdown, progress, free time, and one smart insight.
2. Add a priority-aware notification center with deduplication, quiet hours, and retry-safe scheduling.
3. Add conflict intelligence with INFO/WARNING/CRITICAL severity and explanations.
4. Add “Fix my day” preview for late/overloaded schedules with apply/undo.
5. Add time-budget aggregation and concise weekly narrative insights.

## P2 — Differentiation

1. Natural-language quick add behind a provider abstraction and explicit preview/apply flow.
2. AI Day Planner using the existing Gemini structured-output endpoint and shared validation.
3. Focus Mode with persisted focus sessions and completion analytics.
4. Week/day agenda interactions and safe drag/resize with conflict preview.
5. Universal search across tasks, subjects, exams, sessions, and notes.

## P3 — Retention and emotional value

1. Year activity heatmap.
2. Optional event memories with note/photo/location metadata.
3. “On this day” historical surface.
4. Optional energy windows and energy-aware recommendations.
5. Balanced consistency/planning/focus metrics without game-like rewards.

## Delivery policy

- Each slice must preserve local fallback behavior.
- No UI control is added without a working state, loading, error, empty, and keyboard path.
- Every AI result is validated server-side before display or persistence.
- Each feature gets targeted tests before moving to the next priority.
