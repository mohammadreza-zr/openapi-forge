// The built-in clients, run for real: the generated request functions are
// compiled and called against a local HTTP server, once per HTTP client.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { compileCjs, generateTo } from "./harness.mjs";
import { ok, serve } from "./server.mjs";

async function load(http) {
  const dir = await generateTo(http, { http, target: "requests" });
  const js = compileCjs(dir);
  const require = createRequire(join(dir, "load.cjs"));
  return {
    pets: require(join(js, "pets.js")),
    client: require(join(js, "client.js")),
    types: require(join(js, "types.js")),
  };
}

for (const http of ["fetch", "axios"]) {
  describe(`the ${http} client`, () => {
    let api;
    let backend;
    let other;

    before(async () => {
      api = await load(http);
      backend = await serve((request) => {
        if (request.url.startsWith("/api/v1/pets/fail"))
          return { body: { result: false, code: 7, message: "refused" } };
        if (request.url.startsWith("/api/v1/pets/missing"))
          return { status: 404, body: { detail: "no such pet" } };
        if (request.url.startsWith("/api/v1/pets/plain"))
          return { body: { id: "p", name: "plain" } };
        if (request.url.startsWith("/api/v1/pets/slow")) return { body: "{}" };
        if (request.url.startsWith("/api/v1/pets?"))
          return ok({ count: 1, list: [{ id: "1", name: "Rex" }] });
        return ok({ id: "1", name: "Rex" });
      });
      other = await serve(() => ok({ id: "other", name: "Elsewhere" }));
      api.client.configureClient({ baseUrl: backend.base });
    });
    after(async () => {
      await backend.close();
      await other.close();
    });

    const last = () => backend.seen.at(-1);

    test("a query repeats array keys and leaves out what is empty", async () => {
      const page = await api.pets.listPets({
        kind: "cat",
        ids: ["a", "b"],
        start: 0,
      });
      assert.deepEqual(page, { count: 1, list: [{ id: "1", name: "Rex" }] });
      assert.equal(last().method, "GET");
      assert.equal(last().url, "/api/v1/pets?kind=cat&ids=a&ids=b&start=0");
      await api.pets.listPets({ kind: undefined, offset: undefined });
      assert.equal(last().url, "/api/v1/pets");
    });

    test("a path argument is encoded into the route", async () => {
      await api.pets.getPet("a b/c");
      assert.equal(last().url, "/api/v1/pets/a%20b%2Fc");
    });

    test("a body is sent as JSON", async () => {
      const pet = await api.pets.createPet({ name: "Rex", kind: "dog" });
      assert.equal(pet.name, "Rex");
      assert.equal(last().method, "POST");
      assert.match(last().headers["content-type"], /^application\/json/);
      assert.deepEqual(JSON.parse(last().body), { name: "Rex", kind: "dog" });
    });

    test("an upload is sent as multipart form data", async () => {
      await api.pets.uploadPhoto("7", {
        file: new Blob(["bytes"], { type: "text/plain" }),
      });
      assert.equal(last().url, "/api/v1/pets/7/photo");
      assert.match(
        last().headers["content-type"],
        /^multipart\/form-data; boundary=/,
      );
      assert.match(last().body, /name="file"/);
      assert.match(last().body, /bytes/);
    });

    test("configured headers go with every request, and a call's own win", async () => {
      api.client.configureClient({
        headers: async () => ({ Authorization: "Bearer one", "X-Trace": "a" }),
      });
      try {
        await api.pets.getPet("1", { headers: { "X-Trace": "b" } });
        assert.equal(last().headers.authorization, "Bearer one");
        assert.equal(last().headers["x-trace"], "b");
      } finally {
        api.client.configureClient({ headers: () => ({}) });
      }
    });

    test("a call's baseUrl wins over the client's", async () => {
      const pet = await api.pets.getPet("1", { baseUrl: other.base });
      assert.equal(pet.id, "other");
      assert.equal(other.seen.at(-1).url, "/api/v1/pets/1");
    });

    test("an answer with result: false is an ApiResponseError carrying its code", async () => {
      await assert.rejects(api.pets.getPet("fail"), (error) => {
        assert.ok(error instanceof api.types.ApiResponseError);
        assert.equal(error.message, "refused");
        assert.equal(error.code, 7);
        assert.equal(error.status, 200);
        return true;
      });
    });

    test("a failing status is an ApiResponseError carrying the status and the body", async () => {
      await assert.rejects(api.pets.getPet("missing"), (error) => {
        assert.ok(error instanceof api.types.ApiResponseError);
        assert.equal(error.status, 404);
        assert.deepEqual(error.body, { detail: "no such pet" });
        return true;
      });
    });

    test("an answer that is no envelope is returned as it is", async () => {
      assert.deepEqual(await api.pets.getPet("plain"), {
        id: "p",
        name: "plain",
      });
    });

    test("an aborted request rejects", async () => {
      const controller = new AbortController();
      const pending = api.pets.getPet("slow", { signal: controller.signal });
      controller.abort();
      await assert.rejects(pending);
    });
  });
}
