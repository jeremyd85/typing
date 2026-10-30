export const HEAT_BOOST = 8;
export const SLOW_BOOST = 3;
export const HEAT_FLOOR = 0.05;
export const SLOW_FLOOR = 0.1;

export function describeNeed(words, median) {
  const heatOf = (key) => words[key]?.heat ?? 0;

  const dragOf = (key) => {
    if (median === null) return 0;
    const pace = words[key]?.pace;
    if (typeof pace !== 'number' || pace <= median) return 0;
    return Math.min(1, pace / median - 1);
  };

  const needOf = (key) => HEAT_BOOST * heatOf(key) + SLOW_BOOST * dragOf(key);

  return { heatOf, dragOf, needOf };
}
