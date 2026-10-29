import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const BIN = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const run = promisify(execFile);

const swagger = (type) =>
  JSON.stringify({
    swagger: "2.0",
    info: { title: "t", version: "1" },
    paths: {
      "/pets": {
        get: {
          operationId: "listPets",
          responses: { 200: { description: "ok", schema: { $ref: "#/definitions/Pet" } } },
        },
      },
    },
    definitions: { Pet: { type: "object", properties: { id: { type } } } },
  });

async function served(body) {
  const server = createServer((_, response) => {
    response.setHeader("content-type", "application/json");
    response.end(body.current);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { server, url: `http://127.0.0.1:${server.address().port}/openapi.json` };
}

test("pull reports what changed in a Swagger 2.0 document, and keeps one copy per service", async () => {
  const body = { current: swagger("string") };
  const { server, url } = await served(body);
  try {
    const dir = await mkdtemp(join(tmpdir(), "forge-pull-"));
    const pull = (...extra) =>
      run(process.execPath, [BIN, "pull", "--no-pull", "--raw", ...extra], {
        cwd: dir,
        env: { ...process.env, OPENAPI_FORGE_SOURCES: `pets=${url}` },
      });
    assert.match((await pull()).stdout, /pets added/);

    body.current = swagger("integer");
    const second = (await pull()).stdout;
    assert.match(second, /pets updated/);
    assert.match(second, /`id`: string → integer/);

    // The service now answers YAML: the old JSON document must not stay behind.
    await writeFile(join(dir, "openapi-specs", "pets.yaml"), "stale: true\n");
    body.current = swagger("integer");
    await pull();
    assert.deepEqual((await readdir(join(dir, "openapi-specs"))).sort(), ["pets.json"]);
    assert.equal(JSON.parse(await readFile(join(dir, "openapi-specs", "pets.json"), "utf8")).swagger, "2.0");
  } finally {
    server.close();
  }
});
