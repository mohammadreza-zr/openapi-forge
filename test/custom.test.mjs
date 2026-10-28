// A custom transport knows its own config type and nothing of the keys the
// built-in one reads. The code written for it must compile against that type
// (an extra key is an excess-property error) and must call it with only the
// keys it has — checked by compiling and running it against a tiny transport.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import { compileCjs, generateTo } from "./harness.mjs";
import { EDGES_FIXTURE } from "./helpers.mjs";

const TRANSPORT = `
export type MyConfig<T = unknown> = {
  signal?: AbortSignal;
  params?: Record<string, unknown>;
  addTemplateToUrl?: Record<string, unknown>;
  isFormData?: boolean;
  baseUrl?: string;
  readonly __payload?: T;
};
export type ApiEnvelope<T> = { result: boolean; data: T };
export type ApiListData<T> = { count: number; list: T[] };

export const calls: { verb: string; route: string; config?: object }[] = [];
const call = (verb: string) => async (route: string, ...rest: unknown[]) => {
  calls.push({ verb, route, config: rest.at(-1) as object });
  return undefined as never;
};
export const apiGet = <T>(route: string, config?: MyConfig<T>): Promise<T> =>
  call("get")(route, config);
export const apiPost = <T>(route: string, _body: unknown, config?: MyConfig<T>): Promise<T> =>
  call("post")(route, config);
export const apiPut = apiPost;
export const apiPatch = apiPost;
export const apiDelete = <T>(route: string, config?: MyConfig<T>): Promise<T> =>
  call("delete")(route, config);
`;

async function layer(name, patch) {
  const dir = await generateTo(name, {
    client: "custom",
    target: "requests",
    runtime: {
      callers: { module: "./transport" },
      types: { module: "./transport", request: "MyConfig" },
      envelope: { module: "./transport" },
      list: { module: "./transport" },
    },
    ...patch,
  });
  writeFileSync(join(dir, "ts/transport.ts"), TRANSPORT);
  const js = compileCjs(dir);
  const require = createRequire(join(dir, "load.cjs"));
  return { js, require, transport: require(join(js, "transport.js")) };
}

test("a custom transport is called with only the keys it has, and the envelope is its own business", async () => {
  const { js, require, transport } = await layer("custom-clients", {});
  const pets = require(join(js, "pets.js"));
  await pets.getPet("7");
  await pets.listPets({ kind: "cat" });
  await pets.createPet({ name: "Rex" });
  assert.deepEqual(
    transport.calls.map(({ verb, route }) => `${verb} ${route}`),
    ["get /pets/{pet_id}", "get /pets", "post /pets"],
  );
  for (const { config } of transport.calls) {
    for (const key of Object.keys(config))
      assert.ok(
        ["params", "addTemplateToUrl"].includes(key),
        `unexpected key ${key}`,
      );
  }
});

test("what a custom transport cannot carry is reported and left out, not sent anyway", async () => {
  const { js, require, transport } = await layer("custom-edges", {
    input: EDGES_FIXTURE,
  });
  const edges = require(join(js, "edges.js"));
  // A header parameter is no argument, so the signature is the transport's own.
  await edges.getTenant({ q: "x" });
  // A form keeps the flag it knew; the DELETE with a body is not generated.
  await edges.sendForm({ a: "1" });
  assert.equal(edges.remove, undefined);
  const [tenant, form] = transport.calls;
  assert.deepEqual(Object.keys(tenant.config).sort(), ["params"]);
  assert.deepEqual(Object.keys(form.config), ["isFormData"]);
});
