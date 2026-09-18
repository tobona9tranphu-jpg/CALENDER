# TB Smart Study Planner backend

The `/api` directory contains Vercel serverless handlers. User data is stored in PostgreSQL through `lib/db.js`; the API does not read or write `data/users.json`.

## Vercel environment variables

Configure these variables in Vercel and in local `.env`/`vercel dev`:

- `DATABASE_URL`: PostgreSQL connection string.
- `JWT_SECRET`: long random secret used to sign authentication tokens.
- `GEMINI_API_KEY`: Google Gemini API key used by `/api/parse-timetable` and `/api/ai`.
- `GEMINI_MODEL` (optional): Gemini model name; defaults to `gemini-3.5-flash` (configured in `src/config/ai.js`).

For production, use a managed Postgres connection string with SSL enabled by the provider.

## AI Architecture & Deterministic Clock

The app uses a unified, deterministic AI architecture:

1. **Unified Pipeline**: All conversational AI interactions (`Ask AI`, shortcuts) are routed through `TimeAssistant` (`src/ai/time-assistant.js`).
   - LLM (Gemini) is used strictly for intent classification and entity extraction.
   - All slot allocation, schedule adjustments, and conflict resolutions are handled 100% deterministically by `CapabilityRouter`, `CapacityEngine`, and `DayFixEngine`.
2. **Central Deterministic Clock**: `src/utils/clock.js` serves as the single source of truth for app time (`Asia/Ho_Chi_Minh` timezone). In planning and tests, `Clock.getPlanningContext()` guarantees that `currentDate` and `currentTime` are derived from the exact same instant, eliminating time leakage and non-deterministic slot calculations.
3. **AI Observability & Graceful Fallback**:
   - Standardized typed error codes (`AI_PROVIDER_UNAVAILABLE`, `AI_TIMEOUT`, `AI_RATE_LIMIT`, `AI_MODEL_NOT_FOUND`, etc.).
   - Bounded retries with exponential backoff on transient HTTP 429/503 errors (max 2 retries).
   - Telemetry tracking (`AITelemetry`) exposes availability metrics and response sources (`source: 'ai' | 'deterministic'`).
   - Run `npm run check-model` (`node scripts/check-model.js`) to verify Gemini configuration and connectivity.

## Database setup

Run `database-schema.sql` against the configured Postgres database once. The schema uses `TEXT` IDs to preserve the identifiers already emitted by `app.js`; tasks keep their `deadline` directly in `tasks`.

## Seed demo account

The demo account is not created automatically by an API request. After configuring `DATABASE_URL` and `JWT_SECRET`, run:

```powershell
node scripts/seed-demo-account.js
```

Demo credentials: `minhanh@tb.demo` / `demo123`.

## Local Vercel test

Install the Vercel CLI if needed, configure the environment variables, apply the schema, seed the demo account, then run:

```powershell
vercel dev
```

The existing client continues to call `/api/login`, `/api/register`, `/api/user` GET, and `/api/user` PUT without UI changes.

