// The built-in clients, run for real: the generated request functions are
// compiled and called against a local HTTP server, once per HTTP client.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { compileCjs, generateTo } from "./harness.mjs";
import { multipart, payloadOf, pointClient } from "./probes/point.cjs";
import { ok, serve } from "./server.mjs";

async function load(http) {
  const dir = await generateTo(http, { http, target: "requests" });
  const js = compileCjs(dir);
  const require = createRequire(join(dir, "load.cjs"));
  return {
    require,
    pets: require(join(js, "pets.js")),
    client: require(join(js, "client.js")),
    types: require(join(js, "types.js")),
  };
}

for (const http of ["fetch", "axios", "api-client"]) {
  describe(`the ${http} client`, () => {
    let api;
    let backend;
    let other;

    before(async () => {
      api = await load(http);
      backend = await serve((request) => {
        if (request.url.startsWith("/api/v1/pets/fail"))
          return { body: { result: false, code: 7, message: "refused" } };
        if (request.url.startsWith("/api/v1/pets/wrapped"))
          return { body: { result: true, data: { id: "w", name: "wrapped" } } };
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
      pointClient(http, api.client, api.require, backend.base);
    });
    after(async () => {
      await backend.close();
      await other.close();
    });

    const last = () => backend.seen.at(-1);

    test("a query repeats array keys and leaves out what is empty", async () => {
      const page = payloadOf(http, await api.pets.listPets({
        kind: "cat",
        ids: ["a", "b"],
        start: 0,
      }));
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
      const pet = payloadOf(http, await api.pets.createPet({ name: "Rex", kind: "dog" }));
      assert.equal(pet.name, "Rex");
      assert.equal(last().method, "POST");
      assert.match(last().headers["content-type"], /^application\/json/);
      assert.deepEqual(JSON.parse(last().body), { name: "Rex", kind: "dog" });
    });

    test("an upload is sent as multipart form data", async () => {
      await api.pets.uploadPhoto(
        "7",
        multipart(http, { file: new Blob(["bytes"], { type: "text/plain" }) }),
      );
      assert.equal(last().url, "/api/v1/pets/7/photo");
      assert.match(
        last().headers["content-type"],
        /^multipart\/form-data; boundary=/,
      );
      assert.match(last().body, /name="file"/);
      assert.match(last().body, /bytes/);
    });

    test("configured headers go with every request, and a call's own win", async () => {
      pointClient(http, api.client, api.require, backend.base, {
        "X-Token": "one",
        "X-Trace": "a",
      });
      try {
        await api.pets.getPet("1", { headers: { "X-Trace": "b" } });
        assert.equal(last().headers["x-token"], "one");
        assert.equal(last().headers["x-trace"], "b");
      } finally {
        pointClient(http, api.client, api.require, backend.base);
      }
    });

    test("a call's baseUrl wins over the client's", async () => {
      const pet = payloadOf(http, await api.pets.getPet("1", { baseUrl: other.base }));
      assert.equal(pet.id, "other");
      assert.equal(other.seen.at(-1).url, "/api/v1/pets/1");
    });

    test("an answer with result: false is handed over as it is: the client does not judge it", async () => {
      assert.deepEqual(payloadOf(http, await api.pets.getPet("fail")), {
        result: false,
        code: 7,
        message: "refused",
      });
    });

    test("an answer with a data field is the client's to unwrap: only @mrzr/api-client does", async () => {
      const answer = payloadOf(http, await api.pets.getPet("wrapped"));
      if (http === "api-client")
        assert.deepEqual(answer, { id: "w", name: "wrapped" });
      else
        assert.deepEqual(answer, {
          result: true,
          data: { id: "w", name: "wrapped" },
        });
    });

    test("a failing status is the client's own error", async () => {
      await assert.rejects(api.pets.getPet("missing"), (error) => {
        if (http === "fetch") {
          assert.ok(error instanceof api.types.ApiResponseError);
          assert.equal(error.status, 404);
          assert.deepEqual(error.body, { detail: "no such pet" });
        } else if (http === "axios") {
          assert.ok(api.require("axios").isAxiosError(error));
          assert.equal(error.response.status, 404);
          assert.deepEqual(error.response.data, { detail: "no such pet" });
        } else {
          assert.equal(error.name, "ApiError");
          assert.equal(error.statusCode, 404);
          assert.deepEqual(error.data, { detail: "no such pet" });
        }
        return true;
      });
    });

    test("an answer that is no envelope is returned as it is", async () => {
      assert.deepEqual(payloadOf(http, await api.pets.getPet("plain")), {
        id: "p",
        name: "plain",
      });
    });

    test("the client's own hooks see the answer as the client reads it", async () => {
      if (http !== "axios") return;
      const seen = [];
      const axios = api.require("axios");
      const instance = axios.create({ baseURL: backend.base });
      instance.interceptors.response.use((response) => {
        seen.push(response.data);
        return response;
      });
      api.client.configureClient({ instance });
      try {
        await api.pets.getPet("plain");
        // parsed by axios itself, not bytes the generator read for it
        assert.deepEqual(seen, [{ id: "p", name: "plain" }]);
      } finally {
        pointClient(http, api.client, api.require, backend.base);
      }
    });

    test("an aborted request ends the way the client ends it", async () => {
      const controller = new AbortController();
      const pending = api.pets.getPet("slow", { signal: controller.signal });
      controller.abort();
      // fetch and axios reject; @mrzr/api-client settles a canceled call with `canceled: true`
      // unless it is set to throw on cancel.
      if (http === "api-client") assert.equal((await pending).canceled, true);
      else await assert.rejects(pending);
    });
  });
}
