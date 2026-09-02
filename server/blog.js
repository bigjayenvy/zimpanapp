/* ZIMPAN — the blog.

   Posts written in the admin dashboard, read by anyone. Two audiences and two
   sets of rules, so the split runs through the whole file: the public reads
   published posts and nothing else, and everything that writes goes through
   requireAdmin first.

   The interesting problem here is not the CRUD. It is that this is the only
   place in the app where one person's HTML is rendered into another person's
   browser. Every other string the server stores is escaped at the point it is
   drawn; a blog post cannot be, because the formatting is the point. So the
   HTML is sanitised on the way IN, against an allowlist, and what comes out of
   the sanitiser is what gets stored. See clean() below for what survives it. */

import { query, one, now } from './db.js';

export class BlogError extends Error {
  constructor(message, status) { super(message); this.status = status || 400; }
}

/* ── the sanitiser ──

   An allowlist, not a blocklist. A blocklist of dangerous tags is a list of the
   attacks somebody has already thought of; this is a list of the formatting a
   post is allowed to contain, and everything else — every tag, every attribute,
   every URL scheme — is dropped whether or not I have heard of it.

   It runs on the server rather than in the editor because the editor is a text
   field an admin can paste into and a request an admin can forge. A sanitiser
   that only runs in the browser is a formatting convenience, not a defence.

   Deliberately absent: <script> and <style> obviously, but also <iframe>,
   <object>, <form>, <input> and <link>. An embedded video is worth having and
   is not worth an arbitrary third-party frame on the same origin as everyone's
   session cookie. */
const ALLOWED = {
  p: [], br: [], strong: [], em: [], u: [], s: [], blockquote: [], code: [], pre: [],
  h2: [], h3: [], h4: [], ul: [], ol: [], li: [], hr: [],
  a: ['href', 'title'],
  img: ['src', 'alt', 'title'],
  figure: [], figcaption: []
};

/* Only these can appear in an href or a src. javascript: is the obvious one;
   data: is the one people forget, and data:text/html is a script tag wearing a
   hat. Relative URLs are allowed because a post linking to /teams should work. */
const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;

/* Elements whose contents are code or markup, not prose. Dropping the tag and
   keeping what was inside it — which is what happens to every other unknown
   tag, and is right for a <div> — turns `<script>alert(1)</script>` into the
   words "alert(1)" in the middle of an article, and leaks a stylesheet as a
   paragraph. Everything between the tags goes with them. */
const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'xmp', 'template', 'iframe']);

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeText = (s) => String(s).replace(/[&<>"']/g, (c) => ENT[c]);

/* A tolerant tokeniser rather than a parser. It walks the string once, keeps
   the tags on the allowlist with only their allowed attributes, escapes
   everything else as text, and closes anything the author left open.

   Comments and CDATA are dropped whole, because `<!--` is where a browser's
   parser and a naive regex most easily disagree about where a tag ends — and
   that disagreement is the bug that lets a script through. */
export function clean(html) {
  const src = String(html == null ? '' : html);
  let out = '';
  const open = [];
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { out += escapeText(src.slice(i)); break; }
    out += escapeText(src.slice(i, lt));

    // <!-- ... -->, <![CDATA[ ... ]]>, <!DOCTYPE ...> — dropped entirely.
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      const end = src.indexOf('>', lt + 2);
      i = end < 0 ? src.length : end + 1;
      continue;
    }

    /* The end of the tag, not the first '>' in it. A quoted attribute may
       contain one — src="data:text/html,<b>x</b>" — and stopping there splits
       the tag in the middle, spilling the rest of the attribute into the
       document as text. Quotes are tracked so the scan ends where the tag
       actually does. */
    let gt = -1;
    let quote = '';
    for (let j = lt + 1; j < src.length; j++) {
      const ch = src[j];
      if (quote) { if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '>') { gt = j; break; }
    }
    if (gt < 0) { out += escapeText(src.slice(lt)); break; }
    const raw = src.slice(lt + 1, gt);
    i = gt + 1;

    const closing = raw.startsWith('/');
    const name = (closing ? raw.slice(1) : raw).trim().split(/[\s/>]/)[0].toLowerCase();

    /* A raw-text element takes its contents with it. Searched case-insensitively
       for the closing tag; with none, the rest of the document is inside it and
       none of it was prose. */
    if (!closing && RAW.has(name)) {
      const close = src.toLowerCase().indexOf(`</${name}`, i);
      i = close < 0 ? src.length : (src.indexOf('>', close) < 0 ? src.length : src.indexOf('>', close) + 1);
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(ALLOWED, name)) {
      /* Not on the list. The tag is dropped rather than escaped back into the
         text: a pasted <div> should disappear, not become visible angle
         brackets in the middle of a sentence. Its contents survive, because
         for everything that is not raw text they are the article. */
      continue;
    }

    if (closing) {
      const at = open.lastIndexOf(name);
      if (at < 0) continue;
      // Close everything opened inside it too, innermost first.
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }

    const attrs = [];
    const allow = ALLOWED[name];
    if (allow.length) {
      const re = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
      let m;
      while ((m = re.exec(raw))) {
        const key = m[1].toLowerCase();
        if (!allow.includes(key)) continue;
        const value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] || '';
        if ((key === 'href' || key === 'src') && !SAFE_URL.test(value.trim())) continue;
        attrs.push(`${key}="${escapeText(value)}"`);
      }
    }

    const selfClosing = name === 'br' || name === 'img' || name === 'hr';
    out += `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}${selfClosing ? '' : ''}>`;
    /* An anchor always leaves with these, whatever it arrived with. rel is not
       in the allowlist, so an author cannot remove them by supplying their own
       — target=_blank without noopener hands the opened page a live reference
       back to this one. */
    if (name === 'a') out = out.replace(/<a([^>]*)>$/, '<a$1 rel="noopener noreferrer">');
    if (!selfClosing) open.push(name);
  }

  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/* The same content as words, for the excerpt and for search. Entities are
   turned back into characters so an excerpt reads as prose rather than as
   markup, and it is escaped again wherever it is drawn. */
export function toText(html) {
  return String(html || '')
    .replace(/<(br|\/p|\/h[234]|\/li|\/blockquote)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── slugs ──
   What the URL says. Derived from the title when nobody supplies one, and
   checked for collisions either way — two posts at one address is not a
   conflict a reader can be asked to resolve. */
export function slugify(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

async function freeSlug(wanted, ignoreId) {
  const base = slugify(wanted) || 'post';
  for (let n = 0; n < 200; n++) {
    const candidate = n ? `${base}-${n + 1}` : base;
    const clash = await one('SELECT id FROM blog_posts WHERE slug = ?', [candidate]);
    if (!clash || (ignoreId && clash.id === Number(ignoreId))) return candidate;
  }
  throw new BlogError('Could not find a free address for that title.');
}

const EXCERPT_MAX = 200;
const autoExcerpt = (text) => {
  const t = String(text || '').trim();
  if (t.length <= EXCERPT_MAX) return t;
  const cut = t.slice(0, EXCERPT_MAX);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (stop > 80 ? cut.slice(0, stop + 1) : `${cut.replace(/\s+\S*$/, '')}…`);
};

/* ── reading, in public ──
   Two guarantees hold here and nowhere else needs to repeat them: only
   published rows are ever returned, and body_html is only sent for a single
   post. A list of twenty full articles is a slow page for no reason. */
const LIVE = "status = 'published' AND published_at IS NOT NULL AND published_at <= ?";

export async function listPosts({ limit, before } = {}) {
  const take = Math.min(50, Math.max(1, Number(limit) || 20));
  const rows = await query(
    `SELECT id, slug, title, excerpt, cover_url AS cover, author_name AS author, published_at AS publishedAt
       FROM blog_posts
      WHERE ${LIVE} ${before ? 'AND published_at < ?' : ''}
      ORDER BY published_at DESC
      LIMIT ${take + 1}`,
    before ? [now(), Number(before)] : [now()]);
  return { posts: rows.slice(0, take), more: rows.length > take };
}

export async function readPost(slug) {
  const row = await one(
    `SELECT id, slug, title, excerpt, body_html AS body, cover_url AS cover,
            author_name AS author, published_at AS publishedAt, updated_at AS updatedAt
       FROM blog_posts WHERE slug = ? AND ${LIVE}`, [String(slug || ''), now()]);
  if (!row) throw new BlogError('No such post.', 404);
  return row;
}

/* Everything published, oldest first, for sitemap.xml. Ids and dates only. */
export const publishedSlugs = () =>
  query(`SELECT slug, updated_at AS updatedAt FROM blog_posts WHERE ${LIVE} ORDER BY published_at DESC`, [now()]);

/* ── writing, as an admin ──
   Every one of these is called behind requireAdmin in server.js. Nothing in
   this half checks who is asking, because a check written twice is a check
   that can disagree with itself. */
export async function adminList() {
  return query(
    `SELECT id, slug, title, excerpt, status, author_name AS author,
            published_at AS publishedAt, created_at AS createdAt, updated_at AS updatedAt
       FROM blog_posts ORDER BY COALESCE(published_at, updated_at) DESC`);
}

export async function adminRead(id) {
  const row = await one(
    `SELECT id, slug, title, excerpt, body_html AS body, cover_url AS cover, status,
            author_name AS author, published_at AS publishedAt, updated_at AS updatedAt
       FROM blog_posts WHERE id = ?`, [Number(id) || 0]);
  if (!row) throw new BlogError('No such post.', 404);
  return row;
}

const STATUSES = ['draft', 'published'];

function fields(patch) {
  const title = String(patch.title || '').trim().slice(0, 200);
  if (!title) throw new BlogError('A post needs a title.');

  const body = clean(patch.body);
  const text = toText(body);
  if (!text) throw new BlogError('A post needs something in it.');

  const status = STATUSES.includes(patch.status) ? patch.status : 'draft';
  const cover = String(patch.cover || '').trim().slice(0, 500);
  return {
    title,
    body,
    text,
    status,
    // A supplied excerpt wins; otherwise the opening of the post, cut at a
    // sentence where there is one near enough to the limit.
    excerpt: String(patch.excerpt || '').trim().slice(0, 400) || autoExcerpt(text),
    cover: cover && SAFE_URL.test(cover) ? cover : null
  };
}

export async function createPost(actor, patch) {
  const f = fields(patch || {});
  const slug = await freeSlug((patch || {}).slug || f.title);
  const t = now();
  /* published_at is set the first time a post goes public and never moved by a
     later edit: a correction is not a republication, and a list ordered by it
     would otherwise reshuffle every time a typo was fixed. */
  const published = f.status === 'published' ? t : null;
  const res = await query(
    `INSERT INTO blog_posts
       (slug, title, excerpt, body_html, body_text, cover_url, status, author_id, author_name, published_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [slug, f.title, f.excerpt, f.body, f.text, f.cover, f.status,
      actor.id || null, actor.name || actor.email || null, published, t, t]);
  return adminRead(res.insertId);
}

export async function updatePost(id, patch) {
  const existing = await adminRead(id);
  const f = fields(patch || {});
  const wanted = (patch || {}).slug || (existing.slug ? '' : f.title);
  const slug = wanted ? await freeSlug(wanted, existing.id) : existing.slug;
  const t = now();
  const published = f.status === 'published' ? (existing.publishedAt || t) : null;
  await query(
    `UPDATE blog_posts SET slug = ?, title = ?, excerpt = ?, body_html = ?, body_text = ?,
            cover_url = ?, status = ?, published_at = ?, updated_at = ?
      WHERE id = ?`,
    [slug, f.title, f.excerpt, f.body, f.text, f.cover, f.status, published, t, existing.id]);
  return adminRead(existing.id);
}

export async function deletePost(id) {
  const res = await query('DELETE FROM blog_posts WHERE id = ?', [Number(id) || 0]);
  if (!res.affectedRows) throw new BlogError('No such post.', 404);
  return { ok: true };
}
