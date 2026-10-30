import test from 'node:test';
import assert from 'node:assert/strict';
import { wordKey } from '../js/storage.js';
import {
  CONTRACTIONS,
  MAX_WORD_LENGTH,
  RARE_RANK,
  countTokens,
  displayToken,
  isAcceptable,
  isUsableSentence,
  mulberry32,
  parseDetailedLine,
  parseNotice,
  parseVocabulary,
  rankTokens,
  rarity,
  selectPool,
  shuffled,
  tokenize,
} from '../tools/corpus.mjs';

const VOCAB = new Set(['the', 'dog', 'father', 'run', 'did', 'have', 'fast', 'a', 'very', 'time']);

test('tokenize lowercases and keeps inner apostrophes', () => {
  assert.deepEqual(tokenize("Didn't the Dog run?"), ["didn't", 'the', 'dog', 'run']);
});

test('tokenize strips punctuation from the ends of a word', () => {
  assert.deepEqual(tokenize('A fact, really.'), ['a', 'fact', 'really']);
});

test('a hyphenated word stays whole, as it is typed', () => {
  assert.deepEqual(tokenize('A well-known fact.'), ['a', 'well-known', 'fact']);
});

test('tokenize agrees with the key the game tracks words under', () => {
  for (const word of ["Don't", 'time,', 'End.', 'well-known', "I'm", 'The']) {
    assert.deepEqual(tokenize(word), [wordKey(word)]);
  }
});

test('tokenize ignores extra whitespace', () => {
  assert.deepEqual(tokenize('  one   two  '), ['one', 'two']);
});

test('a hyphenated compound is not a dictionary word, so it counts as rare', () => {
  assert.equal(isAcceptable('well-known', VOCAB), false);
});

test('a dictionary word is acceptable', () => {
  assert.equal(isAcceptable('dog', VOCAB), true);
});

test('a word the dictionary lacks is rejected, which is how names stay out', () => {
  assert.equal(isAcceptable('tom', VOCAB), false);
  assert.equal(isAcceptable('mary', VOCAB), false);
});

test('I is acceptable although the dictionary only holds a capital', () => {
  assert.equal(isAcceptable('i', VOCAB), true);
});

test('a listed contraction is acceptable without its stem being a word', () => {
  assert.equal(VOCAB.has('didn'), false);
  assert.equal(isAcceptable("didn't", VOCAB), true);
  assert.equal(isAcceptable("i'm", VOCAB), true);
  assert.equal(isAcceptable("you're", VOCAB), true);
  assert.equal(isAcceptable("can't", VOCAB), true);
  assert.equal(isAcceptable("won't", VOCAB), true);
});

test('a possessive of a dictionary word is acceptable, of a name is not', () => {
  assert.equal(isAcceptable("father's", VOCAB), true);
  assert.equal(isAcceptable("tom's", VOCAB), false);
});

test('an unlisted apostrophe form is rejected', () => {
  assert.equal(isAcceptable("ain't", VOCAB), false);
  assert.equal(isAcceptable("y'all", VOCAB), false);
  assert.equal(isAcceptable("o'clock", VOCAB), false);
});

test('a token wrapped in single quotes is rejected', () => {
  assert.equal(isAcceptable("'tis", VOCAB), false);
  assert.equal(isAcceptable("dogs'", VOCAB), false);
  assert.equal(isAcceptable("'dog'", VOCAB), false);
});

test('every listed contraction has an apostrophe and is lowercase', () => {
  assert.ok(CONTRACTIONS.size > 60, `only ${CONTRACTIONS.size} contractions listed`);
  for (const form of CONTRACTIONS) {
    assert.ok(/^[a-z]+'[a-z]+$/.test(form), `malformed contraction: ${form}`);
  }
});

test('the usual contractions are all listed', () => {
  for (const form of ["don't", "doesn't", "didn't", "isn't", "wasn't", "it's", "i'll", "we're", "they've", "that's", "let's"]) {
    assert.ok(CONTRACTIONS.has(form), `${form} is missing`);
  }
});

test('the vocabulary parser reads the word block under the separator', () => {
  const vocab = parseVocabulary('header\ncopyright\n---\nalpha\nbeta\n');
  assert.deepEqual([...vocab].sort(), ['alpha', 'beta']);
});

test('the vocabulary parser drops capitalised words and names', () => {
  const vocab = parseVocabulary('x\n---\nalpha\nTom\nI\nbeta\n');
  assert.deepEqual([...vocab].sort(), ['alpha', 'beta']);
});

test('the vocabulary parser caps word length', () => {
  const fits = 'a'.repeat(MAX_WORD_LENGTH);
  const spills = 'a'.repeat(MAX_WORD_LENGTH + 1);
  const vocab = parseVocabulary(`x\n---\n${fits}\n${spills}\n`);
  assert.equal(vocab.has(fits), true);
  assert.equal(vocab.has(spills), false);
});

test('the vocabulary parser insists on a separator', () => {
  assert.throws(() => parseVocabulary('alpha\nbeta\n'), /separator/);
});

test('tokens rank by frequency, ties alphabetically', () => {
  const counts = countTokens(['the the the dog', 'the dog run', 'fast fast run']);
  assert.deepEqual(rankTokens(counts, VOCAB), ['the', 'dog', 'fast', 'run']);
});

test('ranking leaves out names and counts contractions whole', () => {
  const counts = countTokens(["Tom didn't run", "Tom didn't have a dog", "I didn't"]);
  const ranked = rankTokens(counts, VOCAB);

  assert.equal(ranked[0], "didn't");
  assert.ok(ranked.includes('i'));
  assert.ok(!ranked.includes('tom'));
  assert.ok(!ranked.includes('didn'));
});

test('I and its contractions display with a capital', () => {
  assert.equal(displayToken('i'), 'I');
  assert.equal(displayToken("i'm"), "I'm");
  assert.equal(displayToken("i'll"), "I'll");
});

test('other words that start with i are left alone', () => {
  assert.equal(displayToken('in'), 'in');
  assert.equal(displayToken('is'), 'is');
  assert.equal(displayToken("isn't"), "isn't");
  assert.equal(displayToken('idea'), 'idea');
});

test('a sentence is usable when it has the right shape', () => {
  assert.equal(isUsableSentence('The dog ran very fast all day.'), true);
  assert.equal(isUsableSentence('Why did the dog run so fast?'), true);
});

test('length is not a criterion, so a one word sentence is usable', () => {
  assert.equal(isUsableSentence('Go!'), true);
  assert.equal(isUsableSentence('Hi.'), true);
});

test('a very long sentence is usable too', () => {
  assert.equal(isUsableSentence(`${'The dog ran very fast and far, '.repeat(12)}home.`), true);
});

test('a sentence needs a capital start and a terminal mark', () => {
  assert.equal(isUsableSentence('the dog ran very fast all day long.'), false);
  assert.equal(isUsableSentence('The dog ran very fast all day long'), false);
});

test('a sentence that opens with a quote mark or a dash does not start with a capital', () => {
  assert.equal(isUsableSentence("'I'll be back soon' was written on the door."), false);
  assert.equal(isUsableSentence('-The dog ran very fast all day long.'), false);
  assert.equal(isUsableSentence(', The dog ran very fast all day long.'), false);
});

test('a sentence with digits or odd symbols is not usable', () => {
  assert.equal(isUsableSentence('The dog ran 5 miles very fast today.'), false);
  assert.equal(isUsableSentence('The dog ran (very fast) all day long.'), false);
  assert.equal(isUsableSentence('The dog ran très fast all day long.'), false);
});

test('rarity is the share of a sentence beyond the rare rank', () => {
  const rankOf = new Map([['the', 1], ['dog', 100], ['windier', 9000], ['ran', 400]]);

  assert.equal(rarity(['the', 'dog', 'ran'], rankOf), 0);
  assert.equal(rarity(['the', 'dog', 'ran', 'windier'], rankOf), 0.25);
  assert.equal(rarity(['windier'], rankOf), 1);
});

test('the boundary rank is common and the one after it is rare', () => {
  const rankOf = new Map([['edge', RARE_RANK], ['past', RARE_RANK + 1]]);

  assert.equal(rarity(['edge'], rankOf), 0);
  assert.equal(rarity(['past'], rankOf), 1);
});

test('a word nobody ranked counts as rare instead of removing the sentence', () => {
  const rankOf = new Map([['the', 1]]);
  assert.equal(rarity(['the', 'tom'], rankOf), 0.5);
});

test('a repeated rare word counts each time', () => {
  const rankOf = new Map([['the', 1], ['windier', 9000]]);
  assert.equal(rarity(['windier', 'windier', 'the', 'the'], rankOf), 0.5);
});

test('rarity needs at least one word', () => {
  assert.throws(() => rarity([], new Map()), /no words/);
});

test('the seeded generator repeats itself and stays in range', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 50; i += 1) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
  }
});

test('a shuffle keeps every item and does not touch its input', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = shuffled(input, mulberry32(3));

  assert.deepEqual([...out].sort(), input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('a detailed export line yields its id, text and author', () => {
  const line = "1276\teng\tLet's try something.\tCK\t0000-00-00 00:00:00\t2012-02-05 11:38:18";
  assert.deepEqual(parseDetailedLine(line), { id: 1276, text: "Let's try something.", author: 'CK' });
});

test('a sentence with no recorded author reads as unattributed', () => {
  const line = '27284\teng\tWhat is most troublesome is the corruption of the best.\t\\N\t\\N\t2025-05-29 03:00:39';
  assert.equal(parseDetailedLine(line).author, null);
  assert.equal(parseDetailedLine('5\teng\tHello there friend.\t\t\t').author, null);
});

test('a line without an author column reads as unattributed', () => {
  assert.equal(parseDetailedLine('5\teng\tHello there friend.').author, null);
});

test('lines that are not English sentences are skipped', () => {
  assert.equal(parseDetailedLine('5\tfra\tBonjour tout le monde.\tCK'), null);
  assert.equal(parseDetailedLine('abc\teng\tHello there friend.\tCK'), null);
  assert.equal(parseDetailedLine('5\teng\t\tCK'), null);
  assert.equal(parseDetailedLine(''), null);
});

test('author names lose stray whitespace', () => {
  assert.equal(parseDetailedLine('5\teng\tHello there friend.\t CK \t\t').author, 'CK');
});

test('the notice is everything above the separator, untouched', () => {
  const text = 'Copyright 2000 by Someone\n\nPermission is granted.\n---\nalpha\nbeta\n';
  assert.equal(parseNotice(text), 'Copyright 2000 by Someone\n\nPermission is granted.');
});

test('a word list with no separator has no notice to read', () => {
  assert.throws(() => parseNotice('alpha\nbeta\n'), /separator/);
});

function corpus(sentenceCount, wordsPerSentence = 5, vocabularySize = 40) {
  const random = mulberry32(11);
  const words = Array.from({ length: vocabularySize }, (_, i) => `w${i}`);
  return {
    words,
    candidates: Array.from({ length: sentenceCount }, (_, id) => {
      const tokens = [...new Set(Array.from({ length: wordsPerSentence }, () => words[Math.floor(random() * words.length)]))];
      return { id, text: tokens.join(' '), author: 'a', tokens, length: tokens.length };
    }),
  };
}

const TIERS = [
  { upTo: 5, min: 6 },
  { upTo: Infinity, min: 2 },
];

test('a pool has exactly the size asked for', () => {
  const { words, candidates } = corpus(500);
  const { chosen } = selectPool(candidates, words, { size: 120, tiers: TIERS, random: mulberry32(1) });
  assert.equal(chosen.length, 120);
});

test('a pool holds each sentence once', () => {
  const { words, candidates } = corpus(500);
  const { chosen } = selectPool(candidates, words, { size: 200, tiers: TIERS, random: mulberry32(1) });
  assert.equal(new Set(chosen.map((item) => item.id)).size, chosen.length);
});

test('every word meets its coverage floor when the corpus has enough sentences', () => {
  const { words, candidates } = corpus(2000);
  const { chosen, unmet } = selectPool(candidates, words, { size: 600, tiers: TIERS, random: mulberry32(2) });

  const counts = new Map();
  for (const item of chosen) for (const token of item.tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

  words.forEach((word, position) => {
    assert.ok((counts.get(word) ?? 0) >= (position < 5 ? 6 : 2), `${word} is under its floor`);
  });
  assert.equal(unmet, 0);
});

test('a word the corpus barely contains gets everything there is', () => {
  const { words, candidates } = corpus(300);
  candidates[10] = { id: 10, text: 'unique w1', author: 'a', tokens: ['unique', 'w1'], length: 2 };

  const { chosen } = selectPool(candidates, [...words, 'unique'], { size: 100, tiers: TIERS, random: mulberry32(3) });
  assert.ok(chosen.some((item) => item.id === 10), 'the only sentence with the word was left out');
});

test('coverage comes before the random fill', () => {
  const { words, candidates } = corpus(1500);
  const { covered, filled, chosen } = selectPool(candidates, words, { size: 500, tiers: TIERS, random: mulberry32(4) });

  assert.ok(covered > 0 && filled > 0, `covered ${covered}, filled ${filled}`);
  assert.equal(covered + filled, chosen.length);
});

test('when coverage needs more than the pool can hold, the rarest words are served first', () => {
  const { words, candidates } = corpus(2000);
  const { chosen, unmet } = selectPool(candidates, words, { size: 30, tiers: TIERS, random: mulberry32(5) });

  assert.equal(chosen.length, 30);
  assert.ok(unmet > 0, 'a pool this small cannot meet every floor');

  const counts = new Map();
  for (const item of chosen) for (const token of item.tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const word of words.slice(-5)) {
    assert.ok((counts.get(word) ?? 0) >= 2, `${word} is among the rarest and missed its floor`);
  }
});

test('coverage prefers short sentences', () => {
  const { words, candidates } = corpus(400, 4);
  const long = Array.from({ length: 300 }, (_, i) => ({
    id: 1000 + i,
    text: 'long',
    author: 'a',
    tokens: ['w39', 'long'],
    length: 60,
  }));
  const short = Array.from({ length: 30 }, (_, i) => ({
    id: 2000 + i,
    text: 'short',
    author: 'a',
    tokens: ['w39', 'short'],
    length: 4,
  }));

  const { chosen } = selectPool([...candidates, ...long, ...short], words, {
    size: 60,
    tiers: [{ upTo: Infinity, min: 6 }],
    random: mulberry32(6),
  });

  const forRarest = chosen.filter((item) => item.tokens.includes('w39'));
  assert.ok(forRarest.length >= 6);
  assert.ok(forRarest.slice(0, 6).every((item) => item.length <= 20), 'a long sentence was taken while short ones existed');
});

test('selecting a pool repeats itself for one seed and varies across seeds', () => {
  const { words, candidates } = corpus(800);
  const ids = (seed) => selectPool(candidates, words, { size: 200, tiers: TIERS, random: mulberry32(seed) }).chosen.map((item) => item.id);

  assert.deepEqual(ids(7), ids(7));
  assert.notDeepEqual(ids(7), ids(8));
});

test('a pool larger than the corpus returns the whole corpus', () => {
  const { words, candidates } = corpus(50);
  const { chosen } = selectPool(candidates, words, { size: 500, tiers: TIERS, random: mulberry32(9) });
  assert.equal(chosen.length, 50);
});

test('fields on a candidate survive selection', () => {
  const { words, candidates } = corpus(100);
  const { chosen } = selectPool(candidates, words, { size: 20, tiers: TIERS, random: mulberry32(10) });

  for (const item of chosen) {
    assert.equal(item.author, 'a');
    assert.equal(typeof item.id, 'number');
    assert.equal(typeof item.text, 'string');
  }
});
