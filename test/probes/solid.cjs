// Run with `node --conditions=browser` (solid-js ships its server build to
// Node otherwise). Usage: solid.cjs <dir with the compiled API> <port>.
// Exits non-zero on the first thing that does not hold.
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { join } = require("node:path");

globalThis.window = globalThis;
const [dir, port, http] = process.argv.slice(2);
const { payloadOf } = require("./point.cjs");
const base = `http://127.0.0.1:${port}`;
const load = createRequire(join(dir, "load.cjs"));
const { createRoot, createSignal, untrack } = load("solid-js");
const { QueryClient, QueryClientProvider } = load("@tanstack/solid-query");
const pets = load(join(dir, "js/pets.js"));
require("./point.cjs").pointClient(
  http,
  load(join(dir, "js/client.js")),
  load,
  `${base}/api/v1`,
);

const asked = () => fetch(`${base}/asked`).then((response) => response.json());
async function until(check, what) {
  for (let waited = 0; waited < 3000; waited += 10) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `timed out waiting for ${what}; the server saw ${JSON.stringify(await asked())}`,
  );
}

async function main() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  const [id, setId] = createSignal("1");
  let query, mutation;
  const dispose = createRoot((dispose) => {
    QueryClientProvider({
      client,
      get children() {
        // A component body is not a tracking scope; `untrack` stands in for one.
        untrack(() => {
          query = pets.createGetPetQuery(id);
          mutation = pets.createCreatePetMutation();
        });
      },
    });
    return dispose;
  });

  await until(() => payloadOf(http, query.data)?.id === "1", "pet 1");
  setId("2");
  await until(() => payloadOf(http, query.data)?.id === "2", "pet 2");
  const seen = await asked();
  assert.ok(
    seen.includes("GET /api/v1/pets/1") && seen.includes("GET /api/v1/pets/2"),
    seen.join(", "),
  );

  const created = await mutation.mutateAsync({ body: { name: "Rex" } });
  assert.deepEqual(payloadOf(http, created), { id: "new", name: "Rex" });

  // Disposing the owner aborts a request still in flight.
  const pending = mutation.mutateAsync({ body: { name: "slow" } });
  // @mrzr/api-client settles a canceled call with no data instead of rejecting.
  const settled =
    http === "api-client"
      ? pending.then(() => undefined)
      : assert.rejects(pending, /abort|cancel/i);
  await new Promise((resolve) => setTimeout(resolve, 50));
  dispose();
  await settled;
  client.clear();
  console.log("solid ok");
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
