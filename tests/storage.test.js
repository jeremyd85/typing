import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProfile,
  normalize,
  recordRun,
  problemWords,
  lifetime,
  wordKey,
  slowWords,
  medianPace,
  displayKey,
} from '../js/storage.js';

function blankProfile() {
  return { version: 1, createdAt: '2026-01-01T00:00:00.000Z', runs: [], words: {} };
}

function runOf(results, extra = {}) {
  return {
    results,
    listId: 'english-common',
    at: 1_700_000_000_000,
    summary: {
      words: results.length,
      wpm: 60,
      accuracy: 0.98,
      cleanWords: results.filter((r) => r.clean).length,
      drilledWords: results.filter((r) => !r.clean).map((r) => r.word),
      drillMisses: results.reduce((sum, r) => sum + r.misses, 0),
      typeMs: 10_000,
      drillMs: 4_000,
      ...extra,
    },
  };
}

test('an empty profile is a valid profile', () => {
  assert.doesNotThrow(() => normalize(emptyProfile()));
});

test('a missed word gets hot', () => {
  const profile = recordRun(blankProfile(), runOf([{ word: 'sharp', clean: false, misses: 1 }]));

  assert.equal(profile.words.sharp.heat, 0.5);
  assert.equal(profile.words.sharp.misses, 1);
  assert.equal(profile.words.sharp.drills, 1);
  assert.equal(profile.words.sharp.seen, 1);
});

test('a clean word cools off', () => {
  let profile = recordRun(blankProfile(), runOf([{ word: 'sharp', clean: false, misses: 1 }]));
  profile = recordRun(profile, runOf([{ word: 'sharp', clean: true, misses: 0 }]));

  assert.equal(profile.words.sharp.heat, 0.42);
  assert.equal(profile.words.sharp.drills, 1);
  assert.equal(profile.words.sharp.seen, 2);
});

test('heat never leaves the zero to one range', () => {
  let profile = blankProfile();
  for (let i = 0; i < 10; i += 1) {
    profile = recordRun(profile, runOf([{ word: 'sharp', clean: false, misses: 3 }]));
  }
  assert.equal(profile.words.sharp.heat, 1);

  for (let i = 0; i < 40; i += 1) {
    profile = recordRun(profile, runOf([{ word: 'sharp', clean: true, misses: 0 }]));
  }
  assert.equal(profile.words.sharp.heat, 0);
});

test('problem words come back hottest first', () => {
  let profile = blankProfile();
  profile = recordRun(
    profile,
    runOf([
      { word: 'smooth', clean: false, misses: 1 },
      { word: 'sharp', clean: false, misses: 2 },
      { word: 'the', clean: true, misses: 0 },
    ]),
  );

  assert.deepEqual(
    problemWords(profile).map((entry) => entry.word),
    ['sharp', 'smooth'],
  );
});

test('a cooled word drops off the problem list', () => {
  let profile = recordRun(blankProfile(), runOf([{ word: 'sharp', clean: false, misses: 1 }]));
  for (let i = 0; i < 7; i += 1) {
    profile = recordRun(profile, runOf([{ word: 'sharp', clean: true, misses: 0 }]));
  }

  assert.deepEqual(problemWords(profile), []);
});

test('run history is capped', () => {
  let profile = blankProfile();
  for (let i = 0; i < 260; i += 1) {
    profile = recordRun(profile, runOf([{ word: 'the', clean: true, misses: 0 }]));
  }

  assert.equal(profile.runs.length, 200);
});

test('lifetime stats read off the run history', () => {
  let profile = blankProfile();
  profile = recordRun(profile, runOf([{ word: 'the', clean: true, misses: 0 }], { wpm: 50 }));
  profile = recordRun(profile, runOf([{ word: 'and', clean: true, misses: 0 }], { wpm: 70 }));

  const stats = lifetime(profile);
  assert.equal(stats.runs, 2);
  assert.equal(stats.bestWpm, 70);
  assert.equal(stats.recentWpm, 60);
  assert.equal(stats.words, 2);
});

test('lifetime stats survive an empty history', () => {
  assert.equal(lifetime(blankProfile()).runs, 0);
});

test('a profile from another version is rejected', () => {
  assert.throws(() => normalize({ version: 99, runs: [], words: {} }), /unsupported profile version/);
  assert.throws(() => normalize(null), /not an object/);
});

test('a profile with missing fields is repaired', () => {
  const repaired = normalize({ version: 1 });
  assert.deepEqual(repaired.runs, []);
  assert.deepEqual(repaired.words, {});
});


test('a trailing period is not part of the word', () => {
  assert.equal(wordKey('end.'), 'end');
  assert.equal(wordKey('end'), 'end');
  assert.equal(wordKey('wait...'), 'wait');
});

test('all punctuation at either end comes off', () => {
  assert.equal(wordKey('time,'), 'time');
  assert.equal(wordKey('really?'), 'really');
  assert.equal(wordKey('"quoted"'), 'quoted');
  assert.equal(wordKey('half-'), 'half');
});

test('punctuation inside a word stays', () => {
  assert.equal(wordKey("don't"), "don't");
  assert.equal(wordKey('well-known'), 'well-known');
  assert.equal(wordKey("He'll"), "he'll");
});

test('case folds, so a sentence opener is the same word', () => {
  assert.equal(wordKey('The'), 'the');
  assert.equal(wordKey('THE.'), 'the');
});

test('a word made only of punctuation keeps itself', () => {
  assert.equal(wordKey('...'), '...');
  assert.equal(wordKey('--'), '--');
});

test('a word and its sentence ending share one entry', () => {
  let profile = recordRun(blankProfile(), runOf([{ word: 'end.', clean: false, misses: 1 }]));
  profile = recordRun(profile, runOf([{ word: 'end', clean: false, misses: 1 }]));

  assert.deepEqual(Object.keys(profile.words), ['end']);
  assert.equal(profile.words.end.seen, 2);
  assert.equal(profile.words.end.misses, 2);
  assert.equal(profile.words.end.heat, 1);
});

test('problem words carry no trailing period', () => {
  const profile = recordRun(
    blankProfile(),
    runOf([
      { word: 'glasses.', clean: false, misses: 2 },
      { word: 'time,', clean: false, misses: 1 },
    ]),
  );

  const listed = problemWords(profile).map((entry) => entry.word);
  assert.ok(listed.includes('glasses'), `got ${listed.join(', ')}`);
  assert.ok(!listed.some((word) => word.endsWith('.')));
});

test('the run history records words without their periods', () => {
  const profile = recordRun(blankProfile(), runOf([{ word: 'end.', clean: false, misses: 1 }]));
  assert.deepEqual(profile.runs[0].drilledWords, ['end']);
});

function paced(word, ms) {
  return runOf([{ word, clean: true, misses: 0, ms }]);
}

test('a clean word records a pace in ms per character', () => {
  const profile = recordRun(blankProfile(), paced('hand', 400));
  assert.equal(profile.words.hand.pace, 100);
});

test('pace follows recent typing rather than averaging everything', () => {
  let profile = recordRun(blankProfile(), paced('hand', 1200));
  assert.equal(profile.words.hand.pace, 300);

  for (let n = 0; n < 8; n += 1) profile = recordRun(profile, paced('hand', 400));
  assert.ok(profile.words.hand.pace < 130, `pace stuck at ${profile.words.hand.pace}`);
});

test('a drilled word contributes no pace', () => {
  const profile = recordRun(
    blankProfile(),
    runOf([{ word: 'hand', clean: false, misses: 1, ms: null }]),
  );
  assert.equal(profile.words.hand.pace, null);
});

test('an absurd pace is thrown away rather than recorded', () => {
  let profile = recordRun(blankProfile(), paced('hand', 400));
  profile = recordRun(profile, paced('hand', 900000));
  assert.equal(profile.words.hand.pace, 100);
});

function withPaces(entries) {
  let profile = blankProfile();
  for (const [word, ms] of entries) profile = recordRun(profile, paced(word, ms));
  return profile;
}

function brisk(count) {
  return Array.from({ length: count }, (_, i) => [`w${i}a`, 300]);
}

test('slow words are the ones above your own median', () => {
  const profile = withPaces([...brisk(14), ['zzz', 1500]]);

  assert.deepEqual(
    slowWords(profile).map((entry) => entry.word),
    ['zzz'],
  );
});

test('a slow word reports the speed it was typed at', () => {
  const profile = withPaces([...brisk(14), ['zzz', 1800]]);

  const [slowest] = slowWords(profile);
  assert.equal(slowest.word, 'zzz');
  assert.equal(slowest.pace, 600);
  assert.equal(slowest.wpm, 20);
});

test('a handful of timings is not enough to call anything slow', () => {
  const profile = withPaces([['aaa', 300], ['bbb', 1800], ['ccc', 300]]);

  assert.equal(medianPace(profile), null, 'three samples should not yield a median');
  assert.deepEqual(slowWords(profile), []);
});

test('with nothing timed there is no median and no slow list', () => {
  assert.equal(medianPace(blankProfile()), null);
  assert.deepEqual(slowWords(blankProfile()), []);
});

test('I and its contractions are tracked in lowercase and shown with a capital', () => {
  assert.equal(wordKey('I'), 'i');
  assert.equal(wordKey("I'm"), "i'm");
  assert.equal(displayKey('i'), 'I');
  assert.equal(displayKey("i'm"), "I'm");
  assert.equal(displayKey("i'll"), "I'll");
});

test('other words that begin with i are shown as they are', () => {
  for (const key of ['in', 'is', "isn't", 'idea', 'it']) assert.equal(displayKey(key), key);
});

test('a missed I contraction is stored under its key and listed with its capital', () => {
  const profile = recordRun(blankProfile(), runOf([{ word: "I'm", clean: false, misses: 1 }]));

  assert.ok(profile.words["i'm"], 'nothing was stored under the lowercase key');
  assert.equal(profile.words["I'm"], undefined, 'the display form leaked into storage');
  assert.deepEqual(profile.runs[0].drilledWords, ["i'm"]);
  assert.deepEqual(problemWords(profile).map((entry) => entry.word), ["I'm"]);
});

test('a slow I contraction is listed with its capital too', () => {
  const profile = withPaces([...brisk(14), ["I'm", 1800]]);
  assert.deepEqual(slowWords(profile).map((entry) => entry.word), ["I'm"]);
});
