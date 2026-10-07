import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const origin = 'https://alex-claudio.com';
const articles = ['seattle-wedding-rain-plan', 'how-many-hours-wedding-photography', 'wedding-photography-timeline', 'wedding-day-photography-tips'];
const text = html => html.replace(/<br\s*\/?\s*>/g, ' ').replace(/<[^>]+>/g, '').replace(/&rsquo;/g, '\u2019').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const meta = (html, attr, name) => (html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`)) || [])[1];

test('sitemap lists every search landing page once, with matching canonical and indexable HTML', () => {
  const urls = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.equal(urls.length, 9);
  assert.equal(new Set(urls).size, urls.length);
  for (const route of ['/', '/portfolio/', '/blog/', ...articles.map(slug => `/blog/${slug}/`), '/links/', '/privacy/']) {
    assert.ok(urls.includes(origin + route), route);
    const html = read(`${route.slice(1)}index.html`);
    assert.match(html, new RegExp(`rel="canonical" href="${origin + route}"`), route);
    assert.doesNotMatch(html, /<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i, route);
  }
  assert.ok(!urls.includes(origin + '/pricing/'));
  assert.ok(!urls.includes(origin + '/lead/'));
  assert.match(read('lead/index.html'), /name="robots" content="noindex, follow"/);
  assert.match(read('robots.txt'), /Sitemap: https:\/\/alex-claudio.com\/sitemap.xml/);
});

test('article markup matches the visible headline, date, author, photograph and breadcrumbs', () => {
  for (const slug of articles) {
    const html = read(`blog/${slug}/index.html`);
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const article = schema['@graph'].find(item => item['@type'] === 'BlogPosting');
    const breadcrumb = schema['@graph'].find(item => item['@type'] === 'BreadcrumbList');
    const canonical = `${origin}/blog/${slug}/`;
    assert.equal(article.mainEntityOfPage['@id'], canonical);
    assert.equal(article.headline, text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1]));
    assert.equal(article.image[0], meta(html, 'property', 'og:image'));
    assert.ok(existsSync(new URL(new URL(article.image[0]).pathname.slice(1), root)), article.image[0]);
    assert.match(html, /<figure class="a-cover[^"]*"[^>]*><img src="\/assets\/responsive\/[^"]+" [^>]*alt="[^"]+"/);
    assert.ok(html.includes(`By ${article.author.name}`));
    assert.ok(html.includes(`datetime="${article.datePublished.slice(0, 10)}"`));
    assert.ok(Date.parse(article.datePublished) <= Date.parse(article.dateModified));
    assert.ok(Date.parse(article.dateModified) <= Date.now());
    assert.deepEqual(breadcrumb.itemListElement.map(item => item.item), [origin + '/', origin + '/blog/', canonical]);
  }
});

test('public pages use clean URLs, one heading, unique titles and complete social cards', () => {
  const pages = ['index.html', 'portfolio/index.html', 'blog/index.html', 'privacy/index.html', ...articles.map(slug => `blog/${slug}/index.html`)];
  const titles = new Set();
  for (const page of pages) {
    const html = read(page);
    assert.doesNotMatch(html, /href="[^"\s]*index\.html/, page);
    assert.equal([...html.matchAll(/<h1[ >]/g)].length, 1, page);
    titles.add(html.match(/<title>([^<]+)<\/title>/)[1]);
    for (const [attr, name] of [['name', 'description'], ['property', 'og:title'], ['property', 'og:description'], ['property', 'og:url'], ['property', 'og:image'], ['name', 'twitter:card']]) {
      assert.ok(meta(html, attr, name), `${page} ${name}`);
    }
    assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon.svg">/, page);
  }
  assert.equal(titles.size, pages.length);
  assert.match(read('index.html'), /<title>Seattle Wedding Photographers/);
  const business = JSON.parse(read('index.html').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(business['@id'], `${origin}/#business`);
  assert.match(business.description, /\$4,000/);
});
