# Changelog

Notable changes to Campus Events, newest first. Each entry links the PR that shipped it.

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
