// The built-in client that sends through Angular's HttpClient, run for real in
// Angular's test bed (with an interceptor) against local servers.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

import { bundle, generateTo, root } from "./harness.mjs";
import { ok, serve } from "./server.mjs";

test("the angular client sends through HttpClient, interceptors included", async () => {
  const dir = await generateTo("angular-http", {
    http: "angular",
    target: "requests",
  });
  const entry = await bundle(dir, join(root, "test/probes/angular-http.ts"));
  const backend = await serve(async (request) => {
    if (request.url === "/seen")
      return {
        body: backend.seen
          .filter((item) => item.url !== "/seen")
          .map(({ url, headers }) => ({ url, headers })),
      };
    if (request.url.startsWith("/api/v1/pets/fail"))
      return { body: { result: false, code: 7, message: "refused" } };
    if (request.url.startsWith("/api/v1/pets/missing"))
      return { status: 404, body: { detail: "no such pet" } };
    if (request.url.startsWith("/api/v1/pets/slow")) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return ok({ id: "slow" });
    }
    if (request.url.startsWith("/api/v1/pets?"))
      return ok({ count: 5, list: [] });
    return ok({ id: "1", name: "Rex" });
  });
  const other = await serve(() => ok({ id: "other" }));
  try {
    const child = spawn(
      process.execPath,
      [
        "--import",
        join(root, "test/probes/dom.mjs"),
        entry,
        String(backend.port),
        String(other.port),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 0, output);
    assert.match(output, /angular http ok/);
  } finally {
    await backend.close();
    await other.close();
  }
});
