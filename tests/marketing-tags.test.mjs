import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../marketing-tags.js', import.meta.url), 'utf8');

function browser(readyState = 'loading', idle = true) {
  const events = {};
  const scripts = [];
  const scheduled = [];
  const window = {
    addEventListener(name, callback) { events[name] = callback; },
    setTimeout(callback) { scheduled.push(callback); },
    ...(idle ? { requestIdleCallback(callback) { scheduled.push(callback); } } : {}),
  };
  const document = {
    readyState,
    createElement() { return {}; },
    head: { appendChild(script) { scripts.push(script); } },
  };
  runInNewContext(source, { window, document });
  return { window, events, scripts, scheduled };
}

test('pageview and early inquiry events remain queued until tracking scripts load', () => {
  const b = browser();
  b.window.gtag('event', 'generate_lead', { collection: 'signature' });
  b.window.fbq('track', 'Lead', { value: 5700, currency: 'USD' });
  assert.equal(b.scripts.length, 0);
  assert.deepEqual(b.window.dataLayer.map(args => args[0]).join(','), 'js,config,config,event');
  assert.equal(b.window.dataLayer.at(-1)[1], 'generate_lead');
  assert.equal(b.window.fbq.queue.filter(args => args[1] === 'PageView').length, 1);
  assert.equal(b.window.fbq.queue.at(-1)[1], 'Lead');
  b.events.load();
  assert.equal(b.scripts.length, 0);
  b.scheduled[0]();
  assert.equal(b.scripts.length, 2);
  assert.ok(b.scripts.every(script => script.async));
  assert.match(b.scripts[0].src, /AW-979140720/);
  assert.match(b.scripts[1].src, /fbevents\.js/);
  b.events.pagehide();
  assert.equal(b.scripts.length, 2);
});

test('tracking loads on completed pages and without requestIdleCallback', () => {
  for (const idle of [true, false]) {
    const b = browser('complete', idle);
    assert.equal(b.scheduled.length, 1);
    b.scheduled[0]();
    assert.equal(b.scripts.length, 2);
  }
});

test('a quick exit starts loading queued tracking without duplicate pageview events', () => {
  const b = browser();
  b.events.pagehide();
  assert.equal(b.scripts.length, 2);
  b.events.load();
  b.scheduled[0]();
  assert.equal(b.scripts.length, 2);
  assert.equal(b.window.fbq.queue.filter(args => args[1] === 'PageView').length, 1);
});
