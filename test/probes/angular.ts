// Bundled with esbuild and run under `--import dom.mjs`, in Angular's test
// bed. Usage: node --import dom.mjs bundle.mjs <port>. Exits non-zero on failure.
import "@angular/compiler";
import assert from "node:assert/strict";
import { HttpClient, provideHttpClient, withFetch } from "@angular/common/http";
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
import { configureClient } from "@api/client";
import * as pets from "@api/pets";

const [port, http] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
configureClient({ baseUrl: `${base}/api/v1` });

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
      ...(http === "angular" ? [provideHttpClient(withFetch())] : []),
    ],
  });
  // The Angular HTTP client sends through the app's own HttpClient.
  if (http === "angular") {
    configureClient({
      instance: TestBed.runInInjectionContext(() => inject(HttpClient)),
    });
  }

  const id = signal("1");
  const later = signal<string | undefined>(undefined);
  const { query, waiting, mutation } = TestBed.runInInjectionContext(() => ({
    query: pets.injectGetPetQuery(id),
    waiting: pets.injectGetPetQuery(later),
    mutation: pets.injectCreatePetMutation(),
  }));

  await until(() => query.data()?.id === "1", "pet 1");
  id.set("2");
  await until(() => query.data()?.id === "2", "pet 2");
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
  assert.equal(waiting.fetchStatus(), "idle");
  later.set("8");
  await until(() => waiting.data()?.id === "8", "pet 8");

  const created = await mutation.mutateAsync({ body: { name: "Rex" } });
  assert.deepEqual(created, { id: "new", name: "Rex" });

  // Destroying the injector aborts a request still in flight.
  const pending = mutation.mutateAsync({ body: { name: "slow" } });
  const settled = assert.rejects(pending, /abort|cancel/i);
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
