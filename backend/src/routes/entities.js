// Generic, validated CRUD for teachers, rooms, batches and subjects.
const express = require('express');
const db = require('../db/db');
const { HttpError } = require('../middleware/errors');

const str = (label, max = 80) => ({
  kind: 'string', label,
  parse(v) {
    const s = String(v ?? '').trim();
    if (!s) throw new HttpError(400, `${label} is required`);
    if (s.length > max) throw new HttpError(400, `${label} is too long`);
    return s;
  },
});
const int = (label, min, max, def) => ({
  kind: 'int', label, def,
  parse(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new HttpError(400, `${label} must be a whole number between ${min} and ${max}`);
    }
    return n;
  },
});
const oneOf = (label, values, def) => ({
  kind: 'enum', label, def,
  parse(v) {
    if (!values.includes(v)) throw new HttpError(400, `${label} must be one of: ${values.join(', ')}`);
    return v;
  },
});

const ENTITIES = {
  teachers: {
    table: 'teachers', singular: 'Teacher',
    fields: { name: str('Name'), type: oneOf('Type', ['theory', 'lab', 'both'], 'theory'), max_periods_per_day: int('Max periods per day', 1, 10, 5) },
    usage: 'teacher_id',
  },
  rooms: {
    table: 'rooms', singular: 'Room',
    fields: { name: str('Name'), capacity: int('Capacity', 1, 1000), type: oneOf('Type', ['classroom', 'lab'], 'classroom') },
    usage: 'room_id',
  },
  batches: {
    table: 'batches', singular: 'Batch',
    fields: { name: str('Name'), strength: int('Strength', 1, 500, 30) },
    usage: 'batch_id',
  },
  subjects: {
    table: 'subjects', singular: 'Subject',
    fields: { name: str('Name'), type: oneOf('Type', ['theory', 'lab'], 'theory'), periods_per_week: int('Periods per week', 1, 20, 3) },
    usage: 'subject_id',
  },
};

function clean(def, body, existing) {
  const out = {};
  for (const [key, f] of Object.entries(def.fields)) {
    let v = body[key];
    if (v === undefined || v === null || v === '') {
      if (existing) v = existing[key];
      else if (f.def !== undefined) v = f.def;
    }
    out[key] = f.parse(v);
  }
  return out;
}

function build(name) {
  const def = ENTITIES[name];
  const router = express.Router();
  const cols = ['id', ...Object.keys(def.fields)].join(',');
  const get = (id, uid) => db.prepare(`SELECT ${cols} FROM ${def.table} WHERE id=? AND user_id=?`).get(id, uid);

  router.get(`/${name}`, (req, res) => {
    res.json(db.prepare(`SELECT ${cols} FROM ${def.table} WHERE user_id=? ORDER BY name COLLATE NOCASE`).all(req.userId));
  });

  router.post(`/${name}`, (req, res) => {
    const data = clean(def, req.body || {});
    const keys = Object.keys(data);
    try {
      const info = db.prepare(
        `INSERT INTO ${def.table} (user_id,${keys.join(',')}) VALUES (?,${keys.map(() => '?').join(',')})`,
      ).run(req.userId, ...keys.map((k) => data[k]));
      res.status(201).json(get(info.lastInsertRowid, req.userId));
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new HttpError(409, `${def.singular} "${data.name}" already exists`);
      throw e;
    }
  });

  router.put(`/${name}/:id`, (req, res) => {
    const existing = get(req.params.id, req.userId);
    if (!existing) throw new HttpError(404, `${def.singular} not found`);
    const data = clean(def, req.body || {}, existing);
    const keys = Object.keys(data);
    try {
      db.prepare(`UPDATE ${def.table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=? AND user_id=?`)
        .run(...keys.map((k) => data[k]), existing.id, req.userId);
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new HttpError(409, `${def.singular} "${data.name}" already exists`);
      throw e;
    }
    res.json(get(existing.id, req.userId));
  });

  router.delete(`/${name}/:id`, (req, res) => {
    const existing = get(req.params.id, req.userId);
    if (!existing) throw new HttpError(404, `${def.singular} not found`);
    const used = db.prepare(`SELECT COUNT(*) n FROM timetable_entries WHERE ${def.usage}=?`).get(existing.id).n;
    if (used > 0 && req.query.force !== 'true') {
      throw new HttpError(409, `${def.singular} "${existing.name}" is used in ${used} saved timetable entries. Deleting will remove those entries.`, { inUse: true, used });
    }
    db.prepare(`DELETE FROM ${def.table} WHERE id=? AND user_id=?`).run(existing.id, req.userId);
    res.json({ deleted: true });
  });
  return router;
}

module.exports = Object.keys(ENTITIES).map(build);
