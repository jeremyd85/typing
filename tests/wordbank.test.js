import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRun, normalizeSentenceList } from '../js/wordbank.js';
import { recordRun, wordKey } from '../js/storage.js';

const list = JSON.parse(readFileSync(new URL('../data/english-common.json', import.meta.url)));

function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

const cold = { version: 1, runs: [], words: {} };

test('a run has exactly the requested number of words', () => {
  for (const count of [10, 25, 50]) {
    assert.equal(buildRun(list, cold, count, seeded(7)).length, count);
  }
});

test('every word in a run comes from the list', () => {
  const allowed = new Set(list.words);
  for (const word of buildRun(list, cold, 50, seeded(11))) {
    assert.ok(allowed.has(word), `${word} is not in the list`);
  }
});

test('the word list has no duplicates', () => {
  assert.equal(new Set(list.words).size, list.words.length);
});

test('common words come up far more often than rare ones', () => {
  const rankOf = new Map(list.words.map((word, rank) => [word, rank]));
  const last = list.words.length - 50;
  const tally = { head: 0, tail: 0 };

  for (let run = 0; run < 60; run += 1) {
    for (const word of buildRun(list, cold, 50, seeded(run + 1))) {
      const rank = rankOf.get(word);
      if (rank < 50) tally.head += 1;
      if (rank >= last) tally.tail += 1;
    }
  }

  assert.ok(
    tally.head > tally.tail * 8,
    `first 50 ranks drawn ${tally.head} times, last 50 drawn ${tally.tail}`,
  );
});

test('hot words are forced into the run', () => {
  const rare = [list.words.at(-1), list.words.at(-2)];
  const profile = {
    version: 1,
    runs: [],
    words: {
      [wordKey(rare[0])]: { seen: 3, misses: 4, drills: 2, heat: 0.9 },
      [wordKey(rare[1])]: { seen: 2, misses: 2, drills: 1, heat: 0.7 },
    },
  };

  const run = buildRun(list, profile, 10, seeded(3));

  assert.ok(run.includes(rare[0]), `${rare[0]} was not seeded into the run`);
  assert.ok(run.includes(rare[1]), `${rare[1]} was not seeded into the run`);
});

test('reserved hot words never crowd out the whole run', () => {
  const words = {};
  for (const word of list.words) words[word] = { seen: 1, misses: 1, drills: 1, heat: 1 };

  const run = buildRun(list, { version: 1, runs: [], words }, 10, seeded(5));

  assert.equal(run.length, 10);
});

test('a run never repeats a word back to back when the draw allows it', () => {
  const tiny = { id: 'tiny', label: 'tiny', words: ['one', 'two', 'three', 'four'] };
  let checked = 0;

  for (let seed = 1; seed <= 60; seed += 1) {
    const run = buildRun(tiny, cold, 12, seeded(seed));

    const counts = new Map();
    for (const word of run) counts.set(word, (counts.get(word) ?? 0) + 1);
    const crowded = Math.max(...counts.values()) * 2 > run.length + 1;
    if (crowded) continue;

    checked += 1;
    for (let i = 1; i < run.length; i += 1) {
      assert.notEqual(run[i], run[i - 1], `seed ${seed} repeated ${run[i]} at ${i}`);
    }
  }

  assert.ok(checked > 30, `only ${checked} of 60 draws were spreadable`);
});

test('a word missed at the end of a sentence goes hot in word mode', () => {
  const target = list.words.slice(400).find((word) => /^[a-z]+$/.test(word));
  const fresh = { version: 1, runs: [], words: {} };

  assert.ok(
    !buildRun(list, fresh, 10, seeded(9)).includes(target),
    `${target} turns up on its own, so it proves nothing here`,
  );

  const profile = recordRun(fresh, {
    results: [{ word: `${target}.`, clean: false, misses: 2 }],
    listId: 'english-sentences',
    summary: {
      words: 1,
      wpm: 60,
      accuracy: 0.9,
      cleanWords: 0,
      drilledWords: [`${target}.`],
      drillMisses: 2,
      typeMs: 1000,
      drillMs: 1000,
    },
  });

  assert.ok(
    buildRun(list, profile, 10, seeded(9)).includes(target),
    `missing "${target}." never made "${target}" hot`,
  );
});

function profileWith(words) {
  return { version: 1, runs: [], words };
}

function timed(entries) {
  return profileWith(
    Object.fromEntries(
      entries.map(([word, pace]) => [word, { seen: 3, misses: 0, drills: 0, heat: 0, pace }]),
    ),
  );
}

test('a slow word is pulled into the run', () => {
  const target = list.words.slice(600).find((word) => /^[a-z]+$/.test(word));
  const fresh = profileWith({});
  assert.ok(
    !buildRun(list, fresh, 10, seeded(21)).includes(target),
    `${target} turns up on its own, so it proves nothing`,
  );

  const quick = list.words.slice(0, 14).map((word) => [word, 110]);
  const profile = timed([...quick, [target, 700]]);

  assert.ok(
    buildRun(list, profile, 10, seeded(21)).includes(target),
    `${target} was typed slowly but never came back`,
  );
});

test('errors outrank slowness for the reserved slots', () => {
  const missed = list.words.slice(700).find((word) => /^[a-z]+$/.test(word));
  const sluggish = list.words.slice(500, 512);

  const quick = list.words.slice(0, 14).map((word) => [word, 110]);
  const profile = timed([...quick, ...sluggish.map((word) => [word, 900])]);
  profile.words[missed] = { seen: 2, misses: 3, drills: 1, heat: 0.9, pace: 110 };

  const run = buildRun(list, profile, 10, seeded(5));
  assert.ok(run.includes(missed), 'the word you got wrong was not reserved a place');
});

test('a word you type quickly is left alone', () => {
  const quick = list.words.slice(0, 14).map((word) => [word, 110]);
  const profile = timed(quick);

  const runs = [];
  for (let seed = 1; seed <= 8; seed += 1) runs.push(buildRun(list, profile, 10, seeded(seed)));

  const rare = list.words[900];
  assert.ok(!runs.flat().includes(rare), 'an untimed rare word should stay rare');
});

test('slowness does nothing until enough words are timed', () => {
  const target = list.words.slice(600).find((word) => /^[a-z]+$/.test(word));
  const profile = timed([[list.words[0], 110], [target, 900]]);

  assert.ok(
    !buildRun(list, profile, 10, seeded(21)).includes(target),
    'two samples should not be enough to call a word slow',
  );
});

test('sentence rows become objects carrying text, rarity, id and author', () => {
  const normalised = normalizeSentenceList({
    id: 'x',
    label: 'x',
    sentences: [['One two three four.', 0.25, 77, 'CK']],
  });

  assert.deepEqual(normalised.sentences, [
    { text: 'One two three four.', rarity: 0.25, id: 77, author: 'CK' },
  ]);
});

test('a row without an id or author still loads, as uncredited', () => {
  const [row] = normalizeSentenceList({ sentences: [['Hello there friend.', 0]] }).sentences;
  assert.equal(row.id, null);
  assert.equal(row.author, null);
});

test('an empty sentence list is refused', () => {
  assert.throws(() => normalizeSentenceList({ sentences: [] }), /empty/);
  assert.throws(() => normalizeSentenceList({}), /empty/);
});

test('a malformed row is refused rather than loaded half understood', () => {
  assert.throws(() => normalizeSentenceList({ sentences: ['Just a string.'] }), /malformed/);
  assert.throws(() => normalizeSentenceList({ sentences: [['text', 'not a number']] }), /malformed/);
  assert.throws(() => normalizeSentenceList({ sentences: [[42, 0.1]] }), /malformed/);
});

test('the notices on a sentence list are kept', () => {
  const normalised = normalizeSentenceList({ sentences: [['Hello there friend.', 0]], notice: ['credit'] });
  assert.deepEqual(normalised.notice, ['credit']);
});
