const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

// isolated throw-away database
process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tt-')), 'test.db');
process.env.JWT_SECRET = 'test-secret';
const app = require('../src/server');

let server, base;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function call(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

let A, B; // tokens for two separate users
const ctx = {};

test('signup validation and success', async () => {
  assert.equal((await call('POST', '/api/signup', { name: '', email: 'x', password: '1' })).status, 400);
  assert.equal((await call('POST', '/api/signup', { name: 'Al', email: 'al@x.com', password: 'short' })).status, 400);
  const a = await call('POST', '/api/signup', { name: 'Alice', email: 'alice@x.com', password: 'Password1' });
  assert.equal(a.status, 201);
  assert.ok(a.body.token && a.body.user.id && !a.body.user.password_hash);
  A = a.body.token;
  assert.equal((await call('POST', '/api/signup', { name: 'Alice', email: 'ALICE@x.com', password: 'Password1' })).status, 409);
  B = (await call('POST', '/api/signup', { name: 'Bob', email: 'bob@x.com', password: 'Password1' })).body.token;
});

test('login success and failure', async () => {
  assert.equal((await call('POST', '/api/login', { email: 'alice@x.com', password: 'Password1' })).status, 200);
  assert.equal((await call('POST', '/api/login', { email: 'alice@x.com', password: 'wrong' })).status, 401);
});

test('protected routes need a token', async () => {
  assert.equal((await call('GET', '/api/teachers')).status, 401);
  assert.equal((await call('GET', '/api/teachers', null, 'garbage')).status, 401);
});

test('CRUD + validation + duplicate handling', async () => {
  const t = await call('POST', '/api/teachers', { name: ' Dr. X ', type: 'theory' }, A);
  assert.equal(t.status, 201);
  assert.equal(t.body.name, 'Dr. X');
  assert.equal(t.body.max_periods_per_day, 5);
  assert.equal((await call('POST', '/api/teachers', { name: 'Dr. X', type: 'theory' }, A)).status, 409);
  assert.equal((await call('POST', '/api/teachers', { name: 'Y', type: 'alien' }, A)).status, 400);
  assert.equal((await call('POST', '/api/rooms', { name: 'R', capacity: -4 }, A)).status, 400);
  const up = await call('PUT', `/api/teachers/${t.body.id}`, { max_periods_per_day: 4 }, A);
  assert.equal(up.body.max_periods_per_day, 4);
  assert.equal(up.body.name, 'Dr. X');
  assert.equal((await call('DELETE', `/api/teachers/${t.body.id}`, null, A)).status, 200);
  assert.equal((await call('GET', '/api/teachers', null, A)).body.length, 0);
});

test('users cannot see or touch each other\'s data', async () => {
  const r = await call('POST', '/api/rooms', { name: 'Private', capacity: 30 }, A);
  assert.equal((await call('GET', '/api/rooms', null, B)).body.length, 0);
  assert.equal((await call('PUT', `/api/rooms/${r.body.id}`, { name: 'Hacked' }, B)).status, 404);
  assert.equal((await call('DELETE', `/api/rooms/${r.body.id}`, null, B)).status, 404);
  await call('DELETE', `/api/rooms/${r.body.id}`, null, A);
});

test('generate refuses incomplete data with a clear message', async () => {
  assert.equal((await call('POST', '/api/generate', {}, A)).status, 422);
  const b = await call('POST', '/api/batches', { name: 'CSE-A', strength: 40 }, A);
  await call('POST', '/api/rooms', { name: 'R1', capacity: 60, type: 'classroom' }, A);
  await call('POST', '/api/teachers', { name: 'T1', type: 'both' }, A);
  const g = await call('POST', '/api/generate', {}, A);
  assert.equal(g.status, 422);
  assert.match(g.body.error, /CSE-A has no subjects/);
  ctx.batch = b.body.id;
});

test('full flow: assign, generate, view, edit with clash check, export, delete', async () => {
  const th = (await call('POST', '/api/subjects', { name: 'Maths', type: 'theory', periods_per_week: 4 }, A)).body;
  const lab = (await call('POST', '/api/subjects', { name: 'Maths Lab', type: 'lab', periods_per_week: 2 }, A)).body;
  await call('POST', '/api/rooms', { name: 'L1', capacity: 60, type: 'lab' }, A);
  const teacher = (await call('GET', '/api/teachers', null, A)).body[0];

  const bad = await call('PUT', `/api/batches/${ctx.batch}/subjects`, { assignments: [{ subject_id: th.id }] }, A);
  assert.equal(bad.status, 400);
  const ok = await call('PUT', `/api/batches/${ctx.batch}/subjects`, {
    assignments: [{ subject_id: th.id, teacher_id: teacher.id }, { subject_id: lab.id, teacher_id: teacher.id }],
  }, A);
  assert.equal(ok.status, 200);
  const list = await call('GET', `/api/batches/${ctx.batch}/subjects`, null, A);
  assert.equal(list.body.length, 2);

  const g = await call('POST', '/api/generate', { name: 'Test run' }, A);
  assert.equal(g.status, 201);
  assert.equal(g.body.unplaced.length, 0);
  assert.equal(g.body.timetable.length, 5); // 4 theory + 1 lab block
  const row = g.body.timetable[0];
  for (const k of ['day', 'batch', 'room', 'teacher', 'subject', 'period_label', 'start']) assert.ok(row[k] !== undefined, k);
  ctx.tt = g.body.id;

  const stats = (await call('GET', '/api/stats', null, A)).body;
  assert.equal(stats.batchCount, 1);
  assert.ok(stats.lastGenerated);

  assert.equal((await call('GET', `/api/timetables/${ctx.tt}`, null, B)).status, 404);
  assert.equal((await call('GET', '/api/timetables', null, A)).body.length, 1);

  // moving a theory entry onto another entry's slot (same batch) must be rejected
  const theory = g.body.timetable.filter((r) => r.span === 1);
  const [e1, e2] = theory;
  const clash = await call('PUT', `/api/timetables/${ctx.tt}/entries/${e1.id}`, { day: e2.day, period: e2.period }, A);
  assert.equal(clash.status, 409);
  // moving to a free slot works
  const taken = new Set(g.body.timetable.flatMap((r) => Array.from({ length: r.span }, (_, i) => `${r.day}|${r.period + i}`)));
  let free;
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) for (let p = 1; p <= 7 && !free; p++) if (!taken.has(`${d}|${p}`)) free = { d, p };
  const mv = await call('PUT', `/api/timetables/${ctx.tt}/entries/${e1.id}`, { day: free.d, period: free.p }, A);
  assert.equal(mv.status, 200, JSON.stringify(mv.body));

  const pdf = await call('GET', `/api/timetables/${ctx.tt}/export?format=pdf`, null, A);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  const xlsx = await call('GET', `/api/timetables/${ctx.tt}/export?format=xlsx`, null, A);
  assert.equal(xlsx.body.subarray(0, 2).toString(), 'PK');
  assert.equal((await call('GET', `/api/timetables/${ctx.tt}/export?format=doc`, null, A)).status, 400);

  // deleting a used subject needs force
  const del = await call('DELETE', `/api/subjects/${th.id}`, null, A);
  assert.equal(del.status, 409);
  assert.equal(del.body.inUse, true);
  assert.equal((await call('DELETE', `/api/subjects/${th.id}?force=true`, null, A)).status, 200);

  assert.equal((await call('DELETE', `/api/timetables/${ctx.tt}`, null, A)).status, 200);
});

test('settings validation', async () => {
  assert.equal((await call('PUT', '/api/settings', { periods_per_day: 99 }, A)).status, 400);
  assert.equal((await call('PUT', '/api/settings', { days: [] }, A)).status, 400);
  const s = await call('PUT', '/api/settings', { periods_per_day: 8, lunch_after: 4, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] }, A);
  assert.equal(s.status, 200);
  assert.equal(s.body.days.length, 6);
});

test('static frontend and unknown api route', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/nope', null, A)).status, 404);
});
