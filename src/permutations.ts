import isEmpty from "./isEmpty";

export default function* permutations(a: unknown[]): Generator<unknown[]> {
  yield* permutationsRecursive(a, []);
}

function* permutationsRecursive(
  a: unknown[],
  r: unknown[]
): Generator<unknown[]> {
  // base case, stop recursion when a is empty, value of r is next permutation
  if (isEmpty(a)) {
    yield r;
  }

  for (let i = 0; i < a.length; i += 1) {
    // make a copy of a that we can mutate without affecting the caller
    const aa = [...a];
    // of the remaining elements of a, pick each to be the next element of the permutation
    // splice will return 1 element and remove it from aa
    const rr = [...r, ...aa.splice(i, 1)];
    // do it again until aa is empty and all elements are in rr
    yield* permutationsRecursive(aa, rr);
  }
}
