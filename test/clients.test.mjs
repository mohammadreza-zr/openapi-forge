import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { resolveOptions } from "../dist/config.js";
import { diffDocuments } from "../dist/diff.js";
import { doctor } from "../dist/doctor.js";
import { emit } from "../dist/emit.js";
import { runtimeFiles } from "../dist/runtime/index.js";
import { HTTP_CLIENTS } from "../dist/runtime/client.js";
import { LIBRARIES, LIBRARY_NAMES } from "../dist/runtime/libraries/index.js";
import { clients, options } from "./helpers.mjs";

const build = (patch) =>
  emit(clients(), options({ infinite: true, http: "api-client", ...patch }), "x").files;

test("every library names its hooks with its own prefix", () => {
  for (const library of LIBRARY_NAMES) {
    const { prefix } = LIBRARIES[library];
    const pets = build({ library }).get("pets.ts");
    for (const name of [
      "ListPetsQuery",
      "ListPetsInfiniteQuery",
      "GetPetQuery",
      "CreatePetMutation",
    ])
      assert.match(
        pets,
        new RegExp(`export function ${prefix}${name}\\(`),
        `${library} ${name}`,
      );
    assert.doesNotMatch(
      pets,
      new RegExp(`export function (?!${prefix})\\w+(Query|Mutation)\\(`),
    );
  }
});

test("the runtime wrappers carry the same prefix", () => {
  assert.equal(resolveOptions().runtime.hooks.query, "useApiQuery");
  const angular = resolveOptions({ library: "angular-query" }).runtime.hooks;
  assert.deepEqual(
    [angular.query, angular.mutation, angular.infinite],
    ["injectApiQuery", "injectApiMutation", "injectApiInfiniteQuery"],
  );
  assert.equal(
    resolveOptions({ library: "svelte-query" }).runtime.hooks.query,
    "createApiQuery",
  );
});

test("a runtime name set in the config wins over the library's", () => {
  const { hooks } = resolveOptions({
    library: "vue-query",
    runtime: { hooks: { query: "useMyQuery" } },
  }).runtime;
  assert.equal(hooks.query, "useMyQuery");
  assert.equal(hooks.mutation, "useApiMutation");
});

test("react and swr hooks take plain arguments", () => {
  for (const library of ["react-query", "swr"]) {
    const pets = build({ library }).get("pets.ts");
    assert.match(pets, /useGetPetQuery\(petId: string, options\?/);
    assert.doesNotMatch(pets, /toValue|MaybeGetter/);
  }
});

test("reactive libraries read each argument where the request is made", () => {
  for (const library of [
    "vue-query",
    "svelte-query",
    "solid-query",
    "angular-query",
  ]) {
    const { prefix } = LIBRARIES[library];
    const pets = build({ library }).get("pets.ts");
    assert.match(
      pets,
      new RegExp(
        `${prefix}ListVisitsQuery\\(\\s*petId: MaybeGetter<string>,\\s*params: MaybeGetter<ListVisitsQuery>,`,
      ),
      library,
    );
    assert.match(
      pets,
      /\(\) => petsKeys\.listVisits\(toValue\(petId\), toValue\(params\)\)/,
    );
    assert.match(
      pets,
      /\(signal\) => listVisits\(\{ addTemplateToUrl: \{ pet_id: toValue\(petId\) \}, params: toValue\(params\), signal \}\)/,
    );
    assert.match(
      pets,
      /params: MaybeGetter<Omit<ListPetsQuery, "start" \| "offset">> = \{\}/,
    );
    assert.match(
      pets,
      /\.\.\.toValue\(params\), start: page\.start, offset: page\.size/,
    );
  }
});

test("a reactive query without arguments imports neither helper", () => {
  const owners = build({ library: "vue-query" }).get("owners.ts");
  assert.doesNotMatch(owners, /toValue|MaybeGetter/);
  assert.match(owners, /\(\) => ownersKeys\.listOwners\(\)/);
  const pets = build({ library: "vue-query" }).get("pets.ts");
  assert.match(pets, /import \{[^}]*\btoValue\b[^}]*\} from "\.\/hooks"/);
  assert.match(
    pets,
    /import type \{[^}]*\bMaybeGetter\b[^}]*\} from "\.\/types"/,
  );
});

test("a mutation's variables are never reactive", () => {
  const pets = build({ library: "vue-query" }).get("pets.ts");
  assert.match(
    pets,
    /useCreatePetMutation\(\s*options\?: ApiMutationOptions<IRes<Pet>, CreatePetVariables>/,
  );
});

test("the built-in runtime imports the library it wraps", () => {
  const files = (library, patch) =>
    runtimeFiles(resolveOptions({ library, ...patch }));
  const sources = {
    "react-query": "@tanstack/react-query",
    "vue-query": "@tanstack/vue-query",
    "svelte-query": "@tanstack/svelte-query",
    "solid-query": "@tanstack/solid-query",
    "angular-query": "@tanstack/angular-query-experimental",
    swr: "swr",
  };
  for (const library of LIBRARY_NAMES) {
    const run = files(library, { infinite: true });
    assert.match(
      run.get("hooks.ts"),
      new RegExp(`from "${sources[library]}`),
      library,
    );
    assert.match(
      run.get("types.ts"),
      new RegExp(`from "${sources[library]}`),
      library,
    );
    assert.match(
      run.get("hooks.ts"),
      new RegExp(
        `export function ${LIBRARIES[library].prefix}ApiInfiniteQuery`,
      ),
    );
    assert.doesNotMatch(files(library).get("hooks.ts"), /ApiInfiniteQuery/);
  }
});

test("a reactive runtime defines the helpers its hooks import", () => {
  for (const library of [
    "vue-query",
    "svelte-query",
    "solid-query",
    "angular-query",
  ]) {
    const run = runtimeFiles(resolveOptions({ library }));
    assert.match(run.get("hooks.ts"), /toValue/);
    assert.match(run.get("types.ts"), /export type MaybeGetter<T> =/);
  }
});

test("requests only needs no library", () => {
  for (const library of LIBRARY_NAMES) {
    const run = runtimeFiles(resolveOptions({ library, target: "requests" }));
    assert.deepEqual([...run.keys()].sort(), ["client.ts", "types.ts"]);
    assert.doesNotMatch(run.get("types.ts"), /tanstack|swr/);
  }
});

test("http picks what the built-in client sends with; the default is @mrzr/api-client", () => {
  assert.equal(resolveOptions().http, "api-client");
  assert.equal(
    runtimeFiles(resolveOptions()).get("client.ts"),
    runtimeFiles(resolveOptions({ http: "api-client" })).get("client.ts"),
  );
  const files = (http, extra = {}) => runtimeFiles(resolveOptions({ http, ...extra }));
  // fetch answers a raw Response, so it has requests only.
  const fetchFiles = () => runtimeFiles(resolveOptions({ http: "fetch", target: "requests" }));
  // axios and @mrzr/api-client have an instance the project owns; fetch is the
  // platform's function and Angular injects its HttpClient, so neither has a file.
  assert.match(files("axios").get("client.ts"), /export const http = axios\.create\(\);/);
  assert.match(files("api-client").get("client.ts"), /createClient\(\)/);
  assert.equal(fetchFiles().has("client.ts"), false);
  assert.equal(files("angular", { library: "angular-query" }).has("client.ts"), false);
});

test("no client keeps a wrapper: each one is called as it is", () => {
  for (const http of ["axios", "api-client"]) {
    const client = runtimeFiles(resolveOptions({ http })).get("client.ts");
    assert.doesNotMatch(client, /configureClient|async function request|function fillPath|shapeBody|textHeaders|queryOf/, http);
    assert.doesNotMatch(runtimeFiles(resolveOptions({ http })).get("types.ts"), /ApiResponseError|GeneratedRequestConfig/, http);
  }
  const types = runtimeFiles(resolveOptions({ http: "fetch", target: "requests" })).get("types.ts");
  assert.doesNotMatch(types, /ApiResponseError|GeneratedRequestConfig/);
});

test("axios, fetch and Angular are called straight, each in its own way", () => {
  const pets = (http, library = "react-query") => build({ http, library }).get("pets.ts");
  // axios: the instance, its config, its answer.
  const axios = pets("axios");
  assert.match(axios, /import \{ http \} from "\.\/client"/);
  assert.match(axios, /http\.get<PetEnvelope>\(\s*petsEndpoints\.getPet\.replace\("\{pet_id\}", encodeURIComponent\(petId\)\),\s*config,/);
  assert.match(axios, /config\?: AxiosRequestConfig/);
  assert.match(axios, /ApiQueryOptions<AxiosResponse<PetEnvelope>/);
  // The instance's own settings are left alone: a list is written however axios (or its paramsSerializer) writes it.
  assert.doesNotMatch(axios, /paramsSerializer/);
  // fetch: the platform function, its init, its Response.
  const fetched = build({ http: "fetch", target: "requests" }).get("pets.ts");
  assert.match(fetched, /export function getPet\(petId: string, init\?: RequestInit\) \{\s*return fetch\(petsEndpoints\.getPet\.replace/);
  assert.match(fetched, /const search = new URLSearchParams\(\);/);
  assert.match(fetched, /for \(const item of params\.ids \?\? \[\]\) search\.append\("ids", String\(item\)\);/);
  // No hook: a raw Response is not something to cache or to retry.
  assert.doesNotMatch(fetched, /ApiQueryOptions|useApiQuery|Keys/);
  assert.match(fetched, /if \(!requestHeaders\.has\("Content-Type"\)\) requestHeaders\.set\("Content-Type", "application\/json"\);/);
  assert.match(fetched, /body: JSON\.stringify\(body\)/);
  // Angular: an injectable service over HttpClient, its Observable.
  const angular = pets("angular", "angular-query");
  assert.match(angular, /import \{ HttpClient \} from "@angular\/common\/http"/);
  assert.match(angular, /@Injectable\(\{ providedIn: "root" \}\)\s*export class PetsService \{\s*private readonly http = inject\(HttpClient\);/);
  assert.match(angular, /getPet\(petId: string\) \{\s*return this\.http\.get<PetEnvelope>\(petsEndpoints\.getPet\.replace/);
  assert.match(angular, /const service = inject\(PetsService\);/);
  assert.match(angular, /firstValueFrom\(service\.getPet\(toValue\(petId\)\)\)/);
  // @mrzr/api-client is called straight too, with its own config and answer.
  const apiClient = build({}).get("pets.ts");
  // Everything the config carries (the path values, the query, the headers) is the caller's: it goes to the client as it is.
  assert.match(apiClient, /export function getPet\(config\?: RequestConfig<Pet>\) \{\s*return apiClient\.get<Pet>\(\s*petsEndpoints\.getPet,\s*config,/);
  assert.match(apiClient, /\(signal\) => getPet\(\{ addTemplateToUrl: \{ pet_id: petId \}, signal \}\)/);
  assert.match(apiClient, /config\?: RequestConfig<Pet>/);
  assert.match(apiClient, /import type \{[^}]*\bRequestConfig\b[^}]*\} from "@mrzr\/api-client"/);
});

test("fetch answers a raw Response, so it has requests only", () => {
  assert.throws(() => resolveOptions({ http: "fetch" }), /use target "requests"/);
  assert.doesNotThrow(() => resolveOptions({ http: "fetch", target: "requests" }));
  assert.doesNotThrow(() => resolveOptions({ client: "custom", http: "fetch" }));
});

test("Angular's requests are a service, so its hooks are Angular Query's", () => {
  assert.throws(
    () => resolveOptions({ http: "angular", library: "react-query" }),
    /use library "angular-query"/,
  );
  assert.doesNotThrow(() => resolveOptions({ http: "angular", target: "requests" }));
  assert.doesNotThrow(() => resolveOptions({ http: "angular", library: "angular-query" }));
});

test("an unknown library or http client is named", () => {
  assert.throws(
    () => resolveOptions({ library: "magic" }),
    /library must be one of react-query/,
  );
  assert.throws(
    () => resolveOptions({ http: "ky" }),
    /http must be one of fetch, axios, api-client, angular/,
  );
});

test("the diff names the hook the way the library does", () => {
  const before = clients();
  delete before.paths["/api/v1/pets/{pet_id}"].delete;
  const hook = (prefix) =>
    diffDocuments(before, clients(), prefix).find(
      (item) => item.kind === "operation-added",
    )?.hook;
  assert.equal(hook(), "useDeletePetMutation");
  assert.equal(hook("inject"), "injectDeletePetMutation");
});

test("doctor looks for the library's packages and the transport's", async () => {
  const dir = await mkdtemp(join(tmpdir(), "forge-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ dependencies: { "@tanstack/react-query": "5" } }),
  );
  const checks = await doctor(
    resolveOptions({ library: "vue-query", http: "axios", input: "x.json" }),
    { cwd: dir },
  );
  const failed = checks
    .filter((item) => item.level === "fail")
    .map((item) => item.message);
  assert.ok(
    failed.some((message) => message.includes("@tanstack/vue-query")),
    failed.join("\n"),
  );
  assert.ok(
    failed.some((message) => message.includes("vue ")),
    failed.join("\n"),
  );
  assert.ok(
    failed.some((message) => message.includes("axios")),
    failed.join("\n"),
  );
  assert.ok(
    !failed.some((message) => message.includes("@tanstack/react-query")),
  );

  const angular = await doctor(
    resolveOptions({ http: "angular", target: "requests", input: "x.json" }),
    { cwd: dir },
  );
  const missing = angular
    .filter((item) => item.level === "fail")
    .map((item) => item.message);
  assert.ok(missing.some((message) => message.includes("@angular/common")));
  assert.ok(missing.some((message) => message.includes("rxjs")));

  const apiClient = await doctor(
    resolveOptions({ http: "api-client", target: "requests", input: "x.json" }),
    { cwd: dir },
  );
  assert.ok(
    apiClient.some(
      (item) =>
        item.level === "fail" && item.message.includes("@mrzr/api-client"),
    ),
  );
});

test("api-client's delete takes no body, so a DELETE with one is left out and the key cannot be named", () => {
  assert.equal(resolveOptions({ http: "api-client" }).runtime.requestKeys.body, false);
  assert.equal(resolveOptions({ http: "fetch", target: "requests" }).runtime.requestKeys.body, "body");
  // The built-in transport would drop the body without a word, so naming a key is an error.
  assert.throws(
    () =>
      resolveOptions({
        http: "api-client",
        runtime: { requestKeys: { body: "data" } },
      }),
    /requestKeys\.body cannot be set with http: "api-client"/,
  );
  // A custom transport is the project's own: it may name the key.
  assert.equal(
    resolveOptions({
      client: "custom",
      http: "api-client",
      runtime: { requestKeys: { body: "data" } },
    }).runtime.requestKeys.body,
    "data",
  );
});

test("the api-client client is one line the project edits: its own client, nothing to configure", () => {
  const client = runtimeFiles(resolveOptions({ http: "api-client" })).get("client.ts");
  assert.match(client, /import \{ createClient \} from "@mrzr\/api-client"/);
  assert.doesNotMatch(client, /configureClient/);
  // The placeholder instance has the client's own defaults: no option of ours (worker, baseUrl, …).
  assert.match(client, /export const apiClient = createClient\(\);/);
});

test("no built-in client sets an option that changes how its client behaves", () => {
  // The rule in CLAUDE.md: the clients are used as they are. These are the
  // options that would make one client act like another.
  const forbidden =
    /validateStatus|throwError|throwOnCancel|stringifyBody|fullData|worker:|arraybuffer|arrayBuffer|observe:|withCredentials|credentials:|timeout|retry/;
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  for (const [http, library] of [["axios", "react-query"], ["api-client", "react-query"], ["fetch", "react-query"], ["angular", "angular-query"]]) {
    const target = http === "fetch" ? "requests" : "hooks";
    const files = build({ http, library, target, infinite: true });
    for (const [name, text] of files)
      assert.doesNotMatch(strip(text), forbidden, `${http} ${name}`);
    for (const [name, text] of runtimeFiles(resolveOptions({ http, library, target })))
      assert.doesNotMatch(strip(text), forbidden, `${http} ${name}`);
  }
});
