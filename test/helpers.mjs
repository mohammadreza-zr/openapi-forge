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

/**
 * Options as a run would resolve them; raw output, so no prettier is needed.
 * Most tests are about what is emitted for a client that goes through
 * `apiGet(route, config)`, so that is the default here; `http: "api-client"`
 * (the product's default, called straight on the client) is asked for by name.
 */
export const options = (patch = {}) =>
  resolveOptions({ apiPrefix: "/api/v1", format: false, http: "fetch" }, patch);

/** What the transport must get right: payloads that look like envelopes, headers, forms, bytes, lists. */
export const EDGES_FIXTURE = fileURLToPath(
  new URL("./fixtures/edges.yaml", import.meta.url),
);
export const edges = () => parse(readFileSync(EDGES_FIXTURE, "utf8"));
