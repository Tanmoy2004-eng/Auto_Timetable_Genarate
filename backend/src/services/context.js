const db = require('../db/db');

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getSettings(userId) {
  let s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
  if (!s) {
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(userId);
    s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
  }
  const days = JSON.parse(s.days).sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return { ...s, days };
}

// Everything the generator / verifier needs for one user.
function loadContext(userId) {
  const q = (sql) => db.prepare(sql).all(userId);
  return {
    settings: getSettings(userId),
    batches: q('SELECT id,name,strength FROM batches WHERE user_id=? ORDER BY name'),
    rooms: q('SELECT id,name,capacity,type FROM rooms WHERE user_id=? ORDER BY name'),
    teachers: q('SELECT id,name,type,max_periods_per_day FROM teachers WHERE user_id=? ORDER BY name'),
    subjects: q('SELECT id,name,type,periods_per_week FROM subjects WHERE user_id=? ORDER BY name'),
    assignments: q('SELECT batch_id,subject_id,teacher_id FROM batch_subjects WHERE user_id=?'),
  };
}

module.exports = { DAY_ORDER, getSettings, loadContext };
