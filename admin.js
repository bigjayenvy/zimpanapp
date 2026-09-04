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
  const write = (opts.method || 'GET') !== 'GET';
  /* X-Zimpan-Client is what the server's CSRF guard looks for on every write:
     a cross-origin caller cannot set a custom header without passing a
     preflight, and no origins are allowed. This file never sent it, so every
     write from this dashboard — changing a role, recording a gift, removing
     one — was coming back 403 before it reached its route. */
  const headers = {};
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (write) headers['X-Zimpan-Client'] = '1';

  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: Object.keys(headers).length ? headers : undefined,
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
  /* The blog. `posts` is the list; `editing` is the post open in the editor,
     or null. A new post is `editing` with no id. */
  tickets: null,
  statuses: [],
  ticketBusy: 0,
  ticketMsg: null,
  posts: null,
  editing: null,
  blogMsg: null,
  blogBusy: false,
  rows: [],
  total: 0,
  q: '',
  sort: 'recent',
  page: 0,
  busy: false,
  modal: null,         // { kind: 'role' | 'donation' | 'delete', email }
  msg: null,           // { tone: 'good' | 'bad', text }
  gone: ''             // what the last deletion took, said once above the table
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
              joined ${esc(day(u.created_at))}${Number(u.google) ? ' · Google' : ''}
            </div>
          </td>
          <td>
            ${u.kind === 'work'
              ? `<span class="ad-pill work">work</span>`
              : '<span style="font-size:11px;color:var(--color-neutral-500);">personal</span>'}
            ${u.team_name ? `
            <div class="ad-team">
              <span class="ad-team-name">${esc(u.team_name)}</span>
              <span class="ad-team-role">${esc(u.team_role === 'super' ? 'owner' : u.team_role)}${
                u.team_plan && u.team_plan !== 'trial' ? ` · ${esc(u.team_plan)}` : ' · trial'}</span>
            </div>` : ''}
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
              ${u.role === 'superadmin' ? '' :
                `<button class="ad-mini danger" data-act="delete" data-id="${esc(String(u.id))}" data-email="${esc(u.email)}">Delete</button>`}
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
        ${state.gone ? `<span class="ad-gone">${esc(state.gone)}</span>` : ''}
      </div>

      <div class="ad-scroll">
        <table class="ad-table">
          <thead>
            <tr>
              <th>Account</th><th>Product</th><th>Role</th><th>Last active</th>
              <th class="ad-num">Entries</th><th class="ad-num">Days</th><th class="ad-num">Money</th>
              <th class="ad-num">Donate clicks</th><th class="ad-num">Given</th><th></th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="10" class="ad-empty">${state.q ? 'No account matches that.' : 'No accounts yet.'}</td></tr>`}</tbody>
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
  if (m.kind === 'delete') {
    const u = m.row || {};
    const counts = [
      Number(u.entries) ? `${num(u.entries)} time entries` : '',
      Number(u.money) ? `${num(u.money)} money entries` : '',
      Number(u.donations) ? `${num(u.donations)} recorded gifts` : ''
    ].filter(Boolean);
    return `
      <div class="ad-back" data-backdrop>
        <div class="ad-modal" role="dialog" aria-modal="true">
          <h3>Delete this account</h3>
          <p class="ad-sub">${esc(m.email)}</p>
          <p class="ad-warn">
            This cannot be undone. Everything they logged goes with the account${
              counts.length ? ` — ${esc(counts.join(', '))}` : ''}.${
              u.team_name ? ` They are ${esc(u.team_role === 'super' ? 'the owner' : 'a member')} of <strong>${esc(u.team_name)}</strong>; if that leaves the team empty it goes too.` : ''}
          </p>
          <div class="field">
            <label for="ad-confirm">Type <strong>${esc(m.email)}</strong> to confirm</label>
            <input class="input" id="ad-confirm" type="email" autocomplete="off" spellcheck="false" placeholder="${esc(m.email)}">
          </div>
          ${state.msg ? `<p class="ad-msg ${state.msg.tone}">${esc(state.msg.text)}</p>` : ''}
          <footer>
            <button class="btn btn-ghost" data-act="close-modal">Cancel</button>
            <button class="btn ad-danger" data-act="confirm-delete"${state.busy ? ' disabled' : ''}>${state.busy ? 'Deleting…' : 'Delete for good'}</button>
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

/* ── the blog ──

   A list of what has been written and one editor. The editor is a
   contenteditable div with a toolbar rather than a textarea of HTML, because
   the people writing posts are not going to type tags — and rather than a
   library, because this app has no build step and pulling in a third-party
   editor for six buttons would be the largest dependency in the project.

   execCommand is deprecated and has no replacement that works across browsers
   without reimplementing selection handling from scratch. It is what every
   browser still runs, and the output is sanitised on the server whatever it
   produces, so the worst a browser quirk can do here is produce markup the
   allowlist then throws away. */
const BLOG_TOOLS = [
  ['h2', 'H2', 'Heading'],
  ['h3', 'H3', 'Subheading'],
  ['bold', 'B', 'Bold'],
  ['italic', 'I', 'Italic'],
  ['ul', '• List', 'Bulleted list'],
  ['ol', '1. List', 'Numbered list'],
  ['quote', 'Quote', 'Blockquote'],
  ['link', 'Link', 'Add a link'],
  ['image', 'Image', 'Insert an image by URL'],
  ['clear', 'Clear', 'Strip formatting from the selection']
];

const postWhen = (p) => (p.status === 'published' && p.publishedAt
  ? day(p.publishedAt)
  : `edited ${day(p.updatedAt)}`);

/* ── help requests ──

   Read-only, and that is the design rather than a shortcut. Replying happens
   in the support mailbox, because that is the only place that can see the rest
   of the conversation — a Reply box here would write into a thread this
   dashboard cannot read, and a status column would go stale the moment
   somebody answered an email without coming back to tick it.

   So: what came in, from whom, and what they said. The answering is elsewhere.
   `delivered` is worth showing because a ticket whose email never went is one
   nobody has seen. */
function ticketsBlock() {
  if (!state.tickets) {
    return `<div class="ad-card" style="margin-top: 16px;"><div class="ad-card-head"><h3>Help requests</h3></div>
      <div class="ad-empty">Loading…</div></div>`;
  }
  const options = state.statuses.length ? state.statuses : [['unanswered', 'Unanswered']];
  const rows = state.tickets.map((t) => {
    const status = t.status || 'unanswered';
    return `
    <div class="ad-ticket">
      <div class="ad-ticket-head">
        <span class="ad-ref">${esc(t.ref)}</span>
        <a class="ad-ticket-from" href="mailto:${esc(t.email)}?subject=${encodeURIComponent('Re: [' + t.ref + '] ' + t.subject)}">${esc(t.email)}</a>
        ${t.delivered ? '' : '<span class="ad-pill warm" title="The notification email did not go out">not emailed</span>'}
        <span class="ad-ticket-when">${esc(day(t.createdAt))}</span>
      </div>
      <div class="ad-ticket-subject">${esc(t.subject)}</div>
      <div class="ad-ticket-body">${esc(t.body)}</div>
      <div class="ad-ticket-foot">
        <select class="input ad-status" data-act="ticket-status" data-id="${esc(String(t.id))}"
          data-status="${esc(status)}"${state.ticketBusy === t.id ? ' disabled' : ''}>
          ${options.map(([key, label]) => `
            <option value="${esc(key)}"${status === key ? ' selected' : ''}>${esc(label)}</option>`).join('')}
        </select>
        <!-- Who last moved it and when. A status is a claim about work
             happening in a mailbox this page cannot see, so the only honest
             thing it can add is how old the claim is. -->
        ${t.statusAt ? `<span class="ad-ticket-stamp">${esc(ago(t.statusAt))}${
          t.statusBy ? ` by ${esc(t.statusBy)}` : ''}</span>` : ''}
        ${state.ticketMsg && state.ticketMsg.id === t.id
          ? `<span class="ad-ticket-stamp ${state.ticketMsg.tone === 'bad' ? 'bad' : 'good'}">${esc(state.ticketMsg.text)}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
    <div class="ad-card" style="margin-top: 16px;">
      <div class="ad-card-head">
        <h3>Help requests</h3>
        <span class="ad-sub" style="margin:0;">Reply by email — the address is a link</span>
      </div>
      ${rows || '<div class="ad-empty">Nobody has asked for help yet.</div>'}
    </div>`;
}

function blogBlock() {
  if (!state.posts) {
    return `<div class="ad-card" style="margin-top: 16px;"><div class="ad-card-head"><h3>Blog</h3></div>
      <div class="ad-empty">Loading the posts…</div></div>`;
  }
  const rows = state.posts.length ? state.posts.map((p) => `
    <tr>
      <td>
        <div class="ad-name">${esc(p.title)}</div>
        <div class="ad-sub">/blogs/${esc(p.slug)}</div>
      </td>
      <td><span class="ad-pill ${p.status === 'published' ? 'live' : ''}">${esc(p.status)}</span></td>
      <td class="ad-num">${esc(postWhen(p))}</td>
      <td class="ad-right">
        ${p.status === 'published' && Number(p.publishedAt) && Number(p.publishedAt) <= Date.now()
          ? `<a class="ad-mini" href="/blogs/${esc(p.slug)}" target="_blank" rel="noopener">View</a>` : ''}
        <button class="ad-mini" data-act="post-edit" data-id="${esc(String(p.id))}">Edit</button>
        <button class="ad-mini danger" data-act="post-delete" data-id="${esc(String(p.id))}" data-title="${esc(p.title)}">Delete</button>
      </td>
    </tr>`).join('') : '';

  return `
    <div class="ad-card" style="margin-top: 16px;">
      <div class="ad-card-head">
        <h3>Blog</h3>
        <button class="btn btn-primary" data-act="post-new" style="font-size:13px;">Write a post</button>
      </div>
      ${state.blogMsg ? `<p class="ad-msg ${state.blogMsg.tone === 'bad' ? 'bad' : 'good'}">${esc(state.blogMsg.text)}</p>` : ''}
      ${rows
        ? `<table class="ad-table"><thead><tr>
             <th>Post</th><th>Status</th><th>When</th><th class="ad-right">…</th>
           </tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="ad-empty">Nothing written yet.</div>'}
    </div>`;
}

function editorBlock() {
  const e = state.editing;
  if (!e) return '';
  return `
  <div class="ad-back" data-post-backdrop>
    <div class="ad-modal ad-editor" role="dialog" aria-modal="true" aria-label="Write a post">
      <h3>${e.id ? 'Edit post' : 'Write a post'}</h3>

      <label class="ad-field">
        <span>Title</span>
        <input class="input" id="post-title" value="${esc(e.title || '')}" placeholder="What is it called?" autocomplete="off">
      </label>

      <label class="ad-field">
        <span>Address <small>zimpan.com/blogs/…</small></span>
        <input class="input" id="post-slug" value="${esc(e.slug || '')}" placeholder="left blank, made from the title" autocomplete="off">
      </label>

      <label class="ad-field">
        <span>Summary <small>shown on the index and in link previews</small></span>
        <textarea class="input" id="post-excerpt" rows="2" placeholder="Left blank, taken from the opening.">${esc(e.excerpt || '')}</textarea>
      </label>

      <label class="ad-field">
        <span>Cover image URL <small>optional</small></span>
        <input class="input" id="post-cover" value="${esc(e.cover || '')}" placeholder="https://…" autocomplete="off">
      </label>

      <!-- Search and link previews. Grouped and after the post itself, because
           they are written once the piece exists and are a different job from
           writing it. Each says what fills in when it is left blank, so the
           blank is a decision rather than an omission. -->
      <details class="ad-meta"${(e.metaTitle || e.metaDesc || e.metaWords) ? ' open' : ''}>
        <summary>Search engine listing</summary>

        <label class="ad-field">
          <span>Meta title <small>blank uses the post title</small></span>
          <input class="input" id="post-meta-title" value="${esc(e.metaTitle || '')}"
            maxlength="200" placeholder="What Google shows as the headline" autocomplete="off">
        </label>

        <label class="ad-field">
          <span>Meta description <small>blank uses the summary above</small></span>
          <textarea class="input" id="post-meta-desc" rows="2" maxlength="400"
            placeholder="The couple of lines under the headline in a search result.">${esc(e.metaDesc || '')}</textarea>
        </label>

        <label class="ad-field">
          <span>Meta keywords <small>comma separated</small></span>
          <input class="input" id="post-meta-words" value="${esc(e.metaWords || '')}"
            maxlength="400" placeholder="time tracking, productivity, habits" autocomplete="off">
        </label>
      </details>

      <div class="ad-field">
        <span>Body</span>
        <div class="ad-tools">
          ${BLOG_TOOLS.map(([key, label, title]) => `
            <button type="button" class="ad-tool" data-act="post-fmt" data-fmt="${key}" title="${esc(title)}">${esc(label)}</button>`).join('')}
        </div>
        <!-- The editor's own markup is set once, when it is mounted, and never
             through this template again: rebuilding it on every render would
             throw away the caret mid-sentence. See mountEditor(). -->
        <div class="ad-rich" id="post-body" contenteditable="true" spellcheck="true"></div>
      </div>

      <label class="ad-check">
        <input type="checkbox" id="post-live"${e.status === 'published' ? ' checked' : ''}>
        <span>Published <small>unticked keeps it a draft, visible only here</small></span>
      </label>

      ${state.blogMsg && state.blogMsg.where === 'editor'
        ? `<p class="ad-msg ${state.blogMsg.tone === 'bad' ? 'bad' : 'good'}">${esc(state.blogMsg.text)}</p>` : ''}

      <div class="ad-modal-acts">
        <button class="btn btn-secondary" data-act="post-cancel">Cancel</button>
        <button class="btn btn-primary" data-act="post-save"${state.blogBusy ? ' disabled' : ''}>${
          state.blogBusy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  </div>`;
}

/* The editor's content, across a render.

   render() replaces the whole tree, so the contenteditable an admin is typing
   into is destroyed and rebuilt every time anything on this page changes —
   including a background loadPosts() finishing. Mounting the body only on the
   node's "first" appearance does not survive that: the node is always new, and
   the second render would leave a fresh empty box where the draft was.

   So the content is read out of the DOM just before it is thrown away and
   written back into whatever replaces it. Nothing triggers a render while
   someone is typing — no keystroke handler, and the toolbar drives the
   selection directly — so this runs on the rare renders that come from
   somewhere else, and the cost of one of those is the caret going back to the
   start rather than the draft going missing. */
function captureEditor() {
  const node = document.getElementById('post-body');
  if (node && state.editing) state.editing.body = node.innerHTML;
}

function mountEditor() {
  const node = document.getElementById('post-body');
  if (!node || !state.editing) return;
  const want = state.editing.body || '';
  // Compared first so an identical write cannot move the caret for nothing.
  if (node.innerHTML !== want) node.innerHTML = want;
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
  // Before innerHTML throws the node away. See captureEditor().
  captureEditor();

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
      ${ticketsBlock()}
      ${blogBlock()}
    </div>
    ${modalBlock()}
    ${editorBlock()}`;

  window.scrollTo(0, scroll);
  const q = document.getElementById('ad-q');
  if (q && state.focusSearch) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); state.focusSearch = false; }
  // The select cannot carry its value through innerHTML on its own.
  const role = document.getElementById('ad-role');
  if (role && state.modal && state.modal.role) role.value = state.modal.role;
  mountEditor();
}

/* ── loading ── */

async function loadTickets() {
  try {
    const res = await api('/api/admin/support');
    state.tickets = res.tickets || [];
    // Sent by the server so the two lists cannot drift apart.
    state.statuses = res.statuses || [];
  } catch (err) {
    state.tickets = [];
  }
  render();
}

async function loadPosts() {
  try {
    const res = await api('/api/admin/blog');
    state.posts = res.posts || [];
  } catch (err) {
    state.posts = [];
    state.blogMsg = { tone: 'bad', text: err.message };
  }
  render();
}

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
  await loadTickets();
  await loadPosts();
}

/* ── actions ── */

const ACTIONS = {
  more: () => { state.page += 1; loadUsers(true); },

  /* ── the blog ── */
  'post-new': () => {
    state.editing = { title: '', slug: '', excerpt: '', cover: '', body: '', status: 'draft',
      metaTitle: '', metaDesc: '', metaWords: '' };
    state.blogMsg = null;
    render();
  },

  'post-edit': async (el) => {
    state.blogMsg = null;
    try {
      const post = await api(`/api/admin/blog/${encodeURIComponent(el.dataset.id)}`);
      state.editing = post;
      render();
    } catch (err) {
      state.blogMsg = { tone: 'bad', text: err.message };
      render();
    }
  },

  'post-cancel': () => { state.editing = null; state.blogMsg = null; render(); },
  'post-close': () => { state.editing = null; state.blogMsg = null; render(); },

  /* The toolbar. document.execCommand is deprecated and is still the only
     thing every browser implements; whatever it emits is sanitised on the
     server, so a quirk here can only produce markup the allowlist drops. */
  'post-fmt': (el) => {
    const node = document.getElementById('post-body');
    if (!node) return;
    node.focus();
    const cmd = el.dataset.fmt;
    const run = (name, value) => { try { document.execCommand(name, false, value); } catch (e) { /* nothing to do */ } };
    if (cmd === 'h2' || cmd === 'h3') run('formatBlock', `<${cmd}>`);
    else if (cmd === 'quote') run('formatBlock', '<blockquote>');
    else if (cmd === 'ul') run('insertUnorderedList');
    else if (cmd === 'ol') run('insertOrderedList');
    else if (cmd === 'bold') run('bold');
    else if (cmd === 'italic') run('italic');
    else if (cmd === 'clear') { run('removeFormat'); run('formatBlock', '<p>'); }
    else if (cmd === 'link') {
      const url = prompt('Link to where?', 'https://');
      if (url) run('createLink', url);
    } else if (cmd === 'image') {
      const url = prompt('Image URL', 'https://');
      if (url) run('insertImage', url);
    }
  },

  'post-save': async () => {
    if (state.blogBusy) return;
    const body = document.getElementById('post-body');
    /* Read before the busy render replaces the fields, the same as every other
       write in this file. */
    const patch = {
      title: (document.getElementById('post-title') || {}).value || '',
      slug: (document.getElementById('post-slug') || {}).value || '',
      excerpt: (document.getElementById('post-excerpt') || {}).value || '',
      cover: (document.getElementById('post-cover') || {}).value || '',
      metaTitle: (document.getElementById('post-meta-title') || {}).value || '',
      metaDesc: (document.getElementById('post-meta-desc') || {}).value || '',
      metaWords: (document.getElementById('post-meta-words') || {}).value || '',
      body: body ? body.innerHTML : '',
      status: (document.getElementById('post-live') || {}).checked ? 'published' : 'draft'
    };
    const id = state.editing && state.editing.id;
    state.blogBusy = true;
    state.blogMsg = null;
    render();
    try {
      const saved = id
        ? await api(`/api/admin/blog/${encodeURIComponent(id)}`, { method: 'PUT', body: patch })
        : await api('/api/admin/blog', { method: 'POST', body: patch });
      state.blogBusy = false;
      state.editing = null;
      state.blogMsg = { tone: 'good', text: `Saved · ${saved.status === 'published' ? 'live at' : 'draft at'} /blogs/${saved.slug}` };
      await loadPosts();
    } catch (err) {
      state.blogBusy = false;
      state.blogMsg = { tone: 'bad', text: err.message, where: 'editor' };
      render();
    }
  },

  'post-delete': async (el) => {
    if (!window.confirm(`Delete "${el.dataset.title}"? This cannot be undone.`)) return;
    try {
      await api(`/api/admin/blog/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' });
      state.blogMsg = { tone: 'good', text: 'Post deleted.' };
      await loadPosts();
    } catch (err) {
      state.blogMsg = { tone: 'bad', text: err.message };
      render();
    }
  },

  role: (el) => {
    state.gone = '';
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

  delete: (el) => {
    const row = state.rows.find((u) => String(u.id) === String(el.dataset.id));
    state.modal = { kind: 'delete', id: el.dataset.id, email: el.dataset.email, row: row || null };
    state.msg = null;
    render();
  },

  'confirm-delete': async () => {
    /* Read before the busy render replaces the field, the same as the other
       two dialogs. The typed address goes to the server, which checks it
       against the account the id names — this side matching it would only be
       checking its own homework. */
    const typed = ((document.getElementById('ad-confirm') || {}).value || '').trim();
    const { id, email } = state.modal;
    state.busy = true; state.msg = null; render();
    try {
      const out = await api(`/api/admin/users/${encodeURIComponent(id)}`, {
        method: 'DELETE', body: { email: typed }
      });
      state.modal = null;
      state.msg = null;
      state.gone = `${out.email} is gone${out.teamRemoved ? ', and their empty team with it' : ''}.`;
      /* Both reloaded rather than the row spliced out: the totals at the top
         counted that account, and a team may have gone with it. */
      try {
        const fresh = await api('/api/admin/overview');
        state.overview = fresh.overview;
      } catch (e) { /* the table below is still worth showing */ }
      await loadUsers(false);
    } catch (err) {
      state.msg = { tone: 'bad', text: err.message };
    } finally {
      state.busy = false;
      render();
    }
  },

  'close-modal': () => { state.modal = null; state.msg = null; state.gone = ''; render(); },

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

  // The editor's own backdrop, on the same rule: only when it is itself the
  // thing clicked, or every field inside it would close the dialog.
  const post = ev.target.closest('[data-post-backdrop]');
  if (post && ev.target === post) { ev.preventDefault(); ACTIONS['post-close'](); return; }

  const el = ev.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { ev.preventDefault(); fn(el); }
});

/* The toolbar must not take the caret.

   A click moves focus, and moving focus out of a contenteditable collapses the
   selection — so by the time the click handler runs there is nothing selected
   to make bold. Cancelling the mousedown stops the focus moving at all, which
   leaves the selection exactly where the writer put it. */
root.addEventListener('mousedown', (ev) => {
  const tool = ev.target.closest('[data-act="post-fmt"]');
  if (tool) ev.preventDefault();
});

root.addEventListener('change', async (ev) => {
  if (ev.target.dataset.act === 'ticket-status') {
    const el = ev.target;
    const id = Number(el.dataset.id);
    const was = el.dataset.status;
    const want = el.value;
    if (want === was) return;
    state.ticketBusy = id;
    state.ticketMsg = null;
    render();
    try {
      const out = await api(`/api/admin/support/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: want } });
      /* Patched in place rather than re-fetching the list: the row is the only
         thing that changed, and a reload would scroll a long list back to the
         top under whoever just used it. */
      state.tickets = state.tickets.map((t) => (t.id === id
        ? Object.assign({}, t, { status: out.status, statusAt: out.statusAt, statusBy: out.statusBy })
        : t));
      state.ticketMsg = { id, tone: 'good', text: 'Saved' };
    } catch (err) {
      state.ticketMsg = { id, tone: 'bad', text: err.message };
    }
    state.ticketBusy = 0;
    render();
    return;
  }
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
