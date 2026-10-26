import assert from "node:assert/strict";
import { test } from "node:test";

import {
  diffDocuments,
  exceeds,
  renderReport,
  summarize,
} from "../dist/diff.js";

const base = () => ({
  openapi: "3.0.1",
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Pet" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "integer" }, name: { type: "string" } },
      },
    },
  },
});

const kinds = (findings) => findings.map((item) => item.kind).sort();

test("identical documents have no findings", () => {
  assert.deepEqual(diffDocuments(base(), base()), []);
});

test("classifies additions, removals and type changes", () => {
  const next = base();
  next.paths["/pets"].get.parameters.push({
    name: "owner",
    in: "query",
    required: true,
    schema: { type: "string" },
  });
  next.paths["/pets"].post = { operationId: "addPet", responses: { 201: {} } };
  delete next.components.schemas.Pet.properties.name;
  next.components.schemas.Pet.properties.id.type = "string";
  next.components.schemas.Pet.properties.tag = { type: "string" };
  const findings = diffDocuments(base(), next);
  assert.deepEqual(kinds(findings), [
    "operation-added",
    "parameter-added",
    "property-added",
    "property-removed",
    "property-type",
  ]);
  assert.equal(findings[0].severity, "breaking");
  assert.deepEqual(summarize(findings), { breaking: 3, risky: 0, safe: 2 });
  assert.equal(
    findings.find((item) => item.kind === "parameter-added").hook,
    "useListPetsQuery",
  );
});

test("a removed operation is breaking and --fail-on gates it", () => {
  const next = base();
  delete next.paths["/pets"];
  const findings = diffDocuments(base(), next);
  assert.ok(exceeds(findings, "breaking"));
  assert.ok(!exceeds(diffDocuments(base(), base()), "safe"));
});

test("reports render in every format", () => {
  const next = base();
  delete next.paths["/pets"];
  const findings = diffDocuments(base(), next);
  assert.match(renderReport(findings, "text"), /✖ GET \/pets/);
  assert.match(
    renderReport(findings, "markdown"),
    /### API changes: 1 breaking/,
  );
  assert.equal(JSON.parse(renderReport(findings, "json")).summary.breaking, 1);
});
