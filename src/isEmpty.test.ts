import { describe, expect, it } from "vitest";

import isEmpty from "./isEmpty";

describe("combinations", () => {
  it("now it is empty", () => {
    expect(isEmpty([])).toBe(true);
  });
  it("now it is not empty", () => {
    expect(isEmpty([1])).toBe(false);
  });
});
