// `@mrzr/api-client` as the transport: the layer is written for a custom
// client, compiled against the package's real types, and run through the real
// client against a local server. The adapter is the one the README shows.
import assert from "node:assert/strict";
import { copyFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { bundle, compileCjs, generateTo, root } from "./harness.mjs";
import { EDGES_FIXTURE } from "./helpers.mjs";
import { edgesApi, serve } from "./server.mjs";

const ADAPTER = join(import.meta.dirname, "fixtures/api-client-transport.ts");

test("the README shows the adapter that is tested here", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.ok(
    readme.includes(readFileSync(ADAPTER, "utf8").trim()),
    "README.md must contain test/fixtures/api-client-transport.ts as it is",
  );
});

describe("@mrzr/api-client as the transport", () => {
  let edges;
  let backend;

  before(async () => {
    const dir = await generateTo("api-client", {
      client: "custom",
      target: "requests",
      input: EDGES_FIXTURE,
      runtime: {
        callers: { module: "./transport" },
        types: { module: "./transport", request: "GeneratedRequestConfig" },
        envelope: { module: "./transport" },
        list: { module: "./transport" },
        requestKeys: { headers: "headers" },
      },
    });
    copyFileSync(ADAPTER, join(dir, "ts/transport.ts"));
    // Compiled strictly against the package's own types, then bundled to run.
    compileCjs(dir, ["--noUnusedLocals", "--noUnusedParameters"]);
    const entry = await bundle(dir, join(dir, "ts/edges.ts"), {
      alias: {},
      platform: "node",
    });
    edges = await import(`${entry}?${Date.now()}`);
    backend = await serve((request) => {
      const path = request.url.split("?")[0].replace("/api/v1", "");
      if (path === "/check") return { body: { result: false } };
      if (path === "/search") return { body: { result: "ok", total: 3 } };
      if (path === "/strict") return { body: { count: 2, list: ["a", "b"] } };
      if (path === "/note") return { type: "text/plain", body: "got it" };
      return edgesApi(request);
    });
  });
  after(() => backend.close());

  const last = () => backend.seen.at(-1);
  const call = { get baseUrl() { return backend.base; } };

  test("a payload with a `result` field is the payload", async () => {
    assert.deepEqual(await edges.search({ ...call }), { result: "ok", total: 3 });
    assert.deepEqual(await edges.check({ ...call }), { result: false });
    assert.deepEqual(await edges.listStrict({ ...call }), { count: 2, list: ["a", "b"] });
  });

  test("a header, a number included, and an object in the query arrive", async () => {
    await edges.getTenant(
      { filter: { a: "x" }, q: "z" },
      { "X-Tenant-Id": "t1", "X-Page": 2 },
      { ...call },
    );
    assert.equal(last().url, "/api/v1/tenant?filter%5Ba%5D=x&q=z");
    assert.equal(last().headers["x-tenant-id"], "t1");
    assert.equal(last().headers["x-page"], "2");
  });

  test("a urlencoded body is a form, a list repeating its key", async () => {
    await edges.sendForm({ a: "1", tags: ["x", "y"] }, { ...call });
    assert.match(last().headers["content-type"], /^application\/x-www-form-urlencoded/);
    assert.equal(last().body, "a=1&tags=x&tags=y");
  });

  test("a multipart body has a part per list item and a JSON part per object", async () => {
    await edges.uploadMany(
      { title: "t", files: [new Blob(["AAA"]), new Blob(["BBB"])], meta: { a: "1" } },
      { ...call },
    );
    assert.match(last().headers["content-type"], /^multipart\/form-data; boundary=/);
    assert.equal(last().body.match(/name="files"/g)?.length, 2);
    assert.match(last().body, /name="meta"\r\n\r\n\{"a":"1"\}/);
  });

  test("a text body is sent as the text", async () => {
    assert.equal(await edges.sendNote("hello", { ...call }), "got it");
    assert.match(last().headers["content-type"], /^text\/plain/);
    assert.equal(last().body, "hello");
  });
});
