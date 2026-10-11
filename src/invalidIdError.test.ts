import { describe, expect, it, vi } from "vitest";

import { InvalidIdError } from "./encoding";

const BRAND = Symbol.for("blind-block-cypher.InvalidIdError");

class SubError extends InvalidIdError {}

describe("InvalidIdError brand", () => {
  it("names itself and carries a non-enumerable brand", () => {
    const err = new InvalidIdError("x");
    expect(err.name).toBe("InvalidIdError");
    expect(err.message).toBe("x");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InvalidIdError);
    expect((err as unknown as Record<symbol, unknown>)[BRAND]).toBe(true);
    expect(Object.keys(err)).not.toContain(BRAND);
    expect(Object.getOwnPropertyDescriptor(err, BRAND)?.enumerable).toBe(false);
  });

  it("matches an instance from a separate copy of the module", async () => {
    vi.resetModules();
    const other = await import("./encoding");
    expect(other.InvalidIdError).not.toBe(InvalidIdError);
    const foreign = new other.InvalidIdError("y");
    expect(Object.getPrototypeOf(foreign)).not.toBe(InvalidIdError.prototype);
    expect(foreign instanceof InvalidIdError).toBe(true);
    expect(new InvalidIdError("z") instanceof other.InvalidIdError).toBe(true);
  });

  it("matches any object carrying the brand, and nothing else", () => {
    expect({ [BRAND]: true } instanceof InvalidIdError).toBe(true);
    expect({ [BRAND]: "yes" } instanceof InvalidIdError).toBe(false);
    expect({} instanceof InvalidIdError).toBe(false);
    expect(new Error("e") instanceof InvalidIdError).toBe(false);
    expect(new RangeError("e") instanceof InvalidIdError).toBe(false);
    for (const v of [null, undefined, "InvalidIdError", 1, BRAND]) {
      expect((v as unknown as object) instanceof InvalidIdError).toBe(false);
    }
  });

  it("keeps prototype semantics for subclasses", () => {
    const sub = new SubError("s");
    expect(sub.name).toBe("InvalidIdError");
    expect(sub instanceof SubError).toBe(true);
    expect(sub instanceof InvalidIdError).toBe(true);
    expect(new InvalidIdError("p") instanceof SubError).toBe(false);
    expect({ [BRAND]: true } instanceof SubError).toBe(false);
  });
});
