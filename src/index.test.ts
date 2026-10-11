import { describe, expect, it } from "vitest";

import * as mod from "./index";

describe("index", () => {
  it("permutation", () => {
    expect(mod.permutation(3, 0)).toStrictEqual([0, 1, 2]);
    expect(mod.permutation(3, 5)).toStrictEqual([2, 1, 0]);
  });

  it("exports the id96 API", () => {
    expect(typeof mod.createIdGenerator).toBe("function");
    expect(typeof mod.createFeistel96).toBe("function");
    expect(typeof mod.encryptBlock).toBe("function");
    expect(typeof mod.decryptBlock).toBe("function");
    expect(typeof mod.deriveRoundKeys).toBe("function");
    expect(mod.ID96_ROUNDS).toBe(20);
    expect(new mod.InvalidIdError("x")).toBeInstanceOf(Error);
  });

  it("keeps the u32 API unchanged", () => {
    expect(mod.RECOMMENDED_ROUNDS).toBe(8);
    expect(typeof mod.expandKey).toBe("function");
  });
});
