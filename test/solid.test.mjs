// The Solid hooks, run for real: the generated API is compiled and exercised
// in a child process (solid-js needs its browser build, selected by a Node
// condition) against a local server.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { generate } from "../dist/generate.js";
import { CLIENTS_FIXTURE, options } from "./helpers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("solid-query hooks follow a signal and wait for a missing id", async () => {
  const dir = join(root, ".conformance", "runtime", "solid");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const source = join(dir, "ts");
  const { log, warn } = console;
  console.log = console.warn = () => {};
  try {
    await generate(
      options({ input: CLIENTS_FIXTURE, out: source, library: "solid-query" }),
      { cwd: root },
    );
  } finally {
    Object.assign(console, { log, warn });
  }
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "--ignoreConfig",
      "--strict",
      "--skipLibCheck",
      "--target",
      "es2022",
      "--module",
      "commonjs",
      "--lib",
      "es2023,dom",
      "--outDir",
      join(dir, "js"),
      ...readdirSync(source)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => join(source, name)),
    ],
    { stdio: "pipe" },
  );
  writeFileSync(join(dir, "js/package.json"), '{ "type": "commonjs" }');

  const asked = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.writeHead(200, { "content-type": "application/json" });
    if (request.url === "/asked") return response.end(JSON.stringify(asked));
    asked.push(`${request.method} ${request.url}`);
    const data =
      request.method === "POST"
        ? { id: "new", ...JSON.parse(Buffer.concat(chunks).toString()) }
        : { id: request.url.split("/")[4], name: "pet" };
    response.end(JSON.stringify({ result: true, data }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const child = spawn(
      process.execPath,
      [
        "--conditions=browser",
        join(root, "test/probes/solid.cjs"),
        dir,
        String(server.address().port),
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
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
