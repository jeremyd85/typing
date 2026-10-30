import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSentenceList } from '../js/wordbank.js';
import {
  LENGTH_SPANS,
  RARITY_WEIGHT,
  RECENT_PENALTY,
  VOCABULARY,
  createPicker,
  prepare,
} from '../js/selector.js';

function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

const FILLER = ['alpha', 'bravo', 'candle', 'delta', 'engine', 'forest', 'garden', 'harbour', 'island', 'jungle'];

function build(count = 240) {
  const random = seeded(5);
  const rows = Array.from({ length: count }, (_, i) => {
    const length = 3 + Math.floor(random() * 12);
    const words = Array.from({ length }, () => FILLER[Math.floor(random() * FILLER.length)]);
    if (i % 20 === 0) words[1] = 'zebra';
    if (i % 30 === 0) words[2] = 'quartz';
    const rarity = Math.round(random() * 5) / 10;
    return [`Item${i} ${words.join(' ')}.`, rarity, 1000 + i, `author${i % 7}`];
  });
  return prepare(normalizeSentenceList({ id: 't', label: 't', sentences: rows }));
}

const cold = { version: 1, runs: [], words: {}, recent: [] };
const prepared = build();
const { items } = prepared;

function stat(heat, pace) {
  return { seen: 3, misses: 2, drills: 1, heat, pace };
}

function profileWith(words, recent = []) {
  return { ...cold, words, recent };
}

function drain(picker) {
  const out = [];
  for (let item = picker.next(); item; item = picker.next()) out.push(item);
  return out;
}

function firstPickShare(profile, options, test, runs = 400) {
  let hits = 0;
  for (let seed = 1; seed <= runs; seed += 1) {
    const item = createPicker(prepared, profile, options, seeded(seed * 7919)).next();
    if (test(item)) hits += 1;
  }
  return hits / runs;
}

const mentions = (word) => (item) => item.keys.includes(word);

test('preparing a list counts words and keeps each distinct word once per sentence', () => {
  const list = normalizeSentenceList({
    id: 't',
    label: 't',
    sentences: [['The dog, the cat.', 0.1, 1, 'a']],
  });
  const [item] = prepare(list).items;

  assert.equal(item.length, 4);
  assert.deepEqual(item.keys, ['the', 'dog', 'cat']);
});

test('the index lists every sentence containing a word', () => {
  const zebra = prepared.postings.get('zebra');
  const expected = items.map((item, i) => (item.keys.includes('zebra') ? i : -1)).filter((i) => i >= 0);

  assert.deepEqual([...zebra], expected);
  assert.ok(zebra.length >= 10);
});

test('the id index finds a sentence by its Tatoeba id', () => {
  assert.equal(items[prepared.idIndex.get(1007)].id, 1007);
});

test('a medium length setting only ever picks sentences inside its range', () => {
  const [low, high] = LENGTH_SPANS.medium;
  const picked = drain(createPicker(prepared, cold, { span: 'medium' }, seeded(1)));

  assert.ok(picked.length > 20);
  assert.ok(picked.every((item) => item.length >= low && item.length <= high));
});

test('every length setting is honoured', () => {
  for (const [name, [low, high]] of Object.entries(LENGTH_SPANS)) {
    const picked = drain(createPicker(prepared, cold, { span: name }, seeded(2)));
    assert.ok(picked.every((item) => item.length >= low && item.length <= high), `${name} leaked`);
  }
});

test('any length reaches every sentence', () => {
  assert.equal(drain(createPicker(prepared, cold, { span: 'any' }, seeded(3))).length, items.length);
});

test('the vocabulary setting caps how rare a sentence may be', () => {
  for (const [name, ceiling] of Object.entries(VOCABULARY)) {
    const picked = drain(createPicker(prepared, cold, { span: 'any', vocabulary: name }, seeded(4)));
    assert.ok(picked.every((item) => item.rarity <= ceiling), `${name} let a rarer sentence through`);
  }
});

test('common only keeps just the sentences with no rare words', () => {
  const picked = drain(createPicker(prepared, cold, { span: 'any', vocabulary: 'common' }, seeded(5)));

  assert.ok(picked.length > 0);
  assert.ok(picked.every((item) => item.rarity === 0));
  assert.equal(picked.length, items.filter((item) => item.rarity === 0).length);
});

test('mostly common sits between common only and anything', () => {
  const count = (vocabulary) =>
    drain(createPicker(prepared, cold, { span: 'any', vocabulary }, seeded(6))).length;

  assert.ok(count('common') < count('mostly'));
  assert.ok(count('mostly') < count('any'));
});

test('a sentence is never picked twice by one picker', () => {
  const picked = drain(createPicker(prepared, cold, { span: 'any' }, seeded(7)));
  assert.equal(new Set(picked.map((item) => item.id)).size, picked.length);
});

test('a picker that has run dry says so', () => {
  const picker = createPicker(prepared, cold, { span: 'any' }, seeded(8));
  drain(picker);

  assert.equal(picker.next(), null);
  assert.equal(picker.remaining(), 0);
});

test('a setting that matches nothing yields nothing rather than crashing', () => {
  const none = prepare(normalizeSentenceList({ id: 't', label: 't', sentences: [['Hi there now.', 0.9, 1, 'a']] }));
  const picker = createPicker(none, cold, { span: 'medium', vocabulary: 'common' }, seeded(1));

  assert.equal(picker.next(), null);
});

test('an unknown setting falls back to the default instead of breaking', () => {
  const picker = createPicker(prepared, cold, { span: 'enormous', vocabulary: 'whatever' }, seeded(9));
  assert.ok(picker.next());
});

test('with nothing to practise, picks lean towards common vocabulary', () => {
  const meanRarity = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const picks = [];
  for (let seed = 1; seed <= 500; seed += 1) {
    picks.push(createPicker(prepared, cold, { span: 'any' }, seeded(seed * 31)).next().rarity);
  }

  assert.ok(meanRarity(picks) < meanRarity(items.map((item) => item.rarity)) - 0.02);
});

test('with nothing to practise the picks still vary a great deal', () => {
  const firsts = new Set();
  for (let seed = 1; seed <= 200; seed += 1) {
    firsts.add(createPicker(prepared, cold, { span: 'any' }, seeded(seed * 17)).next().id);
  }

  assert.ok(firsts.size > 60, `only ${firsts.size} distinct first picks in 200 runs`);
});

test('a missed word is much more likely to come back', () => {
  const baseline = firstPickShare(cold, { span: 'any' }, mentions('zebra'));
  const hot = firstPickShare(profileWith({ zebra: stat(0.9, 100) }), { span: 'any' }, mentions('zebra'));

  assert.ok(hot > baseline * 3, `${(baseline * 100).toFixed(0)}% rose only to ${(hot * 100).toFixed(0)}%`);
});

function paced(word, pace) {
  const words = Object.fromEntries(FILLER.concat(['k1', 'k2', 'k3', 'k4']).map((w) => [w, stat(0, 100)]));
  words[word] = stat(0, pace);
  return profileWith(words);
}

test('a slow word is more likely to come back', () => {
  const baseline = firstPickShare(paced('zebra', 100), { span: 'any' }, mentions('zebra'));
  const slow = firstPickShare(paced('zebra', 400), { span: 'any' }, mentions('zebra'));

  assert.ok(slow > baseline * 1.5, `${(baseline * 100).toFixed(0)}% rose only to ${(slow * 100).toFixed(0)}%`);
});

test('a missed word counts for more than a slow one', () => {
  const words = Object.fromEntries(FILLER.concat(['k1', 'k2', 'k3', 'k4']).map((w) => [w, stat(0, 100)]));
  const profile = profileWith({ ...words, zebra: stat(0, 400), quartz: stat(0.9, 100) });

  const quartz = firstPickShare(profile, { span: 'any' }, mentions('quartz'));
  const zebra = firstPickShare(profile, { span: 'any' }, mentions('zebra'));

  assert.ok(quartz > zebra, `missed ${quartz}, slow ${zebra}`);
});

test('a recently seen sentence is less likely to come back', () => {
  const target = items[10];
  const recent = profileWith({}, [target.id]);

  const fresh = firstPickShare(cold, { span: 'any' }, (item) => item.id === target.id, 1500);
  const seen = firstPickShare(recent, { span: 'any' }, (item) => item.id === target.id, 1500);

  assert.ok(seen < fresh, `${fresh} then ${seen}`);
});

test('the recency penalty is the size it is documented to be', () => {
  const target = prepared.idIndex.get(items[10].id);
  const plain = createPicker(prepared, cold, { span: 'any' }, seeded(1)).score(target);
  const seen = createPicker(prepared, profileWith({}, [items[10].id]), { span: 'any' }, seeded(1)).score(target);

  assert.ok(Math.abs(plain - seen - RECENT_PENALTY) < 1e-9);
});

test('a sentence with no practice value scores on rarity alone', () => {
  const index = items.findIndex((item) => !item.keys.includes('zebra') && !item.keys.includes('quartz'));
  const picker = createPicker(prepared, cold, { span: 'any' }, seeded(1));

  assert.ok(Math.abs(picker.score(index) + RARITY_WEIGHT * items[index].rarity) < 1e-12);
});

test('one hot word does not make a long sentence outscore a short one', () => {
  const list = normalizeSentenceList({
    id: 't',
    label: 't',
    sentences: [
      ['Zebra now.', 0, 1, 'a'],
      ['Zebra one two three four five six seven eight nine ten eleven twelve.', 0, 2, 'a'],
    ],
  });
  const picker = createPicker(prepare(list), profileWith({ zebra: stat(1, 100) }), { span: 'any' }, seeded(1));

  assert.ok(picker.score(0) > picker.score(1));
  assert.ok(picker.score(1) > 0, 'the long sentence still benefits from the hot word');
});

test('observing a miss raises the score of exactly the sentences containing the word', () => {
  const picker = createPicker(prepared, cold, { span: 'any' }, seeded(1));
  const before = items.map((_, i) => picker.score(i));

  picker.observe({ word: 'zebra', clean: false, misses: 1, ms: null });

  items.forEach((item, i) => {
    if (item.keys.includes('zebra')) assert.ok(picker.score(i) > before[i], `sentence ${i} did not rise`);
    else assert.equal(picker.score(i), before[i], `sentence ${i} moved without the word`);
  });
});

test('observing clean passes lowers the score again', () => {
  const picker = createPicker(prepared, profileWith({ zebra: stat(0.9, 100) }), { span: 'any' }, seeded(1));
  const index = items.findIndex((item) => item.keys.includes('zebra'));
  const before = picker.score(index);

  for (let n = 0; n < 4; n += 1) picker.observe({ word: 'zebra', clean: true, misses: 0, ms: 300 });

  assert.ok(picker.score(index) < before);
});

test('observing a word no sentence contains is harmless', () => {
  const picker = createPicker(prepared, cold, { span: 'any' }, seeded(1));
  const before = items.map((_, i) => picker.score(i));

  picker.observe({ word: 'qwxyz', clean: false, misses: 1, ms: null });

  assert.deepEqual(items.map((_, i) => picker.score(i)), before);
});

test('observing normalises punctuation and case the way tracking does', () => {
  const picker = createPicker(prepared, cold, { span: 'any' }, seeded(1));
  const index = items.findIndex((item) => item.keys.includes('zebra'));
  const before = picker.score(index);

  picker.observe({ word: 'Zebra.', clean: false, misses: 1, ms: null });

  assert.ok(picker.score(index) > before);
});

test('scores kept up to date incrementally always equal a fresh recompute', () => {
  const profile = profileWith({
    ...Object.fromEntries(FILLER.map((w) => [w, stat(0.1, 100)])),
    zebra: stat(0.5, 400),
  });
  const picker = createPicker(prepared, profile, { span: 'any' }, seeded(2));
  const random = seeded(77);
  const vocabulary = [...FILLER, 'zebra', 'quartz', 'nothing'];

  for (let step = 0; step < 150; step += 1) {
    const word = vocabulary[Math.floor(random() * vocabulary.length)];
    const clean = random() < 0.5;
    picker.observe({ word, clean, misses: clean ? 0 : 1 + Math.floor(random() * 2), ms: clean ? 200 + random() * 900 : null });
  }

  items.forEach((_, i) => {
    assert.ok(Math.abs(picker.score(i) - picker.recompute(i)) < 1e-9, `sentence ${i} drifted`);
  });
});

test('observing inside one picker does not change the profile it was built from', () => {
  const profile = profileWith({ zebra: stat(0.5, 100) });
  const snapshot = JSON.stringify(profile);
  const picker = createPicker(prepared, profile, { span: 'any' }, seeded(1));

  picker.observe({ word: 'zebra', clean: false, misses: 1, ms: null });

  assert.equal(JSON.stringify(profile), snapshot);
});

test('a word missed during the run pulls its sentences up the next draw', () => {
  const draws = (observeFirst) => {
    let hits = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const picker = createPicker(prepared, cold, { span: 'any' }, seeded(seed * 13));
      if (observeFirst) picker.observe({ word: 'zebra', clean: false, misses: 2, ms: null });
      if (mentions('zebra')(picker.next())) hits += 1;
    }
    return hits / 300;
  };

  assert.ok(draws(true) > draws(false) * 3);
});

test('the same seed gives the same sequence and a different seed does not', () => {
  const ids = (seed) => {
    const picker = createPicker(prepared, cold, { span: 'any' }, seeded(seed));
    return Array.from({ length: 12 }, () => picker.next().id);
  };

  assert.deepEqual(ids(5), ids(5));
  assert.notDeepEqual(ids(5), ids(6));
});

test('the eligible count starts at the number of sentences the settings allow', () => {
  const [low, high] = LENGTH_SPANS.short;
  const expected = items.filter((item) => item.length >= low && item.length <= high).length;

  assert.equal(createPicker(prepared, cold, { span: 'short' }, seeded(1)).remaining(), expected);
});

test('picking uses up eligibility one sentence at a time', () => {
  const picker = createPicker(prepared, cold, { span: 'any' }, seeded(1));
  const start = picker.remaining();

  picker.next();
  picker.next();

  assert.equal(picker.remaining(), start - 2);
});
