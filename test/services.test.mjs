// A document with several backend services, run against two real servers: an
// operation of a service goes through @mrzr/api-client's own `services` plugin,
// so the client — not the generated call — knows where that service lives.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { compileCjs, generateTo } from "./harness.mjs";
import { clients } from "./helpers.mjs";
import { ok, serve } from "./server.mjs";

test("an operation of a service goes through api-client's services plugin", async () => {
  const main = await serve(() => ok({ id: "main" }));
  const files = await serve(() => ok({ id: "files" }));
  try {
    const doc = clients();
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const operation of Object.values(item)) {
        operation["x-service"] = path.startsWith("/api/v1/pets/") ? "files" : "main";
      }
    }
    const dir0 = await mkdtemp(join(tmpdir(), "forge-services-"));
    const input = join(dir0, "api.json");
    await writeFile(input, JSON.stringify(doc));
    const dir = await generateTo("services", {
      http: "api-client",
      target: "requests",
      input,
      runtime: { services: { baseUrls: { main: main.base, files: files.base } } },
    });
    // The plugin is imported by its sub-path, which only the package's exports map
    // names; the folder is CommonJS, as the repository around it is not.
    await writeFile(join(dir, "ts/package.json"), '{ "type": "commonjs" }');
    const js = compileCjs(dir, ["--module", "node16", "--moduleResolution", "node16"]);
    const require = createRequire(join(dir, "load.cjs"));
    const pets = require(join(js, "pets.js"));
    const { apiClient } = require(join(js, "client.js"));

    assert.equal((await pets.getPet("7")).data.id, "files");
    assert.equal(files.seen.at(-1).url, "/api/v1/pets/7");
    assert.equal(main.seen.length, 0);
    assert.equal((await pets.listPets()).data.id, "main");
    assert.equal(main.seen.at(-1).url, "/api/v1/pets");
    // The client reports a service it was not given.
    assert.throws(() => apiClient.service("fiels"));
  } finally {
    await main.close();
    await files.close();
  }
});
