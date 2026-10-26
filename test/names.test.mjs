import assert from "node:assert/strict";
import { test } from "node:test";

import {
  camelCase,
  identifier,
  modelName,
  oneLine,
  pascalCase,
  propertyName,
} from "../dist/names.js";

test("camelCase and pascalCase read separators", () => {
  assert.equal(camelCase("plate lists"), "plateLists");
  assert.equal(camelCase("user_id"), "userId");
  assert.equal(pascalCase("list-pets"), "ListPets");
});

test("identifier avoids reserved words and empty names", () => {
  assert.equal(identifier("delete pet", "x"), "deletePet");
  assert.equal(identifier("new", "fallback"), "fallback");
  assert.equal(identifier("---", "fallback"), "fallback");
});

test("propertyName quotes what has to be quoted", () => {
  assert.equal(propertyName("name"), "name");
  assert.equal(propertyName("x-y"), '"x-y"');
  assert.equal(propertyName("class"), '"class"');
});

test("modelName turns a $ref into a type name", () => {
  assert.equal(modelName("#/components/schemas/handler.LoginBody"), "HandlerLoginBody");
});

test("oneLine flattens prose and defuses comment terminators", () => {
  assert.equal(oneLine("a\n  b */ c"), "a b * / c");
});
