// The Solid hooks, run for real: the generated API is compiled and exercised
// in a child process (solid-js needs its browser build, selected by a Node
// condition) against a local server.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

import { compileCjs, generateTo, root } from "./harness.mjs";
import { EDGES_FIXTURE } from "./helpers.mjs";
import { edgesApi, petApi, serve } from "./server.mjs";

for (const http of ["fetch", "axios", "api-client"]) test(`solid-query hooks follow a signal and stop with their owner over ${http}`, async () => {
  const dir = await generateTo(`solid-${http}`, { library: "solid-query", http });
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
        http,
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

// The client's headers are its own: the api-client functions take none as an argument.
for (const http of ["fetch", "axios"]) test(`solid-query hooks take header arguments, also for an infinite list over ${http}`, async () => {
  const dir = await generateTo(`solid-edges-${http}`, {
    library: "solid-query",
    http,
    infinite: true,
    input: EDGES_FIXTURE,
  });
  compileCjs(dir);
  const server = await serve(edgesApi);
  try {
    const child = spawn(
      process.execPath,
      [
        "--conditions=browser",
        join(root, "test/probes/solid-edges.cjs"),
        dir,
        String(server.port),
        http,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 0, output);
    assert.match(output, /solid edges ok/);
  } finally {
    await server.close();
  }
});
