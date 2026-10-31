// Every client reads where the API lives from the environment: axios, fetch and
// Angular's HttpClient through the `client.ts` they are written with, api-client
// on its own. The reader is the written code itself, run with the variable set.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { resolveOptions } from "../dist/config.js";
import { runtimeFiles } from "../dist/runtime/index.js";
import { root } from "./harness.mjs";

/** Bundles the written `client.ts` of `http` and prints what it reads from `env`. */
async function read(http, env, expression) {
  const { build } = await import("esbuild");
  const dir = await mkdtemp(join(tmpdir(), "forge-env-"));
  const options = resolveOptions({ http, library: http === "angular" ? "angular-query" : "react-query", target: "requests" });
  await writeFile(join(dir, "client.ts"), runtimeFiles(options).get("client.ts"));
  await build({
    entryPoints: [join(dir, "client.ts")],
    outfile: join(dir, "client.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    nodePaths: [join(root, "node_modules")],
    logLevel: "silent",
    // Some dependencies (axios) are CommonJS and call require.
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  });
  await writeFile(
    join(dir, "run.mjs"),
    `import * as client from "./client.mjs"; console.log(JSON.stringify(${expression}));`,
  );
  return JSON.parse(
    execFileSync(process.execPath, [join(dir, "run.mjs")], {
      env: { PATH: process.env.PATH, ...env },
      encoding: "utf8",
    }),
  );
}

test("fetch and Angular read their base URL from the environment", async () => {
  for (const http of ["fetch", "angular"]) {
    assert.equal(await read(http, { VITE_API_URL: "https://api.test/v1" }, "client.baseUrl"), "https://api.test/v1", http);
    assert.equal(await read(http, { API_BASE_URL: "https://other.test" }, "client.baseUrl"), "https://other.test", http);
    // Nothing set: empty, and the call starts from the page's own origin.
    assert.equal(await read(http, {}, "client.baseUrl"), "", http);
  }
});

test("axios builds its instance on the base URL from the environment", async () => {
  assert.equal(
    await read("axios", { VITE_API_URL: "https://api.test/v1" }, "client.http.defaults.baseURL"),
    "https://api.test/v1",
  );
  assert.equal(await read("axios", {}, "client.http.defaults.baseURL ?? ''"), "");
});
