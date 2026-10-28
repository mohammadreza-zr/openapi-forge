// Runs every document of the public @readme/oas-examples corpus (Swagger 2.0,
// OpenAPI 3.0 and 3.1) — and the clients and edges fixtures — through the generator once
// per client, and type-checks what it wrote, strictly: one `tsc` per client over
// every document. `npm run conformance`; `-- --keep` leaves the output to
// inspect; `-- --only vue-query` runs one library.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveOptions } from "../dist/config.js";
import { generate } from "../dist/generate.js";
import { LIBRARY_NAMES } from "../dist/runtime/libraries/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpus = dirname(
  createRequire(import.meta.url).resolve("@readme/oas-examples/package.json"),
);
const out = join(root, ".conformance");
const tsc = join(root, "node_modules/.bin/tsc");
const at = process.argv.indexOf("--only");
const only = at === -1 ? undefined : process.argv[at + 1];
const quiet = (fn) => {
  const { log, warn } = console;
  console.log = console.warn = () => {};
  return fn().finally(() => Object.assign(console, { log, warn }));
};

/** Every client: each library on `fetch`, and each other HTTP client once. */
const variants = [
  ...LIBRARY_NAMES.map((library) => ({ library, http: "fetch" })),
  { library: "react-query", http: "axios" },
  { library: "react-query", http: "api-client" },
  { library: "angular-query", http: "angular" },
].filter((variant) => !only || variant.library === only);

const documents = [
  { name: "clients-fixture", file: join(root, "test/fixtures/clients.yaml") },
  { name: "edges-fixture", file: join(root, "test/fixtures/edges.yaml") },
];
for (const version of ["2.0", "3.0", "3.1"]) {
  const dir = join(corpus, version, "json");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")))
    documents.push({
      name: `${version}_${file.replace(".json", "")}`,
      file: join(dir, file),
    });
}

rmSync(out, { recursive: true, force: true });
const failures = [];
let checked = 0;

for (const { library, http } of variants) {
  const label = `${library}/${http}`;
  const base = join(out, `${library}-${http}`);
  const written = [];
  for (const { name, file } of documents) {
    const target = join(base, name);
    mkdirSync(target, { recursive: true });
    try {
      await quiet(() =>
        generate(
          resolveOptions({
            input: file,
            out: target,
            library,
            http,
            zod: true,
            infinite: true,
            format: false,
          }),
          { cwd: root },
        ),
      );
      written.push(...readdirSync(target).map((item) => join(target, item)));
    } catch (error) {
      failures.push(
        `${label} ${name}: generate — ${String(error.message).slice(0, 140)}`,
      );
    }
  }
  const result = spawnSync(
    tsc,
    [
      "--ignoreConfig",
      "--noEmit",
      "--skipLibCheck",
      "--strict",
      "--noUnusedLocals",
      "--noUnusedParameters",
      "--target",
      "es2022",
      "--module",
      "esnext",
      "--moduleResolution",
      "bundler",
      "--lib",
      "es2023,dom",
      ...written.filter((item) => item.endsWith(".ts")),
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const broken = new Map();
  for (const line of String(result.stdout).split("\n")) {
    const match = line.match(/^(\S+?)\((\d+),\d+\): error (TS\d+: .*)$/);
    if (!match) continue;
    const name = match[1].slice(base.length + 1).split("/")[0];
    if (!broken.has(name))
      broken.set(
        name,
        `${match[1].slice(base.length + 1)}(${match[2]}): ${match[3]}`,
      );
  }
  for (const [name, message] of broken)
    failures.push(`${label} ${name}: ${message.slice(0, 200)}`);
  checked += documents.length;
  console.log(
    `  ${broken.size ? "✖" : "✔"} ${label}: ${documents.length - broken.size}/${documents.length} documents`,
  );
}

if (!process.argv.includes("--keep"))
  rmSync(out, { recursive: true, force: true });
console.log(
  `conformance: ${checked - failures.length}/${checked} (client × document) generate and type-check`,
);
for (const line of failures) console.error(`  ✖ ${line}`);
process.exitCode = failures.length ? 1 : 0;
