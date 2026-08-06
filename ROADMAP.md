# Roadmap

Ideas raised while building this app that haven't been built yet. Not committed to — just a
running list so they don't get lost between sessions. Add to it, reprioritize, or delete items
freely; this is a backlog, not a promise.

## Under consideration

- **Location double-booking validation.** Right now two events can be created at the same
  location with overlapping times with no warning. Worth adding a server-side check on
  create/update (`POST /api/events`, `PUT /api/events/:id`) that rejects (409) an overlapping
  location+time conflict rather than just letting it happen silently.

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

## Shipped

See [CHANGELOG.md](./CHANGELOG.md) for what's already built.
