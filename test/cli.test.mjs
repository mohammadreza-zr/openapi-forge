import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { FIXTURE } from "./helpers.mjs";

const BIN = fileURLToPath(new URL("../bin/openapi-forge.mjs", import.meta.url));

async function project() {
  const dir = await mkdtemp(join(tmpdir(), "forge-"));
  await cp(FIXTURE, join(dir, "openapi.yaml"));
  return dir;
}
const forge = (cwd, ...args) =>
  spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });

test("generate writes the layer and the built-in runtime", async () => {
  const dir = await project();
  const result = forge(dir, "--input", "openapi.yaml", "--out", "api", "--raw");
  assert.equal(result.status, 0, result.stderr);
  for (const file of ["models.ts", "pets.ts", "client.ts", "hooks.ts", "types.ts"])
    assert.ok((await readFile(join(dir, "api", file), "utf8")).length > 0, file);
});

test("the runtime is written once and never overwritten", async () => {
  const dir = await project();
  forge(dir, "--input", "openapi.yaml", "--out", "api", "--raw");
  await writeFile(join(dir, "api", "client.ts"), "// mine\n");
  forge(dir, "--input", "openapi.yaml", "--out", "api", "--raw");
  assert.equal(await readFile(join(dir, "api", "client.ts"), "utf8"), "// mine\n");
  forge(dir, "--input", "openapi.yaml", "--out", "api", "--raw", "--force-runtime");
  assert.match(await readFile(join(dir, "api", "client.ts"), "utf8"), /apiGet/);
});

test("--check passes on fresh output and fails on stale output", async () => {
  const dir = await project();
  const args = ["--input", "openapi.yaml", "--out", "api", "--raw"];
  forge(dir, ...args);
  assert.equal(forge(dir, ...args, "--check").status, 0);
  await writeFile(join(dir, "api", "pets.ts"), "// edited\n");
  const stale = forge(dir, ...args, "--check");
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /stale — pets\.ts/);
});

test("a config file is read, and the command line wins over it", async () => {
  const dir = await project();
  await writeFile(
    join(dir, "openapi-forge.config.mjs"),
    'export default { input: "openapi.yaml", out: "from-config", format: false };\n',
  );
  assert.equal(forge(dir).status, 0);
  assert.ok(await readFile(join(dir, "from-config", "pets.ts"), "utf8"));
  assert.equal(forge(dir, "--out", "from-cli").status, 0);
  assert.ok(await readFile(join(dir, "from-cli", "pets.ts"), "utf8"));
});

test("init writes a starter config once", async () => {
  const dir = await project();
  assert.equal(forge(dir, "init").status, 0);
  assert.match(await readFile(join(dir, "openapi-forge.config.mjs"), "utf8"), /defineConfig/);
  assert.equal(forge(dir, "init").status, 1);
});

test("a missing input says so", async () => {
  const dir = await project();
  const result = forge(dir, "--input", "nope.yaml");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /input not found/);
});

test("a folder of documents is merged as services", async () => {
  const dir = await project();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dir, "specs"));
  await cp(FIXTURE, join(dir, "specs", "pets.yaml"));
  await writeFile(
    join(dir, "specs", "other.yaml"),
    "openapi: 3.0.3\ninfo: { title: o, version: '1' }\npaths:\n  /api/v1/ping:\n    get:\n      tags: [Ping]\n      operationId: ping\n      responses: { '200': { description: ok } }\n",
  );
  await writeFile(
    join(dir, "openapi-forge.decisions.json"),
    JSON.stringify({ main: "pets", owners: {} }),
  );
  const result = forge(dir, "--input", "specs", "--out", "api", "--api-prefix", "/api/v1", "--raw");
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(join(dir, "api", "ping.ts"), "utf8"), /apiGet/);
  assert.match(await readFile(join(dir, "api", "services.ts"), "utf8"), /"other"/);
});
