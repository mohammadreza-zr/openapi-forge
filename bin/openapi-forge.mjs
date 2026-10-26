#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadConfigFile, resolveOptions } from "../src/config.mjs";
import { generate } from "../src/generate.mjs";
import { parseSourcePairs, pull } from "../src/pull.mjs";

const HELP = `openapi-forge — a typed API layer from OpenAPI / Swagger documents

Usage
  openapi-forge [generate] [options]   write the API layer
  openapi-forge pull [options]         fetch the documents named in \`sources\`, then generate
  openapi-forge init                   write a starter openapi-forge.config.mjs

Options
  --config <file>        config file (default: openapi-forge.config.{mjs,js,cjs,json})
  --input <path|url>     a document, or a folder of documents (one per service)
  --out <dir>            output folder
  --api-prefix <path>    prefix stripped from emitted routes (e.g. /api/v1)
  --tags a,b             emit only these tags
  --exclude-tags a,b     skip these tags
  --target <hooks|requests>   React Query hooks too, or request functions only
  --client <builtin|custom>   write a fetch runtime, or use your own transport
  --headers "K: v;K2: v" request headers for a URL input
  --insecure             skip TLS verification (local dev only, never in CI)
  --ca <file.pem>        trust this CA certificate for an https URL
  --check                exit 1 when the committed output is stale
  --raw                  skip prettier
  --force-runtime        rewrite the built-in runtime files too
  --no-pull              with \`pull\`: fetch only, do not generate
  --verbose              list the identical duplicates a merge folded together
  -h, --help             this text
  -v, --version          the version

Environment
  OPENAPI_FORGE_INPUT, OPENAPI_FORGE_HEADERS, OPENAPI_FORGE_INSECURE,
  OPENAPI_FORGE_CA, OPENAPI_FORGE_SOURCES (name=url;name2=url2)
`;

const STARTER = `// @ts-check
import { defineConfig } from "@mrzr/openapi-forge";

export default defineConfig({
  // A document (file or URL), a folder of documents, or { service: fileOrUrl }.
  input: "openapi.json",
  out: "src/api/generated",

  // Stripped from every route, so the base URL can carry it: "/api/v1".
  apiPrefix: "",

  // "builtin" writes client.ts / hooks.ts / types.ts once; "custom" uses
  // your own transport — see the README for the \`runtime\` it needs.
  client: "builtin",

  // "hooks" adds React Query hooks and key factories; "requests" stops at functions.
  target: "hooks",

  // tags: { include: [], exclude: [] },
  // sources: { users: "https://host/users/openapi.yaml" },   // for \`openapi-forge pull\`
});
`;

const args = process.argv.slice(2);
const command = ["generate", "pull", "init"].includes(args[0])
  ? args.shift()
  : "generate";

let values;
try {
  ({ values } = parseArgs({
    args,
    options: {
      config: { type: "string" },
      input: { type: "string" },
      out: { type: "string" },
      "api-prefix": { type: "string" },
      tags: { type: "string" },
      "exclude-tags": { type: "string" },
      target: { type: "string" },
      client: { type: "string" },
      headers: { type: "string" },
      insecure: { type: "boolean" },
      ca: { type: "string" },
      check: { type: "boolean" },
      raw: { type: "boolean" },
      "force-runtime": { type: "boolean" },
      "no-pull": { type: "boolean" },
      verbose: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  }));
} catch (error) {
  console.error(`openapi-forge: ${error.message}\n\n${HELP}`);
  process.exit(2);
}

const list = (text) =>
  String(text ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function parseHeaders(text) {
  if (!text) return undefined;
  return Object.fromEntries(
    text.split(";").map((pair) => {
      const [key, ...rest] = pair.split(":");
      return [key.trim(), rest.join(":").trim()];
    }),
  );
}

async function main() {
  if (values.help) return console.log(HELP);
  if (values.version) {
    const pkg = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    return console.log(pkg.version);
  }

  const cwd = process.cwd();

  if (command === "init") {
    const file = resolve(cwd, "openapi-forge.config.mjs");
    await writeFile(file, STARTER, { flag: "wx" }).catch((error) => {
      if (error.code === "EEXIST")
        throw new Error("openapi-forge: openapi-forge.config.mjs already exists.");
      throw error;
    });
    return console.log("openapi-forge: wrote openapi-forge.config.mjs");
  }

  const { config } = await loadConfigFile(cwd, values.config);
  const env = process.env;
  const cli = {};
  const input = values.input ?? env.OPENAPI_FORGE_INPUT;
  if (input) cli.input = input;
  if (values.out) cli.out = values.out;
  if (values["api-prefix"] !== undefined) cli.apiPrefix = values["api-prefix"];
  if (values.target) cli.target = values.target;
  if (values.client) cli.client = values.client;
  if (values.tags || values["exclude-tags"]) {
    cli.tags = {};
    if (values.tags) cli.tags.include = list(values.tags);
    if (values["exclude-tags"]) cli.tags.exclude = list(values["exclude-tags"]);
  }
  const headers = parseHeaders(values.headers ?? env.OPENAPI_FORGE_HEADERS);
  if (headers) cli.headers = headers;
  const insecure =
    values.insecure ||
    ["1", "true", "yes"].includes(
      String(env.OPENAPI_FORGE_INSECURE ?? "").toLowerCase(),
    );
  const ca = values.ca ?? env.OPENAPI_FORGE_CA;
  if (insecure || ca) cli.tls = { ...(insecure && { insecure }), ...(ca && { ca }) };
  if (values.raw) cli.format = false;
  if (values.verbose) cli.verbose = true;
  if (env.OPENAPI_FORGE_SOURCES)
    cli.sources = parseSourcePairs(env.OPENAPI_FORGE_SOURCES);

  const options = resolveOptions(config, cli);

  if (command === "pull") {
    await pull(options, { cwd });
    if (values["no-pull"]) return;
    // A pull feeds the specs folder, which is then the input.
    if (!input && !config.input) options.input = options.specsDir;
  }

  const result = await generate(options, {
    cwd,
    check: values.check,
    forceRuntime: values["force-runtime"],
    interactive: !values.check && process.stdin.isTTY === true,
  });
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
