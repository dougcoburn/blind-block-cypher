import { describe, expect, it } from "vitest";

import permutations from "./permutations";

describe("permutations", () => {
  it("now it is empty", () => {
    expect([...permutations([1, 2, 3])]).toStrictEqual([
      [1, 2, 3],
      [1, 3, 2],
      [2, 1, 3],
      [2, 3, 1],
      [3, 1, 2],
      [3, 2, 1],
    ]);
  });
  it("now it is empty", () => {
    expect([...permutations([])]).toStrictEqual([[]]);
  });
});
