/* Serving one document under several addresses.

   Four routes hand out the same index.html with a different head written into
   it: the home page, /teams, /blogs and a post's own page. Replacing the
   <title> alone was not enough — the document arrives with the home page's
   description, canonical, og and twitter tags already in it, so a filled page
   went out carrying two canonicals and two og:titles, one saying /blogs or
   /teams and one saying the home page. Which of the two a reader believes is
   not something the page gets to decide.

   So the document's own copy of every tag the new head defines is taken out
   first, and only those: a post with no cover image still inherits the site's
   og:image, because its own head never mentioned one. */

const HEAD_KEY = /<(?:meta|link)\b[^>]*?(?:name|property|rel)=["']([^"']+)["'][^>]*>/gi;

export function swapHead(html, head) {
  const mine = new Set();
  for (const m of String(head).matchAll(HEAD_KEY)) mine.add(m[1].toLowerCase());
  const stripped = String(html).replace(HEAD_KEY, (tag, key) => (mine.has(key.toLowerCase()) ? '' : tag));
  return stripped.replace(/<title>[\s\S]*?<\/title>/i, head);
}
