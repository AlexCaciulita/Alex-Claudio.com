// Builds the public pages from the design sources in this folder.
//   node design/build-production.js
// Runs the three page builders, then turns their output into the live site:
// clean URLs, self-hosted fonts and photographs, search metadata, and the live inquiry form.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DESIGN = __dirname;
const REPO = path.resolve(DESIGN, '..');
const ORIGIN = 'https://alex-claudio.com';
const BUSINESS = { '@type': 'Organization', '@id': ORIGIN + '/#business', name: 'Alex Claudio Photography', url: ORIGIN + '/' };

const ARTICLES = {
  'wedding-day-photography-tips': {
    title: 'Wedding Day Photography Tips: 10 Moments to Plan | Alex Claudio',
    description: 'Ten moments of a wedding day, from the morning details to the last toast, and the small decision that makes each one easier to photograph and enjoy.',
    image: '/Portofolio/resized222.jpg', published: '2026-09-22T16:45:00-07:00', modified: '2026-09-22T16:45:00-07:00',
    crumb: 'Your wedding day, in ten moments.'
  },
  'seattle-wedding-rain-plan': {
    title: 'Seattle Wedding Rain Plan | Alex Claudio Photography',
    description: 'Plan for rain at your Seattle wedding with practical advice on indoor portraits, venue backups, weather decisions, and keeping guests comfortable.',
    image: '/assets/blog/rain-window.jpg', published: '2026-09-16T20:12:52-07:00', modified: '2026-09-22T14:30:00-07:00',
    crumb: 'A Seattle wedding rain plan.'
  },
  'how-many-hours-wedding-photography': {
    title: '6, 8 or 10 Hours of Wedding Photography? | Alex Claudio',
    description: 'Compare 6, 8 and 10 hours of wedding photography, see what two photographers cover, and choose coverage around the moments you want to keep.',
    image: '/assets/blog/rings-paper.jpg', published: '2026-09-16T20:12:52-07:00', modified: '2026-10-06T12:00:00-07:00',
    crumb: 'Six, eight, or ten hours?'
  },
  'wedding-photography-timeline': {
    title: 'Wedding Photography Timeline | Alex Claudio Photography',
    description: 'Build a wedding photography timeline with a first-look decision, manageable family portraits, daylight planning, and time to spend with your guests.',
    image: '/assets/blog/reception-table.jpg', published: '2026-09-16T20:12:52-07:00', modified: '2026-09-22T14:30:00-07:00',
    crumb: 'A wedding timeline with time for your guests.'
  }
};

const PAGES = [
  {
    study: 'index.html', out: 'index.html', url: '/', type: 'website', image: '/Portofolio/hero_upscaled.jpg',
    title: 'Seattle Wedding Photographers | Alex Claudio Photography',
    description: 'Wedding photography in Seattle, the Pacific Northwest and Europe by a husband-and-wife team. Both of us photograph every hour you book, and weddings start at $4,000.',
    ld: {
      '@context': 'https://schema.org',
      '@type': ['LocalBusiness', 'ProfessionalService'],
      '@id': ORIGIN + '/#business',
      name: 'Alex Claudio Photography',
      url: ORIGIN + '/',
      image: ORIGIN + '/Portofolio/hero_upscaled.jpg',
      email: 'contact@alex-claudio.com',
      sameAs: ['https://www.instagram.com/alexclaudiophotography/'],
      description: 'Wedding photography in Seattle, the Pacific Northwest and Europe. Weddings start at $4,000, with both photographers for every hour you book.',
      priceRange: '$$$',
      address: { '@type': 'PostalAddress', addressLocality: 'Seattle', addressRegion: 'WA', addressCountry: 'US' },
      areaServed: ['Seattle', 'Bellevue', 'Kirkland', 'Redmond', 'Tacoma', 'Puget Sound'],
      serviceType: 'Wedding Photography'
    }
  },
  {
    study: 'work/index.html', out: 'portfolio/index.html', url: '/portfolio/', type: 'website', image: '/assets/home/faq-craft-1600.jpg',
    title: 'Seattle Wedding Photography Portfolio | Alex Claudio',
    description: 'Explore the wedding portfolio of Alex Claudio Photography, a wedding photography team based in Seattle and serving the Pacific Northwest.'
  },
  {
    study: 'journal/index.html', out: 'blog/index.html', url: '/blog/', type: 'website', image: '/assets/blog/rain-window.jpg',
    title: 'Seattle Wedding Planning Journal | Alex Claudio Photography',
    description: 'Wedding planning notes from Alex Claudio Photography: Seattle rain plans, photography coverage, and timelines that leave time for your guests.'
  },
  ...Object.entries(ARTICLES).map(([slug, a]) => ({
    study: `journal/${slug}/index.html`, out: `blog/${slug}/index.html`, url: `/blog/${slug}/`, type: 'article', slug, ...a
  })),
  {
    study: 'privacy/index.html', out: 'privacy/index.html', url: '/privacy/', type: 'website', image: '/Portofolio/hero_upscaled.jpg',
    title: 'Privacy | Alex Claudio Photography',
    description: 'How Alex Claudio Photography handles the details you send us, and what this website does and does not collect.'
  }
];

// Study page path -> public URL.
const ROUTES = new Map(PAGES.map((p) => [p.study, p.url]));

const fail = (msg) => { throw new Error(msg); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const textOf = (html) => html.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&rsquo;/g, '\u2019').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function replaceOnce(html, from, to, label) {
  const count = html.split(from).length - 1;
  if (count !== 1) fail(`${label}: expected one match, found ${count}`);
  return html.replace(from, () => to);
}

// 1. Build the design pages into a scratch folder.
const study = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-claudio-pages-'));
const run = (script, arg) => execFileSync(process.execPath, [path.join(DESIGN, script), arg], { stdio: 'pipe' });
run('favicon.js', '');
run('build-day.js', path.join(study, 'index.html'));
run('build-work.js', path.join(study, 'work', 'index.html'));
run('build-journal.js', study);

const fontCss = '/assets/fonts/the-day.css';
const fontPreload = '/assets/fonts/fraunces-normal-200-700-latin.woff2';

for (const page of PAGES) {
  let html = fs.readFileSync(path.join(study, page.study), 'utf8');
  const canonical = ORIGIN + page.url;
  const image = ORIGIN + page.image;

  // 2. Links: resolve each relative page link against the study layout and map it to its public URL.
  const base = 'https://study.local/' + page.study;
  html = html.replace(/href="([^"]*)"/g, (all, href) => {
    if (!href || /^(?:[a-z]+:|#|\/)/i.test(href)) return all;
    const u = new URL(href, base);
    const target = u.pathname.slice(1);
    const route = ROUTES.get(target);
    if (!route) fail(`${page.study}: no public URL for link ${href}`);
    return `href="${route}${u.hash}"`;
  });

  // 3. Photographs come from this site.
  html = html.split(ORIGIN + '/assets/').join('/assets/');
  if (html.includes(ORIGIN + '/')) fail(`${page.study}: absolute link to the live site left in page: ${html.match(/https:\/\/alex-claudio\.com\/[^"'\s)]*/)[0]}`);

  // 4. Head: search metadata, social cards, self-hosted fonts, no noindex.
  const robots = html.match(/<meta name="robots" content="noindex">\r?\n?/g) || [];
  if (robots.length !== 1) fail(`${page.study}: expected one noindex tag, found ${robots.length}`);
  html = html.replace(/<meta name="robots" content="noindex">\r?\n?/, '');
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(page.title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, () => [
    `<meta name="description" content="${esc(page.description)}">`,
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:type" content="${page.type}">`,
    `<meta property="og:site_name" content="Alex Claudio Photography">`,
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:locale" content="en_US">`,
    ...(page.type === 'article' ? [`<meta property="article:published_time" content="${page.published}">`, `<meta property="article:modified_time" content="${page.modified}">`] : []),
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(page.title)}">`,
    `<meta name="twitter:description" content="${esc(page.description)}">`,
    `<meta name="twitter:image" content="${image}">`
  ].join('\n'));
  if (!html.includes('<link rel="canonical"')) fail(`${page.study}: description meta not found`);
  html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.g(?:oogleapis|static)\.com"(?: crossorigin)?>\r?\n/g, '');
  html = html.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]*">/, () =>
    `<link rel="preload" as="font" type="font/woff2" href="${fontPreload}" crossorigin>\n<link rel="stylesheet" href="${fontCss}">`);
  html = html.replace(/<link rel="icon" type="image\/svg\+xml" href="data:[^"]*">/, '<link rel="icon" type="image/svg+xml" href="/favicon.svg">');

  let ld = page.ld;
  if (page.type === 'article') {
    const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || fail(`${page.study}: no h1`))[1];
    ld = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BlogPosting', '@id': canonical + '#article', url: canonical,
          mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
          headline: textOf(h1), description: page.description, image: [image],
          datePublished: page.published, dateModified: page.modified, inLanguage: 'en-US',
          author: { '@type': 'Organization', name: 'Alex Claudio Photography', url: ORIGIN + '/#intro' },
          publisher: BUSINESS
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' },
            { '@type': 'ListItem', position: 2, name: 'The Journal', item: ORIGIN + '/blog/' },
            { '@type': 'ListItem', position: 3, name: page.crumb, item: canonical }
          ]
        }
      ]
    };
  }
  if (ld) html = replaceOnce(html, '</head>', `<script type="application/ld+json">${JSON.stringify(ld, null, 2)}</script>\n</head>`, 'head end');

  // 5. Footer credit for the public site.
  html = html.replace(/<p class="credit">[\s\S]*?<\/p>/, () =>
    '<p class="credit">&copy; 2026 Alex Claudio Photography &middot; <a href="/privacy/">Privacy</a> &middot; Handwriting drawn from EMS Society and EMS Felix, single-line fonts by Sheldon B. Michaels and Windell H. Oskay, under the <a href="/assets/fonts/handwriting-OFL.txt">SIL Open Font License</a>.</p>');

  // 6. The letter form sends real inquiries.
  if (page.study === 'index.html') {
    html = replaceOnce(html, '<form class="letter-form" id="letterForm" novalidate>',
      '<form class="letter-form" id="letterForm" method="post" action="/api/submissions" data-endpoint="/api/submissions" novalidate>\n      <input type="hidden" name="form-name" value="contact">', 'letter form');
    html = replaceOnce(html, '<span class="mono">Design study. Nothing is sent.</span>',
      '<span class="mono">Or write to <a href="mailto:contact@alex-claudio.com">contact@alex-claudio.com</a></span>', 'form note');
  }

  // 7. Nothing from the preview may remain.
  for (const [re, what] of [
    [/design study|Design study|Nothing is sent|Not the live site/, 'preview wording'],
    [/noindex/, 'noindex'],
    [/fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|googletagmanager|connect\.facebook/, 'third-party request'],
    [/href="[^"]*index\.html/, 'index.html link'],
    [/\/\*__[A-Z]+__\*\/|<!--__[A-Z]+__-->/, 'build placeholder']
  ]) if (re.test(html)) fail(`${page.out}: ${what} left in page: ${html.match(re)[0]}`);

  const dest = path.join(REPO, page.out);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
  console.log(`wrote ${page.out.padEnd(50)} ${(html.length / 1024).toFixed(1)} KB`);
}

// 8. Shared files the pages point to.
fs.copyFileSync(path.join(DESIGN, 'favicon.svg'), path.join(REPO, 'favicon.svg'));
fs.copyFileSync(path.join(DESIGN, 'FONTS-OFL.txt'), path.join(REPO, 'assets', 'fonts', 'handwriting-OFL.txt'));
for (const f of [fontCss.slice(1), fontPreload.slice(1)]) if (!fs.existsSync(path.join(REPO, f))) fail('missing ' + f);
fs.rmSync(study, { recursive: true, force: true });
