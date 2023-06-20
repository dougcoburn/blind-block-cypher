import { describe, expect, it } from "vitest";

import * as mod from "./index";

describe("index", () => {
  it("permutation", () => {
    expect(mod.permutation(3, 0)).toStrictEqual([0, 1, 2]);
    expect(mod.permutation(3, 5)).toStrictEqual([2, 1, 0]);
  });
});
