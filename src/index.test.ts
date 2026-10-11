import { describe, expect, it } from "vitest";

import * as mod from "./index";

describe("index", () => {
  it("exports the 0.2.0 API", () => {
    expect(Object.keys(mod).sort()).toStrictEqual([
      "CIPHER_ROUNDS",
      "ID96_ROUNDS",
      "InvalidIdError",
      "createCipher",
      "createIdGenerator",
    ]);
    expect(new mod.InvalidIdError("x")).toBeInstanceOf(Error);
    expect(
      mod.createCipher("k").decrypt32(mod.createCipher("k").encrypt32(1))
    ).toBe(1);
  });
});
