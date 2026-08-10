# Roadmap

Ideas raised while building this app that haven't been built yet. Not committed to — just a
running list so they don't get lost between sessions. Add to it, reprioritize, or delete items
freely; this is a backlog, not a promise.

## Under consideration

- **Admin-managed kiosk settings.** `/display.html`'s day count is currently a URL parameter
  (`?days=N`) set once when configuring the TV's browser — deliberately simple since it's a
  one-time physical setup, not something that needs to change per-session. If that stops being
  true (e.g. multiple screens with different needs, or wanting to change it without touching the
  device), it could become a real Admin-panel setting instead.

- **Per-person entity logins.** Entities currently share one password per entity (club/department/
  office), which suits how they're actually used — the account represents the organization and
  persists across leadership turnover, with the admin password-reset flow handling handoffs. If
  audit trails of *which specific person* posted an event ever become important, this would need
  named logins per person instead of one shared entity account — a bigger change, not scoped out.

- **Shareable individual event pages.** Events currently only open in a modal inside the SPA —
  there's no direct URL for a single event to text/post/share. Worth a real per-event route
  (e.g. `/event/:id`) that renders the same details server-renderable/shareable, separate from
  the calendar shell.

- **"Add to Calendar" (.ics) per event.** A one-click download of a standard `.ics` file for a
  single event, so someone can drop it straight into Google/Outlook/Apple Calendar instead of
  re-typing it. Self-contained — just needs a small endpoint that formats one event as iCalendar.

- **Subscribable filtered feed (RSS/iCal).** Let someone subscribe to a live-updating feed
  filtered the same way the Entities page already filters (e.g. "just Chess Club" or "just
  Department events") rather than a one-time .ics download, so their calendar app stays in sync
  automatically.

  (These three were prompted by looking at what events.brown.edu offers — likely a Localist-style
  platform based on the calendar/subscription patterns, though the live site wasn't directly
  reachable to confirm. Localist also does event submission queues, personal saved/bookmarked
  events, and photo-forward event cards; skipped those as not a good fit for our scale — the first
  needs no moderation layer given entities already post directly, the second needs real student
  accounts we don't have, and the third would mean reintroducing image upload/storage that was
  deliberately dropped earlier.)

## Shipped

See [CHANGELOG.md](./CHANGELOG.md) for what's already built.
