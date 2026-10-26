import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { resolveOptions } from "../dist/config.js";

export const FIXTURE = fileURLToPath(
  new URL("./fixtures/petstore.yaml", import.meta.url),
);

export const petstore = () => parse(readFileSync(FIXTURE, "utf8"));

/** Petstore plus what every client must cover: a paged read, a path id with a required query. */
export const CLIENTS_FIXTURE = fileURLToPath(
  new URL("./fixtures/clients.yaml", import.meta.url),
);
export const clients = () => parse(readFileSync(CLIENTS_FIXTURE, "utf8"));

/** Options as a run would resolve them; raw output, so no prettier is needed. */
export const options = (patch = {}) =>
  resolveOptions({ apiPrefix: "/api/v1", format: false }, patch);
