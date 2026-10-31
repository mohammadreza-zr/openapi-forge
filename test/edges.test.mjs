// What a generated layer must not get wrong: the types it writes have to be
// true of what the transport really sends and receives. `edges.yaml` holds the
// cases that used to be wrong — a payload with a `result` field, a header
// parameter, a form, bytes — and each is checked twice: in the code that is
// written, and by running it against a real server with each HTTP client.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { emit } from "../dist/emit.js";
import { compileCjs, generateTo } from "./harness.mjs";
import { edges, options, petstore } from "./helpers.mjs";
import { multipart, payloadOf, pointClient, urlencoded } from "./probes/point.cjs";
import { serve } from "./server.mjs";

const written = (patch, doc = edges()) =>
  emit(doc, options(patch), "edges.yaml");
const edgesTs = (patch) => written(patch).files.get("edges.ts");

describe("the code that is written", () => {
  test("nothing is unwrapped at run time: the built-in clients are told nothing about an envelope", () => {
    assert.doesNotMatch(edgesTs(), /isEnvelope/);
    const pets = written({}, petstore()).files.get("pets.ts");
    assert.doesNotMatch(pets, /isEnvelope/);
    // A custom transport unwraps on its own, so it is told nothing …
    assert.doesNotMatch(
      written({ client: "custom" }, petstore()).files.get("pets.ts"),
      /isEnvelope/,
    );
    // … unless the project names the key.
    assert.match(
      written(
        { client: "custom", runtime: { requestKeys: { envelope: "unwrap" } } },
        petstore(),
      ).files.get("pets.ts"),
      /unwrap: true/,
    );
  });

  test("a { count, list } payload is the list type only when both are required", () => {
    const text = edgesTs();
    assert.match(text, /http\.get<ApiListData<string>>\(\s*edgesEndpoints\.listStrict/);
    assert.match(text, /http\.get<ListLooseResponse>\(\s*edgesEndpoints\.listLoose/);
    assert.match(
      written().files.get("models.ts"),
      /ListLooseResponse = \{\s*count\?: number;\s*list\?: string\[\];\s*\}/,
    );
  });

  test("a header parameter is an argument, a key part and a hook argument", () => {
    const text = edgesTs();
    assert.match(
      text,
      /export type GetTenantHeaders = \{\s*"X-Tenant-Id": string;\s*"X-Page"\?: number;\s*\}/,
    );
    assert.match(text, /headers: GetTenantHeaders,\s*config\?/);
    // axios takes header values as they are and the call's own headers are kept.
    assert.match(text, /headers: \{ \.\.\.config\?\.headers, \.\.\.headers \}/);
    // `fetch` and HttpClient take text: a number is written as text on the way out.
    assert.match(edgesTs({ http: "fetch" }), /requestHeaders\.set\("X-Page", String\(headers\["X-Page"\]\)\)/);
    assert.match(
      edgesTs({ http: "angular", library: "angular-query" }),
      /\.\.\.Object\.fromEntries\(\s*Object\.entries\(headers\)[\s\S]*?String\(value\)/,
    );
    assert.match(text, /getTenant: \(params: GetTenantQuery, headers: GetTenantHeaders\)/);
    assert.match(text, /export function useGetTenantQuery\([^)]*headers: GetTenantHeaders/s);
    // Authorization is the transport's, as OpenAPI says.
    assert.doesNotMatch(text, /Authorization/);
  });

  test("what the client cannot do as the document asks is reported", () => {
    const said = written().problems.map(({ where, message }) => `${where} ${message}`);
    assert.ok(said.some((line) => /parameter `session` is a cookie/.test(line)), said.join("\n"));
    assert.ok(said.some((line) => /parameter `tags` is a list .* repeats the key/.test(line)));
    assert.ok(!said.some((line) => /filter/.test(line)), "deepObject is written as asked");
    const custom = written({ client: "custom" }).problems.map((item) => item.message);
    assert.ok(custom.some((line) => /is a header, which the custom client takes none of/.test(line)));
  });

  test("count and list can be taken as always there, when the API is known to send both", () => {
    const text = edgesTs({ runtime: { list: { assumeRequired: true } } });
    assert.match(text, /http\.get<ApiListData<string>>\(\s*edgesEndpoints\.listLoose/);
  });

  test("a DELETE takes its body through the config; a custom transport without a key skips it", () => {
    const text = edgesTs();
    // The default client, @mrzr/api-client, has a `delete` with no body.
    assert.doesNotMatch(edgesTs({ http: "api-client" }), /function remove\(/);
    assert.match(text, /export function remove\(\s*body: RemoveBody,/);
    assert.match(text, /http\.delete<null>\(\s*edgesEndpoints\.remove,\s*\{[^}]*data: body/s);
    assert.match(edgesTs({ http: "fetch" }), /method: "DELETE", headers: requestHeaders, body: JSON\.stringify\(body\)/);
    assert.match(edgesTs({ http: "angular", library: "angular-query" }), /this\.http\.delete<null>\(edgesEndpoints\.remove, \{ body \}\)/);
    const custom = written({ client: "custom" });
    assert.doesNotMatch(custom.files.get("edges.ts"), /function remove\(/);
    assert.ok(custom.problems.some(({ message }) => /DELETE/.test(message)));
    assert.match(
      written({ client: "custom", runtime: { requestKeys: { body: "data" } } }).files.get("edges.ts"),
      /data: body,/,
    );
  });

  test("an infinite list read takes its header parameters like any other argument", () => {
    const text = edgesTs({ infinite: true });
    assert.match(
      text,
      /listPagesInfinite: \(params: Omit<ListPagesQuery, "start" \| "offset">, headers: ListPagesHeaders\) =>\s*\[\.\.\.edgesKeys\.all, edgesEndpoints\.listPages, "infinite", params, headers\]/,
    );
    assert.match(text, /useListPagesInfiniteQuery\(\s*params: Omit<ListPagesQuery, "start" \| "offset"> = \{\},\s*headers: ListPagesHeaders,/);
    assert.match(text, /listPages\(headers, \{ params: \{ \.\.\.params, start: page\.start, offset: page\.size \}, signal \}\)/);
  });

  test("a body is sent as the media type the document gives it", () => {
    const text = edgesTs();
    // A form is a FormData or a URLSearchParams: the client sees one and sets its own Content-Type.
    assert.match(text, /uploadMany\(body\?: FormData/);
    assert.match(text, /sendForm\(body\??: URLSearchParams/);
    assert.match(edgesTs({ http: "angular", library: "angular-query" }), /sendForm\(body\??: HttpParams/);
    assert.doesNotMatch(text, /isFormData|x-www-form-urlencoded/);
    // A text body would be labelled JSON or form by default, so the document's type is named.
    assert.match(text, /"Content-Type": "text\/plain"/);
    assert.match(text, /"Content-Type": "application\/octet-stream"/);
    // A custom transport with no header key keeps the form flag it knew.
    const custom = edgesTs({ client: "custom" });
    assert.doesNotMatch(custom, /Content-Type/);
    assert.match(custom, /sendForm[\s\S]*?isFormData: true/);
  });
});

for (const http of ["fetch", "axios", "api-client"]) {
  describe(`the ${http} client against a server`, () => {
    let api;
    let backend;
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x80]);

    before(async () => {
      const dir = await generateTo(`edges-${http}`, {
        http,
        target: "requests",
        input: join(import.meta.dirname, "fixtures/edges.yaml"),
      });
      const js = compileCjs(dir);
      const require = createRequire(join(dir, "load.cjs"));
      api = {
        edges: require(join(js, "edges.js")),
        // `fetch` is the platform's function: there is no client file.
        client: existsSync(join(js, "client.js")) ? require(join(js, "client.js")) : undefined,
        require,
      };
      backend = await serve((request) => {
        switch (request.url.split("?")[0].replace("/api/v1", "")) {
          case "/check":
            return { body: { result: false } };
          case "/search":
            return { body: { result: "ok", total: 3 } };
          case "/download":
            return { type: "application/octet-stream", body: bytes };
          case "/text":
            return { type: "text/plain", body: "123" };
          case "/note":
            return { type: "text/plain", body: "got it" };
          case "/files":
            return { status: 204, body: "" };
          case "/form":
          case "/blob":
            return { type: "text/plain", body: "" };
          default:
            return { body: {} };
        }
      });
      pointClient(http, api.client, api.require, backend.base);
    });
    after(() => backend.close());

    const last = () => backend.seen.at(-1);

    test("a payload with a `result` field is the payload, not an envelope", async () => {
      assert.deepEqual(payloadOf(http, await api.edges.search()), { result: "ok", total: 3 });
      assert.deepEqual(payloadOf(http, await api.edges.check()), { result: false });
    });

    test("a binary answer is asked for as bytes, and comes as the client gives bytes", async () => {
      const answer = payloadOf(http, await api.edges.download());
      // axios reads "blob" as a Blob in a browser, but as text in Node: its answer
      // is its own there, and only the request is ours.
      if (http === "axios") return assert.ok(answer !== undefined);
      assert.ok(answer instanceof Blob);
      assert.deepEqual(Buffer.from(await answer.arrayBuffer()), bytes);
    });

    test("a text answer stays text, even when it reads as JSON", async () => {
      assert.equal(payloadOf(http, await api.edges.getText()), "123");
    });

    test("an empty answer is what the client makes of it", async () => {
      const answer = payloadOf(http, await api.edges.uploadMany(multipart(http, { title: "t" })));
      if (http === "fetch") assert.equal(answer, null);
      else if (http === "axios") assert.equal(answer, "");
      else assert.equal(answer, undefined);
    });

    test("header parameters are sent, and the call's own headers are kept", async () => {
      if (http === "api-client") {
        // The client's headers are its own: they go in the config of the call.
        await api.edges.getTenant({ headers: { "X-Tenant-Id": "t1", "X-Page": "2", "X-Trace": "z" } });
      } else if (http === "axios") {
        // axios: no query argument — the query is `params` in the config.
        await api.edges.getTenant({ "X-Tenant-Id": "t1", "X-Page": 2 }, { headers: { "X-Trace": "z" } });
      } else {
        await api.edges.getTenant(
          {},
          { "X-Tenant-Id": "t1", "X-Page": 2 },
          { headers: { "X-Trace": "z" } },
        );
      }
      assert.equal(last().headers["x-tenant-id"], "t1");
      assert.equal(last().headers["x-page"], "2");
      assert.equal(last().headers["x-trace"], "z");
      // An optional header left out is not sent as "undefined".
      if (http === "api-client") await api.edges.getTenant({ headers: { "X-Tenant-Id": "t2" } });
      else if (http === "axios") await api.edges.getTenant({ "X-Tenant-Id": "t2" });
      else await api.edges.getTenant({}, { "X-Tenant-Id": "t2" });
      assert.equal(last().headers["x-page"], undefined);
    });

    test("an object in the query is written name[property]=value", async () => {
      const query = { filter: { a: "x" }, q: "" };
      if (http === "api-client") await api.edges.getTenant({ params: query, headers: { "X-Tenant-Id": "t" } });
      else if (http === "axios") await api.edges.getTenant({ "X-Tenant-Id": "t" }, { params: query });
      else await api.edges.getTenant(query, { "X-Tenant-Id": "t" });
      // Each client writes the query its own way: axios keeps the brackets, URLSearchParams escapes them.
      assert.match(last().url, /^\/api\/v1\/tenant\?filter(%5B|\[)a(%5D|\])=x/);
    });

    test("a multipart body has a part per list item and a JSON part per object", async () => {
      await api.edges.uploadMany(
        multipart(http, {
          title: "t",
          files: [new Blob(["AAA"]), new Blob(["BBB"])],
          meta: { a: "1" },
        }),
      );
      const body = last().body;
      assert.equal(body.match(/name="files"/g)?.length, 2);
      assert.match(body, /AAA/);
      assert.match(body, /BBB/);
      assert.match(body, /name="meta"\r\n\r\n\{"a":"1"\}/);
      assert.match(body, /name="title"\r\n\r\nt/);
    });

    test("a urlencoded body is a form, a list repeating its key", async () => {
      await api.edges.sendForm(urlencoded(http, { a: "1", tags: ["x", "y"] }));
      assert.match(
        last().headers["content-type"],
        /^application\/x-www-form-urlencoded/,
      );
      assert.equal(last().body, "a=1&tags=x&tags=y");
    });

    test("a text body is sent as the text, not as a JSON string", async () => {
      assert.equal(payloadOf(http, await api.edges.sendNote("hello")), "got it");
      assert.match(last().headers["content-type"], /^text\/plain/);
      assert.equal(last().body, "hello");
    });

    test("a DELETE sends its body, where the client can", async (t) => {
      // `@mrzr/api-client`'s `delete` takes no body: the operation is left out.
      if (http === "api-client") {
        assert.equal(api.edges.remove, undefined);
        return t.skip("api-client's delete takes no body");
      }
      await api.edges.remove({ ids: ["a", "b"] });
      assert.equal(last().method, "DELETE");
      assert.match(last().headers["content-type"], /^application\/json/);
      assert.deepEqual(JSON.parse(last().body), { ids: ["a", "b"] });
    });

    test("a binary body is sent as its bytes", async () => {
      await api.edges.sendBlob(new Blob([bytes], { type: "application/octet-stream" }));
      assert.match(last().headers["content-type"], /^application\/octet-stream/);
    });
  });
}
