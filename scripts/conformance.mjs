// Runs every document of the public @readme/oas-examples corpus (Swagger 2.0,
// OpenAPI 3.0 and 3.1) through the generator and type-checks what it wrote,
// strictly. `npm run conformance`; `-- --keep` leaves the output to inspect.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveOptions } from "../src/config.mjs";
import { generate } from "../src/generate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpus = dirname(
  createRequire(import.meta.url).resolve("@readme/oas-examples/package.json"),
);
const out = join(root, ".conformance");
const tsc = join(root, "node_modules/.bin/tsc");
const quiet = (fn) => {
  const { log, warn } = console;
  console.log = console.warn = () => {};
  return fn().finally(() => Object.assign(console, { log, warn }));
};

rmSync(out, { recursive: true, force: true });
const failures = [];
let total = 0;

for (const version of ["2.0", "3.0", "3.1"]) {
  const dir = join(corpus, version, "json");
  for (const file of readdirSync(dir).filter((name) =>
    name.endsWith(".json"),
  )) {
    total += 1;
    const name = `${version}_${file.replace(".json", "")}`;
    const target = join(out, name);
    mkdirSync(target, { recursive: true });
    try {
      await quiet(() =>
        generate(
          resolveOptions({
            input: join(dir, file),
            out: target,
            zod: true,
            infinite: true,
            format: false,
          }),
          { cwd: root },
        ),
      );
      execFileSync(
        tsc,
        [
          "--ignoreConfig",
          "--noEmit",
          "--skipLibCheck",
          "--strict",
          "--target",
          "es2022",
          "--module",
          "esnext",
          "--moduleResolution",
          "bundler",
          "--lib",
          "es2023,dom",
          ...readdirSync(target)
            .filter((item) => item.endsWith(".ts"))
            .map((item) => join(target, item)),
        ],
        { stdio: "pipe" },
      );
    } catch (error) {
      const text =
        String(error.stdout ?? error.message)
          .split("\n")
          .find((line) => /error/.test(line)) ?? error.message;
      failures.push(`${name}: ${text.slice(0, 160)}`);
    }
  }
}

if (!process.argv.includes("--keep"))
  rmSync(out, { recursive: true, force: true });
console.log(
  `conformance: ${total - failures.length}/${total} documents generate and type-check`,
);
for (const line of failures) console.error(`  ✖ ${line}`);
process.exitCode = failures.length ? 1 : 0;
