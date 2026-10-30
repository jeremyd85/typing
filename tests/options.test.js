import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRun, decorate } from '../js/wordbank.js';
import { wordKey } from '../js/storage.js';

const list = JSON.parse(readFileSync(new URL('../data/english-common.json', import.meta.url)));

const cold = { version: 1, runs: [], words: {} };

function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function sample(options, runs = 200, count = 50) {
  const random = seeded(99);
  return Array.from({ length: runs }, () => buildRun(list, cold, count, random, options)).flat();
}

test('the word list carries I and a real set of contractions', () => {
  assert.ok(list.words.includes('I'));
  const contractions = list.words.filter((word) => word.includes("'"));
  assert.ok(contractions.length >= 25, `only ${contractions.length} contractions`);
  for (const word of ["don't", "didn't", "it's", "I'm", "can't"]) {
    assert.ok(list.words.includes(word), `${word} is missing from the list`);
  }
});

test('every word in the list is letters and apostrophes only', () => {
  for (const word of list.words) {
    assert.ok(/^[A-Za-z]+('[a-z]+)?$/.test(word), `odd entry: ${word}`);
  }
});

test('only I and its contractions carry a capital in the list', () => {
  for (const word of list.words) {
    if (/[A-Z]/.test(word)) assert.ok(/^I('[a-z]+)?$/.test(word), `${word} should be lowercase`);
  }
});

test('contractions are on by default and make up a modest share of a run', () => {
  const words = sample({});
  const share = words.filter((word) => word.includes("'")).length / words.length;

  assert.ok(share > 0.02, `contractions were only ${(share * 100).toFixed(1)}% of words`);
  assert.ok(share < 0.12, `contractions were ${(share * 100).toFixed(1)}% of words`);
});

test('switching contractions off removes every one of them', () => {
  const words = sample({ contractions: false });
  assert.equal(words.filter((word) => word.includes("'")).length, 0);
});

test('switching contractions off still fills the run to length', () => {
  for (const count of [10, 25, 50]) {
    const run = buildRun(list, cold, count, seeded(count), { contractions: false });
    assert.equal(run.length, count);
  }
});

test('I stays in word mode when contractions are off', () => {
  const words = sample({ contractions: false });
  assert.ok(words.includes('I'), 'the pronoun vanished along with the contractions');
});

test('a hot contraction is not reserved a slot while contractions are off', () => {
  const profile = {
    version: 1,
    runs: [],
    words: { "don't": { seen: 3, misses: 4, drills: 2, heat: 0.9 } },
  };

  assert.ok(buildRun(list, profile, 10, seeded(3)).includes("don't"), 'it should be reserved when on');
  assert.ok(
    !buildRun(list, profile, 10, seeded(3), { contractions: false }).includes("don't"),
    'it was still reserved a slot while switched off',
  );
});

test('decorating with nothing switched on changes nothing', () => {
  const words = ['the', 'dog', 'ran'];
  assert.deepEqual(decorate(words, {}, seeded(1)), words);
  assert.deepEqual(decorate(words, { capitals: false, punctuation: false }, seeded(1)), words);
});

test('capitals capitalise the first letter of about one word in five', () => {
  const words = Array.from({ length: 4000 }, () => 'dog');
  const out = decorate(words, { capitals: true }, seeded(5));
  const share = out.filter((word) => word === 'Dog').length / out.length;

  assert.ok(share > 0.15 && share < 0.25, `capitalised ${(share * 100).toFixed(1)}%`);
  assert.ok(out.every((word) => word === 'dog' || word === 'Dog'), 'something other than the first letter changed');
});

test('punctuation adds one trailing mark to about one word in five', () => {
  const words = Array.from({ length: 4000 }, () => 'dog');
  const out = decorate(words, { punctuation: true }, seeded(6));
  const marked = out.filter((word) => word !== 'dog');

  assert.ok(marked.length / out.length > 0.15 && marked.length / out.length < 0.25);
  for (const word of marked) assert.match(word, /^dog[,.?!;:]$/, `bad decoration: ${word}`);
});

test('punctuation uses every mark and favours commas and periods', () => {
  const words = Array.from({ length: 6000 }, () => 'dog');
  const out = decorate(words, { punctuation: true }, seeded(8)).filter((word) => word !== 'dog');
  const tally = {};
  for (const word of out) tally[word.at(-1)] = (tally[word.at(-1)] ?? 0) + 1;

  assert.deepEqual(Object.keys(tally).sort(), [',', '.', ':', ';', '!', '?'].sort());
  assert.ok(tally[','] > tally['?'] && tally['.'] > tally['!']);
});

test('capitals and punctuation can be combined', () => {
  const words = Array.from({ length: 4000 }, () => 'dog');
  const out = decorate(words, { capitals: true, punctuation: true }, seeded(9));

  assert.ok(out.some((word) => /^Dog[,.?!;:]$/.test(word)), 'no word got both');
  assert.ok(out.every((word) => /^[Dd]og[,.?!;:]?$/.test(word)), 'a word was mangled');
});

test('decoration never changes which word is being tracked', () => {
  const plain = list.words.map(wordKey);
  const run = buildRun(list, cold, 50, seeded(12), { capitals: true, punctuation: true });

  for (const token of run) {
    assert.ok(plain.includes(wordKey(token)), `${token} tracks as a word the list does not have`);
  }
});

test('a hot word is still reserved when it will be decorated', () => {
  const target = list.words.slice(500).find((word) => /^[a-z]+$/.test(word));
  const profile = {
    version: 1,
    runs: [],
    words: { [target]: { seen: 3, misses: 4, drills: 2, heat: 0.9 } },
  };

  const run = buildRun(list, profile, 10, seeded(4), { capitals: true, punctuation: true });
  assert.ok(run.map(wordKey).includes(target), `${target} was lost behind its decoration`);
});

test('word mode runs are plain by default', () => {
  for (const word of sample({}, 60)) {
    assert.ok(/^[A-Za-z]+('[a-z]+)?$/.test(word), `${word} was decorated without being asked`);
  }
});
