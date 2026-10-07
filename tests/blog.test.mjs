import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const slugs = ['seattle-wedding-rain-plan', 'how-many-hours-wedding-photography', 'wedding-photography-timeline', 'wedding-day-photography-tips'];
const pages = ['blog/index.html', ...slugs.map(slug => `blog/${slug}/index.html`)];
const read = path => readFileSync(new URL(path, root), 'utf8');
const markup = html => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');

test('journal pages link only to files and pages that exist', () => {
  for (const path of pages) {
    const html = markup(read(path));
    for (const [, source] of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      if (/^(?:https?:|mailto:|data:)/.test(source)) continue;
      assert.ok(source.startsWith('/'), `${path}: relative link ${source}`);
      const file = source.split('?')[0].replace(/\/$/, '/index.html').slice(1);
      assert.ok(existsSync(new URL(file, root)), `${path}: ${source}`);
    }
    for (const [, set] of html.matchAll(/srcset="([^"]+)"/g)) {
      for (const candidate of set.split(',')) {
        const url = candidate.trim().split(/\s+/)[0];
        assert.ok(existsSync(new URL(url.slice(1), root)), `${path}: ${url}`);
      }
    }
    for (const [tag] of html.matchAll(/<img [^>]*>/g)) assert.match(tag, /alt="/, `${path}: image without alt`);
  }
});

test('every article has working section links and two related stories', () => {
  for (const slug of slugs) {
    const html = read(`blog/${slug}/index.html`);
    const anchors = [...html.matchAll(/href="#(section-\d+|part-\d+)"/g)];
    assert.ok(anchors.length >= 5, slug);
    for (const [, id] of anchors) assert.ok(html.includes(`id="${id}"`), `${slug}: ${id}`);
    assert.equal([...html.matchAll(/class="card-link"/g)].length, 2, slug);
  }
  const index = read('blog/index.html');
  for (const slug of slugs) assert.ok(index.includes(`href="/blog/${slug}/"`), slug);
});

test('coverage article matches the starting-at pricing and full-team coverage', () => {
  const html = read('blog/how-many-hours-wedding-photography/index.html');
  assert.match(html, /Weddings start at \$4,000/);
  assert.match(html, /both of us photographing the whole time/);
  assert.match(html, /While you get ready in separate rooms, one of us stays with each of you/);
  assert.match(html, /personal printing rights/);
  assert.doesNotMatch(html, /\$5,700|\$7,500|Essential|Signature|Heirloom|When access and timing allow/);
});

test('every public page links to the Journal and the privacy notice', () => {
  for (const path of ['index.html', 'portfolio/index.html', 'privacy/index.html', ...pages]) {
    const html = read(path);
    assert.match(html, /<a href="\/blog\/"[^>]*>Journal<\/a>/, path);
    assert.match(html, /<a href="\/privacy\/">Privacy<\/a>/, path);
  }
});
