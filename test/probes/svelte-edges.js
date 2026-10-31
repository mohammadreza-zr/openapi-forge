// Bundled with the Svelte compiler and run under `--import dom.mjs`.
// Usage: node --import dom.mjs bundle.mjs <port>. A header argument given as a
// getter over state moves the query and is sent; an infinite list sends its
// header with every page.
import assert from "node:assert/strict";
import { flushSync, mount, unmount } from "svelte";
import { QueryClient } from "@tanstack/svelte-query";
import * as clientModule from "@api/client";
import { pointClient } from "./point.cjs";
import Probe from "./ProbeEdges.svelte";

const [port, http] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
pointClient(http, clientModule, require, `${base}/api/v1`);

const seen = () => fetch(`${base}/seen`).then((response) => response.json());
async function until(check, what) {
  for (let waited = 0; waited < 3000; waited += 10) {
    flushSync();
    if (await check()) return;
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
  let handle;
  const component = mount(Probe, {
    target: document.body,
    props: { client, expose: (value) => (handle = value) },
  });
  flushSync();

  await until(() => sentBy("/api/v1/tenant", "a"), "a request for tenant a");
  handle.setTenant("b");
  await until(() => sentBy("/api/v1/tenant", "b"), "a request for tenant b");

  await until(() => handle.pages.data?.pages.length === 1, "the first page");
  await handle.pages.fetchNextPage();
  await until(() => handle.pages.data?.pages.length === 2, "the second page");
  assert.deepEqual(
    handle.pages.data.pages.map((page) => page.list.join()),
    ["0,1", "2,3"],
  );
  const asked = (await seen()).filter((item) => item.url.startsWith("/api/v1/pages"));
  assert.ok(asked.length >= 2);
  assert.ok(asked.every((item) => item.headers["x-tenant-id"] === "t9"));

  unmount(component);
  client.clear();
  console.log("svelte edges ok");
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
