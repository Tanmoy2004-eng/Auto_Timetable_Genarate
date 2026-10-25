// Batch subject assignments + settings + stats.
const express = require('express');
const db = require('../db/db');
const { HttpError } = require('../middleware/errors');
const { DAY_ORDER, getSettings } = require('../services/context');
const { iso } = require('../services/timeUtil');

const router = express.Router();

function ownBatch(req) {
  const b = db.prepare('SELECT id,name FROM batches WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!b) throw new HttpError(404, 'Batch not found');
  return b;
}

router.get('/batches/:id/subjects', (req, res) => {
  const b = ownBatch(req);
  res.json(db.prepare(`
    SELECT bs.subject_id, bs.teacher_id, s.name AS subject_name, s.type AS subject_type,
           s.periods_per_week, t.name AS teacher_name
    FROM batch_subjects bs
    JOIN subjects s ON s.id = bs.subject_id
    JOIN teachers t ON t.id = bs.teacher_id
    WHERE bs.batch_id = ? AND bs.user_id = ? ORDER BY s.name`).all(b.id, req.userId));
});

router.put('/batches/:id/subjects', (req, res) => {
  const b = ownBatch(req);
  const list = req.body && req.body.assignments;
  if (!Array.isArray(list)) throw new HttpError(400, 'assignments must be an array');
  const seen = new Set();
  const rows = list.map((a) => {
    const subject = db.prepare('SELECT * FROM subjects WHERE id=? AND user_id=?').get(a.subject_id, req.userId);
    const teacher = db.prepare('SELECT * FROM teachers WHERE id=? AND user_id=?').get(a.teacher_id, req.userId);
    if (!subject) throw new HttpError(400, 'Unknown subject in assignments');
    if (!teacher) throw new HttpError(400, `Please choose a teacher for ${subject.name}`);
    if (seen.has(subject.id)) throw new HttpError(400, `${subject.name} is listed twice`);
    seen.add(subject.id);
    if (teacher.type !== 'both' && teacher.type !== subject.type) {
      throw new HttpError(400, `${teacher.name} is a ${teacher.type} teacher and cannot teach ${subject.name} (${subject.type})`);
    }
    return { subject_id: subject.id, teacher_id: teacher.id };
  });
  db.transaction(() => {
    db.prepare('DELETE FROM batch_subjects WHERE batch_id=? AND user_id=?').run(b.id, req.userId);
    const ins = db.prepare('INSERT INTO batch_subjects (user_id,batch_id,subject_id,teacher_id) VALUES (?,?,?,?)');
    rows.forEach((r) => ins.run(req.userId, b.id, r.subject_id, r.teacher_id));
  })();
  res.json({ saved: rows.length });
});

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
router.get('/settings', (req, res) => res.json(getSettings(req.userId)));

router.put('/settings', (req, res) => {
  const cur = getSettings(req.userId);
  const b = { ...cur, ...(req.body || {}) };
  const num = (v, label, min, max) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be between ${min} and ${max}`);
    return n;
  };
  if (!Array.isArray(b.days) || !b.days.length || b.days.some((d) => !DAY_ORDER.includes(d))) {
    throw new HttpError(400, 'Choose at least one working day');
  }
  const periods = num(b.periods_per_day, 'Periods per day', 1, 12);
  const next = {
    days: JSON.stringify([...new Set(b.days)]),
    periods_per_day: periods,
    start_time: TIME_RE.test(b.start_time) ? b.start_time : (() => { throw new HttpError(400, 'Start time must be HH:MM'); })(),
    period_minutes: num(b.period_minutes, 'Period length', 20, 180),
    lunch_after: num(b.lunch_after, 'Lunch after period', 0, Math.max(0, periods - 1)),
    lunch_minutes: num(b.lunch_minutes, 'Lunch length', 0, 120),
    lab_block: num(b.lab_block, 'Lab block length', 1, 4),
  };
  if (next.lab_block > periods) throw new HttpError(400, 'Lab block is longer than the school day');
  db.prepare(`UPDATE settings SET days=@days, periods_per_day=@periods_per_day, start_time=@start_time,
    period_minutes=@period_minutes, lunch_after=@lunch_after, lunch_minutes=@lunch_minutes, lab_block=@lab_block
    WHERE user_id=@uid`).run({ ...next, uid: req.userId });
  res.json(getSettings(req.userId));
});

router.get('/stats', (req, res) => {
  const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id=?`).get(req.userId).n;
  const last = db.prepare('SELECT id,name,generated_at,score FROM timetables WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.userId);
  res.json({
    teacherCount: count('teachers'), roomCount: count('rooms'),
    batchCount: count('batches'), subjectCount: count('subjects'),
    timetableCount: count('timetables'),
    lastGenerated: last ? iso(last.generated_at) : null,
    lastTimetable: last ? { ...last, generated_at: iso(last.generated_at) } : null,
  });
});

module.exports = router;
