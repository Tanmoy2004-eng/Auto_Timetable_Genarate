// Time helpers shared by the API, exports and tests.
function pad(n) { return String(n).padStart(2, '0'); }
function toHHMM(mins) { return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`; }
function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return 9 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Returns [{period, start:'09:00', end:'09:50'}] for periods 1..N.
// Lunch is not a period; it only pushes later periods forward in time.
function slotTimes(settings) {
  const out = [];
  let t = parseHHMM(settings.start_time);
  for (let p = 1; p <= settings.periods_per_day; p++) {
    out.push({ period: p, start: toHHMM(t), end: toHHMM(t + settings.period_minutes) });
    t += settings.period_minutes;
    if (p === settings.lunch_after) t += settings.lunch_minutes;
  }
  return out;
}

function lunchWindow(settings) {
  const times = slotTimes(settings);
  const before = times[settings.lunch_after - 1];
  const after = times[settings.lunch_after];
  if (!before || !after) return null;
  return { start: before.end, end: after.start };
}

module.exports = { toHHMM, parseHHMM, slotTimes, lunchWindow };

// SQLite datetime('now') is UTC without a zone marker; return a proper ISO string.
module.exports.iso = (s) => (s ? String(s).replace(' ', 'T') + 'Z' : null);
