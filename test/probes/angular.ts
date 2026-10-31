// Bundled with esbuild and run under `--import dom.mjs`, in Angular's test
// bed. Usage: node --import dom.mjs bundle.mjs <port>. Exits non-zero on failure.
import "@angular/compiler";
import assert from "node:assert/strict";
import {
  HttpClient,
  provideHttpClient,
  withFetch,
  withInterceptors,
} from "@angular/common/http";
import { inject, provideZonelessChangeDetection, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import {
  QueryClient,
  provideTanStackQuery,
} from "@tanstack/angular-query-experimental";
import * as clientModule from "@api/client";
import { payloadOf, pointClient } from "./point.cjs";
import * as pets from "@api/pets";

const [port, http] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
pointClient(http, clientModule, require, `${base}/api/v1`);

const asked = (): Promise<string[]> =>
  fetch(`${base}/asked`).then((response) => response.json());
async function until(check: () => boolean, what: string) {
  for (let waited = 0; waited < 3000; waited += 10) {
    TestBed.tick();
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
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideTanStackQuery(client),
      ...(http === "angular" ? [provideHttpClient(
          withFetch(),
          withInterceptors([(request, next) => next(request.clone({ url: `${base}/api/v1${request.url}` }))]),
        )] : []),
    ],
  });
  const id = signal("1");
  const { query, mutation } = TestBed.runInInjectionContext(() => ({
    query: pets.injectGetPetQuery(id),
    mutation: pets.injectCreatePetMutation(),
  }));

  await until(() => payloadOf(http, query.data())?.id === "1", "pet 1");
  id.set("2");
  await until(() => payloadOf(http, query.data())?.id === "2", "pet 2");
  const seen = await asked();
  assert.ok(
    seen.includes("GET /api/v1/pets/1") && seen.includes("GET /api/v1/pets/2"),
    seen.join(", "),
  );

  const created = await mutation.mutateAsync({ body: { name: "Rex" } });
  assert.deepEqual(payloadOf(http, created), { id: "new", name: "Rex" });

  // Destroying the injector aborts a request still in flight. HttpClient takes
  // no AbortSignal (its Observable is the way to cancel), so with it the call
  // simply finishes; @mrzr/api-client settles a canceled call with no data
  // instead of rejecting.
  const pending = mutation.mutateAsync({ body: { name: "slow" } });
  const settled =
    http === "api-client" || http === "angular"
      ? pending.then(() => undefined, () => undefined)
      : assert.rejects(pending, /abort|cancel/i);
  await new Promise((resolve) => setTimeout(resolve, 50));
  TestBed.resetTestingModule();
  await settled;
  client.clear();
  console.log("angular ok");
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
