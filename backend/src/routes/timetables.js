const express = require('express');
const db = require('../db/db');
const { HttpError, asyncHandler } = require('../middleware/errors');
const { loadContext, DAY_ORDER } = require('../services/context');
const { generate, verify, checkMove } = require('../services/timetableGenerator');
const { getOwned, hydrateRows, fullTimetable } = require('../services/timetableData');
const { toXlsx, toPdf } = require('../services/exportService');
const { iso } = require('../services/timeUtil');

const router = express.Router();

router.post('/generate', (req, res) => {
  const ctx = loadContext(req.userId);
  if (!ctx.batches.length) throw new HttpError(422, 'Add at least one batch before generating');
  if (!ctx.rooms.length) throw new HttpError(422, 'Add at least one room before generating');
  if (!ctx.teachers.length) throw new HttpError(422, 'Add at least one teacher before generating');

  const missing = ctx.batches.filter((b) => !ctx.assignments.some((a) => a.batch_id === b.id));
  if (missing.length) {
    throw new HttpError(422, `${missing.map((b) => b.name).join(', ')} ${missing.length > 1 ? 'have' : 'has'} no subjects assigned. Use "Assign Subjects" first.`);
  }

  // Teachers may have been edited after assignment: surface type mismatches clearly.
  const subj = new Map(ctx.subjects.map((s) => [s.id, s]));
  const tch = new Map(ctx.teachers.map((t) => [t.id, t]));
  for (const a of ctx.assignments) {
    const s = subj.get(a.subject_id), t = tch.get(a.teacher_id);
    if (t.type !== 'both' && t.type !== s.type) {
      throw new HttpError(422, `${t.name} is a ${t.type} teacher but is assigned to ${s.name} (${s.type}). Fix the assignment.`);
    }
  }

  const result = generate(ctx, { timeLimitMs: 3000 });
  const issues = verify(result.entries, ctx);
  if (issues.length) throw new HttpError(500, 'Generator produced an invalid timetable; please retry');
  if (!result.entries.length) {
    throw new HttpError(422, 'Nothing could be scheduled', { unplaced: describeUnplaced(result.unplaced, ctx), warnings: result.warnings });
  }

  const name = (req.body && String(req.body.name || '').trim().slice(0, 80)) ||
    `Timetable ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const unplaced = describeUnplaced(result.unplaced, ctx);

  const id = db.transaction(() => {
    const info = db.prepare('INSERT INTO timetables (user_id,name,score,meta) VALUES (?,?,?,?)').run(
      req.userId, name, result.score,
      JSON.stringify({ attempts: result.attempts, totalSessions: result.totalSessions, unplaced, warnings: result.warnings }));
    const ins = db.prepare(`INSERT INTO timetable_entries
      (timetable_id,day,period,span,batch_id,subject_id,teacher_id,room_id) VALUES (?,?,?,?,?,?,?,?)`);
    result.entries.forEach((e) => ins.run(info.lastInsertRowid, e.day, e.period, e.span, e.batch_id, e.subject_id, e.teacher_id, e.room_id));
    return Number(info.lastInsertRowid);
  })();

  res.status(201).json({ ...fullTimetable(req.userId, id), unplaced, warnings: result.warnings });
});

function describeUnplaced(list, ctx) {
  const b = new Map(ctx.batches.map((x) => [x.id, x.name]));
  const s = new Map(ctx.subjects.map((x) => [x.id, x.name]));
  const t = new Map(ctx.teachers.map((x) => [x.id, x.name]));
  return list.map((u) => ({
    batch: b.get(u.batch_id), subject: s.get(u.subject_id), teacher: t.get(u.teacher_id),
    periods: u.span, reason: u.reason,
  }));
}

router.get('/timetables', (req, res) => {
  const rows = db.prepare(`
    SELECT t.id, t.name, t.score, t.generated_at,
           (SELECT COUNT(*) FROM timetable_entries e WHERE e.timetable_id = t.id) AS entries
    FROM timetables t WHERE t.user_id=? ORDER BY t.id DESC`).all(req.userId);
  res.json(rows.map((r) => ({ ...r, generated_at: iso(r.generated_at) })));
});

router.get('/timetables/:id', (req, res) => {
  const tt = fullTimetable(req.userId, req.params.id);
  if (!tt) throw new HttpError(404, 'Timetable not found');
  res.json(tt);
});

router.delete('/timetables/:id', (req, res) => {
  if (!getOwned(req.userId, req.params.id)) throw new HttpError(404, 'Timetable not found');
  db.prepare('DELETE FROM timetables WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ deleted: true });
});

function ownEntry(req) {
  const tt = getOwned(req.userId, req.params.id);
  if (!tt) throw new HttpError(404, 'Timetable not found');
  const entry = db.prepare('SELECT * FROM timetable_entries WHERE id=? AND timetable_id=?').get(req.params.entryId, tt.id);
  if (!entry) throw new HttpError(404, 'Entry not found');
  return { tt, entry };
}

// Manual edit: move an entry to another day / period / room, with full clash checking.
router.put('/timetables/:id/entries/:entryId', (req, res) => {
  const { tt, entry } = ownEntry(req);
  const day = String(req.body.day || entry.day);
  const period = Number(req.body.period ?? entry.period);
  const roomId = Number(req.body.room_id ?? entry.room_id);
  if (!DAY_ORDER.includes(day) || !Number.isInteger(period) || period < 1) throw new HttpError(400, 'Invalid day or period');
  const room = db.prepare('SELECT id FROM rooms WHERE id=? AND user_id=?').get(roomId, req.userId);
  if (!room) throw new HttpError(400, 'Unknown room');

  const ctx = loadContext(req.userId);
  const others = db.prepare('SELECT * FROM timetable_entries WHERE timetable_id=? AND id<>?').all(tt.id, entry.id);
  const err = checkMove({ others, entry, day, period, roomId, input: ctx });
  if (err) throw new HttpError(409, `Cannot move there: ${err}`);
  db.prepare('UPDATE timetable_entries SET day=?, period=?, room_id=? WHERE id=?').run(day, period, roomId, entry.id);
  res.json({ updated: true });
});

router.delete('/timetables/:id/entries/:entryId', (req, res) => {
  const { entry } = ownEntry(req);
  db.prepare('DELETE FROM timetable_entries WHERE id=?').run(entry.id);
  res.json({ deleted: true });
});

router.get('/timetables/:id/export', asyncHandler(async (req, res) => {
  const tt = fullTimetable(req.userId, req.params.id);
  if (!tt) throw new HttpError(404, 'Timetable not found');
  const format = String(req.query.format || 'pdf').toLowerCase();
  const safe = tt.name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'timetable';
  if (format === 'xlsx') {
    const buf = await toXlsx(tt);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${safe}.xlsx"` });
    return res.send(Buffer.from(buf));
  }
  if (format === 'pdf') {
    const buf = await toPdf(tt);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${safe}.pdf"` });
    return res.send(buf);
  }
  throw new HttpError(400, 'format must be pdf or xlsx');
}));

module.exports = router;
