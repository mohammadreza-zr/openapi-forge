export { defineConfig, resolveOptions, loadConfigFile, DEFAULTS } from "./config.js";
export { emit } from "./emit.js";
export { generate } from "./generate.js";
export { pull, parseSourcePairs } from "./pull.js";
export { diffDocuments, renderReport, summarize, exceeds } from "./diff.js";
export { doctor } from "./doctor.js";
export { watchRun } from "./watch.js";
export { mergeSpecs } from "./load/merge.js";
export { camelCase, pascalCase } from "./names.js";
export type {
  Check,
  EmitResult,
  Finding,
  ForgeConfig,
  ForgeOptions,
  OpenApiDocument,
  OperationInfo,
  RunResult,
  RuntimeConfig,
  Severity,
  Transform,
} from "./types.js";

import { loadConfigFile, resolveOptions } from "./config.js";
import { generate } from "./generate.js";
import type { ForgeConfig, RunResult } from "./types.js";

/**
 * Programmatic run: `await run({ input: "swagger.json", out: "src/api" })`.
 * Reads the config file of `cwd` when there is one; `options` win over it.
 */
export async function run(
  options: ForgeConfig = {},
  { cwd = process.cwd(), check = false }: { cwd?: string; check?: boolean } = {},
): Promise<RunResult> {
  const { config } = await loadConfigFile(cwd);
  return generate(resolveOptions(config, options), { cwd, check });
}
