// The Vue hooks, run for real against a local server: a ref in place of an
// argument must move the query when it changes, and a missing id must wait.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// vue-query only subscribes in a browser.
globalThis.window = globalThis;

import { generate } from "../dist/generate.js";
import { CLIENTS_FIXTURE, options } from "./helpers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, ".conformance", "runtime", "vue");

async function load() {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const source = join(dir, "ts");
  const { log, warn } = console;
  console.log = console.warn = () => {};
  try {
    await generate(
      options({
        input: CLIENTS_FIXTURE,
        out: source,
        library: "vue-query",
        infinite: true,
      }),
      { cwd: root },
    );
  } finally {
    Object.assign(console, { log, warn });
  }
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "--ignoreConfig",
      "--strict",
      "--skipLibCheck",
      "--target",
      "es2022",
      "--module",
      "commonjs",
      "--lib",
      "es2023,dom",
      "--outDir",
      join(dir, "js"),
      ...readdirSync(source)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => join(source, name)),
    ],
    { stdio: "pipe" },
  );
  writeFileSync(join(dir, "js/package.json"), '{ "type": "commonjs" }');
  return createRequire(join(dir, "load.cjs"));
}

async function until(check, what) {
  for (let waited = 0; waited < 3000; waited += 10) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

describe("the vue-query hooks", () => {
  let require;
  let server;
  let asked;
  let vue;
  let app;
  let pets;
  let client;

  const pet = (id) => ({ result: true, data: { id, name: `pet ${id}` } });

  before(async () => {
    require = await load();
    vue = require("vue");
    const { QueryClient, VueQueryPlugin } = require("@tanstack/vue-query");
    asked = [];
    server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      asked.push(`${request.method} ${request.url}`);
      const id = request.url.split("/")[4]?.split("?")[0];
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          request.method === "POST"
            ? {
                result: true,
                data: {
                  id: "new",
                  ...JSON.parse(Buffer.concat(chunks).toString()),
                },
              }
            : request.url.includes("/visits")
              ? { result: true, data: { count: 0, list: [] } }
              : pet(id),
        ),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    require(join(dir, "js/client.js")).configureClient({
      baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    });
    app = vue.createApp({});
    client = new QueryClient();
    app.use(VueQueryPlugin, { queryClient: client });
    pets = require(join(dir, "js/pets.js"));
  });
  after(() => {
    // The client's garbage-collection timers would keep the process alive.
    client.clear();
    return new Promise((resolve) => server.close(resolve));
  });

  const inApp = (fn) => app.runWithContext(fn);

  test("a ref in place of an argument moves the query when it changes", async () => {
    const id = vue.ref("1");
    const query = inApp(() => pets.useGetPetQuery(id));
    await until(() => query.data.value?.id === "1", "pet 1");
    id.value = "2";
    await until(() => query.data.value?.id === "2", "pet 2");
    assert.ok(asked.includes("GET /api/v1/pets/1"));
    assert.ok(asked.includes("GET /api/v1/pets/2"));
  });

  test("a getter works the same way", async () => {
    const id = vue.ref("3");
    const query = inApp(() => pets.useGetPetQuery(() => id.value));
    await until(() => query.data.value?.id === "3", "pet 3");
    id.value = "4";
    await until(() => query.data.value?.id === "4", "pet 4");
  });

  test("a missing id waits instead of asking for /pets/undefined", async () => {
    const id = vue.ref(undefined);
    const before = asked.length;
    const query = inApp(() => pets.useGetPetQuery(id));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(asked.length, before);
    assert.equal(query.fetchStatus.value, "idle");
    id.value = "5";
    await until(() => query.data.value?.id === "5", "pet 5");
  });

  test("a query given as a ref is read again when it changes", async () => {
    const query = vue.ref({ since: "monday" });
    inApp(() => pets.useListVisitsQuery("9", query));
    await until(
      () => asked.includes("GET /api/v1/pets/9/visits?since=monday"),
      "the first visits",
    );
    query.value = { since: "tuesday" };
    await until(
      () => asked.includes("GET /api/v1/pets/9/visits?since=tuesday"),
      "the second visits",
    );
  });

  test("a mutation sends its variables", async () => {
    const mutation = inApp(() => pets.useCreatePetMutation());
    const created = await mutation.mutateAsync({ body: { name: "Rex" } });
    assert.deepEqual(created, { id: "new", name: "Rex" });
    assert.ok(asked.includes("POST /api/v1/pets"));
  });
});
