# TB Smart Study Planner backend

The `/api` directory contains Vercel serverless handlers. User data is stored in PostgreSQL through `lib/db.js`; the API does not read or write `data/users.json`.

## Vercel environment variables

Configure these variables in Vercel and in local `.env`/`vercel dev`:

- `DATABASE_URL`: PostgreSQL connection string.
- `JWT_SECRET`: long random secret used to sign authentication tokens.
- `GEMINI_API_KEY`: Google Gemini API key used by `/api/parse-timetable` for timetable image extraction.
- `GEMINI_MODEL` (optional): Gemini model name; defaults to `gemini-2.5-flash`.

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
