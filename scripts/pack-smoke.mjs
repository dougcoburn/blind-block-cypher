// Pack smoke test: packs the built package, installs the tarball into a
// throwaway project, then loads it through both require() and import() in a
// single Node process. Run after `pnpm run build` (see the `ci` script).
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const work = mkdtempSync(join(tmpdir(), "bbc-pack-smoke-"));
const failures = [];
const warnings = [];

function check(condition, message) {
  if (condition) {
    console.log(`ok   ${message}`);
  } else {
    console.log(`FAIL ${message}`);
    failures.push(message);
  }
}

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

// Throws InvalidIdError (or whatever the build throws) by decoding a bad ID.
function triggerBadDecode(mod) {
  const attempts = [
    () => mod.createIdGenerator("pack-smoke-key").decode("!"),
    () => mod.decodeBase64url("!", { bits: 96 }),
    () => mod.decodeBase64url("!", 96),
  ];
  for (const attempt of attempts) {
    try {
      attempt();
    } catch (error) {
      if (
        error instanceof TypeError &&
        /is not a function/.test(error.message)
      ) {
        continue;
      }

      return error;
    }
  }

  return undefined;
}

try {
  // 1. Pack.
  const packDir = join(work, "pack");
  mkdirSync(packDir);
  const packed = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", packDir], root)
  );
  const tarball = join(packDir, packed[0].filename);
  const files = packed[0].files.map((f) => f.path);
  console.log(`packed ${packed[0].filename}: ${files.join(", ")}`);
  check(files.includes("LICENSE"), "tarball contains LICENSE");
  for (const f of [
    "dist/index.js",
    "dist/index.mjs",
    "dist/index.d.ts",
    "dist/index.d.mts",
  ]) {
    check(files.includes(f), `tarball contains ${f}`);
  }

  // 2. Install into a throwaway project.
  const app = join(work, "app");
  mkdirSync(app);
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({ name: "pack-smoke-app", private: true, version: "0.0.0" })
  );
  run(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      "--no-package-lock",
      tarball,
    ],
    app
  );
  const installed = join(app, "node_modules", pkg.name);

  // 3. Public types must not mention Node's Buffer.
  // TODO(0.2.0): make this a failure once PR1/PR2 remove Buffer from public types.
  for (const f of readdirSync(join(installed, "dist")).filter((n) =>
    /\.d\.m?ts$/.test(n)
  )) {
    if (/\bBuffer\b/.test(readFileSync(join(installed, "dist", f), "utf8"))) {
      warnings.push(`dist/${f} mentions Buffer in public types`);
    }
  }

  // 4. require() and import() in one process.
  const appRequire = createRequire(join(app, "index.js"));
  const cjsPath = appRequire.resolve(pkg.name);
  check(
    cjsPath.endsWith(`${sep}dist${sep}index.js`),
    `require resolves to dist/index.js (${cjsPath})`
  );
  const cjs = appRequire(pkg.name);

  const esmEntry = pathToFileURL(join(installed, "dist", "index.mjs")).href;
  writeFileSync(
    join(app, "load.mjs"),
    `export * as mod from "${pkg.name}";\nexport const url = import.meta.resolve("${pkg.name}");\n`
  );
  const loaded = await import(pathToFileURL(join(app, "load.mjs")).href);
  check(
    loaded.url === esmEntry,
    `import resolves to dist/index.mjs (${loaded.url})`
  );
  const esm = loaded.mod;

  check(
    typeof cjs.createIdGenerator === "function",
    "CJS build exports createIdGenerator"
  );
  check(
    typeof esm.createIdGenerator === "function",
    "ESM build exports createIdGenerator"
  );
  check(
    cjs !== esm && cjs.createIdGenerator !== esm.createIdGenerator,
    "CJS and ESM are separate module instances"
  );

  // 5. Dual package: an error from one build is instanceof the other's class.
  if (
    typeof cjs.InvalidIdError === "function" &&
    typeof esm.InvalidIdError === "function"
  ) {
    const cjsErr = triggerBadDecode(cjs);
    const esmErr = triggerBadDecode(esm);
    check(
      cjsErr instanceof cjs.InvalidIdError,
      "CJS bad decode throws CJS InvalidIdError"
    );
    check(
      esmErr instanceof esm.InvalidIdError,
      "ESM bad decode throws ESM InvalidIdError"
    );
    check(
      cjsErr?.name === "InvalidIdError" && esmErr?.name === "InvalidIdError",
      "err.name is InvalidIdError in both builds"
    );
    check(
      cjsErr instanceof esm.InvalidIdError,
      "CJS error is instanceof ESM InvalidIdError"
    );
    check(
      esmErr instanceof cjs.InvalidIdError,
      "ESM error is instanceof CJS InvalidIdError"
    );
  } else {
    warnings.push(
      "InvalidIdError is not exported from both builds; instanceof check skipped"
    );
  }
} finally {
  rmSync(work, { force: true, recursive: true });
}

for (const w of warnings) {
  console.log(`WARN ${w}`);
}

if (failures.length > 0) {
  throw new Error(`pack smoke test failed: ${failures.length} check(s)`);
}

console.log("pack smoke test passed");
