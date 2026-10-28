// Run with `node --conditions=browser`. Usage: solid-edges.cjs <dir with the
// compiled API> <port>. A header argument given as an accessor moves the
// query and is sent; an infinite list sends its header with every page.
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { join } = require("node:path");

globalThis.window = globalThis;
const [dir, port] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const load = createRequire(join(dir, "load.cjs"));
const { createRoot, createSignal, untrack } = load("solid-js");
const { QueryClient, QueryClientProvider } = load("@tanstack/solid-query");
const edges = load(join(dir, "js/edges.js"));
load(join(dir, "js/client.js")).configureClient({ baseUrl: `${base}/api/v1` });

const seen = () => fetch(`${base}/seen`).then((response) => response.json());
async function until(check, what) {
  for (let waited = 0; waited < 3000; waited += 10) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}; saw ${JSON.stringify(await seen())}`);
}
const sentBy = async (path, tenant) =>
  (await seen()).some(
    (item) => item.url.startsWith(path) && item.headers["x-tenant-id"] === tenant,
  );

async function main() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  const [tenant, setTenant] = createSignal("a");
  let query, pages;
  const dispose = createRoot((dispose) => {
    QueryClientProvider({
      client,
      get children() {
        untrack(() => {
          query = edges.createGetTenantQuery({}, () => ({ "X-Tenant-Id": tenant() }));
          pages = edges.createListPagesInfiniteQuery(
            {},
            { "X-Tenant-Id": "t9" },
            { pageSize: 2 },
          );
        });
      },
    });
    return dispose;
  });

  await until(() => query.data !== undefined, "the first answer");
  assert.ok(await sentBy("/api/v1/tenant", "a"));
  setTenant("b");
  await until(() => query.data !== undefined, "an answer");
  for (let i = 0; i < 300 && !(await sentBy("/api/v1/tenant", "b")); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(await sentBy("/api/v1/tenant", "b"), "a request for tenant b");

  await until(() => pages.data?.pages.length === 1, "the first page");
  await pages.fetchNextPage();
  await until(() => pages.data?.pages.length === 2, "the second page");
  assert.deepEqual(pages.data.pages.map((page) => page.list.join()), ["0,1", "2,3"]);
  const asked = (await seen()).filter((item) => item.url.startsWith("/api/v1/pages"));
  assert.ok(asked.length >= 2);
  assert.ok(asked.every((item) => item.headers["x-tenant-id"] === "t9"));

  dispose();
  client.clear();
  console.log("solid edges ok");
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
