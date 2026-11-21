import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const page = read('guide/index.html');
const script = read('guide/guide.js');
const prices = JSON.parse(page.match(/<script type="application\/json" id="guide-prices">([\s\S]*?)<\/script>/)[1]);
const money = (n) => '$' + n.toLocaleString('en-US');
const hoursPrice = (h) => prices.base + (h - prices.baseHours) * prices.perHour;
const packagePrice = ({ hours, session, album }) => hoursPrice(hours) + (session ? prices.session : 0) + (album ? prices.albums[album] : 0);

test('the pricing guide adds up: collections, hours and add-ons agree with the price list', () => {
  assert.equal(packagePrice(prices.collections.essential), 4000);
  assert.equal(packagePrice(prices.collections.signature), 5700);
  assert.equal(packagePrice(prices.collections.heirloom), 7500);

  for (const [key, collection] of Object.entries(prices.collections)) {
    const card = page.match(new RegExp(`<h3>${collection.name}</h3>\\s*<p class="col-price">([^<]+)</p>\\s*<p class="col-hours mono">(\\d+) hours`));
    assert.ok(card, key);
    assert.equal(card[1], money(packagePrice(collection)), key);
    assert.equal(Number(card[2]), collection.hours, key);
    assert.match(page, new RegExp(`data-start="${key}"`), key);
  }

  const hourLabels = [...page.matchAll(/<input type="radio" name="hours" value="(\d+)"[^>]*><span class="hour-n">\d+<\/span><span class="hour-p">([^<]+)<\/span>/g)];
  assert.deepEqual(hourLabels.map((m) => Number(m[1])), [6, 7, 8, 9, 10, 11, 12]);
  for (const [, hours, label] of hourLabels) assert.equal(label, money(hoursPrice(Number(hours))), `${hours} hours`);
  assert.equal(prices.maxHours, 12);

  assert.match(page, new RegExp(`60 minutes &middot; \\${money(prices.session)}`));
  for (const [size, price] of Object.entries(prices.albums)) {
    assert.match(page, new RegExp(`value="${size}">[\\s\\S]*?<span class="opt-meta">\\${money(price)}</span>`), `${size} in album`);
  }
  assert.match(page, /\$4,000 for six hours, then \$500 for each extra hour, up to twelve hours in all\./);

  // A second photographer comes with every package of eight hours or more, at no extra cost.
  assert.equal(prices.secondFromHours, 8);
  const cardList = (name) => page.match(new RegExp(`<h3>${name}</h3>[\\s\\S]*?<ul class="col-list">([\\s\\S]*?)</ul>`))[1];
  assert.doesNotMatch(cardList('Essential'), /Second photographer/);
  assert.match(cardList('Signature'), /<li>Second photographer, or \$1,000 less without<\/li>/);
  assert.match(cardList('Heirloom'), /<li>Second photographer, or \$1,000 less without<\/li>/);
  assert.match(script, /state\.hours >= P\.secondFromHours/);

  // From eight hours the second photographer can be left out for $1,000 off.
  assert.equal(prices.secondPhotographer, 1000);
  const withoutSecond = (c) => packagePrice(c) - prices.secondPhotographer;
  assert.equal(withoutSecond(prices.collections.signature), 4700);
  assert.equal(withoutSecond(prices.collections.heirloom), 6500);
  assert.match(script, /price: -P\.secondPhotographer/);
  assert.match(script, /q\.get\('p'\) === '0'/);
  assert.match(page, /<input type="checkbox" name="second" id="second" checked>/);
});

test('the pricing guide is a private link: not indexed and not in the sitemap', () => {
  assert.match(page, /<meta name="robots" content="noindex, follow">/);
  assert.match(page, /<link rel="canonical" href="https:\/\/alex-claudio.com\/guide\/">/);
  assert.doesNotMatch(read('sitemap.xml'), /\/guide\//);
  const visible = page.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.doesNotMatch(visible, /\bluxury\b|award-winning|world.class|as seen (?:in|on)/i);
});

test('the pricing guide speaks for Alex alone, like the rest of the site', () => {
  const teamLabels = /husband[\s-]+and[\s-]+wife|partners in life|photography team|two photographers|both photographers|one of us|both of us|two of us/i;
  assert.doesNotMatch(page, teamLabels);
  assert.doesNotMatch(script, teamLabels);
  assert.doesNotMatch(page, /Write to us|Send us|send it to us|edited by us|designed by us/);
  assert.match(page, /I answer every inquiry myself, within a few hours\./);
  assert.match(page, /Your gallery arrives within six weeks of the wedding\./);
  assert.match(page, /Your date is reserved once you sign the agreement and pay a 30% retainer\./);
  assert.doesNotMatch(page + script, /every hour you book|for every hour|With me for every hour/);
  assert.match(page, /<p>Hello, Alex\.<\/p>/);
  assert.match(page, /\/assets\/responsive\/studio-alex-solo-800\.webp/);
});

test('the pricing guide letter posts what the inquiry endpoint expects, with the package in the message', () => {
  const form = page.match(/<form class="letter-form"[\s\S]*?<\/form>/)[0];
  assert.match(form, /action="\/api\/submissions" data-endpoint="\/api\/submissions"/);
  assert.match(form, /<input type="hidden" name="form-name" value="contact">/);
  for (const name of ['names', 'event_date', 'location', 'email', 'company']) assert.match(form, new RegExp(`name="${name}"`), name);
  assert.match(script, /data\.set\('form-name', 'contact'\)/);
  assert.match(script, /data\.set\('message', message\(\)\)/);
  assert.match(script, /'Package from the pricing guide\\n'/);

  // A couple's own link (?for=<code>) skips their details and sends only the package to their inquiry.
  assert.equal((form.match(/<p class="guest">/g) || []).length, 2);
  assert.match(form, /<p class="personal" hidden>We&rsquo;re <span id="personalNames"><\/span>\.<\/p>/);
  assert.match(script, /fetch\('\/api\/guide\/' \+ forCode/);
  assert.match(page, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
});

test('every file the pricing guide loads from the site exists', () => {
  const refs = new Set();
  for (const [, value] of page.matchAll(/(?:src|href|imagesrcset|srcset)="([^"]+)"/g)) {
    for (const part of value.split(',')) {
      const url = part.trim().split(/\s+/)[0];
      if (url.startsWith('/') && !url.startsWith('//')) refs.add(url.split(/[?#]/)[0]);
    }
  }
  const files = [...refs].filter((url) => !url.endsWith('/'));
  assert.ok(files.length > 10);
  for (const url of files) assert.ok(existsSync(new URL(`..${url}`, import.meta.url)), url);
});

test('the server answers /guide/ and its files', async () => {
  const require = createRequire(import.meta.url);
  const { createApp } = require('../server');
  const server = createApp({ store: null }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await fetch(`${origin}/guide/`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);

    const bare = await fetch(`${origin}/guide?c=signature`, { redirect: 'manual' });
    assert.equal(bare.status, 301);
    assert.equal(bare.headers.get('location'), '/guide/?c=signature');

    for (const file of ['/guide/guide.js', '/guide/guide.css', '/guide/ink.js']) {
      assert.equal((await fetch(`${origin}${file}`)).status, 200, file);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
