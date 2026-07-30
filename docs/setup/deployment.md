# Deployment

SupportFlow deploys as **two Vercel projects from one repository**, both on the
free Hobby tier. Total hosting cost: **$0**.

| Project | Root Directory | Serves |
| --- | --- | --- |
| `supportflow-web` | `apps/web` | Next.js frontend (the public URL) |
| `supportflow-api` | `server` | Express API as a serverless function |

Two projects rather than one because Vercel builds a single root directory per
project, and the frontend and API have separate dependency manifests.

## Why serverless, and what it required

Railway was the original choice but no longer has a free tier. Render's free
tier sleeps and takes 30–50 seconds to wake, which reads as a broken link.
Vercel functions cold-start in roughly 1–2 seconds.

Two things made this a thin adaptation rather than a rewrite:

- `createApp()` in `src/app.js` already returns an Express app **without
  binding a port**, so the same object serves `node server.js`, Docker, tests,
  and `api/index.js`.
- The Mongoose connection is **cached at module scope** (`src/db/connect.js`).
  A serverless container is reused between requests, so connecting per request
  would open a fresh pool each time and exhaust the Atlas connection limit.
  `maxPoolSize` is capped at 5 for the same reason — Atlas M0 allows 500
  connections in total, and the default of 100 per container burns through that
  after a handful of containers.

## Step 1 — Deploy the API

1. New Vercel project from the GitHub repo, **Root Directory: `server`**.
2. Environment variables:

   | Variable | Value |
   | --- | --- |
   | `MONGODB_URI` | Atlas connection string, password percent-encoded |
   | `CLERK_SECRET_KEY` | `sk_test_...` from Clerk → API Keys |
   | `CLERK_PUBLISHABLE_KEY` | `pk_test_...` — **both keys are required**; without the publishable key the API boots, `/healthz` returns 200, and every `/api` request fails |
   | `CORS_ORIGINS` | leave empty — the frontend calls through its own server-side proxy, so requests are same-origin |
   | `TRUST_PROXY` | `true` — so rate limiting reads real client IPs |

   Do **not** set `NODE_ENV`; Vercel sets it to `production` automatically.

3. Verify: `https://<api>.vercel.app/healthz` returns `{"status":"ok"}`, and
   `/api/tickets` returns `401` rather than 500. A 503 mentioning
   authentication means a Clerk key is missing or malformed.

## Step 2 — Deploy the frontend

1. Second Vercel project, same repo, **Root Directory: `apps/web`**.
2. Environment variables:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_test_...` |
   | `CLERK_SECRET_KEY` | `sk_test_...` |
   | `API_URL` | the Step 1 URL, no trailing slash |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |

3. Optional hardening: set the same `API_TOKEN` on **both** projects to require
   a shared secret in front of Clerk. It travels as `X-Api-Token` —
   `Authorization` carries the Clerk session JWT, and putting the secret there
   instead rejects every request.

## Step 3 — MongoDB Atlas

- **Network access:** allow `0.0.0.0/0`. Vercel functions have dynamic IPs, so
  there is no address range to allowlist. This makes the database credentials
  the only thing protecting the data — use a strong, unique password.
- **Database user:** scope it to `readWrite` on the `supportflow` database
  rather than `atlasAdmin`. The application never needs cluster administration.

## Step 4 — Demo account

Recruiters will not sign up, so publish a login.

1. Sign up on the deployed frontend with a dedicated demo address — not your
   own account, since the password goes in a public README.
2. Create an organization during the Clerk onboarding flow.
3. Copy that organization id from the Clerk dashboard and seed it:

   ```bash
   npm run seed --prefix server -- --org-id=org_xxx
   ```

   Seeding runs against `MONGODB_URI` in your local `server/.env`, so point it
   at the same Atlas cluster the deployment uses.

4. Put the URL and credentials at the top of the README.

## Clerk development vs production instances

The keys in use are `pk_test_` / `sk_test_`, a **development** instance. These
work on a deployed URL but Clerk treats them as development and may show a
development indicator. A production instance normally expects a custom domain,
which a `*.vercel.app` deployment does not have.

For a portfolio demo the development instance is the pragmatic choice. Confirm
the behaviour on the live URL early rather than discovering it late.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `/healthz` 200 but every `/api` route 503 | A Clerk key is missing or malformed. The message names which variable to check. |
| Every `/api` route 401 despite signing in | `API_URL` wrong on the frontend, or `API_TOKEN` set on one project but not the other. |
| 503 "Database is unavailable" | Atlas network access not open to `0.0.0.0/0`, or the password is not percent-encoded (`@` → `%40`). |
| Function timeout | `maxDuration` is 30s in `server/vercel.json`; the Hobby tier caps lower. Usually an unreachable Atlas cluster rather than slow work. |
