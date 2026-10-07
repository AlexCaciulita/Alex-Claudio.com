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
  'links/index.html', 'lead/index.html', 'gallery/index.html', 'AlexClaudioVentures/index.html'
];

test('marketing copy describes the team, with the relationship context only on the homepage', () => {
  const relationshipLabels = /husband[\s-]+and[\s-]+wife|partners in life/i;
  assert.match(home, /husband-and-wife team from Seattle/);
  for (const path of ['portfolio/index.html', 'links/index.html', 'lead/index.html']) {
    const source = read(path);
    assert.match(source, /wedding photograph(?:ers|y)/i, path);
    assert.doesNotMatch(source, relationshipLabels, path);
  }
  for (const path of publicPages) {
    const visible = read(path).replace(/<script[\s\S]*?<\/script>/g, '');
    assert.doesNotMatch(visible, /\bluxury\b|award-winning|world.class|as seen (?:in|on)/i, path);
  }
  assert.doesNotMatch(script, relationshipLabels);
});

test('pages agree on price, coverage, reply time and editing', () => {
  assert.match(home, /Weddings start at\s*<\/p>\s*<p class="price-big">\$4,000<\/p>/);
  assert.match(home, /<li>Both of us, for every hour you book<\/li>/);
  assert.match(home, /<li>Every photograph edited by us, in high resolution<\/li>/);
  assert.match(home, /While you get ready in separate rooms, one of us stays with each of you\./);
  assert.match(home, /We answer every inquiry ourselves, within a few hours\./);
  assert.match(script, /We'll reply personally within a few hours\./);
  assert.match(script, /email us directly at contact@alex-claudio\.com/);
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

test('studio portraits and couples\u2019 notes are unchanged', () => {
  for (const name of ['studio-photographer-editorial', 'studio-alex-editorial']) {
    const src = home.match(new RegExp(`src="(/assets/responsive/${name}-\\d+\\.webp)"`))[1];
    assert.ok(existsSync(new URL(`..${src}`, import.meta.url)), src);
  }
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
  assert.match(privacy, /no analytics/);
});
