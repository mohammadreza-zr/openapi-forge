// Bundled with esbuild and run under `--import dom.mjs`, in Angular's test
// bed. Usage: node --import dom.mjs bundle.mjs <port>. A header argument given
// as a getter over a signal moves the query and is sent; an infinite list sends
// its header with every page.
import "@angular/compiler";
import assert from "node:assert/strict";
import { provideZonelessChangeDetection, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import {
  QueryClient,
  provideTanStackQuery,
} from "@tanstack/angular-query-experimental";
import { configureClient } from "@api/client";
import * as edges from "@api/edges";

const [port] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
configureClient({ baseUrl: `${base}/api/v1` });

type Seen = { url: string; headers: Record<string, string> }[];
const seen = (): Promise<Seen> =>
  fetch(`${base}/seen`).then((response) => response.json());
async function until(check: () => boolean | Promise<boolean>, what: string) {
  for (let waited = 0; waited < 3000; waited += 10) {
    TestBed.tick();
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}; saw ${JSON.stringify(await seen())}`);
}
const sentBy = async (path: string, tenant: string) =>
  (await seen()).some(
    (item) => item.url.startsWith(path) && item.headers["x-tenant-id"] === tenant,
  );

async function main() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideTanStackQuery(client)],
  });

  const tenant = signal("a");
  const { pages } = TestBed.runInInjectionContext(() => ({
    query: edges.injectGetTenantQuery({}, () => ({ "X-Tenant-Id": tenant() })),
    pages: edges.injectListPagesInfiniteQuery(
      {},
      { "X-Tenant-Id": "t9" },
      { pageSize: 2 },
    ),
  }));

  await until(() => sentBy("/api/v1/tenant", "a"), "a request for tenant a");
  tenant.set("b");
  await until(() => sentBy("/api/v1/tenant", "b"), "a request for tenant b");

  await until(() => pages.data()?.pages.length === 1, "the first page");
  await pages.fetchNextPage();
  await until(() => pages.data()?.pages.length === 2, "the second page");
  assert.deepEqual(
    pages.data()!.pages.map((page) => page.list.join()),
    ["0,1", "2,3"],
  );
  const asked = (await seen()).filter((item) => item.url.startsWith("/api/v1/pages"));
  assert.ok(asked.length >= 2);
  assert.ok(asked.every((item) => item.headers["x-tenant-id"] === "t9"));

  TestBed.resetTestingModule();
  client.clear();
  console.log("angular query edges ok");
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
