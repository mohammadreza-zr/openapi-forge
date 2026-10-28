// A header parameter is part of what a read depends on: in a reactive library
// a ref in its place moves the query, and the header reaches the server.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

// vue-query only subscribes in a browser.
globalThis.window = globalThis;

import { compileCjs, generateTo, until } from "./harness.mjs";
import { EDGES_FIXTURE } from "./helpers.mjs";
import { edgesApi, serve } from "./server.mjs";

for (const http of ["fetch", "axios"]) describe(`header parameters in the vue-query hooks over ${http}`, () => {
  let server;
  let vue;
  let app;
  let edges;
  let client;

  before(async () => {
    const dir = await generateTo(`vue-headers-${http}`, {
      library: "vue-query",
      http,
      infinite: true,
      input: EDGES_FIXTURE,
    });
    const js = compileCjs(dir);
    const require = createRequire(join(dir, "load.cjs"));
    vue = require("vue");
    const { QueryClient, VueQueryPlugin } = require("@tanstack/vue-query");
    server = await serve(edgesApi);
    require(join(js, "client.js")).configureClient({ baseUrl: server.base });
    app = vue.createApp({});
    client = new QueryClient({
      defaultOptions: { queries: { gcTime: 0 }, mutations: { gcTime: 0 } },
    });
    app.use(VueQueryPlugin, { queryClient: client });
    edges = require(join(js, "edges.js"));
  });
  after(async () => {
    client.clear();
    await server.close();
  });

  test("a ref of headers moves the query, and the header is sent", async () => {
    const headers = vue.ref({ "X-Tenant-Id": "a" });
    const query = app.runWithContext(() => edges.useGetTenantQuery({}, headers));
    await until(() => query.data.value !== undefined, "the first answer");
    assert.equal(server.seen.at(-1).headers["x-tenant-id"], "a");
    headers.value = { "X-Tenant-Id": "b" };
    await until(
      () => server.seen.at(-1).headers["x-tenant-id"] === "b",
      "a request for tenant b",
    );
    assert.equal(server.seen.length, 2);
  });

  test("an infinite list sends its header with every page", async () => {
    const headers = vue.ref({ "X-Tenant-Id": "t9" });
    const query = app.runWithContext(() =>
      edges.useListPagesInfiniteQuery({}, headers, { pageSize: 2 }),
    );
    await until(() => query.data.value?.pages.length === 1, "the first page");
    await query.fetchNextPage();
    await until(() => query.data.value?.pages.length === 2, "the second page");
    assert.deepEqual(
      query.data.value.pages.map((page) => page.list.join()),
      ["0,1", "2,3"],
    );
    const asked = server.seen.filter((item) => item.url.startsWith("/api/v1/pages"));
    assert.ok(asked.length >= 2);
    assert.ok(asked.every((item) => item.headers["x-tenant-id"] === "t9"));
  });
});
