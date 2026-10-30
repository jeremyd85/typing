const STORAGE_KEY = 'typing-game/profile/v1';
const PROFILE_VERSION = 1;
const MAX_RUNS = 200;
const HEAT_PER_MISS = 0.5;
const HEAT_PER_CLEAN = 0.08;
const PACE_WEIGHT = 0.3;
const PACE_CEILING = 1200;
const MIN_TIMED = 12;
export const RECENT_LIMIT = 600;

export function wordKey(word) {
  const trimmed = word
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '');
  return trimmed === '' ? word.toLowerCase() : trimmed;
}

export function displayKey(key) {
  return key.replace(/^i(?='|$)/, 'I');
}

export function emptyProfile() {
  return {
    version: PROFILE_VERSION,
    createdAt: new Date().toISOString(),
    runs: [],
    words: {},
    recent: [],
  };
}

export function load() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return emptyProfile();
  }
  if (!raw) return emptyProfile();
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return emptyProfile();
  }
}

export function save(profile) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

export function clear() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    return false;
  }
  return true;
}

export function normalize(value) {
  if (!value || typeof value !== 'object') throw new Error('profile is not an object');
  if (value.version !== PROFILE_VERSION) throw new Error(`unsupported profile version ${value.version}`);
  return {
    version: PROFILE_VERSION,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    runs: Array.isArray(value.runs) ? value.runs : [],
    words: value.words && typeof value.words === 'object' ? value.words : {},
    recent: Array.isArray(value.recent)
      ? value.recent.filter(Number.isInteger).slice(-RECENT_LIMIT)
      : [],
  };
}

export function applyResult(prior, result, key, at = 0) {
  const base = prior ?? { seen: 0, misses: 0, drills: 0, heat: 0 };
  const heat = result.clean
    ? Math.max(0, base.heat - HEAT_PER_CLEAN)
    : Math.min(1, base.heat + HEAT_PER_MISS * result.misses);

  return {
    seen: base.seen + 1,
    misses: base.misses + result.misses,
    drills: base.drills + (result.clean ? 0 : 1),
    heat: Math.round(heat * 1000) / 1000,
    pace: nextPace(base.pace ?? null, result, key),
    lastSeenAt: at,
  };
}

export function recordRun(
  profile,
  { results, summary, listId, reps = null, layout = null, sentenceIds = [], at = Date.now() },
) {
  const words = { ...profile.words };

  for (const result of results) {
    const key = wordKey(result.word);
    words[key] = applyResult(words[key], result, key, at);
  }

  const recent = [
    ...(profile.recent ?? []).filter((id) => !sentenceIds.includes(id)),
    ...sentenceIds,
  ].slice(-RECENT_LIMIT);

  const run = {
    at,
    listId,
    reps,
    layout,
    words: summary.words,
    wpm: Math.round(summary.wpm * 10) / 10,
    accuracy: Math.round(summary.accuracy * 1000) / 1000,
    cleanWords: summary.cleanWords,
    drilledWords: summary.drilledWords.map(wordKey),
    drillMisses: summary.drillMisses,
    typeMs: Math.round(summary.typeMs),
    drillMs: Math.round(summary.drillMs),
  };

  return { ...profile, words, recent, runs: [...profile.runs, run].slice(-MAX_RUNS) };
}

function nextPace(prior, result, key) {
  if (!result.clean || typeof result.ms !== 'number' || result.ms <= 0) return prior;

  const perChar = result.ms / Math.max(1, key.length);
  if (perChar > PACE_CEILING) return prior;
  if (prior === null) return Math.round(perChar);

  return Math.round(prior * (1 - PACE_WEIGHT) + perChar * PACE_WEIGHT);
}

export function medianPace(profile) {
  const paces = Object.values(profile.words)
    .map((stat) => stat.pace)
    .filter((pace) => typeof pace === 'number')
    .sort((a, b) => a - b);
  if (paces.length < MIN_TIMED) return null;

  const middle = Math.floor(paces.length / 2);
  return paces.length % 2 === 0 ? (paces[middle - 1] + paces[middle]) / 2 : paces[middle];
}

export function slowWords(profile, limit = 8) {
  const median = medianPace(profile);
  if (median === null) return [];

  return Object.entries(profile.words)
    .filter(([, stat]) => typeof stat.pace === 'number' && stat.pace > median)
    .sort((a, b) => b[1].pace - a[1].pace)
    .slice(0, limit)
    .map(([word, stat]) => ({
      ...stat,
      word: displayKey(word),
      wpm: Math.round(12000 / stat.pace),
    }));
}

export function problemWords(profile, limit = 8) {
  return Object.entries(profile.words)
    .filter(([, stat]) => stat.heat > 0.01)
    .sort((a, b) => b[1].heat - a[1].heat || b[1].misses - a[1].misses)
    .slice(0, limit)
    .map(([word, stat]) => ({ ...stat, word: displayKey(word) }));
}

export function lifetime(profile) {
  const runs = profile.runs;
  if (runs.length === 0) return { runs: 0, bestWpm: 0, recentWpm: 0, recentAccuracy: 0, words: 0 };
  const recent = runs.slice(-10);
  return {
    runs: runs.length,
    bestWpm: Math.max(...runs.map((run) => run.wpm)),
    recentWpm: recent.reduce((sum, run) => sum + run.wpm, 0) / recent.length,
    recentAccuracy: recent.reduce((sum, run) => sum + run.accuracy, 0) / recent.length,
    words: runs.reduce((sum, run) => sum + run.words, 0),
  };
}
