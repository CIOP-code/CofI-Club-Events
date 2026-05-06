# Club Events – College of Idaho

**What's Happening @ College of Idaho?**

A full-stack web application for discovering and managing club events at the College of Idaho, built entirely on the Cloudflare developer platform.

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
| File Storage | Not used — club logos replaced with icons; events use campus locations stored in D1 |
| Auth | PBKDF2 password hashing + HS256 JWT tokens |

## Features

### Home – Event Calendar
- **Week view** (desktop): 7-day time grid, each day as a 24-hour vertical column
- **Day view** (mobile/tablet): single-day time grid
 - Event blocks show title and organizing club; click to open a detail modal with event details and location
- Navigate by day or week; jump back to "Today" at any time

### Clubs
- Grid of all registered clubs with logos and names
- Live filter/search bar
- Click any club tile to log in with the club password
 - After login: create new events (title, description, location, start/end datetime)
- Change club password while logged in

### Senate (Admin)
- Admin login (default password set via `ADMIN_PASSWORD` environment variable)
 - Create new clubs (name, default password) — club logos are represented by icons
- Create events on behalf of any club
- Delete clubs and events

### About
- App description and usage guide
- Built by [Rabin Kalikote](https://rabinkalikote.com)

## Project Structure

```
Club-Events/
├── public/                   # Cloudflare Pages static assets
│   ├── index.html            # SPA shell
│   ├── _redirects            # Cloudflare Pages SPA fallback
│   ├── css/style.css         # Custom styles
│   └── js/app.js             # Frontend SPA logic
├── functions/                # Cloudflare Pages Functions (Workers)
│   ├── api/
│   │   ├── _middleware.js    # CORS + JWT auth middleware
│   │   ├── events.js         # GET/POST /api/events
│   │   ├── events/[id].js    # GET/PUT/DELETE /api/events/:id
│   │   ├── clubs.js          # GET/POST /api/clubs
│   │   ├── clubs/[id].js     # GET/PUT/DELETE /api/clubs/:id
│   │   ├── auth/
│   │   │   ├── club.js            # POST /api/auth/club
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
Navigate to **/senate** and log in with the `ADMIN_PASSWORD` value you set above.
The admin account is bootstrapped automatically on first login.

## Development
```bash
wrangler pages dev public --d1=DB
```

---
Built by [Rabin Kalikote](https://rabinkalikote.com)

