import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeSpecs } from "../dist/load/merge.js";

const doc = (paths, schemas = {}) => ({
  openapi: "3.0.3",
  info: { title: "x", version: "1" },
  paths,
  components: { schemas },
});
const get = (id) => ({ get: { operationId: id, responses: {} } });

test("an operation in one service is kept and tagged with it", () => {
  const { doc: merged } = mergeSpecs([
    { name: "a", doc: doc({ "/a": get("a") }) },
    { name: "b", doc: doc({ "/b": get("b") }) },
  ]);
  assert.equal(merged.paths["/a"].get["x-service"], "a");
  assert.equal(merged.paths["/b"].get["x-service"], "b");
});

test("identical copies merge without a decision", () => {
  const { doc: merged, report } = mergeSpecs([
    { name: "a", doc: doc({ "/s": get("s") }, { Shared: { type: "string" } }) },
    { name: "b", doc: doc({ "/s": get("s") }, { Shared: { type: "string" } }) },
  ]);
  assert.equal(report.undecided.length, 0);
  assert.equal(report.identical.length, 2);
  assert.ok(merged.components.schemas.Shared);
});

test("different copies need an owner, and the choice is honoured", () => {
  const services = [
    { name: "a", doc: doc({}, { Shared: { type: "string" } }) },
    { name: "b", doc: doc({}, { Shared: { type: "integer" } }) },
  ];
  const open = mergeSpecs(services);
  assert.deepEqual(open.report.undecided, [
    { key: "#/components/schemas/Shared", services: ["a", "b"] },
  ]);
  const decided = mergeSpecs(services, { "#/components/schemas/Shared": "b" });
  assert.equal(decided.doc.components.schemas.Shared.type, "integer");
});

test("the main service's info wins and tags are folded together", () => {
  const a = { ...doc({}), tags: [{ name: "T" }] };
  const b = { ...doc({}), tags: [{ name: "T" }, { name: "U" }] };
  const { doc: merged } = mergeSpecs([
    { name: "a", doc: a },
    { name: "b", doc: b },
  ]);
  assert.deepEqual(merged.tags.map((tag) => tag.name), ["T", "U"]);
});
