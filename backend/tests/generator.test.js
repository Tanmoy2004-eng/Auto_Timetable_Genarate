const test = require('node:test');
const assert = require('node:assert/strict');
const { generate, verify, blockFits, checkMove } = require('../src/services/timetableGenerator');
const { slotTimes } = require('../src/services/timeUtil');

const settings = {
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], periods_per_day: 7, lunch_after: 4,
  lab_block: 2, start_time: '09:00', period_minutes: 50, lunch_minutes: 40,
};

function build(nBatches, nTeachers, nTheory, nLab, strength = 40) {
  const batches = Array.from({ length: nBatches }, (_, i) => ({ id: i + 1, name: `B${i + 1}`, strength }));
  const teachers = Array.from({ length: nTeachers }, (_, i) => ({ id: i + 1, name: `T${i + 1}`, max_periods_per_day: 5 }));
  const rooms = [
    ...Array.from({ length: Math.max(2, nBatches) }, (_, i) => ({ id: 100 + i, name: `R${i}`, capacity: 60, type: 'classroom' })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: 200 + i, name: `L${i}`, capacity: 45, type: 'lab' })),
  ];
  const subjects = [];
  for (let i = 0; i < nTheory; i++) subjects.push({ id: i + 1, name: `S${i + 1}`, type: 'theory', periods_per_week: 3 });
  for (let i = 0; i < nLab; i++) subjects.push({ id: 50 + i, name: `Lab${i + 1}`, type: 'lab', periods_per_week: 2 });
  const assignments = [];
  let k = 0;
  for (const b of batches) for (const s of subjects) assignments.push({ batch_id: b.id, subject_id: s.id, teacher_id: teachers[k++ % teachers.length].id });
  return { settings, batches, teachers, rooms, subjects, assignments };
}

test('no teacher, room or batch clashes (and verifier agrees)', () => {
  const input = build(3, 8, 5, 2);
  const r = generate(input, { seed: 1, timeLimitMs: 1500 });
  assert.equal(r.unplaced.length, 0, JSON.stringify(r.unplaced));
  assert.deepEqual(verify(r.entries, input), []);
});

test('every subject gets exactly its periods per week', () => {
  const input = build(2, 6, 4, 1);
  const r = generate(input, { seed: 2, timeLimitMs: 1500 });
  for (const b of input.batches) for (const s of input.subjects) {
    const got = r.entries.filter((e) => e.batch_id === b.id && e.subject_id === s.id).reduce((n, e) => n + e.span, 0);
    assert.equal(got, s.periods_per_week, `${b.name}/${s.name}`);
  }
});

test('room capacity respected', () => {
  const input = build(2, 6, 3, 1, 50);
  const r = generate(input, { seed: 3, timeLimitMs: 1000 });
  const cap = new Map(input.rooms.map((x) => [x.id, x.capacity]));
  for (const e of r.entries) assert.ok(cap.get(e.room_id) >= 50);
  // labs only have capacity 45, so every lab session must be reported unplaced
  assert.ok(r.unplaced.some((u) => u.type === 'lab' && /capacity/.test(u.reason)));
});

test('labs are consecutive blocks in lab rooms and never straddle lunch', () => {
  const input = build(2, 6, 3, 2);
  const r = generate(input, { seed: 4, timeLimitMs: 1500 });
  const labIds = new Set(input.rooms.filter((x) => x.type === 'lab').map((x) => x.id));
  const labSubj = new Set(input.subjects.filter((s) => s.type === 'lab').map((s) => s.id));
  const labs = r.entries.filter((e) => labSubj.has(e.subject_id));
  assert.ok(labs.length > 0);
  for (const e of labs) {
    assert.equal(e.span, 2);
    assert.ok(labIds.has(e.room_id));
    assert.ok(blockFits(e.period, e.span, 7, 4));
  }
});

test('teacher daily limit respected', () => {
  const input = build(3, 3, 4, 1);
  input.teachers.forEach((t) => { t.max_periods_per_day = 3; });
  const r = generate(input, { seed: 5, timeLimitMs: 1000 });
  assert.deepEqual(verify(r.entries, input), []);
});

test('impossible input is reported, not thrown', () => {
  const input = build(1, 1, 8, 0); // 24 periods/week for one teacher with max 5/day over 5 days = 25 -> feasible
  input.subjects.forEach((s) => { s.periods_per_week = 6; }); // 48 periods > 25
  const r = generate(input, { seed: 6, timeLimitMs: 800 });
  assert.ok(r.unplaced.length > 0);
  assert.ok(r.warnings.length > 0);
  assert.deepEqual(verify(r.entries, input), []);
});

test('empty input returns empty result', () => {
  const r = generate({ ...build(1, 1, 0, 0), assignments: [] }, { seed: 7 });
  assert.equal(r.entries.length, 0);
});

test('checkMove rejects a clash and accepts a free slot', () => {
  const input = build(2, 6, 3, 1);
  const r = generate(input, { seed: 8, timeLimitMs: 1000 });
  const entries = r.entries.map((e, i) => ({ ...e, id: i + 1 }));
  const e = entries.find((x) => x.span === 1);
  const others = entries.filter((x) => x.id !== e.id);
  // moving onto the same slot as another entry of the same batch must fail
  const clash = others.find((x) => x.batch_id === e.batch_id);
  assert.ok(checkMove({ others, entry: e, day: clash.day, period: clash.period, roomId: e.room_id, input }));
  // moving to where it already is must pass
  assert.equal(checkMove({ others, entry: e, day: e.day, period: e.period, roomId: e.room_id, input }), null);
});

test('large input: 10 batches, 15 teachers is clash-free and fast', () => {
  const input = build(10, 15, 5, 2, 40);
  const t0 = Date.now();
  const r = generate(input, { seed: 9, timeLimitMs: 4000 });
  assert.ok(Date.now() - t0 < 6000);
  assert.deepEqual(verify(r.entries, input), []);
});

test('slotTimes pushes later periods after lunch', () => {
  const t = slotTimes(settings);
  assert.equal(t[0].start, '09:00');
  assert.equal(t[3].end, '12:20');
  assert.equal(t[4].start, '13:00');
});
