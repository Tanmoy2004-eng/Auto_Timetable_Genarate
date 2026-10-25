import { api, ApiError } from './api.js';
import { h, clear, toast, confirmDialog, formModal, emptyState, skeleton, busy } from './ui.js';

const typeOpts = (vals) => vals.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));

export const ENTITIES = {
  teachers: {
    title: 'Teachers', singular: 'Teacher', icon: '👩‍🏫',
    fields: [
      { key: 'name', label: 'Teacher name', required: true, placeholder: 'e.g. Dr. Sharma' },
      { key: 'type', label: 'Teaches', type: 'select', options: typeOpts(['theory', 'lab', 'both']), hint: '"Both" can take theory and lab subjects.' },
      { key: 'max_periods_per_day', label: 'Max periods per day', type: 'number', min: 1, max: 10, required: true },
    ],
    defaults: { type: 'theory', max_periods_per_day: 5 },
    columns: [['Name', (r) => r.name], ['Teaches', (r) => tag(r.type)], ['Max / day', (r) => r.max_periods_per_day]],
  },
  rooms: {
    title: 'Rooms', singular: 'Room', icon: '🏫',
    fields: [
      { key: 'name', label: 'Room name', required: true, placeholder: 'e.g. R-101' },
      { key: 'capacity', label: 'Capacity (students)', type: 'number', min: 1, max: 1000, required: true },
      { key: 'type', label: 'Room type', type: 'select', options: typeOpts(['classroom', 'lab']) },
    ],
    defaults: { type: 'classroom', capacity: 60 },
    columns: [['Name', (r) => r.name], ['Type', (r) => tag(r.type)], ['Capacity', (r) => r.capacity]],
  },
  batches: {
    title: 'Batches / Classes', singular: 'Batch', icon: '🎓',
    fields: [
      { key: 'name', label: 'Batch / class name', required: true, placeholder: 'e.g. CSE-A' },
      { key: 'strength', label: 'Number of students', type: 'number', min: 1, max: 500, required: true, hint: 'Used to pick rooms that are big enough.' },
    ],
    defaults: { strength: 30 },
    columns: [['Name', (r) => r.name], ['Students', (r) => r.strength]],
  },
  subjects: {
    title: 'Subjects', singular: 'Subject', icon: '📚',
    fields: [
      { key: 'name', label: 'Subject name', required: true, placeholder: 'e.g. Mathematics' },
      { key: 'type', label: 'Type', type: 'select', options: typeOpts(['theory', 'lab']), hint: 'Labs run as one consecutive block and need a lab room.' },
      { key: 'periods_per_week', label: 'Periods per week', type: 'number', min: 1, max: 20, required: true },
    ],
    defaults: { type: 'theory', periods_per_week: 3 },
    columns: [['Name', (r) => r.name], ['Type', (r) => tag(r.type)], ['Periods / week', (r) => r.periods_per_week]],
  },
};

function tag(t) { return h('span', { class: `tag ${t === 'lab' ? 'lab' : ''}` }, t); }

export async function renderEntity(name, root, { onChange } = {}) {
  const def = ENTITIES[name];
  let rows = [];
  let query = '';
  const listBox = h('div');
  const search = h('input', { class: 'input', type: 'search', placeholder: `Search ${def.title.toLowerCase()}…`, 'aria-label': `Search ${def.title}`, style: 'max-width:240px', oninput: (e) => { query = e.target.value.toLowerCase(); draw(); } });
  const addBtn = h('button', { class: 'btn', type: 'button', onclick: () => openForm() }, `+ Add ${def.singular}`);

  clear(root).append(
    h('div', { class: 'page-head' }, h('h2', null, `${def.icon} ${def.title}`), h('div', { class: 'toolbar' }, search, addBtn)),
    h('div', { class: 'card' }, listBox),
  );

  function openForm(existing) {
    formModal({
      title: existing ? `Edit ${def.singular}` : `Add ${def.singular}`,
      fields: def.fields, values: existing || def.defaults,
      submitText: existing ? 'Save changes' : `Add ${def.singular}`,
      onSubmit: async (v) => {
        if (existing) await api(`/${name}/${existing.id}`, { method: 'PUT', body: v });
        else await api(`/${name}`, { method: 'POST', body: v });
        toast(`${def.singular} ${existing ? 'updated' : 'added'}`, 'success');
        await load();
        if (onChange) onChange();
      },
    });
  }

  async function remove(row) {
    const ok = await confirmDialog({ title: `Delete ${def.singular}?`, message: `"${row.name}" will be removed permanently.`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api(`/${name}/${row.id}`, { method: 'DELETE' });
    } catch (err) {
      if (err instanceof ApiError && err.data.inUse) {
        const force = await confirmDialog({ title: 'Used in saved timetables', message: err.message, confirmText: 'Delete anyway', danger: true });
        if (!force) return;
        await api(`/${name}/${row.id}?force=true`, { method: 'DELETE' });
      } else { toast(err.message, 'error'); return; }
    }
    toast(`${def.singular} deleted`, 'success');
    await load();
    if (onChange) onChange();
  }

  function draw() {
    const shown = rows.filter((r) => r.name.toLowerCase().includes(query));
    clear(listBox);
    if (!rows.length) {
      listBox.append(emptyState(def.icon, `No ${def.title.toLowerCase()} yet`, `Add your first ${def.singular.toLowerCase()} to get started.`,
        h('button', { class: 'btn', type: 'button', onclick: () => openForm() }, `+ Add ${def.singular}`)));
      return;
    }
    if (!shown.length) { listBox.append(emptyState('🔍', 'No matches', 'Try a different search.')); return; }
    listBox.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, '#'), def.columns.map(([t]) => h('th', null, t)), h('th', { 'aria-label': 'Actions' }))),
      h('tbody', null, shown.map((r, i) => h('tr', null,
        h('td', null, i + 1), def.columns.map(([, f]) => h('td', null, f(r))),
        h('td', { class: 'actions-cell' },
          h('button', { class: 'btn small secondary', type: 'button', onclick: () => openForm(r) }, 'Edit'), ' ',
          h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Delete ${r.name}`, onclick: () => remove(r) }, 'Delete'))))))));
  }

  async function load() {
    try { rows = await api(`/${name}`); draw(); } catch (e) { clear(listBox).append(h('div', { class: 'form-error' }, e.message)); }
  }
  listBox.append(skeleton());
  await load();
}

// ---------------- Assign subjects (+ teacher) to a batch ----------------
export async function renderAssign(root, { onChange } = {}) {
  clear(root).append(h('div', { class: 'card' }, skeleton()));
  let batches, subjects, teachers;
  try { [batches, subjects, teachers] = await Promise.all([api('/batches'), api('/subjects'), api('/teachers')]); }
  catch (e) { clear(root).append(h('div', { class: 'form-error' }, e.message)); return; }

  const head = h('div', { class: 'page-head' }, h('h2', null, '🔗 Assign Subjects'));
  if (!batches.length || !subjects.length || !teachers.length) {
    const missing = [!batches.length && 'a batch', !subjects.length && 'a subject', !teachers.length && 'a teacher'].filter(Boolean).join(', ');
    clear(root).append(head, h('div', { class: 'card' }, emptyState('🧩', 'Almost there', `Add ${missing} first, then come back to choose which subjects each batch studies and who teaches them.`)));
    return;
  }

  const select = h('select', { class: 'input', id: 'assign-batch', 'aria-label': 'Batch', style: 'max-width:260px' }, batches.map((b) => h('option', { value: b.id }, `${b.name} (${b.strength} students)`)));
  const body = h('div');
  clear(root).append(head, h('div', { class: 'card' },
    h('div', { class: 'toolbar', style: 'margin-bottom:1rem' }, h('label', { for: 'assign-batch' }, 'Batch:'), select),
    h('p', { class: 'muted' }, 'Tick the subjects this batch studies and choose a teacher for each. Lab subjects need a lab or "both" teacher.'),
    body));

  const compatible = (s) => teachers.filter((t) => t.type === 'both' || t.type === s.type);

  async function drawBatch() {
    clear(body).append(skeleton(3));
    let current;
    try { current = await api(`/batches/${select.value}/subjects`); } catch (e) { clear(body).append(h('div', { class: 'form-error' }, e.message)); return; }
    const byId = new Map(current.map((c) => [c.subject_id, c.teacher_id]));
    const state = subjects.map((s) => {
      const opts = compatible(s);
      return { s, opts, checked: byId.has(s.id), teacher: byId.get(s.id) ?? (opts[0] ? opts[0].id : '') };
    });
    const rowEls = state.map((st) => {
      const cb = h('input', { type: 'checkbox', id: `as-${st.s.id}`, checked: st.checked, disabled: !st.opts.length, onchange: (e) => { st.checked = e.target.checked; sel.disabled = !st.checked; } });
      const sel = h('select', { class: 'input', 'aria-label': `Teacher for ${st.s.name}`, disabled: !st.checked, onchange: (e) => { st.teacher = Number(e.target.value); } },
        st.opts.length ? st.opts.map((t) => h('option', { value: t.id, selected: t.id === st.teacher }, t.name)) : h('option', null, 'No suitable teacher'));
      return h('tr', null,
        h('td', null, cb), h('td', null, h('label', { for: `as-${st.s.id}` }, st.s.name)),
        h('td', null, tag(st.s.type)), h('td', null, `${st.s.periods_per_week}${st.s.type === 'lab' ? ' (as block)' : ''}`), h('td', null, sel));
    });
    const save = h('button', { class: 'btn', type: 'button', onclick: () => busy(save, async () => {
      const chosen = state.filter((x) => x.checked);
      if (chosen.some((x) => !x.teacher)) { toast('Pick a teacher for every ticked subject', 'error'); return; }
      try {
        await api(`/batches/${select.value}/subjects`, { method: 'PUT', body: { assignments: chosen.map((x) => ({ subject_id: x.s.id, teacher_id: x.teacher })) } });
        toast(`Saved ${chosen.length} subject${chosen.length === 1 ? '' : 's'}`, 'success');
        if (onChange) onChange();
      } catch (e) { toast(e.message, 'error'); }
    }) }, 'Save assignments');
    clear(body).append(
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, ['', 'Subject', 'Type', 'Periods / week', 'Teacher'].map((t) => h('th', null, t)))),
        h('tbody', null, rowEls))),
      h('div', { style: 'margin-top:1rem' }, save));
  }
  select.addEventListener('change', drawBatch);
  await drawBatch();
}

// ---------------- Settings ----------------
const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export async function renderSettings(root) {
  clear(root).append(h('div', { class: 'card' }, skeleton()));
  let s;
  try { s = await api('/settings'); } catch (e) { clear(root).append(h('div', { class: 'form-error' }, e.message)); return; }

  const num = (id, label, v, min, max, hint) => h('div', { class: 'field' }, h('label', { for: id }, label),
    h('input', { id, type: 'number', min, max, value: v }), hint ? h('div', { class: 'hint' }, hint) : null);
  const dayChecks = ALL_DAYS.map((d) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: d, checked: s.days.includes(d) }), d));
  const err = h('div', { class: 'form-error hidden', role: 'alert' });
  const save = h('button', { class: 'btn', type: 'submit' }, 'Save settings');

  const form = h('form', { novalidate: true },
    err,
    h('fieldset', { class: 'field' }, h('legend', null, 'Working days'), h('div', { class: 'checks' }, dayChecks)),
    h('div', { class: 'grid-2' },
      num('s-periods', 'Periods per day', s.periods_per_day, 1, 12),
      h('div', { class: 'field' }, h('label', { for: 's-start' }, 'First period starts at'), h('input', { id: 's-start', type: 'time', value: s.start_time })),
      num('s-len', 'Period length (minutes)', s.period_minutes, 20, 180),
      num('s-lunch-after', 'Lunch break after period', s.lunch_after, 0, 11, '0 = no lunch break'),
      num('s-lunch-len', 'Lunch length (minutes)', s.lunch_minutes, 0, 120),
      num('s-lab', 'Lab block length (periods)', s.lab_block, 1, 4, 'Labs are scheduled as one block this long.')),
    save);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    busy(save, async () => {
      const v = (id) => form.querySelector(`#${id}`).value;
      try {
        await api('/settings', { method: 'PUT', body: {
          days: [...form.querySelectorAll('.checks input:checked')].map((c) => c.value),
          periods_per_day: Number(v('s-periods')), start_time: v('s-start'), period_minutes: Number(v('s-len')),
          lunch_after: Number(v('s-lunch-after')), lunch_minutes: Number(v('s-lunch-len')), lab_block: Number(v('s-lab')),
        } });
        toast('Settings saved. Generate a new timetable to apply them.', 'success');
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
    });
  });

  clear(root).append(h('div', { class: 'page-head' }, h('h2', null, '⚙️ Timetable Settings')),
    h('div', { class: 'card', style: 'max-width:720px' }, form));
}
