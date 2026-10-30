import { topMiss, classifySlip, raceZones, totalWords, MARK_FLOOR } from './engine.js';
import { profileUrl, sentenceUrl } from './attribution.js';

let els = null;

export function mount(doc) {
  const pick = (id) => doc.getElementById(id);
  els = {
    doc,
    page: doc.querySelector('.page'),
    play: pick('play'),
    settings: pick('settings'),
    stream: pick('stream'),
    caret: pick('caret'),
    streamInner: pick('stream-inner'),
    drillbar: pick('drillbar'),
    drillNote: pick('drill-note'),
    pips: pick('pips'),
    wpm: pick('stat-wpm'),
    accuracy: pick('stat-accuracy'),
    progress: pick('stat-progress'),
    drills: pick('stat-drills'),
    results: pick('results'),
    resultsTitle: pick('results-title'),
    resultsGrid: pick('results-grid'),
    resultsDrilled: pick('results-drilled'),
    resultsCredits: pick('results-credits'),
    resultsCreditList: pick('results-credit-list'),
    problems: pick('problems'),
    slow: pick('slow'),
    lifetime: pick('lifetime'),
    notice: pick('notice'),
  };

  els.stream.addEventListener('animationend', () => els.stream.classList.remove('is-struck'));
}

const LIVE = new Set(['active', 'drilling']);

const KIND_LABEL = {
  race: 'you ran ahead',
  shift: 'shift slipped',
  bounce: 'finger bounced',
  neighbour: 'next key over',
  other: 'wrong key',
};

function wordNode(word, status, typed, drill = null, neighbours = {}) {
  const zones = drill ? raceZones(word, drill.marks, neighbours) : null;
  return buildWord(word, status, typed, drill?.marks ?? null, zones, neighbours);
}

function buildWord(word, status, typed, marks, zones, neighbours) {
  const node = els.doc.createElement('span');
  node.className = `word is-${status}`;
  const live = LIVE.has(status);
  if (status === 'drilling' && typed.length >= word.length) node.classList.add('is-full');

  for (let i = 0; i < word.length; i += 1) {
    const ch = els.doc.createElement('span');
    ch.className = 'ch';
    if (live && i < typed.length) ch.classList.add('is-hit');
    if (live && i === typed.length) ch.classList.add('is-caret');
    if (live && i === word.length - 1 && typed.length >= word.length) {
      ch.classList.add('is-caret-end');
    }
    ch.textContent = word[i];

    const mark = marks?.[i];
    const miss = mark && mark.heat > MARK_FLOOR ? topMiss(mark) : null;
    if (miss !== null && miss !== undefined) {
      ch.style.setProperty('--miss', JSON.stringify(miss === ' ' ? '\u2423' : miss));
      ch.style.setProperty('--miss-heat', String(mark.heat));
      ch.dataset.kind = classifySlip(word, i, miss, neighbours);
    }

    if (zones?.has(i)) ch.classList.add('is-zone');

    node.append(ch);
  }

  for (const run of zoneRuns(zones, word.length)) {
    const tape = els.doc.createElement('span');
    tape.className = 'tape';
    tape.style.setProperty('--from', String(run.from));
    tape.style.setProperty('--span', String(run.span));
    node.prepend(tape);
  }

  return node;
}

function zoneRuns(zones, length) {
  if (!zones?.size) return [];

  const runs = [];
  let start = null;
  for (let i = 0; i <= length; i += 1) {
    if (zones.has(i)) {
      if (start === null) start = i;
    } else if (start !== null) {
      runs.push({ from: start, span: i - start });
      start = null;
    }
  }
  return runs;
}

function statusFor(state, index) {
  if (index > state.index) return 'pending';
  if (index === state.index) return state.mode === 'drill' ? 'drilling' : 'active';
  return state.results[index]?.clean === false ? 'drilled' : 'done';
}

export function paintStream(state) {
  const fragment = els.doc.createDocumentFragment();
  let active = null;

  state.words.forEach((word, index) => {
    const status = statusFor(state, index);
    const node = wordNode(
      word,
      status,
      LIVE.has(status) ? state.typed : '',
      status === 'drilling' ? state.drill : null,
      state.neighbours,
    );
    if (LIVE.has(status)) active = node;
    fragment.append(node);
  });

  els.streamInner.replaceChildren(fragment);

  if (!active) {
    els.caret.hidden = true;
    return;
  }

  const line = active.offsetHeight;
  const row = active.offsetTop - els.streamInner.firstElementChild.offsetTop;
  const shift = -Math.max(0, row - line);
  els.streamInner.style.transform = `translateY(${shift}px)`;

  placeCaret(active, state, shift);
}

function placeCaret(word, state, shift) {
  const mark = word?.querySelector('.ch.is-caret, .ch.is-caret-end');
  if (!mark || performance.now() < state.penaltyUntil) {
    els.caret.hidden = true;
    return;
  }

  const grid = window.devicePixelRatio || 1;
  const snap = (value) => Math.round(value * grid) / grid;

  const frame = els.stream.getBoundingClientRect();
  const origin = els.streamInner.firstElementChild.getBoundingClientRect();
  const box = mark.getBoundingClientRect();
  const edge = mark.classList.contains('is-caret') ? box.left : box.right;
  const height = snap(box.height * 1.14);

  const x = els.streamInner.offsetLeft + (edge - origin.left) - 1;
  const y =
    els.streamInner.offsetTop +
    (box.top - origin.top) +
    shift +
    (box.height - height) / 2;

  els.caret.hidden = false;
  els.caret.style.left = `${snap(frame.left + x) - frame.left}px`;
  els.caret.style.top = `${snap(frame.top + y) - frame.top}px`;
  els.caret.style.height = `${height}px`;

  for (const motion of els.caret.getAnimations()) motion.currentTime = 0;
}

export function paintDrill(state) {
  const live = state.mode === 'drill';
  els.drillbar.classList.toggle('is-live', live);
  els.stream.classList.toggle('is-drilling', live);
  els.stream.classList.toggle('is-final', live && state.drill.streak === state.target - 1);
  els.stream.style.setProperty(
    '--charge',
    live ? String(state.drill.streak / state.target) : '0',
  );
  if (!live) return;

  if (els.pips.childElementCount !== state.target) {
    els.pips.replaceChildren(
      ...Array.from({ length: state.target }, () => els.doc.createElement('li')),
    );
  }

  for (const [index, pip] of [...els.pips.children].entries()) {
    pip.classList.toggle('is-filled', index < state.drill.streak);
  }

  const left = state.target - state.drill.streak;
  const kind = state.slip?.word === state.drill.word ? state.slip.kind : null;
  els.drillbar.dataset.kind = kind ?? 'none';
  els.drillNote.textContent =
    state.typed === state.drill.word
      ? `space to bank rep ${state.drill.streak + 1} of ${state.target}`
      : [
          `${left} to escape`,
          kind ? KIND_LABEL[kind] : null,
          plural(state.drill.misses, 'slip'),
        ]
          .filter(Boolean)
          .join(' · ');
}

export function paintStats(state, summary) {
  els.wpm.textContent = Math.round(summary.wpm);
  els.accuracy.textContent = `${(summary.accuracy * 100).toFixed(1)}%`;
  els.progress.textContent = `${state.results.length}/${totalWords(state)}`;
  els.drills.textContent = summary.drillsEntered;
}

export function strike(state) {
  els.stream.classList.remove('is-struck');
  void els.stream.offsetWidth;
  els.stream.classList.add('is-struck');
  traceSlip(state);
}

function traceSlip(state) {
  for (const stale of els.stream.querySelectorAll('.slip')) stale.remove();
  if (!state.slip) return;

  const word = els.streamInner.querySelector('.word.is-drilling, .word.is-active');
  const chars = word?.querySelectorAll('.ch');
  if (!chars?.length) return;

  const index = Math.min(state.slip.index, chars.length - 1);
  const missed = chars[index];
  const frame = els.stream.getBoundingClientRect();
  const anchor = els.streamInner.firstElementChild.getBoundingClientRect();
  const origin = missed.getBoundingClientRect();
  const home = chars[0].getBoundingClientRect();
  const base = els.streamInner.offsetLeft;

  const block = els.doc.createElement('span');
  block.className = 'slip';
  block.dataset.index = String(index);
  block.textContent = state.slip.key === ' ' ? '␣' : state.slip.key;
  block.style.left = `${base + (origin.left - anchor.left)}px`;
  block.style.top = `${origin.top - frame.top}px`;
  block.style.width = `${origin.width}px`;
  block.style.height = `${origin.height}px`;
  els.stream.append(block);

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const travel = still
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [
        { left: block.style.left, width: `${origin.width}px`, offset: 0 },
        { left: block.style.left, width: `${origin.width}px`, offset: 0.3 },
        { left: `${base + (home.left - anchor.left)}px`, width: '2px', offset: 1 },
      ];

  const motion = block.animate(travel, {
    duration: Math.max(state.penalty, 160),
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    fill: 'forwards',
  });
  motion.onfinish = () => {
    block.remove();
    paintStream(state);
  };
}

function creditItem(entry) {
  const item = els.doc.createElement('li');

  const text = els.doc.createElement('span');
  text.textContent = entry.text;

  const by = els.doc.createElement('span');
  by.className = 'by';
  const author = els.doc.createElement('a');
  author.href = profileUrl(entry.author);
  author.textContent = entry.author;
  by.append('by ', author);

  const source = els.doc.createElement('a');
  source.className = 'source';
  source.href = sentenceUrl(entry.id);
  source.textContent = `#${entry.id}`;

  for (const link of [author, source]) {
    link.target = '_blank';
    link.rel = 'noopener';
  }

  item.append(text, ' ', by, ' ', source);
  return item;
}

function paintRunCredits(sentences) {
  const credited = sentences.filter((entry) => entry.author && entry.id);
  els.resultsCredits.hidden = credited.length === 0;
  els.resultsCreditList.replaceChildren(...credited.map(creditItem));
}

export function showResults(summary, sentences = []) {
  paintRunCredits(sentences);

  const rows = [
    ['wpm', Math.round(summary.wpm)],
    ['accuracy', `${(summary.accuracy * 100).toFixed(1)}%`],
    ['clean', `${summary.cleanWords}/${summary.words}`],
    ['drills', summary.drilledWords.length],
    ['drill time', `${(summary.drillMs / 1000).toFixed(1)}s`],
  ];

  els.resultsGrid.replaceChildren(
    ...rows.map(([label, value]) => {
      const cell = els.doc.createElement('div');
      const dt = els.doc.createElement('dt');
      const dd = els.doc.createElement('dd');
      dt.textContent = label;
      dd.textContent = value;
      cell.append(dt, dd);
      return cell;
    }),
  );

  els.resultsTitle.textContent =
    summary.drilledWords.length === 0 ? 'clean run' : 'run complete';
  els.resultsDrilled.textContent =
    summary.drilledWords.length === 0
      ? ''
      : `drilled: ${[...new Set(summary.drilledWords)].join(', ')}`;
  els.results.hidden = false;
}

export function hideResults() {
  els.results.hidden = true;
}

export function paintProblems(entries) {
  els.problems.classList.toggle('is-empty', entries.length === 0);

  if (entries.length === 0) {
    const empty = els.doc.createElement('li');
    empty.textContent = 'nothing yet — miss a word and it lands here';
    els.problems.replaceChildren(empty);
    return;
  }

  els.problems.replaceChildren(
    ...entries.map((entry) => {
      const item = els.doc.createElement('li');
      const word = els.doc.createElement('span');
      const heat = els.doc.createElement('span');
      word.textContent = entry.word;
      heat.className = 'heat';
      heat.textContent = `${plural(entry.misses, 'miss', 'misses')}`;
      item.append(word, heat);
      return item;
    }),
  );
}

export function paintSlow(entries) {
  els.slow.classList.toggle('is-empty', entries.length === 0);

  if (entries.length === 0) {
    const empty = els.doc.createElement('li');
    empty.textContent = 'nothing timed yet — finish a run and the slow ones land here';
    els.slow.replaceChildren(empty);
    return;
  }

  els.slow.replaceChildren(
    ...entries.map((entry) => {
      const item = els.doc.createElement('li');
      const word = els.doc.createElement('span');
      const rate = els.doc.createElement('span');
      word.textContent = entry.word;
      rate.className = 'heat';
      rate.textContent = `${entry.wpm} wpm`;
      item.append(word, rate);
      return item;
    }),
  );
}

export function paintLifetime(stats) {
  els.lifetime.textContent =
    stats.runs === 0
      ? 'no runs recorded yet'
      : `${plural(stats.runs, 'run')} · ${stats.words} words · best ${Math.round(stats.bestWpm)} wpm · last 10 avg ${Math.round(stats.recentWpm)} wpm at ${(stats.recentAccuracy * 100).toFixed(1)}%`;
}

export function paintMessage(message) {
  const note = els.doc.createElement('span');
  note.className = 'stream-note';
  note.textContent = message;
  els.streamInner.replaceChildren(note);
  els.caret.hidden = true;
}

export function paintSettings(open) {
  els.play.hidden = open;
  els.settings.hidden = !open;
  els.page.classList.toggle('is-settings', open);
}

export function paintFocus(zen, quiet) {
  els.page.classList.toggle('is-zen', zen);
  els.page.classList.toggle('is-quiet', zen && quiet);
}

export function notice(message, bad = false) {
  els.notice.textContent = message;
  els.notice.classList.toggle('is-bad', bad);
}

function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}
