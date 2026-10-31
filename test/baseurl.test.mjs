// Every client reads where the API lives from the environment, each in its own
// way: axios on its instance, fetch and Angular's HttpClient through the `baseUrl`
// their client.ts exports, api-client by itself. The written code is bundled the
// way Vite does it (`import.meta.env.VITE_API_URL` replaced by its value) and run.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { resolveOptions } from "../dist/config.js";
import { runtimeFiles } from "../dist/runtime/index.js";
import { root } from "./harness.mjs";

/** Bundles the written `client.ts` of `http` with `VITE_API_URL` set to `value`, and prints `expression`. */
async function read(http, value, expression, env = "VITE_API_URL") {
  const { build } = await import("esbuild");
  const dir = await mkdtemp(join(tmpdir(), "forge-env-"));
  const options = resolveOptions({ http, library: http === "angular" ? "angular-query" : "react-query", target: "requests", baseUrlEnv: env });
  await writeFile(join(dir, "client.ts"), runtimeFiles(options).get("client.ts"));
  await build({
    entryPoints: [join(dir, "client.ts")],
    outfile: join(dir, "client.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    nodePaths: [join(root, "node_modules")],
    logLevel: "silent",
    define: { [`import.meta.env.${env}`]: value === undefined ? "undefined" : JSON.stringify(value) },
    // Some dependencies (axios) are CommonJS and call require.
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  });
  await writeFile(
    join(dir, "run.mjs"),
    `import * as client from "./client.mjs"; console.log(JSON.stringify(${expression}));`,
  );
  return JSON.parse(execFileSync(process.execPath, [join(dir, "run.mjs")], { encoding: "utf8" }));
}

test("fetch and Angular start every call from the base URL in the environment", async () => {
  for (const http of ["fetch", "angular"]) {
    assert.equal(await read(http, "https://api.test/v1", "client.baseUrl"), "https://api.test/v1", http);
    // Nothing set: empty, and the call starts from the page's own origin.
    assert.equal(await read(http, undefined, "client.baseUrl"), "", http);
  }
});

test("axios builds its instance on the base URL in the environment", async () => {
  assert.equal(await read("axios", "https://api.test/v1", "client.http.defaults.baseURL"), "https://api.test/v1");
});

test("the variable is named by baseUrlEnv; api-client ignores it and finds its own", async () => {
  for (const http of ["axios", "fetch"]) {
    const expression = http === "axios" ? "client.http.defaults.baseURL" : "client.baseUrl";
    assert.equal(await read(http, "https://api.test/v1", expression, "VITE_SAHRA_URL"), "https://api.test/v1", http);
  }
  const written = (http) => runtimeFiles(resolveOptions({ http, baseUrlEnv: "VITE_SAHRA_URL", target: "requests" })).get("client.ts");
  assert.match(written("axios"), /import\.meta\.env\.VITE_SAHRA_URL/);
  assert.doesNotMatch(written("api-client"), /SAHRA|import\.meta/);
  assert.throws(() => resolveOptions({ baseUrlEnv: "not a name" }), /baseUrlEnv must be the name of an environment variable/);
});
