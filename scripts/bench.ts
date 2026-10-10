// Measures id96 throughput at the fixed 20 rounds. Not part of CI.
// Usage: pnpm run bench
import { ID96_ROUNDS, createIdGenerator } from "../src/index";

const DURATION_MS = Number(process.env.BENCH_MS ?? 3000);
const WARMUP = 5000;

const ids = createIdGenerator("bench-key-not-for-production-0123456789");

for (let i = 0; i < WARMUP; i += 1) {
  ids.generate();
}

function run(label: string, fn: () => void): void {
  let count = 0;
  const start = process.hrtime.bigint();
  const end = start + BigInt(DURATION_MS) * BigInt(1_000_000);
  let now = start;
  while (now < end) {
    for (let i = 0; i < 1000; i += 1) {
      fn();
    }

    count += 1000;
    now = process.hrtime.bigint();
  }

  const seconds = Number(now - start) / 1e9;
  const rate = Math.round(count / seconds);
  console.log(
    `${label}: ${rate.toLocaleString("en-US")} ops/sec (${count.toLocaleString(
      "en-US"
    )} in ${seconds.toFixed(2)}s, ${ID96_ROUNDS} rounds, node ${
      process.version
    })`
  );
}

const sample = ids.generate();
run("generate", () => ids.generate());
run("decode", () => ids.decode(sample));
