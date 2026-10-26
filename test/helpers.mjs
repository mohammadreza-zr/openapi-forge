import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { resolveOptions } from "../dist/config.js";

export const FIXTURE = fileURLToPath(
  new URL("./fixtures/petstore.yaml", import.meta.url),
);

export const petstore = () => parse(readFileSync(FIXTURE, "utf8"));

/** Options as a run would resolve them; raw output, so no prettier is needed. */
export const options = (patch = {}) =>
  resolveOptions({ apiPrefix: "/api/v1", format: false }, patch);
