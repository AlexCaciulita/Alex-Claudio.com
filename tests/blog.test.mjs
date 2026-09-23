import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const slugs = ['seattle-wedding-rain-plan', 'how-many-hours-wedding-photography', 'wedding-photography-timeline', 'wedding-day-photography-tips'];
const pages = ['blog/index.html', ...slugs.map(slug => `blog/${slug}/index.html`)];
const read = path => readFileSync(new URL(path, root), 'utf8');

test('journal pages have local navigation, real photos, and unique page metadata', () => {
  const titles = new Set();
  for (const path of pages) {
    const html = read(path);
    assert.equal([...html.matchAll(/<h1[ >]/g)].length, 1, path);
    titles.add(html.match(/<title>([^<]+)<\/title>/)[1]);
    assert.match(html, /<meta name="description" content="[^"]+">/);
    assert.match(html, /href="https:\/\/alex-claudio.com\/blog\//);
    assert.match(html, /journal\.css\?v=3/);
    const images = [...html.matchAll(/<img[^>]+src="([^"]+)"[^>]+alt="([^"]+)"/g)];
    const expectedImageCount = path === 'blog/index.html' ? 4 : 1;
    assert.equal(images.length, expectedImageCount, path);
    assert.equal(new Set(images.map(image => image[1])).size, images.length, `No duplicate images on ${path}`);
    for (const [, source] of images) assert.ok(existsSync(new URL(source, new URL(path, root))), source);
    for (const [, source] of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      if (/^https?:/.test(source)) continue;
      assert.ok(existsSync(new URL(source.split(/[?#]/)[0], new URL(path, root))), `${path}: ${source}`);
    }
  }
  assert.equal(titles.size, pages.length);
});

test('every article has valid section links and two related stories', () => {
  for (const slug of slugs) {
    const html = read(`blog/${slug}/index.html`);
    const anchors = [...html.matchAll(/href="#(section-\d+)"/g)];
    assert.ok(anchors.length >= 5);
    for (const [, id] of anchors) assert.ok(html.includes(`id="${id}"`), id);
    assert.equal([...html.matchAll(/class="journal-story"/g)].length, 2);
    assert.doesNotMatch(html, /<figcaption|title=".*(?:Wedding Day|Session)/);
  }
});

test('coverage article keeps the agreed prices and full-team coverage', () => {
  const html = read('blog/how-many-hours-wedding-photography/index.html');
  for (const amount of ['$4,000', '$5,700', '$7,500']) assert.ok(html.includes(amount));
  assert.match(html, /both of us photographing throughout the booked coverage/);
  assert.match(html, /15 spreads \/ 30 pages/);
  assert.match(html, /20 spreads \/ 40 pages/);
  assert.match(html, /60-minute engagement session/);
  assert.match(html, /class="journal-table"/);
});

test('main pages link to the journal without changing their shared presentation', () => {
  for (const path of ['index.html', 'pricing/index.html', 'portfolio/index.html']) {
    const html = read(path);
    assert.match(html, /href="(?:\.\.\/)?blog\/" class="nav-link">Journal/);
    assert.match(html, /href="(?:\.\.\/)?blog\/" class="mobile-nav-link">Journal/);
    assert.match(html, /editorial\.css\?v=5/);
  }
});
