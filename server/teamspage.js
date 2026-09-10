/* What a crawler sees at /teams.

   The rest of this app is one document that decides what to draw once
   JavaScript runs. That is fine for a page nobody links to and wrong for a
   product page: a crawler, a chat preview or a link unfurler reads the markup
   it is served, and what it was served here was an empty div and a script tag.
   So this route arrives with its own head filled in and its own content
   already in the body.

   The block below is a reading of the page, not a copy of it. It carries the
   headings, the prose and the prices — everything a search result or a summary
   is built from — and none of the interaction, because a crawler cannot press
   a button and a person with JavaScript never sees this markup at all: app.js
   replaces the whole of #app on its first render.

   Two sources, one fact. The prices and seat caps come from PLANS in teams.js,
   which is where they are enforced, so a plan cannot be advertised here at a
   price the server would not honour. The prose is duplicated from app.js — no
   build step means no way to share a template between a browser script and
   this module — and srv/teamscopy.mjs fails if the two ever drift apart. */

import { PLANS, TRIAL_DAYS } from './teams.js';

export const TEAMS_URL = 'https://zimpan.com/teams';

export const TEAMS_TITLE = 'Zimpan for Teams: Flat-Price Team Time & Project Tracking.';

export const TEAMS_DESC = 'Your team logs hours against real projects. You see where the time '
  + 'went. Nobody sees anything else.';

/* The h1, split the way the page splits it. Joined with a space wherever the
   whole title is wanted as one string. */
export const TEAMS_H1 = ['Know where your team’s week went.', 'One flat price. Nothing personal.'];

export const TEAMS_LEDE = 'Your team logs hours against real projects. You see where the time '
  + 'went. Nobody sees anything else.';

export const TEAMS_CHECKS = [
  'Project Time Tracking', 'Per-Member Reports',
  'Team Productivity Overview', 'Roles and Access Control'
];

export const TEAMS_FEATURES = [
  ['Time Against Real Projects',
    'Members log to the projects you define, by timer or by hand, so an hour always belongs somewhere.'],
  ['See Where the Week Went',
    'Every member gets their own reading, and every project shows the hours it actually took.'],
  ['Report Cards, Per Person',
    'The same weekly cards the app already writes, scoped to a member or to the whole team.'],
  ['Roles That Mean Something',
    'A super admin owns the team, admins manage people and projects, members log their own time.']
];

export const TEAMS_ROLES = [
  ['Super admin', 'Owns the team and the billing. Grants and removes admin access, and sees the '
    + 'dashboard across every project and every person.'],
  ['Admin', 'Invites members by email and manages their access. Can edit a member’s time, '
    + 'activity and the project it was logged against.'],
  ['Member', 'Logs their own time against the team’s projects, and reads their own report cards. '
    + 'Their personal tracking stays their own.']
];

/* Read off the server's own plan table, so the page cannot advertise a plan
   the server does not sell or a cap it would not enforce. Withdrawn plans are
   left out here even though teams are still on them: this is the shop window,
   not the billing panel. */
export const offeredPlans = () => Object.entries(PLANS)
  .filter(([, p]) => p.offered !== false && p.price)
  .map(([key, p]) => ({ key, label: p.label, nickname: p.nickname, cap: p.cap, price: p.price }));

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Structured data, so a result can carry the price range rather than only the
   title. Product rather than SoftwareApplication: what is on sale here is a
   subscription to a team plan, and the offers are what the page is about. */
function productJsonLd() {
  const plans = offeredPlans();
  const offers = plans.map((p) => ({
    '@type': 'Offer',
    name: p.nickname === p.label ? p.label : `${p.label} (${p.nickname})`,
    price: String(p.price),
    priceCurrency: 'USD',
    url: TEAMS_URL,
    availability: 'https://schema.org/InStock'
  }));
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Zimpan for Teams',
    description: TEAMS_DESC,
    brand: { '@type': 'Brand', name: 'ZIMPAN' },
    url: TEAMS_URL,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: String(Math.min(...plans.map((p) => p.price))),
      highPrice: String(Math.max(...plans.map((p) => p.price))),
      offerCount: String(plans.length),
      offers
    }
  });
}

/* The head, as a single string that replaces the document's own <title>.

   Replaced rather than appended for the reason the blog routes give: two
   titles in one head is a document that different readers read differently,
   and the one that loses is not always the one you meant. */
export function teamsHead() {
  return [
    `<title>${esc(TEAMS_TITLE)}</title>`,
    `<meta name="description" content="${esc(TEAMS_DESC)}">`,
    `<link rel="canonical" href="${TEAMS_URL}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="ZIMPAN">`,
    `<meta property="og:title" content="${esc(TEAMS_TITLE)}">`,
    `<meta property="og:description" content="${esc(TEAMS_DESC)}">`,
    `<meta property="og:url" content="${TEAMS_URL}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(TEAMS_TITLE)}">`,
    `<meta name="twitter:description" content="${esc(TEAMS_DESC)}">`,
    `<script type="application/ld+json">${productJsonLd()}</script>`
  ].join('\n  ');
}

/* The body, as it stands before JavaScript runs.

   Plain elements and no classes: it is thrown away on the first render, so
   styling it would be styling something nobody sees, and a class that later
   meant something else in the stylesheet would be a bug that only ever
   appeared for a few hundred milliseconds. */
export function teamsPrerender() {
  const plans = offeredPlans().map((p) => `
      <li>${esc(p.nickname === p.label ? p.label : `${p.label} — ${p.nickname}`)}: $${esc(p.price)} a month, ${
  p.cap ? `up to ${esc(p.cap)} people` : 'as many people as you like'}</li>`).join('');

  return `
    <h1>${esc(TEAMS_H1.join(' '))}</h1>
    <p>${esc(TEAMS_LEDE)}</p>
    <ul>${TEAMS_CHECKS.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>

    <h2>What a team gets</h2>
    ${TEAMS_FEATURES.map(([title, body]) => `<h3>${esc(title)}</h3><p>${esc(body)}</p>`).join('\n    ')}

    <h2>Who can do what</h2>
    ${TEAMS_ROLES.map(([name, body]) => `<h3>${esc(name)}</h3><p>${esc(body)}</p>`).join('\n    ')}

    <h2>Pricing</h2>
    <p>One price per team, not per seat.</p>
    <ul>${plans}
    </ul>
    <p>Start free for ${esc(TRIAL_DAYS)} days with up to 3 people, then subscribe from inside your
      team. Billed monthly in USD. The personal Zimpan stays free for everyone.</p>`;
}
