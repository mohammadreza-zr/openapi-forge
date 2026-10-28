// Bundled with the Svelte compiler and run under `--import dom.mjs`.
// Usage: node --import dom.mjs bundle.mjs <port>. Exits non-zero on failure.
import assert from "node:assert/strict";
import { flushSync, mount, unmount } from "svelte";
import { QueryClient } from "@tanstack/svelte-query";
import { configureClient } from "@api/client";
import Probe from "./Probe.svelte";

const [port] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
configureClient({ baseUrl: `${base}/api/v1` });

const asked = () => fetch(`${base}/asked`).then((response) => response.json());
async function until(check, what) {
  for (let waited = 0; waited < 3000; waited += 10) {
    flushSync();
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
  let handle;
  const component = mount(Probe, {
    target: document.body,
    props: { client, expose: (value) => (handle = value) },
  });
  flushSync();

  await until(() => handle.query.data?.id === "1", "pet 1");
  handle.setId("2");
  await until(() => handle.query.data?.id === "2", "pet 2");
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
  assert.equal(handle.waiting.fetchStatus, "idle");
  handle.setLater("8");
  await until(() => handle.waiting.data?.id === "8", "pet 8");

  const created = await handle.mutation.mutateAsync({ body: { name: "Rex" } });
  assert.deepEqual(created, { id: "new", name: "Rex" });

  // Destroying the component aborts a request still in flight (fetch says "aborted", axios "canceled").
  const pending = handle.mutation.mutateAsync({ body: { name: "slow" } });
  const settled = assert.rejects(pending, /abort|cancel/i);
  await new Promise((resolve) => setTimeout(resolve, 50));
  unmount(component);
  await settled;
  client.clear();
  console.log("svelte ok");
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
