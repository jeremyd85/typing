export const LAYOUTS = {
  qwerty: {
    label: 'QWERTY',
    split: false,
    rows: [
      { offset: 0, keys: 'qwertyuiop' },
      { offset: 0.25, keys: "asdfghjkl;'" },
      { offset: 0.75, keys: 'zxcvbnm,./' },
    ],
  },
  'colemak-dh': {
    label: 'Colemak-DH',
    split: true,
    rows: [
      { offset: 0, keys: 'qwfpbjluy;' },
      { offset: 0, keys: 'arstgmneio' },
      { offset: 0, keys: 'zxcdvkh,./' },
    ],
  },
};

const REACH = 1.001;
const HALF = 5;

export function buildNeighbours(name) {
  const layout = LAYOUTS[name] ?? LAYOUTS.qwerty;

  const keys = layout.rows.flatMap((row, index) =>
    [...row.keys].map((key, column) => ({
      key,
      row: index,
      x: column + row.offset,
      hand: column < HALF ? 'left' : 'right',
    })),
  );

  const map = {};
  for (const key of keys) {
    map[key.key] = keys
      .filter(
        (other) =>
          other.key !== key.key &&
          Math.abs(other.row - key.row) <= 1 &&
          Math.abs(other.x - key.x) <= REACH &&
          (!layout.split || other.hand === key.hand),
      )
      .map((other) => other.key)
      .join('');
  }
  return map;
}
