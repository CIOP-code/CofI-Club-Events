# Security

This document describes the security measures in place for Campus Events, for College of Idaho
IT's reference. It's meant to be read alongside the code, not instead of it — every claim below
points at the file that implements it.

## Architecture summary

Campus Events runs entirely on Cloudflare's platform: static assets and API routes on Cloudflare
Pages (with Pages Functions for the backend), data in Cloudflare D1 (SQLite at the edge). There is
no separate application server, no VM, and no third-party hosting — the attack surface is what
Cloudflare exposes plus this repo's own code. There is currently no file/image upload capability
(`functions/api/upload.js` and `functions/api/files/[key].js` are both stubbed to `410 Gone`), which
removes a whole category of risk (malicious file upload, storage misconfiguration) until that
feature is reintroduced (tracked in `ROADMAP.md`, Phase 5).

## Authentication

- **Password hashing** (`functions/utils/crypto.js`): PBKDF2-HMAC-SHA256, 100,000 iterations, a
  random 32-byte salt per password, stored as `password_hash`/`salt` — never plaintext. Password
  verification uses a constant-time comparison (`verifyPassword`) to avoid timing side-channels.
- **Sessions**: signed JWTs (`functions/utils/jwt.js`), HMAC-SHA256, verified on every request that
  carries a token. Tokens expire after 24 hours (`signToken`'s default) and carry only
  non-sensitive identifiers in the payload (`type`, `entity_id`, `entity_name` — no password data,
  which wouldn't matter anyway since JWT payloads are signed, not encrypted, and are never assumed
  to be secret).
- **Token storage**: tokens live only in an in-memory JS object (`state` in `public/js/app.js`) —
  never written to `localStorage`, `sessionStorage`, or a cookie. This means every page reload
  requires logging in again, which is a deliberate trade-off: it shrinks the window in which a
  successful XSS could exfiltrate a token (nothing persists to storage for a script to read after
  the fact) at the cost of session convenience.
- **Two roles, not accounts-per-person**: a single **admin** account (College of Idaho staff) and
  one shared login per **entity** (club/department/office/organization/program). This isn't
  accidental — seeing who *specifically* posted an event isn't currently a requirement, and a
  shared account survives leadership turnover without re-issuing individual credentials. If a named
  per-person audit trail becomes a requirement, that's a real model change, tracked as a roadmap
  item (Phase 6) rather than done partially.
- **Secrets have no insecure fallback** (`functions/utils/env.js`, used by `_middleware.js` and
  `functions/api/auth/{admin,entity}.js`): `JWT_SECRET` and `ADMIN_PASSWORD` must be set via
  `wrangler pages secret put` in production (or `.dev.vars` locally). Earlier versions of this code
  fell back to a hardcoded value committed in this public repo if the secret wasn't configured —
  meaning a deployment that forgot to set it would silently accept forged admin tokens or the
  well-known default password instead of failing. That fallback has been removed; a missing secret
  now returns a `500` instead of running insecurely.

## Authorization

Every mutating endpoint checks the caller's role and, where relevant, ownership, server-side (the
frontend hiding a button is not treated as access control):

| Action | Who |
|---|---|
| Create/delete an entity, reset an entity's password | Admin only |
| Edit an entity | Admin, or that entity itself |
| Create an event on behalf of an entity | Admin, or that entity itself |
| Edit/delete an event | Admin, or the entity that owns it |
| Create a location | Any logged-in entity or admin |
| View events/entities | Public, no login required |

See the `onRequestPost`/`onRequestPut`/`onRequestDelete` handlers in `functions/api/entities.js`,
`functions/api/entities/[id].js`, `functions/api/events.js`, and `functions/api/events/[id].js` for
the exact checks.

## Rate limiting

`functions/utils/rateLimit.js` tracks failed login attempts (both `/api/auth/admin` and
`/api/auth/entity`) in D1, keyed by the connecting IP (`CF-Connecting-IP`, which Cloudflare sets
from the actual TCP connection and a client cannot spoof) and endpoint. After 8 failed attempts
within a 15-minute window, further attempts get a `429` until the window ages out. This is an
app-level backstop; **we recommend IT additionally configure Cloudflare's edge-level Rate Limiting
Rules** for `/api/auth/*`, since that rejects abusive traffic before it reaches this code at all
and isn't dependent on D1 being reachable. If the `login_attempts` table isn't present (e.g. this
migration hasn't been applied to an older deployment yet), rate limiting fails *open* — logins
still work, just without the backstop — rather than breaking login entirely.

## Injection & XSS

- **SQL injection**: every database query uses parameterized placeholders (`.bind(...)`) — there is
  no string concatenation of user input into SQL anywhere in `functions/`. Verified by inspection
  of every `env.DB.prepare(...)` call site.
- **Cross-site scripting**: all server-supplied text (event titles/descriptions, entity/location
  names) that gets inserted into the DOM via `innerHTML` is passed through `escHtml()` in
  `public/js/app.js` first. Where content is set via `.textContent` instead (e.g. the event detail
  modal), no escaping is needed since `textContent` never parses HTML.
- **Content-Security-Policy** (`public/_headers`) is a second layer on top of that: even if an
  escaping mistake were introduced later, `script-src 'self' https://cdn.jsdelivr.net` means an
  injected `<script>` tag or inline event handler can't execute, since no inline scripts are used
  or allowed. `style-src` does allow `'unsafe-inline'` — this app renders per-event colors and
  layout via inline `style="..."` attributes (`public/js/app.js`), and removing that would mean a
  larger refactor to CSS custom properties; it's a deliberate, narrower trade-off than allowing
  inline scripts.

## Security headers

Set globally via `public/_headers` (applies to both static pages and `/api/*` Function responses):

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | see `public/_headers` | Restricts script/style/font/image/connect sources to this origin plus the two CDNs actually used |
| `X-Frame-Options` | `DENY` | Prevents this site being framed elsewhere (clickjacking) |
| `X-Content-Type-Options` | `nosniff` | Stops browsers from MIME-sniffing responses into an executable type |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits what's leaked in the `Referer` header on outbound links |
| `Permissions-Policy` | geolocation/camera/microphone/payment/usb all disabled | This app uses none of these; explicitly denying them removes them as an attack surface even in a future bug |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Forces HTTPS on repeat visits; Cloudflare Pages already serves HTTPS-only, this pins it at the browser level too |

## Third-party dependencies / supply chain

- **No server-side npm dependencies** — the backend is plain JS using only Web Crypto (built into
  the Workers runtime) and D1's own driver. `wrangler` is a dev-only tool, never shipped.
- **Frontend CDN assets are pinned with Subresource Integrity** (`integrity="sha384-..."` on the
  Bootstrap and Font Awesome `<link>`/`<script>` tags in `public/index.html` and `public/404.html`).
  If jsdelivr ever served something other than the exact published bytes for that version — a
  compromised CDN, a MITM without SRI — the browser refuses to run it rather than executing it
  silently. Font Awesome was moved from cdnjs to jsdelivr's npm mirror specifically so its hash
  could be verified directly against the published npm package rather than trusted blind.
- Google Fonts is not pinned with SRI — that's a deliberate omission, not an oversight: Google
  Fonts' CSS response is intentionally negotiated per user-agent (different `@font-face` rules for
  different browsers), so it has no single fixed hash to pin.

## Error handling

API error responses return a generic `"Internal server error"` for unexpected failures rather than
the raw exception message (`functions/api/**/*.js`, `catch` blocks) — the previous behavior of
returning `err.message` directly could leak SQLite internals (table/column names) to any client.
The real error is still logged server-side via `console.error`, visible to whoever operates the
deployment through Cloudflare's Functions logs, just not returned in the response body. The couple
of deliberately-specific error messages that remain (e.g. "An entity with that name already
exists", "Password must be at least 8 characters") are hand-written, safe strings — not raw driver
output.

## Password policy

Minimum 8 characters, enforced both client-side (`minlength="8"` on the relevant inputs) and
server-side (`functions/api/entities.js`, `functions/api/auth/change-password.js`) — client-side
validation alone is never trusted, since it's trivially bypassed. Admin-generated temporary
passwords (`functions/api/entities/[id]/reset-password.js`) are 12 random characters from a
58-character alphabet (~70 bits of entropy), well above the minimum, and forced to be changed on
next login (`must_change_password`).

## Data isolation

Preview deployments (from PRs/branches) use a separate D1 database (`club-events-db-preview`) from
production, configured via `[env.preview]` in `wrangler.toml` — testing in a PR preview cannot
pollute or leak real production data.

This isolation extends to secrets, not just the database: `JWT_SECRET` and `ADMIN_PASSWORD` set
for Production in the Cloudflare dashboard do **not** apply to Preview deployments — Cloudflare
Pages treats them as separate environments with separate secret stores. Both need to be set for
Preview too (Pages project → Settings → Environment variables → Preview tab), or preview logins
fail outright with "Server misconfigured: JWT_SECRET is not set" (see `functions/utils/env.js`) —
which is exactly the deliberate fail-closed behavior this hardening pass added, working as
intended rather than indicating data loss.

## Known limitations & accepted trade-offs

Being upfront about what this does *not* do, and why:

- **CORS is wide open** (`Access-Control-Allow-Origin: *` in `functions/api/_middleware.js`). This
  is safe *because* auth is bearer-token-only with no cookie/session fallback that a
  cross-origin request could ride on — a script on another origin can't obtain a valid token just
  because CORS allows the request. It would need to be revisited if cookie-based auth is ever
  added.
- **No multi-factor authentication.** Both admin and entity logins are single-factor
  (password only). Given the low sensitivity of the data (public event listings) and the small,
  known user base (campus offices/clubs), this is a reasonable current trade-off, not an oversight.
- **No captcha/bot-challenge on login.** Rate limiting (above) covers brute force; nothing here
  stops scripted *distributed* attempts across many IPs. Cloudflare's Bot Fight Mode (dashboard
  setting, not application code) is the recommended mitigation if this becomes a concern.
- **No automated dependency/vulnerability scanning configured in CI.** There's very little to scan
  (no server-side npm dependencies), but GitHub's Dependabot could still be enabled for the
  `wrangler` devDependency and any future additions.

## Recommendations for IT

Things that improve this app's security posture but live in Cloudflare's dashboard rather than
this codebase, so they're IT's call to make, not something a PR can turn on:

1. **Cloudflare Rate Limiting Rules** on `/api/auth/*`, as noted above — belt-and-suspenders with
   the app-level limiter.
2. **Cloudflare Access (Zero Trust)** in front of `/admin`, requiring College of Idaho SSO before
   the app's own admin login is even reachable — a strong second factor at the network edge for the
   highest-privilege account, without any application code changes.
3. **Bot Fight Mode / WAF managed rules**, standard baseline hardening for any public Cloudflare
   site.
4. Confirm `JWT_SECRET` and `ADMIN_PASSWORD` are set as **Cloudflare secrets** (not plaintext vars)
   for the production environment, and are strong, unique values — not the local-dev placeholders
   documented in `README.md`.
