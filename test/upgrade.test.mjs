import assert from "node:assert/strict";
import { test } from "node:test";

import { emit } from "../src/emit.mjs";
import { upgradeDocument } from "../src/load/upgrade.mjs";
import { options } from "./helpers.mjs";

const swagger = () => ({
  swagger: "2.0",
  info: { title: "t", version: "1" },
  host: "api.example.com",
  basePath: "/v1",
  paths: {
    "/pets/{id}": {
      parameters: [{ name: "id", in: "path", required: true, type: "integer" }],
      get: {
        operationId: "getPet",
        tags: ["pets"],
        parameters: [
          {
            name: "tags",
            in: "query",
            type: "array",
            items: { type: "string" },
            collectionFormat: "multi",
          },
        ],
        responses: {
          200: { description: "ok", schema: { $ref: "#/definitions/Pet" } },
        },
      },
      put: {
        operationId: "putPet",
        tags: ["pets"],
        parameters: [
          {
            name: "body",
            in: "body",
            required: true,
            schema: { $ref: "#/definitions/Pet" },
          },
        ],
        responses: { 200: { description: "ok" } },
      },
      post: {
        operationId: "uploadPet",
        tags: ["pets"],
        consumes: ["multipart/form-data"],
        parameters: [
          { name: "file", in: "formData", type: "file", required: true },
          { name: "note", in: "formData", type: "string" },
        ],
        responses: { 200: { description: "ok" } },
      },
    },
  },
  definitions: {
    Pet: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "integer" },
        name: { type: "string", "x-nullable": true },
      },
    },
  },
});

test("Swagger 2.0 becomes OpenAPI 3.0", () => {
  const doc = upgradeDocument(swagger());
  assert.equal(doc.openapi, "3.0.3");
  assert.equal(doc.servers[0].url, "https://api.example.com/v1");
  assert.ok(doc.components.schemas.Pet);
  assert.equal(doc.components.schemas.Pet.properties.name.nullable, true);
  const get = doc.paths["/pets/{id}"].get;
  assert.equal(
    get.responses[200].content["application/json"].schema.$ref,
    "#/components/schemas/Pet",
  );
  assert.equal(
    get.parameters.find((item) => item.name === "tags").schema.type,
    "array",
  );
  const put = doc.paths["/pets/{id}"].put;
  assert.equal(
    put.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/Pet",
  );
  const upload =
    doc.paths["/pets/{id}"].post.requestBody.content["multipart/form-data"]
      .schema;
  assert.equal(upload.properties.file.format, "binary");
  assert.deepEqual(upload.required, ["file"]);
});

test("a Swagger 2.0 document emits real models and typed requests", () => {
  const pets = emit(swagger(), options(), "swagger.json");
  assert.match(pets.files.get("models.ts"), /export type Pet = \{/);
  const code = pets.files.get("pets.ts");
  assert.match(code, /export function getPet\(\s*id: number,\s*query/);
  assert.match(code, /export function putPet\(\s*id: number,\s*body: Pet/);
  assert.equal(pets.problems.length, 0);
});

test("OpenAPI 3.1 nullable types and constants become 3.0 ones", () => {
  const doc = upgradeDocument({
    openapi: "3.1.0",
    paths: {},
    components: {
      schemas: {
        A: {
          type: "object",
          properties: {
            maybe: { type: ["string", "null"] },
            either: { type: ["string", "integer"] },
            kind: { const: "a" },
            type: { type: "string" },
          },
        },
      },
    },
  });
  const { maybe, either, kind, type } = doc.components.schemas.A.properties;
  assert.deepEqual(maybe, { type: "string", nullable: true });
  assert.deepEqual(either.oneOf, [{ type: "string" }, { type: "integer" }]);
  assert.deepEqual(kind.enum, ["a"]);
  assert.equal(type.type, "string");
});

test("a 3.0 document is returned untouched", () => {
  const doc = { openapi: "3.0.1", paths: {} };
  assert.equal(upgradeDocument(doc), doc);
});

test("schemas are named consistently and never shadow a global type", () => {
  const { files } = emit(
    {
      openapi: "3.0.1",
      paths: {},
      components: {
        schemas: {
          pet: {
            type: "object",
            properties: { o: { $ref: "#/components/schemas/Object" } },
          },
          Object: { type: "object", properties: { a: { type: "string" } } },
        },
      },
    },
    options(),
    "x",
  );
  const models = files.get("models.ts");
  assert.match(models, /export type Pet = \{\s*o\?: ObjectModel;/);
  assert.match(models, /export type ObjectModel = \{/);
});
