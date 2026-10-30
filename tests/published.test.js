import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { LICENSE_URL, escapeHtml, profileUrl } from '../tools/credits.mjs';
import { POOL_SIZE, RARE_RANK } from '../tools/corpus.mjs';
import { wordKey } from '../js/storage.js';

const path = (name) => new URL(`../${name}`, import.meta.url);
const read = (name) => readFileSync(path(name), 'utf8');

const sentenceFile = JSON.parse(read('data/english-sentences.json'));
const wordFile = JSON.parse(read('data/english-common.json'));
const creditsPage = read('credits.html');
const notices = read('THIRD_PARTY_NOTICES.md');
const indexPage = read('index.html');

const rows = sentenceFile.sentences;
const authorCounts = new Map();
for (const row of rows) authorCounts.set(row[3], (authorCounts.get(row[3]) ?? 0) + 1);

const wordsIn = (text) => text.split(/\s+/).length;

test('the pool is the size the build asked for', () => {
  assert.equal(rows.length, POOL_SIZE);
});

test('every sentence row carries its text, rarity, original id and author', () => {
  assert.deepEqual(sentenceFile.row, ['text', 'rarity', 'tatoeba sentence id', 'author']);
  for (const row of rows) {
    const [text, rarity, id, author] = row;
    assert.equal(row.length, 4, `row has ${row.length} fields: ${text}`);
    assert.equal(typeof text, 'string');
    assert.ok(typeof rarity === 'number' && rarity >= 0 && rarity <= 1, `${text} has rarity ${rarity}`);
    assert.ok(Number.isInteger(id) && id > 0, `${text} has id ${id}`);
    assert.match(author, /^[A-Za-z0-9_.-]+$/, `${text} has author ${author}`);
  }
});

test('rarity is stored to three decimals and the file is ordered by it', () => {
  for (const [, rarity] of rows) assert.equal(rarity, Math.round(rarity * 1000) / 1000);
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1][1] <= rows[i][1], `row ${i} is out of order`);
});

test('the file says what rarity measures and where rare begins', () => {
  assert.equal(sentenceFile.rareRank, RARE_RANK);
  assert.match(sentenceFile.rarity, new RegExp(`beyond rank ${RARE_RANK}`));
});

test('no sentence ships without an author', () => {
  for (const [text, , , author] of rows) {
    assert.equal(typeof author, 'string', `${text} has no author`);
    assert.ok(author.length > 0 && author !== '\\N', `${text} has author "${author}"`);
  }
});

test('ids and texts are each unique', () => {
  assert.equal(new Set(rows.map((row) => row[2])).size, rows.length);
  assert.equal(new Set(rows.map((row) => row[0].toLowerCase())).size, rows.length);
});

test('every sentence can be typed on a plain keyboard and reads as a sentence', () => {
  for (const [text] of rows) {
    assert.match(text, /^[A-Za-z ,.'!?;:-]+$/, `unsafe characters in: ${text}`);
    assert.match(text, /^[A-Z]/, `no capital: ${text}`);
    assert.match(text, /[.!?]$/, `no ending: ${text}`);
  }
});

test('length is not filtered, so very short and very long sentences are both there', () => {
  const lengths = rows.map(([text]) => wordsIn(text));
  assert.ok(lengths.filter((n) => n <= 2).length > 100, 'almost no one or two word sentences');
  assert.ok(lengths.filter((n) => n >= 30).length > 100, 'almost no sentences of 30 words or more');
});

test('content is not filtered, so names and the first person are plentiful', () => {
  const has = (re) => rows.filter(([text]) => re.test(text)).length;
  assert.ok(has(/\bTom\b/) > 1000, 'sentences naming people were filtered out');
  assert.ok(has(/\bI\b/) > 5000, 'the first person is missing');
  assert.ok(has(/didn't/i) > 500, 'negative contractions are missing');
});

test('every word in the common word list has plenty of sentences to practise in', () => {
  const containing = new Map();
  for (const [text] of rows) {
    for (const key of new Set(text.split(/\s+/).map(wordKey))) {
      containing.set(key, (containing.get(key) ?? 0) + 1);
    }
  }

  for (const word of wordFile.words) {
    const count = containing.get(wordKey(word)) ?? 0;
    assert.ok(count >= 20, `"${word}" is in only ${count} sentences`);
  }
});

test('the vocabulary levels each leave a usable number of sentences', () => {
  const within = (ceiling) => rows.filter(([, rarity]) => rarity <= ceiling).length;

  assert.ok(within(0) > 3000, `only ${within(0)} sentences with no rare words`);
  assert.ok(within(0.15) > within(0) * 2, 'mostly common barely differs from common only');
});

test('the credits page credits every author, with the right count, and only those in use', () => {
  const listed = new Map(
    [...creditsPage.matchAll(/<li><a href="https:\/\/tatoeba\.org\/en\/user\/profile\/([^"]+)">[^<]*<\/a> <span class="count">(\d+)<\/span><\/li>/g)].map(
      (match) => [decodeURIComponent(match[1]), Number(match[2])],
    ),
  );

  assert.equal(listed.size, authorCounts.size, 'an author is missing or listed twice');
  for (const [author, count] of authorCounts) {
    assert.equal(listed.get(author), count, `${author} is credited with the wrong count`);
  }
});

test('every author name on the credits page links to their profile', () => {
  for (const author of [...authorCounts.keys()].slice(0, 300)) {
    assert.ok(
      creditsPage.includes(`href="${profileUrl(author)}">${escapeHtml(author)}</a>`),
      `${author} is not linked`,
    );
  }
});

test('the credits page counts match the data', () => {
  assert.ok(
    creditsPage.includes(
      `${authorCounts.size.toLocaleString('en-US')} authors wrote the ${rows.length.toLocaleString('en-US')} sentences in use`,
    ),
  );
});

test('the credits page stays a list of authors rather than growing back into every sentence', () => {
  assert.ok(statSync(path('credits.html')).size < 1_000_000, 'the credits page has ballooned');
  for (const [text] of rows.slice(0, 40)) {
    assert.ok(!creditsPage.includes(escapeHtml(text)), `a sentence is listed on the page: ${text}`);
  }
});

test('the dictionary notice ships verbatim in the word list, the notices file and the credits page', () => {
  const [esdb] = wordFile.notice;
  assert.match(esdb, /Copyright 2000-2026 by Kevin Atkinson/);
  assert.match(esdb, /is hereby granted without fee/);
  assert.match(esdb, /appear in supporting documentation/);

  assert.ok(notices.includes(esdb), 'the notices file has altered the notice');
  assert.ok(creditsPage.includes(escapeHtml(esdb)), 'the credits page has altered the notice');
});

test('the dictionary acknowledgements survive intact', () => {
  const [esdb] = wordFile.notice;
  assert.match(esdb, /Alan Beale/);
  assert.match(esdb, /Corpus of Contemporary American English/);
  assert.match(esdb, /12dicts and ENABLE2K/);
});

test('the sentence file states its licence and where the authors are listed', () => {
  const text = sentenceFile.notice.join(' ');
  assert.ok(text.includes(LICENSE_URL));
  assert.match(text, /copyright of their authors/);
  assert.match(text, /credits\.html/);
});

test('the notices file matches the data it describes', () => {
  assert.ok(notices.includes(`${rows.length.toLocaleString('en-US')} sentences`));
  assert.ok(notices.includes(`${authorCounts.size.toLocaleString('en-US')} authors`));
  assert.ok(notices.includes(LICENSE_URL));
});

test('the game links to the credits from the play screen and from settings', () => {
  const links = indexPage.match(/href="credits\.html"/g) ?? [];
  assert.ok(links.length >= 2, `only ${links.length} links to the credits page`);
});

test('the settings screen names the licence and both sources without running any script', () => {
  const credit = /<p class="credits" id="credits">([\s\S]*?)<\/p>/.exec(indexPage)?.[1] ?? '';
  assert.match(credit, /Tatoeba/);
  assert.match(credit, /CC BY 2\.0 FR/);
  assert.match(credit, /English Speller Database/);
  assert.match(credit, /Kevin Atkinson/);
});

test('both pages share one theme script rather than copies of it', () => {
  assert.ok(indexPage.includes('src="js/theme-boot.js"'));
  assert.ok(creditsPage.includes('src="js/theme-boot.js"'));
  assert.ok(!/matchMedia\('\(prefers-color-scheme/.test(indexPage), 'index.html still carries its own copy');
});
