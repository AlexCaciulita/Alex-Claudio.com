import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const home = read('index.html');
const script = read('script.js');
const publicPages = [
  'index.html', 'portfolio/index.html', 'privacy/index.html', 'blog/index.html',
  'blog/seattle-wedding-rain-plan/index.html', 'blog/how-many-hours-wedding-photography/index.html',
  'blog/wedding-photography-timeline/index.html', 'blog/wedding-day-photography-tips/index.html',
  'blog/seattle-engagement-photos/index.html',
  'blog/seattle-wedding-sunset-times/index.html',
  'links/index.html', 'lead/index.html', 'gallery/index.html', 'AlexClaudioVentures/index.html'
];

test('marketing copy describes Alex as a solo photographer, not a team', () => {
  const teamLabels = /husband[\s-]+and[\s-]+wife|partners in life|photography team|two photographers|both photographers|second photographer|one of us/i;
  assert.match(home, /I&rsquo;m Alex, a Seattle wedding photographer with a calm, documentary eye/);
  assert.doesNotMatch(home, /both of us|two of us/i);
  for (const name of ['studio-family', 'studio-oana']) {
    for (const size of [400, 800]) assert.ok(existsSync(new URL(`../assets/responsive/${name}-${size}.webp`, import.meta.url)), `${name}-${size}`);
    assert.match(home, new RegExp(`/assets/responsive/${name}-400\\.webp`), name);
  }
  for (const path of publicPages.filter((path) => path !== 'AlexClaudioVentures/index.html')) {
    assert.doesNotMatch(read(path), teamLabels, path);
  }
  for (const path of ['portfolio/index.html', 'links/index.html', 'lead/index.html']) {
    assert.match(read(path), /wedding photograph(?:er|y)/i, path);
  }
  for (const path of publicPages) {
    const visible = read(path).replace(/<script[\s\S]*?<\/script>/g, '');
    assert.doesNotMatch(visible, /\bluxury\b|award-winning|world.class|as seen (?:in|on)/i, path);
  }
  assert.doesNotMatch(script, teamLabels);
});

test('pages agree on price, coverage, reply time and editing', () => {
  assert.match(home, /Weddings start at\s*<\/p>\s*<p class="price-big">\$4,000<\/p>/);
  assert.match(home, /<li>The photographer you met, for every hour you book<\/li>/);
  assert.match(home, /<li>All photographs carefully edited, in high resolution<\/li>/);
  assert.match(home, /I answer every inquiry myself, within a few hours\./);
  assert.match(script, /I'll reply personally within a few hours\./);
  assert.match(script, /email me directly at contact@alex-claudio\.com/);
  for (const path of publicPages) {
    const source = read(path);
    assert.doesNotMatch(source, /24 hours|\$5,700|\$7,500|\$4,200|\$9,500/, path);
  }
});

test('the letter form posts the fields the inquiry endpoint expects', () => {
  const form = home.match(/<form class="letter-form"[\s\S]*?<\/form>/)[0];
  assert.match(form, /action="\/api\/submissions" data-endpoint="\/api\/submissions"/);
  assert.match(form, /<input type="hidden" name="form-name" value="contact">/);
  for (const name of ['names', 'event_date', 'location', 'email', 'company']) assert.match(form, new RegExp(`name="${name}"`), name);
  assert.match(form, /contact@alex-claudio\.com/);
});

test('older links into the homepage still land on the right section', () => {
  for (const id of ['letter', 'collections', 'contact', 'intro', 'reviews']) assert.match(home, new RegExp(`id="${id}"`), id);
  for (const path of ['links/index.html', 'lead/index.html']) {
    const source = read(path);
    assert.match(source, /href="\/#intro"/, path);
    assert.match(source, /href="\/#collections"/, path);
    assert.doesNotMatch(source, /href="\/#about"|href="\/pricing\/"/, path);
  }
});

test('the studio portraits are gone and couples\u2019 notes are unchanged', () => {
  assert.doesNotMatch(home, /studio-photographer-editorial|studio-alex-editorial|class="portraits"/);
  const portrait = home.match(/class="studio-portrait"[^>]*><img[^>]* src="(\/assets\/responsive\/studio-alex-solo-\d+\.webp)"/);
  assert.ok(portrait && existsSync(new URL(`..${portrait[1]}`, import.meta.url)), 'solo studio portrait');
  assert.match(home, /Alex moved through our day like a ghost with a camera/);
  assert.match(home, /We hired Alex for the pictures/);
  assert.doesNotMatch(home, /<cite|testimonial-author/);
});

test('no page loads trackers, third-party fonts or third-party scripts', () => {
  for (const path of publicPages) {
    const source = read(path);
    assert.doesNotMatch(source, /fbq\(|gtag\(|googletagmanager|connect\.facebook\.net|facebook\.com\/tr|marketing-tags|meta-pixel|consent\.js/, path);
    assert.doesNotMatch(source, /fonts\.googleapis|fonts\.gstatic|fonts\.cdnfonts|cdn\.jsdelivr|unpkg\.com/, path);
  }
  const privacy = read('privacy/index.html');
  assert.match(privacy, /sets no cookies/);
  assert.match(privacy, /runs no advertising/);
});

test('every public page counts its visits with the site\u2019s own script, as the privacy notice describes', () => {
  for (const path of publicPages) {
    assert.match(read(path), /<script src="\/assets\/visits\.js\?v=\d+" defer><\/script>\s*<\/head>/, path);
  }
  const counter = read('assets/visits.js');
  assert.doesNotMatch(counter, /document\.cookie|localStorage\.setItem|sessionStorage|indexedDB/, 'the page script saves nothing on the visitor\u2019s device');
  const privacy = read('privacy/index.html');
  assert.match(privacy, /<h2>Counting visits<\/h2>/);
  assert.match(privacy, /doesn&rsquo;t store your IP address/);
  assert.match(privacy, /deleted after 13 months/);
  assert.doesNotMatch(privacy, /runs no analytics/);
});
