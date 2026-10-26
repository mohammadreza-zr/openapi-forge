// Run with `node --conditions=browser` (solid-js ships its server build to
// Node otherwise). Usage: solid.cjs <dir with the compiled API> <port>.
// Exits non-zero on the first thing that does not hold.
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { join } = require("node:path");

globalThis.window = globalThis;
const [dir, port] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const load = createRequire(join(dir, "load.cjs"));
const { createRoot, createSignal, untrack } = load("solid-js");
const { QueryClient, QueryClientProvider } = load("@tanstack/solid-query");
const pets = load(join(dir, "js/pets.js"));
load(join(dir, "js/client.js")).configureClient({ baseUrl: `${base}/api/v1` });

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
  const [later, setLater] = createSignal(undefined);
  let query, waiting, mutation;
  const dispose = createRoot((dispose) => {
    QueryClientProvider({
      client,
      get children() {
        // A component body is not a tracking scope; `untrack` stands in for one.
        untrack(() => {
          query = pets.createGetPetQuery(id);
          waiting = pets.createGetPetQuery(later);
          mutation = pets.createCreatePetMutation();
        });
      },
    });
    return dispose;
  });

  await until(() => query.data?.id === "1", "pet 1");
  setId("2");
  await until(() => query.data?.id === "2", "pet 2");
  const seen = await asked();
  assert.ok(
    seen.includes("GET /api/v1/pets/1") && seen.includes("GET /api/v1/pets/2"),
    seen.join(", "),
  );

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(
    !(await asked()).some((line) => line.includes("undefined")),
    "asked for /pets/undefined",
  );
  assert.equal(waiting.fetchStatus, "idle");
  setLater("8");
  await until(() => waiting.data?.id === "8", "pet 8");

  const created = await mutation.mutateAsync({ body: { name: "Rex" } });
  assert.deepEqual(created, { id: "new", name: "Rex" });

  // Disposing the owner aborts a request still in flight.
  const pending = mutation.mutateAsync({ body: { name: "slow" } });
  const settled = assert.rejects(pending, /abort/i);
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
