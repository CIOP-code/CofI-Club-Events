# Campus Events – College of Idaho

**What's Happening @ College of Idaho?**

A full-stack web application for discovering and managing campus events at the College of Idaho, built entirely on the Cloudflare developer platform.

## Live URLs
| Environment | URL |
|---|---|
| Production (planned) | `clubevents.collegeofidaho.edu` |
| Staging / workers.dev | `club-events.pages.dev` |

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, Bootstrap 5, Font Awesome 6, Vanilla JS (SPA) |
| Backend | Cloudflare Pages Functions (Workers) |
| Database | Cloudflare D1 (SQLite at the edge) |
| File Storage | Not used — entity logos replaced with icons; events use campus locations stored in D1 |
| Auth | PBKDF2 password hashing + HS256 JWT tokens |

## Concepts

The app is administered by a single **College of Idaho Admin** account (not a student senate). Any campus
organization — a student club, an academic department, an administrative office, or another organization
like ASCI — is represented as an **entity**. Each entity has a `type` (`club`, `department`, `office`, or
`organization`) used to group and filter it in the UI, but otherwise every entity works identically: it logs
in with its own password and can create/manage its own events.

## Features

### Home – Event Calendar
- **Week view** (desktop): 7-day time grid, each day as a 24-hour vertical column
- **Day view** (mobile/tablet): single-day time grid
 - Event blocks show title and organizing entity; click to open a detail modal with event details and location
- Navigate by day or week; jump back to "Today" at any time

### Entities
- Grid of all registered entities (clubs, departments, offices, organizations) with icons and names
- Live filter/search bar plus a type filter (Club / Department / Office / Organization)
- Click any entity tile to log in with the entity password
 - After login: create new events (title, description, location, start/end datetime)
- Change entity password while logged in
- Any admin-assigned password (a new entity's default password, or an admin-triggered reset) must be
  changed before the entity can use the app further — the change-password prompt appears immediately
  after login and can't be dismissed until a new password is set

### Admin (College of Idaho Admin)
- Admin login (default password set via `ADMIN_PASSWORD` environment variable)
 - Create new entities (name, type, default password) — entity logos are represented by icons
- Create events on behalf of any entity
- Edit and delete entities, events, and locations
- Reset an entity's password (e.g. when its point of contact changes) — generates a fresh temporary
  password shown once, and forces the entity to set its own on next login

### About
- App description and usage guide
- Built by [Rabin Kalikote](https://rabinkalikote.com)

## Project Structure

```
Club-Events/
├── public/                   # Cloudflare Pages static assets
│   ├── index.html            # SPA shell
│   ├── css/style.css         # Custom styles
│   └── js/app.js             # Frontend SPA logic
├── functions/                # Cloudflare Pages Functions (Workers)
│   ├── api/
│   │   ├── _middleware.js    # CORS + JWT auth middleware
│   │   ├── events.js         # GET/POST /api/events
│   │   ├── events/[id].js    # GET/PUT/DELETE /api/events/:id
│   │   ├── entities.js       # GET/POST /api/entities
│   │   ├── entities/[id].js  # GET/PUT/DELETE /api/entities/:id
│   │   ├── auth/
│   │   │   ├── entity.js          # POST /api/auth/entity
│   │   │   ├── admin.js           # POST /api/auth/admin
│   │   │   └── change-password.js # POST /api/auth/change-password
│   │   ├── locations.js     # GET/POST /api/locations
│   └── utils/
│       ├── jwt.js            # JWT sign/verify (Web Crypto API)
│       └── crypto.js         # PBKDF2 password hashing
├── schema.sql                # D1 database schema
├── wrangler.toml             # Cloudflare configuration
└── package.json
```

## Setup & Deployment

### Prerequisites
- [Cloudflare account](https://dash.cloudflare.com)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) v3+

### 1. Create D1 database
```bash
wrangler d1 create club-events-db
# Copy the database_id into wrangler.toml
wrangler d1 execute club-events-db --file=schema.sql
```

If you're migrating an existing database from the previous "clubs" schema, run the migration statements
at the bottom of `schema.sql` instead of the full `CREATE TABLE` script.

### 2. (Optional) Seed locations

You can pre-populate the `locations` table via the D1 console or by using the `/api/locations` endpoint.

### 3. Set secrets
```bash
wrangler pages secret put JWT_SECRET
wrangler pages secret put ADMIN_PASSWORD
wrangler pages secret put RESEND_API_KEY
```
`RESEND_API_KEY` is optional — it powers the notification email for the feedback tool (Admin →
Utilities → Notifications sets the destination address). Without it, feedback submissions still
save normally; the app just can't email anyone about them. Get a key at
[resend.com](https://resend.com) (free tier is plenty for this).

This sets all three for **Production only**. Preview deployments (PRs/branches) are a separate
Cloudflare Pages environment with a separate secret store — set them for Preview too, in the
dashboard under Pages project → Settings → Environment variables → Preview tab, or every preview
deployment's login will fail with "Server misconfigured: JWT_SECRET is not set" (`RESEND_API_KEY`
being missing there just means preview feedback submissions won't send an email, same as prod).

### 4. Deploy
```bash
npm install
wrangler pages deploy public
```

### 5. First login
Navigate to **/admin** and log in with the `ADMIN_PASSWORD` value you set above.
The admin account is bootstrapped automatically on first login.

Once logged in, set a recovery email under **Admin → Utilities → Notifications** — this powers
both the feedback-tool notifications and a "Forgot password?" self-service reset link on the
admin login page. For institutional continuity (e.g. staff turnover), point it at a shared
department inbox or IT alias rather than one person's individual email — see `SECURITY.md`'s
"Recommendations for IT" for why that distinction matters.

### 6. (Optional) Bulk-import entities
The **Bulk Import Entities** card on the Admin Dashboard is the easiest way to do this: paste one
name per line, pick a type, and it creates them all through the same validation as creating one by
hand, then offers a CSV of the generated temporary passwords to download.

For scripted/repeatable imports instead, `scripts/seed-entities.mjs` does the same thing from the
command line against a JSON file (see `scripts/clubs-2025-2026.json` for the shape/example):
```bash
ADMIN_PASSWORD=... node scripts/seed-entities.mjs scripts/clubs-2025-2026.json --base-url https://your-site.pages.dev
```
Either way, each entity gets a random temporary password (forced to change on first login, same as
any admin-created entity); already-existing names are skipped, not treated as a failure, so it's
safe to re-run. The CLI version writes `scripts/seed-results-<timestamp>.csv` (git-ignored) mapping name → temporary password —
handle it like the credentials it is, and delete it once distributed.

The **Bulk Import Locations** card works the same way for the shared location list (one name per
line, no password/type involved since locations don't have their own login).

## Development
Create a `.dev.vars` file (git-ignored) in the project root with:
```
JWT_SECRET=dev-secret-change-in-production
ADMIN_PASSWORD=CollegeOfIdaho2024!
RESEND_API_KEY=re_...
```
`JWT_SECRET` and `ADMIN_PASSWORD` are required — there's no built-in fallback, so login endpoints
return a 500 without this file (or the equivalent secrets in a deployed environment). See
[SECURITY.md](./SECURITY.md) for why. `RESEND_API_KEY` is optional (see step 3 above) — omit it
locally and feedback-form testing still works, just without a real email going out.

```bash
wrangler pages dev public --d1=DB
```

Preview deployments (from PRs/branches) use a separate `club-events-db-preview` D1 database from production, configured via `[env.preview]` in `wrangler.toml`.

---
Built by [Rabin Kalikote](https://rabinkalikote.com)
