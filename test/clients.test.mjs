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
import { LIBRARIES, LIBRARY_NAMES } from "../dist/runtime/libraries/index.js";
import { clients, options } from "./helpers.mjs";

const build = (patch) =>
  emit(clients(), options({ infinite: true, ...patch }), "x").files;

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
    assert.match(pets, /useGetPetQuery\(petId: string \| undefined, options\?/);
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
        `${prefix}ListVisitsQuery\\(\\s*petId: MaybeGetter<string \\| undefined>,\\s*query: MaybeGetter<ListVisitsQuery>,`,
      ),
      library,
    );
    assert.match(
      pets,
      /\(\) => petsKeys\.listVisits\(toValue\(petId\) \?\? "", toValue\(query\)\)/,
    );
    assert.match(
      pets,
      /\(signal\) => listVisits\(toValue\(petId\)!, toValue\(query\), \{ signal \}\)/,
    );
    assert.match(
      pets,
      /\(\) => \[toValue\(petId\)\]\.every\(\(value\) => value !== undefined && !Number\.isNaN\(value\)\)/,
    );
    assert.match(
      pets,
      /query: MaybeGetter<Omit<ListPetsQuery, "start" \| "offset">> = \{\}/,
    );
    assert.match(
      pets,
      /\.\.\.toValue\(query\), start: page\.start, offset: page\.size/,
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
    /useCreatePetMutation\(\s*options\?: ApiMutationOptions<Pet, CreatePetVariables>/,
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

test("http picks what the built-in client sends with", () => {
  const fetchClient = runtimeFiles(resolveOptions()).get("client.ts");
  const axiosClient = runtimeFiles(resolveOptions({ http: "axios" })).get(
    "client.ts",
  );
  assert.match(fetchClient, /await fetch\(url/);
  assert.doesNotMatch(fetchClient, /axios/);
  assert.match(
    axiosClient,
    /import axios, \{ type AxiosInstance \} from "axios"/,
  );
  assert.match(axiosClient, /instance: axios\.create\(\)/);
  assert.match(axiosClient, /validateStatus: \(\) => true/);
  assert.doesNotMatch(axiosClient, /await fetch\(/);
});

test("both clients build the request and read the answer the same way", () => {
  const body = (text) =>
    text.slice(
      text.indexOf("function buildUrl"),
      text.indexOf("async function send"),
    ) + text.slice(text.indexOf("async function request"));
  assert.equal(
    body(runtimeFiles(resolveOptions()).get("client.ts")),
    body(runtimeFiles(resolveOptions({ http: "axios" })).get("client.ts")),
  );
});

test("an unknown library or http client is named", () => {
  assert.throws(
    () => resolveOptions({ library: "magic" }),
    /library must be one of react-query/,
  );
  assert.throws(
    () => resolveOptions({ http: "ky" }),
    /http must be "fetch" or "axios"/,
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
});
