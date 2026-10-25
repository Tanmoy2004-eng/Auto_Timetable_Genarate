import { api } from './api.js';
import { h, clear, toast, confirmDialog, formModal, emptyState, skeleton, busy, fmtDate } from './ui.js';

const state = { view: 'grid', by: 'batch', entityId: null, batchFilter: '' };

export async function renderTimetable(root, { id, onGenerate } = {}) {
  clear(root).append(h('div', { class: 'card' }, skeleton(6)));
  let list, tt, rooms;
  try {
    list = await api('/timetables');
    if (!list.length) {
      clear(root).append(h('div', { class: 'page-head' }, h('h2', null, '🗓️ Timetable')),
        h('div', { class: 'card' }, emptyState('🗓️', 'No timetable yet', 'Add your teachers, rooms, batches and subjects, assign subjects to batches, then generate.',
          (() => { const b = h('button', { class: 'btn', type: 'button' }, '⚡ Generate Timetable'); b.addEventListener('click', () => onGenerate(b)); return b; })())));
      return;
    }
    const useId = list.some((t) => String(t.id) === String(id)) ? id : list[0].id;
    [tt, rooms] = await Promise.all([api(`/timetables/${useId}`), api('/rooms')]);
  } catch (e) { clear(root).append(h('div', { class: 'form-error' }, e.message)); return; }

  const reload = () => renderTimetable(root, { id: tt.id, onGenerate });
  const rows = tt.timetable;
  const unique = (key, idKey) => {
    const m = new Map();
    rows.forEach((r) => m.set(r[idKey], r[key]));
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  };
  const idKey = { batch: 'batch_id', teacher: 'teacher_id', room: 'room_id' };
  // Options depend on the current "view by" mode, so recompute whenever needed.
  let options = [];
  function syncOptions() {
    options = unique(state.by, idKey[state.by]);
    if (!options.some((o) => String(o.value) === String(state.entityId))) state.entityId = options[0] ? options[0].value : null;
  }
  syncOptions();

  // ---------- header / toolbar ----------
  const history = h('select', { class: 'input', 'aria-label': 'Saved timetables', style: 'max-width:260px', onchange: (e) => renderTimetable(root, { id: e.target.value, onGenerate }) },
    list.map((t) => h('option', { value: t.id, selected: t.id === tt.id }, `${t.name} (${fmtDate(t.generated_at)})`)));
  const gen = h('button', { class: 'btn', type: 'button', onclick: () => onGenerate(gen) }, '⚡ Generate new');
  const dl = (fmt, label) => { const b = h('button', { class: 'btn secondary', type: 'button' }, label); b.addEventListener('click', () => busy(b, () => download(tt, fmt).catch((e) => toast(e.message, 'error')))); return b; };
  const del = h('button', { class: 'btn ghost', type: 'button', style: 'color:var(--danger);border-color:var(--danger)', onclick: async () => {
    if (!(await confirmDialog({ title: 'Delete timetable?', message: `"${tt.name}" will be permanently deleted.`, confirmText: 'Delete', danger: true }))) return;
    try { await api(`/timetables/${tt.id}`, { method: 'DELETE' }); toast('Timetable deleted', 'success'); renderTimetable(root, { onGenerate }); } catch (e) { toast(e.message, 'error'); }
  } }, 'Delete');

  const alerts = [];
  const meta = tt.meta || {};
  if (meta.unplaced && meta.unplaced.length) {
    alerts.push(h('div', { class: 'alert', role: 'alert' }, h('b', null, `${meta.unplaced.length} session(s) could not be placed:`),
      h('ul', null, meta.unplaced.map((u) => h('li', null, `${u.batch} · ${u.subject} (${u.teacher}, ${u.periods} period${u.periods > 1 ? 's' : ''}): ${u.reason}`)))));
  }
  if (meta.warnings && meta.warnings.length) {
    alerts.push(h('div', { class: 'alert' }, h('b', null, 'Heads up:'), h('ul', null, meta.warnings.map((w) => h('li', null, w)))));
  }
  if (!alerts.length) alerts.push(h('div', { class: 'alert ok no-print' }, '✅ Every session is placed with no teacher, room or class clashes.'));

  const content = h('div');
  const controls = h('div', { class: 'toolbar no-print', style: 'margin:1rem 0' });

  function drawControls() {
    syncOptions();
    clear(controls);
    const viewTabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'View' },
      ['grid', 'table'].map((v) => h('button', { type: 'button', 'aria-pressed': String(state.view === v), onclick: () => { state.view = v; drawAll(); } }, v === 'grid' ? 'Weekly grid' : 'Table')));
    controls.append(viewTabs);
    if (state.view === 'grid') {
      const by = h('select', { class: 'input', 'aria-label': 'View by', style: 'width:auto', onchange: (e) => { state.by = e.target.value; state.entityId = null; drawAll(true); } },
        ['batch', 'teacher', 'room'].map((k) => h('option', { value: k, selected: state.by === k }, `By ${k}`)));
      const ent = h('select', { class: 'input', 'aria-label': 'Choose which one', style: 'width:auto', onchange: (e) => { state.entityId = e.target.value; drawContent(); } },
        options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(state.entityId) }, o.label)));
      controls.append(by, ent, h('div', { class: 'legend' }, h('span', null, h('i'), 'Theory'), h('span', null, h('i', { class: 'lab' }), 'Lab')));
    } else {
      const bf = h('select', { class: 'input', 'aria-label': 'Filter by batch', style: 'width:auto', onchange: (e) => { state.batchFilter = e.target.value; drawContent(); } },
        h('option', { value: '' }, 'All batches'), unique('batch', 'batch_id').map((o) => h('option', { value: o.label, selected: state.batchFilter === o.label }, o.label)));
      controls.append(bf);
    }
  }
  function drawContent() {
    syncOptions();
    clear(content);
    content.append(state.view === 'grid' ? gridView() : tableView());
  }
  function drawAll() { drawControls(); drawContent(); }

  // ---------- weekly grid ----------
  function gridView() {
    const { days, lunch_after: L } = tt.settings;
    const mine = rows.filter((r) => String(r[idKey[state.by]]) === String(state.entityId));
    if (!mine.length) return h('div', { class: 'card' }, emptyState('📭', 'Nothing scheduled', 'No sessions for this selection.'));
    const start = new Map(), skip = new Set();
    mine.forEach((e) => { start.set(`${e.day}|${e.period}`, e); for (let i = 1; i < e.span; i++) skip.add(`${e.day}|${e.period + i}`); });
    const second = { batch: (e) => e.teacher, teacher: (e) => e.batch, room: (e) => e.batch }[state.by];
    const third = { batch: (e) => e.room, teacher: (e) => e.room, room: (e) => e.teacher }[state.by];

    const body = [];
    tt.slots.forEach((s) => {
      body.push(h('tr', null,
        h('td', { class: 'time' }, h('b', null, `P${s.period}`), `${s.start}–${s.end}`),
        days.map((d) => {
          const key = `${d}|${s.period}`;
          if (skip.has(key)) return null;
          const e = start.get(key);
          if (!e) return h('td', { class: 'slot' });
          return h('td', { class: 'slot', rowspan: e.span },
            h('button', { class: `cell ${e.type === 'lab' ? 'lab' : ''}`, type: 'button', title: 'Click to move or edit', 'aria-label': `${e.subject}, ${e.day} ${e.period_label}. Edit`, onclick: () => openEdit(e) },
              h('span', { class: 's' }, labelOf(e)), h('span', null, second(e)), h('span', null, third(e))));
        })));
      if (s.period === L && L < tt.slots.length) body.push(h('tr', null, h('td', { class: 'lunch', colspan: days.length + 1 }, 'Lunch break')));
    });
    const title = options.find((o) => String(o.value) === String(state.entityId));
    return h('div', { class: 'card' },
      h('h3', null, `${title ? title.label : ''} — weekly timetable`),
      h('div', { class: 'table-wrap', style: 'border:0' }, h('table', { class: 'grid' },
        h('thead', null, h('tr', null, h('th', { class: 'time' }, 'Time'), days.map((d) => h('th', null, d)))),
        h('tbody', null, body))));
  }

  // ---------- flat table ----------
  function tableView() {
    const shown = rows.filter((r) => !state.batchFilter || r.batch === state.batchFilter);
    if (!shown.length) return h('div', { class: 'card' }, emptyState('📭', 'No sessions', 'Nothing to show for this filter.'));
    const heads = ['Day', 'Class', 'Period', 'Time', 'Room', 'Teacher', 'Subject', 'Action'].map((t) => h('th', null, t));
    const trs = shown.map((r) => h('tr', null,
      h('td', null, r.day),
      h('td', null, r.batch),
      h('td', null, r.period_label),
      h('td', null, `${r.start}–${r.end}`),
      h('td', null, r.room),
      h('td', null, r.teacher),
      h('td', null, r.subject, ' ', r.type === 'lab' ? h('span', { class: 'tag lab' }, 'lab') : null),
      h('td', { class: 'actions-cell' },
        h('button', { class: 'btn small secondary', type: 'button', onclick: () => openEdit(r) }, 'Move'),
        ' ',
        h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Remove ${r.subject} on ${r.day}`, onclick: () => removeEntry(r) }, 'Remove'))));
    return h('div', { class: 'card' },
      h('div', { class: 'table-wrap' },
        h('table', { class: 'data' }, h('thead', null, h('tr', null, heads)), h('tbody', null, trs))));
  }

  // ---------- manual edit (server checks every clash) ----------
  function openEdit(e) {
    const fitRooms = rooms.filter((r) => r.type === (e.type === 'lab' ? 'lab' : 'classroom'));
    formModal({
      title: `Move ${e.subject} (${e.batch})`,
      fields: [
        { key: 'day', label: 'Day', type: 'select', options: tt.settings.days.map((d) => ({ value: d, label: d })) },
        { key: 'period', label: e.span > 1 ? `Starting period (block of ${e.span})` : 'Period', type: 'select',
          options: tt.slots.map((s) => ({ value: s.period, label: `P${s.period}  ${s.start}–${s.end}` })) },
        { key: 'room_id', label: 'Room', type: 'select', options: fitRooms.map((r) => ({ value: r.id, label: `${r.name} (${r.capacity})` })) },
      ],
      values: { day: e.day, period: e.period, room_id: e.room_id },
      submitText: 'Move',
      onSubmit: async (v) => {
        await api(`/timetables/${tt.id}/entries/${e.id}`, { method: 'PUT', body: { day: v.day, period: Number(v.period), room_id: Number(v.room_id) } });
        toast('Session moved', 'success');
        reload();
      },
    });
  }
  async function removeEntry(e) {
    if (!(await confirmDialog({ title: 'Remove session?', message: `${e.subject} for ${e.batch} on ${e.day} ${e.period_label} will be removed from this timetable.`, confirmText: 'Remove', danger: true }))) return;
    try { await api(`/timetables/${tt.id}/entries/${e.id}`, { method: 'DELETE' }); toast('Session removed', 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
  }

  clear(root).append(
    h('div', { class: 'page-head' }, h('h2', null, '🗓️ Timetable'),
      h('div', { class: 'toolbar' }, history, gen, dl('pdf', '⬇ PDF'), dl('xlsx', '⬇ Excel'),
        h('button', { class: 'btn secondary', type: 'button', onclick: () => window.print() }, '🖨 Print'), del)),
    h('p', { class: 'muted no-print' }, `${tt.name} · generated ${fmtDate(tt.generated_at)} · quality score ${tt.score}/100 · ${rows.length} sessions`),
    ...alerts, controls, content);
  drawAll();
}

const labelOf = (e) => (e.type === 'lab' && !/lab/i.test(e.subject) ? `${e.subject} (Lab)` : e.subject);

async function download(tt, fmt) {
  const blob = await api(`/timetables/${tt.id}/export?format=${fmt}`, { blob: true });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `${tt.name.replace(/[^\w.-]+/g, '_')}.${fmt}` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
