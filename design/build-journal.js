// Builds the Journal of the design study: the-day/journal/index.html and one page per article.
// Article text comes from GitHub main (journal-src/*.html); the hours article is updated for
// "weddings start at $4,000" pricing. Shares styles and the handwriting engine with the homepage.
const fs = require('fs');
const path = require('path');

const lab = __dirname;
const outDir = process.argv[2];
const read = (f) => fs.readFileSync(path.join(lab, f), 'utf8');
const ORIGIN = 'https://alex-claudio.com';

/* ---------- Shared assets ---------- */

const fonts = JSON.parse(read('fonts.json'));
function parseGlyph(d) {
  const subs = [];
  const re = /([ML])\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g;
  let m, cur = null;
  while ((m = re.exec(d))) {
    const x = Math.round(parseFloat(m[2])), y = Math.round(parseFloat(m[3]));
    if (m[1] === 'M') { cur = [x, y]; subs.push(cur); } else if (cur) cur.push(x, y);
  }
  return subs.filter((s) => s.length >= 4);
}
function pack(font, chars) {
  const g = {};
  for (const ch of chars) { const gl = font.glyphs[ch]; if (gl && ch !== ' ') g[ch] = [Math.round(gl.a), ...parseGlyph(gl.d)]; }
  return { asc: font.ascent, desc: font.descent, space: font.glyphs[' '] ? Math.round(font.glyphs[' '].a) : 300, g };
}
let ascii = '';
for (let c = 33; c < 127; c++) ascii += String.fromCharCode(c);
const glyphs = JSON.stringify({ society: pack(fonts.EMSSociety, 'Alex Claudio&'), felix: pack(fonts.EMSFelix, ascii) });

const homeJs = read('the-day.js');
const ia = homeJs.indexOf('/* ---------- Ink: strokes that draw themselves ---------- */');
const ib = homeJs.indexOf("  $$('[data-split]').forEach(split);");
if (ia < 0 || ib <= ia) throw new Error('engine markers not found');
const script = read('journal.js').replace('/*__INK__*/', () => homeJs.slice(ia, ib)).replace('/*__GLYPHS__*/null', () => glyphs);
if (script.includes('/*__')) throw new Error('unreplaced placeholder in journal.js');
const css = read('the-day.css') + '\n' + read('journal.css');

/* ---------- Content fixes ---------- */

function mustReplace(s, from, to, label) {
  if (!s.includes(from)) throw new Error('content fix did not match: ' + label);
  return s.split(from).join(to);
}
function fixHours(s) {
  s = mustReplace(s, '<p>Our collections include six, eight, or ten consecutive hours, with both of us photographing throughout the booked coverage.</p>',
    '<p>We book coverage in consecutive hours, with both of us photographing the whole time. Weddings start at $4,000, and your proposal is built around the hours you choose.</p>', 'intro');
  s = mustReplace(s, 'Check what the collection includes', 'Check what&rsquo;s included', 'part 2 title');
  s = mustReplace(s, 'An eight-hour collection gives you two photographers', 'Eight hours of coverage gives you two photographers', 'section 5');
  s = mustReplace(s, 'When access and timing allow, one of us can photograph each of your preparations at the same time, or stay with your guests while the other takes portraits.',
    'While you get ready in separate rooms, one of us stays with each of you. Later, one of us can stay with your guests while the other takes portraits.', 'section 5 preparations');
  s = mustReplace(s, 'Compare hours, albums, and sessions', 'What every wedding includes', 'section 6 title');
  const a = s.indexOf('<section class="article-section" id="section-6">');
  const b = s.indexOf('<section class="article-section" id="section-7">');
  if (a < 0 || b <= a) throw new Error('content fix did not match: section 6 body');
  const section6 = '<section class="article-section" id="section-6"><h3>What every wedding includes</h3>\n' +
    '<p>Weddings start at $4,000. That includes both of us for every hour you book, a consultation and timeline planning before the day, every photograph edited by us in high resolution, and a private online gallery with downloads and personal printing rights.</p>\n' +
    '<p>Engagement sessions, extra hours and custom-designed leather albums can be added. Your proposal sets out the coverage, tax, travel and any additions before you book, so you can check it against the moments you marked in Part 1.</p>\n</section>\n';
  return s.slice(0, a) + section6 + s.slice(b);
}
const fixAll = (s) => s.split('02 / The collection').join('02 / Coverage');

/* ---------- Parse the articles ---------- */

const SLUGS = ['wedding-day-photography-tips', 'seattle-wedding-rain-plan', 'how-many-hours-wedding-photography', 'wedding-photography-timeline'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const pick = (re, s, label) => { const m = s.match(re); if (!m) throw new Error('could not find ' + label); return m; };
const stripTags = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

function absSrcset(srcset) {
  const sizes = srcset.split(',').map((x) => x.trim().split(/\s+/)).map(([u, w]) => ({ u: ORIGIN + u, w: parseInt(w, 10) })).sort((x, y) => x.w - y.w);
  return { srcset: sizes.map((x) => x.u + ' ' + x.w + 'w').join(', '), mid: (sizes.filter((x) => x.w <= 800).pop() || sizes[0]).u, big: (sizes.filter((x) => x.w <= 1600).pop() || sizes[sizes.length - 1]).u };
}

function relink(html, R) {
  return html
    .replace(/href="\.\.\/\.\.\/pricing\/"/g, `href="${R}index.html#collections"`)
    .replace(/href="\.\.\/\.\.\/#contact"/g, `href="${R}index.html#letter"`)
    .replace(/href="\.\.\/\.\.\/blog\/([a-z0-9-]+)\/"/g, 'href="../$1/index.html"')
    .replace(/href="\.\.\/([a-z0-9-]+)\/"/g, 'href="../$1/index.html"')
    .replace(/href="\.\.\/\.\.\/portfolio\/"/g, `href="${R}work/index.html"`);
}

const articles = SLUGS.map((slug) => {
  let src = fixAll(read('journal-src/' + slug + '.html'));
  if (slug === 'how-many-hours-wedding-photography') src = fixHours(src);
  const kicker = pick(/<div class="article-cover-copy"><p class="journal-kicker">([^<]+)<\/p>/, src, slug + ' kicker')[1].trim();
  const [num, label] = kicker.split('/').map((x) => x.trim());
  const titleHtml = pick(/<div class="article-cover-copy">[\s\S]*?<h1>([\s\S]*?)<\/h1>/, src, slug + ' title')[1].trim();
  const dek = pick(/<\/h1><p>([\s\S]*?)<\/p>/, src, slug + ' dek')[1].trim();
  const cov = pick(/<img class="cover-photo"[^>]*?alt="([^"]*)"[^>]*?width="(\d+)"\s+height="(\d+)"\s+srcset="([^"]+)"/, src, slug + ' cover');
  const time = pick(/<time datetime="([^"]+)">([^<]+)<\/time>/, src, slug + ' date');
  const intro = pick(/<div class="article-intro-copy">([\s\S]*?)<\/div><\/div>/, src, slug + ' intro')[1].trim();
  const ca = src.indexOf('<div class="article-copy">');
  const cb = src.indexOf('</article>');
  if (ca < 0 || cb <= ca) throw new Error('could not find copy for ' + slug);
  let copy = src.slice(ca + '<div class="article-copy">'.length, cb).replace(/<\/div><\/div>\s*$/, '').trim();
  const navHtml = pick(/<nav class="article-contents"[^>]*>([\s\S]*?)<\/nav>/, src, slug + ' contents')[1];
  const toc = [...navHtml.matchAll(/<a( class="article-part-link")? href="#([^"]+)">([\s\S]*?)<\/a>/g)].map((m) => ({ part: !!m[1], id: m[2], text: m[3].trim() }));
  const related = [...src.matchAll(/<article class="journal-story"><a class="story-link" href="[^"]*?\/blog\/([a-z0-9-]+)\/"><p class="journal-kicker">([^<]+)<\/p><h2>([\s\S]*?)<\/h2><p class="story-excerpt">([\s\S]*?)<\/p>/g)]
    .map((m) => ({ slug: m[1], kicker: m[2].trim(), titleHtml: m[3].trim(), excerpt: m[4].trim() }));
  const words = stripTags(intro + ' ' + copy).split(' ').length;
  return { slug, num, label, titleHtml, title: stripTags(titleHtml), dek, cover: { alt: cov[1], w: +cov[2], h: +cov[3], ...absSrcset(cov[4]) }, date: time[1], dateText: time[2].trim(), intro, copy, toc, related, minutes: Math.max(1, Math.round(words / 230)) };
});
const bySlug = Object.fromEntries(articles.map((a) => [a.slug, a]));

/* ---------- Page pieces ---------- */

const esc = (s) => s.replace(/&(?!(?:[a-z]+|#\d+);)/gi, '&amp;').replace(/"/g, '&quot;');
const ICON = read('favicon-uri.txt').trim();
const head = (title, description) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Alex Claudio · design study</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="noindex">
<script>document.documentElement.classList.add('js');</script>
<link rel="icon" type="image/svg+xml" href="${ICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,200..700,0..100,0..1;1,9..144,200..700,0..100,0..1&display=swap">
<style>${css}</style>
</head>`;

const chrome = (R, current) => `<a class="skip" href="#main">Skip to content</a>
<div class="grain" aria-hidden="true"></div>
<div class="cursor" aria-hidden="true"><span class="c-dot"></span><span class="c-ring-pos"><span class="c-ring"><i></i><i></i><i></i><i></i><b class="c-label"></b></span></span></div>
<header class="nav" id="nav">
  <a class="mark" id="mark" href="${R}index.html" aria-label="Alex Claudio Photography, home"></a>
  <nav class="nav-links" aria-label="Primary">
    <a href="${R}work/index.html" data-ul>Work</a>
    <a href="${R}journal/index.html"${current ? ` aria-current="${current}" data-ul data-ul-always` : ' data-ul'}>Journal</a>
    <a href="${R}index.html#collections" data-ul>Pricing</a>
    <a href="${R}index.html#letter" class="nav-write" id="navWrite">Write to us</a>
  </nav>
  <button class="menu-btn" id="menuBtn" type="button" aria-expanded="false" aria-controls="menu">Menu</button>
</header>
<div class="menu" id="menu" hidden>
  <a href="${R}index.html">Home</a>
  <a href="${R}work/index.html">Work</a>
  <a href="${R}journal/index.html"${current ? ` aria-current="${current}"` : ''}>Journal</a>
  <a href="${R}index.html#collections">Pricing</a>
  <a href="${R}index.html#letter">Write to us</a>
  <p class="mono">Seattle &middot; Pacific Northwest &middot; Europe</p>
</div>`;

const footer = (R, line, current) => `<footer class="foot" data-tone="paper">
    <div class="foot-sig" id="footSig"></div>
    <p class="foot-line">${line}</p>
    <div class="foot-cols">
      <div><span>Studio</span><a href="mailto:contact@alex-claudio.com">contact@alex-claudio.com</a></div>
      <div><span>Elsewhere</span><a href="https://www.instagram.com/alexclaudiophotography/">Instagram</a></div>
      <div><span>Pages</span><a href="${R}index.html">Home</a><a href="${R}work/index.html">The work</a><a href="${R}journal/index.html"${current ? ` aria-current="${current}"` : ''}>The Journal</a></div>
      <div><span>Based in</span><p>Seattle. Photographing the Pacific Northwest and Europe.</p></div>
    </div>
    <p class="credit">Design study, October 2026. Not the live site. Photographs load from alex-claudio.com. Handwriting is drawn stroke by stroke from EMS Society and EMS Felix, single-line fonts by Sheldon B. Michaels and Windell H. Oskay, released under the SIL Open Font License.</p>
  </footer>`;

const tail = `<script>${script}</script>
</body>
</html>
`;

const img = (c, sizes, cls, extra = '') => `<img${cls ? ` class="${cls}"` : ''} src="${c.mid}" srcset="${c.srcset}" sizes="${sizes}" alt="${esc(c.alt)}" width="${c.w}" height="${c.h}" decoding="async"${extra}>`;

/* ---------- Journal index ---------- */

const INDEX_EXCERPTS = {
  'wedding-day-photography-tips': 'From the rings on the table in the morning to the last toast, and the small decision that makes each moment easier.',
  'seattle-wedding-rain-plan': 'Choose your indoor spaces, then agree on the weather decisions and practical arrangements.',
  'how-many-hours-wedding-photography': 'Choose coverage around the moments you would be disappointed to miss.',
  'wedding-photography-timeline': 'Make the planning decisions first, then adapt an eight-hour schedule to your day.'
};
const INDEX_TITLES = {
  'seattle-wedding-rain-plan': 'A Seattle wedding<br><em>rain plan.</em>',
  'how-many-hours-wedding-photography': 'Six, eight,<br><em>or ten hours?</em>',
  'wedding-photography-timeline': 'A wedding timeline<br><em>with time for your guests.</em>'
};
const lead = bySlug['wedding-day-photography-tips'];
const rest = ['seattle-wedding-rain-plan', 'how-many-hours-wedding-photography', 'wedding-photography-timeline'].map((s) => bySlug[s]);

const indexPage = `${head('The Journal', 'Wedding planning notes from Alex Claudio Photography.')}
<body data-tone="paper" class="journal-page journal-index">
${chrome('../', 'page')}
<main id="main">
  <section class="j-head hero-reveal" data-tone="paper">
    <div>
      <p class="kicker">Alex Claudio Photography &middot; wedding planning notes &middot; ${articles.length} stories</p>
      <h1 data-split>The <em class="see" id="titleWord">Journal.</em></h1>
    </div>
    <p class="j-aside" data-rise style="--d:420ms">Before the vows. Notes for the two of you.</p>
  </section>

  <section class="j-lead" data-tone="paper" aria-label="Latest story">
    <div class="new-note" id="newNote" aria-hidden="true"></div>
    <a class="lead-link" href="${lead.slug}/index.html">
      <figure>${img(lead.cover, '(max-width: 900px) 100vw, 62vw', '', ' data-develop loading="eager"')}</figure>
      <div class="lead-copy" data-rise>
        <p class="kick">${lead.num} / ${lead.label} &middot; ${lead.minutes} min read</p>
        <h2>${lead.titleHtml}</h2>
        <p class="excerpt">${INDEX_EXCERPTS[lead.slug]}</p>
        <span class="read" data-ul>Read the story <span class="arr" aria-hidden="true">&rarr;</span></span>
      </div>
    </a>
  </section>

  <section class="j-list" data-tone="paper" aria-label="More stories">
    <p class="mono list-label" data-rise>More stories</p>
${rest.map((a) => `    <a class="j-row" href="${a.slug}/index.html" data-preview="${a.cover.mid}" data-rise>
      <span class="num" aria-hidden="true">${a.num}</span>
      <div><span class="kick">${a.label} &middot; ${a.minutes} min read</span><h2>${INDEX_TITLES[a.slug]}</h2></div>
      <p class="excerpt">${INDEX_EXCERPTS[a.slug]}</p>
      <span class="go" aria-hidden="true">&rarr;</span>
      <img class="thumb" src="${a.cover.mid}" alt="" width="${a.cover.w}" height="${a.cover.h}" loading="lazy" decoding="async">
    </a>`).join('\n')}
  </section>

  <section class="j-cta" data-tone="paper">
    <p class="chapter-no" data-rise><span>&rarr;</span> Your wedding</p>
    <h2 data-split>A day that feels like <em>you.</em></h2>
    <p class="body" data-rise>Tell us what you have in mind. We answer every inquiry ourselves, within a few hours.</p>
    <div data-rise><a class="btn" href="../index.html#letter" data-magnetic>Write to us <span class="arr" aria-hidden="true">&rarr;</span></a></div>
  </section>

  ${footer('../', 'Thank you for reading.', 'page')}
</main>
${tail}`;

/* ---------- Articles ---------- */

function articlePage(a) {
  const R = '../../';
  let partNo = 0;
  let copy = relink(a.copy, R)
    .replace(/<section class="article-part" id="(part-\d+)" aria-labelledby="([^"]+)">\s*<header class="article-part-heading"><p class="journal-kicker">([^<]+)<\/p><h2 id="([^"]+)">([\s\S]*?)<\/h2><\/header>/g,
      (m, id, lab, kick, hid, h2) => `<section class="part" id="${id}" aria-labelledby="${lab}">\n<header class="part-head"><p class="part-kick" data-rise><span>${ROMAN[partNo++]}</span> ${kick}</p><h2 id="${hid}" data-split>${h2}</h2></header>`)
    .replace(/<section class="article-section" id="section-(\d+)"><h3>/g, (m, n) => `<section class="sec" id="section-${n}"><span class="n" aria-hidden="true">${String(n).padStart(2, '0')}</span><h3>`)
    .replace(/<div class="journal-table"/g, '<div class="table-wrap"');
  if (/article-(part|section)|journal-kicker/.test(copy)) throw new Error('unconverted markup left in ' + a.slug);
  const secCount = a.toc.filter((t) => !t.part).length;
  const tocLinks = a.toc.map((t) => t.part
    ? `<a class="part-link" href="#${t.id}">${t.text}</a>`
    : `<a href="#${t.id}">${t.text}</a>`).join('\n');
  const rel = a.related.map((r) => bySlug[r.slug]).filter(Boolean);
  if (rel.length !== a.related.length) throw new Error('related story missing for ' + a.slug);
  const head1 = `<header class="a-head hero-reveal" data-tone="paper">
      <p class="a-kicker mono"><a href="../index.html">The Journal</a> &middot; ${a.num} / ${a.label} &middot; ${a.minutes} min read</p>
      <h1 data-split>${a.titleHtml}</h1>
      <p class="dek" data-rise style="--d:420ms">${a.dek}</p>
    </header>`;
  const tall = a.cover.h > a.cover.w;
  const opener = tall
    ? `<div class="a-open" data-tone="paper">
    ${head1}
    <figure class="a-cover tall hero-reveal">${img(a.cover, '(max-width: 900px) 100vw, 36vw', '', ' data-develop loading="eager" fetchpriority="high"')}</figure>
    </div>`
    : `${head1}
    <figure class="a-cover hero-reveal">${img(a.cover, '100vw', '', ' data-develop loading="eager" fetchpriority="high"')}</figure>`;
  return `${head(a.title, a.dek)}
<body data-tone="paper" class="journal-page journal-article">
${chrome(R, 'location')}
<main id="main">
  <article>
    ${opener}
    <p class="a-meta mono"><span>By Alex Claudio Photography &middot; <time datetime="${a.date}">${a.dateText}</time></span><span>${esc(a.cover.alt)}</span></p>

    <div class="a-intro">
      <p class="mono" style="color:var(--fg3)">${secCount} sections &middot; ${a.minutes} min read</p>
      <div class="a-lede" data-rise>${relink(a.intro, R)}</div>
    </div>

    <div class="a-body">
      <nav class="toc" aria-label="In this story">
        <p class="label">In this story</p>
        <span class="marker" id="tocMarker" aria-hidden="true"></span>
${tocLinks}
      </nav>
      <div class="copy">
        <details class="toc-m"><summary>In this story &middot; ${secCount} sections</summary>
${tocLinks}
        </details>
${copy}
      </div>
    </div>
  </article>

  <section class="related" data-tone="paper" aria-labelledby="relatedTitle">
    <p class="chapter-no" id="relatedTitle" data-rise><span>&rarr;</span> Keep reading</p>
    <div class="cards">
${rel.map((r) => `      <a class="card-link" href="../${r.slug}/index.html" data-rise>
        <figure>${img(r.cover, '(max-width: 900px) 100vw, 45vw', '', ' data-develop loading="lazy"')}</figure>
        <p class="kick">${r.num} / ${r.label} &middot; ${r.minutes} min read</p>
        <h3>${INDEX_TITLES[r.slug] || r.titleHtml}</h3>
        <p class="excerpt">${INDEX_EXCERPTS[r.slug]}</p>
        <span class="read" data-ul>Read the story <span class="arr" aria-hidden="true">&rarr;</span></span>
      </a>`).join('\n')}
    </div>
  </section>

  ${footer(R, 'Thank you for reading.', 'location')}
</main>
<p class="read-count off" id="readCount" aria-hidden="true"></p>
${tail}`;
}

/* ---------- Privacy ---------- */

const privacyPage = `${head('Privacy', 'How Alex Claudio Photography handles the details you send us, and what this website does and does not collect.')}
<body data-tone="paper" class="journal-page privacy-page">
${chrome('../', '')}
<main id="main">
  <article>
    <header class="a-head hero-reveal" data-tone="paper">
      <p class="a-kicker mono">Alex Claudio Photography &middot; Privacy</p>
      <h1 data-split>What we keep, <em>and what we don&rsquo;t.</em></h1>
      <p class="dek" data-rise style="--d:420ms">This website collects only what you choose to send us. It sets no cookies and runs no analytics or advertising trackers.</p>
    </header>
    <div class="p-body">
      <p class="mono p-date">Last updated <time datetime="2026-10-07">October 7, 2026</time></p>
      <div class="copy">
<section class="sec" id="inquiries"><span class="n" aria-hidden="true">01</span><h2>When you write to us</h2>
<p>Our letter form and event sign-up form send us what you type: your names, email address, wedding date, place, the coverage you have in mind, your message and, on the sign-up form, a phone number and how you found us.</p>
<p>The website passes your letter to us by email through Resend and keeps a copy in our private studio records, a database hosted with Railway that only we can sign in to. It also adds your name, email address and, where you gave them, phone number and how you found us to a private Google Sheet we use to keep track of inquiries.</p>
<p>We use what you send only to reply to you and to plan and photograph your wedding. Writing to us does not sign you up for any mailing list. We keep your letter, and the notes we make while we plan with you, only for as long as we need them for your wedding and our records.</p>
</section>
<section class="sec" id="tracking"><span class="n" aria-hidden="true">02</span><h2>No cookies, analytics or advertising trackers</h2>
<p>This website sets no cookies for visitors; the only cookies it ever sets are for signing in to our own private studio page. It runs no analytics, advertising pixels, session recordings or other tracking scripts, so there is nothing to accept or decline.</p>
<p>So that the opening animation on our homepage plays only once, your browser remembers that you have seen it until you close the tab. That note stays on your device and is never sent to us.</p>
</section>
<section class="sec" id="hosting"><span class="n" aria-hidden="true">03</span><h2>Hosting, photographs and fonts</h2>
<p>The website is hosted by Railway. Its pages, photographs and fonts come from our own server rather than from third-party font or script services. Private client galleries load their photographs from Cloudflare, which stores them for us.</p>
<p>Like any website host, Railway and Cloudflare keep routine technical logs, such as IP addresses, to deliver pages and keep the service secure.</p>
</section>
<section class="sec" id="choices"><span class="n" aria-hidden="true">04</span><h2>Your choices</h2>
<p>To ask what we hold about you, correct it or have it deleted, write to <a href="mailto:contact@alex-claudio.com">contact@alex-claudio.com</a>. We will remove your inquiry from our email, our studio records and the Google Sheet on request.</p>
</section>
      </div>
    </div>
  </article>
  ${footer('../', 'Thank you for reading.', '')}
</main>
${tail}`;

/* ---------- Write ---------- */

fs.mkdirSync(path.join(outDir, 'journal'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'journal', 'index.html'), indexPage);
for (const a of articles) {
  fs.mkdirSync(path.join(outDir, 'journal', a.slug), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'journal', a.slug, 'index.html'), articlePage(a));
}
fs.mkdirSync(path.join(outDir, 'privacy'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'privacy', 'index.html'), privacyPage);
console.log(articles.map((a) => `${a.num} ${a.slug}: ${a.toc.filter((t) => !t.part).length} sections, ${a.minutes} min, related ${a.related.map((r) => r.slug.split('-')[0]).join('+')}`).join('\n'));
