import { describe, expect, it } from "vitest";

import combinations from "./combinations";

describe("combinations", () => {
  it("gets all 3 choose 2", () => {
    expect([...combinations([1, 2, 3], 2)]).toStrictEqual([
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
  });
});
