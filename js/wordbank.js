import { wordKey, medianPace } from './storage.js';
import { HEAT_BOOST, HEAT_FLOOR, SLOW_BOOST, SLOW_FLOOR, describeNeed } from './need.js';

const FREQUENCY_FALLOFF = 0.55;
const RESERVED_SHARE = 0.3;
const CAPITAL_RATE = 0.2;
const PUNCTUATION_RATE = 0.2;
const MARKS = [',', ',', '.', '.', '?', '!', ';', ':'];

export function normalizeSentenceList(raw) {
  if (!Array.isArray(raw.sentences) || raw.sentences.length === 0) {
    throw new Error('sentence list is empty');
  }

  return {
    id: raw.id,
    label: raw.label,
    notice: raw.notice ?? [],
    sentences: raw.sentences.map((row) => {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'number') {
        throw new Error(`malformed sentence row: ${JSON.stringify(row)}`);
      }
      return { text: row[0], rarity: row[1], id: row[2] ?? null, author: row[3] ?? null };
    }),
  };
}

export async function loadSentences(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load ${url}: ${response.status}`);
  try {
    return normalizeSentenceList(await response.json());
  } catch (error) {
    throw new Error(`${url}: ${error.message}`);
  }
}

export function decorate(words, options = {}, random = Math.random) {
  const { capitals = false, punctuation = false } = options;
  if (!capitals && !punctuation) return words;

  return words.map((word) => {
    let out = word;
    if (capitals && random() < CAPITAL_RATE) out = out[0].toUpperCase() + out.slice(1);
    if (punctuation && random() < PUNCTUATION_RATE) {
      out += MARKS[Math.floor(random() * MARKS.length)];
    }
    return out;
  });
}

export async function loadList(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load ${url}: ${response.status}`);
  const list = await response.json();
  if (!Array.isArray(list.words) || list.words.length === 0) {
    throw new Error(`${url} has no words`);
  }
  return { id: list.id, label: list.label, words: list.words, notice: list.notice ?? [] };
}

export function buildRun(list, profile, count, random = Math.random, options = {}) {
  const { contractions = true } = options;
  const entries = list.words
    .map((word, rank) => ({ word, rank }))
    .filter(({ word }) => contractions || !word.includes("'"));
  const pool = entries.map((entry) => entry.word);

  const need = describeNeed(profile.words, medianPace(profile));
  const heatOf = (word) => need.heatOf(wordKey(word));
  const dragOf = (word) => need.dragOf(wordKey(word));

  const budget = Math.ceil(count * RESERVED_SHARE);
  const hot = pool
    .filter((word) => heatOf(word) > HEAT_FLOOR)
    .sort((a, b) => heatOf(b) - heatOf(a))
    .slice(0, budget);

  const slow = pool
    .filter((word) => !hot.includes(word) && dragOf(word) > SLOW_FLOOR)
    .sort((a, b) => dragOf(b) - dragOf(a))
    .slice(0, budget - hot.length);

  const reserved = [...hot, ...slow];

  const cumulative = [];
  let total = 0;
  for (const { word, rank } of entries) {
    total +=
      (1 / (rank + 1) ** FREQUENCY_FALLOFF) *
      (1 + HEAT_BOOST * heatOf(word) + SLOW_BOOST * dragOf(word));
    cumulative.push(total);
  }

  const picked = reserved.slice(0, count);
  while (picked.length < count) {
    picked.push(weightedPick(pool, cumulative, total, random));
  }

  return decorate(arrange(picked, random), options, random);
}

function weightedPick(words, cumulative, total, random) {
  const target = random() * total;
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] < target) low = mid + 1;
    else high = mid;
  }
  return words[low];
}

function arrange(items, random) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);

  const out = [];
  let previous = null;

  while (out.length < items.length) {
    const remaining = items.length - out.length;
    const live = [...counts].filter(([, count]) => count > 0);
    const forced = live.find(([, count]) => count * 2 > remaining);
    const open = live.filter(([word]) => word !== previous);
    const [word] = forced ?? (open.length > 0 ? open[Math.floor(random() * open.length)] : live[0]);

    counts.set(word, counts.get(word) - 1);
    out.push(word);
    previous = word;
  }

  return out;
}
