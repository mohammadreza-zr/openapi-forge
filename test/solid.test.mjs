// The Solid hooks, run for real: the generated API is compiled and exercised
// in a child process (solid-js needs its browser build, selected by a Node
// condition) against a local server.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

import { compileCjs, generateTo, root } from "./harness.mjs";
import { petApi, serve } from "./server.mjs";

test("solid-query hooks follow a signal, wait for a missing id and stop with their owner", async () => {
  const dir = await generateTo("solid", { library: "solid-query" });
  compileCjs(dir);
  const server = await serve(petApi);
  try {
    const child = spawn(
      process.execPath,
      [
        "--conditions=browser",
        join(root, "test/probes/solid.cjs"),
        dir,
        String(server.port),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 0, output);
    assert.match(output, /solid ok/);
  } finally {
    await server.close();
  }
});
