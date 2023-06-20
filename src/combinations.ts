function* combinationsRecursive(
  a: unknown[],
  count: number,
  r: unknown[]
): Generator<unknown[]> {
  if (count > 0) {
    count = count - 1;
    for (let i = 0; i < a.length - count; i += 1) {
      const aa = a.slice(i);
      const rr = [...r, ...aa.splice(0, 1)];
      yield* combinationsRecursive(aa, count, rr);
    }
  } else {
    yield r;
  }
}

/**
 * yields all possible ways you can choose <count> elements from a set <a> where order doesn't matter
 * @param a the values to choose from
 * @param count the number of values to choose
 * @yields the next combination
 */
export default function* combinations(
  a: unknown[],
  count: number
): Generator<unknown[]> {
  yield* combinationsRecursive(a, count, []);
}
