/**
 * Location double-booking check, shared by event create (POST /api/events) and
 * update (PUT /api/events/:id).
 */

/**
 * Looks for an existing event at the same location with an overlapping time range.
 * start_datetime/end_datetime are stored as naive "YYYY-MM-DDTHH:MM:SS" local-time strings
 * (no timezone), and compared as strings rather than parsed Dates — same convention the rest
 * of the API already uses (see GET /api/events), and it sidesteps any UTC-vs-local mismatch
 * between where this Worker executes and the timezone the times actually represent.
 * Returns the conflicting event, or null if the slot is free.
 */
export async function findLocationConflict(env, { location_id, start_datetime, end_datetime, excludeEventId }) {
  if (!location_id) return null; // no location assigned -> nothing to conflict with

  let query = `
    SELECT id, title, start_datetime, end_datetime
    FROM events
    WHERE location_id = ?
      AND start_datetime < ?
      AND end_datetime > ?
  `;
  const params = [location_id, end_datetime, start_datetime];

  if (excludeEventId) {
    query += ` AND id != ?`;
    params.push(excludeEventId);
  }
  query += ` LIMIT 1`;

  return env.DB.prepare(query).bind(...params).first();
}

/** "YYYY-MM-DDTHH:MM:SS" -> "H:MM AM/PM", via string parsing only (no Date/timezone conversion). */
export function formatNaiveTime(str) {
  const match = /T(\d{2}):(\d{2})/.exec(str || '');
  if (!match) return str;
  let hour = parseInt(match[1], 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${match[2]} ${ampm}`;
}

export function locationConflictMessage(conflict) {
  return `This location is already booked ${formatNaiveTime(conflict.start_datetime)}–${formatNaiveTime(conflict.end_datetime)} by "${conflict.title}"`;
}
