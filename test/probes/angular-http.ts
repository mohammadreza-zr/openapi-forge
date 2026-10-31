// Bundled with esbuild and run under `--import dom.mjs`, in Angular's test
// bed: the generated Angular service goes through a real HttpClient (fetch
// backend, one interceptor) to a local server.
// Usage: node --import dom.mjs bundle.mjs <port> <other port>.
import "@angular/compiler";
import assert from "node:assert/strict";
import { HttpErrorResponse } from "@angular/common/http";
import {
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
import { firstValueFrom } from "rxjs";
import * as pets from "@api/pets";

const [port, otherPort] = process.argv.slice(2);
// A route is the document's whole path (`/api/v1/pets`): only the origin goes in front.
const base = `http://127.0.0.1:${port}`;
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

  // The generated service is injected like any other and sends through the
  // app's HttpClient, interceptors included.
  const service = TestBed.inject(pets.PetsService);

  const page = await firstValueFrom(service.listPets({ kind: "cat", ids: ["a", "b"], start: 0 }));
  assert.equal(page.count, 5);
  const seen = await asked();
  const listed = seen.at(-1)!;
  assert.equal(listed.url, "/api/v1/pets?kind=cat&ids=a&ids=b&start=0");
  assert.equal(listed.headers["x-interceptor"], "ran", "the interceptor ran");

  const created = await firstValueFrom(service.createPet({ name: "Rex", kind: "dog" }));
  assert.equal(created.name, "Rex");
  const posted = (await asked()).at(-1)!;
  assert.match(posted.headers["content-type"], /^application\/json/);

  const form = new FormData();
  form.append("file", new Blob(["bytes"]));
  await firstValueFrom(service.uploadPhoto("7", form));
  assert.match(
    (await asked()).at(-1)!.headers["content-type"],
    /^multipart\/form-data/,
  );

  // An answer with result: false is the answer; HttpClient does not judge it.
  assert.deepEqual(await firstValueFrom(service.getPet("fail")), {
    result: false,
    code: 7,
    message: "refused",
  });
  // A failed status is HttpClient's own error, with the interceptors' say.
  await assert.rejects(firstValueFrom(service.getPet("missing")), (error: unknown) => {
    assert.ok(error instanceof HttpErrorResponse);
    assert.equal(error.status, 404);
    assert.deepEqual(error.error, { detail: "no such pet" });
    return true;
  });

  // Cancelling is the Observable's: unsubscribing ends the request.
  let finished = false;
  const subscription = service.getPet("slow").subscribe({ complete: () => (finished = true) });
  await new Promise((resolve) => setTimeout(resolve, 30));
  subscription.unsubscribe();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(finished, false);
  console.log("angular http ok");
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
