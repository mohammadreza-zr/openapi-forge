// One run, end to end: load the document, emit, format, then write the files
// — or, with `check`, compare them with what is on disk.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { emit } from "./emit.js";
import { loadInput } from "./load/services.js";
import { runtimeFiles } from "./runtime/index.js";
import type { ForgeOptions, Problem, RunResult } from "./types.js";

/** The parts of prettier this uses; it is an optional peer dependency. */
interface Prettier {
  resolveConfig(file: string): Promise<object | null>;
  format(source: string, options: object): Promise<string>;
}

/** What a run is asked to do beyond its options. */
export interface RunContext {
  cwd: string;
  check?: boolean;
  forceRuntime?: boolean;
  interactive?: boolean;
}

const TAG = "openapi-forge";

/** The project's own prettier first, then the one next to this package. */
async function loadPrettier(cwd: string): Promise<Prettier | null> {
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

async function formatFiles(
  files: Map<string, string>,
  { cwd, outDir, format }: { cwd: string; outDir: string; format: ForgeOptions["format"] },
): Promise<Map<string, string>> {
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
      const where = /\((\d+):(\d+)\)/.exec(String((error as Error).message));
      throw new Error(
        `${TAG}: the emitted ${name} does not parse` +
          (where ? ` at line ${where[1]}, column ${where[2]}` : "") +
          ". Run with --raw --out <dir> to inspect it.",
      );
    }
  }
  return formatted;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const SHOWN_PROBLEMS = 12;

/**
 * What the document leaves incomplete. The output is still valid — those
 * spots are typed \`unknown\` — so this only tells the author where to look.
 */
function reportProblems(problems: Problem[], verbose: boolean): void {
  if (!problems.length) return;
  const shown = verbose ? problems : problems.slice(0, SHOWN_PROBLEMS);
  console.warn(
    `${TAG}: ${problems.length} incomplete type${problems.length === 1 ? "" : "s"} in the document:`,
  );
  for (const { where, message } of shown)
    console.warn(`  ▲ ${where} ${message}`);
  if (shown.length < problems.length)
    console.warn(
      `  … ${problems.length - shown.length} more (--verbose lists all)`,
    );
}

export async function generate(
  options: ForgeOptions,
  run: RunContext,
): Promise<RunResult> {
  const cwd = run.cwd;
  const outDir = resolve(cwd, options.out);

  const { doc, source } = await loadInput(options, {
    cwd,
    interactive: run.interactive ?? false,
  });
  const emitted = emit(doc, options, source);
  reportProblems(emitted.problems, options.verbose);
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
