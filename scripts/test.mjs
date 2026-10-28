// Runs every `test/*.test.mjs`. `node --test` takes a glob only from Node 21,
// and the package supports Node 20, so the files are listed here.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../test/", import.meta.url));
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => `${dir}${name}`);

const { status } = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});
process.exit(status ?? 1);
