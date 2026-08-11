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

async function ensureLocation(newName) {
  const token = state.loggedInEntity?.token || state.adminToken;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch('/api/locations', { method: 'POST', headers, body: JSON.stringify({ name: newName }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to create location');
  return data.id;
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
  const { ok, data } = await apiFetch(`/api/events?start=${startISO}&end=${endISO}`);
  return ok ? data.events || [] : [];
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
      const duration = Math.max(endMin - startMin, 15); // min 15-min visual height for readability
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
    if (nowEl && container) {
      const nowRect = nowEl.getBoundingClientRect();
      const contRect = container.getBoundingClientRect();
      const headerEl = document.querySelector('.calendar-header');
      const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;
      // Small top margin so the now-line isn't flush with the header
      const margin = 24;
      const delta = nowRect.top - (contRect.top + headerH + margin);
      // Adjust scrollTop by delta (works for both documentElement and scrollable container)
      container.scrollTop = (container.scrollTop || 0) + delta;
    } else {
      // Fall back to scrolling to 7am (previous behavior)
      const dayHeaderH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--day-header-h')) || 52;
      const scrollTo = 7 * HOUR_H + dayHeaderH; // align so 7am sits below headers
      const container = findVerticalScrollContainer(grid) || document.documentElement;
      container.scrollTop = scrollTo;
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

function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* =============================================================
   ENTITIES PAGE
   ============================================================= */
async function loadEntities() {
  const grid = document.getElementById('entities-grid');
  grid.innerHTML = `<div class="text-center text-muted py-5 col-12">
    <i class="fa-solid fa-spinner fa-spin fa-2x mb-2"></i><p>Loading entities…</p></div>`;

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

function renderEntitiesGrid(entities) {
  const grid = document.getElementById('entities-grid');
  const count = document.getElementById('entities-count');

  if (!entities.length) {
    grid.innerHTML = `<div class="text-center text-muted py-5 col-12">
      <i class="fa-solid fa-face-sad-tear fa-2x mb-2"></i>
      <p>No entities found.</p></div>`;
    count.textContent = '';
    return;
  }

  count.textContent = `${entities.length} entit${entities.length !== 1 ? 'ies' : 'y'}`;

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

  grid.querySelectorAll('.entity-tile').forEach(tile => {
    tile.addEventListener('click', () => openEntityLoginModal(
      parseInt(tile.dataset.entityId), tile.dataset.entityName
    ));
    tile.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') tile.click();
    });
  });
}

// Entity search/filter
document.getElementById('entity-search').addEventListener('input', applyEntityFilters);
document.getElementById('entity-type-filter').addEventListener('change', applyEntityFilters);

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

async function loadAdminData() {
  // Load entities for the dropdown + entities list
  const { ok, data } = await apiFetch('/api/entities');
  const entities = ok ? (data.entities || []) : [];

  // Populate entity select
  const sel = document.getElementById('adm-ev-entity');
  sel.innerHTML = `<option value="">– select entity –</option>` +
    entities.map(en => `<option value="${en.id}">${escHtml(en.name)}</option>`).join('');

  // Populate locations for admin event form
  try {
    const locations = await fetchLocations();
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

  // Events list
  loadAdminEvents();
}

async function loadAdminEvents() {
  const evList = document.getElementById('admin-events-list');
  const now = new Date();
  const { ok, data } = await apiFetch(`/api/events?start=${isoLocal(now)}`);
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
      btn.addEventListener('click', () => adminDeleteEvent(parseInt(btn.dataset.deleteEvent)));
    });
    evList.querySelectorAll('[data-edit-event]').forEach(btn => {
      btn.addEventListener('click', () => openEditEventModal(parseInt(btn.dataset.editEvent)));
    });
  } else {
    evList.innerHTML = '<p class="text-muted small">No upcoming events.</p>';
  }
}

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

// Delete event
async function adminDeleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  const { ok, data } = await apiFetch(`/api/events/${id}`, { method: 'DELETE' });
  if (!ok) { alert(data.error || 'Failed to delete event'); return; }
  loadAdminEvents();
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
      location_id,
      start_datetime: edit_start,
      end_datetime:   edit_end,
    }),
  });

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check me-1"></i>Save Changes';

  if (!ok) { showAlert('edit-event-msg', data.error || 'Failed to update event'); return; }
  bootstrap.Modal.getInstance(document.getElementById('editEventModal')).hide();
  loadAdminEvents();
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
    if (btn.dataset.adminSection === 'roadmap') renderAdminRoadmap();
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
        desc: 'Splits the dashboard into a Dashboard section (create/manage entities & events) and this Roadmap section, navigable via the pills above instead of one long scroll.' },
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
    status: 'planned',
    blurb: 'Small, mostly self-contained features inspired by events.brown.edu (LiveWhale Calendar) that make individual events easier to find, share, and get onto someone’s own calendar.',
    items: [
      { title: 'Shareable event detail pages', status: 'planned',
        desc: 'A real URL per event (e.g. /event/:id) instead of only a modal inside the SPA, so a link can be texted or posted and opens straight to that event.' },
      { title: 'Add to Calendar (.ics)', status: 'planned',
        desc: 'One-click download of a standard .ics file for a single event — a small endpoint that formats one event as iCalendar. Self-contained.' },
      { title: 'Share links', status: 'planned',
        desc: 'Copy-link / native share button on the event detail page. Depends on shareable event pages existing first.' },
      { title: 'Event search', status: 'planned',
        desc: 'Free-text search across all events (title/description/entity), not just the existing entity-name filter on the Entities page.' },
      { title: 'Skip-navigation link', status: 'planned',
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
      { title: 'Tags / categories', status: 'planned',
        desc: 'Free-form or curated tags on events (e.g. "Fundraiser", "Athletics") independent of entity type, with a tag filter alongside the existing type filter.' },
      { title: 'Subscribable filtered feed (RSS/iCal)', status: 'planned',
        desc: 'A live-updating feed URL reflecting the same filters as the Entities page (e.g. "just Chess Club"), so a calendar app stays in sync automatically instead of a one-time .ics download.' },
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
    ],
  },
];

const ROADMAP_STATUS_BADGE = {
  shipped:      '<span class="badge bg-success">Shipped</span>',
  'in-progress':'<span class="badge bg-primary">In Progress</span>',
  planned:      '<span class="badge bg-secondary">Planned</span>',
};

function renderAdminRoadmap() {
  const el = document.getElementById('admin-section-roadmap');
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

/* =============================================================
   EVENT SEARCH
   ============================================================= */
document.getElementById('btn-event-search').addEventListener('click', () => {
  const input = document.getElementById('event-search-input');
  input.value = '';
  document.getElementById('event-search-results').innerHTML =
    '<p class="text-muted small">Start typing to search upcoming events.</p>';
  new bootstrap.Modal(document.getElementById('eventSearchModal')).show();
  setTimeout(() => input.focus(), 200);
});

async function runEventSearch(q) {
  const resultsEl = document.getElementById('event-search-results');
  if (!q.trim()) {
    resultsEl.innerHTML = '<p class="text-muted small">Start typing to search upcoming events.</p>';
    return;
  }

  const { ok, data } = await apiFetch(`/api/events?start=${isoLocal(new Date())}&q=${encodeURIComponent(q.trim())}`);
  const results = ok ? (data.events || []) : [];

  if (!results.length) {
    resultsEl.innerHTML = '<p class="text-muted small">No upcoming events match your search.</p>';
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
   INIT
   ============================================================= */
navigate('home');

// Support deep links / shared links to a single event (e.g. /event/42), including when the SPA
// boots from public/404.html's fallback for a path Cloudflare Pages doesn't otherwise match.
(function handleInitialEventDeepLink() {
  const m = location.pathname.match(/^\/event\/(\d+)$/);
  if (m) openEventModalById(m[1], { pushState: false });
})();
