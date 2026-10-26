// One run, end to end: load the document, emit, format, then write the files
// — or, with `check`, compare them with what is on disk.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { emit } from "./emit.mjs";
import { loadInput } from "./load/services.mjs";
import {
  CLIENT_TS,
  HOOKS_TS,
  INFINITE_HOOK_TS,
  INFINITE_TYPES_TS,
  OPTION_TYPES_IMPORT,
  OPTION_TYPES_TS,
  TYPES_TS,
} from "./runtime/templates.mjs";

const TAG = "openapi-forge";

/** The project's own prettier first, then the one next to this package. */
async function loadPrettier(cwd) {
  try {
    const found = createRequire(join(cwd, "noop.js")).resolve("prettier");
    return (await import(pathToFileURL(found).href)).default;
  } catch {
    try {
      return (await import("prettier")).default;
    } catch {
      return null;
    }
  }
}

async function formatFiles(files, { cwd, outDir, format }) {
  if (format === false) return files;
  const prettier = await loadPrettier(cwd);
  if (!prettier) {
    console.warn(
      `${TAG}: prettier is not installed, so the output is not formatted. ` +
        "Install it in the project, or set `format: false` to silence this.",
    );
    return files;
  }
  const config =
    (await prettier.resolveConfig(join(cwd, "package.json"))) ?? {};
  const formatted = new Map();
  for (const [name, source] of files) {
    try {
      formatted.set(
        name,
        await prettier.format(source, {
          ...config,
          parser: "typescript",
          filepath: join(outDir, name),
        }),
      );
    } catch (error) {
      const where = /\((\d+):(\d+)\)/.exec(String(error.message));
      throw new Error(
        `${TAG}: the emitted ${name} does not parse` +
          (where ? ` at line ${where[1]}, column ${where[2]}` : "") +
          ". Run with --raw --out <dir> to inspect it.",
      );
    }
  }
  return formatted;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** The built-in client's files — only the ones the target needs. */
function runtimeFiles(options) {
  const hooks = options.target === "hooks";
  const infinite = hooks && options.infinite;
  let types = TYPES_TS;
  let hookSource = HOOKS_TS;
  if (hooks) {
    const imports = infinite
      ? OPTION_TYPES_IMPORT.replace(
          "  QueryKey,",
          "  InfiniteData,\n  QueryKey,\n  UseInfiniteQueryOptions,",
        )
      : OPTION_TYPES_IMPORT;
    types =
      types.replace(
        "\n/** What every answer",
        `${imports}\n/** What every answer`,
      ) +
      OPTION_TYPES_TS +
      (infinite ? INFINITE_TYPES_TS : "");
  }
  if (infinite) {
    hookSource =
      hookSource
        .replace("  useMutation,", "  useInfiniteQuery,\n  useMutation,")
        .replace(
          'import type { ApiMutationOptions, ApiQueryOptions } from "./types";',
          'import type {\n  ApiInfiniteQueryOptions,\n  ApiListData,\n  ApiMutationOptions,\n  ApiQueryOptions,\n} from "./types";',
        ) + INFINITE_HOOK_TS;
  }
  const files = new Map([
    ["types.ts", types],
    ["client.ts", CLIENT_TS],
  ]);
  if (hooks) files.set("hooks.ts", hookSource);
  return files;
}

/**
 * @param {object} options  resolved options — see config.mjs
 * @param {{ cwd: string, check?: boolean, forceRuntime?: boolean, interactive?: boolean }} run
 */
export async function generate(options, run) {
  const cwd = run.cwd;
  const outDir = resolve(cwd, options.out);

  const { doc, source } = await loadInput(options, {
    cwd,
    interactive: run.interactive ?? false,
  });
  const emitted = emit(doc, options, source);
  const files = await formatFiles(emitted.files, {
    cwd,
    outDir,
    format: options.format,
  });

  if (run.check) {
    const stale = [];
    for (const [name, text] of files) {
      const existing = await readFile(join(outDir, name), "utf8").catch(
        () => null,
      );
      if (existing !== text) stale.push(name);
    }
    if (stale.length) {
      console.error(
        `${TAG}: the committed output is stale — ${stale.join(", ")}.\n` +
          "        Run `openapi-forge` and commit what it wrote.",
      );
      return { ok: false, stale };
    }
    console.log(`${TAG}: output is up to date (${files.size} files).`);
    return { ok: true, stale: [] };
  }

  await mkdir(outDir, { recursive: true });
  for (const [name, text] of files) {
    const file = join(outDir, name);
    // An unchanged file keeps its mtime, so watchers and bundlers stay quiet.
    if ((await readFile(file, "utf8").catch(() => null)) !== text)
      await writeFile(file, text, "utf8");
  }

  // The runtime is the project's to edit: write it only when it is missing.
  const written = [...files.keys()];
  if (options.client === "builtin") {
    const runtime = await formatFiles(runtimeFiles(options), {
      cwd,
      outDir,
      format: options.format,
    });
    for (const [name, text] of runtime) {
      const file = join(outDir, name);
      if (run.forceRuntime || !(await exists(file))) {
        await writeFile(file, text, "utf8");
        written.push(name);
      }
    }
  }

  console.log(
    `${TAG}: ${emitted.operations} operations in ${emitted.tags} tags from ${source} → ` +
      `${options.out} (${written.join(", ")}).`,
  );
  return { ok: true, files: written };
}
