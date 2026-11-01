import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { FIXTURE } from "./helpers.mjs";

const BIN = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

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
  assert.match(await readFile(join(dir, "api", "client.ts"), "utf8"), /apiClient/);
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

test("init writes a starter config once, and the run reads it back", async () => {
  const dir = await project();
  assert.equal(forge(dir, "init").status, 0);
  assert.match(await readFile(join(dir, "openapi-forge.config.yaml"), "utf8"), /^input: openapi\.json$/m);
  assert.equal(forge(dir, "init").status, 1);
  assert.equal(forge(dir, "--input", "openapi.yaml", "--out", "api", "--raw").status, 0);
});

const DATA = (out) => `input: openapi.yaml\nout: ${out}\nformat: false\n`;
const JSON_DATA = (out) => JSON.stringify({ input: "openapi.yaml", out, format: false });

test("a YAML, JSON or rc config is read, in every spelling", async () => {
  const cases = {
    "openapi-forge.config.yaml": DATA,
    "openapi-forge.config.yml": DATA,
    "openapi-forge.config.json": JSON_DATA,
    ".openapi-forgerc": DATA,
    ".openapi-forgerc.yaml": DATA,
    ".openapi-forgerc.yml": DATA,
    ".openapi-forgerc.json": JSON_DATA,
  };
  for (const [name, body] of Object.entries(cases)) {
    const dir = await project();
    await writeFile(join(dir, name), body("from-config"));
    assert.equal(forge(dir).status, 0, name);
    assert.ok(await readFile(join(dir, "from-config", "pets.ts"), "utf8"), name);
  }
});

test("an rc file may hold JSON, because JSON is valid YAML", async () => {
  const dir = await project();
  await writeFile(join(dir, ".openapi-forgerc"), JSON_DATA("from-rc"));
  assert.equal(forge(dir).status, 0);
  assert.ok(await readFile(join(dir, "from-rc", "pets.ts"), "utf8"));
});

test("the data formats win over a script when both exist", async () => {
  const dir = await project();
  await writeFile(join(dir, "openapi-forge.config.yaml"), DATA("from-yaml"));
  await writeFile(join(dir, "openapi-forge.config.mjs"), 'export default { input: "openapi.yaml", out: "from-script", format: false };\n');
  assert.equal(forge(dir).status, 0);
  assert.ok(await readFile(join(dir, "from-yaml", "pets.ts"), "utf8"));
});

test("a config with a comment and a nested map reads as the options it says", async () => {
  const dir = await project();
  await writeFile(
    join(dir, "openapi-forge.config.yaml"),
    "# where the document is\ninput: openapi.yaml\nout: nested\nformat: false\ntags:\n  exclude: [nothing]\n",
  );
  assert.equal(forge(dir).status, 0);
  assert.ok(await readFile(join(dir, "nested", "pets.ts"), "utf8"));
});

test("an unknown option is an error that names the file and lists the options", async () => {
  const dir = await project();
  await writeFile(join(dir, "openapi-forge.config.yaml"), "input: openapi.yaml\nlibary: swr\n");
  const r = forge(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown option "libary" in .*openapi-forge\.config\.yaml \(options: input, out, apiPrefix,/);
});

test("transform cannot be written in a data file, and the error says where it can", async () => {
  const dir = await project();
  await writeFile(join(dir, "openapi-forge.config.yaml"), "input: openapi.yaml\ntransform:\n  fileName: x\n");
  const r = forge(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /"transform" takes functions, which .*openapi-forge\.config\.yaml cannot hold; put it in openapi-forge\.config\.mjs/);
});

test("invalid YAML or JSON, and a config that is not a mapping, name the file", async () => {
  const bad = { "openapi-forge.config.yaml": ["input: [a\n", /openapi-forge\.config\.yaml is not valid YAML/], "openapi-forge.config.json": ["{ bad", /openapi-forge\.config\.json is not valid JSON/], ".openapi-forgerc": ["- a\n- b\n", /\.openapi-forgerc must hold a mapping of options/] };
  for (const [name, [content, pattern]] of Object.entries(bad)) {
    const dir = await project();
    await writeFile(join(dir, name), content);
    const r = forge(dir);
    assert.equal(r.status, 1, name);
    assert.match(r.stderr, pattern, name);
  }
});

test("a script config still works, and a transform in it is called", async () => {
  const dir = await project();
  await writeFile(
    join(dir, "openapi-forge.config.mjs"),
    'export default { input: "openapi.yaml", out: "from-script", format: false, transform: { fileName: (tag) => tag.toLowerCase() + "-api" } };\n',
  );
  assert.equal(forge(dir).status, 0);
  assert.ok(await readFile(join(dir, "from-script", "pets-api.ts"), "utf8"));
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
  assert.match(await readFile(join(dir, "api", "ping.ts"), "utf8"), /apiClient/);
  assert.match(await readFile(join(dir, "api", "services.ts"), "utf8"), /"other"/);
});

test("the module of a tag the document dropped is removed, and --check names it", async () => {
  const dir = await project();
  const args = ["--input", "openapi.yaml", "--out", "api", "--raw"];
  forge(dir, ...args);
  const { stat } = await import("node:fs/promises");
  const doc = (await readFile(join(dir, "openapi.yaml"), "utf8")).replace(/tags:\s*\[Owners\]/g, "tags: [Pets]");
  assert.equal(await stat(join(dir, "api", "owners.ts")).then(() => true, () => false), true);
  await writeFile(join(dir, "openapi.yaml"), doc);
  await writeFile(join(dir, "api", "mine.ts"), "// written by a person\n");

  const check = forge(dir, ...args, "--check");
  assert.equal(check.status, 1);
  assert.match(check.stderr, /owners\.ts/);

  assert.equal(forge(dir, ...args).status, 0);
  assert.equal(await stat(join(dir, "api", "owners.ts")).then(() => true, () => false), false);
  assert.equal(await readFile(join(dir, "api", "mine.ts"), "utf8"), "// written by a person\n");
  assert.equal(await stat(join(dir, "api", "client.ts")).then(() => true, () => false), true);
});

test(".env.local and .env are read; the shell wins over both, .env.local over .env", async () => {
  const dir = await project();
  await writeFile(join(dir, ".env"), "OPENAPI_FORGE_INPUT=missing.yaml\nOPENAPI_FORGE_INSECURE=\n");
  await writeFile(join(dir, ".env.local"), "OPENAPI_FORGE_INPUT=openapi.yaml\n");
  const own = forge(dir, "--out", "api", "--raw");
  assert.equal(own.status, 0, own.stderr);
  assert.ok(await readFile(join(dir, "api", "pets.ts"), "utf8"));
  const shell = spawnSync(process.execPath, [BIN, "--out", "api2", "--raw"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, OPENAPI_FORGE_INPUT: "nope.yaml" },
  });
  assert.equal(shell.status, 1, "the shell's value is used, not the file's");
});
