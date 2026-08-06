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

### Admin (College of Idaho Admin)
- Admin login (default password set via `ADMIN_PASSWORD` environment variable)
 - Create new entities (name, type, default password) — entity logos are represented by icons
- Create events on behalf of any entity
- Delete entities and events

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
```

### 4. Deploy
```bash
npm install
wrangler pages deploy public
```

### 5. First login
Navigate to **/admin** and log in with the `ADMIN_PASSWORD` value you set above.
The admin account is bootstrapped automatically on first login.

## Development
```bash
wrangler pages dev public --d1=DB
```

---
Built by [Rabin Kalikote](https://rabinkalikote.com)
