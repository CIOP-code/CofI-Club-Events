/**
 * Club Events – College of Idaho
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
  clubs: [],
  loggedInClub: null,   // { id, name, logo_key, token }
  adminToken: null,
  pendingLoginClub: null,  // club object waiting for password
};

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
  if (page === 'clubs') loadClubs();
  if (page === 'senate') renderSenatePage();
}

document.querySelectorAll('[data-page]').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.page));
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

/** Pick a visually distinct color for an event based on its club ID */
const PALETTE = [
  '#1565c0','#6a1b9a','#00695c','#b71c1c','#e65100',
  '#37474f','#4527a0','#2e7d32','#ad1457','#0277bd',
];
function eventColor(clubId) {
  return PALETTE[(clubId % PALETTE.length)];
}

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

  const token = state.loggedInClub?.token || state.adminToken;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function uploadFile(file, intendedUse = 'poster') {
  const token = state.loggedInClub?.token || state.adminToken;
  const form = new FormData();
  form.append('file', file);
  form.append('intended_use', intendedUse);
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch('/api/upload', { method: 'POST', headers, body: form });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
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

async function renderCalendar() {
  const wrap = document.getElementById('cal-grid-wrap');
  const grid = document.getElementById('cal-grid');

  // Determine visible day range
  let days = [];
  const isMobile = window.innerWidth < 992;

  if (state.calView === 'day' || isMobile) {
    state.calView = 'day';
    days = [startOfDay(state.calAnchorDate)];
    setViewToggleActive('day');
  } else {
    const ws = getWeekStart(state.calAnchorDate);
    days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    setViewToggleActive('week');
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

  // Fetch events for the range
  const rangeStart = isoLocal(days[0]);
  const rangeEnd   = isoLocal(addDays(days[days.length - 1], 1));
  const events = await fetchEvents(rangeStart, rangeEnd);

  // Build grid HTML
  const today = startOfDay(new Date());

  let html = `<div class="time-col">`;
  // Blank top cell (aligns with day headers)
  html += `<div style="height:52px"></div>`;
  HOURS.forEach(h => {
    const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`;
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
    html += `<div class="day-header${isToday ? ' today' : ''}">
      <div class="day-name">${DAYS_SHORT[day.getDay()]}</div>
      <div class="day-num">${day.getDate()}</div>
    </div>`;
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
      const color = eventColor(ev.club_id);
      const timeStr = `${fmt(start,{hour:'numeric',minute:'2-digit'})} – ${fmt(end,{hour:'numeric',minute:'2-digit'})}`;

      html += `<div class="cal-event"
          style="top:${topPx}px;height:${heightPx}px;background:${color};color:#fff"
          data-ev-id="${ev.id}"
          title="${escHtml(ev.title)} · ${escHtml(timeStr)}">
        <div class="ev-title">${escHtml(ev.title)}</div>
        <div class="ev-club">${escHtml(ev.club_name || '')}</div>
      </div>`;
    });

    html += `</div></div>`;
  });
  html += `</div>`;

  grid.innerHTML = html;

  // Event block click → modal
  grid.querySelectorAll('.cal-event').forEach(el => {
    el.addEventListener('click', () => openEventModal(el.dataset.evId, events));
  });

  // Scroll to 7am on load
  const scrollTo = 7 * HOUR_H + 52; // 52 = day-header height
  wrap.scrollTop = scrollTo;
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
  document.getElementById('event-modal-club-badge').textContent = ev.club_name || '';
  document.getElementById('event-modal-time').textContent =
    `${fmt(start,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} – ${fmt(end,{hour:'numeric',minute:'2-digit'})}`;
  document.getElementById('event-modal-desc').textContent = ev.description || 'No description provided.';

  const img = document.getElementById('event-modal-poster');
  if (ev.poster_key) {
    img.src = `/api/files/${ev.poster_key}`;
    img.classList.remove('d-none');
  } else {
    img.classList.add('d-none');
  }

  modal.show();
}

function setViewToggleActive(view) {
  document.getElementById('btn-view-week').classList.toggle('active', view === 'week');
  document.getElementById('btn-view-day').classList.toggle('active', view === 'day');
}

// Calendar navigation
document.getElementById('btn-prev').addEventListener('click', () => {
  const days = state.calView === 'week' ? 7 : 1;
  state.calAnchorDate = addDays(state.calAnchorDate, -days);
  renderCalendar();
});
document.getElementById('btn-next').addEventListener('click', () => {
  const days = state.calView === 'week' ? 7 : 1;
  state.calAnchorDate = addDays(state.calAnchorDate, days);
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

// Re-render calendar on resize (desktop ↔ mobile switch)
window.addEventListener('resize', debounce(() => {
  if (state.currentPage === 'home') renderCalendar();
}, 250));

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* =============================================================
   CLUBS PAGE
   ============================================================= */
async function loadClubs() {
  const grid = document.getElementById('clubs-grid');
  grid.innerHTML = `<div class="text-center text-muted py-5 col-12">
    <i class="fa-solid fa-spinner fa-spin fa-2x mb-2"></i><p>Loading clubs…</p></div>`;

  const { ok, data } = await apiFetch('/api/clubs');
  state.clubs = ok ? (data.clubs || []) : [];
  renderClubsGrid(state.clubs);
}

function renderClubsGrid(clubs) {
  const grid = document.getElementById('clubs-grid');
  const count = document.getElementById('clubs-count');

  if (!clubs.length) {
    grid.innerHTML = `<div class="text-center text-muted py-5 col-12">
      <i class="fa-solid fa-face-sad-tear fa-2x mb-2"></i>
      <p>No clubs found.</p></div>`;
    count.textContent = '';
    return;
  }

  count.textContent = `${clubs.length} club${clubs.length !== 1 ? 's' : ''}`;

  grid.innerHTML = clubs.map(club => {
    const logoHtml = club.logo_key
      ? `<img src="/api/files/${club.logo_key}" alt="${escHtml(club.name)}" loading="lazy" />`
      : `<div class="club-logo-placeholder">${escHtml(club.name.charAt(0).toUpperCase())}</div>`;
    return `<div class="club-tile" data-club-id="${club.id}" data-club-name="${escHtml(club.name)}"
                 tabindex="0" role="button" aria-label="Login as ${escHtml(club.name)}">
      ${logoHtml}
      <div class="club-name">${escHtml(club.name)}</div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.club-tile').forEach(tile => {
    tile.addEventListener('click', () => openClubLoginModal(
      parseInt(tile.dataset.clubId), tile.dataset.clubName
    ));
    tile.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') tile.click();
    });
  });
}

// Club search/filter
document.getElementById('club-search').addEventListener('input', function () {
  const q = this.value.trim().toLowerCase();
  const filtered = q ? state.clubs.filter(c => c.name.toLowerCase().includes(q)) : state.clubs;
  renderClubsGrid(filtered);
});

function openClubLoginModal(clubId, clubName) {
  state.pendingLoginClub = { id: clubId, name: clubName };
  document.getElementById('clubLoginModalLabel').innerHTML =
    `<i class="fa-solid fa-lock me-2 text-primary"></i>Login – ${escHtml(clubName)}`;
  document.getElementById('club-modal-name').textContent =
    `Enter the password for ${clubName} to post events.`;
  document.getElementById('club-login-pw').value = '';
  hideAlert('club-login-msg');
  const modal = new bootstrap.Modal(document.getElementById('clubLoginModal'));
  modal.show();
}

document.getElementById('club-login-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const pw = document.getElementById('club-login-pw').value;
  hideAlert('club-login-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Logging in…';

  const { ok, data } = await apiFetch('/api/auth/club', {
    method: 'POST',
    body: JSON.stringify({ club_id: state.pendingLoginClub.id, password: pw }),
  });

  btn.disabled = false;
  btn.textContent = 'Login';

  if (!ok) {
    showAlert('club-login-msg', data.error || 'Login failed');
    return;
  }

  // Store session
  state.loggedInClub = { ...data.club, token: data.token };
  bootstrap.Modal.getInstance(document.getElementById('clubLoginModal')).hide();
  onClubLogin();
});

function onClubLogin() {
  const banner = document.getElementById('club-login-banner');
  document.getElementById('logged-club-name').textContent = state.loggedInClub.name;
  banner.classList.remove('d-none');
  document.getElementById('create-event-section').classList.remove('d-none');
}

document.getElementById('btn-club-logout').addEventListener('click', () => {
  state.loggedInClub = null;
  document.getElementById('club-login-banner').classList.add('d-none');
  document.getElementById('create-event-section').classList.add('d-none');
});

document.getElementById('btn-change-pw').addEventListener('click', () => {
  document.getElementById('cp-current').value = '';
  document.getElementById('cp-new').value = '';
  document.getElementById('cp-confirm').value = '';
  hideAlert('change-pw-msg');
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
  setTimeout(() => bootstrap.Modal.getInstance(document.getElementById('changePwModal')).hide(), 1500);
});

// Create event (club user)
document.getElementById('create-event-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('create-event-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Creating…';

  let poster_key = null;
  const posterFile = document.getElementById('ev-poster').files[0];
  if (posterFile) {
    const { ok, data } = await uploadFile(posterFile, 'poster');
    if (!ok) {
      showAlert('create-event-msg', data.error || 'Failed to upload poster');
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Event';
      return;
    }
    poster_key = data.key;
  }

  const payload = {
    title:          document.getElementById('ev-title').value.trim(),
    description:    document.getElementById('ev-desc').value.trim(),
    poster_key,
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
   SENATE PAGE
   ============================================================= */
function renderSenatePage() {
  if (state.adminToken) {
    document.getElementById('senate-login').classList.add('d-none');
    document.getElementById('senate-panel').classList.remove('d-none');
    loadAdminData();
  } else {
    document.getElementById('senate-login').classList.remove('d-none');
    document.getElementById('senate-panel').classList.add('d-none');
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
  document.getElementById('senate-login').classList.add('d-none');
  document.getElementById('senate-panel').classList.remove('d-none');
  loadAdminData();
});

document.getElementById('btn-admin-logout').addEventListener('click', () => {
  state.adminToken = null;
  document.getElementById('senate-panel').classList.add('d-none');
  document.getElementById('senate-login').classList.remove('d-none');
  document.getElementById('admin-pw').value = '';
});

async function loadAdminData() {
  // Load clubs for the dropdown + clubs list
  const { ok, data } = await apiFetch('/api/clubs');
  const clubs = ok ? (data.clubs || []) : [];

  // Populate club select
  const sel = document.getElementById('adm-ev-club');
  sel.innerHTML = `<option value="">– select club –</option>` +
    clubs.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');

  // Clubs list – use event delegation instead of inline onclick
  const clList = document.getElementById('admin-clubs-list');
  if (clubs.length) {
    clList.innerHTML = clubs.map(c => `
      <div class="event-list-item">
        <div class="ev-info">
          <div class="ev-title-txt">${escHtml(c.name)}</div>
          <div class="ev-meta-txt">ID: ${c.id} · Created: ${new Date(c.created_at).toLocaleDateString()}</div>
        </div>
        <button class="btn btn-sm btn-outline-danger" data-delete-club="${c.id}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>`).join('');

    clList.querySelectorAll('[data-delete-club]').forEach(btn => {
      btn.addEventListener('click', () => adminDeleteClub(parseInt(btn.dataset.deleteClub)));
    });
  } else {
    clList.innerHTML = '<p class="text-muted small">No clubs yet.</p>';
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
          <div class="ev-meta-txt">${escHtml(ev.club_name)} · ${new Date(ev.start_datetime).toLocaleString()}</div>
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

// Create club (admin)
document.getElementById('create-club-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('create-club-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>';

  let logo_key = null;
  const logoFile = document.getElementById('cl-logo').files[0];
  if (logoFile) {
    const { ok, data } = await uploadFile(logoFile, 'logo');
    if (!ok) {
      showAlert('create-club-msg', data.error || 'Logo upload failed');
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Club';
      return;
    }
    logo_key = data.key;
  }

  const { ok, data } = await apiFetch('/api/clubs', {
    method: 'POST',
    body: JSON.stringify({
      name:     document.getElementById('cl-name').value.trim(),
      logo_key,
      password: document.getElementById('cl-pw').value,
    }),
  });

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Club';

  if (!ok) { showAlert('create-club-msg', data.error || 'Failed to create club'); return; }
  showAlert('create-club-msg', 'Club created!', 'success');
  this.reset();
  loadAdminData();
});

// Create event (admin)
document.getElementById('admin-create-event-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('adm-create-event-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>';

  let poster_key = null;
  const posterFile = document.getElementById('adm-ev-poster').files[0];
  if (posterFile) {
    const { ok, data } = await uploadFile(posterFile, 'poster');
    if (!ok) {
      showAlert('adm-create-event-msg', data.error || 'Poster upload failed');
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Event';
      return;
    }
    poster_key = data.key;
  }

  const { ok, data } = await apiFetch('/api/events', {
    method: 'POST',
    body: JSON.stringify({
      club_id:        parseInt(document.getElementById('adm-ev-club').value),
      title:          document.getElementById('adm-ev-title').value.trim(),
      description:    document.getElementById('adm-ev-desc').value.trim(),
      poster_key,
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

// Delete club (no longer needs to be on window – called via event delegation)
async function adminDeleteClub(id) {
  if (!confirm('Delete this club and all its events?')) return;
  const { ok, data } = await apiFetch(`/api/clubs/${id}`, { method: 'DELETE' });
  if (!ok) { alert(data.error || 'Failed to delete club'); return; }
  loadAdminData();
}

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
