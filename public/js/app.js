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
function eventColor(entityId) {
  return PALETTE[(entityId % PALETTE.length)];
}

const TYPE_LABELS = {
  club: 'Club',
  department: 'Department',
  office: 'Office',
  organization: 'Organization',
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
  const events = await fetchEvents(rangeStart, rangeEnd);

  // Build grid HTML
  const today = startOfDay(new Date());

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

    // Event blocks
    dayEvents.forEach(ev => {
      const start = new Date(ev.start_datetime);
      const end   = new Date(ev.end_datetime);
      const startMin = start.getHours() * 60 + start.getMinutes();
      const endMin   = end.getHours() * 60 + end.getMinutes();
      const duration = Math.max(endMin - startMin, 15); // min 15-min visual height for readability

      const topPx    = startMin * (HOUR_H / 60);
      const heightPx = duration * (HOUR_H / 60);
      const color = eventColor(ev.entity_id);
      const timeStr = `${fmt(start,{hour:'numeric',minute:'2-digit'})} – ${fmt(end,{hour:'numeric',minute:'2-digit'})}`;

      html += `<div class="cal-event"
          style="top:${topPx}px;height:${heightPx}px;background:${color};color:#fff"
          data-ev-id="${ev.id}"
          title="${escHtml(ev.title)} · ${escHtml(timeStr)}">
        <div class="ev-title">${escHtml(ev.title)}</div>
        <div class="ev-location">${escHtml(ev.location_name || '')}</div>
        <div class="ev-entity">${escHtml(ev.entity_name || '')}</div>
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
  grid.querySelectorAll('.cal-event').forEach(el => {
    el.addEventListener('click', () => openEventModal(el.dataset.evId, events));
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

  const events = await fetchEvents(isoLocal(gridStart), isoLocal(addDays(gridEnd, 1)));
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

function openEventModal(evId, events) {
  const ev = events.find(e => String(e.id) === String(evId));
  if (!ev) return;

  const modal = new bootstrap.Modal(document.getElementById('eventModal'));
  const start = new Date(ev.start_datetime);
  const end   = new Date(ev.end_datetime);

  document.getElementById('eventModalLabel').textContent = ev.title;
  document.getElementById('event-modal-title').textContent = ev.title;
  document.getElementById('event-modal-entity-badge').textContent = ev.entity_name || '';
  document.getElementById('event-modal-time').textContent =
    `${fmt(start,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} – ${fmt(end,{hour:'numeric',minute:'2-digit'})}`;
  document.getElementById('event-modal-desc').textContent = ev.description || 'No description provided.';

  // Display location instead of poster image
  const img = document.getElementById('event-modal-poster');
  if (ev.location_name) {
    img.classList.add('d-none');
    // append location to time display
    document.getElementById('event-modal-time').textContent += ` · ${escHtml(ev.location_name)}`;
  } else {
    img.classList.add('d-none');
  }

  modal.show();
}

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
        <button class="btn btn-sm btn-outline-danger" data-delete-event="${ev.id}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>`).join('');

    evList.querySelectorAll('[data-delete-event]').forEach(btn => {
      btn.addEventListener('click', () => adminDeleteEvent(parseInt(btn.dataset.deleteEvent)));
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

  const { ok, data } = await apiFetch('/api/events', {
    method: 'POST',
    body: JSON.stringify({
      entity_id:      parseInt(document.getElementById('adm-ev-entity').value),
      title:          document.getElementById('adm-ev-title').value.trim(),
      description:    document.getElementById('adm-ev-desc').value.trim(),
      location_id,
      start_datetime: document.getElementById('adm-ev-start').value,
      end_datetime:   document.getElementById('adm-ev-end').value,
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

/* =============================================================
   INIT
   ============================================================= */
navigate('home');
