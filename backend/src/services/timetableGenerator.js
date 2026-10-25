/**
 * Timetable generator (pure, no DB access).
 *
 * Method: randomized-restart greedy construction with heuristic ordering.
 *  - Labs are placed first (they are the hardest to fit), then theory sessions in random order.
 *  - For each session every valid (day, start period, room) option is scored with soft
 *    constraints and the cheapest one is taken.
 *  - The whole construction is repeated many times (or until a time limit) and the best
 *    result (fewest unplaced sessions, then lowest penalty) is returned.
 *
 * HARD constraints (never violated):
 *   teacher / room / batch clash-free, room capacity, lab -> lab room, theory -> classroom,
 *   lab block does not straddle lunch, teacher max periods per day.
 * SOFT constraints (optimised): spread subjects over days, avoid gaps, balance teacher load,
 *   vary the period of a subject across days, labs in the afternoon, compact days.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Does a block [start, start+span-1] fit inside the day without crossing lunch?
function blockFits(start, span, periods, lunchAfter) {
  const end = start + span - 1;
  if (start < 1 || end > periods) return false;
  if (lunchAfter > 0 && lunchAfter < periods && span > 1) {
    if (start <= lunchAfter && end > lunchAfter) return false;
  }
  return true;
}

function buildSessions(input) {
  const subj = new Map(input.subjects.map((s) => [s.id, s]));
  const sessions = [];
  const { lab_block: block } = input.settings;
  for (const a of input.assignments) {
    const s = subj.get(a.subject_id);
    if (!s) continue;
    const count = s.type === 'lab'
      ? Math.max(1, Math.round(s.periods_per_week / block))
      : s.periods_per_week;
    const span = s.type === 'lab' ? block : 1;
    for (let i = 0; i < count; i++) {
      sessions.push({
        batch_id: a.batch_id, subject_id: a.subject_id, teacher_id: a.teacher_id,
        type: s.type, span,
      });
    }
  }
  return sessions;
}

function generate(input, options = {}) {
  const settings = input.settings;
  const days = settings.days;
  const P = settings.periods_per_day;
  const L = settings.lunch_after;
  const rnd = mulberry32(options.seed ?? Date.now());
  const timeLimit = options.timeLimitMs ?? 3000;
  const maxAttempts = options.maxAttempts ?? 300;

  const batchById = new Map(input.batches.map((b) => [b.id, b]));
  const teacherById = new Map(input.teachers.map((t) => [t.id, t]));
  const roomsByType = {
    classroom: input.rooms.filter((r) => r.type === 'classroom'),
    lab: input.rooms.filter((r) => r.type === 'lab'),
  };

  const sessions = buildSessions(input);
  const warnings = [];

  // --- Up-front feasibility checks that produce clear messages ---
  const impossible = new Map(); // session -> reason
  for (const s of sessions) {
    const batch = batchById.get(s.batch_id);
    const kind = s.type === 'lab' ? 'lab' : 'classroom';
    if (!roomsByType[kind].some((r) => r.capacity >= batch.strength)) {
      impossible.set(s, `No ${kind} room has capacity for ${batch.strength} students (${batch.name})`);
    } else if (s.span > 1 && !(s.span <= L || s.span <= P - L)) {
      impossible.set(s, `A ${s.span}-period lab block cannot fit before or after lunch`);
    }
  }
  // teacher capacity warnings
  const demand = new Map();
  for (const s of sessions) demand.set(s.teacher_id, (demand.get(s.teacher_id) || 0) + s.span);
  for (const [tid, d] of demand) {
    const t = teacherById.get(tid);
    const cap = Math.min(t.max_periods_per_day, P) * days.length;
    if (d > cap) warnings.push(`${t.name} is assigned ${d} periods/week but can only teach ${cap}`);
  }
  const perBatch = new Map();
  for (const s of sessions) perBatch.set(s.batch_id, (perBatch.get(s.batch_id) || 0) + s.span);
  for (const [bid, d] of perBatch) {
    if (d > P * days.length) warnings.push(`${batchById.get(bid).name} needs ${d} periods/week but only ${P * days.length} exist`);
  }

  const workable = sessions.filter((s) => !impossible.has(s));

  function attempt() {
    const batchBusy = new Set();
    const teacherBusy = new Set();
    const roomBusy = new Set();
    const teacherDay = new Map(); // `${t}|${day}` -> periods
    const batchDayPeriods = new Map(); // `${b}|${day}` -> sorted array of periods
    const batchDayLoad = new Map();
    const subjectDay = new Set(); // `${b}|${subj}|${day}`
    const subjectPeriodCount = new Map(); // `${b}|${subj}|${p}`
    const homeRoom = new Map(); // batch -> room id for theory
    const entries = [];
    const unplaced = [];
    let cost = 0;

    const order = shuffle(workable.slice(), rnd).sort((a, b) => (b.span > 1) - (a.span > 1));

    const gapsOf = (periods) => {
      if (periods.length < 2) return 0;
      return periods[periods.length - 1] - periods[0] + 1 - periods.length;
    };

    for (const s of order) {
      const batch = batchById.get(s.batch_id);
      const teacher = teacherById.get(s.teacher_id);
      const kind = s.type === 'lab' ? 'lab' : 'classroom';
      let best = null;
      const fails = { teacherDay: 0, teacher: 0, batch: 0, room: 0, lunch: 0 };

      for (const day of days) {
        const tLoad = teacherDay.get(`${s.teacher_id}|${day}`) || 0;
        for (let start = 1; start <= P - s.span + 1; start++) {
          if (!blockFits(start, s.span, P, L)) { fails.lunch++; continue; }
          if (tLoad + s.span > teacher.max_periods_per_day) { fails.teacherDay++; continue; }
          let ok = true;
          for (let q = start; q < start + s.span && ok; q++) {
            if (batchBusy.has(`${s.batch_id}|${day}|${q}`)) { fails.batch++; ok = false; }
            else if (teacherBusy.has(`${s.teacher_id}|${day}|${q}`)) { fails.teacher++; ok = false; }
          }
          if (!ok) continue;

          // pick a room: free for the entire block, big enough
          const candidates = roomsByType[kind].filter((r) => {
            if (r.capacity < batch.strength) return false;
            for (let q = start; q < start + s.span; q++) if (roomBusy.has(`${r.id}|${day}|${q}`)) return false;
            return true;
          });
          if (!candidates.length) { fails.room++; continue; }
          candidates.sort((a, b) => {
            const ah = homeRoom.get(s.batch_id) === a.id ? 0 : 1;
            const bh = homeRoom.get(s.batch_id) === b.id ? 0 : 1;
            return s.type === 'theory' && ah !== bh ? ah - bh : a.capacity - b.capacity;
          });
          const room = candidates[0];

          // ---- soft cost ----
          let c = 0;
          const key = `${s.batch_id}|${day}`;
          const existing = batchDayPeriods.get(key) || [];
          const after = existing.concat(Array.from({ length: s.span }, (_, i) => start + i)).sort((x, y) => x - y);
          c += 2 * (gapsOf(after) - gapsOf(existing));
          if (s.type === 'theory' && subjectDay.has(`${s.batch_id}|${s.subject_id}|${day}`)) c += 6;
          c += (batchDayLoad.get(key) || 0) * 0.6;
          c += tLoad * 0.8;
          c += (subjectPeriodCount.get(`${s.batch_id}|${s.subject_id}|${start}`) || 0) * 0.5;
          if (s.type === 'lab' && start <= L) c += 2;
          c += start * 0.05;
          c += rnd() * 0.4; // random tie-break so restarts explore differently

          if (!best || c < best.c) best = { day, start, room, c };
        }
      }

      if (!best) {
        let reason;
        const top = Object.entries(fails).sort((a, b) => b[1] - a[1])[0];
        if (top[0] === 'teacherDay') reason = `${teacher.name} has reached the daily teaching limit`;
        else if (top[0] === 'teacher') reason = `${teacher.name} has no free slot that also suits ${batch.name}`;
        else if (top[0] === 'room') reason = `No free ${kind} room with enough capacity`;
        else if (top[0] === 'batch') reason = `${batch.name} has no free periods left`;
        else reason = 'No valid slot available';
        unplaced.push({ ...s, reason });
        cost += 50;
        continue;
      }

      const { day, start, room } = best;
      for (let q = start; q < start + s.span; q++) {
        batchBusy.add(`${s.batch_id}|${day}|${q}`);
        teacherBusy.add(`${s.teacher_id}|${day}|${q}`);
        roomBusy.add(`${room.id}|${day}|${q}`);
      }
      const key = `${s.batch_id}|${day}`;
      teacherDay.set(`${s.teacher_id}|${day}`, (teacherDay.get(`${s.teacher_id}|${day}`) || 0) + s.span);
      batchDayLoad.set(key, (batchDayLoad.get(key) || 0) + s.span);
      batchDayPeriods.set(key, (batchDayPeriods.get(key) || []).concat(Array.from({ length: s.span }, (_, i) => start + i)).sort((x, y) => x - y));
      subjectDay.add(`${s.batch_id}|${s.subject_id}|${day}`);
      const pk = `${s.batch_id}|${s.subject_id}|${start}`;
      subjectPeriodCount.set(pk, (subjectPeriodCount.get(pk) || 0) + 1);
      if (s.type === 'theory' && !homeRoom.has(s.batch_id)) homeRoom.set(s.batch_id, room.id);
      cost += best.c;
      entries.push({
        day, period: start, span: s.span, batch_id: s.batch_id,
        subject_id: s.subject_id, teacher_id: s.teacher_id, room_id: room.id,
      });
    }
    return { entries, unplaced, cost };
  }

  let best = null;
  let attempts = 0;
  const startedAt = Date.now();
  if (workable.length) {
    while (attempts < maxAttempts && Date.now() - startedAt < timeLimit) {
      attempts++;
      const r = attempt();
      if (!best || r.unplaced.length < best.unplaced.length ||
          (r.unplaced.length === best.unplaced.length && r.cost < best.cost)) best = r;
      if (best.unplaced.length === 0 && attempts >= 40) break;
    }
  } else {
    best = { entries: [], unplaced: [], cost: 0 };
  }

  const unplaced = best.unplaced.concat(
    [...impossible].map(([s, reason]) => ({ ...s, reason })),
  );
  const totalPeriods = sessions.reduce((n, s) => n + s.span, 0) || 1;
  const placedPeriods = best.entries.reduce((n, e) => n + e.span, 0);
  const avgPenalty = best.cost / Math.max(1, sessions.length);
  const score = Math.max(0, Math.min(100, (placedPeriods / totalPeriods) * 100 - Math.min(20, avgPenalty)));

  return {
    entries: best.entries,
    unplaced,
    warnings,
    score: Math.round(score * 10) / 10,
    attempts,
    totalSessions: sessions.length,
  };
}

/**
 * Independent verifier: returns a list of human-readable clash/violation strings.
 * Used by tests and as a safety net after generation.
 */
function verify(entries, input) {
  const { settings } = input;
  const issues = [];
  const batchById = new Map(input.batches.map((b) => [b.id, b]));
  const roomById = new Map(input.rooms.map((r) => [r.id, r]));
  const subjById = new Map(input.subjects.map((s) => [s.id, s]));
  const teacherById = new Map(input.teachers.map((t) => [t.id, t]));
  const seen = { batch: new Map(), teacher: new Map(), room: new Map() };
  const tDay = new Map();

  for (const e of entries) {
    const batch = batchById.get(e.batch_id), room = roomById.get(e.room_id);
    const subj = subjById.get(e.subject_id), teacher = teacherById.get(e.teacher_id);
    if (!blockFits(e.period, e.span, settings.periods_per_day, settings.lunch_after)) {
      issues.push(`Block ${e.day} P${e.period} (span ${e.span}) crosses lunch or the day boundary`);
    }
    if (room.capacity < batch.strength) issues.push(`Room ${room.name} too small for ${batch.name}`);
    if (subj.type === 'lab' && room.type !== 'lab') issues.push(`Lab ${subj.name} not in a lab room`);
    if (subj.type === 'theory' && room.type !== 'classroom') issues.push(`Theory ${subj.name} not in a classroom`);
    const dk = `${e.teacher_id}|${e.day}`;
    tDay.set(dk, (tDay.get(dk) || 0) + e.span);
    for (let q = e.period; q < e.period + e.span; q++) {
      for (const [kind, id] of [['batch', e.batch_id], ['teacher', e.teacher_id], ['room', e.room_id]]) {
        const k = `${id}|${e.day}|${q}`;
        if (seen[kind].has(k)) issues.push(`${kind} clash on ${e.day} P${q} (id ${id})`);
        seen[kind].set(k, true);
      }
    }
  }
  for (const [k, n] of tDay) {
    const t = teacherById.get(Number(k.split('|')[0]));
    if (n > t.max_periods_per_day) issues.push(`${t.name} exceeds ${t.max_periods_per_day} periods on ${k.split('|')[1]}`);
  }
  return issues;
}

/**
 * Check whether an existing entry may be moved to a new day/period/room.
 * `others` = every other entry in the timetable (entry being edited excluded).
 * Returns an error string, or null when the move is valid.
 */
function checkMove({ others, entry, day, period, roomId, input }) {
  const moved = { ...entry, day, period, room_id: roomId };
  if (!input.settings.days.includes(day)) return 'Unknown day';
  const issues = verify(others.concat([moved]), input);
  return issues.length ? issues[0] : null;
}

module.exports = { generate, verify, checkMove, blockFits, buildSessions };
