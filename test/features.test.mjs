import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { doctor } from "../dist/doctor.js";
import { emit } from "../dist/emit.js";
import { watchRun } from "../dist/watch.js";
import { options, petstore } from "./helpers.mjs";

const paged = () => ({
  openapi: "3.0.1",
  paths: {
    "/items": {
      get: {
        operationId: "listItems",
        tags: ["items"],
        parameters: ["start", "offset", "q"].map((name) => ({
          name,
          in: "query",
          schema: { type: name === "q" ? "string" : "integer" },
        })),
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    result: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        count: { type: "integer" },
                        list: {
                          type: "array",
                          items: { $ref: "#/components/schemas/Item" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Item: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "integer" },
          kind: { enum: ["a", "b"] },
          parent: { $ref: "#/components/schemas/Item" },
        },
      },
    },
  },
});

test("nothing extra is emitted unless asked for", () => {
  const { files } = emit(paged(), options(), "x");
  assert.ok(!files.has("schemas.ts"));
  assert.doesNotMatch(files.get("items.ts"), /Infinite/);
});

test("infinite adds one hook and one key to a paged read", () => {
  const items = emit(paged(), options({ infinite: true }), "x").files.get(
    "items.ts",
  );
  assert.match(
    items,
    /useListItemsInfiniteQuery\(\s*query: Omit<ListItemsQuery, "start" \| "offset"> = \{\}/,
  );
  assert.match(items, /listItemsInfinite: \(params:/);
  assert.match(items, /start: page\.start, offset: page\.size/);
});

test("infinite skips a read that lacks the paging parameters", () => {
  const { files } = emit(petstore(), options({ infinite: true }), "x");
  assert.doesNotMatch([...files.values()].join(""), /InfiniteQuery/);
});

test("zod writes a validator per model, tied to its type", () => {
  const { files } = emit(paged(), options({ zod: true }), "x");
  const schemas = files.get("schemas.ts");
  assert.match(
    schemas,
    /export const itemSchema: z\.ZodType<Item> = z\.object/,
  );
  assert.match(schemas, /kind: z\.enum\(\["a", "b"\]\)\.optional\(\)/);
  assert.match(schemas, /parent: z\.lazy\(\(\) => itemSchema\)\.optional\(\)/);
  assert.match(files.get("index.ts"), /export \* from "\.\/schemas"/);
});

test("doctor reports a missing input and passes a good one", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "forge-doctor-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ dependencies: {} }),
  );
  const missing = await doctor(options({ input: "nope.json", format: false }), {
    cwd,
  });
  assert.ok(missing.some((item) => item.level === "fail"));

  await writeFile(join(cwd, "api.json"), JSON.stringify(paged()));
  const good = await doctor(
    options({ input: "api.json", target: "requests", format: false }),
    { cwd },
  );
  assert.deepEqual(
    good.filter((item) => item.level === "fail"),
    [],
  );
});

test("watch rebuilds once for a burst of changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "forge-watch-"));
  await mkdir(dir, { recursive: true });
  let runs = 0;
  const stop = watchRun(async () => void (runs += 1), { paths: [dir] });
  await new Promise((done) => setTimeout(done, 100));
  for (const name of ["a", "b", "c"]) await writeFile(join(dir, name), name);
  await new Promise((done) => setTimeout(done, 600));
  stop();
  assert.equal(runs, 2); // the first build, then one for the burst
});

const withQueries = (...queries) => ({
  openapi: "3.0.1",
  paths: Object.fromEntries(
    queries.map((names, index) => [
      `/things${index}`,
      {
        get: {
          operationId: `listThings${index}`,
          tags: ["things"],
          parameters: names.map((name) => ({
            name: name.replace("!", ""),
            in: "query",
            required: name.endsWith("!"),
            schema: { type: "string" },
          })),
          responses: { 200: {} },
        },
      },
    ]),
  ),
});

const base = ["a", "b", "c", "d", "e", "f", "g", "h"];

test("a query that differs in one property is derived from the first", () => {
  const things = emit(
    withQueries(base, [...base.slice(0, 7), "h!"], [...base, "i", "j", "k"]),
    options(),
    "x",
  ).files.get("things.ts");
  assert.match(
    things,
    /ListThings1Query = Omit<ListThings0Query, "h"> & \{\s*h: string;\s*\}/,
  );
  assert.match(things, /ListThings2Query = \{[^}]*i\?: string/); // too far to derive
});

test("an identical query is an alias, not a derivation", () => {
  const things = emit(withQueries(base, base), options(), "x").files.get(
    "things.ts",
  );
  assert.match(things, /ListThings1Query = ListThings0Query;/);
});

test("an incomplete document still emits valid types and lists what is missing", () => {
  const doc = paged();
  doc.paths["/items"].get.responses = {
    200: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Missing" },
        },
      },
    },
  };
  doc.components.schemas.Loose = { type: "object", properties: { any: {} } };
  const { files, problems } = emit(doc, options(), "x");
  assert.match(files.get("items.ts"), /apiGet<unknown>/);
  const text = problems
    .map((item) => `${item.where} ${item.message}`)
    .join("\n");
  assert.match(
    text,
    /GET \/items response refers to #\/components\/schemas\/Missing/,
  );
  assert.match(text, /schema Loose declares no type/);
});

test("a complete document reports nothing", () => {
  assert.deepEqual(emit(paged(), options(), "x").problems, []);
});
