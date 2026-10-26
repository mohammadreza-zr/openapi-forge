// The Angular hooks, run for real: the generated API is bundled with Angular's
// test bed and exercised in jsdom against a local server.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

import { bundle, generateTo, root } from "./harness.mjs";
import { petApi, serve } from "./server.mjs";

test("angular-query hooks follow a signal, wait for a missing id and stop with their injector", async () => {
  const dir = await generateTo("angular", { library: "angular-query" });
  const entry = await bundle(dir, join(root, "test/probes/angular.ts"));
  const server = await serve(petApi);
  try {
    const child = spawn(
      process.execPath,
      [
        "--import",
        join(root, "test/probes/dom.mjs"),
        entry,
        String(server.port),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 0, output);
    assert.match(output, /angular ok/);
  } finally {
    await server.close();
  }
});
