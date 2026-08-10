# Changelog

Notable changes to Campus Events, newest first. Each entry links the PR that shipped it.

## 2026-08-10

- **Roadmap Phase 2: event detail links, .ics export, share links, search, skip-nav** ([#13](https://github.com/CIOP-code/CofI-Club-Events/pull/13)) — Clicking an event now pushes a real `/event/:id` URL (back/forward and direct loads work too); a "Add to Calendar" button downloads a standard `.ics` file per event; a "Copy Link" button copies the event's shareable URL; a search icon in the calendar header finds upcoming events by title/description/entity name; a "Skip to content" link (visible on keyboard focus) was added for accessibility.
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
