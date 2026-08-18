/* ZIMPAN — the admin dashboard.

   A second, much smaller app. It shares the design system and nothing else:
   no sync, no local storage, no offline story. Everything on screen came from
   the server this page load, because there is nothing here worth keeping on an
   admin's laptop.

   Same render model as the main app — one function builds the whole page into a
   string and hands it to innerHTML — because at this size a diffing library
   would be more code than the thing it renders. The one place that matters is
   the search box, which is patched rather than re-rendered so typing is never
   interrupted.

   What it can show is decided on the server. Every route behind it returns
   counts, dates and email addresses; none of them return anything a user wrote.
   That is a property of the queries, not of this file, so nothing here can
   accidentally reveal more than it should. */

const root = document.getElementById('admin');

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin'
  });
  let data = {};
  try { data = await res.json(); } catch (err) { /* an empty body is fine */ }
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status}).`);
    error.status = res.status;
    throw error;
  }
  return data;
}

const state = {
  booted: false,
  me: null,            // { email, role } once signed in as an admin
  denied: false,       // signed in, but not an admin
  overview: null,
  rows: [],
  total: 0,
  q: '',
  sort: 'recent',
  page: 0,
  busy: false,
  modal: null,         // { kind: 'role' | 'donation', email }
  msg: null            // { tone: 'good' | 'bad', text }
};

const PAGE = 50;
const may = () => state.me && state.me.role === 'superadmin';

/* ── formatting ── */

const nf = new Intl.NumberFormat('en-US');
const num = (n) => nf.format(Number(n) || 0);

const money = (n, currency) => `${currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₱'}${
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const day = (ms) => (ms
  ? new Date(Number(ms)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

/* "3 days ago" rather than a date, because the question this column answers is
   how long it has been, and a date makes the reader do the subtraction. */
function ago(ms) {
  if (!ms) return 'never';
  const s = Math.max(0, Date.now() - Number(ms)) / 1000;
  if (s < 90) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 36) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 45) return `${Math.round(d)}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

// Active, cooling, gone — the three states worth telling apart at a glance.
function warmth(lastSeen) {
  if (!lastSeen) return ['off', 'never synced'];
  const d = (Date.now() - Number(lastSeen)) / 86400000;
  if (d <= 7) return ['on', ago(lastSeen)];
  if (d <= 30) return ['warm', ago(lastSeen)];
  return ['off', ago(lastSeen)];
}

const monthLabel = (m) => {
  const [y, mo] = String(m).split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: 'short' });
};

/* ── charts ──

   Deliberately plain bars rather than a library. There are two of them, they
   are read at a glance, and a chart you can write in twenty lines is a chart
   nobody has to keep up to date. */
function bars(rows, o) {
  if (!rows || !rows.length) return `<div class="ad-empty">${esc(o.empty)}</div>`;
  const max = Math.max(...rows.map((r) => Number(o.value(r)) || 0), 1);
  const cols = rows.map((r) => {
    const v = Number(o.value(r)) || 0;
    const h = v > 0 ? Math.max(3, Math.round((v / max) * 100)) : 0;
    return `
        <div class="ad-col${o.money ? ' is-money' : ''}" title="${esc(o.title(r))}">
          ${h ? `<i style="height: ${h}%;"><b>${esc(o.label(r))}</b></i>` : ''}
        </div>`;
  }).join('');
  return `
      <div class="ad-bars">${cols}</div>
      <div class="ad-axis">
        <span>${esc(o.axis(rows[0]))}</span>
        <span>${esc(o.axis(rows[rows.length - 1]))}</span>
      </div>`;
}

/* ── the page ── */

function tile(value, label, foot, lead) {
  return `
      <div class="ad-tile${lead ? ' is-lead' : ''}">
        <b>${esc(value)}</b>
        <span>${esc(label)}</span>
        ${foot ? `<em>${esc(foot)}</em>` : ''}
      </div>`;
}

function overviewBlock(o) {
  const t = o.totals || {};
  const active = Number(t.active_week) || 0;
  const users = Number(t.users) || 0;
  const share = users ? Math.round((active / users) * 100) : 0;

  return `
      <div class="ad-tiles">
        ${tile(num(t.users), 'Accounts', `${num(t.new_month)} joined in the last 30 days`, true)}
        ${tile(num(t.active_week), 'Active this week', `${share}% of everyone · ${num(t.active_month)} this month`)}
        ${tile(num(t.donors), 'People who gave', `${num(t.donations)} gifts · ${money(t.donated, 'PHP')} in total`)}
        ${tile(num(t.clickers), 'Opened the donate link', 'Interest, not money — counted separately')}
        ${tile(num(t.entries), 'Time entries logged', `${num(t.money)} money entries`)}
        ${tile(num(t.never_synced), 'Signed up, never synced', `${num(t.google)} accounts use Google`)}
      </div>

      <div class="ad-grid" style="margin-top: 16px;">
        <div class="ad-card">
          <h3>Who joined, month by month</h3>
          <p class="ad-sub">New accounts by the month they were created.</p>
          ${bars(o.signups, {
            value: (r) => r.n, label: (r) => num(r.n),
            title: (r) => `${r.m} · ${num(r.n)} new`,
            axis: (r) => monthLabel(r.m),
            empty: 'No accounts yet.'
          })}
        </div>

        <div class="ad-card">
          <h3>Who was logging, day by day</h3>
          <p class="ad-sub">Distinct accounts that wrote something, over the last 30 days. Stronger than "opened the app" — it means something was actually recorded.</p>
          ${bars(o.active, {
            value: (r) => r.n, label: (r) => num(r.n),
            title: (r) => `${r.d} · ${num(r.n)} logging`,
            axis: (r) => new Date(r.d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
            empty: 'Nothing logged in the last 30 days.'
          })}
        </div>

        <div class="ad-card">
          <h3>What came in</h3>
          <p class="ad-sub">Donations by month, as recorded here. Entered by hand from the payment statement — the donate link reports nothing back.</p>
          ${bars(o.donations, {
            money: true,
            value: (r) => r.total, label: (r) => money(r.total, 'PHP'),
            title: (r) => `${r.m} · ${money(r.total, 'PHP')} across ${num(r.n)}`,
            axis: (r) => monthLabel(r.m),
            empty: 'No donations recorded yet.'
          })}
        </div>

      </div>

      <!-- Its own row rather than a fourth column: three charts fill the grid at
           any width worth having, and a table wedged into the leftover third
           breaks every email address across two lines. -->
      <div class="ad-card" style="margin-top: 16px;">
        <h3>Most recent gifts</h3>
        <p class="ad-sub">The last ten recorded, newest first.</p>
        ${(o.recent && o.recent.length) ? `
        <div class="ad-scroll" style="border: 0; background: transparent;">
          <table class="ad-table ad-gifts" style="min-width: 0;">
            <tbody>
              ${o.recent.map((d) => `
              <tr>
                <td class="ad-mail">${esc(d.email)}</td>
                <td style="color: var(--color-neutral-600); white-space: nowrap;">${esc(day(d.received_at))}</td>
                <td style="color: var(--color-neutral-600);">${esc(d.note || '')}</td>
                <td class="ad-num"><span class="ad-pill on">${esc(money(d.amount, d.currency))}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<div class="ad-empty">Nothing recorded yet. Use <b>Add gift</b> on a row below to record one from your payment statement.</div>'}
      </div>`;
}

const SORTS = [
  ['recent', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['active', 'Most recently active'],
  ['quiet', 'Quietest first'],
  ['entries', 'Most entries'],
  ['donated', 'Most donated'],
  ['email', 'Email A–Z']
];

function usersBlock() {
  const rows = state.rows.map((u) => {
    const [tone, when] = warmth(u.last_seen_at);
    const donated = Number(u.donated) || 0;
    return `
        <tr>
          <td>
            <div class="ad-mail">${esc(u.email)}</div>
            <div style="font-size: 11px; color: var(--color-neutral-600); margin-top: 2px;">
              joined ${esc(day(u.created_at))}${Number(u.google) ? ' · Google' : ''}${u.role !== 'user' ? '' : ''}
            </div>
          </td>
          <td>${u.role === 'user' ? '' : `<span class="ad-pill role">${esc(u.role)}</span>`}</td>
          <td><span class="ad-pill ${tone}">${esc(when)}</span></td>
          <td class="ad-num">${num(u.entries)}</td>
          <td class="ad-num">${num(u.days)}</td>
          <td class="ad-num">${num(u.money)}</td>
          <td class="ad-num">${Number(u.donate_clicks) ? num(u.donate_clicks) : '—'}</td>
          <td class="ad-num">${donated > 0
            ? `<span class="ad-pill on">${esc(money(donated, 'PHP'))}</span>`
            : '<span style="color: var(--color-neutral-500);">—</span>'}</td>
          <td>
            ${may() ? `
            <div class="ad-actions">
              <button class="ad-mini" data-act="role" data-email="${esc(u.email)}">Role</button>
              <button class="ad-mini" data-act="donation" data-email="${esc(u.email)}">Add gift</button>
            </div>` : '<span style="font-size: 11px; color: var(--color-neutral-500);">view only</span>'}
          </td>
        </tr>`;
  }).join('');

  const shown = state.rows.length;
  return `
      <h2 class="ad-h">Everyone who has signed up</h2>
      <div class="ad-tools">
        <input class="input" id="ad-q" type="search" placeholder="Search by email…" value="${esc(state.q)}" autocomplete="off">
        <select class="input" data-act="sort">
          ${SORTS.map(([k, l]) => `<option value="${k}"${k === state.sort ? ' selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
        <span class="ad-count">${shown ? `showing ${num(shown)} of ${num(state.total)}` : ''}</span>
      </div>

      <div class="ad-scroll">
        <table class="ad-table">
          <thead>
            <tr>
              <th>Account</th><th>Role</th><th>Last active</th>
              <th class="ad-num">Entries</th><th class="ad-num">Days</th><th class="ad-num">Money</th>
              <th class="ad-num">Donate clicks</th><th class="ad-num">Given</th><th></th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="9" class="ad-empty">${state.q ? 'No account matches that.' : 'No accounts yet.'}</td></tr>`}</tbody>
        </table>
      </div>

      ${shown < state.total ? `
      <div class="ad-more"><button class="btn btn-secondary" data-act="more"${state.busy ? ' disabled' : ''}>
        ${state.busy ? 'Loading…' : `Show ${num(Math.min(PAGE, state.total - shown))} more`}
      </button></div>` : ''}

      <p class="ad-note">
        Counts and dates only. This dashboard cannot show what anyone wrote — no activities, notes,
        categories or amounts are sent to it, whatever your role.
      </p>`;
}

function modalBlock() {
  if (!state.modal) return '';
  const m = state.modal;
  if (m.kind === 'role') {
    return `
      <div class="ad-back" data-backdrop>
        <div class="ad-modal" role="dialog" aria-modal="true">
          <h3>Change role</h3>
          <p class="ad-sub">${esc(m.email)}</p>
          <div class="field">
            <label for="ad-role">Role</label>
            <select class="input" id="ad-role">
              <option value="user">User — no dashboard access</option>
              <option value="manager">Manager — can view, cannot change</option>
              <option value="superadmin">Superadmin — can view and change</option>
            </select>
          </div>
          ${state.msg ? `<p class="ad-msg ${state.msg.tone}">${esc(state.msg.text)}</p>` : ''}
          <footer>
            <button class="btn btn-ghost" data-act="close-modal">Cancel</button>
            <button class="btn btn-primary" data-act="save-role"${state.busy ? ' disabled' : ''}>${state.busy ? 'Saving…' : 'Save role'}</button>
          </footer>
        </div>
      </div>`;
  }
  const today = new Date().toISOString().slice(0, 10);
  return `
      <div class="ad-back" data-backdrop>
        <div class="ad-modal" role="dialog" aria-modal="true">
          <h3>Record a gift</h3>
          <p class="ad-sub">${esc(m.email)} — from your payment statement.</p>
          <div class="ad-row">
            <div class="field">
              <label for="ad-amount">Amount</label>
              <input class="input" id="ad-amount" type="number" min="0" step="0.01" placeholder="0.00">
            </div>
            <div class="field" style="flex: 0 0 110px;">
              <label for="ad-currency">Currency</label>
              <select class="input" id="ad-currency">
                <option value="PHP">PHP</option><option value="USD">USD</option><option value="EUR">EUR</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label for="ad-date">Received on</label>
            <input class="input" id="ad-date" type="date" value="${today}" max="${today}">
          </div>
          <div class="field">
            <label for="ad-note">Note <span style="color: var(--color-neutral-600); font-weight: 400;">(optional)</span></label>
            <input class="input" id="ad-note" type="text" maxlength="255" placeholder="PayPal reference, say">
          </div>
          ${state.msg ? `<p class="ad-msg ${state.msg.tone}">${esc(state.msg.text)}</p>` : ''}
          <footer>
            <button class="btn btn-ghost" data-act="close-modal">Cancel</button>
            <button class="btn btn-primary" data-act="save-donation"${state.busy ? ' disabled' : ''}>${state.busy ? 'Saving…' : 'Record it'}</button>
          </footer>
        </div>
      </div>`;
}

function gate(title, body, cta) {
  return `
    <div class="ad-shell">
      <div class="ad-gate">
        <div class="ad-mark" style="justify-content: center; margin-bottom: 18px;">
          <i>Z</i><span>ZIMPAN<small>Admin</small></span>
        </div>
        <h1>${esc(title)}</h1>
        <p>${body}</p>
        ${cta}
      </div>
    </div>`;
}

function render() {
  const scroll = window.scrollY;

  if (!state.booted) {
    root.innerHTML = `<div class="ad-shell"><p class="ad-note" style="padding-top: 40px;">Loading…</p></div>`;
    return;
  }

  if (!state.me) {
    root.innerHTML = state.denied
      ? gate('Not your door',
          'You are signed in, but this account has no dashboard role. If that is wrong, ask a superadmin to grant you one.',
          '<a class="btn btn-secondary" href="/">Back to ZIMPAN</a>')
      : gate('Admin sign-in',
          'Sign in on the main site with an admin account, then come back here. The dashboard uses the same login as everything else.',
          '<a class="btn btn-primary" href="/?signin=1">Go to sign-in</a>');
    return;
  }

  const o = state.overview;
  root.innerHTML = `
    <div class="ad-shell">
      <div class="ad-bar">
        <div class="ad-mark"><i>Z</i><span>ZIMPAN<small>Admin</small></span></div>
        <span class="ad-role" data-role="${esc(state.me.role)}">${esc(state.me.role)}</span>
        <div class="ad-who">
          <span>${esc(state.me.email)}</span>
          <a class="btn btn-ghost" href="/">Back to the app</a>
        </div>
      </div>

      ${o ? overviewBlock(o) : '<div class="ad-empty">Loading the numbers…</div>'}
      ${usersBlock()}
    </div>
    ${modalBlock()}`;

  window.scrollTo(0, scroll);
  const q = document.getElementById('ad-q');
  if (q && state.focusSearch) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); state.focusSearch = false; }
  // The select cannot carry its value through innerHTML on its own.
  const role = document.getElementById('ad-role');
  if (role && state.modal && state.modal.role) role.value = state.modal.role;
}

/* ── loading ── */

async function loadUsers(append) {
  state.busy = true;
  if (append) render();
  try {
    const res = await api(`/api/admin/users?q=${encodeURIComponent(state.q)}&sort=${encodeURIComponent(state.sort)}&limit=${PAGE}&offset=${state.page * PAGE}`);
    state.rows = append ? state.rows.concat(res.rows) : res.rows;
    state.total = res.total;
  } catch (err) {
    state.msg = { tone: 'bad', text: err.message };
  } finally {
    state.busy = false;
    render();
  }
}

async function boot() {
  try {
    const me = await api('/api/me');
    const role = me.user && me.user.role;
    if (role === 'manager' || role === 'superadmin') {
      state.me = { email: me.user.email, role };
    } else {
      state.denied = true;
    }
  } catch (err) {
    // 401 means "not signed in"; anything else is a server that cannot answer,
    // and either way the only useful next step is the sign-in page.
    state.denied = false;
  }
  state.booted = true;
  render();
  if (!state.me) return;

  try {
    const res = await api('/api/admin/overview');
    state.overview = res.overview;
  } catch (err) { /* the table below is still worth showing */ }
  render();
  await loadUsers(false);
}

/* ── actions ── */

const ACTIONS = {
  more: () => { state.page += 1; loadUsers(true); },

  role: (el) => {
    const row = state.rows.find((u) => u.email === el.dataset.email);
    state.modal = { kind: 'role', email: el.dataset.email, role: row ? row.role : 'user' };
    state.msg = null;
    render();
  },

  donation: (el) => {
    state.modal = { kind: 'donation', email: el.dataset.email };
    state.msg = null;
    render();
  },

  'close-modal': () => { state.modal = null; state.msg = null; render(); },

  'save-role': async () => {
    // Read before the busy render, for the same reason as the gift dialog.
    const role = (document.getElementById('ad-role') || {}).value;
    const email = state.modal.email;
    state.busy = true; state.msg = null; render();
    try {
      await api('/api/admin/role', { method: 'POST', body: { email, role } });
      state.modal = null;
      state.msg = null;
      await loadUsers(false);
    } catch (err) {
      state.msg = { tone: 'bad', text: err.message };
    } finally {
      state.busy = false;
      render();
    }
  },

  'save-donation': async () => {
    const val = (id) => (document.getElementById(id) || {}).value;
    /* Every field is read before anything re-renders. The busy render below
       rebuilds this dialog from scratch, so a field read after it comes back
       empty — which is how the note and the currency were being dropped. */
    const amount = Number(val('ad-amount'));
    const currency = val('ad-currency') || 'PHP';
    const note = val('ad-note') || '';
    const date = String(val('ad-date') || '');

    if (!Number.isFinite(amount) || amount <= 0) {
      state.msg = { tone: 'bad', text: 'Enter an amount greater than zero.' };
      render();
      return;
    }
    /* Parsed as local midday rather than midnight UTC: a date input gives a
       bare 'YYYY-MM-DD', and midnight UTC lands on the day before across most
       of the Americas. Midday is safe in every timezone. */
    const [y, m, d] = date.split('-').map(Number);
    const receivedAt = y ? new Date(y, m - 1, d, 12, 0, 0).getTime() : Date.now();

    state.busy = true; state.msg = null; render();
    try {
      await api('/api/admin/donations', {
        method: 'POST',
        body: { email: state.modal.email, amount, currency, receivedAt, note }
      });
      state.modal = null;
      const res = await api('/api/admin/overview');
      state.overview = res.overview;
      await loadUsers(false);
    } catch (err) {
      state.msg = { tone: 'bad', text: err.message };
    } finally {
      state.busy = false;
      render();
    }
  }
};

root.addEventListener('click', (ev) => {
  /* The backdrop wraps the dialog, so it must not be a `data-act` at all.
     As one, it was the nearest acting ancestor of every field inside the
     dialog — clicking the amount box walked up, found the backdrop's
     close-modal, and shut the thing you were trying to type into. Its own
     attribute, matched only when it is itself the thing clicked. */
  const back = ev.target.closest('[data-backdrop]');
  if (back && ev.target === back) { ev.preventDefault(); ACTIONS['close-modal'](); return; }

  const el = ev.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { ev.preventDefault(); fn(el); }
});

root.addEventListener('change', (ev) => {
  if (ev.target.dataset.act !== 'sort') return;
  state.sort = ev.target.value;
  state.page = 0;
  loadUsers(false);
});

/* Debounced, and the caret is put back afterwards: the table is rebuilt on
   every search, and rebuilding the input under someone's fingers would make it
   unusable. */
let searchTimer = null;
root.addEventListener('input', (ev) => {
  if (ev.target.id !== 'ad-q') return;
  state.q = ev.target.value;
  state.page = 0;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.focusSearch = true; loadUsers(false); }, 250);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && state.modal) { ACTIONS['close-modal'](); }
});

boot();
