import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const FIREFOX = process.env.FIREFOX ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const APP = process.env.APP ?? 'http://127.0.0.1:8777/index.html';
const PORT = Number(process.env.BIDI_PORT ?? 9222);
const HEADLESS = process.env.HEADFUL !== '1';

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

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'tg-firefox-'));
  const args = [
    '--remote-debugging-port', String(PORT),
    '--profile', profile,
    '--no-remote',
    '--new-instance',
  ];
  if (HEADLESS) args.push('--headless');

  const firefox = spawn(FIREFOX, [...args, 'about:blank']);
  spawned.push(firefox);
  firefox.stdout.on('data', () => {});

  let announced = null;
  firefox.stderr.on('data', (chunk) => {
    const found = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(String(chunk));
    if (found) announced = found[1];
  });

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(250);
    if (announced) return `${announced}/session`;
  }
  throw new Error('firefox never announced a BiDi endpoint');
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id === undefined) return;
    const slot = pending.get(message.id);
    if (!slot) return;
    pending.delete(message.id);
    if (message.type === 'error') slot.reject(new Error(`${message.error}: ${message.message}`));
    else slot.resolve(message.result);
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('bidi socket failed')), { once: true });
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return { ready, send, close: () => socket.close() };
}

async function run() {
  const url = await launch();
  const bidi = connect(url);
  await bidi.ready;
  await bidi.send('session.new', { capabilities: {} });

  const tree = await bidi.send('browsingContext.getTree', {});
  const context = tree.contexts[0].context;

  const evaluate = async (expression) => {
    const result = await bidi.send('script.evaluate', {
      expression: `JSON.stringify(${expression})`,
      target: { context },
      awaitPromise: true,
      resultOwnership: 'none',
    });
    if (result.type === 'exception') {
      throw new Error(result.exceptionDetails?.text ?? 'evaluate threw');
    }
    return JSON.parse(result.result.value);
  };

  const press = async (keys) => {
    await bidi.send('input.performActions', {
      context,
      actions: [
        {
          type: 'key',
          id: 'keyboard',
          actions: [...keys].flatMap((key) => [
            { type: 'keyDown', value: key },
            { type: 'keyUp', value: key },
            { type: 'pause', duration: 12 },
          ]),
        },
      ],
    });
  };

  const open = async () => {
    await bidi.send('browsingContext.navigate', { context, url: APP, wait: 'complete' });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await sleep(150);
      const ready = await evaluate(
        `document.querySelectorAll('.stream-inner .word').length > 0`,
      ).catch(() => false);
      if (ready) return;
    }
    throw new Error('app never rendered a word stream in firefox');
  };

  const state = () =>
    evaluate(`({
      focused: document.activeElement ? document.activeElement.id || document.activeElement.tagName : null,
      progress: document.getElementById('stat-progress').textContent,
      typed: document.querySelectorAll('.word.is-active .ch.is-hit, .word.is-drilling .ch.is-hit').length,
      reached: window.__seen ?? 0,
      drilling: (document.querySelector('.word.is-drilling')?.textContent ?? '').trim(),
      words: [...document.querySelectorAll('.stream-inner .word')].map(n => n.textContent.trim())
    })`);

  await open();
  await evaluate(`(localStorage.clear(), 1)`);
  await open();

  const start = await state();
  check('firefox puts focus in the typing input', () =>
    assert.equal(start.focused, 'keytrap'));

  await press(start.words[0]);
  const typed = await state();
  check('letters reach the game in firefox', () =>
    assert.equal(typed.typed, start.words[0].length));

  await evaluate(`(() => {
    window.__seen = 0;
    document.addEventListener('keydown', () => { window.__seen += 1; }, true);
    return 1;
  })()`);

  await press("'");
  await sleep(500);
  const afterQuote = await state();

  check('an apostrophe keeps focus in the typing input', () =>
    assert.equal(afterQuote.focused, 'keytrap', `focus moved to ${afterQuote.focused}`));

  check('an apostrophe reaches the engine as a typo', () =>
    assert.ok(afterQuote.drilling.length > 0, 'the wrong key never reached the engine'));

  await press('/');
  await sleep(500);
  const afterSlash = await state();
  check('a slash keeps focus in the typing input', () =>
    assert.equal(afterSlash.focused, 'keytrap'));

  const word = afterSlash.drilling;
  await press(word);
  await sleep(200);
  const stillTyping = await state();
  check('the keyboard still belongs to the page afterwards', () => {
    assert.equal(stillTyping.reached, 2 + word.length, 'keystrokes stopped arriving');
    assert.ok(stillTyping.typed > 0, 'the engine stopped accepting letters');
  });

  await evaluate(`(document.getElementById('settings-open').click(), 1)`);
  await sleep(200);
  const inSettings = await state();
  check('settings releases the keyboard so the browser can have it', () =>
    assert.notEqual(inSettings.focused, 'keytrap'));

  bidi.close();
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
