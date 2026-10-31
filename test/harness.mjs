// What the runtime tests share: generating the clients fixture for one client,
// and turning the result into something Node can run — compiled to CommonJS
// with tsc, or bundled with esbuild when a library needs a bundler.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generate } from "../dist/generate.js";
import { CLIENTS_FIXTURE, options } from "./helpers.mjs";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `check` until it holds; `what` names it in the failure. */
export async function until(check, what, { tick = sleep, within = 3000 } = {}) {
  for (let waited = 0; waited < within; waited += 10) {
    if (await check()) return;
    await tick(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Generates the clients fixture into `.conformance/runtime/<name>/ts`. */
export async function generateTo(name, patch = {}) {
  const dir = join(root, ".conformance", "runtime", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { log, warn } = console;
  console.log = console.warn = () => {};
  try {
    await generate(
      options({ input: CLIENTS_FIXTURE, out: join(dir, "ts"), ...patch }),
      { cwd: root },
    );
  } finally {
    Object.assign(console, { log, warn });
  }
  // The api-client file is the project's to edit: a test edits it too, so it can
  // point the client at the server it started.
  const file = join(dir, "ts", "client.ts");
  // `import.meta.env` (where Vite puts the environment) cannot be compiled to the
  // CommonJS these tests run; the tests point the client at the server anyway.
  const source = (existsSync(file) ? readFileSync(file, "utf8") : "").replaceAll(
    "import.meta.env.VITE_API_URL",
    "(globalThis as { NO_SUCH_VARIABLE?: string }).NO_SUCH_VARIABLE",
  );
  if (source) writeFileSync(file, source);
  for (const name of ["apiClient", "http", "baseUrl"]) {
    const line = new RegExp(`export const ${name}(: [^=]+)? = [^;]*;`);
    if (line.test(source)) {
      writeFileSync(
        file,
        source.replace(line, (declaration) => declaration.replace("const", "let")) +
          `\nexport function setClientForTests(next: typeof ${name}) {\n  ${name} = next;\n}\n`,
      );
    }
  }
  return dir;
}

/** Compiles `<dir>/ts` to CommonJS in `<dir>/js`; the package is ESM, so say so. */
export function compileCjs(dir, extra = []) {
  const source = join(dir, "ts");
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
      ...extra,
      ...readdirSync(source)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => join(source, name)),
    ],
    { stdio: "pipe" },
  );
  writeFileSync(join(dir, "js/package.json"), '{ "type": "commonjs" }');
  return join(dir, "js");
}

/**
 * Bundles a probe that imports the generated layer as `@api/…` into one ES
 * module, and returns its path. `jsdom` stays outside the bundle.
 */
export async function bundle(dir, entry, { plugins = [], ...esbuildOptions } = {}) {
  const { build } = await import("esbuild");
  const outfile = join(dir, "bundle.mjs");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    alias: { "@api": join(dir, "ts") },
    external: ["jsdom"],
    // Angular's `@Injectable` is a TypeScript (legacy) decorator, as in every Angular project.
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    // `fetch` and Angular's `HttpClient` write no `client.ts`; a probe that
    // points a client at the server then finds an empty module there.
    plugins: [
      ...plugins,
      {
        name: "no-client",
        setup(builder) {
          builder.onResolve({ filter: /^@api\/client$/ }, () =>
            existsSync(join(dir, "ts", "client.ts"))
              ? null
              : { path: "client", namespace: "no-client" },
          );
          builder.onLoad({ filter: /.*/, namespace: "no-client" }, () => ({
            contents: "",
            loader: "js",
          }));
        },
      },
    ],
    banner: {
      // Some dependencies are CommonJS and call require.
      js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
    },
    ...esbuildOptions,
  });
  return outfile;
}
