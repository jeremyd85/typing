import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  COVERAGE_TIERS,
  POOL_SIZE,
  RARE_RANK,
  countTokens,
  displayToken,
  isUsableSentence,
  mulberry32,
  parseDetailedLine,
  parseNotice,
  parseVocabulary,
  rankTokens,
  rarity,
  selectPool,
  tokenize,
} from './corpus.mjs';
import { LICENSE_URL, TATOEBA_HOME, renderCreditsPage, renderNotices } from './credits.mjs';

const CACHE = new URL('../.cache/', import.meta.url);
const DATA = new URL('../data/', import.meta.url);
const ROOT = new URL('../', import.meta.url);

const SCOWL_URL =
  'http://app.aspell.net/create?max_size=35&spelling=US&max_variant=0&diacritic=strip&download=wordlist&encoding=utf-8&format=inline';
const TATOEBA_URL =
  'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences_detailed.tsv.bz2';

const WORD_COUNT = 1000;
const SEED = 20261022;

const TATOEBA_NOTICE =
  `Sentences are from the Tatoeba Project (${TATOEBA_HOME}) and are copyright of their authors, ` +
  `used unmodified under CC BY 2.0 FR (${LICENSE_URL}). Each row of the sentence file gives the ` +
  'id of the original sentence and the name of its author. credits.html lists the authors.';

const FREQUENCY_NOTICE =
  `Word frequencies were counted over the English corpus of the Tatoeba Project (${TATOEBA_HOME}).`;

mkdirSync(CACHE, { recursive: true });

function cached(name, url, { bunzip = false } = {}) {
  const target = new URL(name, CACHE);
  if (existsSync(target)) return target;

  if (bunzip) {
    const archive = new URL(`${name}.bz2`, CACHE);
    if (!existsSync(archive)) {
      process.stdout.write(`downloading ${url}\n`);
      execFileSync('curl', ['-sS', '--max-time', '900', '-o', archive.pathname, url]);
    }
    execFileSync('bunzip2', ['-kf', archive.pathname]);
    return target;
  }

  process.stdout.write(`downloading ${url}\n`);
  execFileSync('curl', ['-sS', '--max-time', '300', '-o', target.pathname, url]);
  return target;
}

function readCorpus(path) {
  const texts = [];
  const eligible = [];
  const seen = new Set();
  let unattributed = 0;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const entry = parseDetailedLine(line);
    if (!entry) continue;
    texts.push(entry.text);

    if (entry.author === null) {
      unattributed += 1;
      continue;
    }
    if (!isUsableSentence(entry.text)) continue;

    const key = entry.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const tokens = [...new Set(tokenize(entry.text))];
    if (tokens.length === 0) continue;
    eligible.push({ ...entry, tokens, length: entry.text.split(/\s+/).length });
  }

  return { texts, eligible, unattributed };
}

function write(url, text) {
  writeFileSync(url, text);
}

const scowlText = readFileSync(cached('scowl-35.txt', SCOWL_URL), 'utf8');
const vocabulary = parseVocabulary(scowlText);
const esdbHeader = parseNotice(scowlText);

const { texts, eligible, unattributed } = readCorpus(
  cached('eng_sentences_detailed.tsv', TATOEBA_URL, { bunzip: true }),
);

const counts = countTokens(texts);
const ranked = rankTokens(counts, vocabulary);
const rankOf = new Map(ranked.map((token, index) => [token, index + 1]));

const words = ranked.slice(0, WORD_COUNT).map(displayToken);

const { chosen, covered, filled, unmet } = selectPool(eligible, ranked, {
  size: POOL_SIZE,
  tiers: COVERAGE_TIERS,
  random: mulberry32(SEED),
});

const pool = chosen
  .map((item) => ({
    text: item.text,
    id: item.id,
    author: item.author,
    rarity: Math.round(rarity(tokenize(item.text), rankOf) * 1000) / 1000,
  }))
  .sort((a, b) => a.rarity - b.rarity || a.id - b.id);

const authors = new Set(pool.map((item) => item.author));

write(
  new URL('english-common.json', DATA),
  `${JSON.stringify(
    {
      id: 'english-common',
      label: 'English (common)',
      orderedByFrequency: true,
      vocabulary: 'ESDB / SCOWL size 35, US spelling, no variants, used only to reject non-words and names',
      frequency: 'counted over the Tatoeba English corpus, contractions counted as whole tokens',
      notice: [esdbHeader, FREQUENCY_NOTICE],
      words,
    },
    null,
    1,
  )}\n`,
);

const header = JSON.stringify(
  {
    id: 'english-sentences',
    label: 'English (sentences)',
    rareRank: RARE_RANK,
    rarity: `share of a sentence's words beyond rank ${RARE_RANK} in corpus frequency, counting a word the dictionary lacks as rare. 0 means every word is common`,
    row: ['text', 'rarity', 'tatoeba sentence id', 'author'],
    notice: [TATOEBA_NOTICE],
  },
  null,
  1,
).slice(0, -2);

const rows = pool
  .map((item) => `  ${JSON.stringify([item.text, item.rarity, item.id, item.author])}`)
  .join(',\n');
write(new URL('english-sentences.json', DATA), `${header},\n "sentences": [\n${rows}\n ]\n}\n`);

const selection = {
  corpus: texts.length,
  eligible: eligible.length,
  pool: pool.length,
  covered,
  filled,
  topWords: COVERAGE_TIERS[0].upTo,
  topMin: COVERAGE_TIERS[0].min,
  restMin: COVERAGE_TIERS[1].min,
};

write(new URL('credits.html', ROOT), renderCreditsPage({ picked: pool, esdbHeader, selection }));
write(
  new URL('THIRD_PARTY_NOTICES.md', ROOT),
  renderNotices({ esdbHeader, picked: pool.length, authors: authors.size }),
);

const within = (limit) => pool.filter((item) => item.rarity <= limit).length;
const lengths = pool.map((item) => item.text.split(/\s+/).length).sort((a, b) => a - b);
const apostrophes = words.filter((word) => word.includes("'"));

process.stdout.write(
  [
    `scowl vocabulary   ${vocabulary.size} (dictionary only)`,
    `ranked tokens      ${ranked.length}`,
    `corpus sentences   ${texts.length}, ${unattributed} without an author (counted, never shipped)`,
    `eligible           ${eligible.length} with an author and typeable characters`,
    `word list          ${words.length}, ${apostrophes.length} contractions (${words.slice(0, 10).join(' ')} ...)`,
    `sentence pool      ${pool.length} by ${authors.size} authors`,
    `  drawn for coverage ${covered}, drawn at random ${filled}, words short of their floor ${unmet}`,
    `  words per sentence p5 ${lengths[Math.floor(lengths.length * 0.05)]}, median ${lengths[Math.floor(lengths.length / 2)]}, p95 ${lengths[Math.floor(lengths.length * 0.95)]}, max ${lengths.at(-1)}`,
    `  no rare words ${within(0)}, at most 15% rare ${within(0.15)}, at most 30% rare ${within(0.3)}`,
    '',
  ].join('\n'),
);
