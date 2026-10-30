import { wordKey } from '../js/storage.js';

export const MAX_WORD_LENGTH = 14;
export const RARE_RANK = 3000;
export const POOL_SIZE = 100000;
export const COVERAGE_TIERS = [
  { upTo: 5000, min: 20 },
  { upTo: Infinity, min: 5 },
];

const SHORT_WORDS = 20;
const SMALL_POSTING_LIST = 2000;
const PROBES = 400;

const SAFE_SENTENCE = /^[A-Za-z ,.'!?;:-]+$/;

const POSITIVE_CONTRACTIONS = {
  "'m": ['i'],
  "'re": ['you', 'we', 'they', 'what', 'who', 'there'],
  "'ve": ['i', 'you', 'we', 'they', 'would', 'could', 'should', 'might', 'must'],
  "'ll": ['i', 'you', 'he', 'she', 'it', 'we', 'they', 'that', 'there', 'who', 'what'],
  "'d": ['i', 'you', 'he', 'she', 'it', 'we', 'they', 'who', 'there', 'what'],
  "'s": ['he', 'she', 'it', 'that', 'there', 'here', 'what', 'who', 'where', 'how', 'when', 'why', 'let'],
};

const NEGATIVE_STEMS = [
  'do', 'does', 'did', 'is', 'are', 'was', 'were', 'have', 'has', 'had',
  'would', 'could', 'should', 'must', 'need', 'might',
];

const IRREGULAR_NEGATIVES = ["can't", "won't", "shan't"];

export const CONTRACTIONS = new Set([
  ...IRREGULAR_NEGATIVES,
  ...NEGATIVE_STEMS.map((stem) => `${stem}n't`),
  ...Object.entries(POSITIVE_CONTRACTIONS).flatMap(([suffix, stems]) =>
    stems.map((stem) => `${stem}${suffix}`),
  ),
]);

export function tokenize(text) {
  return text.split(/\s+/).filter(Boolean).map(wordKey);
}

export function parseVocabulary(text) {
  const lines = text.split('\n');
  const start = lines.indexOf('---');
  if (start === -1) throw new Error('word list had no separator line');

  const shape = new RegExp(`^[a-z]{1,${MAX_WORD_LENGTH}}$`);
  return new Set(
    lines
      .slice(start + 1)
      .map((line) => line.trim())
      .filter((line) => shape.test(line)),
  );
}

export function parseNotice(text) {
  const lines = text.split('\n');
  const end = lines.indexOf('---');
  if (end === -1) throw new Error('word list had no separator line');
  return lines.slice(0, end).join('\n').trim();
}

export function parseDetailedLine(line) {
  const [id, language, rawText, rawAuthor] = line.split('\t');
  const text = rawText?.trim();
  if (!/^\d+$/.test(id ?? '') || language !== 'eng' || !text) return null;

  const author = rawAuthor === undefined || rawAuthor === '\\N' ? '' : rawAuthor.trim();
  return { id: Number(id), text, author: author === '' ? null : author };
}

export function isAcceptable(token, vocabulary) {
  if (token === 'i') return true;
  if (!token.includes("'")) return vocabulary.has(token);
  if (CONTRACTIONS.has(token)) return true;

  const possessive = /^([a-z]+)'s$/.exec(token);
  return possessive !== null && vocabulary.has(possessive[1]);
}

export function countTokens(texts) {
  const counts = new Map();
  for (const text of texts) {
    for (const token of tokenize(text)) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export function rankTokens(counts, vocabulary) {
  return [...counts.entries()]
    .filter(([token]) => isAcceptable(token, vocabulary))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([token]) => token);
}

export function displayToken(token) {
  return token.replace(/^i(?='|$)/, 'I');
}

export function isUsableSentence(text) {
  if (!SAFE_SENTENCE.test(text)) return false;
  if (!/^[A-Z]/.test(text)) return false;
  return '.!?'.includes(text.at(-1));
}

export function rarity(tokens, rankOf) {
  if (tokens.length === 0) throw new Error('a sentence with no words has no rarity');

  let rare = 0;
  for (const token of tokens) {
    const rank = rankOf.get(token);
    if (rank === undefined || rank > RARE_RANK) rare += 1;
  }
  return rare / tokens.length;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(items, random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function floorFor(tiers, position) {
  return tiers.find((tier) => position < tier.upTo).min;
}

function tryOrder(list, candidates, random) {
  const isShort = (index) => candidates[index].length <= SHORT_WORDS;

  if (list.length <= SMALL_POSTING_LIST) {
    const order = shuffled(list, random);
    return [...order.filter(isShort), ...order.filter((index) => !isShort(index))];
  }

  const probes = Array.from({ length: PROBES }, () => list[Math.floor(random() * list.length)]);
  return [...probes.filter(isShort), ...probes.filter((index) => !isShort(index))];
}

export function selectPool(candidates, ranked, { size = POOL_SIZE, tiers = COVERAGE_TIERS, random }) {
  const postings = new Map();
  candidates.forEach((candidate, index) => {
    for (const token of candidate.tokens) {
      let list = postings.get(token);
      if (!list) {
        list = [];
        postings.set(token, list);
      }
      list.push(index);
    }
  });

  const need = new Map();
  ranked.forEach((token, position) => {
    const list = postings.get(token);
    if (list) need.set(token, Math.min(floorFor(tiers, position), list.length));
  });

  const taken = new Uint8Array(candidates.length);
  const order = [];

  const take = (index) => {
    taken[index] = 1;
    order.push(index);
    for (const token of candidates[index].tokens) {
      const left = need.get(token);
      if (left > 0) need.set(token, left - 1);
    }
  };

  for (let position = ranked.length - 1; position >= 0 && order.length < size; position -= 1) {
    const token = ranked[position];
    if (!(need.get(token) > 0)) continue;

    for (const index of tryOrder(postings.get(token), candidates, random)) {
      if (need.get(token) <= 0 || order.length >= size) break;
      if (!taken[index]) take(index);
    }
  }

  const covered = order.length;
  const spare = [];
  for (let index = 0; index < candidates.length; index += 1) if (!taken[index]) spare.push(index);
  for (const index of shuffled(spare, random).slice(0, Math.max(0, size - covered))) order.push(index);

  let unmet = 0;
  for (const left of need.values()) if (left > 0) unmet += 1;

  return {
    chosen: order.map((index) => candidates[index]),
    covered,
    filled: order.length - covered,
    unmet,
  };
}
