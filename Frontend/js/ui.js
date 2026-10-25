// Small DOM + UI toolkit. Everything is built with textContent/DOM nodes (no innerHTML),
// so user-supplied text can never be interpreted as HTML.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export function toast(message, type = 'info', ms = 4200) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function fmtDate(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Never' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// Disable a button + show spinner while an async action runs.
export async function busy(btn, fn) {
  if (btn.disabled) return undefined;
  const label = Array.from(btn.childNodes);
  btn.disabled = true;
  btn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Working…');
  try { return await fn(); } finally {
    btn.disabled = false;
    btn.replaceChildren(...label);
  }
}

export function skeleton(rows = 4) {
  return h('div', { 'aria-busy': 'true', 'aria-label': 'Loading' }, Array.from({ length: rows }, () => h('div', { class: 'skeleton' })));
}

export function emptyState(icon, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'big', 'aria-hidden': 'true' }, icon), h('h3', null, title), h('p', null, text), action || null);
}

// ---- modal ----
let modalCount = 0;
export function openModal({ title, content, actions = [], onClose }) {
  const returnFocus = document.activeElement;
  const titleId = `m-title-${++modalCount}`;
  const overlay = h('div', { class: 'overlay' });
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('h3', { id: titleId }, title), content,
    actions.length ? h('div', { class: 'modal-actions' }, actions) : null);
  overlay.appendChild(modal);
  const close = (result) => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (returnFocus && returnFocus.focus) returnFocus.focus();
    if (onClose) onClose(result);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = modal.querySelectorAll('button, input, select, [href], [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  const firstField = modal.querySelector('input, select, button');
  if (firstField) firstField.focus();
  return { close, modal };
}

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const ok = h('button', { class: `btn ${danger ? 'danger' : ''}`, type: 'button', onclick: () => { finish(true); m.close(); } }, confirmText);
    const cancel = h('button', { class: 'btn secondary', type: 'button', onclick: () => m.close() }, 'Cancel');
    const m = openModal({ title, content: h('p', null, message), actions: [cancel, ok], onClose: () => finish(false) });
    cancel.focus();
  });
}

/**
 * Generic form dialog.
 * fields: [{key,label,type:'text'|'number'|'select'|'time',options:[{value,label}],min,max,required,hint}]
 * onSubmit(values) may throw an Error: its message is shown inside the dialog.
 */
export function formModal({ title, fields, values = {}, submitText = 'Save', onSubmit }) {
  const inputs = {};
  const errorEls = {};
  const formError = h('div', { class: 'form-error hidden', role: 'alert' });

  const rows = fields.map((f, i) => {
    const id = `f-${f.key}-${modalCount}-${i}`;
    let input;
    if (f.type === 'select') {
      input = h('select', { id, name: f.key }, f.options.map((o) => h('option', { value: o.value, selected: String(values[f.key]) === String(o.value) }, o.label)));
    } else {
      input = h('input', { id, name: f.key, type: f.type || 'text', value: values[f.key] ?? '', min: f.min, max: f.max, required: f.required, autocomplete: 'off', placeholder: f.placeholder, maxlength: f.type === 'number' ? null : 80 });
    }
    inputs[f.key] = input;
    errorEls[f.key] = h('div', { class: 'error', id: `${id}-err` });
    input.setAttribute('aria-describedby', `${id}-err`);
    return h('div', { class: 'field', 'data-key': f.key }, h('label', { for: id }, f.label), input, f.hint ? h('div', { class: 'hint' }, f.hint) : null, errorEls[f.key]);
  });

  const submit = h('button', { class: 'btn', type: 'submit' }, submitText);
  const cancel = h('button', { class: 'btn secondary', type: 'button' }, 'Cancel');
  const form = h('form', { novalidate: true }, formError, rows, h('div', { class: 'modal-actions' }, cancel, submit));
  const m = openModal({ title, content: form });
  cancel.addEventListener('click', () => m.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.add('hidden');
    let valid = true;
    const out = {};
    for (const f of fields) {
      const el = inputs[f.key];
      const wrap = el.closest('.field');
      const raw = el.value.trim();
      let msg = '';
      if (f.required && !raw) msg = `${f.label} is required`;
      else if (f.type === 'number' && raw) {
        const n = Number(raw);
        if (!Number.isInteger(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) msg = `Enter a whole number from ${f.min ?? 0} to ${f.max ?? '∞'}`;
      }
      errorEls[f.key].textContent = msg;
      wrap.classList.toggle('invalid', !!msg);
      if (msg) valid = false;
      out[f.key] = f.type === 'number' && raw ? Number(raw) : raw;
    }
    if (!valid) { form.querySelector('.invalid input, .invalid select')?.focus(); return; }
    await busy(submit, async () => {
      try { await onSubmit(out); m.close(true); } catch (err) {
        formError.textContent = err.message;
        formError.classList.remove('hidden');
      }
    });
  });
  return m;
}
