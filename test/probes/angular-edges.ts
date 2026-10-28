// Bundled with esbuild and run under `--import dom.mjs`, in Angular's test bed:
// the answers and bodies the built-in `angular` client must get right —
// bytes, text, a payload with a `result` field, headers, a form, an empty
// answer — through a real HttpClient (fetch backend) to a local server.
// Usage: node --import dom.mjs bundle.mjs <port>.
import "@angular/compiler";
import assert from "node:assert/strict";
import { HttpClient, provideHttpClient, withFetch } from "@angular/common/http";
import { inject, provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { configureClient } from "@api/client";
import * as edges from "@api/edges";

const [port] = process.argv.slice(2);
const asked = (): Promise<{ url: string; headers: Record<string, string>; body: string }[]> =>
  fetch(`http://127.0.0.1:${port}/seen`).then((response) => response.json());

async function main() {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideHttpClient(withFetch())],
  });
  configureClient({
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    instance: TestBed.runInInjectionContext(() => inject(HttpClient)),
  });

  assert.deepEqual(await edges.search(), { result: "ok", total: 3 });
  assert.deepEqual(await edges.check(), { result: false });
  assert.equal(await edges.getText(), "123");

  const blob = await edges.download();
  assert.ok(blob instanceof Blob);
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0xff, 0xfe, 0x00, 0x80]);

  assert.equal(await edges.uploadMany({ title: "t" }), null);

  await edges.getTenant({ filter: { a: "x" } }, { "X-Tenant-Id": "t1", "X-Page": 2 });
  const tenant = (await asked()).at(-1)!;
  assert.equal(tenant.url, "/api/v1/tenant?filter%5Ba%5D=x");
  assert.equal(tenant.headers["x-tenant-id"], "t1");
  assert.equal(tenant.headers["x-page"], "2");

  await edges.sendForm({ a: "1", tags: ["x", "y"] });
  const form = (await asked()).at(-1)!;
  assert.match(form.headers["content-type"], /^application\/x-www-form-urlencoded/);
  assert.equal(form.body, "a=1&tags=x&tags=y");

  await edges.remove({ ids: ["a", "b"] });
  const removed = (await asked()).at(-1)!;
  assert.equal(removed.body, '{"ids":["a","b"]}');

  assert.equal(await edges.sendNote("hello"), "got it");
  assert.equal((await asked()).at(-1)!.body, "hello");
  console.log("angular edges ok");
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
