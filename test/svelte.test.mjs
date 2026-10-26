// The Svelte hooks, run for real: a component using them is compiled with the
// Svelte compiler, bundled with the generated API and mounted in jsdom.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { compile, compileModule } from "svelte/compiler";

import { bundle, generateTo, root } from "./harness.mjs";
import { petApi, serve } from "./server.mjs";

/** Svelte sources — components, and modules that use runes — through the compiler. */
const svelte = {
  name: "svelte",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, ({ path }) => ({
      contents: compile(readFileSync(path, "utf8"), {
        filename: path,
        generate: "client",
        css: "injected",
      }).js.code,
      loader: "js",
    }));
    build.onLoad({ filter: /\.svelte\.(js|ts)$/ }, ({ path }) => ({
      contents: compileModule(readFileSync(path, "utf8"), {
        filename: path,
        generate: "client",
      }).js.code,
      loader: "js",
    }));
  },
};

test("svelte-query hooks follow state, wait for a missing id and stop with their component", async () => {
  const dir = await generateTo("svelte", { library: "svelte-query" });
  const entry = await bundle(dir, join(root, "test/probes/svelte.js"), {
    plugins: [svelte],
    conditions: ["browser"],
    mainFields: ["svelte", "browser", "module", "main"],
  });
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
    assert.match(output, /svelte ok/);
  } finally {
    await server.close();
  }
});
