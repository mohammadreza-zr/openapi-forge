// The Vue hooks, run for real against a local server: a ref in place of an
// argument must move the query when it changes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

// vue-query only subscribes in a browser. (Garbage collection is off below:
// its timers would keep the process alive.)
globalThis.window = globalThis;

import { compileCjs, generateTo, sleep, until } from "./harness.mjs";
import { clientOf, payloadOf, pointClient } from "./probes/point.cjs";
import { petApi, serve } from "./server.mjs";

for (const http of ["axios", "api-client"]) describe(`the vue-query hooks over ${http}`, () => {
  let server;
  let vue;
  let app;
  let pets;
  let client;

  before(async () => {
    const dir = await generateTo(`vue-${http}`, {
      library: "vue-query",
      http,
      infinite: true,
    });
    const js = compileCjs(dir);
    const require = createRequire(join(dir, "load.cjs"));
    vue = require("vue");
    const { QueryClient, VueQueryPlugin } = require("@tanstack/vue-query");
    server = await serve(petApi);
    pointClient(http, clientOf(require, join(js, "client.js")), require, server.base);
    app = vue.createApp({});
    client = new QueryClient({
      defaultOptions: { queries: { gcTime: 0 }, mutations: { gcTime: 0 } },
    });
    app.use(VueQueryPlugin, { queryClient: client });
    pets = require(join(js, "pets.js"));
  });
  after(async () => {
    client.clear();
    await server.close();
  });

  const inApp = (fn) => app.runWithContext(fn);

  test("a ref in place of an argument moves the query when it changes", async () => {
    const id = vue.ref("1");
    const query = inApp(() => pets.useGetPetQuery(id));
    await until(() => payloadOf(http, query.data.value)?.id === "1", "pet 1");
    id.value = "2";
    await until(() => payloadOf(http, query.data.value)?.id === "2", "pet 2");
    assert.ok(server.asked().includes("GET /api/v1/pets/1"));
    assert.ok(server.asked().includes("GET /api/v1/pets/2"));
  });

  test("a missing id waits instead of asking for /pets/undefined", async () => {
    const id = vue.ref(undefined);
    const before = server.seen.length;
    const query = inApp(() => pets.useGetPetQuery(id));
    await sleep(100);
    assert.equal(server.seen.length, before);
    assert.equal(query.fetchStatus.value, "idle");
    id.value = "5";
    await until(() => payloadOf(http, query.data.value)?.id === "5", "pet 5");
  });

  test("a getter works the same way", async () => {
    const id = vue.ref("3");
    const query = inApp(() => pets.useGetPetQuery(() => id.value));
    await until(() => payloadOf(http, query.data.value)?.id === "3", "pet 3");
    id.value = "4";
    await until(() => payloadOf(http, query.data.value)?.id === "4", "pet 4");
  });

  test("a query given as a ref is read again when it changes", async () => {
    const query = vue.ref({ since: "monday" });
    inApp(() => pets.useListVisitsQuery("9", query));
    await until(
      () => server.asked().includes("GET /api/v1/pets/9/visits?since=monday"),
      "the first visits",
    );
    query.value = { since: "tuesday" };
    await until(
      () => server.asked().includes("GET /api/v1/pets/9/visits?since=tuesday"),
      "the second visits",
    );
  });

  test("a mutation sends its variables", async () => {
    const mutation = inApp(() => pets.useCreatePetMutation());
    const created = await mutation.mutateAsync({ body: { name: "Rex" } });
    assert.deepEqual(payloadOf(http, created), { id: "new", name: "Rex" });
    assert.ok(server.asked().includes("POST /api/v1/pets"));
  });

  test("stopping the scope aborts a mutation still in flight", async () => {
    const scope = vue.effectScope();
    const mutation = scope.run(() => inApp(() => pets.useCreatePetMutation()));
    const pending = mutation.mutateAsync({ body: { name: "slow" } });
    await until(
      () =>
        server.asked().filter((line) => line === "POST /api/v1/pets").length >=
        2,
      "the slow request",
    );
    scope.stop();
    // @mrzr/api-client settles a canceled call with no data instead of rejecting.
    if (http === "api-client") await pending;
    else await assert.rejects(pending, /abort|cancel/i);
  });
});
