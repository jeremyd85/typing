import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUTS, buildNeighbours } from '../js/layouts.js';

test('colemak-dh matches the published matrix layout', () => {
  assert.deepEqual(
    LAYOUTS['colemak-dh'].rows.map((row) => row.keys),
    ['qwfpbjluy;', 'arstgmneio', 'zxcdvkh,./'],
  );
});

test('adjacency is symmetric in both layouts', () => {
  for (const name of Object.keys(LAYOUTS)) {
    const map = buildNeighbours(name);
    for (const [key, near] of Object.entries(map)) {
      for (const other of near) {
        assert.ok(map[other].includes(key), `${name}: ${key} reaches ${other} but not back`);
      }
    }
  }
});

test('no key is its own neighbour', () => {
  for (const name of Object.keys(LAYOUTS)) {
    const map = buildNeighbours(name);
    for (const [key, near] of Object.entries(map)) {
      assert.ok(!near.includes(key), `${name}: ${key} neighbours itself`);
    }
  }
});

test('a split board never reaches across the hands', () => {
  const map = buildNeighbours('colemak-dh');
  const left = new Set('qwfpbarstgzxcdv');
  for (const [key, near] of Object.entries(map)) {
    const sameHand = [...near].every((other) => left.has(other) === left.has(key));
    assert.ok(sameHand, `${key} reached the other half: ${near}`);
  }
});

test('a row staggered board does join the hands', () => {
  const map = buildNeighbours('qwerty');
  assert.ok(map.g.includes('h'));
  assert.ok(map.t.includes('y'));
});

test('home row keys reach their own row neighbours', () => {
  const colemak = buildNeighbours('colemak-dh');
  assert.ok(colemak.s.includes('r') && colemak.s.includes('t'));
  assert.ok(colemak.n.includes('m') && colemak.n.includes('e'));
});

test('an unknown layout falls back rather than throwing', () => {
  assert.deepEqual(buildNeighbours('dvorak'), buildNeighbours('qwerty'));
});
