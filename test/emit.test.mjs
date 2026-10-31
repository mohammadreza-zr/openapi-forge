import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveOptions } from "../dist/config.js";
import { emit } from "../dist/emit.js";
import { runtimeFiles } from "../dist/runtime/index.js";
import { options, petstore } from "./helpers.mjs";

// The product's default client is called straight on the client, with its own answer type.
const run = (patch) =>
  emit(petstore(), options({ http: "api-client", ...patch }), "petstore.yaml");

test("one module per tag, plus models, services and index", () => {
  const { files, operations, tags } = run();
  assert.deepEqual([...files.keys()].sort(), [
    "index.ts",
    "models.ts",
    "owners.ts",
    "pets.ts",
    "services.ts",
  ]);
  assert.equal(operations, 6);
  assert.equal(tags, 2);
});

test("routes lose the api prefix and are written once", () => {
  const pets = run().files.get("pets.ts");
  // The route is written in the tag's `Endpoints` map; the request function reads it from there.
  assert.match(pets, /export const petsEndpoints = \{/);
  assert.match(pets, /getPet: "\/pets\/\{pet_id\}",/);
  assert.match(pets, /listPets: "\/pets",/);
  assert.match(pets, /apiClient\.get<Pet>\(\s*petsEndpoints\.getPet,/);
  assert.match(pets, /apiClient\.get<ApiListData<Pet>>\(\s*petsEndpoints\.listPets,/);
  assert.equal(pets.match(/"\/pets\/\{pet_id\}\/photo"/g)?.length, 1);
});

test("the envelope is unwrapped and a { count, list } answer is a list type", () => {
  const files = run().files;
  assert.match(files.get("pets.ts"), /apiClient\.get<ApiListData<Pet>>/);
  assert.match(files.get("pets.ts"), /apiClient\.post<Pet>/);
  assert.match(files.get("models.ts"), /export type PetEnvelope = ApiEnvelope<Pet>;/);
  assert.doesNotMatch(files.get("models.ts"), /EnvelopeBase/);
});

test("read operations get keys and query hooks, writes get mutation hooks", () => {
  const pets = run().files.get("pets.ts");
  assert.match(pets, /export const petsKeys = \{/);
  assert.match(pets, /export function useListPetsQuery\(/);
  assert.match(pets, /export function useCreatePetMutation\(/);
  assert.match(pets, /export type CreatePetVariables = \{/);
  assert.match(pets, /@deprecated/);
});

test("a detail query takes its id as it is: no undefined, no guard", () => {
  const pets = run().files.get("pets.ts");
  assert.match(pets, /useGetPetQuery\(\s*petId: string,/);
  assert.doesNotMatch(pets, /petId!|petId \?\? |enabled: petId/);
});

test("target requests emits functions only", () => {
  const pets = run({ target: "requests" }).files.get("pets.ts");
  assert.match(pets, /export function listPets\(/);
  assert.doesNotMatch(pets, /Keys|useListPetsQuery|Variables/);
  assert.doesNotMatch(pets, /hooks/);
});

test("a multipart body is a FormData, whatever the client", () => {
  // Every built-in client sees the FormData and sets the Content-Type itself.
  for (const http of ["fetch", "axios", "api-client"]) {
    const files = run({ http }).files;
    assert.match(files.get("pets.ts"), /body\?: FormData/, http);
    assert.doesNotMatch(files.get("pets.ts"), /isFormData/, http);
    assert.match(files.get("models.ts"), /file\?: Blob;/, http);
  }
});

test("fetch has no base URL, so a main-service route keeps the whole path", () => {
  const route = (http) =>
    run({ http }).files.get("pets.ts").match(/getPet: "([^"]+)"/)[1];
  assert.equal(route("axios"), "/pets/{pet_id}");
  assert.equal(route("api-client"), "/pets/{pet_id}");
  assert.equal(route("fetch"), "/api/v1/pets/{pet_id}");
});

test("a service with no base URL is reported, not left to fail at start-up", () => {
  const spec = petstore();
  for (const item of Object.values(spec.paths))
    for (const operation of Object.values(item)) operation["x-service"] = "pets";
  const said = (patch) =>
    emit(spec, options(patch), "x").problems.map((item) => `${item.where} ${item.message}`).join("\n");
  assert.match(said({}), /service pets has no base URL/);
  assert.doesNotMatch(said({ runtime: { services: { baseUrls: { pets: "https://pets.test" } } } }), /base URL/);
  assert.doesNotMatch(said({ runtime: { services: { module: "./env", fn: "serviceBaseUrl" } } }), /base URL/);
});

test("tags can be included or excluded", () => {
  assert.deepEqual([...run({ tags: { include: ["Pets"] } }).files.keys()].includes("owners.ts"), false);
  assert.deepEqual([...run({ tags: { exclude: ["Pets"] } }).files.keys()].includes("pets.ts"), false);
});

test("a custom runtime changes what the code imports and calls", () => {
  const pets = run({
    client: "custom",
    runtime: {
      callers: { module: "@app/http", get: "httpGet" },
      hooks: { module: "@app/hooks", query: "useQ" },
      requestKeys: { query: "searchParams", pathParams: "pathVars" },
    },
  }).files.get("pets.ts");
  assert.match(pets, /import \{ .*httpGet.* \} from "@app\/http";/);
  assert.match(pets, /import \{ .*useQ.* \} from "@app\/hooks";/);
  assert.match(pets, /\.\.\.config,\s*searchParams,/);
  assert.match(pets, /pathVars: \{ pet_id: petId \}/);
});

test("envelope and list handling can be switched off", () => {
  const pets = run({ runtime: { envelope: false, list: false } }).files.get(
    "pets.ts",
  );
  assert.doesNotMatch(pets, /ApiListData/);
  assert.match(pets, /\.post<PetEnvelope>/);
});

test("transform hooks rename, rewrite and drop", () => {
  const files = run({
    transform: {
      queryParam: (name) => name.toUpperCase(),
      operationName: (operation) =>
        operation.name === "listPets" ? "searchPets" : undefined,
      fileName: (tag) => tag.toLowerCase() + "-api",
      operation: (operation) => (operation.name === "deletePet" ? null : operation),
    },
  }).files;
  const pets = files.get("pets-api.ts");
  assert.match(pets, /export function searchPets\(/);
  assert.match(pets, /START\?: number;/);
  assert.doesNotMatch(pets, /deletePet/);
  assert.match(files.get("index.ts"), /export \* from "\.\/pets-api";/);
});

test("services mark operations with their base URL", () => {
  const spec = petstore();
  for (const item of Object.values(spec.paths))
    for (const operation of Object.values(item)) operation["x-service"] = "pets";
  const files = emit(
    spec,
    options({ runtime: { services: { baseUrls: { pets: "https://pets.test" } } } }),
    "x",
  ).files;
  assert.match(files.get("services.ts"), /"pets": "https:\/\/pets\.test"/);
  assert.match(files.get("pets.ts"), /baseURL: config\?\.baseURL \?\? API_SERVICE_BASE_URLS\["pets"\]/);
  // @mrzr/api-client keeps a service of its own in its `services` plugin: the call names the service, nothing else.
  const apiClient = emit(spec, options({ http: "api-client" }), "x");
  assert.deepEqual(apiClient.services, ["pets"]);
  assert.match(apiClient.files.get("pets.ts"), /apiClient\.service\("pets"\)\.get</);
  assert.doesNotMatch(apiClient.files.get("pets.ts"), /baseUrl|API_SERVICE_BASE_URLS/);
  const withServices = runtimeFiles(resolveOptions({ http: "api-client" }), ["pets"]).get("client.ts");
  assert.match(withServices, /import \{ services \} from "@mrzr\/api-client\/services"/);
  assert.match(withServices, /plugins: \[services\(API_SERVICE_BASE_URLS\)\]/);
  assert.doesNotMatch(runtimeFiles(resolveOptions({ http: "api-client" })).get("client.ts"), /services/);
  const fetched = emit(spec, options({ http: "fetch" }), "x").files.get("pets.ts");
  assert.match(fetched, /fetch\(API_SERVICE_BASE_URLS\["pets"\] \+ petsEndpoints\./);
});

test("the banner names the generator and the source", () => {
  const { files } = emit(petstore(), options({ generatorName: "my-gen" }), "api.json");
  assert.match(files.get("models.ts"), /auto-generated by my-gen from api\.json/);
});

test("Go-style schema names become identifiers and every $ref follows", () => {
  const spec = petstore();
  spec.components.schemas["handler.Pet"] = spec.components.schemas.Pet;
  delete spec.components.schemas.Pet;
  spec.components.schemas.PetEnvelope.allOf[1].properties.data.$ref =
    "#/components/schemas/handler.Pet";
  const { files } = emit(spec, options({ http: "api-client" }), "x");
  assert.match(files.get("models.ts"), /export type HandlerPet = \{/);
  assert.match(files.get("pets.ts"), /\.post<HandlerPet>/);
});

test("an operationId used twice gets the method appended, and a number only if that is taken too", () => {
  const operation = (operationId) => ({
    operationId,
    responses: { 200: { description: "ok" } },
  });
  const doc = {
    openapi: "3.0.3",
    info: { title: "t", version: "1" },
    paths: {
      "/a": { get: operation("getThing"), post: operation("save") },
      "/b": { get: operation("getThing"), put: operation("save") },
      "/c": { get: operation("getThing") },
      "/d": { get: operation("getThingGet") },
    },
  };
  const { files } = emit(doc, options({ target: "requests" }), "t.yaml");
  const names = [
    ...[...files.values()].join("\n").matchAll(/^export function (\w+)\(/gm),
  ].map((match) => match[1]);
  // The second `getThing` took `getThingGet`, so the third is `getThingGet2` and an operation really named `getThingGet` moves on.
  assert.deepEqual(names.sort(), [
    "getThing",
    "getThingGet",
    "getThingGet2",
    "getThingGetGet",
    "save",
    "savePut",
  ]);
});

test("an operationId or path argument that is a reserved word still gives valid code", () => {
  const operation = (operationId, parameters = []) => ({
    operationId,
    parameters,
    responses: { 200: { description: "ok" } },
  });
  const doc = {
    openapi: "3.0.3",
    info: { title: "t", version: "1" },
    paths: {
      "/a": { get: operation("delete") },
      "/b": { get: operation("2fa") },
      "/c/{in}": {
        get: operation("getC", [
          { name: "in", in: "path", required: true, schema: { type: "string" } },
        ]),
      },
    },
  };
  const { files } = emit(doc, options({ target: "requests" }), "t.yaml");
  const source = [...files.values()].join("\n");
  assert.doesNotMatch(source, /function (delete|2fa)\(/);
  assert.doesNotMatch(source, /\(in:/);
  assert.match(source, /function getC\(getCPath: string/);
});

test("a schema named with a leading digit gets a valid type and validator name", () => {
  const doc = {
    openapi: "3.0.3",
    info: { title: "t", version: "1" },
    paths: {
      "/a": {
        get: {
          operationId: "getA",
          responses: {
            200: {
              description: "ok",
              content: { "application/json": { schema: { $ref: "#/components/schemas/2FA" } } },
            },
          },
        },
      },
    },
    components: { schemas: { "2FA": { type: "object", properties: { code: { type: "string" } } } } },
  };
  const { files } = emit(doc, options({ zod: true }), "t.yaml");
  assert.match(files.get("models.ts"), /export type _2FA = \{/);
  assert.match(files.get("schemas.ts"), /export const _2FASchema: z\.ZodType<_2FA>/);
});

test("write variables that differ only by an aliased header type are one type", () => {
  const header = { name: "Accept-Language", in: "header", schema: { type: "string" } };
  const write = (operationId) => ({
    operationId,
    parameters: [header],
    requestBody: {
      required: true,
      content: { "application/json": { schema: { $ref: "#/components/schemas/Ref" } } },
    },
    responses: { 200: { description: "ok" } },
  });
  const doc = {
    openapi: "3.0.3",
    info: { title: "t", version: "1" },
    paths: {
      "/a": { post: write("removeUser") },
      "/b": { post: write("revokeUser") },
    },
    components: { schemas: { Ref: { type: "object", properties: { id: { type: "string" } } } } },
  };
  const { files } = emit(doc, options(), "t.yaml");
  const source = files.get("default.ts");
  assert.match(source, /export type RevokeUserHeaders = RemoveUserHeaders;/);
  assert.match(source, /export type RevokeUserVariables = RemoveUserVariables;/);
});

// ── which identical models become one ───────────────────────────────────────

const shaped = (schemas, answers) => ({
  openapi: "3.0.3",
  info: { title: "t", version: "1" },
  paths: Object.fromEntries(
    Object.entries(answers).map(([path, schema]) => [
      path,
      {
        get: {
          operationId: path.slice(1),
          responses: { 200: { description: "ok", content: { "application/json": { schema } } } },
        },
      },
    ]),
  ),
  components: { schemas },
});
const fields = (...names) => ({
  type: "object",
  properties: Object.fromEntries(names.map((name) => [name, { type: "string" }])),
});

test("two schemas the document names stay two types, whatever their shape", () => {
  const doc = shaped(
    { AccountBody: fields("a", "b", "c", "d"), AdminEditBody: fields("a", "b", "c", "d") },
    { "/one": { $ref: "#/components/schemas/AccountBody" }, "/two": { $ref: "#/components/schemas/AdminEditBody" } },
  );
  const models = emit(doc, options(), "t.yaml").files.get("models.ts");
  assert.match(models, /export type AccountBody = \{/);
  assert.match(models, /export type AdminEditBody = \{/);
});

test("an inline object that says something of its own uses the schema it repeats", () => {
  const doc = shaped(
    { Page: fields("a", "b", "c") },
    { "/page": fields("a", "b", "c") },
  );
  const models = emit(doc, options(), "t.yaml").files.get("models.ts");
  assert.match(models, /export type Page = \{/);
  assert.match(models, /export type PageResponse = Page;/);
});

test("a bare { id, name } is a coincidence, not one model", () => {
  const doc = shaped(
    { Tag: fields("id", "name") },
    { "/one": fields("id", "name"), "/two": fields("id", "name") },
  );
  const models = emit(doc, options(), "t.yaml").files.get("models.ts");
  assert.doesNotMatch(models, /export type \w+ = (Tag|OneResponse);/);
  assert.match(models, /export type OneResponse = \{/);
  assert.match(models, /export type TwoResponse = \{/);
});

test("a key is the tag, the route from the Endpoints map and what its answer depends on", () => {
  const pets = run().files.get("pets.ts");
  assert.match(pets, /all: \["Pets"\] as const,/);
  assert.match(pets, /listPets: \(params: ListPetsQuery\) =>\s*\[\.\.\.petsKeys\.all, petsEndpoints\.listPets, params\] as const,/);
  assert.match(pets, /getPet: \(petId: string\) =>\s*\[\.\.\.petsKeys\.all, petsEndpoints\.getPet, petId\] as const,/);
  // The route is read from the map, never spelled in a key; no list / detail layer.
  const keys = pets.slice(pets.indexOf("export const petsKeys"), pets.indexOf("} as const;", pets.indexOf("export const petsKeys")));
  assert.doesNotMatch(keys, /\/pets|lists\(\)|details\(\)/);
});
