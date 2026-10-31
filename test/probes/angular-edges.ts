// Bundled with esbuild and run under `--import dom.mjs`, in Angular's test bed:
// the answers and bodies the generated Angular service must get right —
// bytes, text, a payload with a `result` field, headers, a form, an empty
// answer — through a real HttpClient (fetch backend) to a local server.
// Usage: node --import dom.mjs bundle.mjs <port>.
import "@angular/compiler";
import assert from "node:assert/strict";
import {
  HttpParams,
  provideHttpClient,
  withFetch,
  withInterceptors,
} from "@angular/common/http";
import { provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { Observable, firstValueFrom } from "rxjs";
import * as edges from "@api/edges";

const [port] = process.argv.slice(2);
const asked = (): Promise<{ url: string; headers: Record<string, string>; body: string }[]> =>
  fetch(`http://127.0.0.1:${port}/seen`).then((response) => response.json());

async function main() {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(
        withFetch(),
        withInterceptors([
          (request, next) =>
            next(request.clone({ url: `http://127.0.0.1:${port}/api/v1${request.url}` })),
        ]),
      ),
    ],
  });
  const service = TestBed.inject(edges.EdgesService);
  const read = <T,>(call: Observable<T>) => firstValueFrom(call);

  assert.deepEqual(await read(service.search()), { result: "ok", total: 3 });
  assert.deepEqual(await read(service.check()), { result: false });
  assert.equal(await read(service.getText()), "123");

  const blob = await read(service.download());
  assert.ok(blob instanceof Blob);
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0xff, 0xfe, 0x00, 0x80]);

  const upload = new FormData();
  upload.append("title", "t");
  assert.equal(await read(service.uploadMany(upload)), null);

  await read(service.getTenant({ q: "x" }, { "X-Tenant-Id": "t1", "X-Page": 2 }));
  const tenant = (await asked()).at(-1)!;
  assert.equal(tenant.url, "/api/v1/tenant?q=x");
  assert.equal(tenant.headers["x-tenant-id"], "t1");
  assert.equal(tenant.headers["x-page"], "2");

  await read(service.sendForm(new HttpParams({ fromObject: { a: "1", tags: ["x", "y"] } })));
  const form = (await asked()).at(-1)!;
  assert.match(form.headers["content-type"], /^application\/x-www-form-urlencoded/);
  assert.equal(form.body, "a=1&tags=x&tags=y");

  await read(service.remove({ ids: ["a", "b"] }));
  const removed = (await asked()).at(-1)!;
  assert.equal(removed.body, '{"ids":["a","b"]}');

  assert.equal(await read(service.sendNote("hello")), "got it");
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
