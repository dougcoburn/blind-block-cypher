import { createCipher } from "./cipher";
import { InvalidIdError, decodeBase64url, encodeBase64url } from "./encoding";
import {
  type PlainIdGeneratorOptions,
  createPlainIdGenerator,
  unpackId,
} from "./plainGenerator";

export { InvalidIdError } from "./encoding";

const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 60;

export interface IdGeneratorOptions extends PlainIdGeneratorOptions {
  /** Future skew allowed by `strictTime`, in seconds. Default 60. */
  maxFutureSkewSeconds?: number;
  /** Default for `decode`'s `strictTime`. Default false. */
  strictTime?: boolean;
}

export interface DecodeOptions {
  /** Reject IDs more than `maxFutureSkewSeconds` past `now()`. */
  strictTime?: boolean;
}

export interface DecodedId {
  date: Date;
  generatorId: number;
  seconds: number;
  sequence: number;
}

export interface IdGenerator {
  decode(id: string, options?: DecodeOptions): DecodedId;
  decodeTime(id: string): Date;
  generate(): string;
}

/**
 * Create an id96 generator: 16-character base64url IDs. Each ID is
 * `encodeBase64url(createCipher(key).encrypt96(plain.next()), 96)`, where
 * `plain` is {@link createPlainIdGenerator} with the same options, so the
 * plaintext is `seconds:33 | generatorId:10 | sequence:53`. Wire-compatible
 * with 0.1.0 IDs for the same key and epoch.
 */
export function createIdGenerator(
  key: Uint8Array | string,
  options: IdGeneratorOptions = {}
): IdGenerator {
  const cipher = createCipher(key);
  const maxSkew =
    options.maxFutureSkewSeconds ?? DEFAULT_MAX_FUTURE_SKEW_SECONDS;
  if (typeof maxSkew !== "number" || !(maxSkew >= 0)) {
    throw new RangeError("maxFutureSkewSeconds must be a number >= 0");
  }

  const plain = createPlainIdGenerator(options);
  const now = options.now ?? Date.now;
  const strictDefault = options.strictTime ?? false;
  const { epochMs } = plain;

  function decode(id: string, decodeOptions: DecodeOptions = {}): DecodedId {
    const fields = unpackId(cipher.decrypt96(decodeBase64url(id, 96)));
    const ms = epochMs + fields.seconds * 1000;
    if (
      (decodeOptions.strictTime ?? strictDefault) &&
      ms > now() + maxSkew * 1000
    ) {
      throw new InvalidIdError(
        "id time is more than maxFutureSkewSeconds in the future"
      );
    }

    return {
      date: new Date(ms),
      generatorId: fields.generatorId,
      seconds: fields.seconds,
      sequence: fields.sequence,
    };
  }

  return {
    decode,
    decodeTime(id) {
      return decode(id).date;
    },
    generate() {
      return encodeBase64url(cipher.encrypt96(plain.next()), 96);
    },
  };
}
