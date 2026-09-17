import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const home = read('index.html');
const pricing = read('pricing/index.html');
const script = read('script.js');
const offers = JSON.parse(pricing.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])
  .hasOfferCatalog.itemListElement;

test('public marketing copy describes the photography team without relationship labels', () => {
  const relationshipLabels = /husband[\s-]+and[\s-]+wife|partners in life/i;
  for (const path of ['index.html', 'pricing/index.html', 'portfolio/index.html', 'links/index.html', 'lead/index.html']) {
    const source = read(path);
    assert.match(source, /wedding photograph(?:ers|y)/i, path);
    assert.doesNotMatch(source, relationshipLabels, path);
    assert.doesNotMatch(source, /\bluxury\b/i, path);
    assert.doesNotMatch(source, /Alex \+ a second photographer|joins me for every|Tell me about|email me directly|I.ll send availability/, path);
    assert.match(source, /script\.js\?v=38/, path);
    assert.match(source, /<link rel="icon" type="image\/svg\+xml" href="(?:\.\.\/)?logo-badge\.svg">/, path);
  }
  assert.doesNotMatch(script, relationshipLabels);
  assert.match(home, /We Photographed weddings since 2014/);
  assert.match(home, /Every collection includes both of us for the full coverage/);
  assert.match(pricing, /Two photographers\. Every collection\./);
});

test('studio introduction uses both approved portraits without name captions', () => {
  const intro = home.match(/<section class="intro"[\s\S]*?<\/section>/)[0];
  const portraits = [...intro.matchAll(/<img src="([^"]+)"[^>]*width="(\d+)" height="(\d+)"/g)];
  assert.deepEqual(portraits.map(([, src, width, height]) => [src, width, height]), [
    ['assets/studio/photographer-editorial.jpg', '1588', '2457'],
    ['assets/studio/alex-editorial.jpg', '910', '1402'],
  ]);
  for (const [, src] of portraits) {
    const image = readFileSync(new URL(`../${src}`, import.meta.url));
    assert.equal(image.readUInt16BE(0), 0xffd8, `${src} is a JPEG`);
  }
  assert.doesNotMatch(intro, /<figcaption|src="photographer\.jpg"/);
});

test('collection prices agree across cards, inquiry options, and structured offers', () => {
  const expected = [['essential', 'Essential', 4000], ['signature', 'Signature', 5700], ['heirloom', 'Heirloom', 7500]];
  assert.equal(offers.length, expected.length);
  for (const [id, name, price] of expected) {
    const amount = `$${price.toLocaleString('en-US')}`;
    const card = pricing.match(new RegExp(`<article[^>]*id="${id}"[\\s\\S]*?</article>`))[0];
    const option = home.match(new RegExp(`<option value="${id}">([^<]+)</option>`))[1];
    assert.ok(card.includes(`<p class="pricing-price">${amount}</p>`));
    assert.ok(option.includes(amount));
    const offer = offers.find((item) => item.name === name);
    assert.equal(Number(offer.price), price);
    assert.equal(offer.priceCurrency, 'USD');
    assert.ok(offer.url.endsWith(`#${id}`));
    assert.match(offer.description, /with two photographers/);
  }
  assert.doesNotMatch(home + pricing, /\$4,200|\$9,500|"4200"|"9500"/);
});

test('both photographers cover all hours and only Heirloom includes engagement', () => {
  for (const [id, hours] of [['essential', 6], ['signature', 8], ['heirloom', 10]]) {
    const card = pricing.match(new RegExp(`<article[^>]*id="${id}"[\\s\\S]*?</article>`))[0];
    assert.ok(card.includes(`${hours} consecutive hours`));
    assert.ok(card.includes(`<strong>Both of us photographing</strong> for all ${hours} hours`));
    assert.match(card, id === 'heirloom' ? /60-minute engagement session included/ : /Engagement session available as an add-on/);
    assert.ok(card.includes(`/?collection=${id}#contact`));
  }
  assert.match(pricing, /15 spreads \/ 30 pages, with custom design/);
  assert.match(pricing, /20 spreads \/ 40 pages, with custom design/);
  assert.doesNotMatch(pricing, /90-minute|30 spreads \/ 60 pages/);
});

test('inquiry feedback speaks for the team without altering past client quotes', () => {
  assert.match(script, /We'll respond personally within 24 hours/);
  assert.match(script, /email us directly at contact@alex-claudio\.com/);
  assert.doesNotMatch(script, /I received it|for my reply|so I can send details/);
  assert.match(home, /Alex moved through our day/);
  assert.match(home, /We hired Alex for the pictures/);
  assert.doesNotMatch(home, /<cite|testimonial-author|testimonial-meta/);
});

test('supporting navigation targets the actual team section', () => {
  assert.match(home, /id="intro"/);
  for (const path of ['links/index.html', 'lead/index.html']) {
    const source = read(path);
    assert.match(source, /href="\/#intro"/);
    assert.doesNotMatch(source, /href="\/#about"/);
  }
});

test('editorial presentation keeps original images, anonymous notes, and the agreed collections', () => {
  assert.match(home, /Seattle wedding<br><em>photography\.<\/em>/);
  assert.match(home, /An editorial eye\.<br>A personal approach\./);
  assert.ok(home.indexOf('id="selected-work"') < home.indexOf('id="intro"'));
  const gallery = home.match(/<section class="mosaic-section"[\s\S]*?<\/section>/)[0];
  const galleryImages = [...gallery.matchAll(/<img src="([^"]+)"/g)].map(match => match[1]);
  const heroImage = home.match(/<img class="hero-img" src="([^"]+)"/)[1];
  assert.equal(galleryImages.length, 6);
  assert.equal(new Set([heroImage, ...galleryImages]).size, 7);
  assert.ok(galleryImages.every(src => src.startsWith('assets/home/')));
  assert.doesNotMatch(gallery, /<figcaption|<span|title=/);
  assert.doesNotMatch(home, /as seen (?:in|on)|award-winning|world.class|limited weddings/i);
  for (const path of ['index.html', 'pricing/index.html', 'portfolio/index.html']) {
    const source = read(path);
    assert.match(source, /editorial\.css\?v=4/, path);
    assert.match(source, />The studio<\/a>/, path);
  }
});
