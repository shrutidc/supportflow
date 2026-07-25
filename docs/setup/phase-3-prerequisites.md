# Phase 3 prerequisites — MongoDB Atlas & Clerk

Two accounts must exist before Phase 3 (authentication + multi-tenancy) can
start. Both are free at the tier we need.

> **Never paste secrets into chat, issues, or commits.** Every value below
> goes directly into a local `.env` file, which is gitignored.

---

## 1. MongoDB Atlas

Today the app falls back to an in-memory database, so **all data is lost on
every restart**. A real cluster is required for persistence, and later for
Atlas Vector Search (Phase 5).

### Steps

1. **Create an account** at <https://www.mongodb.com/cloud/atlas/register>.
2. **Create a project** (e.g. `SupportFlow`).
3. **Deploy a cluster**
   - Tier: **M0 (free)** is enough for development and supports Atlas
     Vector Search.
   - Provider/region: pick the region closest to where the API will deploy
     (Railway) to keep latency low.
4. **Create a database user** (Security → Database Access → Add New User)
   - Auth: password. Use Atlas's **Autogenerate Secure Password** and copy it.
   - Role: `Read and write to any database` (tighten to the `supportflow`
     database once created).
   - ⚠️ If the password contains `@ : / ? # [ ] %`, it must be
     **percent-encoded** in the connection string (e.g. `@` → `%40`).
5. **Allow network access** (Security → Network Access → Add IP Address)
   - Local development: *Add Current IP Address*.
   - Deployment: Railway does not guarantee static egress IPs, so hosted
     access typically needs `0.0.0.0/0`. That makes the password the only
     control — keep it long and unique, and prefer per-environment users.
6. **Copy the connection string** (Cluster → Connect → Drivers → Node.js).
   It looks like:
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`
7. **Add the database name** before the `?`: `.../supportflow?retryWrites=...`
8. **Write it into `server/.env`** (create from `server/.env.example` if
   missing):
   ```bash
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/supportflow?retryWrites=true&w=majority
   ```
9. **Seed and verify**:
   ```bash
   cd server
   npm run seed     # wipes and loads the 20 demo tickets
   npm start        # log should read: MongoDB connected, source "uri"
   ```
   If the log says `source: "in-memory"`, the URI was not picked up.

### What to hand over

Nothing — the URI stays in your local `.env`. Just confirm the startup log
shows `source: "uri"`.

---

## 2. Clerk

Clerk provides users, organizations, memberships, and roles — the backbone of
Phase 3 multi-tenancy.

### Steps

1. **Create an account** at <https://clerk.com>.
2. **Create an application** (e.g. `SupportFlow`).
   - Sign-in methods: **Email** at minimum; Google is a convenient addition.
3. **Enable Organizations** — this is the critical setting. In the Clerk
   dashboard, find **Organizations** (under Configure) and turn it on.
   Without it there are no workspaces to isolate data by.
4. **Review organization roles.** Clerk ships `admin` and `member`. Our domain
   model wants **agent / manager / administrator**; we will either add custom
   roles (if your plan allows) or map our three roles onto Clerk's two plus a
   role field in our own membership records. Note which your plan supports.
5. **Copy the API keys** (dashboard → API Keys). You need two:
   - Publishable key — `pk_test_…` (safe for the browser)
   - Secret key — `sk_test_…` (**server only, never in client code**)
6. **Write them into local env files**:

   `apps/web/.env.local` (create it; already gitignored by Next.js):
   ```bash
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   ```

   `server/.env` (the API verifies session tokens):
   ```bash
   CLERK_SECRET_KEY=sk_test_...
   CLERK_PUBLISHABLE_KEY=pk_test_...
   ```

### What to hand over

Nothing secret. Just confirm: Organizations enabled ✅, keys are in the two
env files ✅, and which roles your plan allows.

---

## Confirmed configuration (2026-07-25)

Atlas and Clerk are both live and verified.

- **Atlas**: cluster `cluster0.fy9dcdu`, database `supportflow`, user
  `supportflowUser`. Verified end to end: seeded 20 tickets, mutated one via
  the API, restarted the server, and read the change back from Atlas.
  - *Follow-up for Phase 10*: `supportflowUser` currently holds
    `atlasAdmin@admin`. Production should use a separate user scoped to
    `readWrite` on the `supportflow` database only.
- **Clerk**: application `SupportFlow`, development instance, Hobby plan.
  Organizations (Multi-tenancy B2B) enabled, **membership required** (every
  user must belong to an organization — this is what makes isolation
  enforceable). All three roles created.

### Role mapping

SupportFlow's three domain roles map onto Clerk org roles directly, so Clerk
stays the single source of truth for role assignment — we do not duplicate a
role field in our own records.

| SupportFlow role | Clerk role key | Responsibilities |
| --- | --- | --- |
| Administrator | `org:admin` | Workspace settings, billing, member management. |
| Manager | `org:manager` | Reporting, reassignment, workflow approval. |
| Agent | `org:member` | Default for new members: work tickets, reply, claim. |

Authorization is enforced in our API against the **role key** from the
verified session, not against Clerk's own permission entries. `org:manager`
therefore needs no Clerk permissions attached for our checks to work. (If we
later use Clerk's `has({ permission })` helpers, Manager must first be given
at least the permissions `org:member` has, or it would be *less* privileged
than an Agent.)

## Where each value goes (quick map)

Both files are gitignored. Create them from the matching `.example` file if
they do not exist.

| Value | File | Variable |
| --- | --- | --- |
| MongoDB connection string | `server/.env` | `MONGODB_URI` |
| Clerk publishable key | `server/.env` | `CLERK_PUBLISHABLE_KEY` |
| Clerk secret key | `server/.env` | `CLERK_SECRET_KEY` |
| Clerk publishable key | `apps/web/.env.local` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` |
| Clerk secret key | `apps/web/.env.local` | `CLERK_SECRET_KEY` |

The Clerk keys are the *same two values* pasted into both files: the Next.js
app needs them to render sign-in UI and read the session, the Express API
needs them to verify session tokens server-side.

Templates: `server/.env.example`, `apps/web/.env.example`.

## Notes

- Development (`pk_test`/`sk_test`) and production (`pk_live`/`sk_live`) keys
  are different. Use test keys now; production keys arrive at deployment.
- Rotate any credential that has ever been committed to git history. The
  previous `server/.env` was committed and pushed, so its Atlas password must
  be considered public — use a brand-new cluster user, not the old one.
