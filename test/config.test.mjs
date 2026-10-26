import assert from "node:assert/strict";
import { test } from "node:test";

import { merge, resolveOptions } from "../src/config.mjs";

test("defaults are filled in", () => {
  const options = resolveOptions();
  assert.equal(options.client, "builtin");
  assert.equal(options.target, "hooks");
  assert.equal(options.runtime.callers.get, "apiGet");
});

test("nested options merge instead of replacing", () => {
  const options = resolveOptions({ runtime: { callers: { module: "@x/http" } } });
  assert.equal(options.runtime.callers.module, "@x/http");
  assert.equal(options.runtime.callers.post, "apiPost");
});

test("the command line wins over the file", () => {
  assert.equal(resolveOptions({ out: "a" }, { out: "b" }).out, "b");
});

test("bad choices are named", () => {
  assert.throws(() => resolveOptions({ client: "magic" }), /client must be/);
  assert.throws(() => resolveOptions({ target: "nope" }), /target must be/);
});

test("a single tag filter becomes a list", () => {
  assert.deepEqual(resolveOptions({ tags: { include: "Pets" } }).tags.include, ["Pets"]);
});

test("merge replaces arrays and primitives", () => {
  assert.deepEqual(merge({ a: [1], b: 1, c: { d: 1 } }, { a: [2], c: { e: 2 } }), {
    a: [2],
    b: 1,
    c: { d: 1, e: 2 },
  });
});
