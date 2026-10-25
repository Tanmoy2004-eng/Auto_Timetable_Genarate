const db = require('../db/db');
const { slotTimes, iso } = require('./timeUtil');
const { DAY_ORDER, getSettings } = require('./context');

function getOwned(userId, id) {
  return db.prepare('SELECT * FROM timetables WHERE id=? AND user_id=?').get(id, userId);
}

// Flat, human-readable rows (joined with names) for one timetable.
function hydrateRows(userId, timetableId) {
  const settings = getSettings(userId);
  const slots = slotTimes(settings);
  const rows = db.prepare(`
    SELECT e.id, e.day, e.period, e.span, e.batch_id, e.subject_id, e.teacher_id, e.room_id,
           b.name AS batch, s.name AS subject, s.type AS type, t.name AS teacher, r.name AS room
    FROM timetable_entries e
    JOIN batches b ON b.id=e.batch_id JOIN subjects s ON s.id=e.subject_id
    JOIN teachers t ON t.id=e.teacher_id JOIN rooms r ON r.id=e.room_id
    WHERE e.timetable_id=?`).all(timetableId);
  return rows
    .map((r) => {
      const first = slots[r.period - 1];
      const last = slots[r.period + r.span - 2];
      return {
        ...r,
        period_label: r.span > 1 ? `P${r.period}-P${r.period + r.span - 1}` : `P${r.period}`,
        start: first ? first.start : '',
        end: last ? last.end : '',
      };
    })
    .sort((a, b) =>
      DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) ||
      a.batch.localeCompare(b.batch) || a.period - b.period);
}

function fullTimetable(userId, id) {
  const tt = getOwned(userId, id);
  if (!tt) return null;
  const settings = getSettings(userId);
  return {
    id: tt.id, name: tt.name, score: tt.score,
    generated_at: iso(tt.generated_at),
    meta: JSON.parse(tt.meta || '{}'),
    settings, slots: slotTimes(settings),
    timetable: hydrateRows(userId, tt.id),
  };
}

module.exports = { getOwned, hydrateRows, fullTimetable };
