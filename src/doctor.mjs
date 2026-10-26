// `openapi-forge doctor`: everything that commonly keeps a run from working,
// checked in one pass and reported as ✔ / ▲ / ✖ lines.
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { loadInput } from "./load/services.mjs";

const MODULE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mjs",
  ".js",
  "/index.ts",
  "/index.js",
];
const HTTP_METHODS = ["get", "put", "post", "patch", "delete"];

const ok = (message) => ({ level: "ok", message });
const warn = (message) => ({ level: "warn", message });
const fail = (message) => ({ level: "fail", message });

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

async function nearestExisting(path) {
  let current = path;
  while (!(await exists(current)) && dirname(current) !== current)
    current = dirname(current);
  return current;
}

function checkDocument(doc) {
  const names = new Map();
  let operations = 0;
  let unnamed = 0;
  for (const item of Object.values(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = item?.[method];
      if (!operation) continue;
      operations += 1;
      if (!operation.operationId) unnamed += 1;
      else
        names.set(
          operation.operationId,
          (names.get(operation.operationId) ?? 0) + 1,
        );
    }
  }
  const duplicates = [...names]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
  return [
    ok(`${operations} operations in the document`),
    ...(unnamed
      ? [
          warn(
            `${unnamed} operations have no operationId — their names come from the route`,
          ),
        ]
      : []),
    ...(duplicates.length
      ? [
          warn(
            `duplicate operationId: ${duplicates.slice(0, 5).join(", ")} — later ones get a numeric suffix`,
          ),
        ]
      : []),
  ];
}

async function checkDependencies(options, cwd) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  } catch {
    return [
      warn("no package.json here, so installed packages were not checked"),
    ];
  }
  const has = (name) =>
    name in
    { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  const needs = [
    ...(options.target === "hooks" && options.client === "builtin"
      ? ["@tanstack/react-query"]
      : []),
    ...(options.zod ? ["zod"] : []),
  ];
  const results = needs.map((name) =>
    has(name)
      ? ok(`${name} is a dependency`)
      : fail(`${name} is not in package.json`),
  );
  if (options.format !== false && !has("prettier"))
    results.push(
      warn(
        "prettier is not in package.json — the output will not be formatted",
      ),
    );
  return results;
}

async function checkRuntime(options, cwd) {
  if (options.client !== "custom") return [];
  const outDir = resolve(cwd, options.out);
  const modules = new Set(
    Object.values(options.runtime)
      .map((entry) => entry?.module)
      .filter(Boolean),
  );
  const require = createRequire(join(outDir, "noop.js"));
  const results = [];
  for (const module of modules) {
    let found = false;
    if (module.startsWith(".")) {
      for (const suffix of MODULE_SUFFIXES)
        if (await exists(resolve(outDir, module + suffix))) found = true;
    } else {
      try {
        require.resolve(module);
        found = true;
      } catch {
        // Aliases like `@core/services` only a bundler knows are not checked.
        found = module.startsWith("@") || module.startsWith("~");
      }
    }
    results.push(
      found
        ? ok(`runtime module ${module}`)
        : fail(`runtime module ${module} was not found`),
    );
  }
  return results;
}

/** The checks of one run; never throws. */
export async function doctor(options, { cwd, configFile }) {
  const results = [
    Number(process.versions.node.split(".")[0]) >= 20
      ? ok(`node ${process.versions.node}`)
      : fail(`node ${process.versions.node} — openapi-forge needs 20 or newer`),
    configFile
      ? ok(`config ${configFile}`)
      : warn("no config file — defaults and flags only"),
  ];

  try {
    const { doc, source } = await loadInput(options, {
      cwd,
      interactive: false,
    });
    results.push(ok(`input ${source}`), ...checkDocument(doc));
  } catch (error) {
    results.push(fail(error.message));
  }

  const parent = await nearestExisting(resolve(cwd, options.out));
  results.push(
    await access(parent, 2).then(
      () => ok(`output ${options.out} is writable`),
      () => fail(`output ${options.out} is not writable`),
    ),
  );
  results.push(
    ...(await checkDependencies(options, cwd)),
    ...(await checkRuntime(options, cwd)),
  );
  return results;
}

const MARK = { ok: "✔", warn: "▲", fail: "✖" };
export const renderChecks = (results) =>
  results.map((item) => `${MARK[item.level]} ${item.message}`).join("\n");
