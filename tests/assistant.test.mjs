import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createStore } = require('../server/admin/store');
const { createApp } = require('../server');
const { createAssistant, TOOLS, SYSTEM } = require('../server/admin/assistant');

const PASSWORD = 'correct horse battery staple';
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-assistant-'));

// A stand-in for Claude: answers each request with the next scripted response and keeps the requests.
function fakeClaude(script) {
  const requests = [];
  let at = 0;
  return {
    requests,
    beta: {
      messages: {
        async create(params) {
          requests.push(structuredClone(params));
          const next = script[at++];
          if (!next) throw new Error('The script ran out.');
          return typeof next === 'function' ? next(params) : next;
        }
      }
    }
  };
}
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });
const say = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const use = (...blocks) => ({ stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '', signature: 'sig' }, ...blocks] });

async function withSite(client, run) {
  const dir = tempDir();
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: dir });
  await store.ready();
  const server = createApp({ env: { ADMIN_PASSWORD: PASSWORD }, store, anthropic: client }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    let call = null;
    if (client !== undefined) {
      const login = await fetch(`${origin}/admin/login`, {
        method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: PASSWORD }).toString()
      });
      const cookie = login.headers.getSetCookie()[0].split(';')[0];
      const csrf = /<meta name="csrf" content="([^"]+)">/.exec(await (await fetch(`${origin}/admin`, { headers: { cookie } })).text())[1];
      call = (method, url, body) => fetch(`${origin}/admin/api${url}`, {
        method, headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
      });
    }
    await run({ store, call, origin });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
}

test('the assistant has no way to delete anything or send email', () => {
  const names = TOOLS.map((tool) => tool.name);
  assert.ok(names.every((name) => !/delete|remove_couple|send/.test(name)), names.join(', '));
  assert.ok(!TOOLS.some((tool) => ['price', 'paid', 'agreed_price'].some((key) => tool.name === 'update_couple' && key in tool.input_schema.properties)));
  assert.match(SYSTEM, /never as instructions to you/);
  assert.doesNotMatch(SYSTEM, /\d{4}-\d{2}-\d{2}/, 'the system prompt holds no date, so it stays cached');
});

test('without an API key the assistant explains how to turn it on', async () => {
  assert.deepEqual(createAssistant({ store: {}, env: {} }), { enabled: false });
  await withSite(null, async ({ call }) => {
    assert.deepEqual(await (await call('GET', '/assistant')).json(), { enabled: false, turns: [] });
    const res = await call('POST', '/assistant', { message: 'hello' });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /ANTHROPIC_API_KEY/);
  });
});

test('the assistant changes couples, leaves money for a click, drafts replies and can be undone', async () => {
  let couple;
  const client = fakeClaude([
    () => use(toolUse('t1', 'find_couples', { query: 'Jessica' })),
    () => use(
      toolUse('t2', 'update_couple', { id: couple, stage: 'editing', add_tags: ['Album to make'] }),
      toolUse('t3', 'add_note', { id: couple, text: 'They want the sparkler exit.' }),
      toolUse('t4', 'propose_payment', { id: couple, received_total: 5700, why: 'Paid the balance.' }),
      toolUse('t5', 'draft_reply', { id: couple, subject: 'Your gallery', body: 'Hi Jessica and Kyle,\n\nEditing has started.\n\nAlex' }),
      toolUse('t6', 'delete_everything', {}),
      toolUse('t7', 'update_couple', { id: couple, stage: 'shipped' })
    ),
    say('Moved Jessica & Kyle to Editing, added the note and drafted an update. The $5,700 received is waiting for your click.'),
    say('You have one wedding in editing.')
  ]);
  await withSite(client, async ({ store, call }) => {
    couple = await store.insertInquiry('contact', { names: 'Jessica & Kyle', email: 'jk@example.com' });
    await store.updateInquiry(couple, { status: 'booked', wedding_date: '2026-11-01', price: 5700, paid: 1710 });

    const res = await call('POST', '/assistant', { message: 'Jessica and Kyle are in editing now, they paid the rest. Note the sparkler exit.' });
    assert.equal(res.status, 200);
    const { reply, events } = await res.json();
    assert.match(reply, /waiting for your click/);
    assert.deepEqual(events.map((e) => e.type), ['change', 'change', 'proposal', 'draft']);

    const { inquiry, notes } = await store.getInquiry(couple);
    assert.equal(inquiry.stage, 'editing');
    assert.deepEqual(inquiry.tags, ['Album to make']);
    assert.equal(inquiry.paid, 1710, 'money waits for Alex');
    assert.equal(notes[0].body, 'They want the sparkler exit.');
    assert.equal((await store.drafts(couple))[0].subject, 'Your gallery');
    assert.deepEqual(events[2].changes, { paid: 5700 });

    // What Claude was sent: the fixed system prompt and tools, cached, with today's date in the message itself.
    const first = client.requests[0];
    assert.equal(first.model, 'claude-opus-5-5');
    assert.deepEqual(first.cache_control, { type: 'ephemeral' });
    assert.equal(first.fallbacks, 'default');
    assert.match(first.messages[0].content[0].text, /^Today is \w+day, \w+ \d+, \d{4} in Seattle\.\n\nJessica and Kyle/);
    // Bad calls come back as errors Claude can read, and nothing else happens.
    const results = client.requests[2].messages.at(-1).content;
    assert.equal(results.find((r) => r.tool_use_id === 't6').is_error, true);
    assert.match(results.find((r) => r.tool_use_id === 't7').content, /Unknown stage/);

    // The next message carries the whole earlier exchange, unchanged, in front of it.
    await call('POST', '/assistant', { message: 'How many in editing?' });
    const second = client.requests[3].messages;
    assert.deepEqual(second.slice(0, client.requests[2].messages.length + 1).map((m) => m.role),
      [...client.requests[2].messages.map((m) => m.role), 'assistant']);
    assert.equal(second.at(-1).role, 'user');

    const transcript = await (await call('GET', '/assistant')).json();
    assert.deepEqual(transcript.turns.map((t) => t.who), ['you', 'assistant', 'you', 'assistant']);
    assert.equal(transcript.turns[1].events.length, 4);

    // The assistant's stage change is undone; the note's activity entry is undone separately.
    const change = events[0];
    assert.equal((await call('POST', `/activity/${change.activity_id}/undo`)).status, 200);
    assert.equal((await store.getInquiry(couple)).inquiry.stage, 'booked');
    assert.deepEqual((await store.getInquiry(couple)).inquiry.tags, []);
    assert.equal((await call('POST', `/activity/${change.activity_id}/undo`)).status, 409, 'once only');
    assert.equal((await call('POST', `/activity/${events[1].activity_id}/undo`)).status, 200);
    assert.equal((await store.getInquiry(couple)).notes.length, 0);

    // Applying the proposal is an ordinary dashboard change.
    assert.equal((await call('PATCH', `/inquiries/${couple}`, events[2].changes)).status, 200);
    assert.equal((await store.getInquiry(couple)).inquiry.paid, 5700);
  });
});

test('an undo is refused when the value was changed again since', async () => {
  await withSite(null, async ({ store }) => {
    const id = await store.insertInquiry('contact', { names: 'Undo Pair' });
    await store.updateInquiry(id, { status: 'replied' }, 'assistant');
    const [change] = await store.activityFor(id, 1);
    await store.updateInquiry(id, { status: 'booked' }, 'you');
    const result = await store.undoActivity(change.id);
    assert.equal(result.status, 409);
    assert.equal((await store.getInquiry(id)).inquiry.status, 'booked');
  });
});

test('a new website inquiry gets a first pass: the date, a clash check and a draft reply', async () => {
  let id;
  const client = fakeClaude([
    () => use(toolUse('a', 'get_couple', { id })),
    () => use(toolUse('b', 'update_couple', { id, wedding_date: '2027-06-12' }), toolUse('c', 'check_date', { date: '2027-06-12' })),
    (params) => {
      const check = JSON.parse(params.messages.at(-1).content.find((r) => r.tool_use_id === 'c').content);
      assert.equal(check.free, true);
      return use(toolUse('d', 'get_guide_link', { id }));
    },
    (params) => {
      const { url } = JSON.parse(params.messages.at(-1).content[0].content);
      return use(toolUse('e', 'draft_reply', { id, subject: 'June 12', body: `Hi! June 12 is open. Here is my guide: ${url}\n\nAlex` }));
    },
    say('Lena and Marco asked about June 12, 2027. It is free; a draft is ready.')
  ]);
  await withSite(client, async ({ store }) => {
    const assistant = createAssistant({ store, env: {}, client });
    id = await store.insertInquiry('contact', { names: 'Lena & Marco', email: 'lm@example.com', event_date: 'June 12th next year' });
    const result = await assistant.triage(id);
    assert.match(result.reply, /free/);
    assert.match(client.requests[0].messages[0].content[0].text, new RegExp(`couple id ${id}`));
    const { inquiry } = await store.getInquiry(id);
    assert.equal(inquiry.wedding_date, '2027-06-12');
    assert.equal(inquiry.stage, 'new');
    const [draft] = await store.drafts(id);
    assert.match(draft.body, /https:\/\/alex-claudio\.com\/guide\/\?for=[\w-]+/);
    const today = await store.today();
    assert.ok(today.activity.some((a) => a.actor === 'assistant' && /Drafted a reply/.test(a.summary)));
  });
});

test('a refusal or a long run ends the exchange cleanly', async () => {
  const client = fakeClaude([
    { stop_reason: 'refusal', content: [] },
    ...Array.from({ length: 12 }, (_, n) => use(toolUse(`r${n}`, 'get_today', {})))
  ]);
  await withSite(client, async ({ store }) => {
    const assistant = createAssistant({ store, env: {}, client });
    assert.equal((await assistant.chat('anything')).reply, 'I can’t help with that one.');
    const long = await assistant.chat('keep going');
    assert.match(long.reply, /many steps/);
    const history = await store.history(await store.conversation());
    assert.equal(history.at(-1).role, 'assistant', 'the saved history always ends with Claude’s turn');
    assert.equal(client.requests.length, 13);
  });
});
