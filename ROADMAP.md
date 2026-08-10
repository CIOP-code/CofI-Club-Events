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
  long scroll.
- **In-app phased roadmap view.** This list, mirrored inside Admin → Roadmap.
- **Edit entities & events in place.** Pencil-icon edit buttons open a modal instead of requiring
  delete-and-recreate, which used to lose an entity's id/password history or an event's data.
- **"Program" entity type.** A fifth entity type alongside Club/Department/Office/Organization.

## Phase 2 — Event Discovery Quick Wins

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

## Phase 3 — Calendar Navigation & Filtering

- **Mini-calendar heat map.** A small month-at-a-glance widget shading days by how many events
  they have, for quickly spotting busy days.
- **Jump-to-Day.** A date picker that jumps the week/day view straight to a chosen date instead of
  paging one day/week at a time.
- **Tags / categories.** Free-form or curated tags on events (e.g. "Fundraiser", "Athletics")
  independent of entity type, with a tag filter alongside the existing type filter.
- **Subscribable filtered feed (RSS/iCal).** A live-updating feed URL reflecting the same filters
  as the Entities page (e.g. "just Chess Club"), so a calendar app stays in sync automatically
  instead of a one-time `.ics` download.

## Phase 4 — Richer Event Types

- **Recurring events.** Weekly/monthly event series with an edit-this-vs-edit-series distinction.
  The biggest schema/UX change on this list — needs a recurrence-rule column and
  instance-expansion logic.
- **Virtual / hybrid events.** An optional join-link field and a "Virtual"/"Hybrid" badge and
  filter, for events not tied to a physical campus location.

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

## Shipped

See [CHANGELOG.md](./CHANGELOG.md) for the full history of what's already built.
