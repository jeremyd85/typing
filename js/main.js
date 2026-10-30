import { createSession, extendSession, pressKey, summarize } from './engine.js';
import { loadList, loadSentences, buildRun } from './wordbank.js';
import { LENGTH_SPANS, VOCABULARY, createPicker, prepare } from './selector.js';
import * as storage from './storage.js';
import * as audio from './audio.js';
import * as view from './render.js';
import { LAYOUTS, buildNeighbours } from './layouts.js';

const WORDS_URL = 'data/english-common.json';
const SENTENCES_URL = 'data/english-sentences.json';
const PREFS_KEY = 'typing-game/prefs/v1';
const LENGTHS = [10, 25, 50];
const REPS = [3, 5, 7, 10];
const THEMES = ['system', 'light', 'dark'];
const MODES = ['words', 'sentences'];
const LAYOUT_NAMES = Object.keys(LAYOUTS);
const SPANS = Object.keys(LENGTH_SPANS);
const VOCABULARIES = Object.keys(VOCABULARY);
const PENALTY_RANGE = { min: 0, max: 1000 };
const TICK_MS = 200;
const LOOKAHEAD_WORDS = 36;

const RUN_TOGGLES = [
  { key: 'contractions', id: 'contractions', label: 'contractions' },
  { key: 'punctuation', id: 'punctuation', label: 'punctuation' },
  { key: 'capitals', id: 'capitals', label: 'capitals' },
];

const DEFAULT_PREFS = {
  mode: 'words',
  layout: 'colemak-dh',
  length: 25,
  reps: 5,
  penalty: 250,
  contractions: true,
  punctuation: false,
  capitals: false,
  span: 'medium',
  vocabulary: 'any',
  theme: 'system',
  zen: true,
  sound: false,
};

let words = null;
let prepared = null;
let sentenceListId = 'english-sentences';
let loadingSentences = false;
let picker = null;
let fed = 0;
let observed = 0;
let profile = storage.emptyProfile();
let prefs = { ...DEFAULT_PREFS };
let session = null;
let runCredits = [];
let ticker = null;
let relayout = null;
let revealed = false;
let settingsOpen = false;
let keytrap = null;

async function main() {
  view.mount(document);

  prefs = loadPrefs();
  profile = storage.load();
  audio.setEnabled(prefs.sound);
  applyTheme();

  try {
    words = await loadList(WORDS_URL);
  } catch (error) {
    view.paintMessage(`${error.message}. serve this folder over http, not file://`);
    return;
  }

  bindControls();
  paintChoices();
  paintSound();
  paintProfile();
  startRun();
  paintFocus();

  document.addEventListener('keydown', onKeyDown);
  watchLayout();
  watchFocus();
}

function watchFocus() {
  keytrap = document.getElementById('keytrap');

  keytrap.addEventListener('input', () => {
    const typed = keytrap.value;
    keytrap.value = '';
    if (settingsOpen) return;
    for (const key of typed) type(key);
  });
  keytrap.addEventListener('blur', () => {
    window.setTimeout(grabKeys, 0);
  });
  window.addEventListener('focus', grabKeys);
  document.addEventListener('click', (event) => {
    if (event.target.closest('button, input, label, a')) return;
    grabKeys();
  });

  grabKeys();
}

function grabKeys() {
  if (!keytrap || settingsOpen) return;
  if (document.activeElement !== keytrap) keytrap.focus({ preventScroll: true });
}

function watchLayout() {
  const settle = () => {
    if (relayout !== null) return;
    relayout = window.requestAnimationFrame(() => {
      relayout = null;
      if (session) view.paintStream(session);
    });
  };

  window.addEventListener('resize', settle);
  new ResizeObserver(settle).observe(document.getElementById('stream'));
}

function loadPrefs() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}');
    const flag = (key) =>
      typeof stored[key] === 'boolean' ? stored[key] : DEFAULT_PREFS[key];

    return {
      mode: MODES.includes(stored.mode) ? stored.mode : DEFAULT_PREFS.mode,
      layout: LAYOUT_NAMES.includes(stored.layout) ? stored.layout : DEFAULT_PREFS.layout,
      length: LENGTHS.includes(stored.length) ? stored.length : DEFAULT_PREFS.length,
      reps: REPS.includes(stored.reps) ? stored.reps : DEFAULT_PREFS.reps,
      penalty:
        Number.isFinite(stored.penalty) &&
        stored.penalty >= PENALTY_RANGE.min &&
        stored.penalty <= PENALTY_RANGE.max
          ? stored.penalty
          : DEFAULT_PREFS.penalty,
      contractions: flag('contractions'),
      punctuation: flag('punctuation'),
      capitals: flag('capitals'),
      span: SPANS.includes(stored.span) ? stored.span : DEFAULT_PREFS.span,
      vocabulary: VOCABULARIES.includes(stored.vocabulary)
        ? stored.vocabulary
        : DEFAULT_PREFS.vocabulary,
      theme: THEMES.includes(stored.theme) ? stored.theme : DEFAULT_PREFS.theme,
      zen: flag('zen'),
      sound: flag('sound'),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs() {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    view.notice('could not save preferences to local storage', true);
  }
}

function bindControls() {
  for (const button of document.querySelectorAll('#modes button')) {
    button.addEventListener('click', () => {
      prefs.mode = button.dataset.mode;
      savePrefs();
      paintChoices();
      startRun();
      button.blur();
    });
  }

  for (const button of document.querySelectorAll('#lengths button')) {
    button.addEventListener('click', () => {
      prefs.length = Number(button.dataset.length);
      savePrefs();
      paintChoices();
      startRun();
      button.blur();
    });
  }

  for (const button of document.querySelectorAll('#reps button')) {
    button.addEventListener('click', () => {
      prefs.reps = Number(button.dataset.reps);
      savePrefs();
      paintChoices();
      startRun();
      button.blur();
    });
  }

  const penalty = document.getElementById('penalty');
  penalty.addEventListener('input', () => {
    document.getElementById('penalty-value').textContent = `${penalty.value}ms`;
  });
  penalty.addEventListener('change', () => {
    prefs.penalty = Number(penalty.value);
    savePrefs();
    startRun();
    penalty.blur();
  });

  for (const button of document.querySelectorAll('#layouts button')) {
    button.addEventListener('click', () => {
      prefs.layout = button.dataset.layout;
      savePrefs();
      paintChoices();
      startRun();
      button.blur();
    });
  }

  for (const { key, id } of RUN_TOGGLES) {
    const button = document.getElementById(id);
    button.addEventListener('click', () => {
      prefs[key] = !prefs[key];
      savePrefs();
      paintChoices();
      startRun();
      button.blur();
    });
  }

  for (const button of document.querySelectorAll('#spans button')) {
    button.addEventListener('click', () => {
      prefs.span = button.dataset.span;
      savePrefs();
      paintChoices();
      startRun();
      button.blur();
    });
  }

  for (const button of document.querySelectorAll('#vocabularies button')) {
    button.addEventListener('click', () => {
      prefs.vocabulary = button.dataset.vocabulary;
      savePrefs();
      paintChoices();
      startRun();
      button.blur();
    });
  }

  for (const button of document.querySelectorAll('#themes button')) {
    button.addEventListener('click', () => {
      prefs.theme = button.dataset.theme;
      savePrefs();
      applyTheme();
      paintChoices();
      button.blur();
    });
  }

  systemIsLight().addEventListener('change', () => {
    if (prefs.theme === 'system') applyTheme();
  });

  document.getElementById('settings-open').addEventListener('click', (event) => {
    showSettings(true);
    event.currentTarget.blur();
  });
  document.getElementById('settings-close').addEventListener('click', (event) => {
    showSettings(false);
    event.currentTarget.blur();
  });

  const zen = document.getElementById('zen');
  zen.addEventListener('click', () => {
    prefs.zen = !prefs.zen;
    savePrefs();
    paintSound();
    paintFocus();
    zen.blur();
  });

  const reveal = () => {
    if (!prefs.zen || revealed || settingsOpen) return;
    revealed = true;
    paintFocus();
  };
  document.addEventListener('mousemove', reveal);
  document.addEventListener('touchstart', reveal, { passive: true });

  document.getElementById('new-run').addEventListener('click', (event) => {
    event.currentTarget.blur();
    startRun();
  });

  const sound = document.getElementById('sound');
  sound.addEventListener('click', () => {
    prefs.sound = !prefs.sound;
    audio.setEnabled(prefs.sound);
    savePrefs();
    paintSound();
    if (prefs.sound) audio.blip();
    sound.blur();
  });

  const picker = document.getElementById('import-file');

  document.getElementById('export').addEventListener('click', (event) => {
    exportProfile();
    event.currentTarget.blur();
  });

  document.getElementById('import').addEventListener('click', (event) => {
    picker.click();
    event.currentTarget.blur();
  });

  document.getElementById('reset').addEventListener('click', (event) => {
    event.currentTarget.blur();
    if (!window.confirm('Erase every saved run and problem word?')) return;
    storage.clear();
    profile = storage.emptyProfile();
    paintProfile();
    startRun();
    view.notice('progress reset');
  });

  picker.addEventListener('change', () => {
    const [file] = picker.files;
    if (file) importProfile(file);
    picker.value = '';
  });
}

function paintChoices() {
  for (const button of document.querySelectorAll('#lengths button')) {
    button.classList.toggle('is-active', Number(button.dataset.length) === prefs.length);
  }
  for (const button of document.querySelectorAll('#modes button')) {
    button.classList.toggle('is-active', button.dataset.mode === prefs.mode);
  }
  for (const button of document.querySelectorAll('#reps button')) {
    button.classList.toggle('is-active', Number(button.dataset.reps) === prefs.reps);
  }
  for (const button of document.querySelectorAll('#layouts button')) {
    button.classList.toggle('is-active', button.dataset.layout === prefs.layout);
  }
  for (const button of document.querySelectorAll('#themes button')) {
    button.classList.toggle('is-active', button.dataset.theme === prefs.theme);
  }
  for (const button of document.querySelectorAll('#spans button')) {
    button.classList.toggle('is-active', button.dataset.span === prefs.span);
  }
  for (const button of document.querySelectorAll('#vocabularies button')) {
    button.classList.toggle('is-active', button.dataset.vocabulary === prefs.vocabulary);
  }
  document.getElementById('penalty').value = String(prefs.penalty);
  document.getElementById('penalty-value').textContent = `${prefs.penalty}ms`;

  for (const { key, id, label } of RUN_TOGGLES) {
    const button = document.getElementById(id);
    button.textContent = `${label} ${prefs[key] ? 'on' : 'off'}`;
    button.setAttribute('aria-pressed', String(prefs[key]));
  }

  document.getElementById('setting-words').hidden = prefs.mode !== 'words';
  document.getElementById('setting-sentence-length').hidden = prefs.mode !== 'sentences';
  document.getElementById('setting-vocabulary').hidden = prefs.mode !== 'sentences';
}

function systemIsLight() {
  return window.matchMedia('(prefers-color-scheme: light)');
}

function applyTheme() {
  const light = prefs.theme === 'light' || (prefs.theme === 'system' && systemIsLight().matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
}

function paintSound() {
  const sound = document.getElementById('sound');
  sound.textContent = prefs.sound ? 'sound on' : 'sound off';
  sound.setAttribute('aria-pressed', String(prefs.sound));

  const zen = document.getElementById('zen');
  zen.textContent = prefs.zen ? 'zen on' : 'zen off';
  zen.setAttribute('aria-pressed', String(prefs.zen));
}

function paintFocus() {
  view.paintFocus(prefs.zen, !settingsOpen && session?.status === 'running' && !revealed);
}

function showSettings(open) {
  settingsOpen = open;
  view.paintSettings(open);
  paintFocus();
  if (open) keytrap?.blur();
  else {
    repaint();
    grabKeys();
  }
}

function paintProfile() {
  view.paintProblems(storage.problemWords(profile));
  view.paintSlow(storage.slowWords(profile));
  view.paintLifetime(storage.lifetime(profile));
}

async function requestSentences() {
  if (prepared || loadingSentences) return;
  loadingSentences = true;

  try {
    const list = await loadSentences(SENTENCES_URL);
    sentenceListId = list.id;
    prepared = prepare(list);
  } catch (error) {
    view.paintMessage(`${error.message}. serve this folder over http, not file://`);
  } finally {
    loadingSentences = false;
  }

  if (prepared && prefs.mode === 'sentences') startRun();
}

function feedRun() {
  while (picker && !session.final && session.words.length - session.index < LOOKAHEAD_WORDS) {
    const item = picker.next();
    if (!item) {
      session = extendSession(session, [], { final: true });
      return;
    }

    const tokens = item.text.split(/\s+/);
    runCredits.push({
      text: item.text,
      id: item.id,
      author: item.author,
      from: session.words.length,
      to: session.words.length + tokens.length,
    });
    fed += tokens.length;
    session = extendSession(session, tokens, { final: fed >= prefs.length });
  }
}

function observeNew() {
  while (picker && observed < session.results.length) {
    picker.observe(session.results[observed]);
    observed += 1;
  }
}

function startRun() {
  stopTicker();
  revealed = false;
  picker = null;
  runCredits = [];
  fed = 0;
  observed = 0;
  grabKeys();

  const options = {
    target: prefs.reps,
    penalty: prefs.penalty,
    neighbours: buildNeighbours(prefs.layout),
  };

  if (prefs.mode === 'sentences') {
    session = createSession([], { ...options, final: false, planned: prefs.length });
    view.hideResults();
    repaint();

    if (!prepared) {
      view.paintMessage('loading sentences');
      requestSentences();
    } else {
      picker = createPicker(prepared, profile, { span: prefs.span, vocabulary: prefs.vocabulary });
      feedRun();
      repaint();
    }
  } else {
    session = createSession(
      buildRun(words, profile, prefs.length, Math.random, {
        contractions: prefs.contractions,
        punctuation: prefs.punctuation,
        capitals: prefs.capitals,
      }),
      options,
    );
    view.hideResults();
    repaint();
  }

  paintFocus();
}

function repaint() {
  view.paintStream(session);
  view.paintDrill(session);
  view.paintStats(session, summarize(session, performance.now()));
}

function startTicker() {
  ticker ??= window.setInterval(() => {
    if (session.status !== 'running') {
      stopTicker();
      return;
    }
    view.paintStats(session, summarize(session, performance.now()));
  }, TICK_MS);
}

function stopTicker() {
  if (ticker !== null) window.clearInterval(ticker);
  ticker = null;
}

function onKeyDown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (settingsOpen) {
    if (event.key === 'Escape') {
      event.preventDefault();
      showSettings(false);
    }
    return;
  }

  if (event.key === 'Tab' || event.key === 'Escape') {
    event.preventDefault();
    startRun();
    return;
  }

  if (event.key === 'Backspace') {
    event.preventDefault();
    return;
  }

  if (event.key.length !== 1) return;
  event.preventDefault();
  type(event.key);
}

function type(key) {
  const before = session;
  session = pressKey(session, key, performance.now());
  if (session === before) return;

  observeNew();
  feedRun();

  if (session.status === 'finished') finishRun();
  else startTicker();

  repaint();
  react(before, session);

  if (revealed) revealed = false;
  paintFocus();
}

function react(before, after) {
  if (after.flashes > before.flashes) {
    view.strike(after);
    audio.thud();
    return;
  }
  if (before.mode === 'drill' && after.mode === 'type') {
    audio.chime();
    return;
  }
  if (after.mode === 'drill' && after.drill.streak > before.drill.streak) audio.blip();
}

function finishRun() {
  stopTicker();
  const summary = summarize(session);
  profile = storage.recordRun(profile, {
    results: session.results,
    summary,
    listId: prefs.mode === 'sentences' ? sentenceListId : words.id,
    reps: session.target,
    layout: prefs.layout,
    sentenceIds: runCredits.map((entry) => entry.id).filter((id) => id !== null),
  });
  if (!storage.save(profile)) {
    view.notice('local storage refused the write, so this run was not saved', true);
  }
  view.showResults(summary, runCredits);
  paintProfile();
  paintFocus();
}

function exportProfile() {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `typing-progress-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  view.notice(`exported ${profile.runs.length} runs`);
}

async function importProfile(file) {
  try {
    profile = storage.normalize(JSON.parse(await file.text()));
    storage.save(profile);
    paintProfile();
    startRun();
    view.notice(`imported ${profile.runs.length} runs from ${file.name}`);
  } catch (error) {
    view.notice(`import failed: ${error.message}`, true);
  }
}

main();
