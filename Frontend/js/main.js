import { api, session, setUnauthorizedHandler } from './api.js';
import { h, clear, toast, openModal, busy, skeleton, fmtDate } from './ui.js';
import { renderEntity, renderAssign, renderSettings } from './entities.js';
import { renderTimetable } from './timetable.js';

const app = document.getElementById('app');
let clockTimer = null;
let viewRoot = null;
let navButtons = {};
let currentView = 'dashboard';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ======================= auth =======================
function authField({ id, label, type = 'text', autocomplete, hint }) {
  const input = h('input', { id, name: id, type, autocomplete, required: true });
  const err = h('div', { class: 'error', id: `${id}-err` });
  input.setAttribute('aria-describedby', `${id}-err`);
  let control = input;
  if (type === 'password') {
    const toggle = h('button', { type: 'button', class: 'btn small ghost', 'aria-label': 'Show password', onclick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    } }, 'Show');
    input.style.paddingRight = '4.2rem';
    control = h('div', { class: 'pw-wrap' }, input, toggle);
  }
  const wrap = h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null, err);
  const setError = (m) => { err.textContent = m || ''; wrap.classList.toggle('invalid', !!m); };
  return { wrap, input, setError };
}

function authShell(card) {
  clear(app).append(h('div', { class: 'auth-page' },
    h('div', { class: 'backdrop-blur' }), h('div', { class: 'blob b1' }), h('div', { class: 'blob b2' }),
    h('main', { class: 'auth-card' }, card)));
}

function showLanding() {
  authShell([
    h('div', { class: 'logo', 'aria-hidden': 'true' }, '🗓️'),
    h('h1', null, 'Smart Timetable Generator'),
    h('p', { class: 'sub' }, 'Create clash-free weekly timetables for teachers, rooms and classes in one click.'),
    h('div', { class: 'auth-actions' },
      h('button', { class: 'btn block', type: 'button', onclick: () => showLogin() }, 'Login'),
      h('button', { class: 'btn secondary block', type: 'button', onclick: () => showSignup() }, 'Sign Up')),
  ]);
}

function showLogin(prefillEmail = '') {
  const email = authField({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email' });
  const pw = authField({ id: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' });
  email.input.value = prefillEmail;
  const remember = h('input', { type: 'checkbox', id: 'remember', checked: true });
  const formErr = h('div', { class: 'form-error hidden', role: 'alert' });
  const submit = h('button', { class: 'btn block', type: 'submit' }, 'Login');
  const form = h('form', { novalidate: true }, formErr, email.wrap, pw.wrap,
    h('label', { class: 'check', for: 'remember', style: 'margin-bottom:1rem' }, remember, 'Remember me'), submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formErr.classList.add('hidden');
    email.setError(EMAIL_RE.test(email.input.value.trim()) ? '' : 'Enter a valid email address');
    pw.setError(pw.input.value ? '' : 'Enter your password');
    if (!EMAIL_RE.test(email.input.value.trim()) || !pw.input.value) return;
    busy(submit, async () => {
      try {
        const r = await api('/login', { method: 'POST', body: { email: email.input.value.trim(), password: pw.input.value } });
        session.set(r.token, r.user, remember.checked);
        toast(`Welcome back, ${r.user.name}!`, 'success');
        showApp();
      } catch (ex) { formErr.textContent = ex.message; formErr.classList.remove('hidden'); }
    });
  });
  authShell([
    h('h1', null, 'Welcome back'), h('p', { class: 'sub' }, 'Log in to manage your timetables'), form,
    h('p', { style: 'margin-top:1rem' }, 'New here? ', h('button', { class: 'link-btn', type: 'button', onclick: () => showSignup() }, 'Create an account')),
    h('button', { class: 'link-btn', type: 'button', onclick: showLanding }, '← Back'),
  ]);
  email.input.focus();
}

function showSignup() {
  const name = authField({ id: 'name', label: 'Full name', autocomplete: 'name' });
  const email = authField({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email' });
  const pw = authField({ id: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', hint: 'At least 8 characters.' });
  const formErr = h('div', { class: 'form-error hidden', role: 'alert' });
  const submit = h('button', { class: 'btn block', type: 'submit' }, 'Create account');
  const form = h('form', { novalidate: true }, formErr, name.wrap, email.wrap, pw.wrap, submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formErr.classList.add('hidden');
    const okName = name.input.value.trim().length > 0, okEmail = EMAIL_RE.test(email.input.value.trim()), okPw = pw.input.value.length >= 8;
    name.setError(okName ? '' : 'Please enter your name');
    email.setError(okEmail ? '' : 'Enter a valid email address');
    pw.setError(okPw ? '' : 'Password must be at least 8 characters');
    if (!(okName && okEmail && okPw)) return;
    busy(submit, async () => {
      try {
        const r = await api('/signup', { method: 'POST', body: { name: name.input.value.trim(), email: email.input.value.trim(), password: pw.input.value } });
        session.set(r.token, r.user, true);
        toast('Account created. Welcome!', 'success');
        showApp();
      } catch (ex) { formErr.textContent = ex.message; formErr.classList.remove('hidden'); }
    });
  });
  authShell([
    h('h1', null, 'Create account'), h('p', { class: 'sub' }, 'Start building your timetable'), form,
    h('p', { style: 'margin-top:1rem' }, 'Already registered? ', h('button', { class: 'link-btn', type: 'button', onclick: () => showLogin() }, 'Login')),
    h('button', { class: 'link-btn', type: 'button', onclick: showLanding }, '← Back'),
  ]);
  name.input.focus();
}

function logout(message) {
  session.clear();
  stopClock();
  showLanding();
  if (message) toast(message, 'info', 5000);
}
setUnauthorizedHandler(() => logout('Your session expired. Please log in again.'));

// ======================= app shell =======================
const NAV = [
  ['dashboard', 'Dashboard'], ['teachers', 'Teachers'], ['rooms', 'Rooms'], ['batches', 'Batches'],
  ['subjects', 'Subjects'], ['assign', 'Assign'], ['timetable', 'Timetable'], ['settings', 'Settings'],
];

function stopClock() { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }
function startClock(el) {
  stopClock(); // only ever one interval
  const tick = () => { el.textContent = new Date().toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  tick();
  clockTimer = setInterval(tick, 1000);
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch { /* ignore */ }
}

function showApp() {
  const user = session.user || { name: 'User' };
  const clock = h('span', { class: 'clock', 'aria-hidden': 'true' });
  navButtons = {};
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, NAV.map(([key, label]) => {
    const b = h('button', { type: 'button', onclick: () => go(key) }, label);
    navButtons[key] = b;
    return b;
  }));
  viewRoot = h('main', { class: 'container', id: 'view' });
  clear(app).append(
    h('header', { class: 'topbar' },
      h('button', { class: 'brand', type: 'button', onclick: () => go('dashboard') }, '🗓️ Smart Timetable'),
      nav,
      h('div', { class: 'top-right' }, clock, h('span', null, `👤 ${user.name}`),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Toggle dark mode', title: 'Toggle dark mode', onclick: toggleTheme }, '🌓'),
        h('button', { class: 'icon-btn', type: 'button', onclick: () => logout() }, 'Logout'))),
    viewRoot);
  startClock(clock);
  go('dashboard');
}

function go(view, opts = {}) {
  currentView = view;
  Object.entries(navButtons).forEach(([k, b]) => { if (k === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  const root = h('div');          // fresh container per navigation so late responses never overwrite a newer screen
  clear(viewRoot).append(root);
  window.scrollTo({ top: 0 });
  const refreshDash = () => {}; // data screens reload themselves; dashboard re-reads on visit
  if (view === 'dashboard') renderDashboard(root);
  else if (['teachers', 'rooms', 'batches', 'subjects'].includes(view)) renderEntity(view, root, { onChange: refreshDash });
  else if (view === 'assign') renderAssign(root);
  else if (view === 'settings') renderSettings(root);
  else if (view === 'timetable') renderTimetable(root, { id: opts.id, onGenerate: runGenerate });
}

// Shared by the dashboard card and the timetable screen.
function runGenerate(btn) {
  return busy(btn, async () => {
    try {
      const r = await api('/generate', { method: 'POST', body: {} });
      const missed = (r.unplaced || []).length;
      toast(missed ? `Timetable generated, but ${missed} session(s) could not be placed.` : 'Timetable generated with zero clashes!', missed ? 'info' : 'success', 5500);
      go('timetable', { id: r.id });
    } catch (e) {
      toast(e.message, 'error', 8000);
      if (/no subjects assigned/i.test(e.message)) go('assign');
    }
  });
}

// ======================= dashboard =======================
async function renderDashboard(root) {
  const user = session.user || { name: 'there' };
  clear(root).append(h('div', { class: 'card' }, skeleton(5)));
  let stats, assignedOk = false;
  try {
    stats = await api('/stats');
    const batches = await api('/batches');
    const counts = await Promise.all(batches.map((b) => api(`/batches/${b.id}/subjects`).then((a) => a.length)));
    assignedOk = batches.length > 0 && counts.every((n) => n > 0);
  } catch (e) { clear(root).append(h('div', { class: 'form-error' }, e.message)); return; }

  const card = (key, icon, title, desc, count, extra = {}) => h('button', { class: `action-card ${extra.primary ? 'primary' : ''}`, type: 'button', onclick: extra.onclick || (() => go(key)) },
    count !== undefined ? h('span', { class: 'badge', 'aria-label': `${count} total` }, count) : null,
    h('span', { class: 'ico', 'aria-hidden': 'true' }, icon), h('span', { class: 't' }, title), h('span', { class: 'd' }, desc));

  const genBtn = card('', '⚡', 'Generate Timetable', 'Build a clash-free schedule now', undefined, { primary: true, onclick: () => runGenerate(genBtn) });

  const items = [
    [stats.teacherCount > 0, 'Add teachers'], [stats.roomCount > 0, 'Add rooms (classrooms and labs)'],
    [stats.batchCount > 0, 'Add batches / classes'], [stats.subjectCount > 0, 'Add subjects'],
    [assignedOk, 'Assign subjects and teachers to every batch'],
  ];
  const ready = items.every(([ok]) => ok);

  clear(root).append(
    h('section', { class: 'card welcome' }, h('h2', null, `Welcome, ${user.name} 👋`),
      h('p', null, 'Add your data, assign subjects to batches, then generate a clash-free weekly timetable in one click.')),
    h('div', { class: 'actions' },
      card('teachers', '👩‍🏫', 'Add Teacher', 'Manage faculty', stats.teacherCount),
      card('rooms', '🏫', 'Add Room', 'Classrooms and labs', stats.roomCount),
      card('batches', '🎓', 'Add Batch / Class', 'Groups of students', stats.batchCount),
      card('subjects', '📚', 'Add Subject', 'Theory and lab subjects', stats.subjectCount),
      card('assign', '🔗', 'Assign Subjects', 'Who teaches what, to whom'),
      genBtn,
      card('timetable', '🗓️', 'View Timetable', 'Grid, table, export', stats.timetableCount),
      card('', '📊', 'View Statistics', 'Totals at a glance', undefined, { onclick: () => showStats(stats) })),
    h('div', { class: 'grid-2' },
      h('section', { class: 'card' }, h('h3', null, ready ? '✅ Ready to generate' : 'Setup checklist'),
        h('ul', { class: 'checklist' }, items.map(([ok, text]) => h('li', null, h('span', { class: `dot ${ok ? 'ok' : ''}`, 'aria-hidden': 'true' }, ok ? '✓' : ''), h('span', { class: ok ? 'muted' : '' }, text, h('span', { class: 'sr-only' }, ok ? ' (done)' : ' (to do)')))))),
      h('section', { class: 'card' }, h('h3', null, 'Latest timetable'),
        stats.lastTimetable
          ? [h('p', null, h('b', null, stats.lastTimetable.name)), h('p', { class: 'muted' }, `Generated ${fmtDate(stats.lastGenerated)} · score ${stats.lastTimetable.score}/100`),
             h('button', { class: 'btn', type: 'button', onclick: () => go('timetable', { id: stats.lastTimetable.id }) }, 'Open timetable')]
          : h('p', { class: 'muted' }, 'Nothing generated yet.'))));
}

function showStats(s) {
  const stat = (n, label) => h('div', { class: 'stat' }, h('b', null, n), label);
  const close = h('button', { class: 'btn', type: 'button' }, 'Close');
  const m = openModal({
    title: '📊 Statistics',
    content: h('div', null,
      h('div', { class: 'stat-grid' }, stat(s.teacherCount, 'Teachers'), stat(s.roomCount, 'Rooms'), stat(s.batchCount, 'Batches'), stat(s.subjectCount, 'Subjects'), stat(s.timetableCount, 'Timetables')),
      h('p', { class: 'muted', style: 'margin-top:1rem' }, `Last generated: ${fmtDate(s.lastGenerated)}`)),
    actions: [close],
  });
  close.addEventListener('click', () => m.close());
}

// ======================= boot =======================
(async function boot() {
  if (!session.token) { showLanding(); return; }
  try { // validate the stored token before showing the app
    const me = await api('/me');
    let remembered = true;
    try { remembered = localStorage.getItem('authToken') !== null; } catch { /* storage blocked */ }
    session.set(session.token, me, remembered);
    showApp();
  } catch { /* 401 handler already logged out; network errors fall through */
    if (session.token) showApp(); else showLanding();
  }
})();
