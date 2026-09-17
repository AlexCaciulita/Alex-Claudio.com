import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const origin = 'https://alex-claudio.com';
const articles = ['seattle-wedding-rain-plan', 'how-many-hours-wedding-photography', 'wedding-photography-timeline'];
const text = html => html.replace(/<br\s*\/?\s*>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

test('sitemap contains every search landing page once, with matching canonical and indexable HTML', () => {
  const urls = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.equal(urls.length, 8);
  assert.equal(new Set(urls).size, urls.length);
  for (const route of ['/', '/portfolio/', '/pricing/', '/blog/', ...articles.map(slug => `/blog/${slug}/`), '/links/']) {
    assert.ok(urls.includes(origin + route), route);
    const html = read(`${route.slice(1)}index.html`);
    assert.match(html, new RegExp(`rel="canonical" href="${origin + route}"`));
    assert.doesNotMatch(html, /<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i);
  }
  assert.ok(!urls.includes(origin + '/lead/'));
  assert.match(read('lead/index.html'), /name="robots" content="noindex, follow"/);
  assert.match(read('robots.txt'), /Sitemap: https:\/\/alex-claudio.com\/sitemap.xml/);
});

test('article markup matches visible authors, dates, headline, photograph and breadcrumbs', () => {
  for (const slug of articles) {
    const html = read(`blog/${slug}/index.html`);
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const article = schema['@graph'].find(item => item['@type'] === 'BlogPosting');
    const breadcrumb = schema['@graph'].find(item => item['@type'] === 'BreadcrumbList');
    const canonical = `${origin}/blog/${slug}/`;
    assert.equal(article.mainEntityOfPage['@id'], canonical);
    assert.equal(article.headline, text(html.match(/<h1>([\s\S]*?)<\/h1>/)[1]));
    const image = html.match(/class="cover-photo" src="([^"]+)"/)[1];
    assert.equal(article.image[0], new URL(image, canonical).href);
    assert.ok(html.includes(`By ${article.author.name}`));
    assert.ok(html.includes(`datetime="${article.datePublished.slice(0, 10)}"`));
    assert.ok(Date.parse(article.datePublished) <= Date.parse(article.dateModified));
    assert.ok(Date.parse(article.dateModified) <= Date.now());
    assert.deepEqual(breadcrumb.itemListElement.map(item => item.item), [origin + '/', origin + '/blog/', canonical]);
  }
});

test('main pages and homepage planning section link directly to canonical Journal URLs', () => {
  for (const page of ['index.html', 'portfolio/index.html', 'pricing/index.html', 'blog/index.html', ...articles.map(slug => `blog/${slug}/index.html`)]) {
    const html = read(page);
    assert.doesNotMatch(html, /href="[^"\s]*index\.html/);
    assert.equal([...html.matchAll(/<h1[ >]/g)].length, 1, page);
    assert.match(html, /<title>[^<]+<\/title>/);
  }
  const home = read('index.html');
  for (const slug of articles) assert.ok(home.includes(`href="blog/${slug}/"`));
  assert.match(home, /Seattle wedding<br><em>photography/);
});
