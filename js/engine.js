export const DRILL_TARGET = 5;
export const PENALTY_MS = 250;
export const IDLE_CAP_MS = 3000;
export const MISS_HEAT = 0.55;
export const COOL_HEAT = 0.18;
export const MARK_FLOOR = 0.02;

export function classifySlip(word, index, key, neighbours = {}) {
  const target = word[index];
  if (target === undefined || key === undefined) return 'other';

  const lower = target.toLowerCase();
  const upper = target.toUpperCase();
  if (key !== target && lower !== upper && (key === upper || key === lower)) return 'shift';
  if (key === word[index + 1] || key === word[index + 2]) return 'race';
  if (index > 0 && key === word[index - 1]) return 'bounce';
  if (neighbours[lower]?.includes(key.toLowerCase())) return 'neighbour';
  return 'other';
}

export function raceZones(word, marks, neighbours = {}) {
  const zones = new Set();
  marks.forEach((mark, index) => {
    if (mark.heat <= MARK_FLOOR) return;
    const key = topMiss(mark);
    if (key === null || classifySlip(word, index, key, neighbours) !== 'race') return;
    for (let i = Math.max(0, index - 1); i <= Math.min(word.length - 1, index + 1); i += 1) {
      zones.add(i);
    }
  });
  return zones;
}

export function createSession(
  words,
  { target = DRILL_TARGET, penalty = PENALTY_MS, neighbours = {}, final = true, planned = null } = {},
) {
  return {
    status: 'idle',
    mode: 'type',
    target: Math.max(1, Math.round(target)),
    penalty: Math.max(0, Math.round(penalty)),
    neighbours,
    words: words.slice(),
    final,
    planned: planned ?? words.length,
    index: 0,
    typed: '',
    drill: null,
    slip: null,
    wordStartedAt: null,
    penaltyUntil: 0,
    flashes: 0,
    startedAt: null,
    lastKeyAt: null,
    ms: { type: 0, drill: 0 },
    keys: { type: { correct: 0, wrong: 0 }, drill: { correct: 0, wrong: 0 } },
    results: [],
  };
}

export function extendSession(state, words, { final = false } = {}) {
  const extended = { ...state, words: [...state.words, ...words], final };
  const spent = final && extended.index >= extended.words.length && extended.status === 'running';
  return spent ? { ...extended, status: 'finished' } : extended;
}

export function totalWords(state) {
  if (state.final) return state.words.length;
  return Math.max(state.planned, state.results.length + 1);
}

export function currentWord(state) {
  if (state.mode === 'drill') return state.drill.word;
  return state.words[state.index] ?? '';
}

export function pressKey(state, key, at) {
  if (state.status === 'finished') return state;
  if (key === 'Backspace') return state;
  if (key.length !== 1) return state;
  if (at < state.penaltyUntil) return state;

  const target = currentWord(state);
  if (!target) return state;

  const ticked = tick(state, at);

  if (key === ' ') {
    if (ticked.typed !== target) return penalize(ticked, at, key);
    return ticked.mode === 'drill' ? advanceDrill(ticked) : commitClean(ticked, at);
  }

  const attempt = ticked.typed + key;
  if (!target.startsWith(attempt)) return penalize(ticked, at, key);

  const scored = {
    ...ticked,
    typed: attempt,
    keys: bump(ticked.keys, ticked.mode, 'correct'),
    wordStartedAt:
      ticked.mode === 'type' && ticked.typed === '' ? at : ticked.wordStartedAt,
  };

  if (attempt !== target || !closesRun(scored)) return scored;
  return scored.mode === 'drill' ? advanceDrill(scored) : commitClean(scored, at);
}

function closesRun(state) {
  if (!state.final || state.index !== state.words.length - 1) return false;
  if (state.mode !== 'drill') return true;
  return state.drill.streak === state.target - 1;
}

function tick(state, at) {
  if (state.status === 'idle') {
    return { ...state, status: 'running', startedAt: at, lastKeyAt: at };
  }
  const gap = Math.min(Math.max(at - state.lastKeyAt, 0), IDLE_CAP_MS);
  return {
    ...state,
    ms: { ...state.ms, [state.mode]: state.ms[state.mode] + gap },
    lastKeyAt: at,
  };
}

function bump(keys, mode, field) {
  return { ...keys, [mode]: { ...keys[mode], [field]: keys[mode][field] + 1 } };
}

function penalize(state, at, key) {
  const word = currentWord(state);
  const index = Math.min(state.typed.length, word.length - 1);
  const struck = {
    ...state,
    typed: '',
    slip: { index, key, word, kind: classifySlip(word, index, key, state.neighbours) },
    penaltyUntil: at + state.penalty,
    flashes: state.flashes + 1,
    keys: bump(state.keys, state.mode, 'wrong'),
  };

  if (struck.mode === 'drill') {
    return {
      ...struck,
      drill: {
        ...struck.drill,
        streak: 0,
        misses: struck.drill.misses + 1,
        marks: markMiss(struck.drill.marks, index, key),
      },
    };
  }
  return {
    ...struck,
    mode: 'drill',
    drill: {
      word,
      streak: 0,
      misses: 1,
      marks: markMiss(blankMarks(word.length), index, key),
    },
  };
}

function blankMarks(length) {
  return Array.from({ length }, () => ({ keys: {}, heat: 0 }));
}

function markMiss(marks, index, key) {
  return marks.map((mark, i) =>
    i === index
      ? {
          keys: { ...mark.keys, [key]: (mark.keys[key] ?? 0) + 1 },
          heat: Math.min(1, mark.heat + MISS_HEAT),
        }
      : mark);
}

function coolMarks(marks) {
  return marks.map((mark) => ({
    ...mark,
    heat: Math.max(0, Math.round((mark.heat - COOL_HEAT) * 1000) / 1000),
  }));
}

export function topMiss(mark) {
  let best = null;
  let most = 0;
  for (const [key, count] of Object.entries(mark.keys)) {
    if (count > most) {
      most = count;
      best = key;
    }
  }
  return best;
}

function commitClean(state, at) {
  const word = currentWord(state);
  const ms = state.wordStartedAt === null ? null : at - state.wordStartedAt;

  return advanceWord({
    ...state,
    wordStartedAt: null,
    results: [...state.results, { word, clean: true, misses: 0, ms }],
  });
}

function advanceDrill(state) {
  const streak = state.drill.streak + 1;
  const marks = coolMarks(state.drill.marks);
  if (streak < state.target) {
    return { ...state, typed: '', drill: { ...state.drill, streak, marks } };
  }
  return advanceWord({
    ...state,
    results: [
      ...state.results,
      { word: state.drill.word, clean: false, misses: state.drill.misses, ms: null },
    ],
  });
}

function advanceWord(state) {
  const index = state.index + 1;
  return {
    ...state,
    index,
    typed: '',
    mode: 'type',
    drill: null,
    wordStartedAt: null,
    status: state.final && index >= state.words.length ? 'finished' : state.status,
  };
}

export function summarize(state, now = null) {
  const tally = state.keys.type;
  const attempts = tally.correct + tally.wrong;
  const clean = state.results.filter((result) => result.clean);
  const drilled = state.results.filter((result) => !result.clean);
  const ms = now === null || state.status !== 'running' ? state.ms : tick(state, now).ms;
  const minutes = ms.type / 60000;
  const chars = tally.correct + clean.length;

  return {
    wpm: minutes > 0 ? chars / 5 / minutes : 0,
    accuracy: attempts > 0 ? tally.correct / attempts : 1,
    words: state.results.length,
    cleanWords: clean.length,
    drilledWords: drilled.map((result) => result.word),
    drillsEntered: drilled.length + (state.mode === 'drill' ? 1 : 0),
    drillMisses: drilled.reduce((sum, result) => sum + result.misses, 0) + (state.drill?.misses ?? 0),
    typeMs: ms.type,
    drillMs: ms.drill,
  };
}
