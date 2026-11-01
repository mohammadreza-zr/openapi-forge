import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadConfigFile, resolveOptions } from "../dist/config.js";

const README = fileURLToPath(new URL("../README.md", import.meta.url));

test("every YAML block of the README is a config the tool reads", async () => {
  const text = await readFile(README, "utf8");
  const blocks = [...text.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 4, "the README shows its config as YAML");
  for (const block of blocks) {
    const dir = await mkdtemp(join(tmpdir(), "forge-readme-"));
    await writeFile(join(dir, "openapi-forge.config.yaml"), block);
    const { config } = await loadConfigFile(dir);
    resolveOptions(config);
  }
});
