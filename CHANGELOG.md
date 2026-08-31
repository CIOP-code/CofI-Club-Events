# Changelog

Notable changes to Campus Events, newest first. Each entry links the PR that shipped it.

## 2026-08-12

- **Event types + PDF export for everyone** ([#15](https://github.com/CIOP-code/CofI-Club-Events/pull/15)) — Events now have a single `event_type` (Meeting/Social/Academic/Athletic/Fundraiser/Performance/Other), filterable via the API. A PDF export button is now on the public calendar toolbar too (previously admin-only), sharing the same date-range/type filters.
- **Admin panel reorganized into tabs** — the Dashboard's eight stacked cards became top-level tabs (Events/Entities/Locations/Utilities/Roadmap) with Create/Import/Export sub-tabs. New: Bulk Import Events (pipe-delimited paste), Create Location (previously only reachable indirectly), and a Kiosk View link under Utilities. Fixed a bug where `ensureLocation()` failed instead of resolving to an existing location's id on a 409, breaking bulk imports and the "new location" field whenever the location already existed.
- **Public feedback/bug-report tool** — a floating Feedback button on every page (no login required) stores submissions, reviewed under Admin → Roadmap → Suggestions & Feedback, and emails a configurable recovery address (Admin → Utilities → Notifications) via Resend. Rate-limited like the login endpoints, since it's the app's only public unauthenticated write endpoint.
- **Self-service admin password reset** — a "Forgot password?" link on the admin login page emails a one-time reset link (30-minute expiry, single-use, stored only as a hash), reusing the same notify-email/Resend setup as feedback. Solves the "what if the admin leaves" continuity problem, as long as the recovery address is institutional rather than personal.
- **Calendar filtering + Jump to a Date** — a filter button narrows the calendar by type/entity/location/format, persisting through navigation and clearing itself after 20 minutes idle or on leaving the calendar page. A combined "Jump to a Date" widget replaces the separate mini-calendar-heatmap/jump-to-day roadmap ideas: a month grid shaded by event density that jumps to whichever day you click.
- **Subscribable filtered feed** — `GET /api/feed.ics` returns a live-updating VCALENDAR honoring the same filters as the calendar; a "Copy Subscribe Link" button builds the URL to paste into Google/Apple/Outlook.
- **Virtual/hybrid events** — an optional meeting-link field; "Virtual"/"Hybrid" is derived from that link plus whether a location is set, shown as a small icon on calendar tiles and a "Join Online" button on the event detail modal.
- **Recurring events** — weekly/monthly series (capped at 52 occurrences, required end date) with a "this event only" vs "this and following" choice on edit/delete. Materialized as real rows sharing a series id, so every other feature (search, the feed, PDF export) works with them unchanged.

## 2026-08-10

- **Security hardening pass + SECURITY.md** ([#14](https://github.com/CIOP-code/CofI-Club-Events/pull/14)) — Removed a hardcoded fallback for `JWT_SECRET`/`ADMIN_PASSWORD` that would silently activate (accepting forged admin tokens / the default password) if those secrets weren't configured. Added D1-backed rate limiting on both login endpoints, stopped leaking raw exception messages in API errors, added security response headers (CSP, HSTS, etc.) via `public/_headers`, pinned Bootstrap/Font Awesome CDN assets with Subresource Integrity, and raised the minimum password length to 8 characters. New `SECURITY.md` documents the app's full security posture for IT review.
- **Roadmap Phase 2: event detail links, .ics export, share links, search, skip-nav** ([#13](https://github.com/CIOP-code/CofI-Club-Events/pull/13)) — Clicking an event now pushes a real `/event/:id` URL (back/forward and direct loads work too); an "Add to Calendar" button downloads a standard `.ics` file per event; a "Copy Link" button copies the event's shareable URL; a search icon in the calendar header finds upcoming events by title/description/entity name; a "Skip to content" link (visible on keyboard focus) was added for accessibility. Also fixes `.ics` files failing to import in Outlook: it rejected the `TZID=America/Boise` reference because that timezone was never actually defined in the file (Google/Apple tolerate a bare IANA TZID; Outlook doesn't) — added the standard Mountain Time `VTIMEZONE` block plus RFC 5545 line folding.
- **Program entity type, admin edit UI, admin menu + roadmap view** ([#12](https://github.com/CIOP-code/CofI-Club-Events/pull/12)) — Added `program` as a fifth entity type. Added edit (not just delete) for entities and events in the admin panel, which also fixed a bug where clearing an event's location silently kept the old one. Split the admin dashboard into a Dashboard section and a new in-app Roadmap section mirroring `ROADMAP.md`.

## 2026-08-07

- **College of Idaho logo in the sidebar** ([#8](https://github.com/CIOP-code/CofI-Club-Events/pull/8)) — Added above the nav buttons, positioned directly above them with no gap.
- **Location double-booking validation** ([#7](https://github.com/CIOP-code/CofI-Club-Events/pull/7)) — `POST /api/events` and `PUT /api/events/:id` now reject (409) an overlapping location+time conflict instead of silently allowing it, with a message naming the conflicting event. Back-to-back bookings (no time overlap) are still allowed.

## 2026-08-06

- **Kiosk display page** ([#5](https://github.com/CIOP-code/CofI-Club-Events/pull/5)) — Standalone, read-only `/display.html` for a TV in a public space: today + next N days (`?days=N`, default 3), auto-refreshing, no login/admin surface at all.
- **Calendar: mobile cramping fix, day strip, month view, event colors/overlap** ([#4](https://github.com/CIOP-code/CofI-Club-Events/pull/4))
  - Fixed week view being forced into a cramped 7-column grid between 768–991px; single-day view now holds through 991px to match the app shell's own breakpoint, and no longer gets stuck after a resize.
  - Added a swipeable day strip (day view) and a dot-per-day Month view.
  - Fixed entity colors colliding when ids ended up spaced exactly `PALETTE.length` apart (e.g. after creating/deleting test entities) — colors are now assigned by id-sorted position and stay stable across views.
  - Overlapping events now lay out side-by-side (capped at 3 columns + a "+N more" tile) instead of stacking and hiding all but one.
  - Different entities with visually similar colors now differentiate automatically when they share a time slot.
  - Admin nav item moved to the bottom of the sidebar/mobile nav, de-emphasized.
  - Trimmed the About page (removed Technology Stack / Deployment sections).
- **Entity password management** ([#3](https://github.com/CIOP-code/CofI-Club-Events/pull/3)) — Entities are now required to set their own password on first login (default/admin-assigned passwords no longer just... work forever). Added an admin-only password reset endpoint for handing off an entity when its point of contact changes.
- **Preview/production database isolation** ([#2](https://github.com/CIOP-code/CofI-Club-Events/pull/2)) — Preview deployments now use a separate D1 database (`club-events-db-preview`) from production, configured via `[env.preview]` in `wrangler.toml`. Previously preview and production shared one database, so testing in a PR preview could pollute real data.
- **Senate/Clubs → College of Idaho Admin/Entities refactor** ([#1](https://github.com/CIOP-code/CofI-Club-Events/pull/1)) — Broadened the core model: the app is no longer Senate-run with only clubs. It's administered by a single College of Idaho Admin, and any campus organization (club, department, office, or other organization) is an **entity** with a `type` for filtering.

## Earlier

Pre-dates this log — see `git log` for the initial build (Cloudflare Pages + Workers + D1 SPA, calendar week/day view, club/event CRUD, styling passes).
