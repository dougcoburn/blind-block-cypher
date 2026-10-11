const factorial = (fact: number): number =>
  fact ? fact * factorial(fact - 1) : 1;

export default function permutation(
  n: number,
  permutationId: number
): number[] {
  const indexCount = factorial(n);
  permutationId = ((permutationId % indexCount) + indexCount) % indexCount;

  // build it up from the end, only one choice for the last element -- the only one remaining ([0])
  // then 2 choices, then 3, and so on.
  const permutation = [0];
  for (
    let choiceCount = 2, count = n - 1;
    count > 0;
    count -= 1, choiceCount += 1
  ) {
    const choice = permutationId % choiceCount;

    permutation.push(choice);
    for (let i = permutation.length - 2; i >= 0; i -= 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (permutation[i]! >= choice) {
        permutation[i] += 1;
      }
    }

    permutationId = Math.floor(permutationId / choiceCount);
  }

  return permutation.reverse();
}
