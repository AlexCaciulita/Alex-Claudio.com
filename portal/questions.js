// The wedding questionnaire couples fill in on their page. Shared by the page, the dashboard (which
// shows the answers) and the server (which keeps only these answers, each in its own shape).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Questionnaire = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // type: text, long (several lines), time (HH:MM), choice (with options), number, list (one per line)
  const SECTIONS = [
    {
      title: 'The two of you',
      questions: [
        { key: 'names_full', label: 'Your full names', type: 'text', hint: 'As you’d like them in the gallery.' },
        { key: 'phones', label: 'Your phone numbers on the day', type: 'text' },
        { key: 'story', label: 'How you met, in a sentence or two', type: 'long', optional: true }
      ]
    },
    {
      title: 'Where and when',
      questions: [
        { key: 'getting_ready_1', label: 'Where the first of you is getting ready', type: 'text', hint: 'Address or hotel and room.' },
        { key: 'getting_ready_2', label: 'Where the second of you is getting ready', type: 'text', optional: true },
        { key: 'ceremony_time', label: 'Ceremony start time', type: 'time' },
        { key: 'ceremony_place', label: 'Ceremony location', type: 'text', hint: 'Name and address.' },
        { key: 'reception_place', label: 'Reception location, if different', type: 'text', optional: true },
        { key: 'coverage_end', label: 'When you’d like coverage to end', type: 'time', optional: true },
        { key: 'guests', label: 'About how many guests', type: 'number', optional: true }
      ]
    },
    {
      title: 'How the day runs',
      questions: [
        { key: 'first_look', label: 'A first look before the ceremony?', type: 'choice', options: ['Yes', 'No', 'Not sure yet'] },
        { key: 'wedding_party', label: 'How many people in the wedding party', type: 'number', optional: true },
        { key: 'moments', label: 'Moments planned for the reception', type: 'long', optional: true, hint: 'Grand entrance, toasts, first dance, parent dances, cake, traditions.' },
        { key: 'send_off', label: 'A send-off at the end?', type: 'choice', options: ['Sparklers', 'Other', 'No send-off'], optional: true },
        { key: 'unplugged', label: 'An unplugged ceremony (no guest phones)?', type: 'choice', options: ['Yes', 'No', 'Not sure yet'], optional: true }
      ]
    },
    {
      title: 'Family photos',
      questions: [
        { key: 'family_groups', label: 'The family groupings you want', type: 'list', hint: 'One per line, for example “us with both sets of parents”.' },
        { key: 'family_helper', label: 'Someone who knows both families and can help gather people', type: 'text', optional: true },
        { key: 'family_notes', label: 'Anything I should know about the families', type: 'long', optional: true, hint: 'Divorced parents, someone in a wheelchair, a relative to make sure I photograph.' }
      ]
    },
    {
      title: 'Your vendors',
      questions: [
        { key: 'planner', label: 'Planner or day-of coordinator (name and phone)', type: 'text', optional: true },
        { key: 'vendors', label: 'Other vendors', type: 'list', optional: true, hint: 'Videographer, DJ or band, florist, hair and makeup. One per line.' }
      ]
    },
    {
      title: 'Anything else',
      questions: [
        { key: 'must_have', label: 'Photos you’d be sad to miss', type: 'long', optional: true },
        { key: 'avoid', label: 'Anything you’d rather I didn’t photograph', type: 'long', optional: true },
        { key: 'notes', label: 'Anything else', type: 'long', optional: true }
      ]
    }
  ];
  const QUESTIONS = SECTIONS.flatMap((section) => section.questions);
  const BY_KEY = Object.fromEntries(QUESTIONS.map((q) => [q.key, q]));
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const LIMITS = { text: 300, long: 3000, list: 3000 };

  // Only known questions, each answer in its own shape; anything else is dropped.
  function clean(input) {
    const answers = {};
    for (const q of QUESTIONS) {
      const raw = input && Object.prototype.hasOwnProperty.call(input, q.key) ? input[q.key] : '';
      if (q.type === 'time') answers[q.key] = TIME.test(String(raw)) ? String(raw) : '';
      else if (q.type === 'number') {
        const n = Number(raw);
        answers[q.key] = raw === '' || raw === null || !Number.isInteger(n) || n < 0 || n > 5000 ? '' : n;
      } else if (q.type === 'choice') answers[q.key] = q.options.includes(raw) ? raw : '';
      else if (q.type === 'long' || q.type === 'list') answers[q.key] = String(raw === null || raw === undefined ? '' : raw).replace(/\r\n?/g, '\n').trim().slice(0, LIMITS[q.type]);
      else answers[q.key] = String(raw === null || raw === undefined ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, LIMITS.text);
    }
    return answers;
  }

  const missing = (answers) => QUESTIONS.filter((q) => !q.optional && (answers[q.key] === '' || answers[q.key] === undefined)).map((q) => q.key);
  const answered = (answers) => QUESTIONS.filter((q) => answers[q.key] !== '' && answers[q.key] !== undefined).length;

  return { SECTIONS, QUESTIONS, BY_KEY, clean, missing, answered };
}));
