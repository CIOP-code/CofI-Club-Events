# Roadmap

Ideas raised while building this app that haven't been built yet. Not committed to — just a
running list so they don't get lost between sessions. Add to it, reprioritize, or delete items
freely; this is a backlog, not a promise. The same list, grouped identically, is also viewable
in-app: **Admin → Roadmap**, for anyone who doesn't want to read the repo.

Grouped into phases; phases are ordered roughly by size/dependency, not by priority — feel free to
pull something from a later phase forward.

## Phase 1 — Admin Experience *(shipped)*

Turn the single-page admin dashboard into a real multi-section tool.

- **Admin menu (multi-section panel).** Splits the dashboard into a Dashboard section
  (create/manage entities & events) and a Roadmap section, navigable via pills instead of one
  long scroll. Later split further into top-level tabs (Events/Entities/Locations/Utilities/
  Roadmap) with Create/Import/Export sub-tabs, once the single Dashboard section itself grew into
  its own long scroll of eight stacked cards.
- **In-app phased roadmap view.** This list, mirrored inside Admin → Roadmap.
- **Edit entities & events in place.** Pencil-icon edit buttons open a modal instead of requiring
  delete-and-recreate, which used to lose an entity's id/password history or an event's data.
- **"Program" entity type.** A fifth entity type alongside Club/Department/Office/Organization.

## Phase 2 — Event Discovery Quick Wins *(shipped)*

Small, mostly self-contained features inspired by events.brown.edu (LiveWhale Calendar) that make
individual events easier to find, share, and get onto someone's own calendar.

- **Shareable event detail pages.** A real URL per event (e.g. `/event/:id`) instead of only a
  modal inside the SPA, so a link can be texted/posted and opens straight to that event.
- **Add to Calendar (.ics).** One-click download of a standard `.ics` file for a single event — a
  small endpoint that formats one event as iCalendar. Self-contained.
- **Share links.** Copy-link / native share button on the event detail page. Depends on shareable
  event pages existing first.
- **Event search.** Free-text search across all events (title/description/entity), not just the
  existing entity-name filter on the Entities page.
- **Skip-navigation link.** A hidden-until-focused "Skip to content" link at the top of the page
  for keyboard/screen-reader users — standard accessibility practice, and something LiveWhale
  Calendar includes.

## Phase 3 — Calendar Navigation & Filtering *(shipped)*

- ~~**Mini-calendar heat map**~~ / ~~**Jump-to-Day.**~~ *(shipped, combined)* One "Jump to a Date"
  toolbar button opens a compact month-grid modal, days shaded by event density relative to the
  busiest day in view; clicking a day jumps the main calendar there in Day view. Shipped as a
  single widget rather than two, since a heat-shaded date picker is the natural combination.
- ~~**Tags / categories.**~~ *(shipped, in a simpler form)* Events now have a single `event_type`
  (Meeting/Social/Academic/Athletic/Fundraiser/Performance/Other), filterable via the API and used
  in the PDF export (available to everyone, not just admins). Full free-form/multi-tag support (an event tagged with several
  categories at once) is still a possible future upgrade if the fixed list ever proves too narrow.
- ~~**Calendar filtering.**~~ *(shipped)* A filter button on the calendar toolbar narrows the
  visible events by type, entity, location, and (once virtual/hybrid events shipped) format.
  Applies across week/day/month views and persists through navigation; clears itself on leaving
  the calendar page or after 20 minutes idle, and the toolbar button shows a count badge when
  active, so a left-on filter doesn't quietly make events look "missing."
- ~~**Subscribable filtered feed (RSS/iCal).**~~ *(shipped)* `GET /api/feed.ics` returns every
  upcoming event matching the same entity/type/location/format filters as one live VCALENDAR;
  the Filter modal's "Copy Subscribe Link" button builds the URL from whatever's currently
  selected and copies it, ready to paste into Google/Apple/Outlook's "subscribe by URL."

## Phase 4 — Richer Event Types *(shipped)*

- ~~**Recurring events.**~~ *(shipped)* Weekly/monthly series (arbitrary interval, required end
  date, capped at 52 occurrences) with a "this event only" vs "this and following events" choice
  on both edit and delete. Materialized as real rows sharing a `series_id`, not expanded
  on-the-fly, so every other feature (search, the feed, PDF export...) needed zero changes to
  already work with recurring events.
- ~~**Virtual / hybrid events.**~~ *(shipped)* An optional join-link field; "Virtual"/"Hybrid" is
  derived from that link plus whether a location is also set, not its own stored field. Calendar
  tiles show a small icon, the event detail modal gets a "Join Online" button, and the calendar
  filter (and feed) gained a matching format option.

## Phase 5 — Media & Structured Data

- **Image storage infrastructure.** Reintroduces file storage (deliberately dropped earlier): an
  R2 bucket bound in `wrangler.toml` for both prod and preview, an upload endpoint, and rewriting
  the currently-stubbed `functions/api/files/[key].js` (currently `410 Gone`) to serve from R2.
- **Entity logo upload.** Replace the current icon-plus-initial with an actual uploaded image,
  once image storage exists.
- **Event poster images.** Photo-forward event cards, also depends on image storage.
- **schema.org structured data.** Embed Event/Organization JSON-LD on event/entity pages so search
  engines and calendar aggregators can read them — pairs naturally with shareable event pages and
  poster images.

## Phase 6 — Admin & Governance

- **Admin-managed kiosk settings.** `/display.html`'s day count is currently a URL parameter
  (`?days=N`) set once at TV setup — deliberately simple. Would become a real admin-panel setting
  if that stops being a one-time thing (e.g. multiple screens needing different settings).
- **Per-person entity logins / audit trail.** Entities currently share one password per
  organization, which suits how they're used today (the account represents the org, persists
  across leadership turnover, with the admin password-reset flow handling handoffs). Would need
  named per-person logins if tracking who specifically posted each event ever becomes important —
  a bigger change, not scoped out.
- ~~**Self-service admin password reset.**~~ *(shipped)* Previously, a forgotten admin password
  could only be recovered by deleting the `admin` row directly in D1 (needing Cloudflare/`wrangler`
  access, not just the app) — a real continuity risk for a single shared institutional account. A
  "Forgot password?" link on the admin login page now emails a one-time reset link (30-minute
  expiry, single-use, token stored only as a SHA-256 hash) to the recovery address configured in
  Admin → Utilities → Notifications. Only actually solves succession if that address is
  institutional (a shared inbox, an IT alias) rather than any one person's — see `SECURITY.md`.
- **Usage analytics dashboard.** Turn the admin Dashboard tab into an actual dashboard: event
  count, how many entities have posted at least one event, PDF export count, and app views broken
  down by device (mobile vs desktop). Nothing today records page views or exports at all, so this
  needs a new lightweight events-log table (e.g. `event_type` + `device_type` + timestamp, no IP
  or other identifying data — aggregate counts only, consistent with this app's existing
  no-tracking posture) plus a beacon call added wherever a view/export should count, and an admin
  API endpoint to summarize it. Open question before building: stat tiles (simple totals, maybe
  with a "last 30 days" breakdown) vs real trend charts — the latter needs a charting library
  added and SRI-pinned the same way jsPDF was.
- ~~**Feedback / bug report tool.**~~ *(shipped)* A floating "Feedback" button on every page opens
  a modal (bug/suggestion/other + message + optional reply-to email), stored in a new `feedback`
  table with no login required to submit. Reviewed under Admin → Roadmap → Suggestions & Feedback
  (deleting an item is the "handled" action — no separate status field). Sends an email via Resend
  (a plain `fetch()` call, no SDK, matching this app's no-server-side-npm-dependencies rule) to the
  address set in Admin → Utilities → Notifications, if one is configured; if `RESEND_API_KEY` isn't
  set or the send fails, feedback is still stored and the submitter still sees success — email is a
  best-effort notification, never a dependency for the feature to work.

## Shipped

See [CHANGELOG.md](./CHANGELOG.md) for the full history of what's already built.
