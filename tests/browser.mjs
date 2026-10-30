import { readFileSync, writeFileSync } from 'node:fs';
import { profileUrl, sentenceUrl } from '../js/attribution.js';
import { wordKey } from '../js/storage.js';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const CHROME =
  process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP = process.env.APP ?? 'http://127.0.0.1:8777/index.html';
const PORT = Number(process.env.CDP_PORT ?? 9333);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];
const spawned = [];

function check(label, fn) {
  try {
    fn();
    checks.push(`  pass  ${label}`);
  } catch (error) {
    checks.push(`  FAIL  ${label}\n        ${error.message.split('\n')[0]}`);
    process.exitCode = 1;
  }
}

async function launchChrome() {
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--mute-audio',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/tg-chrome-profile',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1200,1060',
    'about:blank',
  ]);
  spawned.push(chrome);
  chrome.stderr.on('data', () => {});

  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(200);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return { chrome, wsUrl: page.webSocketDebuggerUrl };
    } catch {
      continue;
    }
  }
  throw new Error('chrome never exposed a debugging target');
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const slot = pending.get(message.id);
    if (!slot) return;
    pending.delete(message.id);
    if (message.error) slot.reject(new Error(message.error.message));
    else slot.resolve(message.result);
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('cdp socket failed')), { once: true });
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return { ready, send, close: () => socket.close() };
}

function keyEvent(type, ch) {
  const code = ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}`;
  const vk = ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0);
  return {
    type,
    key: ch,
    code,
    text: type === 'keyDown' ? ch : undefined,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  };
}

async function run() {
  const { chrome, wsUrl } = await launchChrome();
  const cdp = connect(wsUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'eval failed');
    return result.value;
  };

  async function type(text, gapMs = 6) {
    for (const ch of text) {
      await cdp.send('Input.dispatchKeyEvent', keyEvent('keyDown', ch));
      await cdp.send('Input.dispatchKeyEvent', keyEvent('keyUp', ch));
      if (gapMs) await sleep(gapMs);
    }
  }

  async function open() {
    await cdp.send('Page.navigate', { url: APP });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await sleep(100);
      const ready = await evaluate(
        `document.readyState === 'complete' && document.querySelectorAll('.stream-inner .word').length > 0`,
      ).catch(() => false);
      if (ready) return;
    }
    throw new Error('app never rendered a word stream');
  }

  const probe = () =>
    evaluate(`(() => {
      const live = document.querySelector('.word.is-active, .word.is-drilling');
      const frame = document.getElementById('stream').getBoundingClientRect();
      const inside = (node) => {
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1;
      };
      const all = [...document.querySelectorAll('.stream-inner .word')];
      return {
        progress: document.getElementById('stat-progress').textContent,
        drills: document.getElementById('stat-drills').textContent,
        accuracy: document.getElementById('stat-accuracy').textContent,
        wpm: document.getElementById('stat-wpm').textContent,
        drillVisible: getComputedStyle(document.getElementById('drillbar')).visibility === 'visible',
        drillWord: (document.querySelector('.word.is-drilling')?.textContent ?? '').trim(),
        drillNote: document.getElementById('drill-note').textContent,
        filled: document.querySelectorAll('#pips li.is-filled').length,
        active: (live?.textContent ?? '').trim(),
        typed: live ? live.querySelectorAll('.ch.is-hit').length : 0,
        caretAtEnd: live ? live.querySelectorAll('.ch.is-caret-end').length === 1 : false,
        wordFull: live ? live.classList.contains('is-full') : false,
        spaceDot: live && live.classList.contains('is-drilling')
          ? getComputedStyle(live, '::before').content.replace(/"/g, '')
          : null,
        spaceDotColor: live && live.classList.contains('is-drilling')
          ? getComputedStyle(live, '::before').color
          : null,
        drilled: [...document.querySelectorAll('.word.is-drilled')].map(n => n.textContent.trim()),
        resultsVisible: getComputedStyle(document.getElementById('results')).display !== 'none',
        notice: document.getElementById('notice').textContent,
        problems: [...document.querySelectorAll('#problems li')].map(n => n.textContent.trim()),
        slow: [...document.querySelectorAll('#slow li')].map(n => n.textContent.trim()),
        lifetime: document.getElementById('lifetime').textContent,
        shift: document.getElementById('stream-inner').style.transform,
        activeVisible: inside(live),
        lastWordVisible: inside(all[all.length - 1]),
        layout: all.map(n => n.offsetLeft + ',' + n.offsetTop),
        caretVisible: !document.getElementById('caret').hidden,
        caretLeft: +(
          document.getElementById('caret').getBoundingClientRect().left - frame.left
        ).toFixed(2),
        zen: document.getElementById('zen').textContent,
        quiet: document.querySelector('.page').classList.contains('is-quiet'),
        readoutOpacity: Number(getComputedStyle(document.querySelector('.readout')).opacity),
        mastheadOpacity: Number(getComputedStyle(document.querySelector('.masthead')).opacity),
        creditLinkOpacity: Number(getComputedStyle(document.querySelector('.credit-link')).opacity),
        settingsOpen: !document.getElementById('settings').hidden,
        playVisible: !document.getElementById('play').hidden,
        streamOpacity: Number(getComputedStyle(document.getElementById('stream')).opacity),
        pips: document.querySelectorAll('#pips li').length,
        theme: document.documentElement.dataset.theme,
        themeChoice: document.querySelector('#themes button.is-active')?.dataset.theme ?? null,
        pageBg: getComputedStyle(document.body).backgroundColor,
        pageText: getComputedStyle(document.body).color,
        reps: document.querySelector('#reps button.is-active')?.dataset.reps ?? null,
        mode: document.querySelector('#modes button.is-active')?.dataset.mode ?? null,
        credits: document.getElementById('credits').textContent,
        penaltyLabel: document.getElementById('penalty-value').textContent,
        typeSize: parseFloat(getComputedStyle(document.getElementById('stream-inner')).fontSize),
        streamHeight: document.getElementById('stream').clientHeight,
        lineHeight: all[0] ? all[0].offsetHeight : 0,
        words: all.map(n => n.textContent.trim())
      };
    })()`);

  const shoot = async (path) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(data, 'base64'));
  };

  const wrongLetterFor = (ch) => (ch === 'q' ? 'z' : 'q');

  await open();
  await evaluate('localStorage.clear()');
  await open();

  const start = await probe();
  check('the page renders a full run of words', () => {
    assert.equal(start.words.length, 25);
    assert.equal(start.progress, '0/25');
    assert.equal(start.drillVisible, false);
    assert.equal(start.notice, '');
    assert.equal(start.resultsVisible, false);
  });
  check('the first word is active', () => assert.equal(start.active, start.words[0]));
  check('the cursor is not clipped at the left edge of the stream', () => {
    assert.equal(start.caretVisible, true);
    assert.ok(start.caretLeft >= 0, `cursor sat at ${start.caretLeft}px inside the stream`);
  });

  await type(start.words[0]);
  const wordFull = await probe();
  check('the end-of-word caret does not widen the word', () => {
    assert.deepEqual(wordFull.layout, start.layout);
    assert.equal(wordFull.typed, start.words[0].length);
  });

  await type(' ');
  const afterWord = await probe();
  check('a clean word advances the stream', () => {
    assert.equal(afterWord.progress, '1/25');
    assert.equal(afterWord.active, start.words[1]);
    assert.equal(afterWord.accuracy, '100.0%');
    assert.ok(Number(afterWord.wpm) > 0, `wpm was ${afterWord.wpm}`);
  });

  const target = start.words[1];
  await type(wrongLetterFor(target[0]));
  const afterTypo = await probe();
  check('a typo opens sudden death on that word', () => {
    assert.equal(afterTypo.drillVisible, true);
    assert.equal(afterTypo.drillWord, target);
    assert.equal(afterTypo.filled, 0);
    assert.equal(afterTypo.drills, '1');
    assert.equal(afterTypo.progress, '1/25');
    assert.match(afterTypo.drillNote, /5 to escape/);
  });
  check('the typo never lands in the buffer', () => assert.equal(afterTypo.typed, 0));
  check('accuracy drops on the typo', () =>
    assert.ok(parseFloat(afterTypo.accuracy) < 100, `accuracy was ${afterTypo.accuracy}`));

  await type(target[0], 0);
  const duringPenalty = await probe();
  check('keys are swallowed during the penalty window', () => {
    assert.equal(duringPenalty.filled, 0);
    assert.equal(duringPenalty.typed, 0);
  });

  await sleep(400);
  await type(target);
  const atEnd = await probe();
  check('a finished rep parks the cursor at the end of the word', () => {
    assert.equal(atEnd.drillVisible, true);
    assert.equal(atEnd.filled, 0);
    assert.equal(atEnd.typed, target.length);
    assert.equal(atEnd.caretAtEnd, true);
    assert.match(atEnd.drillNote, /space to bank rep 1 of 5/);
  });

  check('a dot marks the space you owe at the end of a drilled word', () => {
    assert.equal(afterTypo.spaceDot, '\u00b7');
    assert.equal(atEnd.spaceDot, '\u00b7');
    assert.equal(afterTypo.wordFull, false);
    assert.equal(atEnd.wordFull, true);
    assert.notEqual(
      atEnd.spaceDotColor,
      afterTypo.spaceDotColor,
      'the dot never lit up when the word was complete',
    );
  });

  await shoot('/tmp/tg-at-end.png');

  await type(' ');
  const afterRep = await probe();
  check('a clean rep fills one pip and resets the cursor', () => {
    assert.equal(afterRep.filled, 1);
    assert.equal(afterRep.drillVisible, true);
    assert.match(afterRep.drillNote, /4 to escape/);
  });

  await type(`${target[0]}${wrongLetterFor(target[1])}`);
  const afterSlip = await probe();
  check('a slip inside sudden death resets the streak to zero', () => {
    assert.equal(afterSlip.filled, 0);
    assert.match(afterSlip.drillNote, /2 slips/);
  });

  await shoot('/tmp/tg-drill.png');

  const chargeState = () => evaluate(`(() => {
    const word = document.querySelector('.word.is-drilling');
    const inner = document.getElementById('stream-inner');
    if (!word) return null;
    const sheet = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const toRgb = (value) => {
      sheet.clearRect(0, 0, 1, 1);
      sheet.fillStyle = value;
      sheet.fillRect(0, 0, 1, 1);
      return [...sheet.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const other = [...document.querySelectorAll('.stream-inner .word')]
      .find((n) => !n.classList.contains('is-drilling'));
    return {
      rest: other ? Number(getComputedStyle(other).opacity) : null,
      drillVisible: getComputedStyle(document.getElementById('drillbar')).visibility === 'visible',
      pips: document.querySelectorAll('#pips li').length,
      filled: document.querySelectorAll('#pips li.is-filled').length,
      charge: Number(getComputedStyle(inner).getPropertyValue('--charge')),
      color: getComputedStyle(word).color,
      rgb: toRgb(getComputedStyle(word).color),
      glow: getComputedStyle(word).textShadow,
      bar: getComputedStyle(word, '::after').backgroundImage
    };
  })()`);

  await sleep(400);
  const charge0 = await chargeState();

  for (let n = 0; n < 2; n += 1) await type(`${target} `);
  await sleep(400);
  const charge2 = await chargeState();

  for (let n = 0; n < 2; n += 1) await type(`${target} `);
  await sleep(400);
  const charge4 = await chargeState();
  await shoot('/tmp/tg-charged.png');

  check('the drilled word charges toward green with every rep', () => {
    assert.equal(charge0.charge, 0);
    assert.ok(Math.abs(charge2.charge - 0.4) < 0.001, `charge was ${charge2.charge}`);
    assert.ok(Math.abs(charge4.charge - 0.8) < 0.001, `charge was ${charge4.charge}`);
    const green = [charge0.rgb[1], charge2.rgb[1], charge4.rgb[1]];
    assert.ok(
      green[1] > green[0] + 10 && green[2] > green[1] + 10,
      `green ran ${green.join(' -> ')}`,
    );
  });

  check('the stream stays dimmed while more than one rep is owed', () => {
    assert.ok(charge0.rest < 0.5, `background sat at ${charge0.rest} on rep 1 of 5`);
    assert.ok(charge2.rest < 0.5, `background sat at ${charge2.rest} on rep 3 of 5`);
  });

  check('the stream comes back for the last rep so you can read ahead', () => {
    assert.equal(charge4.rest, 1, `background sat at ${charge4.rest} on the last rep`);
  });

  check('the counter and pips stay up on the last rep', () => {
    assert.equal(charge4.drillVisible, true);
    assert.equal(charge4.pips, 5);
    assert.equal(charge4.filled, 4);
  });

  check('the glow grows with the streak', () =>
    assert.notEqual(charge4.glow, charge0.glow));

  await type(`${target} `);
  const afterDrill = await probe();
  check('five clean reps release you back to the stream', () => {
    assert.equal(afterDrill.drillVisible, false);
    assert.equal(afterDrill.progress, '2/25');
    assert.equal(afterDrill.active, start.words[2]);
    assert.deepEqual(afterDrill.drilled, [target]);
  });

  for (let i = 2; i < 14; i += 1) await type(`${start.words[i]} `, 3);
  const midRun = await probe();

  for (let i = 14; i < 24; i += 1) await type(`${start.words[i]} `, 3);
  const lateRun = await probe();

  check('words never move while you type', () => {
    assert.deepEqual(afterWord.layout, start.layout);
    assert.deepEqual(afterTypo.layout, start.layout);
    assert.deepEqual(afterRep.layout, start.layout);
    assert.deepEqual(afterSlip.layout, start.layout);
    assert.deepEqual(midRun.layout, start.layout);
    assert.deepEqual(lateRun.layout, start.layout);
  });

  check('sudden death runs in the stream, not on its own screen', () => {
    assert.equal(afterTypo.drillWord, target);
    assert.equal(afterTypo.activeVisible, true);
    assert.equal(afterRep.drillWord, target);
  });

  check('the cursor stays inside the visible window for the whole run', () => {
    assert.equal(start.activeVisible, true);
    assert.equal(midRun.activeVisible, true);
    assert.equal(lateRun.activeVisible, true);
  });
  await type(start.words[24], 3);
  await sleep(250);
  const finished = await probe();
  check('finishing the run shows the summary and banks progress', () => {
    assert.equal(finished.resultsVisible, true);
    assert.equal(finished.caretVisible, false);
    assert.equal(finished.drillVisible, false);
    assert.equal(finished.lastWordVisible, true);
    assert.equal(finished.progress, '25/25');
    assert.ok(
      finished.problems.some((entry) => entry.startsWith(target)),
      `problem list was ${JSON.stringify(finished.problems)}`,
    );
    assert.match(finished.lifetime, /1 run/);
  });

  const stored = await evaluate(`(() => ({
    title: document.getElementById('results-title').textContent,
    grid: [...document.querySelectorAll('#results-grid div')].map(n => n.textContent),
    drilled: document.getElementById('results-drilled').textContent,
    saved: JSON.parse(localStorage.getItem('typing-game/profile/v1'))
  }))()`);
  check('the run is written to local storage', () => {
    const key = wordKey(target);
    assert.equal(stored.saved.runs.length, 1);
    assert.equal(stored.saved.runs[0].words, 25);
    assert.equal(stored.saved.runs[0].drilledWords[0], key);
    assert.ok(stored.saved.words[key].heat > 0, `no heat recorded under "${key}"`);
  });

  await shoot('/tmp/tg-finished.png');

  await open();
  const reseeded = await probe();
  check('a problem word is seeded into the next run', () =>
    assert.ok(
      reseeded.words.includes(target),
      `${target} missing from ${JSON.stringify(reseeded.words)}`,
    ));

  const cursorGeometry = () => evaluate(`(() => {
    const inner = document.getElementById('stream-inner');
    const live = document.querySelector('.word.is-active');
    if (!live) return null;
    const frame = document.getElementById('stream').getBoundingClientRect();
    const box = live.getBoundingClientRect();
    const bar = document.getElementById('caret').getBoundingClientRect();
    return {
      caretTop: +(bar.top - frame.top).toFixed(2),
      caretLeft: +(bar.left - frame.left).toFixed(2),
      row: Math.round((live.offsetTop - inner.firstElementChild.offsetTop) / live.offsetHeight),
      shift: Number((inner.style.transform.match(/-?([0-9.]+)px/) ?? [0, 0])[1]),
      visible: box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1
    };
  })()`);

  await open();
  await evaluate(`document.querySelector('#lengths button[data-length="50"]').click()`);
  const longRun = await evaluate(
    `[...document.querySelectorAll('.stream-inner .word')].map(n => n.textContent.trim())`,
  );

  let scrolled = null;
  const offscreen = [];
  for (let i = 0; i < longRun.length && !scrolled; i += 1) {
    await type(`${longRun[i]} `, 2);
    const geometry = await cursorGeometry();
    if (!geometry) break;
    if (!geometry.visible) offscreen.push(i);
    if (geometry.row >= 2) scrolled = geometry;
  }

  check('a 50 word run wraps past the third row', () =>
    assert.ok(scrolled, 'the cursor never reached a third row'));
  check('the stream scrolls to keep the cursor on the middle line', () => {
    assert.ok(scrolled.shift > 0, `transform stayed at ${scrolled?.shift}px`);
    assert.equal(scrolled.visible, true);
  });
  check('the cursor is never off screen on a long run', () =>
    assert.deepEqual(offscreen, []));

  const settled = await (async () => {
    await sleep(320);
    return cursorGeometry();
  })();

  check('the cursor does not lag the scroll animation', () => {
    assert.equal(scrolled.caretTop, settled.caretTop);
    assert.equal(scrolled.caretLeft, settled.caretLeft);
  });

  await shoot('/tmp/tg-scrolled.png');

  await open();
  const caretRun = await evaluate(
    `[...document.querySelectorAll('.stream-inner .word')].map(n => n.textContent.trim())`,
  );

  const caretBox = () => evaluate(`(() => {
    const bar = document.getElementById('caret');
    if (bar.hidden) return null;
    const box = bar.getBoundingClientRect();
    return { left: box.left, width: box.width, height: box.height, dpr: devicePixelRatio };
  })()`);

  const caretStops = [];
  let caretWord = null;
  for (const word of caretRun) {
    if (word.length >= 5 && /^[a-z]+$/.test(word)) {
      caretWord = word;
      break;
    }
    await type(`${word} `, 2);
  }

  caretStops.push(await caretBox());
  for (const letter of caretWord) {
    await type(letter, 2);
    caretStops.push(await caretBox());
  }

  check('the cursor keeps one width at every position in a word', () => {
    assert.equal(caretStops.length, caretWord.length + 1);
    const widths = new Set(caretStops.map((stop) => stop.width));
    const heights = new Set(caretStops.map((stop) => stop.height));
    assert.equal(widths.size, 1, `cursor widths were ${[...widths].join(', ')}`);
    assert.equal(heights.size, 1, `cursor heights were ${[...heights].join(', ')}`);
  });

  check('the cursor lands on whole device pixels', () => {
    for (const [i, stop] of caretStops.entries()) {
      const device = stop.left * stop.dpr;
      assert.ok(
        Math.abs(device - Math.round(device)) < 0.01,
        `position ${i} sat at device pixel ${device}`,
      );
      const edge = (stop.left + stop.width) * stop.dpr;
      assert.ok(
        Math.abs(edge - Math.round(edge)) < 0.01,
        `position ${i} ended at device pixel ${edge}`,
      );
    }
  });

  check('the cursor advances by one character each keystroke', () => {
    const steps = caretStops.slice(1).map((stop, i) => stop.left - caretStops[i].left);
    assert.ok(
      steps.every((step) => Math.abs(step - steps[0]) <= 1),
      `cursor steps were ${steps.join(', ')}`,
    );
  });

  await open();
  const slipRun = await evaluate(
    `[...document.querySelectorAll('.stream-inner .word')].map(n => n.textContent.trim())`,
  );

  let slipWord = null;
  for (const word of slipRun) {
    if (word.length >= 4 && /^[a-z]+$/.test(word)) {
      slipWord = word;
      break;
    }
    await type(`${word} `, 2);
  }

  await type(slipWord.slice(0, 2), 2);
  await type(wrongLetterFor(slipWord[2]));

  const block = await evaluate(`(() => {
    const mark = document.querySelector('.stream .slip');
    if (!mark) return null;
    const word = document.querySelector('.word.is-drilling');
    const frame = document.getElementById('stream').getBoundingClientRect();
    const inner = document.getElementById('stream-inner');
    const anchor = inner.firstElementChild.getBoundingClientRect();
    return {
      text: mark.textContent,
      index: Number(mark.dataset.index),
      left: parseFloat(mark.style.left),
      width: parseFloat(mark.style.width),
      charLefts: [...word.querySelectorAll('.ch')].map(
        (c) => inner.offsetLeft + (c.getBoundingClientRect().left - anchor.left),
      )
    };
  })()`);
  await shoot('/tmp/tg-slip.png');
  if (process.env.DEBUG) {
    console.log('slipWord', JSON.stringify(slipWord), 'block', JSON.stringify(block));
    console.log('drilling', await evaluate(`(document.querySelector('.word.is-drilling')?.textContent ?? '').trim()`));
  }

  check('the missed letter is marked where you missed it', () => {
    assert.ok(block, 'no slip block was drawn');
    assert.equal(block.text, wrongLetterFor(slipWord[2]));
    assert.equal(block.index, 2);
    assert.ok(
      Math.abs(block.left - block.charLefts[2]) < 1.5,
      `block sat at ${block.left}, letter 3 sits at ${block.charLefts[2]}`,
    );
    assert.ok(block.width > 4, `block was only ${block.width}px wide`);
  });

  await sleep(500);
  const cleared = await evaluate(`document.querySelectorAll('.stream .slip').length`);
  check('the slip block clears itself once it reaches the cursor', () =>
    assert.equal(cleared, 0));

  await open();
  const missRun = await evaluate(
    `[...document.querySelectorAll('.stream-inner .word')].map(n => n.textContent.trim())`,
  );

  let missWord = null;
  for (const word of missRun) {
    if (word.length >= 5 && /^[a-z]+$/.test(word)) {
      missWord = word;
      break;
    }
    await type(`${word} `, 2);
  }

  const missMap = () => evaluate(`(() => {
    const word = document.querySelector('.word.is-drilling');
    if (!word) return null;
    const letters = [...word.querySelectorAll('.ch')];
    const dot = getComputedStyle(word, '::before');
    return {
      marks: letters.map((c) => ({
        miss: getComputedStyle(c, '::after').content.replace(/"/g, ''),
        opacity: Number(getComputedStyle(c, '::after').opacity)
      })),
      dotColor: dot.color,
      aboveLetters: getComputedStyle(letters[0], '::before').content,
      bands: (() => {
        const wordBox = word.getBoundingClientRect();
        const ch = letters[2];
        const chBox = ch.getBoundingClientRect();
        const mark = getComputedStyle(ch, '::after');
        return {
          markDrop: parseFloat(mark.top),
          glyphHeight: chBox.height,
          wordTop: wordBox.top
        };
      })(),
      letterColor: getComputedStyle(letters[letters.length - 1]).color,
      layout: [...document.querySelectorAll('.stream-inner .word')].map(
        (n) => n.offsetLeft + ',' + n.offsetTop
      )
    };
  })()`);

  const cleanLayout = await evaluate(
    `[...document.querySelectorAll('.stream-inner .word')].map(n => n.offsetLeft + ',' + n.offsetTop)`,
  );

  const slipKey = wrongLetterFor(missWord[2]);
  await type(missWord.slice(0, 2), 2);
  await type(slipKey);
  const oneMiss = await missMap();

  check('the letter you got wrong shows under the letter you missed', () => {
    assert.equal(oneMiss.marks[2].miss, slipKey);
    assert.ok(oneMiss.marks[2].opacity > 0.4, `mark sat at ${oneMiss.marks[2].opacity}`);
    for (const [i, mark] of oneMiss.marks.entries()) {
      if (i === 2) continue;
      assert.equal(mark.opacity, 0, `letter ${i} showed a mark it never earned`);
    }
  });

  check('the space dot matches the colour of the word being drilled', () =>
    assert.equal(oneMiss.dotColor, oneMiss.letterColor));

  check('the mistake marks sit clear of the letters', () => {
    const b = oneMiss.bands;
    assert.ok(
      b.markDrop >= b.glyphHeight,
      `mark sat ${b.markDrop} down from a ${b.glyphHeight} tall letter`,
    );
  });

  check('nothing is drawn above the letters any more', () =>
    assert.equal(oneMiss.aboveLetters, 'none'));

  check('the mistake map costs no layout', () =>
    assert.deepEqual(oneMiss.layout, cleanLayout));

  await sleep(400);
  await type(missWord.slice(0, 2), 2);
  await type(slipKey);
  const twoMisses = await missMap();

  check('a repeated miss at the same letter shows more strongly', () =>
    assert.ok(
      twoMisses.marks[2].opacity > oneMiss.marks[2].opacity,
      `${oneMiss.marks[2].opacity} then ${twoMisses.marks[2].opacity}`,
    ));

  await sleep(400);
  await type(`${missWord} `, 2);
  await type(`${missWord} `, 2);
  const cooled = await missMap();

  check('the mark fades as you get the word right', () => {
    assert.ok(
      cooled.marks[2].opacity < twoMisses.marks[2].opacity,
      `${twoMisses.marks[2].opacity} then ${cooled.marks[2].opacity}`,
    );
    assert.equal(cooled.marks[2].miss, slipKey);
  });

  await open();
  await evaluate(`document.querySelector('#reps button[data-reps="10"]').click()`);
  await sleep(150);
  const coachRun = await probe();

  let coachWord = null;
  for (const word of coachRun.words) {
    if (word.length >= 6 && /^[a-z]+$/.test(word) && new Set(word).size === word.length) {
      coachWord = word;
      break;
    }
    await type(`${word} `, 2);
  }

  const coaching = () => evaluate(`(() => {
    const word = document.querySelector('.word.is-drilling');
    if (!word) return null;
    return {
      note: document.getElementById('drill-note').textContent,
      barKind: document.getElementById('drillbar').dataset.kind,
      chars: [...word.querySelectorAll('.ch')].map((c) => ({
        kind: c.dataset.kind ?? null,
        zone: c.classList.contains('is-zone'),
        markColor: getComputedStyle(c, '::after').color
      }))
    };
  })()`);

  await type(coachWord.slice(0, 2), 2);
  await type(coachWord[3]);
  const raced = await coaching();

  check('typing a later letter early is called a race', () => {
    assert.equal(raced.chars[2].kind, 'race');
    assert.equal(raced.barKind, 'race');
    assert.match(raced.note, /ran ahead/);
  });

  check('a race raises caution tape across the pair that lost', () => {
    assert.deepEqual(
      raced.chars.map((c) => c.zone),
      raced.chars.map((_, i) => i >= 1 && i <= 3),
      'the zone did not span exactly one letter either side of the race',
    );
  });

  await sleep(400);
  await type(coachWord.slice(0, 4), 2);
  await type(coachWord[3]);
  const bounced = await coaching();

  check('restriking the previous letter is called a bounce', () => {
    assert.equal(bounced.chars[4].kind, 'bounce');
    assert.equal(bounced.barKind, 'bounce');
    assert.match(bounced.note, /bounced/);
  });

  check('each class of mistake gets its own colour', () => {
    const race = bounced.chars[2].markColor;
    const bounce = bounced.chars[4].markColor;
    const quiet = bounced.chars[5].markColor;
    assert.notEqual(race, bounce, 'race and bounce marks share a colour');
    assert.notEqual(race, quiet);
    assert.notEqual(bounce, quiet);
  });

  check('a bounce raises no caution tape', () => assert.equal(bounced.chars[4].zone, false));

  const tape = await evaluate(`(() => {
    const word = document.querySelector('.word.is-drilling');
    const tapes = [...word.querySelectorAll('.tape')];
    return {
      count: tapes.length,
      spans: tapes.map((t) => ({
        from: Number(t.style.getPropertyValue('--from')),
        span: Number(t.style.getPropertyValue('--span')),
        width: t.getBoundingClientRect().width
      })),
      advance: word.querySelector('.ch').getBoundingClientRect().width,
      striped: [...word.querySelectorAll('.ch')].map(
        (c) => getComputedStyle(c).backgroundImage
      )
    };
  })()`);

  check('a zone is one element, so its stripes cannot misalign', () => {
    assert.equal(tape.count, 1, `drew ${tape.count} tape elements for one zone`);
    assert.equal(tape.spans[0].from, 1);
    assert.equal(tape.spans[0].span, 3);
    assert.ok(
      Math.abs(tape.spans[0].width - 3 * tape.advance) < 1,
      `tape was ${tape.spans[0].width}px across three ${tape.advance}px letters`,
    );
  });

  check('no stripes are painted on the characters themselves', () =>
    assert.ok(
      tape.striped.every((image) => image === 'none'),
      'a character carried its own background, which is what used to break alignment',
    ));

  const stripes = await (async () => {
    await evaluate(`(() => {
      const style = document.createElement('style');
      style.id = 'bare-tape';
      style.textContent =
        '.word .ch { color: transparent !important; }' +
        '.word .ch::after { opacity: 0 !important; }' +
        '.word.is-drilling::before { color: transparent !important; }' +
        '.caret { display: none !important; }';
      document.head.append(style);
    })()`);
    await sleep(140);

    const box = await evaluate(`(() => {
      const t = document.querySelector('.word.is-drilling .tape').getBoundingClientRect();
      return { x: t.left, y: t.top, width: t.width, height: t.height };
    })()`);
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: {
        x: Math.round(box.x),
        y: Math.round(box.y + box.height / 2) - 1,
        width: Math.round(box.width),
        height: 3,
        scale: 1,
      },
    });

    const scan = await evaluate(`(async () => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,${data}'; });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const row = ctx.getImageData(0, Math.floor(img.height / 2), img.width, 1).data;
      const lum = [];
      for (let x = 0; x < img.width; x += 1) {
        lum.push(0.2126 * row[x*4] + 0.7152 * row[x*4+1] + 0.0722 * row[x*4+2]);
      }
      const mid = (Math.min(...lum) + Math.max(...lum)) / 2;
      const rising = [];
      for (let x = 1; x < lum.length; x += 1) {
        if (lum[x-1] <= mid && lum[x] > mid) rising.push(x);
      }
      return rising;
    })()`);

    await evaluate(`document.getElementById('bare-tape').remove()`);
    return scan;
  })();

  check('the stripe period belongs to the pattern, not the character grid', () => {
    assert.ok(stripes.length >= 3, `found only ${stripes.length} stripe edges to measure`);
    const gaps = stripes.slice(1).map((x, i) => x - stripes[i]);
    assert.ok(
      Math.max(...gaps) - Math.min(...gaps) <= 2,
      `stripe spacing jumped around: ${gaps.join(', ')}`,
    );
    const period = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    assert.ok(
      period > 9 && period < 14,
      `stripe period was ${period.toFixed(1)}px, expected about 11.3px`,
    );
    assert.ok(
      Math.abs(period - tape.advance) > 3,
      `stripe period ${period.toFixed(1)}px matches the ${tape.advance.toFixed(1)}px character width, so the pattern is restarting per character`,
    );
  });

  await evaluate(`document.querySelector('#reps button[data-reps="5"]').click()`);

  await open();
  await evaluate(`document.getElementById('settings-open').click()`);
  await evaluate(`document.querySelector('#modes button[data-mode="sentences"]').click()`);
  await evaluate(`document.querySelector('#reps button[data-reps="3"]').click()`);
  await evaluate(`document.querySelector('#lengths button[data-length="25"]').click()`);
  await evaluate(`document.getElementById('settings-close').click()`);
  await sleep(600);

  const dotRun = await probe();
  const dotAt = dotRun.words.findIndex((token) => /[a-z]\.$/.test(token));

  for (let i = 0; i < dotAt; i += 1) await type(`${dotRun.words[i]} `, 2);
  const dotToken = dotRun.words[dotAt];
  await type(dotToken.slice(0, -1), 2);
  await type('x');
  await sleep(400);

  const drilled = await probe();
  check('a word ending a sentence drills with its period', () =>
    assert.equal(drilled.drillWord, dotToken));

  for (let n = 0; n < 3; n += 1) {
    await type(`${dotToken} `, 2);
    await sleep(60);
  }
  for (let i = dotAt + 1; i < dotRun.words.length - 1; i += 1) {
    await type(`${dotRun.words[i]} `, 2);
  }
  await type(dotRun.words.at(-1), 2);
  await sleep(400);

  const banked = await probe();
  const savedKeys = await evaluate(
    `Object.keys(JSON.parse(localStorage.getItem('typing-game/profile/v1')).words)`,
  );

  check('the problem word loses its period', () => {
    const bare = dotToken.slice(0, -1);
    const named = new RegExp(`^${bare}\\d`);
    assert.ok(
      banked.problems.some((chip) => named.test(chip)),
      `expected "${bare}" in ${JSON.stringify(banked.problems)}`,
    );
    assert.ok(
      !banked.problems.some((chip) => chip.startsWith(dotToken)),
      `"${dotToken}" was listed with its period: ${JSON.stringify(banked.problems)}`,
    );
  });

  check('nothing is written to storage with a trailing period', () =>
    assert.ok(
      savedKeys.every((word) => !word.endsWith('.')),
      `stored keys: ${savedKeys.filter((w) => w.endsWith('.')).join(', ')}`,
    ));

  await open();
  await evaluate(`document.getElementById('settings-open').click()`);
  await evaluate(`document.querySelector('#modes button[data-mode="words"]').click()`);
  await evaluate(`document.querySelector('#reps button[data-reps="5"]').click()`);
  await evaluate(`document.getElementById('settings-close').click()`);
  await sleep(150);

  await open();
  await evaluate(`localStorage.clear()`);
  await open();

  const paceRun = await probe();
  check('the slow list is empty before anything is timed', () =>
    assert.ok(paceRun.slow[0].includes('nothing timed yet'), paceRun.slow.join(' | ')));

  for (let i = 0; i < paceRun.words.length - 1; i += 1) {
    const word = paceRun.words[i];
    await type(word, i === 0 ? 70 : 2);
    await type(' ', 2);
  }
  await type(paceRun.words.at(-1), 2);
  await sleep(400);

  const timed = await probe();
  const paces = await evaluate(`(() => {
    const saved = JSON.parse(localStorage.getItem('typing-game/profile/v1'));
    return Object.fromEntries(Object.entries(saved.words).map(([w, s]) => [w, s.pace]));
  })()`);

  check('every clean word is timed', () => {
    const values = Object.values(paces);
    assert.ok(values.length >= 20, `only ${values.length} words recorded`);
    assert.ok(values.every((pace) => typeof pace === 'number' && pace > 0), JSON.stringify(paces));
  });

  check('the word typed slowly shows up in the slow list', () => {
    const slowest = paceRun.words[0];
    assert.ok(
      timed.slow.some((chip) => chip.startsWith(slowest)),
      `expected "${slowest}" in ${JSON.stringify(timed.slow)}`,
    );
  });

  check('the slow list reports a speed', () =>
    assert.ok(timed.slow.every((chip) => /\d+ wpm$/.test(chip)), JSON.stringify(timed.slow)));

  await open();
  const seeded = await probe();
  check('a slow word is seeded into the next run', () => {
    const slowest = paceRun.words[0];
    assert.ok(seeded.words.includes(slowest), `${slowest} was not brought back`);
  });

  const creditsUrl = new URL('credits.html', APP).href;
  const shippedCount = JSON.parse(
    readFileSync(new URL('../data/english-sentences.json', import.meta.url)),
  ).sentences.length;

  await open();
  await sleep(150);
  const playLink = await evaluate(`(() => {
    const link = document.querySelector('.credit-link a');
    const box = link.getBoundingClientRect();
    return {
      href: link.getAttribute('href'),
      text: link.textContent,
      shown: box.width > 0 && box.height > 0 && getComputedStyle(link).visibility === 'visible'
    };
  })()`);

  check('the play screen links to the credits', () => {
    assert.equal(playLink.href, 'credits.html');
    assert.match(playLink.text, /credits/);
    assert.equal(playLink.shown, true);
  });

  await evaluate(`document.getElementById('settings-open').click()`);
  const settingsCredit = await evaluate(`(() => {
    const block = document.getElementById('credits');
    const box = block.getBoundingClientRect();
    return {
      text: block.textContent,
      link: block.querySelector('a')?.getAttribute('href') ?? null,
      shown: box.width > 0 && box.height > 0
    };
  })()`);
  await evaluate(`document.getElementById('settings-close').click()`);

  check('settings names both sources and the licence and links the full credits', () => {
    assert.equal(settingsCredit.shown, true);
    assert.match(settingsCredit.text, /Tatoeba/);
    assert.match(settingsCredit.text, /CC BY 2\.0 FR/);
    assert.match(settingsCredit.text, /Kevin Atkinson/);
    assert.equal(settingsCredit.link, 'credits.html');
  });

  const readCredits = () => evaluate(`(() => {
    const items = [...document.querySelectorAll('.author-list li')];
    return {
      title: document.title,
      heading: document.querySelector('h1')?.textContent ?? '',
      back: document.querySelector('a[href="index.html"]')?.textContent ?? '',
      theme: document.documentElement.dataset.theme,
      authors: items.length,
      sentences: items.reduce((sum, li) => sum + Number(li.querySelector('.count').textContent), 0),
      allOnTatoeba: items.every((li) =>
        li.querySelector('a').href.startsWith('https://tatoeba.org/en/user/profile/')),
      text: document.body.textContent,
      background: getComputedStyle(document.body).backgroundColor
    };
  })()`);

  await cdp.send('Page.navigate', { url: creditsUrl });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(150);
    const loaded = await evaluate(`document.querySelectorAll('.author-list li').length`).catch(() => 0);
    if (loaded > 0) break;
  }
  const creditsPageState = await readCredits();

  check('the credits page loads and lists the authors with how many sentences each wrote', () => {
    assert.match(creditsPageState.heading, /credits and licences/);
    assert.ok(creditsPageState.authors > 1000, `only ${creditsPageState.authors} authors`);
    assert.equal(creditsPageState.sentences, shippedCount);
    assert.equal(creditsPageState.allOnTatoeba, true);
    assert.match(creditsPageState.back, /back to the game/);
  });

  check('the credits page carries the dictionary notice and the sentence licence', () => {
    assert.match(creditsPageState.text, /Copyright 2000-2026 by Kevin Atkinson/);
    assert.match(creditsPageState.text, /hereby granted without fee/);
    assert.match(creditsPageState.text, /Creative Commons Attribution 2\.0 France/);
    assert.match(creditsPageState.text, /Colemak Mod-DH/);
  });

  await evaluate(`(() => {
    const saved = JSON.parse(localStorage.getItem('typing-game/prefs/v1') ?? '{}');
    localStorage.setItem('typing-game/prefs/v1', JSON.stringify({ ...saved, theme: 'light' }));
    return true;
  })()`);
  await cdp.send('Page.navigate', { url: creditsUrl });
  await sleep(600);
  const lightCredits = await readCredits();

  check('the credits page follows the theme you chose, with no dark flash', () => {
    assert.equal(lightCredits.theme, 'light');
    const [r, g, b] = lightCredits.background.match(/\d+/g).map(Number);
    assert.ok(0.2126 * r + 0.7152 * g + 0.0722 * b > 200, `background was ${lightCredits.background}`);
  });

  await evaluate(`(() => {
    const saved = JSON.parse(localStorage.getItem('typing-game/prefs/v1') ?? '{}');
    localStorage.setItem('typing-game/prefs/v1', JSON.stringify({ ...saved, theme: 'system' }));
    return true;
  })()`);
  await shoot('/tmp/tg-credits.png');

  await evaluate(`document.querySelector('a[href="index.html"]').click()`);
  await sleep(600);
  const backInGame = await evaluate(`document.querySelectorAll('.stream-inner .word').length`);
  check('the way back from the credits lands in the game', () =>
    assert.ok(backInGame > 0, 'the game did not load after following the link back'));
  await open();

  const creditRows = JSON.parse(
    readFileSync(new URL('../data/english-sentences.json', import.meta.url)),
  ).sentences;
  const creditByText = new Map(creditRows.map(([text, , id, author]) => [text, { id, author }]));

  const chooseSetting = async (selector) => {
    await evaluate(`document.getElementById('settings-open').click()`);
    await evaluate(`document.querySelector('${selector}').click()`);
    await evaluate(`document.getElementById('settings-close').click()`);
    await sleep(120);
  };

  await chooseSetting('#modes button[data-mode="sentences"]');
  await chooseSetting('#lengths button[data-length="10"]');
  await open();
  const toType = await probe();
  await type(toType.words.join(' '), 3);
  await sleep(500);

  const runCredit = await evaluate(`(() => {
    const block = document.getElementById('results-credits');
    const box = block.getBoundingClientRect();
    return {
      resultsShown: getComputedStyle(document.getElementById('results')).display !== 'none',
      creditsShown: box.width > 0 && box.height > 0,
      items: [...document.querySelectorAll('#results-credit-list li')].map((li) => ({
        text: li.querySelector('span:not(.by)').textContent,
        author: li.querySelector('.by a').textContent,
        authorHref: li.querySelector('.by a').href,
        sourceHref: li.querySelector('a.source').href,
        sourceText: li.querySelector('a.source').textContent,
        target: li.querySelector('a.source').target,
        rel: li.querySelector('a.source').rel
      }))
    };
  })()`);
  await shoot('/tmp/tg-run-credits.png');

  check('a finished sentence run credits the sentences it used', () => {
    assert.equal(runCredit.resultsShown, true, 'the run did not finish');
    assert.equal(runCredit.creditsShown, true);
    assert.ok(runCredit.items.length >= 1, 'no sentence was credited');
  });

  check('each credit names the author and links the original from the shipped data', () => {
    for (const item of runCredit.items) {
      const shipped = creditByText.get(item.text);
      assert.ok(shipped, `${item.text} is not in the data`);
      assert.equal(item.author, shipped.author);
      assert.equal(item.authorHref, profileUrl(shipped.author));
      assert.equal(item.sourceHref, sentenceUrl(shipped.id));
      assert.equal(item.sourceText, `#${shipped.id}`);
    }
  });

  check('the credited sentences are exactly the ones typed, in order', () =>
    assert.equal(runCredit.items.map((item) => item.text).join(' '), toType.words.join(' ')));

  check('credit links open in a new tab so the game is not lost', () => {
    for (const item of runCredit.items) {
      assert.equal(item.target, '_blank');
      assert.match(item.rel, /noopener/);
    }
  });

  await chooseSetting('#modes button[data-mode="words"]');
  await open();
  const wordsToType = await probe();
  await type(wordsToType.words.join(' '), 3);
  await sleep(500);
  const wordCredit = await evaluate(`(() => {
    const block = document.getElementById('results-credits');
    const box = block.getBoundingClientRect();
    return {
      resultsShown: getComputedStyle(document.getElementById('results')).display !== 'none',
      creditsShown: box.width > 0 && box.height > 0,
      items: document.querySelectorAll('#results-credit-list li').length
    };
  })()`);

  check('word mode has no sentences to credit, so the block stays away', () => {
    assert.equal(wordCredit.resultsShown, true, 'the word run did not finish');
    assert.equal(wordCredit.creditsShown, false);
    assert.equal(wordCredit.items, 0);
  });

  await chooseSetting('#lengths button[data-length="25"]');
  await open();

  const sentenceRows = JSON.parse(
    readFileSync(new URL('../data/english-sentences.json', import.meta.url)),
  ).sentences;
  const rarityByText = new Map(sentenceRows.map(([text, rarity]) => [text, rarity]));

  const sentencesOf = (tokens) => {
    const found = [];
    let at = 0;
    while (at < tokens.length) {
      let matched = 0;
      for (let span = 1; span <= Math.min(tokens.length - at, 240); span += 1) {
        if (rarityByText.has(tokens.slice(at, at + span).join(' '))) matched = span;
      }
      assert.ok(matched > 0, `a fragment of a sentence appeared at "${tokens[at]}"`);
      const text = tokens.slice(at, at + matched).join(' ');
      found.push({ text, rarity: rarityByText.get(text), words: matched });
      at += matched;
    }
    return found;
  };

  const choice = (groupId) => evaluate(`(() => {
    const group = document.getElementById('${groupId}');
    return {
      active: group.querySelector('button.is-active')?.textContent ?? null,
      shown: getComputedStyle(group.closest('.setting')).display !== 'none'
    };
  })()`);

  const toggle = (id) => evaluate(`(() => {
    const button = document.getElementById('${id}');
    return {
      text: button.textContent,
      pressed: button.getAttribute('aria-pressed'),
      shown: getComputedStyle(button.closest('.setting')).display !== 'none'
    };
  })()`);

  const flip = (id, wanted) => evaluate(`(() => {
    const button = document.getElementById('${id}');
    if ((button.getAttribute('aria-pressed') === 'true') !== ${wanted}) button.click();
    return true;
  })()`);

  const withSettings = async (work) => {
    await evaluate(`document.getElementById('settings-open').click()`);
    const result = await work();
    await evaluate(`document.getElementById('settings-close').click()`);
    await sleep(120);
    return result;
  };

  const draw = async (runs) => {
    const out = [];
    for (let i = 0; i < runs; i += 1) {
      await open();
      out.push((await probe()).words);
    }
    return out;
  };

  await open();
  await evaluate(`localStorage.clear()`);
  await open();

  const defaults = await withSettings(async () => ({
    contractions: await toggle('contractions'),
    punctuation: await toggle('punctuation'),
    capitals: await toggle('capitals'),
    length: await choice('spans'),
    vocabulary: await choice('vocabularies'),
  }));

  check('word mode starts with contractions on and punctuation and capitals off', () => {
    assert.equal(defaults.contractions.pressed, 'true');
    assert.equal(defaults.punctuation.pressed, 'false');
    assert.equal(defaults.capitals.pressed, 'false');
    assert.equal(defaults.contractions.text, 'contractions on');
    assert.equal(defaults.punctuation.text, 'punctuation off');
  });

  check('only the settings for the current text mode are shown', () => {
    assert.equal(defaults.contractions.shown, true);
    assert.equal(defaults.length.shown, false);
    assert.equal(defaults.vocabulary.shown, false);
  });

  const swapped = await withSettings(async () => {
    await evaluate(`document.querySelector('#modes button[data-mode="sentences"]').click()`);
    const shown = {
      contractions: (await toggle('contractions')).shown,
      length: (await choice('spans')).shown,
      vocabulary: (await choice('vocabularies')).shown,
    };
    await evaluate(`document.querySelector('#modes button[data-mode="words"]').click()`);
    return shown;
  });

  check('switching to sentences swaps which settings are shown', () => {
    assert.equal(swapped.contractions, false);
    assert.equal(swapped.length, true);
    assert.equal(swapped.vocabulary, true);
  });

  await withSettings(() =>
    evaluate(`document.querySelector('#lengths button[data-length="50"]').click()`),
  );

  const bareRuns = (await draw(4)).flat();
  check('contractions turn up in word mode by default', () =>
    assert.ok(bareRuns.some((word) => word.includes("'")), 'no contraction in four runs of 50'));
  check('word mode is plain until you ask otherwise', () => {
    assert.ok(bareRuns.every((word) => /^[A-Za-z]+('[a-z]+)?$/.test(word)), 'a word carried punctuation');
    assert.ok(
      bareRuns.every((word) => !/^[A-Z]/.test(word) || /^I('|$)/.test(word)),
      'a word was capitalised without being asked',
    );
  });

  await withSettings(() => flip('contractions', false));
  const without = (await draw(4)).flat();
  check('switching contractions off removes them from word mode', () => {
    assert.equal(without.filter((word) => word.includes("'")).length, 0);
    assert.ok(without.length >= 200, `only ${without.length} words drawn`);
  });
  await withSettings(() => flip('contractions', true));

  await withSettings(() => flip('punctuation', true));
  const marked = (await draw(2)).flat();
  check('random punctuation lands on some words', () => {
    const count = marked.filter((word) => /[,.;:!?]$/.test(word)).length;
    assert.ok(count >= 8, `only ${count} of ${marked.length} words carried a mark`);
    assert.ok(marked.every((word) => /^[A-Za-z]+('[a-z]+)?[,.;:!?]?$/.test(word)));
  });

  await withSettings(() => flip('capitals', true));
  const both = (await draw(2)).flat();
  check('random capitals land on some words', () => {
    const count = both.filter((word) => /^[A-Z]/.test(word) && !/^I('|[,.;:!?]?$)/.test(word)).length;
    assert.ok(count >= 8, `only ${count} of ${both.length} words were capitalised`);
  });
  check('punctuation and capitals combine on one word', () =>
    assert.ok(both.some((word) => /^[A-HJ-Z][a-z']*[,.;:!?]$/.test(word)), 'no word had both'));

  await open();
  const kept = await withSettings(async () => ({
    punctuation: (await toggle('punctuation')).pressed,
    capitals: (await toggle('capitals')).pressed,
    contractions: (await toggle('contractions')).pressed,
  }));
  check('the word mode switches survive a reload', () => {
    assert.equal(kept.punctuation, 'true');
    assert.equal(kept.capitals, 'true');
    assert.equal(kept.contractions, 'true');
  });

  const decorated = await probe();
  for (const token of decorated.words.slice(0, 6)) await type(`${token} `, 2);
  const typedThrough = await probe();
  check('decorated words type like any others', () => {
    assert.equal(typedThrough.progress.split('/')[0], '6');
    assert.equal(typedThrough.drillVisible, false, `drilled on ${decorated.words.slice(0, 6).join(' ')}`);
  });

  await withSettings(async () => {
    await flip('punctuation', false);
    await flip('capitals', false);
  });

  await withSettings(() =>
    evaluate(`document.querySelector('#modes button[data-mode="sentences"]').click()`),
  );
  await sleep(600);
  const sentenceDefaults = await withSettings(async () => ({
    length: await choice('spans'),
    vocabulary: await choice('vocabularies'),
  }));
  check('sentence length starts on medium and vocabulary on any', () => {
    assert.equal(sentenceDefaults.length.active, 'medium');
    assert.equal(sentenceDefaults.vocabulary.active, 'any');
  });

  const drawSentences = async (runs) => {
    const found = [];
    for (let i = 0; i < runs; i += 1) {
      await open();
      await sleep(250);
      found.push(...sentencesOf((await probe()).words));
    }
    return found;
  };

  const anyVocabulary = await drawSentences(6);
  check('with any vocabulary, sentences with rare words come up', () =>
    assert.ok(
      anyVocabulary.some((sentence) => sentence.rarity > 0.15),
      `all ${anyVocabulary.length} sentences were nearly all common words`,
    ));

  await withSettings(() => evaluate(`document.querySelector('#vocabularies button[data-vocabulary="common"]').click()`));
  const commonOnly = await drawSentences(4);
  check('common only allows no rare word in any sentence', () => {
    assert.ok(commonOnly.length >= 6, `only ${commonOnly.length} sentences drawn`);
    assert.ok(commonOnly.every((sentence) => sentence.rarity === 0), JSON.stringify(commonOnly.map((s) => s.rarity)));
  });

  await withSettings(() => evaluate(`document.querySelector('#vocabularies button[data-vocabulary="mostly"]').click()`));
  const mostly = await drawSentences(4);
  check('mostly common allows a few rare words and no more', () => {
    assert.ok(mostly.length >= 6);
    assert.ok(mostly.every((sentence) => sentence.rarity <= 0.15), JSON.stringify(mostly.map((s) => s.rarity)));
  });

  await open();
  const vocabularyKept = await withSettings(() => choice('vocabularies'));
  check('the vocabulary choice survives a reload', () =>
    assert.equal(vocabularyKept.active, 'mostly common'));

  await withSettings(() => evaluate(`document.querySelector('#vocabularies button[data-vocabulary="any"]').click()`));

  await withSettings(() => evaluate(`document.querySelector('#spans button[data-span="short"]').click()`));
  const shortOnes = await drawSentences(4);
  check('short sentences stay between 3 and 6 words', () => {
    assert.ok(shortOnes.length >= 8, `only ${shortOnes.length} sentences drawn`);
    assert.ok(shortOnes.every((s) => s.words >= 3 && s.words <= 6), JSON.stringify(shortOnes.map((s) => s.words)));
  });

  await withSettings(() => evaluate(`document.querySelector('#spans button[data-span="long"]').click()`));
  const longOnes = await drawSentences(4);
  check('long sentences are at least 10 words', () => {
    assert.ok(longOnes.length >= 3, `only ${longOnes.length} sentences drawn`);
    assert.ok(longOnes.every((s) => s.words >= 10 && s.words <= 30), JSON.stringify(longOnes.map((s) => s.words)));
  });

  await open();
  const spanKept = await withSettings(() => choice('spans'));
  check('the sentence length choice survives a reload', () => assert.equal(spanKept.active, 'long'));

  await withSettings(async () => {
    await evaluate(`document.querySelector('#spans button[data-span="medium"]').click()`);
    await evaluate(`document.querySelector('#modes button[data-mode="words"]').click()`);
    await evaluate(`document.querySelector('#lengths button[data-length="25"]').click()`);
  });
  await open();

  await open();
  await evaluate(`localStorage.clear()`);
  await open();
  await sleep(300);

  const fetched = (name) =>
    evaluate(`performance.getEntriesByType('resource').filter((e) => e.name.includes('${name}')).length`);

  const beforeSentences = await fetched('english-sentences');
  check('word mode does not download the sentence file', () => assert.equal(beforeSentences, 0));

  await chooseSetting('#modes button[data-mode="sentences"]');
  await sleep(1500);
  const afterSwitch = await probe();
  const downloads = await fetched('english-sentences');
  check('choosing sentence mode downloads the sentences once and fills the stream', () => {
    assert.equal(downloads, 1);
    assert.ok(afterSwitch.words.length >= 25, `only ${afterSwitch.words.length} words`);
    assert.ok(afterSwitch.words.some((word) => /[.!?]$/.test(word)), 'no sentence ending in the stream');
  });

  await chooseSetting('#lengths button[data-length="50"]');
  await sleep(500);
  const planned = await probe();

  check('a 50 word sentence run starts with just the words in view and plans for 50', () => {
    assert.equal(planned.progress, '0/50');
    assert.ok(planned.words.length >= 36, `only ${planned.words.length} words fed`);
    assert.ok(planned.words.length < 80, `${planned.words.length} words fed up front`);
  });

  let typedWords = 0;
  let mostFed = planned.words.length;
  let midway = null;
  for (let guard = 0; guard < 400; guard += 1) {
    const now = await probe();
    mostFed = Math.max(mostFed, now.words.length);
    if (typedWords === 20) midway = now.progress;
    if (now.resultsVisible) break;
    const token = now.words[typedWords];
    if (token === undefined) break;
    await type(`${token} `, 2);
    typedWords += 1;
  }
  await sleep(400);
  const completed = await probe();

  check('the stream is topped up with more sentences as you type', () =>
    assert.ok(mostFed > planned.words.length, `the list never grew past ${planned.words.length}`));

  check('the counter never reads a total below the 50 planned while a run is under way', () => {
    assert.match(midway, /^20\/\d+$/);
    assert.ok(Number(midway.split('/')[1]) >= 50, `the total read ${midway}`);
  });

  check('a 50 word run still ends on a whole sentence at or past 50', () => {
    assert.equal(completed.resultsVisible, true, 'the run never finished');
    assert.ok(typedWords >= 50, `finished after ${typedWords} words`);
    assert.equal(completed.progress, `${typedWords}/${typedWords}`);
  });

  const usedIds = await evaluate(
    `[...document.querySelectorAll('#results-credit-list a.source')].map((a) => Number(a.textContent.slice(1)))`,
  );
  const remembered = await evaluate(
    `JSON.parse(localStorage.getItem('typing-game/profile/v1')).recent`,
  );

  check('every sentence you typed is credited on the results screen', () => {
    assert.ok(usedIds.length >= 3, `only ${usedIds.length} sentences credited`);
    assert.equal(new Set(usedIds).size, usedIds.length, 'a sentence was used twice in one run');
  });

  check('the sentences you used are remembered so they are not served again straight away', () => {
    for (const id of usedIds) assert.ok(remembered.includes(id), `${id} was not remembered`);
  });

  await chooseSetting('#modes button[data-mode="words"]');
  await chooseSetting('#lengths button[data-length="25"]');
  await open();

  const setViewport = (width, height) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

  await open();
  const wideWords = await evaluate(
    `[...document.querySelectorAll('.stream-inner .word')].map(n => n.textContent.trim())`,
  );
  for (let i = 0; i < 12; i += 1) await type(`${wideWords[i]} `, 2);
  await sleep(200);
  const wide = await probe();

  await setViewport(520, 900);
  await sleep(250);
  const narrow = await probe();
  await shoot('/tmp/tg-narrow.png');

  await setViewport(1200, 1060);
  await sleep(250);
  const back = await probe();

  check('resizing keeps the cursor on screen', () => {
    assert.equal(wide.activeVisible, true);
    assert.equal(narrow.activeVisible, true);
    assert.equal(back.activeVisible, true);
  });
  check('resizing rewraps the stream and restores it', () => {
    assert.notDeepEqual(narrow.layout, wide.layout);
    assert.deepEqual(back.layout, wide.layout);
  });
  check('the type scales with the viewport', () =>
    assert.ok(
      narrow.typeSize < wide.typeSize - 2,
      `type size went ${wide.typeSize} to ${narrow.typeSize}`,
    ));
  check('the stream window stays exactly three lines at any width', () => {
    for (const snap of [wide, narrow, back]) {
      assert.ok(
        Math.abs(snap.streamHeight - snap.lineHeight * 3) < 1.5,
        `${snap.streamHeight}px window vs 3 lines of ${snap.lineHeight}px`,
      );
    }
  });

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await open();

  const phone = () =>
    evaluate(`({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      touchHint: getComputedStyle(document.querySelector('.hint .hint-touch')).display,
      keyHint: getComputedStyle(document.querySelector('.hint .hint-keys')).display,
      shortestButton: Math.min(...[...document.querySelectorAll('button')]
        .filter(b => b.offsetParent)
        .map(b => b.getBoundingClientRect().height)),
      focused: document.activeElement?.id ?? null,
    })`);

  const phoneStart = await probe();
  const phonePlay = await phone();
  await shoot('/tmp/tg-phone.png');

  for (const ch of `${phoneStart.words[0]} `) await cdp.send('Input.insertText', { text: ch });
  const insertedWord = await probe();

  await type(wrongLetterFor(phoneStart.words[1][0]));
  const insertedTypo = await probe();

  await evaluate(`document.getElementById('new-run').click()`);
  const freshRun = await probe();
  const freshFocus = await phone();

  await evaluate(`document.getElementById('settings-open').click()`);
  const phoneSettings = await phone();
  await shoot('/tmp/tg-phone-settings.png');
  await evaluate(`document.getElementById('settings-close').click()`);

  check('nothing scrolls sideways on a phone, in play or in settings', () => {
    assert.ok(phonePlay.overflow <= 0, `play overflowed by ${phonePlay.overflow}px`);
    assert.ok(phoneSettings.overflow <= 0, `settings overflowed by ${phoneSettings.overflow}px`);
  });
  check('a touch screen gets the tap hint instead of the key hint', () => {
    assert.notEqual(phonePlay.touchHint, 'none');
    assert.equal(phonePlay.keyHint, 'none');
  });
  check('every button is a full size tap target on a touch screen', () => {
    assert.ok(phonePlay.shortestButton >= 44, `a play button was ${phonePlay.shortestButton}px`);
    assert.ok(
      phoneSettings.shortestButton >= 44,
      `a settings button was ${phoneSettings.shortestButton}px`,
    );
  });
  check('text from a keyboard that sends no key events still types', () => {
    assert.equal(insertedWord.progress, '1/25');
    assert.equal(insertedWord.active, phoneStart.words[1]);
  });
  check('inserted text and key events share one engine', () =>
    assert.equal(insertedTypo.drillVisible, true));
  check('the new run button starts a run and hands the keyboard back', () => {
    assert.equal(freshRun.progress, '0/25');
    assert.equal(freshRun.drillVisible, false);
    assert.equal(freshFocus.focused, 'keytrap');
  });

  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await sleep(150);

  await open();
  await evaluate(`document.querySelector('#reps button[data-reps="3"]').click()`);
  const threeUp = await probe();
  const firstWord = threeUp.words[0];

  await type(wrongLetterFor(firstWord[0]));
  const threeStart = await probe();
  check('the rep control sets how many clean passes you owe', () => {
    assert.equal(threeStart.drillVisible, true);
    assert.equal(threeStart.pips, 3);
    assert.match(threeStart.drillNote, /3 to escape/);
  });

  await sleep(400);
  await type(`${firstWord} `);
  await type(`${firstWord} `);
  const twoIn = await probe();
  check('a three rep drill still wants all three', () => {
    assert.equal(twoIn.drillVisible, true);
    assert.equal(twoIn.filled, 2);
  });

  await type(`${firstWord} `);
  const threeDone = await probe();
  check('three clean reps clear a three rep drill', () => {
    assert.equal(threeDone.drillVisible, false);
    assert.equal(threeDone.progress, `1/${threeUp.words.length}`);
  });

  await open();
  const reloaded = await probe();
  check('the rep choice survives a reload', () => assert.equal(reloaded.reps, '3'));

  await evaluate(`document.querySelector('#reps button[data-reps="5"]').click()`);

  const paint = () => evaluate(`(() => {
    const sheet = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const toRgb = (value) => {
      sheet.clearRect(0, 0, 1, 1);
      sheet.fillStyle = value;
      sheet.fillRect(0, 0, 1, 1);
      return [...sheet.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const body = getComputedStyle(document.body);
    return {
      theme: document.documentElement.dataset.theme,
      scheme: body.colorScheme,
      bg: toRgb(body.backgroundColor),
      text: toRgb(body.color)
    };
  })()`);

  await evaluate(`document.querySelector('#themes button[data-theme="light"]').click()`);
  const light = await paint();
  await shoot('/tmp/tg-light.png');

  await evaluate(`document.querySelector('#themes button[data-theme="dark"]').click()`);
  const dark = await paint();

  const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  check('light mode inverts the page', () => {
    assert.equal(light.theme, 'light');
    assert.equal(dark.theme, 'dark');
    assert.ok(luminance(light.bg) > 200, `light background was ${light.bg}`);
    assert.ok(luminance(dark.bg) < 50, `dark background was ${dark.bg}`);
    assert.ok(luminance(light.text) < 60, `light mode text was ${light.text}`);
    assert.ok(luminance(dark.text) > 190, `dark mode text was ${dark.text}`);
  });

  check('the theme sets color-scheme so native widgets follow', () => {
    assert.equal(light.scheme, 'light');
    assert.equal(dark.scheme, 'dark');
  });

  await evaluate(`document.querySelector('#themes button[data-theme="light"]').click()`);
  await open();
  const afterReload = await probe();
  check('the theme choice survives a reload with no dark flash', () => {
    assert.equal(afterReload.theme, 'light');
    assert.equal(afterReload.themeChoice, 'light');
  });

  await evaluate(`document.querySelector('#themes button[data-theme="system"]').click()`);


  await type(start.words[0].slice(0, 1));
  await shoot('/tmp/tg-typing.png');

  await open();
  await evaluate(`(() => {
    const slider = document.getElementById('penalty');
    slider.value = '700';
    slider.dispatchEvent(new Event('input'));
    slider.dispatchEvent(new Event('change'));
  })()`);

  const slowRun = await probe();
  const slowWord = slowRun.words[0];

  await type(wrongLetterFor(slowWord[0]));
  const locked = await probe();
  await sleep(420);
  await type(slowWord[0]);
  const stillLocked = await probe();
  await sleep(420);
  await type(slowWord[0]);
  const released = await probe();

  check('the penalty slider sets how long the keyboard stays locked', () => {
    assert.equal(slowRun.penaltyLabel, '700ms');
    assert.equal(stillLocked.typed, 0, 'a key landed 420ms into a 700ms penalty');
    assert.equal(released.typed, 1, 'the keyboard never came back');
  });

  check('the cursor disappears while you cannot type', () => {
    assert.equal(locked.caretVisible, false);
    assert.equal(stillLocked.caretVisible, false);
    assert.equal(released.caretVisible, true);
  });

  await open();
  const keptPenalty = await probe();
  check('the penalty choice survives a reload', () =>
    assert.equal(keptPenalty.penaltyLabel, '700ms'));

  await evaluate(`(() => {
    const slider = document.getElementById('penalty');
    slider.value = '250';
    slider.dispatchEvent(new Event('input'));
    slider.dispatchEvent(new Event('change'));
  })()`);

  await open();
  await evaluate(`document.querySelector('#modes button[data-mode="sentences"]').click()`);
  await sleep(150);
  const prose = await probe();

  check('sentence mode lays out real sentences', () => {
    assert.equal(prose.mode, 'sentences');
    assert.ok(prose.words.length >= 25, `only ${prose.words.length} tokens`);
    assert.ok(prose.words.some((t) => /^[A-Z]/.test(t)), 'no capitalised token');
    assert.ok(prose.words.some((t) => /[.!?]$/.test(t)), 'no sentence ending');
  });

  check('both corpora are credited in the footer', () => {
    assert.match(prose.credits, /Kevin Atkinson/);
    assert.match(prose.credits, /Tatoeba/);
  });

  const capitalAt = prose.words.findIndex((t) => /^[A-Z]/.test(t));
  for (let i = 0; i < capitalAt; i += 1) await type(`${prose.words[i]} `, 2);
  await type(prose.words[capitalAt][0].toLowerCase());
  const shiftSlip = await probe();

  check('a missed shift drops you into sudden death', () => {
    assert.equal(shiftSlip.drillVisible, true);
    assert.equal(shiftSlip.drillWord, prose.words[capitalAt]);
  });

  await open();
  await sleep(150);
  const punctRun = await probe();
  const punctAt = punctRun.words.findIndex((t) => /[,.!?;:]$/.test(t) && t.length > 3);

  for (let i = 0; i < punctAt; i += 1) await type(`${punctRun.words[i]} `, 2);
  const punctToken = punctRun.words[punctAt];
  await type(punctToken.slice(0, -1), 2);
  const beforeMark = await probe();
  await type('x');
  const punctSlip = await probe();

  check('punctuation belongs to the word it hangs off', () => {
    assert.equal(beforeMark.drillVisible, false, 'the token ended before its punctuation');
    assert.equal(punctSlip.drillVisible, true);
    assert.equal(punctSlip.drillWord, punctToken);
    assert.ok(/[,.!?;:]$/.test(punctSlip.drillWord), `${punctSlip.drillWord} lost its punctuation`);
  });

  await open();
  const keptMode = await probe();
  check('the text source survives a reload', () => assert.equal(keptMode.mode, 'sentences'));

  await evaluate(`document.querySelector('#modes button[data-mode="words"]').click()`);
  await sleep(150);
  const backToWords = await probe();
  check('switching back to words drops the punctuation', () => {
    assert.equal(backToWords.mode, 'words');
    assert.ok(
      backToWords.words.every((t) => /^[A-Za-z]+('[a-z]+)?$/.test(t)),
      `a word run carried punctuation: ${backToWords.words.join(' ')}`,
    );
  });

  await open();
  await evaluate(`(() => {
    window.__keys = [];
    window.addEventListener('keydown', (e) => window.__keys.push([e.key, e.defaultPrevented]));
  })()`);

  await type("a' /;,.", 2);
  const swallowed = await evaluate('window.__keys');


  check('every key the game consumes is taken from the browser', () => {
    for (const [key, prevented] of swallowed) {
      assert.ok(prevented, `"${key}" reached the browser and can trigger its own shortcut`);
    }
  });

  check('the apostrophe specifically is swallowed', () => {
    const quote = swallowed.find(([key]) => key === "'");
    assert.ok(quote, 'no apostrophe was dispatched');
    assert.equal(quote[1], true, "' reached Firefox quick find");
  });

  await evaluate('window.__keys = []');
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'f', code: 'KeyF', modifiers: 2,
    windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'f', code: 'KeyF', modifiers: 2,
    windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70,
  });
  const withModifier = await evaluate('window.__keys');

  check('browser shortcuts still reach the browser', () => {
    assert.equal(withModifier.length, 1);
    assert.equal(withModifier[0][1], false, 'ctrl+f was swallowed by the game');
  });

  await open();
  await sleep(200);
  const beforeSettings = await probe();

  check('the play screen carries no controls', () => {
    assert.equal(beforeSettings.settingsOpen, false);
    assert.equal(beforeSettings.playVisible, true);
  });

  await evaluate(`document.getElementById('settings-open').click()`);
  await sleep(200);
  const inSettings = await probe();

  check('settings opens over the game', () => {
    assert.equal(inSettings.settingsOpen, true);
    assert.equal(inSettings.playVisible, false);
  });

  const settingsWords = await evaluate(
    `[...document.querySelectorAll('.stream-inner .word')].map(n => n.textContent.trim())`,
  );
  await type(settingsWords[0].slice(0, 3), 2);
  const typedInSettings = await evaluate(
    `document.querySelectorAll('.word.is-active .ch.is-hit').length`,
  );
  check('typing does nothing while settings is open', () =>
    assert.equal(typedInSettings, 0));

  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  });
  await sleep(200);
  const closed = await probe();
  check('escape closes settings and hands the keyboard back', () => {
    assert.equal(closed.settingsOpen, false);
    assert.equal(closed.playVisible, true);
  });

  await type(`${closed.words[0]} `, 2);
  const typedAfter = await probe();
  check('typing works again once settings is shut', () =>
    assert.equal(typedAfter.progress.split('/')[0], '1'));

  await open();
  await sleep(500);
  const atRest = await probe();
  const zenWords = atRest.words;

  await type(`${zenWords[0]} `, 2);
  await sleep(600);
  const typing = await probe();

  check('zen mode is on by default', () => assert.equal(atRest.zen, 'zen on'));

  check('the numbers are there before you start', () => {
    assert.equal(atRest.quiet, false);
    assert.equal(atRest.readoutOpacity, 1);
  });

  check('the numbers go away once you are typing', () => {
    assert.equal(typing.quiet, true);
    assert.equal(typing.readoutOpacity, 0);
    assert.equal(typing.mastheadOpacity, 0);
  });

  check('the credits link stays out of the way while you type and is there before and after', () => {
    assert.equal(atRest.creditLinkOpacity, 1);
    assert.equal(typing.creditLinkOpacity, 0);
  });

  check('the words you are typing never fade', () =>
    assert.equal(typing.streamOpacity, 1));

  check('hiding the chrome moves nothing', () =>
    assert.deepEqual(typing.layout, atRest.layout));

  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 700 });
  await sleep(600);
  const peeked = await probe();
  check('moving the mouse brings the controls back mid run', () => {
    assert.equal(peeked.quiet, false);
    assert.equal(peeked.mastheadOpacity, 1);
  });

  await type(zenWords[1][0], 2);
  await sleep(600);
  const hushed = await probe();
  check('the next keystroke hushes it again', () => assert.equal(hushed.quiet, true));

  for (let i = 1; i < zenWords.length - 1; i += 1) {
    await type(`${zenWords[i].slice(i === 1 ? 1 : 0)} `, 2);
  }
  await type(zenWords.at(-1), 2);
  await sleep(600);
  const done = await probe();

  check('the numbers come back when the run ends', () => {
    assert.equal(done.resultsVisible, true);
    assert.equal(done.quiet, false);
    assert.equal(done.readoutOpacity, 1);
  });

  await evaluate(`document.getElementById('zen').click()`);
  await open();
  const plain = await probe();
  await type(`${plain.words[0]} `, 2);
  await sleep(600);
  const plainTyping = await probe();

  check('turning zen off keeps the numbers up while you type', () => {
    assert.equal(plain.zen, 'zen off');
    assert.equal(plainTyping.quiet, false);
    assert.equal(plainTyping.readoutOpacity, 1);
  });

  await evaluate(`document.getElementById('zen').click()`);

  await open();

  const render = (sound) => evaluate(`(async () => {
    const rate = 48000;
    const offline = new OfflineAudioContext(1, rate, rate);
    window.AudioContext = function () {
      return new Proxy(offline, {
        get(target, prop) {
          if (prop === 'state') return 'running';
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    };

    const audio = await import('/js/audio.js?render=${sound}');
    audio.setEnabled(true);
    audio.${sound}();
    audio.setEnabled(false);

    const buffer = await offline.startRendering();
    const samples = buffer.getChannelData(0);

    let peak = 0;
    let jump = 0;
    let energy = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const level = Math.abs(samples[i]);
      if (level > peak) peak = level;
      energy += samples[i] * samples[i];
      if (i > 0) {
        const delta = Math.abs(samples[i] - samples[i - 1]);
        if (delta > jump) jump = delta;
      }
    }

    return {
      peak,
      jump,
      rms: Math.sqrt(energy / samples.length),
      first: samples[0],
      last: samples[samples.length - 1],
      clipped: [...samples].filter((v) => Math.abs(v) >= 1).length
    };
  })()`);

  const thud = await render('thud');
  const blip = await render('blip');

  check('every sound actually renders something', () => {
    assert.ok(thud.peak > 0.01, `error sound peaked at ${thud.peak}`);
    assert.ok(blip.peak > 0.01, `rep sound peaked at ${blip.peak}`);
  });

  check('the error sound never clips', () => {
    assert.equal(thud.clipped, 0);
    assert.ok(thud.peak < 0.9, `peak was ${thud.peak}`);
    assert.ok(thud.peak > 0.01, `peak was ${thud.peak}, is it silent?`);
  });

  check('the error sound starts and ends at silence', () => {
    assert.ok(Math.abs(thud.first) < 1e-4, `first sample was ${thud.first}`);
    assert.ok(Math.abs(thud.last) < 1e-4, `last sample was ${thud.last}`);
  });

  check('no sample to sample jumps that would click', () => {
    assert.ok(thud.jump < 0.01, `error sound jumped ${thud.jump} between samples`);
    assert.ok(blip.jump < 0.01, `rep sound jumped ${blip.jump} between samples`);
  });

  console.log(`results grid: ${JSON.stringify(stored.grid)}`);
  console.log(`results title: ${stored.title}`);
  console.log(`drilled line: ${stored.drilled}`);
  console.log(`lifetime:     ${finished.lifetime}`);
  console.log(`problems:     ${JSON.stringify(finished.problems)}`);

  cdp.close();
  chrome.kill();
}

try {
  await run();
} catch (error) {
  console.error(`\nharness error: ${error.stack}`);
  process.exitCode = 1;
} finally {
  for (const stray of spawned) stray.kill();
  const failed = checks.filter((line) => line.includes('FAIL')).length;
  console.log(`\n${checks.join('\n')}`);
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
}
