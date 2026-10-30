import { wordKey, medianPace, applyResult } from './storage.js';
import { describeNeed } from './need.js';

export const LENGTH_SPANS = {
  short: [3, 6],
  medium: [5, 12],
  long: [10, 30],
  any: [1, Infinity],
};

export const VOCABULARY = {
  any: 1,
  mostly: 0.15,
  common: 0,
};

export const RARITY_WEIGHT = 2;
export const RECENT_PENALTY = 3;
export const TEMPERATURE = 1;

export function prepare(list) {
  const items = list.sentences.map((sentence) => {
    const words = sentence.text.split(/\s+/);
    return { ...sentence, length: words.length, keys: [...new Set(words.map(wordKey))] };
  });

  const postings = new Map();
  const idIndex = new Map();
  items.forEach((item, index) => {
    if (item.id !== null) idIndex.set(item.id, index);
    for (const key of item.keys) {
      let list = postings.get(key);
      if (!list) {
        list = [];
        postings.set(key, list);
      }
      list.push(index);
    }
  });

  return { items, postings, idIndex };
}

export function createPicker(prepared, profile, options = {}, random = Math.random) {
  const { span = 'medium', vocabulary = 'any' } = options;
  const [minLength, maxLength] = LENGTH_SPANS[span] ?? LENGTH_SPANS.medium;
  const ceiling = VOCABULARY[vocabulary] ?? VOCABULARY.any;

  const { items, postings, idIndex } = prepared;
  const total = items.length;

  const overlay = { ...profile.words };
  const { needOf } = describeNeed(overlay, medianPace(profile));

  const base = new Float64Array(total);
  const weight = new Float64Array(total);
  const needSum = new Float64Array(total);
  const eligible = new Uint8Array(total);
  const recency = new Float64Array(total);

  items.forEach((item, index) => {
    base[index] = -RARITY_WEIGHT * item.rarity;
    weight[index] = 1 / Math.sqrt(item.length);
    eligible[index] =
      item.length >= minLength && item.length <= maxLength && item.rarity <= ceiling ? 1 : 0;
  });

  for (const id of profile.recent ?? []) {
    const index = idIndex.get(id);
    if (index === undefined) continue;
    recency[index] = RECENT_PENALTY;
    base[index] -= RECENT_PENALTY;
  }

  function addNeed(key, delta) {
    const list = postings.get(key);
    if (!list) return;
    for (const index of list) needSum[index] += delta;
  }

  for (const key of Object.keys(overlay)) {
    const need = needOf(key);
    if (need > 0) addNeed(key, need);
  }

  function observe(result) {
    const key = wordKey(result.word);
    const before = needOf(key);
    overlay[key] = applyResult(overlay[key], result, key);
    const delta = needOf(key) - before;
    if (delta !== 0) addNeed(key, delta);
  }

  function next() {
    let best = -Infinity;
    let chosen = -1;

    for (let index = 0; index < total; index += 1) {
      if (eligible[index] === 0) continue;

      const score = base[index] + needSum[index] * weight[index];
      const draw = random();
      const gumbel = -Math.log(-Math.log(draw > 0 ? draw : Number.MIN_VALUE));
      const key = score / TEMPERATURE + gumbel;

      if (key > best) {
        best = key;
        chosen = index;
      }
    }

    if (chosen < 0) return null;
    eligible[chosen] = 0;
    return items[chosen];
  }

  function score(index) {
    return base[index] + needSum[index] * weight[index];
  }

  function recompute(index) {
    const item = items[index];
    let need = 0;
    for (const key of item.keys) need += needOf(key);
    return -RARITY_WEIGHT * item.rarity - recency[index] + need * weight[index];
  }

  function remaining() {
    let count = 0;
    for (let index = 0; index < total; index += 1) count += eligible[index];
    return count;
  }

  return { next, observe, score, recompute, remaining };
}
