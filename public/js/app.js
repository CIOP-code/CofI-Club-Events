/**
 * Campus Events – College of Idaho
 * app.js  |  Single-Page Application controller
 */

/* =============================================================
   STATE
   ============================================================= */
const state = {
  currentPage: 'home',
  calView: 'week',            // 'week' | 'day'
  calAnchorDate: new Date(),  // reference date for calendar view
  events: [],
  entities: [],
  loggedInEntity: null,   // { id, name, type, token, must_change_password }
  adminToken: null,
  pendingLoginEntity: null,  // entity object waiting for password
  forcedPasswordChange: false,  // true while the change-pw modal is a mandatory, non-dismissible flow
  adminEventsView: 'week',            // 'week' | 'month' — browsable range for the admin Events list
  adminEventsAnchorDate: new Date(),  // reference date for that range, so past events are reachable too
  entitiesView: 'list',               // 'grid' | 'list' — icon tiles vs. compact rows on the Entities page
  calFilters: { event_type: '', entity_id: '', location_id: '' }, // calendar view filters
  calFilterTimeoutId: null,   // handle for the auto-clear timer armed while a filter is active
  jumpCalAnchor: new Date(),  // which month the Jump-to-Date mini-calendar is showing
};

/* Ensure CSS variable for calendar header height matches the rendered size.
   This keeps the .day-header top offset in sync if the header wraps or changes height. */
function syncCalendarHeaderHeight() {
  const el = document.querySelector('.calendar-header');
  if (!el) return;
  const h = Math.round(el.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--calendar-header-h', h + 'px');
}
window.addEventListener('load', () => setTimeout(syncCalendarHeaderHeight, 50));
window.addEventListener('resize', debounce(() => setTimeout(syncCalendarHeaderHeight, 60), 100));

/* =============================================================
   NAVIGATION
   ============================================================= */
function navigate(page) {
  // Leaving the calendar behind is the easiest way to forget a filter is on -- come back later
  // and events are missing for no visible reason. Clearing it here means the calendar always
  // starts unfiltered on a fresh visit, same as if you'd never touched it.
  if (state.currentPage === 'home' && page !== 'home' && calFiltersActive()) {
    state.calFilters = { event_type: '', entity_id: '', location_id: '' };
    disarmCalFilterTimeout();
    updateCalFilterIndicator();
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page);
  });
  document.querySelectorAll('.bnav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page);
  });

  state.currentPage = page;

  if (page === 'home') renderCalendar();
  if (page === 'entities') loadEntities();
  if (page === 'admin') renderAdminPage();
}

document.querySelectorAll('[data-page]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    // If the brand button (Campus Events) is clicked, allow the calendar to re-run the "scroll to now"
    if (btn.classList.contains('brand-btn') && btn.dataset.page === 'home') {
      state._hasScrolledToNow = false;
    }
    navigate(btn.dataset.page);
  });
});

/* =============================================================
   UTILITIES
   ============================================================= */
function fmt(date, opts = {}) {
  return date.toLocaleString('en-US', opts);
}

function formatDateTimeLocal(dt) {
  // "YYYY-MM-DDTHH:MM" for datetime-local input
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function startOfDay(d) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function addMonths(d, n) {
  // Pin to the 1st before shifting months, then clamp back to the target month's real last day --
  // otherwise e.g. May 31 minus one month overflows (no "April 31") into May 1st via JS Date's
  // own rollover, silently landing back in the wrong month instead of late April.
  const r = new Date(d);
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  const lastDayOfTargetMonth = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, lastDayOfTargetMonth));
  return r;
}

function getWeekStart(d) {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay()); // Sunday
  r.setHours(0, 0, 0, 0);
  return r;
}

/** Pick a visually distinct color for an event based on its entity ID */
const PALETTE = [
  '#1565c0','#6a1b9a','#00695c','#b71c1c','#e65100',
  '#37474f','#4527a0','#2e7d32','#ad1457','#0277bd',
];

// Assigns palette colors by each entity's position in id order, rather than `id % PALETTE.length`.
// Entities get created and deleted over time (test entities, turnover, etc.), so ids can end up
// spaced apart in ways that collide under a plain modulo — two different entities landing on the
// same color. Sorting by id first keeps colors maximally distinct for however many entities exist,
// and stable across renders/views as long as the entity list doesn't change.
async function ensureEntityColorMap() {
  const { ok, data } = await apiFetch('/api/entities');
  const entities = ok ? (data.entities || []) : [];
  const map = new Map();
  [...entities].sort((a, b) => a.id - b.id).forEach((en, i) => map.set(en.id, PALETTE[i % PALETTE.length]));
  return map;
}

function eventColor(entityId) {
  return state.entityColorMap?.get(entityId) || PALETTE[entityId % PALETTE.length];
}

// Lightens (positive percent) or darkens (negative percent) a hex color — used to differentiate
// multiple simultaneous events from the same entity without introducing a whole new color.
function shadeColor(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  const clamp = v => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + Math.round(2.55 * percent));
  const g = clamp(((num >> 8) & 0xff) + Math.round(2.55 * percent));
  const b = clamp((num & 0xff) + Math.round(2.55 * percent));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// variant 0 = base color; variant 1,2,3… alternate darker/lighter in growing steps, so a few
// simultaneous events from the same entity read as related (same hue) but distinguishable.
function entityVariantShade(baseColor, variant) {
  if (!variant) return baseColor;
  const step = Math.ceil(variant / 2) * 15;
  const sign = variant % 2 === 1 ? -1 : 1;
  return shadeColor(baseColor, sign * step);
}

// Perceptual-ish distance between two hex colors ("redmean" approximation — cheap, no color-space
// conversion needed, and good enough to tell "these read as basically the same color" apart from
// "these are clearly different"). Roughly 0 (identical) to ~765 (black vs white).
function colorDistance(hexA, hexB) {
  const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
  const r1 = (a >> 16) & 0xff, g1 = (a >> 8) & 0xff, b1 = a & 0xff;
  const r2 = (b >> 16) & 0xff, g2 = (b >> 8) & 0xff, b2 = b & 0xff;
  const rMean = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
}
const SIMILAR_COLOR_THRESHOLD = 70;

// An entity's color is normally fixed (see ensureEntityColorMap) — this only nudges it within a
// single overlap cluster, and only when it's actually close enough to a DIFFERENT entity present
// in that same cluster to be visually confused. Entities that never share a moment with a
// similar-colored entity keep their assigned color untouched everywhere.
function resolveClusterBaseColors(entityIds) {
  const resolved = new Map();
  entityIds.forEach(id => {
    const base = eventColor(id);
    let color = base;
    let attempt = 1;
    while ([...resolved.values()].some(c => colorDistance(c, color) < SIMILAR_COLOR_THRESHOLD) && attempt <= 4) {
      const step = Math.ceil(attempt / 2) * 18;
      const sign = attempt % 2 === 1 ? -1 : 1;
      color = shadeColor(base, sign * step);
      attempt++;
    }
    resolved.set(id, color);
  });
  return resolved;
}

// Lays out a single day's events for the time grid: overlapping events get placed side-by-side
// instead of stacking on top of each other and hiding all but the last one. Groups events into
// overlap clusters, greedily assigns each a column within its cluster (standard interval-graph
// column packing), and caps how many columns actually render — beyond MAX_VISIBLE_COLS, the rest
// of that cluster collapses into a single clickable "+N more" tile so a burst of 10 events at the
// same time stays usable instead of squeezing 10 slivers into one day column.
const MAX_VISIBLE_COLS = 4;

function layoutDayEvents(dayEvents) {
  const evs = dayEvents
    .map(ev => ({ ...ev, _start: new Date(ev.start_datetime), _end: new Date(ev.end_datetime) }))
    .sort((a, b) => a._start - b._start || (b._end - b._start) - (a._end - a._start));

  // Group into connected overlap clusters
  const clusters = [];
  let current = [];
  let clusterEnd = -Infinity;
  evs.forEach(ev => {
    if (current.length && ev._start.getTime() >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(ev);
    clusterEnd = Math.max(clusterEnd, ev._end.getTime());
  });
  if (current.length) clusters.push(current);

  const positioned = [];
  const overflowGroups = [];

  clusters.forEach(cluster => {
    // Greedy column assignment: reuse the first column whose last event has already ended.
    const colEnds = [];
    const entitySeen = {};
    cluster.forEach(ev => {
      let col = colEnds.findIndex(t => t <= ev._start.getTime());
      if (col === -1) { col = colEnds.length; colEnds.push(ev._end.getTime()); }
      else { colEnds[col] = ev._end.getTime(); }
      ev._col = col;
      ev._variant = entitySeen[ev.entity_id] || 0;
      entitySeen[ev.entity_id] = ev._variant + 1;
    });

    // Resolve final colors for this cluster: distinctness adjustment between different entities,
    // then same-entity variant shading on top — computed for every event in the cluster (not just
    // the ones that end up visibly positioned) so the overflow modal's dots match too.
    const clusterColors = resolveClusterBaseColors([...new Set(cluster.map(ev => ev.entity_id))]);
    cluster.forEach(ev => { ev._color = entityVariantShade(clusterColors.get(ev.entity_id), ev._variant); });

    const totalCols = colEnds.length;

    if (totalCols <= MAX_VISIBLE_COLS) {
      cluster.forEach(ev => positioned.push({ ...ev, cols: totalCols }));
      return;
    }

    const shownColCount = MAX_VISIBLE_COLS - 1;
    const shown = cluster.filter(ev => ev._col < shownColCount);
    const hidden = cluster.filter(ev => ev._col >= shownColCount);

    shown.forEach(ev => positioned.push({ ...ev, cols: MAX_VISIBLE_COLS }));

    if (hidden.length) {
      overflowGroups.push({
        _start: new Date(Math.min(...hidden.map(e => e._start.getTime()))),
        _end: new Date(Math.max(...hidden.map(e => e._end.getTime()))),
        col: shownColCount,
        cols: MAX_VISIBLE_COLS,
        events: hidden,
      });
    }
  });

  return { positioned, overflowGroups };
}

const TYPE_LABELS = {
  club: 'Club',
  department: 'Department',
  office: 'Office',
  organization: 'Organization',
  program: 'Program',
};

const EVENT_TYPE_LABELS = {
  meeting: 'Meeting',
  social: 'Social',
  academic: 'Academic',
  athletic: 'Athletic',
  fundraiser: 'Fundraiser',
  performance: 'Performance',
  other: 'Other',
};

/** Show an inline alert */
function showAlert(elId, msg, type = 'danger') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = `alert-inline alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove('d-none');
}
function hideAlert(elId) {
  const el = document.getElementById(elId);
  if (el) el.classList.add('d-none');
}

// Same rule the API enforces server-side; checked client-side too for immediate feedback instead
// of a round-trip. An event with end before/equal to start broke .ics export (Outlook rejects it
// outright) and made no sense on the calendar besides.
function isValidEventRange(startVal, endVal) {
  return startVal && endVal && new Date(endVal) > new Date(startVal);
}

/* =============================================================
   API HELPERS
   ============================================================= */
async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };

  const token = state.loggedInEntity?.token || state.adminToken;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
// Locations helpers
async function fetchLocations() {
  const { ok, data } = await apiFetch('/api/locations');
  return ok ? (data.locations || []) : [];
}

// Get-or-create by name: despite the POST endpoint rejecting a duplicate name with a 409 (the
// right behavior for the deliberate Create Location form, where a duplicate is a mistake worth
// flagging), callers of this helper are asking for a location's id, not necessarily to create a
// new row -- a 409 here means "someone already made this one," which should resolve the same as
// if it never conflicted, not fail the event they were trying to save.
async function ensureLocation(newName) {
  const token = state.loggedInEntity?.token || state.adminToken;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch('/api/locations', { method: 'POST', headers, body: JSON.stringify({ name: newName }) });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data.id;
  if (res.status === 409) {
    const existing = (await fetchLocations()).find(l => l.name.toLowerCase() === newName.trim().toLowerCase());
    if (existing) return existing.id;
  }
  throw new Error(data.error || 'Failed to create location');
}

/* =============================================================
   HOME – CALENDAR
   ============================================================= */
const HOUR_H = 60; // pixels per hour (matches CSS var --hour-h)
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

async function fetchEvents(startISO, endISO) {
  let url = `/api/events?start=${startISO}&end=${endISO}`;
  const { event_type, entity_id, location_id } = state.calFilters;
  if (event_type) url += `&event_type=${encodeURIComponent(event_type)}`;
  if (entity_id) url += `&entity_id=${encodeURIComponent(entity_id)}`;
  if (location_id) url += `&location_id=${encodeURIComponent(location_id)}`;
  const { ok, data } = await apiFetch(url);
  return ok ? data.events || [] : [];
}

function activeCalFilterCount() {
  const { event_type, entity_id, location_id } = state.calFilters;
  return [event_type, entity_id, location_id].filter(Boolean).length;
}

function calFiltersActive() {
  return activeCalFilterCount() > 0;
}

function isoLocal(d) {
  // "YYYY-MM-DDTHH:MM:SS" in local time
  return formatDateTimeLocal(d) + ':00';
}

// Below 992px the shell itself switches to the mobile bottom-nav layout (matches the 991px
// breakpoint in style.css), so a 7-column week grid has no room left to be legible there either.
function isMobileWidth() {
  return window.innerWidth < 992;
}

// The view actually shown: 'week' is forced to 'day' below the mobile breakpoint (a 7-column
// grid has no room there), without overwriting the stored preference — so widening the window
// back out (e.g. resize, rotate) reverts to week view on its own. Month view's cells stay
// legible at any width, so it's never forced.
function effectiveCalView() {
  if (isMobileWidth() && state.calView === 'week') return 'day';
  return state.calView;
}

async function renderCalendar() {
  const wrap = document.getElementById('cal-grid-wrap');
  const grid = document.getElementById('cal-grid');
  const dayStripEl = document.getElementById('day-strip');
  const view = effectiveCalView();

  if (view === 'month') {
    dayStripEl.classList.add('d-none');
    document.getElementById('days-headers').innerHTML = '';
    setViewToggleActive('month');
    await renderMonthGrid(grid);
    return;
  }

  // Determine visible day range
  let days = [];
  let stripDays = null; // the week shown in the swipeable day strip (day view only)

  if (view === 'day') {
    days = [startOfDay(state.calAnchorDate)];
    const ws = getWeekStart(state.calAnchorDate);
    stripDays = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    setViewToggleActive('day');
    dayStripEl.classList.remove('d-none');
  } else {
    const ws = getWeekStart(state.calAnchorDate);
    days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    setViewToggleActive('week');
    dayStripEl.classList.add('d-none');
  }

  // Update title
  const title = document.getElementById('cal-title');
  if (days.length === 1) {
    title.textContent = fmt(days[0], { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  } else {
    const s = fmt(days[0], { month:'short', day:'numeric' });
    const e = fmt(days[6], { month:'short', day:'numeric', year:'numeric' });
    title.textContent = `${s} – ${e}`;
  }

  // Fetch events for the range (widened to the strip's full week in day view, so the strip's
  // dots can reflect days other than the one currently shown in the grid below)
  const fetchDays = stripDays || days;
  const rangeStart = isoLocal(fetchDays[0]);
  const rangeEnd   = isoLocal(addDays(fetchDays[fetchDays.length - 1], 1));
  const [events, entityColorMap] = await Promise.all([fetchEvents(rangeStart, rangeEnd), ensureEntityColorMap()]);
  state.entityColorMap = entityColorMap;

  // Build grid HTML
  const today = startOfDay(new Date());
  const overflowGroupsById = new Map();
  let overflowGroupSeq = 0;

  let html = `<div class="time-col">`;
  // Blank top cell (aligns with day headers)
  html += `<div style="height:52px"></div>`;
  HOURS.forEach(h => {
    const label = h === 0 ? '1am' : h < 11 ? `${h+1}am` : h === 11 ? '12pm' : `${h-12+1}pm`;
    html += `<div class="time-label">${label}</div>`;
  });
  html += `</div>`;

  html += `<div class="days-wrap">`;
  days.forEach(day => {
    const isToday = day.getTime() === today.getTime();
    const dayEvents = events.filter(ev => {
      const evStart = new Date(ev.start_datetime);
      const evDay = startOfDay(evStart);
      return evDay.getTime() === day.getTime();
    });

    html += `<div class="day-col">`;
    // header moved into #days-headers; reserve body space here
    html += `<div class="day-body" data-date="${day.toISOString()}">`;

    // Hour lines
    HOURS.forEach(h => {
      html += `<div class="hour-line" style="top:${h * HOUR_H}px"></div>`;
      html += `<div class="hour-line half" style="top:${h * HOUR_H + HOUR_H/2}px"></div>`;
    });

    // Current time indicator (today only)
    if (isToday) {
      const now = new Date();
      const minutesFromMidnight = now.getHours() * 60 + now.getMinutes();
      const topPx = minutesFromMidnight * (HOUR_H / 60);
      html += `<div class="now-line" style="top:${topPx}px"></div>`;
    }

    // Event blocks — overlapping events lay out side-by-side (capped) instead of stacking
    function topHeightPx(start, end) {
      const startMin = start.getHours() * 60 + start.getMinutes();
      const endMin   = end.getHours() * 60 + end.getMinutes();
      // Min 30-min visual height: shorter than that there's no room for title + location +
      // entity even at the smallest legible font size. This only affects the rendered block
      // size, never the event's actual stored duration.
      const duration = Math.max(endMin - startMin, 30);
      return { topPx: startMin * (HOUR_H / 60), heightPx: duration * (HOUR_H / 60) };
    }

    const { positioned, overflowGroups } = layoutDayEvents(dayEvents);

    positioned.forEach(ev => {
      const { topPx, heightPx } = topHeightPx(ev._start, ev._end);
      const leftPct  = (ev._col / ev.cols) * 100;
      const widthPct = (1 / ev.cols) * 100;
      const color = ev._color;
      const timeStr = `${fmt(ev._start,{hour:'numeric',minute:'2-digit'})} – ${fmt(ev._end,{hour:'numeric',minute:'2-digit'})}`;

      html += `<div class="cal-event"
          style="top:${topPx}px;height:${heightPx}px;left:calc(${leftPct}% + 2px);width:calc(${widthPct}% - 4px);background:${color};color:#fff"
          data-ev-id="${ev.id}"
          title="${escHtml(ev.title)} · ${escHtml(timeStr)}">
        <div class="ev-title">${escHtml(ev.title)}</div>
        <div class="ev-location">${escHtml(ev.location_name || '')}</div>
        <div class="ev-entity">${escHtml(ev.entity_name || '')}</div>
        ${ev.description ? `<div class="ev-desc">${escHtml(truncateText(ev.description, 120))}</div>` : ''}
      </div>`;
    });

    overflowGroups.forEach(grp => {
      const { topPx, heightPx } = topHeightPx(grp._start, grp._end);
      const leftPct  = (grp.col / grp.cols) * 100;
      const widthPct = (1 / grp.cols) * 100;
      const groupId = `og-${overflowGroupSeq++}`;
      overflowGroupsById.set(groupId, grp.events);

      html += `<div class="cal-event cal-event-overflow"
          style="top:${topPx}px;height:${heightPx}px;left:calc(${leftPct}% + 2px);width:calc(${widthPct}% - 4px)"
          data-overflow-group="${groupId}"
          title="${grp.events.length} more events">
        +${grp.events.length} more
      </div>`;
    });

    html += `</div></div>`;
  });
  html += `</div>`;

  grid.innerHTML = html;

  // Render day headers into the top header area so they stick together with .calendar-header
  const daysHeadersEl = document.getElementById('days-headers');
  if (daysHeadersEl) {
    daysHeadersEl.innerHTML = days.map(d => {
      const isToday = startOfDay(d).getTime() === today.getTime();
      return `<div class="day-header${isToday ? ' today' : ''}">
        <div class="day-name">${DAYS_SHORT[d.getDay()]}</div>
        <div class="day-num">${d.getDate()}</div>
      </div>`;
    }).join('');

    // sync horizontal scroll
    const headerScroll = daysHeadersEl;
    const gridScroll = document.querySelector('.days-wrap');
    if (gridScroll) {
      headerScroll.onscroll = () => { gridScroll.scrollLeft = headerScroll.scrollLeft; };
      gridScroll.onscroll = () => { headerScroll.scrollLeft = gridScroll.scrollLeft; };
    }
  }

  // Event block click → modal
  grid.querySelectorAll('.cal-event:not(.cal-event-overflow)').forEach(el => {
    el.addEventListener('click', () => openEventModal(el.dataset.evId, events));
  });

  // Overflow tile click → list of the events collapsed into it, each opens the normal event modal
  grid.querySelectorAll('.cal-event-overflow').forEach(el => {
    el.addEventListener('click', () => openOverflowModal(overflowGroupsById.get(el.dataset.overflowGroup), events));
  });

  // Swipeable day strip (day view only)
  if (stripDays) {
    const activeDay = days[0];
    dayStripEl.innerHTML = stripDays.map(d => {
      const isToday = d.getTime() === today.getTime();
      const isActive = d.getTime() === activeDay.getTime();
      const dotEntityIds = [...new Set(
        events.filter(ev => startOfDay(new Date(ev.start_datetime)).getTime() === d.getTime())
              .map(ev => ev.entity_id)
      )].slice(0, 4);
      return `<div class="day-strip-pill${isToday ? ' today' : ''}${isActive ? ' active' : ''}" data-date="${d.toISOString()}">
        <div class="dsp-dow">${DAYS_SHORT[d.getDay()]}</div>
        <div class="dsp-num">${d.getDate()}</div>
        <div class="dsp-dots">${dotEntityIds.map(id => `<span class="dsp-dot" style="background:${eventColor(id)}"></span>`).join('')}</div>
      </div>`;
    }).join('');

    dayStripEl.querySelectorAll('.day-strip-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        state.calAnchorDate = new Date(pill.dataset.date);
        renderCalendar();
      });
    });

    const activePill = dayStripEl.querySelector('.day-strip-pill.active');
    if (activePill) activePill.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  // On first render, try to scroll so the current time is visible.
  // Find the vertical scroll container (closest ancestor with overflow:auto/scroll) so we scroll the correct element.
  function findVerticalScrollContainer(el) {
    let p = el.parentElement;
    while (p) {
      const st = getComputedStyle(p).overflowY;
      if (st === 'auto' || st === 'scroll') return p;
      p = p.parentElement;
    }
    return document.documentElement;
  }

  if (!state._hasScrolledToNow) {
    const nowEl = grid.querySelector('.now-line');
    const container = findVerticalScrollContainer(grid) || document.documentElement;
    const dayHeaderH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--day-header-h')) || 52;
    // Midnight-6am is rarely where anything's happening, so never default to showing it — either
    // center on "now" (if later than 6am) or fall back to 6am, but don't scroll any earlier than that.
    const minScrollTop = 6 * HOUR_H + dayHeaderH;
    if (nowEl && container) {
      const nowRect = nowEl.getBoundingClientRect();
      const contRect = container.getBoundingClientRect();
      const headerEl = document.querySelector('.calendar-header');
      const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;
      // Small top margin so the now-line isn't flush with the header
      const margin = 24;
      const delta = nowRect.top - (contRect.top + headerH + margin);
      // Adjust scrollTop by delta (works for both documentElement and scrollable container)
      container.scrollTop = Math.max((container.scrollTop || 0) + delta, minScrollTop);
    } else {
      // Fall back to 6am when there's no "now" line to center on (e.g. viewing a week/day that
      // doesn't include today).
      container.scrollTop = minScrollTop;
    }
    state._hasScrolledToNow = true;
  }
}

// Month view: a lightweight dot-per-event grid rather than full event blocks, which stay
// legible at any width. Clicking a day drills into its single-day view.
async function renderMonthGrid(grid) {
  const monthStart = new Date(state.calAnchorDate.getFullYear(), state.calAnchorDate.getMonth(), 1);
  const monthEnd   = new Date(state.calAnchorDate.getFullYear(), state.calAnchorDate.getMonth() + 1, 0);
  const gridStart  = getWeekStart(monthStart);
  const gridEnd    = addDays(getWeekStart(monthEnd), 6); // Saturday of the week containing the last day
  const totalDays  = Math.round((gridEnd - gridStart) / 86400000) + 1;
  const cells = Array.from({ length: totalDays }, (_, i) => addDays(gridStart, i));

  document.getElementById('cal-title').textContent = fmt(monthStart, { month: 'long', year: 'numeric' });

  const [events, entityColorMap] = await Promise.all([
    fetchEvents(isoLocal(gridStart), isoLocal(addDays(gridEnd, 1))),
    ensureEntityColorMap(),
  ]);
  state.entityColorMap = entityColorMap;
  const today = startOfDay(new Date());
  const MAX_DOTS = 3;

  let html = `<div class="month-grid">`;
  DAYS_SHORT.forEach(d => { html += `<div class="month-dow">${d}</div>`; });
  cells.forEach(day => {
    const inMonth = day.getMonth() === monthStart.getMonth();
    const isToday = day.getTime() === today.getTime();
    const dayEvents = events.filter(ev => startOfDay(new Date(ev.start_datetime)).getTime() === day.getTime());
    const shown = dayEvents.slice(0, MAX_DOTS);
    const overflow = dayEvents.length - shown.length;

    html += `<div class="month-cell${inMonth ? '' : ' dim'}${isToday ? ' today' : ''}" data-date="${day.toISOString()}">
      <div class="month-cell-num">${day.getDate()}</div>
      <div class="month-cell-dots">
        ${shown.map(ev => `<span class="month-dot" style="background:${eventColor(ev.entity_id)}" title="${escHtml(ev.title)}"></span>`).join('')}
        ${overflow > 0 ? `<span class="month-dot-more">+${overflow}</span>` : ''}
      </div>
    </div>`;
  });
  html += `</div>`;

  grid.innerHTML = html;

  grid.querySelectorAll('.month-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      state.calAnchorDate = new Date(cell.dataset.date);
      state.calView = 'day';
      renderCalendar();
    });
  });
}

/* =============================================================
   JUMP TO DATE (mini-calendar heat map -- also doubles as the "spot busy days" widget)
   ============================================================= */
async function renderJumpToDateGrid() {
  const monthStart = new Date(state.jumpCalAnchor.getFullYear(), state.jumpCalAnchor.getMonth(), 1);
  const monthEnd   = new Date(state.jumpCalAnchor.getFullYear(), state.jumpCalAnchor.getMonth() + 1, 0);
  const gridStart  = getWeekStart(monthStart);
  const gridEnd    = addDays(getWeekStart(monthEnd), 6);
  const totalDays  = Math.round((gridEnd - gridStart) / 86400000) + 1;
  const cells = Array.from({ length: totalDays }, (_, i) => addDays(gridStart, i));

  document.getElementById('jump-cal-title').textContent = fmt(monthStart, { month: 'long', year: 'numeric' });

  const events = await fetchEvents(isoLocal(gridStart), isoLocal(addDays(gridEnd, 1)));
  const today = startOfDay(new Date());

  const countByDay = new Map();
  events.forEach(ev => {
    const key = startOfDay(new Date(ev.start_datetime)).getTime();
    countByDay.set(key, (countByDay.get(key) || 0) + 1);
  });
  const maxCount = Math.max(0, ...countByDay.values());

  // Shade relative to the busiest day actually in view, not a fixed scale -- a quiet month should
  // still show its busiest days as "darker", not read as uniformly empty.
  function heatLevel(count) {
    if (!count || !maxCount) return 0;
    return Math.max(1, Math.ceil((count / maxCount) * 4));
  }

  let html = '';
  DAYS_SHORT.forEach(d => { html += `<div class="mini-cal-dow">${d[0]}</div>`; });
  cells.forEach(day => {
    const inMonth = day.getMonth() === monthStart.getMonth();
    const isToday = day.getTime() === today.getTime();
    const count = countByDay.get(day.getTime()) || 0;
    const level = heatLevel(count);
    const title = count ? `${count} event${count === 1 ? '' : 's'}` : 'No events';
    html += `<div class="mini-cal-cell${inMonth ? '' : ' dim'}${isToday ? ' today' : ''}${level ? ` heat-${level}` : ''}" data-date="${day.toISOString()}" title="${escHtml(title)}">${day.getDate()}</div>`;
  });

  document.getElementById('jump-cal-grid').innerHTML = html;

  document.querySelectorAll('#jump-cal-grid .mini-cal-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      state.calAnchorDate = new Date(cell.dataset.date);
      state.calView = 'day';
      bootstrap.Modal.getInstance(document.getElementById('jumpToDateModal'))?.hide();
      if (state.currentPage === 'home') renderCalendar();
    });
  });
}

document.getElementById('btn-jump-to-date').addEventListener('click', () => {
  state.jumpCalAnchor = new Date(state.calAnchorDate);
  new bootstrap.Modal(document.getElementById('jumpToDateModal')).show();
  renderJumpToDateGrid();
});

document.getElementById('jump-cal-prev').addEventListener('click', () => {
  state.jumpCalAnchor = new Date(state.jumpCalAnchor.getFullYear(), state.jumpCalAnchor.getMonth() - 1, 1);
  renderJumpToDateGrid();
});

document.getElementById('jump-cal-next').addEventListener('click', () => {
  state.jumpCalAnchor = new Date(state.jumpCalAnchor.getFullYear(), state.jumpCalAnchor.getMonth() + 1, 1);
  renderJumpToDateGrid();
});

function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Caps how much of a description ever lands in a calendar tile -- CSS clips it visually once the
// block runs out of room, but the full text was still sitting in the DOM (bloats markup, and
// screen readers would read the whole thing regardless of what's visibly clipped).
function truncateText(str, max) {
  const s = String(str || '');
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s;
}

// Lists the events collapsed into an overflow tile; clicking one opens the normal event modal.
function openOverflowModal(hiddenEvents, allEvents) {
  if (!hiddenEvents || !hiddenEvents.length) return;
  const list = document.getElementById('overflow-events-list');
  list.innerHTML = hiddenEvents
    .slice()
    .sort((a, b) => a._start - b._start)
    .map(ev => {
      const timeStr = `${fmt(ev._start,{hour:'numeric',minute:'2-digit'})} – ${fmt(ev._end,{hour:'numeric',minute:'2-digit'})}`;
      const color = ev._color;
      return `<div class="event-list-item overflow-event-item" data-ev-id="${ev.id}">
        <span class="overflow-event-dot" style="background:${color}"></span>
        <div class="ev-info">
          <div class="ev-title-txt">${escHtml(ev.title)}</div>
          <div class="ev-meta-txt">${escHtml(ev.entity_name || '')} · ${escHtml(timeStr)}</div>
        </div>
      </div>`;
    }).join('');

  list.querySelectorAll('.overflow-event-item').forEach(el => {
    el.addEventListener('click', () => {
      bootstrap.Modal.getInstance(document.getElementById('overflowEventsModal'))?.hide();
      openEventModal(el.dataset.evId, allEvents);
    });
  });

  new bootstrap.Modal(document.getElementById('overflowEventsModal')).show();
}

// Tracks the URL the user was on before opening an event modal (whether via click or a deep
// link), so closing the modal restores it. Reset to null once consumed on close, so viewing
// several events back-to-back within one modal session still returns to the *original* page —
// not to whichever event was open right before the last one.
let preEventModalPath = null;

function renderEventModal(ev) {
  const modalEl = document.getElementById('eventModal');
  const start = new Date(ev.start_datetime);
  const end   = new Date(ev.end_datetime);

  document.getElementById('eventModalLabel').textContent = ev.title;
  document.getElementById('event-modal-title').textContent = ev.title;
  document.getElementById('event-modal-entity-badge').textContent = ev.entity_name || '';
  document.getElementById('event-modal-time').textContent =
    `${fmt(start,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} – ${fmt(end,{hour:'numeric',minute:'2-digit'})}` +
    (ev.location_name ? ` · ${ev.location_name}` : '');
  document.getElementById('event-modal-desc').textContent = ev.description || 'No description provided.';
  document.getElementById('event-modal-poster').classList.add('d-none');
  document.getElementById('event-modal-ics-link').href = `/api/events/${ev.id}/ics`;
  hideAlert('event-modal-copied-msg');
  modalEl.dataset.eventId = ev.id;
}

function showEventModal(ev, { pushState = true } = {}) {
  renderEventModal(ev);
  if (pushState) {
    if (preEventModalPath === null) preEventModalPath = location.pathname + location.search;
    if (location.pathname !== `/event/${ev.id}`) {
      history.pushState({}, '', `/event/${ev.id}`);
    }
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById('eventModal')).show();
}

function openEventModal(evId, events) {
  const ev = events.find(e => String(e.id) === String(evId));
  if (!ev) return;
  showEventModal(ev);
}

// Used for deep links (/event/:id loaded directly) and browser back/forward, where the event
// isn't necessarily among whatever's currently rendered in the calendar grid.
async function openEventModalById(id, opts = {}) {
  const { ok, data } = await apiFetch(`/api/events/${id}`);
  if (!ok) return;
  showEventModal(data.event, opts);
}

document.getElementById('eventModal').addEventListener('hidden.bs.modal', () => {
  if (/^\/event\/\d+$/.test(location.pathname)) {
    history.pushState({}, '', preEventModalPath || '/');
  }
  preEventModalPath = null;
});

document.getElementById('event-modal-copy-link').addEventListener('click', async () => {
  const id = document.getElementById('eventModal').dataset.eventId;
  if (!id) return;
  const url = `${location.origin}/event/${id}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch (e) {
    const tmp = document.createElement('input');
    tmp.value = url;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    document.body.removeChild(tmp);
  }
  showAlert('event-modal-copied-msg', 'Link copied to clipboard', 'success');
  setTimeout(() => hideAlert('event-modal-copied-msg'), 2000);
});

window.addEventListener('popstate', () => {
  const m = location.pathname.match(/^\/event\/(\d+)$/);
  if (m) {
    openEventModalById(m[1], { pushState: false });
  } else {
    bootstrap.Modal.getInstance(document.getElementById('eventModal'))?.hide();
  }
});

function setViewToggleActive(view) {
  document.getElementById('btn-view-week').classList.toggle('active', view === 'week');
  document.getElementById('btn-view-day').classList.toggle('active', view === 'day');
  document.getElementById('btn-view-month').classList.toggle('active', view === 'month');
}

// Calendar navigation
document.getElementById('btn-prev').addEventListener('click', () => {
  const view = effectiveCalView();
  if (view === 'month') {
    state.calAnchorDate = new Date(state.calAnchorDate.getFullYear(), state.calAnchorDate.getMonth() - 1, 1);
  } else {
    state.calAnchorDate = addDays(state.calAnchorDate, view === 'week' ? -7 : -1);
  }
  renderCalendar();
});
document.getElementById('btn-next').addEventListener('click', () => {
  const view = effectiveCalView();
  if (view === 'month') {
    state.calAnchorDate = new Date(state.calAnchorDate.getFullYear(), state.calAnchorDate.getMonth() + 1, 1);
  } else {
    state.calAnchorDate = addDays(state.calAnchorDate, view === 'week' ? 7 : 1);
  }
  renderCalendar();
});
document.getElementById('btn-today').addEventListener('click', () => {
  state.calAnchorDate = new Date();
  renderCalendar();
});
document.getElementById('btn-view-week').addEventListener('click', () => {
  state.calView = 'week';
  renderCalendar();
});
document.getElementById('btn-view-day').addEventListener('click', () => {
  state.calView = 'day';
  renderCalendar();
});
document.getElementById('btn-view-month').addEventListener('click', () => {
  state.calView = 'month';
  renderCalendar();
});

// Re-render calendar on resize (desktop ↔ mobile switch)
window.addEventListener('resize', debounce(() => {
  if (state.currentPage === 'home') renderCalendar();
}, 250));

function debounce(fn, ms) {
  let t;
  // A regular function, not an arrow: addEventListener calls the listener with `this` bound to
  // the element it's attached to, and that only happens for a non-arrow function. The inner
  // setTimeout arrow closes over that `this` so it reaches `fn` unchanged -- event-search-input's
  // handler relies on `this.value` inside the debounced callback, which silently broke (arrow
  // functions ignore the caller-supplied `this` entirely, so it fell through to undefined) when
  // this returned an arrow function instead.
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/* =============================================================
   ENTITIES PAGE
   ============================================================= */
async function loadEntities() {
  const loadingHtml = `<div class="text-center text-muted py-5 col-12">
    <i class="fa-solid fa-spinner fa-spin fa-2x mb-2"></i><p>Loading entities…</p></div>`;
  document.getElementById(state.entitiesView === 'list' ? 'entities-list' : 'entities-grid').innerHTML = loadingHtml;

  const { ok, data } = await apiFetch('/api/entities');
  state.entities = ok ? (data.entities || []) : [];
  applyEntityFilters();
}

function applyEntityFilters() {
  const q = document.getElementById('entity-search').value.trim().toLowerCase();
  const type = document.getElementById('entity-type-filter').value;
  let filtered = state.entities;
  if (q) filtered = filtered.filter(e => e.name.toLowerCase().includes(q));
  if (type) filtered = filtered.filter(e => e.type === type);
  renderEntitiesGrid(filtered);
}

// Attaches the click-to-login behavior shared by both the grid tiles and the list rows.
function wireEntityLoginTriggers(container, selector) {
  container.querySelectorAll(selector).forEach(el => {
    el.addEventListener('click', () => openEntityLoginModal(
      parseInt(el.dataset.entityId), el.dataset.entityName
    ));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') el.click();
    });
  });
}

function renderEntitiesGrid(entities) {
  const grid = document.getElementById('entities-grid');
  const list = document.getElementById('entities-list');
  const count = document.getElementById('entities-count');

  grid.classList.toggle('d-none', state.entitiesView !== 'grid');
  list.classList.toggle('d-none', state.entitiesView !== 'list');
  const target = state.entitiesView === 'list' ? list : grid;

  if (!entities.length) {
    target.innerHTML = `<div class="text-center text-muted py-5 col-12">
      <i class="fa-solid fa-face-sad-tear fa-2x mb-2"></i>
      <p>No entities found.</p></div>`;
    count.textContent = '';
    return;
  }

  count.textContent = `${entities.length} entit${entities.length !== 1 ? 'ies' : 'y'}`;

  if (state.entitiesView === 'list') {
    list.innerHTML = entities.map(entity => {
      const typeLabel = TYPE_LABELS[entity.type] || entity.type;
      return `<div class="entity-list-row" data-entity-id="${entity.id}" data-entity-name="${escHtml(entity.name)}"
                   tabindex="0" role="button" aria-label="Login as ${escHtml(entity.name)}">
        <div class="entity-list-name">${escHtml(entity.name)}</div>
        <span class="entity-type-badge">${escHtml(typeLabel)}</span>
      </div>`;
    }).join('');
    wireEntityLoginTriggers(list, '.entity-list-row');
    return;
  }

  grid.innerHTML = entities.map(entity => {
    // Use a Font Awesome icon + initial instead of storing a logo
    const logoHtml = `<div class="entity-logo-placeholder"><i class="fa-solid fa-user-group"></i><span>${escHtml(entity.name.charAt(0).toUpperCase())}</span></div>`;
    const typeLabel = TYPE_LABELS[entity.type] || entity.type;
    return `<div class="entity-tile" data-entity-id="${entity.id}" data-entity-name="${escHtml(entity.name)}"
                 tabindex="0" role="button" aria-label="Login as ${escHtml(entity.name)}">
      <span class="entity-type-badge">${escHtml(typeLabel)}</span>
      ${logoHtml}
      <div class="entity-name">${escHtml(entity.name)}</div>
    </div>`;
  }).join('');
  wireEntityLoginTriggers(grid, '.entity-tile');
}

// Entity search/filter
document.getElementById('entity-search').addEventListener('input', applyEntityFilters);
document.getElementById('entity-type-filter').addEventListener('change', applyEntityFilters);

document.getElementById('entities-view-grid').addEventListener('click', () => {
  state.entitiesView = 'grid';
  document.getElementById('entities-view-grid').classList.add('active');
  document.getElementById('entities-view-list').classList.remove('active');
  applyEntityFilters();
});
document.getElementById('entities-view-list').addEventListener('click', () => {
  state.entitiesView = 'list';
  document.getElementById('entities-view-list').classList.add('active');
  document.getElementById('entities-view-grid').classList.remove('active');
  applyEntityFilters();
});

function openEntityLoginModal(entityId, entityName) {
  state.pendingLoginEntity = { id: entityId, name: entityName };
  document.getElementById('entityLoginModalLabel').innerHTML =
    `<i class="fa-solid fa-lock me-2 text-primary"></i>Login – ${escHtml(entityName)}`;
  document.getElementById('entity-modal-name').textContent =
    `Enter the password for ${entityName} to post events.`;
  document.getElementById('entity-login-pw').value = '';
  hideAlert('entity-login-msg');
  const modal = new bootstrap.Modal(document.getElementById('entityLoginModal'));
  modal.show();
}

document.getElementById('entity-login-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const pw = document.getElementById('entity-login-pw').value;
  hideAlert('entity-login-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Logging in…';

  const { ok, data } = await apiFetch('/api/auth/entity', {
    method: 'POST',
    body: JSON.stringify({ entity_id: state.pendingLoginEntity.id, password: pw }),
  });

  btn.disabled = false;
  btn.textContent = 'Login';

  if (!ok) {
    showAlert('entity-login-msg', data.error || 'Login failed');
    return;
  }

  // Store session
  state.loggedInEntity = { ...data.entity, token: data.token };
  bootstrap.Modal.getInstance(document.getElementById('entityLoginModal')).hide();
  onEntityLogin();
});

function onEntityLogin() {
  const banner = document.getElementById('entity-login-banner');
  document.getElementById('logged-entity-name').textContent = state.loggedInEntity.name;
  banner.classList.remove('d-none');

  if (state.loggedInEntity.must_change_password) {
    promptForcedPasswordChange();
    return;
  }

  unlockEntityFeatures();
}

function unlockEntityFeatures() {
  document.getElementById('create-event-section').classList.remove('d-none');
  document.getElementById('my-events-section').classList.remove('d-none');
  // Populate locations for entity create-event form
  (async () => {
    try {
      const locations = await fetchLocations();
      const sel = document.getElementById('ev-location');
      if (sel) {
        sel.innerHTML = `<option value="">– select location –</option>` +
          locations.map(l => `<option value="${l.id}">${escHtml(l.name)}</option>`).join('');
      }
    } catch (e) {
      // ignore
    }
  })();
  loadMyEvents();
}

// An entity's own events (past and upcoming, most recent first) with edit/delete -- previously
// entities could only create events, never see or manage the ones they'd already posted, and had
// to ask an admin to fix a typo or cancel something.
async function loadMyEvents() {
  const listEl = document.getElementById('my-events-list');
  if (!state.loggedInEntity) return;

  const { ok, data } = await apiFetch(`/api/events?entity_id=${state.loggedInEntity.id}`);
  const events = ok ? (data.events || []) : [];

  if (!events.length) {
    listEl.innerHTML = '<p class="text-muted small">No events yet.</p>';
    return;
  }

  listEl.innerHTML = events.map(ev => `
    <div class="event-list-item">
      <div class="ev-info">
        <div class="ev-title-txt">${escHtml(ev.title)}</div>
        <div class="ev-meta-txt">${new Date(ev.start_datetime).toLocaleString()}${ev.location_name ? ' · ' + escHtml(ev.location_name) : ''}</div>
      </div>
      <button class="btn btn-sm btn-outline-secondary me-1" data-edit-event="${ev.id}" title="Edit event">
        <i class="fa-solid fa-pen"></i>
      </button>
      <button class="btn btn-sm btn-outline-danger" data-delete-event="${ev.id}">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>`).join('');

  listEl.querySelectorAll('[data-edit-event]').forEach(btn => {
    btn.addEventListener('click', () => openEditEventModal(parseInt(btn.dataset.editEvent)));
  });
  listEl.querySelectorAll('[data-delete-event]').forEach(btn => {
    btn.addEventListener('click', () => deleteEventById(parseInt(btn.dataset.deleteEvent)));
  });
}

// Forces the entity to set a new password before the rest of the page unlocks. Used after
// an admin-assigned password (new entity, or an admin reset) — the modal can't be dismissed
// until a new password is set.
function promptForcedPasswordChange() {
  document.getElementById('cp-current').value = '';
  document.getElementById('cp-new').value = '';
  document.getElementById('cp-confirm').value = '';
  hideAlert('change-pw-msg');
  document.getElementById('change-pw-forced-note').classList.remove('d-none');
  document.getElementById('changePwModalCloseBtn').classList.add('d-none');
  state.forcedPasswordChange = true;
  const modal = new bootstrap.Modal(document.getElementById('changePwModal'), { backdrop: 'static', keyboard: false });
  modal.show();
}

document.getElementById('btn-entity-logout').addEventListener('click', () => {
  state.loggedInEntity = null;
  document.getElementById('entity-login-banner').classList.add('d-none');
  document.getElementById('create-event-section').classList.add('d-none');
  document.getElementById('my-events-section').classList.add('d-none');
});

document.getElementById('btn-change-pw').addEventListener('click', () => {
  document.getElementById('cp-current').value = '';
  document.getElementById('cp-new').value = '';
  document.getElementById('cp-confirm').value = '';
  hideAlert('change-pw-msg');
  document.getElementById('change-pw-forced-note').classList.add('d-none');
  document.getElementById('changePwModalCloseBtn').classList.remove('d-none');
  state.forcedPasswordChange = false;
  new bootstrap.Modal(document.getElementById('changePwModal')).show();
});

document.getElementById('change-pw-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const current = document.getElementById('cp-current').value;
  const newPw   = document.getElementById('cp-new').value;
  const confirm = document.getElementById('cp-confirm').value;

  if (newPw !== confirm) { showAlert('change-pw-msg', 'New passwords do not match'); return; }
  hideAlert('change-pw-msg');

  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Updating…';

  const { ok, data } = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: current, new_password: newPw }),
  });

  btn.disabled = false;
  btn.textContent = 'Update Password';

  if (!ok) { showAlert('change-pw-msg', data.error || 'Failed to change password'); return; }
  showAlert('change-pw-msg', 'Password changed successfully!', 'success');

  state.loggedInEntity.must_change_password = false;
  const wasForced = state.forcedPasswordChange;

  setTimeout(() => {
    bootstrap.Modal.getInstance(document.getElementById('changePwModal')).hide();
    if (wasForced) {
      state.forcedPasswordChange = false;
      unlockEntityFeatures();
    }
  }, 1500);
});

// Create event (entity user)
document.getElementById('create-event-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('create-event-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Creating…';

  // Location: either selected existing or new name
  let location_id = null;
  const sel = document.getElementById('ev-location');
  const newLoc = document.getElementById('ev-new-location')?.value.trim();
  if (newLoc) {
    try {
      location_id = await ensureLocation(newLoc);
    } catch (err) {
      showAlert('create-event-msg', err.message || 'Failed to create location');
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Event';
      return;
    }
  } else if (sel && sel.value) {
    location_id = parseInt(sel.value);
  }

  const payload = {
    title:          document.getElementById('ev-title').value.trim(),
    description:    document.getElementById('ev-desc').value.trim(),
    event_type:     document.getElementById('ev-type').value,
    location_id,
    start_datetime: document.getElementById('ev-start').value,
    end_datetime:   document.getElementById('ev-end').value,
  };

  if (!isValidEventRange(payload.start_datetime, payload.end_datetime)) {
    showAlert('create-event-msg', 'End time must be after start time');
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Event';
    return;
  }

  const { ok, data } = await apiFetch('/api/events', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Event';

  if (!ok) { showAlert('create-event-msg', data.error || 'Failed to create event'); return; }

  showAlert('create-event-msg', 'Event created successfully!', 'success');
  this.reset();
});

/* =============================================================
   ADMIN PAGE
   ============================================================= */
function renderAdminPage() {
  if (state.adminToken) {
    document.getElementById('admin-login').classList.add('d-none');
    document.getElementById('admin-panel').classList.remove('d-none');
    loadAdminData();
  } else {
    document.getElementById('admin-login').classList.remove('d-none');
    document.getElementById('admin-panel').classList.add('d-none');
  }
}

document.getElementById('admin-login-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const pw = document.getElementById('admin-pw').value;
  hideAlert('admin-login-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Logging in…';

  const { ok, data } = await apiFetch('/api/auth/admin', {
    method: 'POST',
    body: JSON.stringify({ password: pw }),
  });

  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-right-to-bracket me-1"></i>Login';

  if (!ok) { showAlert('admin-login-msg', data.error || 'Login failed'); return; }

  state.adminToken = data.token;
  document.getElementById('admin-login').classList.add('d-none');
  document.getElementById('admin-panel').classList.remove('d-none');
  loadAdminData();
});

document.getElementById('btn-admin-logout').addEventListener('click', () => {
  state.adminToken = null;
  document.getElementById('admin-panel').classList.add('d-none');
  document.getElementById('admin-login').classList.remove('d-none');
  document.getElementById('admin-pw').value = '';
});

/* =============================================================
   ADMIN PASSWORD RECOVERY (self-service, for succession -- no login required to trigger)
   ============================================================= */
document.getElementById('btn-admin-forgot-password').addEventListener('click', () => {
  document.getElementById('admin-forgot-password-box').classList.toggle('d-none');
});

document.getElementById('btn-send-reset-link').addEventListener('click', async function () {
  hideAlert('admin-forgot-password-msg');
  this.disabled = true;
  this.innerHTML = '<span class="spinner-sm"></span> Sending…';

  const { ok, data } = await apiFetch('/api/auth/admin/forgot-password', { method: 'POST' });

  this.disabled = false;
  this.innerHTML = '<i class="fa-solid fa-paper-plane me-1"></i>Send Reset Link';

  showAlert('admin-forgot-password-msg', ok ? data.message : (data.error || 'Failed to send reset link'), ok ? 'success' : 'danger');
});

document.getElementById('reset-admin-password-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('reset-admin-password-msg');

  const newPw = document.getElementById('reset-admin-new-pw').value;
  const confirmPw = document.getElementById('reset-admin-confirm-pw').value;
  if (newPw !== confirmPw) { showAlert('reset-admin-password-msg', 'Passwords do not match'); return; }

  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Updating…';

  const { ok, data } = await apiFetch('/api/auth/admin/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: document.getElementById('reset-admin-token').value, new_password: newPw }),
  });

  btn.disabled = false;
  btn.textContent = 'Set New Password';

  if (!ok) { showAlert('reset-admin-password-msg', data.error || 'Failed to reset password'); return; }

  showAlert('reset-admin-password-msg', 'Password updated! You can log in now.', 'success');
  this.reset();
  setTimeout(() => bootstrap.Modal.getInstance(document.getElementById('resetAdminPasswordModal'))?.hide(), 1500);
});

async function loadAdminData() {
  // Load entities for the dropdown + entities list
  const { ok, data } = await apiFetch('/api/entities');
  const entities = ok ? (data.entities || []) : [];

  // Populate entity select, grouped by type instead of one flat alphabetical list -- with 50+
  // entities now, scanning for one by scrolling a single giant list got unwieldy.
  const sel = document.getElementById('adm-ev-entity');
  const ENTITY_TYPE_ORDER = ['club', 'department', 'office', 'organization', 'program'];
  const groupedEntities = ENTITY_TYPE_ORDER
    .map(type => ({ type, label: TYPE_LABELS[type] || type, items: entities.filter(en => en.type === type) }))
    .filter(g => g.items.length);
  const knownTypes = new Set(ENTITY_TYPE_ORDER);
  const otherEntities = entities.filter(en => !knownTypes.has(en.type));
  if (otherEntities.length) groupedEntities.push({ type: 'other', label: 'Other', items: otherEntities });

  sel.innerHTML = `<option value="">– select entity –</option>` +
    groupedEntities.map(g => `<optgroup label="${escHtml(g.label)}s">` +
      g.items.map(en => `<option value="${en.id}">${escHtml(en.name)}</option>`).join('') +
      `</optgroup>`
    ).join('');

  // Populate locations for admin event form + the locations list below
  let locations = [];
  try {
    locations = await fetchLocations();
    const locSel = document.getElementById('adm-ev-location');
    if (locSel) {
      locSel.innerHTML = `<option value="">– select location –</option>` +
        locations.map(l => `<option value="${l.id}">${escHtml(l.name)}</option>`).join('');
    }
  } catch (e) {
    // ignore errors; locations are optional
  }

  // Entities list – use event delegation instead of inline onclick
  const enList = document.getElementById('admin-entities-list');
  if (entities.length) {
    enList.innerHTML = entities.map(en => `
      <div class="event-list-item">
        <div class="ev-info">
          <div class="ev-title-txt">
            ${escHtml(en.name)} <span class="text-muted small">(${escHtml(TYPE_LABELS[en.type] || en.type)})</span>
            ${en.must_change_password ? '<span class="badge bg-warning text-dark ms-1">Needs password change</span>' : ''}
          </div>
          <div class="ev-meta-txt">ID: ${en.id} · Created: ${new Date(en.created_at).toLocaleDateString()}</div>
        </div>
        <button class="btn btn-sm btn-outline-secondary me-1" data-edit-entity="${en.id}" data-edit-entity-name="${escHtml(en.name)}" data-edit-entity-type="${en.type}" title="Edit entity">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn btn-sm btn-outline-secondary me-1" data-reset-entity="${en.id}" data-reset-entity-name="${escHtml(en.name)}" title="Reset password">
          <i class="fa-solid fa-key"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger" data-delete-entity="${en.id}" title="Delete entity">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>`).join('');

    enList.querySelectorAll('[data-delete-entity]').forEach(btn => {
      btn.addEventListener('click', () => adminDeleteEntity(parseInt(btn.dataset.deleteEntity)));
    });
    enList.querySelectorAll('[data-reset-entity]').forEach(btn => {
      btn.addEventListener('click', () => adminResetEntityPassword(parseInt(btn.dataset.resetEntity), btn.dataset.resetEntityName));
    });
    enList.querySelectorAll('[data-edit-entity]').forEach(btn => {
      btn.addEventListener('click', () => openEditEntityModal(parseInt(btn.dataset.editEntity), btn.dataset.editEntityName, btn.dataset.editEntityType));
    });
  } else {
    enList.innerHTML = '<p class="text-muted small">No entities yet.</p>';
  }

  // Locations list – entity-or-admin can rename (matching who can create one), admin-only delete
  const locList = document.getElementById('admin-locations-list');
  if (locations.length) {
    locList.innerHTML = locations.map(loc => `
      <div class="event-list-item">
        <div class="ev-info">
          <div class="ev-title-txt">${escHtml(loc.name)}</div>
        </div>
        <button class="btn btn-sm btn-outline-secondary me-1" data-edit-location="${loc.id}" data-edit-location-name="${escHtml(loc.name)}" title="Edit location">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger" data-delete-location="${loc.id}" title="Delete location">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>`).join('');

    locList.querySelectorAll('[data-delete-location]').forEach(btn => {
      btn.addEventListener('click', () => adminDeleteLocation(parseInt(btn.dataset.deleteLocation)));
    });
    locList.querySelectorAll('[data-edit-location]').forEach(btn => {
      btn.addEventListener('click', () => openEditLocationModal(parseInt(btn.dataset.editLocation), btn.dataset.editLocationName));
    });
  } else {
    locList.innerHTML = '<p class="text-muted small">No locations yet.</p>';
  }

  // Events list
  loadAdminEvents();
}

// The admin Events list used to only ever show events from "now" onward, with no way to reach
// a past event to edit/delete it. This computes a browsable week/month range instead, anchored
// on state.adminEventsAnchorDate, so Prev/Next/Today can navigate to any period, past included.
function adminEventsRange() {
  const anchor = state.adminEventsAnchorDate;
  if (state.adminEventsView === 'month') {
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return {
      start: startOfDay(monthStart),
      end: addDays(startOfDay(monthEnd), 1),
      label: fmt(monthStart, { month: 'long', year: 'numeric' }),
    };
  }
  const ws = getWeekStart(anchor);
  return {
    start: ws,
    end: addDays(ws, 7),
    label: `${fmt(ws, { month: 'short', day: 'numeric' })} – ${fmt(addDays(ws, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`,
  };
}

async function loadAdminEvents() {
  const evList = document.getElementById('admin-events-list');
  const { start, end, label } = adminEventsRange();
  document.getElementById('adm-ev-range-label').textContent = label;

  const { ok, data } = await apiFetch(`/api/events?start=${isoLocal(start)}&end=${isoLocal(end)}`);
  const events = ok ? (data.events || []) : [];

  if (events.length) {
    evList.innerHTML = events.map(ev => `
      <div class="event-list-item">
        <div class="ev-info">
          <div class="ev-title-txt">${escHtml(ev.title)}</div>
          <div class="ev-meta-txt">${escHtml(ev.entity_name)} · ${new Date(ev.start_datetime).toLocaleString()}</div>
        </div>
        <button class="btn btn-sm btn-outline-secondary me-1" data-edit-event="${ev.id}" title="Edit event">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger" data-delete-event="${ev.id}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>`).join('');

    evList.querySelectorAll('[data-delete-event]').forEach(btn => {
      btn.addEventListener('click', () => deleteEventById(parseInt(btn.dataset.deleteEvent)));
    });
    evList.querySelectorAll('[data-edit-event]').forEach(btn => {
      btn.addEventListener('click', () => openEditEventModal(parseInt(btn.dataset.editEvent)));
    });
  } else {
    evList.innerHTML = '<p class="text-muted small">No events in this range.</p>';
  }
}

document.getElementById('adm-ev-prev').addEventListener('click', () => {
  state.adminEventsAnchorDate = state.adminEventsView === 'month'
    ? new Date(state.adminEventsAnchorDate.getFullYear(), state.adminEventsAnchorDate.getMonth() - 1, 1)
    : addDays(state.adminEventsAnchorDate, -7);
  loadAdminEvents();
});
document.getElementById('adm-ev-next').addEventListener('click', () => {
  state.adminEventsAnchorDate = state.adminEventsView === 'month'
    ? new Date(state.adminEventsAnchorDate.getFullYear(), state.adminEventsAnchorDate.getMonth() + 1, 1)
    : addDays(state.adminEventsAnchorDate, 7);
  loadAdminEvents();
});
document.getElementById('adm-ev-today').addEventListener('click', () => {
  state.adminEventsAnchorDate = new Date();
  loadAdminEvents();
});
document.getElementById('adm-ev-view-week').addEventListener('click', () => {
  state.adminEventsView = 'week';
  document.getElementById('adm-ev-view-week').classList.add('active');
  document.getElementById('adm-ev-view-month').classList.remove('active');
  loadAdminEvents();
});
document.getElementById('adm-ev-view-month').addEventListener('click', () => {
  state.adminEventsView = 'month';
  document.getElementById('adm-ev-view-month').classList.add('active');
  document.getElementById('adm-ev-view-week').classList.remove('active');
  loadAdminEvents();
});

// Create entity (admin)
document.getElementById('create-entity-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('create-entity-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>';

  const { ok, data } = await apiFetch('/api/entities', {
    method: 'POST',
    body: JSON.stringify({
      name:     document.getElementById('ent-name').value.trim(),
      type:     document.getElementById('ent-type').value,
      password: document.getElementById('ent-pw').value,
    }),
  });

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Entity';

  if (!ok) { showAlert('create-entity-msg', data.error || 'Failed to create entity'); return; }
  showAlert('create-entity-msg', 'Entity created!', 'success');
  this.reset();
  loadAdminData();
});

// Same alphabet reset-password.js uses server-side (avoids visually ambiguous characters like
// 0/O and 1/l/I, since these are often relayed by reading them aloud or over text/email).
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function generateTempPasswordClient(length = 12) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => TEMP_PASSWORD_ALPHABET[b % TEMP_PASSWORD_ALPHABET.length]).join('');
}

// Bulk import entities (admin). Runs entirely in the admin's own already-authenticated browser
// session, one POST /api/entities per name, reusing the exact same validation/uniqueness rules
// as creating one by hand instead of a separate code path that could drift from them.
document.getElementById('bulk-import-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('bulk-import-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Importing…';
  document.getElementById('bulk-import-results').innerHTML = '';

  const type = document.getElementById('bulk-import-type').value;
  const names = document.getElementById('bulk-import-names').value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  if (!names.length) {
    showAlert('bulk-import-msg', 'Enter at least one name');
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-import me-1"></i>Import';
    return;
  }

  const results = [];
  for (const name of names) {
    const password = generateTempPasswordClient();
    const { ok, status, data } = await apiFetch('/api/entities', {
      method: 'POST',
      body: JSON.stringify({ name, type, password }),
    });
    if (ok) {
      results.push({ name, status: 'created', password });
    } else if (status === 409) {
      results.push({ name, status: 'already existed', password: '' });
    } else {
      results.push({ name, status: `failed: ${data.error || status}`, password: '' });
    }
  }

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-import me-1"></i>Import';

  const created = results.filter(r => r.status === 'created').length;
  const skipped = results.filter(r => r.status === 'already existed').length;
  const failed = results.length - created - skipped;
  showAlert('bulk-import-msg', `${created} created, ${skipped} already existed, ${failed} failed.`, failed ? 'danger' : 'success');

  const resultsEl = document.getElementById('bulk-import-results');
  resultsEl.innerHTML = `
    <div class="table-responsive">
      <table class="table table-sm">
        <thead><tr><th>Name</th><th>Status</th><th>Temp Password</th></tr></thead>
        <tbody>
          ${results.map(r => `<tr>
            <td>${escHtml(r.name)}</td>
            <td>${escHtml(r.status)}</td>
            <td>${r.password ? `<code>${escHtml(r.password)}</code>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <button type="button" class="btn btn-sm btn-outline-secondary" id="bulk-import-download-csv">
      <i class="fa-solid fa-download me-1"></i>Download CSV
    </button>
  `;

  document.getElementById('bulk-import-download-csv').addEventListener('click', () => {
    const csv = ['name,status,temp_password']
      .concat(results.map(r => [r.name, r.status, r.password].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `entity-import-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  this.reset();
  loadAdminData();
});

// Create a single location (admin). Unlike ensureLocation() (used inline from the event forms,
// which silently reuses an existing name), this is a deliberate create action, so a 409 is
// reported as an error rather than treated as success.
document.getElementById('create-location-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('create-location-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>';

  const { ok, data } = await apiFetch('/api/locations', {
    method: 'POST',
    body: JSON.stringify({ name: document.getElementById('loc-name').value.trim() }),
  });

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Location';

  if (!ok) { showAlert('create-location-msg', data.error || 'Failed to create location'); return; }
  showAlert('create-location-msg', 'Location created!', 'success');
  this.reset();
  loadAdminData();
});

// Bulk import locations (admin). Same pattern as bulk-importing entities: runs through the
// existing POST /api/locations one name at a time from the admin's own authenticated session,
// treating "already exists" (409) as a skip rather than a failure.
document.getElementById('bulk-import-locations-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('bulk-import-locations-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Importing…';
  document.getElementById('bulk-import-locations-results').innerHTML = '';

  const names = document.getElementById('bulk-import-locations-names').value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  if (!names.length) {
    showAlert('bulk-import-locations-msg', 'Enter at least one name');
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-import me-1"></i>Import';
    return;
  }

  const results = [];
  for (const name of names) {
    const { ok, status, data } = await apiFetch('/api/locations', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (ok) {
      results.push({ name, status: 'created' });
    } else if (status === 409) {
      results.push({ name, status: 'already existed' });
    } else {
      results.push({ name, status: `failed: ${data.error || status}` });
    }
  }

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-import me-1"></i>Import';

  const created = results.filter(r => r.status === 'created').length;
  const skipped = results.filter(r => r.status === 'already existed').length;
  const failed = results.length - created - skipped;
  showAlert('bulk-import-locations-msg', `${created} created, ${skipped} already existed, ${failed} failed.`, failed ? 'danger' : 'success');

  document.getElementById('bulk-import-locations-results').innerHTML = `
    <div class="table-responsive">
      <table class="table table-sm">
        <thead><tr><th>Name</th><th>Status</th></tr></thead>
        <tbody>
          ${results.map(r => `<tr><td>${escHtml(r.name)}</td><td>${escHtml(r.status)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  this.reset();
  loadAdminData();
});

// Bulk import events (admin). Each line is "Entity | Title | Start | End | Location | Type |
// Description", pipe-delimited rather than comma-delimited since titles/descriptions routinely
// contain commas. Entities are resolved by name (must already exist -- create it first, same as
// the single Create Event form requires picking one from the dropdown); locations are created
// automatically if new, matching ensureLocation()'s behavior elsewhere. One POST /api/events per
// row, same validation as creating one by hand, so this can't drift from those rules.
function normalizeBulkDatetime(raw) {
  const s = (raw || '').trim().replace(' ', 'T');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s) ? s : null;
}

document.getElementById('bulk-import-events-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('bulk-import-events-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Importing…';
  document.getElementById('bulk-import-events-results').innerHTML = '';

  const lines = document.getElementById('bulk-import-events-rows').value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  if (!lines.length) {
    showAlert('bulk-import-events-msg', 'Enter at least one row');
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-import me-1"></i>Import';
    return;
  }

  const { ok: entOk, data: entData } = await apiFetch('/api/entities');
  const entitiesByName = new Map((entOk ? entData.entities || [] : []).map(en => [en.name.toLowerCase(), en]));

  const results = [];
  for (const line of lines) {
    const [entityName, title, startRaw, endRaw, locationName, typeRaw, description] =
      line.split('|').map(s => s.trim());

    if (!entityName || !title || !startRaw || !endRaw) {
      results.push({ line, status: 'failed: entity, title, start, and end are required' });
      continue;
    }

    const entity = entitiesByName.get(entityName.toLowerCase());
    if (!entity) {
      results.push({ line, status: `failed: unknown entity "${entityName}"` });
      continue;
    }

    const start_datetime = normalizeBulkDatetime(startRaw);
    const end_datetime = normalizeBulkDatetime(endRaw);
    if (!start_datetime || !end_datetime) {
      results.push({ line, status: 'failed: start/end must be YYYY-MM-DD HH:MM' });
      continue;
    }
    if (!isValidEventRange(start_datetime, end_datetime)) {
      results.push({ line, status: 'failed: end must be after start' });
      continue;
    }

    const event_type = typeRaw ? typeRaw.toLowerCase() : 'other';
    if (!EVENT_TYPE_LABELS[event_type]) {
      results.push({ line, status: `failed: unknown event type "${typeRaw}"` });
      continue;
    }

    let location_id = null;
    if (locationName) {
      try {
        location_id = await ensureLocation(locationName);
      } catch (err) {
        results.push({ line, status: `failed: ${err.message}` });
        continue;
      }
    }

    const { ok, data } = await apiFetch('/api/events', {
      method: 'POST',
      body: JSON.stringify({
        entity_id: entity.id,
        title,
        description: description || '',
        location_id,
        start_datetime,
        end_datetime,
        event_type,
      }),
    });
    results.push({ line, status: ok ? `created: ${title}` : `failed: ${data.error || 'unknown error'}` });
  }

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-import me-1"></i>Import';

  const created = results.filter(r => r.status.startsWith('created')).length;
  const failed = results.length - created;
  showAlert('bulk-import-events-msg', `${created} created, ${failed} failed.`, failed ? 'danger' : 'success');

  document.getElementById('bulk-import-events-results').innerHTML = `
    <div class="table-responsive">
      <table class="table table-sm">
        <thead><tr><th>Row</th><th>Result</th></tr></thead>
        <tbody>
          ${results.map(r => `<tr><td><code>${escHtml(r.line)}</code></td><td>${escHtml(r.status)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  this.reset();
  loadAdminData();
  loadAdminEvents();
});

// Export a PDF list of events in a date range, optionally filtered to one type -- e.g. a
// semester's worth of events for a print handout, using jsPDF + its autotable plugin (loaded via
// <script> tags in index.html/404.html, before app.js).
document.getElementById('export-pdf-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('export-pdf-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Generating…';

  const startDate = document.getElementById('export-pdf-start').value; // "YYYY-MM-DD"
  const endDate = document.getElementById('export-pdf-end').value;
  const eventType = document.getElementById('export-pdf-type').value;

  let url = `/api/events?start=${startDate}T00:00:00&end=${endDate}T23:59:59`;
  if (eventType) url += `&event_type=${eventType}`;

  const { ok, data } = await apiFetch(url);
  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-pdf me-1"></i>Download PDF';

  if (!ok) { showAlert('export-pdf-msg', data.error || 'Failed to load events'); return; }
  const events = data.events || [];
  if (!events.length) { showAlert('export-pdf-msg', 'No events found in that range'); return; }

  generateEventsPdf(events, { startDate, endDate, eventType });
});

// Same export, available to everyone (no login required) via a toolbar button on the calendar.
document.getElementById('btn-export-pdf').addEventListener('click', () => {
  hideAlert('pub-export-pdf-msg');
  document.getElementById('pub-export-pdf-form').reset();
  new bootstrap.Modal(document.getElementById('exportPdfModal')).show();
});

document.getElementById('pub-export-pdf-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('pub-export-pdf-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Generating…';

  const startDate = document.getElementById('pub-export-pdf-start').value; // "YYYY-MM-DD"
  const endDate = document.getElementById('pub-export-pdf-end').value;
  const eventType = document.getElementById('pub-export-pdf-type').value;

  let url = `/api/events?start=${startDate}T00:00:00&end=${endDate}T23:59:59`;
  if (eventType) url += `&event_type=${eventType}`;

  const { ok, data } = await apiFetch(url);
  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-pdf me-1"></i>Download PDF';

  if (!ok) { showAlert('pub-export-pdf-msg', data.error || 'Failed to load events'); return; }
  const events = data.events || [];
  if (!events.length) { showAlert('pub-export-pdf-msg', 'No events found in that range'); return; }

  generateEventsPdf(events, { startDate, endDate, eventType });
  bootstrap.Modal.getInstance(document.getElementById('exportPdfModal'))?.hide();
});

function generateEventsPdf(events, { startDate, endDate, eventType }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text('Campus Events — College of Idaho', 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100);
  const rangeLabel = `${startDate} to ${endDate}` + (eventType ? ` · ${EVENT_TYPE_LABELS[eventType] || eventType}` : ' · All types');
  doc.text(rangeLabel, 14, 25);

  const rows = events.map(ev => [
    new Date(ev.start_datetime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    ev.title,
    ev.entity_name || '',
    EVENT_TYPE_LABELS[ev.event_type] || ev.event_type || '',
    ev.location_name || '',
  ]);

  doc.autoTable({
    startY: 30,
    head: [['Date/Time', 'Title', 'Entity', 'Type', 'Location']],
    body: rows,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [83, 56, 96] }, // --coi-blue
  });

  doc.save(`campus-events-${startDate}-to-${endDate}.pdf`);
}

// Create event (admin)
document.getElementById('admin-create-event-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('adm-create-event-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>';

  let location_id = null;
  const sel = document.getElementById('adm-ev-location');
  const newLoc = document.getElementById('adm-ev-new-location')?.value.trim();
  if (newLoc) {
    try {
      location_id = await ensureLocation(newLoc);
    } catch (err) {
      showAlert('adm-create-event-msg', err.message || 'Failed to create location');
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Event';
      return;
    }
  } else if (sel && sel.value) {
    location_id = parseInt(sel.value);
  }

  const adm_start = document.getElementById('adm-ev-start').value;
  const adm_end = document.getElementById('adm-ev-end').value;
  if (!isValidEventRange(adm_start, adm_end)) {
    showAlert('adm-create-event-msg', 'End time must be after start time');
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Event';
    return;
  }

  const { ok, data } = await apiFetch('/api/events', {
    method: 'POST',
    body: JSON.stringify({
      entity_id:      parseInt(document.getElementById('adm-ev-entity').value),
      title:          document.getElementById('adm-ev-title').value.trim(),
      description:    document.getElementById('adm-ev-desc').value.trim(),
      event_type:     document.getElementById('adm-ev-type').value,
      location_id,
      start_datetime: adm_start,
      end_datetime:   adm_end,
    }),
  });

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Event';

  if (!ok) { showAlert('adm-create-event-msg', data.error || 'Failed to create event'); return; }
  showAlert('adm-create-event-msg', 'Event created!', 'success');
  this.reset();
  loadAdminEvents();
});

// Delete entity (no longer needs to be on window – called via event delegation)
async function adminDeleteEntity(id) {
  if (!confirm('Delete this entity and all its events?')) return;
  const { ok, data } = await apiFetch(`/api/entities/${id}`, { method: 'DELETE' });
  if (!ok) { alert(data.error || 'Failed to delete entity'); return; }
  loadAdminData();
}

// Edit entity (name / type)
function openEditEntityModal(id, name, type) {
  document.getElementById('edit-ent-id').value = id;
  document.getElementById('edit-ent-name').value = name;
  document.getElementById('edit-ent-type').value = type;
  hideAlert('edit-entity-msg');
  new bootstrap.Modal(document.getElementById('editEntityModal')).show();
}

document.getElementById('edit-entity-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('edit-entity-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>';

  const id = document.getElementById('edit-ent-id').value;
  const { ok, data } = await apiFetch(`/api/entities/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: document.getElementById('edit-ent-name').value.trim(),
      type: document.getElementById('edit-ent-type').value,
    }),
  });

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check me-1"></i>Save Changes';

  if (!ok) { showAlert('edit-entity-msg', data.error || 'Failed to update entity'); return; }
  bootstrap.Modal.getInstance(document.getElementById('editEntityModal')).hide();
  loadAdminData();
});

// Delete location (admin only; events referencing it just lose their location, not deleted)
async function adminDeleteLocation(id) {
  if (!confirm('Delete this location? Any events using it will keep their date/time but lose the location.')) return;
  const { ok, data } = await apiFetch(`/api/locations/${id}`, { method: 'DELETE' });
  if (!ok) { alert(data.error || 'Failed to delete location'); return; }
  loadAdminData();
}

// Edit location (rename)
function openEditLocationModal(id, name) {
  document.getElementById('edit-loc-id').value = id;
  document.getElementById('edit-loc-name').value = name;
  hideAlert('edit-location-msg');
  new bootstrap.Modal(document.getElementById('editLocationModal')).show();
}

document.getElementById('edit-location-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('edit-location-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>';

  const id = document.getElementById('edit-loc-id').value;
  const { ok, data } = await apiFetch(`/api/locations/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: document.getElementById('edit-loc-name').value.trim() }),
  });

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check me-1"></i>Save Changes';

  if (!ok) { showAlert('edit-location-msg', data.error || 'Failed to update location'); return; }
  bootstrap.Modal.getInstance(document.getElementById('editLocationModal')).hide();
  loadAdminData();
});

// Reset an entity's password (e.g. when its point of contact changes). The old password stops
// working immediately; the new temp password is shown once and the entity must set their own
// on next login.
async function adminResetEntityPassword(id, name) {
  if (!confirm(`Reset the password for "${name}"? Their current password will stop working immediately, and they'll need to set a new one on next login.`)) return;

  const { ok, data } = await apiFetch(`/api/entities/${id}/reset-password`, { method: 'POST' });
  if (!ok) { alert(data.error || 'Failed to reset password'); return; }

  document.getElementById('reset-pw-entity-name').textContent = data.entity.name;
  document.getElementById('reset-pw-value').value = data.temp_password;
  hideAlert('reset-pw-copied-msg');
  new bootstrap.Modal(document.getElementById('resetPwModal')).show();
  loadAdminData();
}

document.getElementById('btn-copy-reset-pw').addEventListener('click', async () => {
  const input = document.getElementById('reset-pw-value');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch (e) {
    input.select();
    document.execCommand('copy');
  }
  showAlert('reset-pw-copied-msg', 'Copied to clipboard', 'success');
  setTimeout(() => hideAlert('reset-pw-copied-msg'), 2000);
});

// Refreshes whichever event list(s) are currently relevant -- admin and entity logins are
// mutually exclusive in this app, so at most one of these actually does anything, but the edit
// modal and delete button are shared between the admin Events list and an entity's My Events
// list, and don't know which context they were opened from.
function refreshEventLists() {
  if (state.loggedInEntity) loadMyEvents();
  if (state.adminToken) loadAdminEvents();
}

// Delete event (shared by the admin Events list and an entity's own My Events list -- the API
// already permits either an admin or the owning entity)
async function deleteEventById(id) {
  if (!confirm('Delete this event?')) return;
  const { ok, data } = await apiFetch(`/api/events/${id}`, { method: 'DELETE' });
  if (!ok) { alert(data.error || 'Failed to delete event'); return; }
  refreshEventLists();
}

// Edit event (title / description / location / start / end – entity can't be changed)
async function openEditEventModal(id) {
  hideAlert('edit-event-msg');
  const { ok, data } = await apiFetch(`/api/events/${id}`);
  if (!ok) { alert(data.error || 'Failed to load event'); return; }
  const ev = data.event;

  document.getElementById('edit-ev-id').value = ev.id;
  document.getElementById('edit-ev-title').value = ev.title;
  document.getElementById('edit-ev-desc').value = ev.description || '';
  document.getElementById('edit-ev-type').value = ev.event_type || 'other';
  document.getElementById('edit-ev-start').value = formatDateTimeLocal(new Date(ev.start_datetime));
  document.getElementById('edit-ev-end').value = formatDateTimeLocal(new Date(ev.end_datetime));
  document.getElementById('edit-ev-new-location').value = '';

  const locations = await fetchLocations();
  const locSel = document.getElementById('edit-ev-location');
  locSel.innerHTML = `<option value="">No location</option>` +
    locations.map(l => `<option value="${l.id}" ${l.id === ev.location_id ? 'selected' : ''}>${escHtml(l.name)}</option>`).join('');

  new bootstrap.Modal(document.getElementById('editEventModal')).show();
}

document.getElementById('edit-event-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('edit-event-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>';

  const id = document.getElementById('edit-ev-id').value;
  // Explicitly null (not just omitted) when no location is picked, so the API can tell
  // "clear the location" apart from "field wasn't sent" and actually clear it.
  let location_id = null;
  const sel = document.getElementById('edit-ev-location');
  const newLoc = document.getElementById('edit-ev-new-location')?.value.trim();
  if (newLoc) {
    try {
      location_id = await ensureLocation(newLoc);
    } catch (err) {
      showAlert('edit-event-msg', err.message || 'Failed to create location');
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check me-1"></i>Save Changes';
      return;
    }
  } else if (sel && sel.value) {
    location_id = parseInt(sel.value);
  }
  // else: sel.value === "" (the "No location" option) -> location_id stays null, clearing it.

  const edit_start = document.getElementById('edit-ev-start').value;
  const edit_end = document.getElementById('edit-ev-end').value;
  if (!isValidEventRange(edit_start, edit_end)) {
    showAlert('edit-event-msg', 'End time must be after start time');
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check me-1"></i>Save Changes';
    return;
  }

  const { ok, data } = await apiFetch(`/api/events/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      title:          document.getElementById('edit-ev-title').value.trim(),
      description:    document.getElementById('edit-ev-desc').value.trim(),
      event_type:     document.getElementById('edit-ev-type').value,
      location_id,
      start_datetime: edit_start,
      end_datetime:   edit_end,
    }),
  });

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check me-1"></i>Save Changes';

  if (!ok) { showAlert('edit-event-msg', data.error || 'Failed to update event'); return; }
  bootstrap.Modal.getInstance(document.getElementById('editEventModal')).hide();
  refreshEventLists();
});

/* =============================================================
   ADMIN: MENU + IN-APP ROADMAP
   ============================================================= */
document.querySelectorAll('#admin-subnav [data-admin-section]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#admin-subnav [data-admin-section]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.admin-section').forEach(sec => sec.classList.add('d-none'));
    document.getElementById(`admin-section-${btn.dataset.adminSection}`).classList.remove('d-none');
    if (btn.dataset.adminSection === 'roadmap') { renderAdminRoadmap(); loadAdminFeedback(); }
    if (btn.dataset.adminSection === 'utilities') loadAdminSettings();
  });
});

// Second-level tabs within Events/Entities/Locations (Create/Import/Export) -- same show/hide
// pattern as the top-level admin-subnav, just scoped to whichever section owns the clicked pill.
document.querySelectorAll('[data-subnav-scope]').forEach(nav => {
  const scope = nav.dataset.subnavScope;
  nav.querySelectorAll('[data-sub-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      nav.querySelectorAll('[data-sub-section]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll(`.admin-subsection[data-scope="${scope}"]`).forEach(sec => sec.classList.add('d-none'));
      document.getElementById(`admin-sub-${btn.dataset.subSection}`).classList.remove('d-none');
    });
  });
});

// Mirrors ROADMAP.md, broken into phases/sub-phases for the in-app admin view. Keep both in sync
// when items ship or get reprioritized.
const ROADMAP_PHASES = [
  {
    title: 'Phase 1 — Admin Experience',
    status: 'shipped',
    blurb: 'Turn the single-page admin dashboard into a real multi-section tool.',
    items: [
      { title: 'Admin menu (multi-section panel)', status: 'shipped',
        desc: 'Splits the dashboard into a Dashboard section (create/manage entities & events) and this Roadmap section, navigable via the pills above instead of one long scroll. Later split further into top-level tabs (Events/Entities/Locations/Utilities/Roadmap) with Create/Import/Export sub-tabs, once Dashboard itself grew into its own long scroll of eight stacked cards.' },
      { title: 'In-app phased roadmap view', status: 'shipped',
        desc: 'This page — mirrors ROADMAP.md so anyone with admin access can see what’s planned without reading the repo.' },
      { title: 'Edit entities & events in place', status: 'shipped',
        desc: 'Pencil-icon edit buttons open a modal instead of requiring delete-and-recreate, which used to lose an entity’s id/password history or an event’s data.' },
      { title: '"Program" entity type', status: 'shipped',
        desc: 'A fifth entity type alongside Club/Department/Office/Organization.' },
    ],
  },
  {
    title: 'Phase 2 — Event Discovery Quick Wins',
    status: 'shipped',
    blurb: 'Small, mostly self-contained features inspired by events.brown.edu (LiveWhale Calendar) that make individual events easier to find, share, and get onto someone’s own calendar.',
    items: [
      { title: 'Shareable event detail pages', status: 'shipped',
        desc: 'A real URL per event (e.g. /event/:id) instead of only a modal inside the SPA, so a link can be texted or posted and opens straight to that event.' },
      { title: 'Add to Calendar (.ics)', status: 'shipped',
        desc: 'One-click download of a standard .ics file for a single event — a small endpoint that formats one event as iCalendar. Self-contained.' },
      { title: 'Share links', status: 'shipped',
        desc: 'Copy-link / native share button on the event detail page. Depends on shareable event pages existing first.' },
      { title: 'Event search', status: 'shipped',
        desc: 'Free-text search across all events (title/description/entity), not just the existing entity-name filter on the Entities page. Searches from a month ago through all upcoming events, not just forward from right now.' },
      { title: 'Skip-navigation link', status: 'shipped',
        desc: 'A hidden-until-focused "Skip to content" link at the top of the page for keyboard/screen-reader users — standard accessibility practice, and something LiveWhale Calendar includes.' },
    ],
  },
  {
    title: 'Phase 3 — Calendar Navigation & Filtering',
    status: 'planned',
    items: [
      { title: 'Mini-calendar heat map', status: 'planned',
        desc: 'A small month-at-a-glance widget shading days by how many events they have, for quickly spotting busy days.' },
      { title: 'Jump-to-Day', status: 'planned',
        desc: 'A date picker that jumps the week/day view straight to a chosen date instead of paging one day/week at a time.' },
      { title: 'Tags / categories', status: 'shipped',
        desc: 'Shipped in a simpler form: a single event_type per event (Meeting/Social/Academic/Athletic/Fundraiser/Performance/Other), filterable via the API and used in the PDF export (available to everyone, not just admins). Full free-form/multi-tag support is still a possible future upgrade if the fixed list ever proves too narrow.' },
      { title: 'Calendar filtering', status: 'shipped',
        desc: 'A filter button on the calendar toolbar narrows visible events by type, entity, and location (GET /api/events gained a matching location_id param alongside entity_id/event_type). Applies across week/day/month and persists through navigation; clears itself on leaving the calendar page or after 20 minutes idle, with a count badge on the toolbar button so a left-on filter doesn’t quietly make events look "missing."' },
      { title: 'Subscribable filtered feed (RSS/iCal)', status: 'planned',
        desc: 'A live-updating feed URL reflecting the same filters as the Entities page (e.g. "just Chess Club"), so a calendar app stays in sync automatically instead of a one-time .ics download. More natural to build now that calendar filtering exists -- a feed endpoint could reuse those same entity_id/event_type/location_id query params directly.' },
    ],
  },
  {
    title: 'Phase 4 — Richer Event Types',
    status: 'planned',
    items: [
      { title: 'Recurring events', status: 'planned',
        desc: 'Weekly/monthly event series with an edit-this-vs-edit-series distinction. The biggest schema/UX change on this list — needs a recurrence-rule column and instance-expansion logic.' },
      { title: 'Virtual / hybrid events', status: 'planned',
        desc: 'An optional join-link field and a "Virtual"/"Hybrid" badge and filter, for events not tied to a physical campus location.' },
    ],
  },
  {
    title: 'Phase 5 — Media & Structured Data',
    status: 'planned',
    items: [
      { title: 'Image storage infrastructure', status: 'planned',
        desc: 'Reintroduces file storage (deliberately dropped earlier): an R2 bucket bound in wrangler.toml for both prod and preview, an upload endpoint, and rewriting the currently-stubbed functions/api/files/[key].js (currently 410 Gone) to serve from R2.' },
      { title: 'Entity logo upload', status: 'planned',
        desc: 'Replace the current icon-plus-initial with an actual uploaded image, once image storage exists.' },
      { title: 'Event poster images', status: 'planned',
        desc: 'Photo-forward event cards, also depends on image storage.' },
      { title: 'schema.org structured data', status: 'planned',
        desc: 'Embed Event/Organization JSON-LD on event/entity pages so search engines and calendar aggregators can read them — pairs naturally with shareable event pages and poster images.' },
    ],
  },
  {
    title: 'Phase 6 — Admin & Governance',
    status: 'planned',
    items: [
      { title: 'Admin-managed kiosk settings', status: 'planned',
        desc: '/display.html’s day count is currently a URL parameter (?days=N) set once at TV setup — deliberately simple. Would become a real admin-panel setting if that stops being a one-time thing (e.g. multiple screens needing different settings).' },
      { title: 'Per-person entity logins / audit trail', status: 'planned',
        desc: 'Entities currently share one password per organization, which suits how they’re used today. Would need named per-person logins if tracking who specifically posted each event ever becomes important — a bigger change.' },
      { title: 'Self-service admin password reset', status: 'shipped',
        desc: 'Previously, a forgotten admin password could only be recovered by deleting the admin row directly in D1 (needing Cloudflare/wrangler access, not just the app) -- a real continuity risk for a single shared institutional account. A "Forgot password?" link on the admin login page now emails a one-time reset link (30-minute expiry, single-use, token stored only as a SHA-256 hash) to the recovery address in Admin → Utilities → Notifications. Only actually solves succession if that address is institutional (a shared inbox, an IT alias) rather than any one person’s.' },
      { title: 'Usage analytics dashboard', status: 'planned',
        desc: 'Turn the admin Dashboard tab into an actual dashboard: event count, entities that have posted at least one event, PDF export count, and app views by device (mobile vs desktop). Needs a new aggregate-only events-log table (no IP/identifying data) plus a beacon call and a summary API endpoint. Open question: simple stat tiles vs real trend charts (the latter needs an SRI-pinned charting library, same treatment as jsPDF).' },
      { title: 'Feedback / bug report tool', status: 'shipped',
        desc: 'A floating Feedback button on every page opens a modal (bug/suggestion/other + message + optional reply-to email) — no login required. Reviewed under Admin → Roadmap → Suggestions & Feedback; deleting an item is the "handled" action. Emails the address set in Admin → Utilities → Notifications via Resend, if one is configured — a missing API key or failed send never blocks the submission, it just skips the email.' },
    ],
  },
];

const ROADMAP_STATUS_BADGE = {
  shipped:      '<span class="badge bg-success">Shipped</span>',
  'in-progress':'<span class="badge bg-primary">In Progress</span>',
  planned:      '<span class="badge bg-secondary">Planned</span>',
};

function renderAdminRoadmap() {
  const el = document.getElementById('admin-roadmap-phases');
  if (!el || el.dataset.rendered) return;
  el.dataset.rendered = '1';

  el.innerHTML = `
    <p class="text-muted small mb-3">
      What's built and what's next — not a promise or a timeline, just so ideas don't get lost
      between sessions. Full detail in <code>ROADMAP.md</code>; shipped work is in <code>CHANGELOG.md</code>.
    </p>
    ${ROADMAP_PHASES.map(phase => `
      <div class="section-card mb-3">
        <div class="roadmap-phase-header">
          <h4 class="mb-0">${escHtml(phase.title)}</h4>
          ${ROADMAP_STATUS_BADGE[phase.status] || ''}
        </div>
        ${phase.blurb ? `<p class="roadmap-phase-blurb">${escHtml(phase.blurb)}</p>` : ''}
        <ul class="roadmap-item-list">
          ${phase.items.map(item => `
            <li>
              <div class="roadmap-item-header">
                <strong>${escHtml(item.title)}</strong>
                ${ROADMAP_STATUS_BADGE[item.status] || ''}
              </div>
              <div class="roadmap-item-desc">${escHtml(item.desc)}</div>
            </li>
          `).join('')}
        </ul>
      </div>
    `).join('')}
  `;
}

const FEEDBACK_CATEGORY_LABELS = { bug: 'Bug', suggestion: 'Suggestion', other: 'Other' };
const FEEDBACK_CATEGORY_BADGE = {
  bug: '<span class="badge bg-danger">Bug</span>',
  suggestion: '<span class="badge bg-primary">Suggestion</span>',
  other: '<span class="badge bg-secondary">Other</span>',
};

async function loadAdminFeedback() {
  const el = document.getElementById('admin-feedback-list');
  const { ok, data } = await apiFetch('/api/feedback');
  const items = ok ? (data.feedback || []) : [];

  if (!items.length) {
    el.innerHTML = '<p class="text-muted small mb-0">No feedback submitted yet.</p>';
    return;
  }

  el.innerHTML = items.map(f => `
    <div class="event-list-item align-items-start" data-feedback-id="${f.id}">
      <div class="ev-info">
        <div class="ev-title-txt">
          ${FEEDBACK_CATEGORY_BADGE[f.category] || escHtml(f.category)}
          <span class="ms-1">${escHtml(f.message)}</span>
        </div>
        <div class="ev-meta-txt">
          ${new Date(f.created_at).toLocaleString()}
          ${f.contact_email ? ` · <a href="mailto:${escHtml(f.contact_email)}">${escHtml(f.contact_email)}</a>` : ''}
        </div>
      </div>
      <button class="btn btn-sm btn-outline-danger" data-delete-feedback="${f.id}" title="Delete (mark handled)">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>`).join('');

  el.querySelectorAll('[data-delete-feedback]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { ok } = await apiFetch(`/api/feedback/${btn.dataset.deleteFeedback}`, { method: 'DELETE' });
      if (ok) loadAdminFeedback();
    });
  });
}

async function loadAdminSettings() {
  const { ok, data } = await apiFetch('/api/admin/settings');
  document.getElementById('admin-notify-email').value = ok ? (data.notify_email || '') : '';
}

document.getElementById('admin-settings-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('admin-settings-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>';

  const { ok, data } = await apiFetch('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify({ notify_email: document.getElementById('admin-notify-email').value.trim() }),
  });

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk me-1"></i>Save';

  if (!ok) { showAlert('admin-settings-msg', data.error || 'Failed to save settings'); return; }
  showAlert('admin-settings-msg', 'Saved!', 'success');
});

/* =============================================================
   FEEDBACK / BUG REPORTS (public — every page, no login required)
   ============================================================= */
document.getElementById('btn-feedback').addEventListener('click', () => {
  hideAlert('feedback-msg');
  document.getElementById('feedback-form').reset();
  new bootstrap.Modal(document.getElementById('feedbackModal')).show();
});

document.getElementById('feedback-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('feedback-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Sending…';

  const { ok, data } = await apiFetch('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({
      category: document.getElementById('feedback-category').value,
      message: document.getElementById('feedback-message').value.trim(),
      contact_email: document.getElementById('feedback-email').value.trim(),
    }),
  });

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane me-1"></i>Send';

  if (!ok) { showAlert('feedback-msg', data.error || 'Failed to send feedback'); return; }

  showAlert('feedback-msg', 'Thanks! Your feedback was sent.', 'success');
  this.reset();
  setTimeout(() => bootstrap.Modal.getInstance(document.getElementById('feedbackModal'))?.hide(), 1200);
});

/* =============================================================
   EVENT SEARCH
   ============================================================= */
// Searches from a month ago through all upcoming events (no upper bound) -- not just "upcoming",
// so a search still finds something recently past (e.g. an event from last week someone's
// looking to reference), without unbounded-past results piling up for a common search term.
document.getElementById('btn-event-search').addEventListener('click', () => {
  const input = document.getElementById('event-search-input');
  input.value = '';
  document.getElementById('event-search-results').innerHTML =
    '<p class="text-muted small">Start typing to search events from the past month onward.</p>';
  new bootstrap.Modal(document.getElementById('eventSearchModal')).show();
  setTimeout(() => input.focus(), 200);
});

async function runEventSearch(q) {
  const resultsEl = document.getElementById('event-search-results');
  if (!q.trim()) {
    resultsEl.innerHTML = '<p class="text-muted small">Start typing to search events from the past month onward.</p>';
    return;
  }

  const searchStart = isoLocal(addMonths(new Date(), -1));
  const { ok, data } = await apiFetch(`/api/events?start=${searchStart}&q=${encodeURIComponent(q.trim())}`);
  const results = ok ? (data.events || []) : [];

  if (!results.length) {
    resultsEl.innerHTML = '<p class="text-muted small">No events from the past month or upcoming match your search.</p>';
    return;
  }

  resultsEl.innerHTML = results.map(ev => {
    const start = new Date(ev.start_datetime);
    const end = new Date(ev.end_datetime);
    const timeStr = `${fmt(start,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} – ${fmt(end,{hour:'numeric',minute:'2-digit'})}`;
    return `<div class="event-list-item search-result-item" data-ev-id="${ev.id}" style="cursor:pointer">
      <div class="ev-info">
        <div class="ev-title-txt">${escHtml(ev.title)}</div>
        <div class="ev-meta-txt">${escHtml(ev.entity_name || '')} · ${escHtml(timeStr)}${ev.location_name ? ' · ' + escHtml(ev.location_name) : ''}</div>
      </div>
    </div>`;
  }).join('');

  resultsEl.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', () => {
      const ev = results.find(e => String(e.id) === el.dataset.evId);
      bootstrap.Modal.getInstance(document.getElementById('eventSearchModal'))?.hide();
      if (ev) showEventModal(ev);
    });
  });
}

document.getElementById('event-search-input').addEventListener('input', debounce(function () {
  runEventSearch(this.value);
}, 300));

/* =============================================================
   CALENDAR FILTERS (event type / entity / location)
   ============================================================= */
// A left-on filter silently hides events, which reads as "where did everything go" to whoever
// hits this next -- rather than trusting people to remember to clear it, it clears itself after
// a while unattended, and immediately on leaving the calendar page (the "switch screens" case is
// the more common way to forget, so it isn't just a fallback for the timer).
const CAL_FILTER_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

function updateCalFilterIndicator() {
  const btn = document.getElementById('btn-cal-filter');
  const badge = document.getElementById('cal-filter-badge');
  const count = activeCalFilterCount();
  btn.classList.toggle('active', count > 0);
  badge.classList.toggle('d-none', count === 0);
  badge.textContent = String(count);
  btn.title = count > 0 ? `Filter events (${count} active)` : 'Filter events';
}

function armCalFilterTimeout() {
  clearTimeout(state.calFilterTimeoutId);
  state.calFilterTimeoutId = setTimeout(() => {
    state.calFilters = { event_type: '', entity_id: '', location_id: '' };
    updateCalFilterIndicator();
    if (state.currentPage === 'home') renderCalendar();
  }, CAL_FILTER_TIMEOUT_MS);
}

function disarmCalFilterTimeout() {
  clearTimeout(state.calFilterTimeoutId);
  state.calFilterTimeoutId = null;
}

async function populateCalFilterOptions() {
  const entitySel = document.getElementById('cal-filter-entity');
  const locationSel = document.getElementById('cal-filter-location');

  const [entities, locations] = await Promise.all([
    apiFetch('/api/entities').then(({ ok, data }) => (ok ? data.entities || [] : [])),
    fetchLocations(),
  ]);

  const ENTITY_TYPE_ORDER = ['club', 'department', 'office', 'organization', 'program'];
  const groupedEntities = ENTITY_TYPE_ORDER
    .map(type => ({ type, label: TYPE_LABELS[type] || type, items: entities.filter(en => en.type === type) }))
    .filter(g => g.items.length);
  const knownTypes = new Set(ENTITY_TYPE_ORDER);
  const otherEntities = entities.filter(en => !knownTypes.has(en.type));
  if (otherEntities.length) groupedEntities.push({ type: 'other', label: 'Other', items: otherEntities });

  entitySel.innerHTML = `<option value="">All entities</option>` +
    groupedEntities.map(g => `<optgroup label="${escHtml(g.label)}s">` +
      g.items.map(en => `<option value="${en.id}">${escHtml(en.name)}</option>`).join('') +
      `</optgroup>`
    ).join('');

  locationSel.innerHTML = `<option value="">All locations</option>` +
    locations.map(l => `<option value="${l.id}">${escHtml(l.name)}</option>`).join('');

  document.getElementById('cal-filter-type').value = state.calFilters.event_type;
  entitySel.value = state.calFilters.entity_id;
  locationSel.value = state.calFilters.location_id;
}

document.getElementById('btn-cal-filter').addEventListener('click', async () => {
  new bootstrap.Modal(document.getElementById('calFilterModal')).show();
  await populateCalFilterOptions();
});

document.getElementById('cal-filter-form').addEventListener('submit', function (e) {
  e.preventDefault();
  state.calFilters = {
    event_type:  document.getElementById('cal-filter-type').value,
    entity_id:   document.getElementById('cal-filter-entity').value,
    location_id: document.getElementById('cal-filter-location').value,
  };
  updateCalFilterIndicator();
  if (calFiltersActive()) armCalFilterTimeout(); else disarmCalFilterTimeout();
  bootstrap.Modal.getInstance(document.getElementById('calFilterModal'))?.hide();
  if (state.currentPage === 'home') renderCalendar();
});

document.getElementById('cal-filter-clear').addEventListener('click', () => {
  state.calFilters = { event_type: '', entity_id: '', location_id: '' };
  document.getElementById('cal-filter-form').reset();
  updateCalFilterIndicator();
  disarmCalFilterTimeout();
  bootstrap.Modal.getInstance(document.getElementById('calFilterModal'))?.hide();
  if (state.currentPage === 'home') renderCalendar();
});

/* =============================================================
   INIT
   ============================================================= */
navigate('home');

// Support deep links / shared links to a single event (e.g. /event/42), including when the SPA
// boots from public/404.html's fallback for a path Cloudflare Pages doesn't otherwise match.
(function handleInitialEventDeepLink() {
  const m = location.pathname.match(/^\/event\/(\d+)$/);
  if (m) openEventModalById(m[1], { pushState: false });
})();

// Support the emailed admin password-reset link (/?reset_token=...): jump to the Admin page and
// open the "Set New Password" modal pre-filled with the token, then strip it from the visible
// URL so it doesn't linger in the address bar or browser history after use.
(function handleAdminResetTokenLink() {
  const token = new URLSearchParams(location.search).get('reset_token');
  if (!token) return;
  document.getElementById('reset-admin-token').value = token;
  navigate('admin');
  new bootstrap.Modal(document.getElementById('resetAdminPasswordModal')).show();
  history.replaceState({}, '', location.pathname);
})();
