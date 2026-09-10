# TB Smart Study Planner backend

The `/api` directory contains Vercel serverless handlers. User data is stored in PostgreSQL through `lib/db.js`; the API does not read or write `data/users.json`.

## Vercel environment variables

Configure these variables in Vercel and in local `.env`/`vercel dev`:

- `DATABASE_URL`: PostgreSQL connection string.
- `JWT_SECRET`: long random secret used to sign authentication tokens.
- `GEMINI_API_KEY`: Google Gemini API key used by `/api/parse-timetable`, `/api/simulate`, and `/api/generate-schedule`.
- `GEMINI_MODEL` (optional): Gemini model name; defaults to `gemini-2.5-flash`.

The authenticated `/api/chat` endpoint uses the same Gemini key/model for Study Coach function calling.

For production, use a managed Postgres connection string with SSL enabled by the provider.

## Database setup

Run `database-schema.sql` against the configured Postgres database once. The schema uses `TEXT` IDs to preserve the identifiers already emitted by `app.js`; tasks keep their `deadline` directly in `tasks`.

## Seed demo account

The demo account is not created automatically by an API request. After configuring `DATABASE_URL` and `JWT_SECRET`, run:

```powershell
node scripts/seed-demo-account.js
```

Demo credentials: `minhanh@tb.demo` / `demo123`.

## Local Vercel test

Install the Vercel CLI if needed, configure the two environment variables, apply the schema, seed the demo account, then run:

```powershell
vercel dev
```

The existing client continues to call `/api/login`, `/api/register`, `/api/user` GET, and `/api/user` PUT without UI changes.

## Demo mode and product roadmap

When the API/database is unavailable, the client can use the local demo account and stores data only in this browser. The header labels this mode explicitly; it is not server synchronization.

See [AUDIT.md](./AUDIT.md) for the current architecture and risks, and [ROADMAP.md](./ROADMAP.md) for the staged P0-P3 product plan.

Run the current automated checks with:

```powershell
npm.cmd test
```
