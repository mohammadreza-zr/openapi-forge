// Bundled with esbuild and run under `--import dom.mjs`, in Angular's test
// bed: the built-in `angular` HTTP client goes through a real HttpClient (fetch
// backend, one interceptor) to a local server.
// Usage: node --import dom.mjs bundle.mjs <port> <other port>.
import "@angular/compiler";
import assert from "node:assert/strict";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from "@angular/common/http";
import { inject, provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { configureClient } from "@api/client";
import * as pets from "@api/pets";

const [port, otherPort] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}/api/v1`;
const asked = (): Promise<{ url: string; headers: Record<string, string> }[]> =>
  fetch(`http://127.0.0.1:${port}/seen`).then((response) => response.json());

async function main() {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(
        withFetch(),
        withInterceptors([
          // The app's own base URL, as any Angular app puts it; a call that names its own is left alone.
          (request, next) =>
            next(
              request.clone({
                url: request.url.startsWith("http") ? request.url : base + request.url,
                setHeaders: { "X-Interceptor": "ran" },
              }),
            ),
        ]),
      ),
    ],
  });

  // Before the client is given its HttpClient, a request says what is missing.
  await assert.rejects(pets.getPet("1"), /inject\(HttpClient\)/);
  configureClient({
    instance: TestBed.runInInjectionContext(() => inject(HttpClient)),
  });

  const page = await pets.listPets({ kind: "cat", ids: ["a", "b"], start: 0 });
  assert.equal(page.count, 5);
  const seen = await asked();
  const listed = seen.at(-1)!;
  assert.equal(listed.url, "/api/v1/pets?kind=cat&ids=a&ids=b&start=0");
  assert.equal(listed.headers["x-interceptor"], "ran", "the interceptor ran");

  const created = await pets.createPet({ name: "Rex", kind: "dog" });
  assert.equal(created.name, "Rex");
  const posted = (await asked()).at(-1)!;
  assert.match(posted.headers["content-type"], /^application\/json/);

  await pets.uploadPhoto("7", { file: new Blob(["bytes"]) });
  assert.match(
    (await asked()).at(-1)!.headers["content-type"],
    /^multipart\/form-data/,
  );

  assert.equal(
    (
      await pets.getPet("1", {
        baseUrl: `http://127.0.0.1:${otherPort}/api/v1`,
      })
    ).id,
    "other",
  );

  // An answer with result: false is the answer; HttpClient does not judge it.
  assert.deepEqual(await pets.getPet("fail"), {
    result: false,
    code: 7,
    message: "refused",
  });
  // A failed status is HttpClient's own error, with the interceptors' say.
  await assert.rejects(pets.getPet("missing"), (error: unknown) => {
    assert.ok(error instanceof HttpErrorResponse);
    assert.equal(error.status, 404);
    assert.deepEqual(error.error, { detail: "no such pet" });
    return true;
  });

  const controller = new AbortController();
  const pending = pets.getPet("slow", { signal: controller.signal });
  const settled = assert.rejects(pending, /abort/i);
  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.abort();
  await settled;
  console.log("angular http ok");
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
