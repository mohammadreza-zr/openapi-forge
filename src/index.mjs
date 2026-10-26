export { defineConfig, resolveOptions, loadConfigFile, DEFAULTS } from "./config.mjs";
export { emit } from "./emit.mjs";
export { generate } from "./generate.mjs";
export { pull, parseSourcePairs } from "./pull.mjs";
export { mergeSpecs } from "./load/merge.mjs";
export { camelCase, pascalCase } from "./names.mjs";

import { generate } from "./generate.mjs";
import { loadConfigFile, resolveOptions } from "./config.mjs";

/**
 * Programmatic run: `await run({ input: "swagger.json", out: "src/api" })`.
 * Reads the config file of `cwd` when there is one; `options` win over it.
 */
export async function run(options = {}, { cwd = process.cwd(), check = false } = {}) {
  const { config } = await loadConfigFile(cwd);
  return generate(resolveOptions(config, options), { cwd, check });
}
