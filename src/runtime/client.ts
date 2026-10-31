// `client.ts` of the built-in runtime. The generated code decides what to send
// (the route, the query, the headers and the body the document asks for) and
// calls the client itself, with the client's own config, returning the client's
// own answer: nothing is parsed, unwrapped or re-thrown on the way.
//
// Where the API lives is read from the environment by every client, in its own
// way: @mrzr/api-client finds it itself (it reads VITE_API_URL, among others);
// axios takes it as `baseURL`, and `fetch` and Angular's `HttpClient`, which have
// nothing to hold it, start every call from the `baseUrl` this file exports.
import type { HttpClientName } from "../types.js";
import { BANNER } from "./base.js";

/** What the layer being written needs of its `client.ts`. */
export interface Layer {
  /** The environment variable axios, `fetch` and Angular read the base URL from. */
  env: string;
  /** More than one backend service: the client names them (api-client's `services` plugin). */
  services: boolean;
  /** Some operation belongs to no service: it starts from the client's own base URL. */
  main: boolean;
}

interface Transport {
  /** The written `client.ts`; `null` when this layer has no use for one. */
  file: string | null | ((layer: Layer) => string | null);
  /** The same for a document with several backend services, when the client has a way to name them. */
  withServices?: string;
  /** Packages the written code imports (`doctor` looks for them). */
  packages: string[];
}

const TRANSPORTS: Record<HttpClientName, Transport> = {
  fetch: {
    // Only a call of the main service starts from this base URL: when every
    // operation names a service of its own, there is nothing to export.
    file: ({ main, env }) =>
      main
        ? `/**
 * Where every generated call starts: the routes are written without the API's
 * prefix, which this base URL carries (${env}=https://host/api/v1).
 * This file is yours.
 */
export const baseUrl: string = import.meta.env.${env} ?? "";
`
        : null,
    packages: [],
  },
  axios: {
    file: ({ main, env }) => `import axios from "axios";

/**
 * The instance every generated call goes through. This file is yours: interceptors,
 * adapters and defaults belong here.${
   main
     ? `
 * The routes are written without the API's prefix, which the base URL carries
 * (${env}=https://host/api/v1).`
     : `
 * Every operation names a service of its own, whose base URL is the call's.`
 }
 */
export const http = axios.create(${main ? `{ baseURL: import.meta.env.${env} }` : ""});
`,
    packages: ["axios"],
  },
  "api-client": {
    file: `import { createClient } from "@mrzr/api-client";

/**
 * The client every generated call goes through. This file is yours: give it the
 * tokens and plugins it needs. It finds its base URL in the environment itself
 * (VITE_API_URL, ...); createClient({ baseUrl: "https://api.example.com/v1" }) sets it.
 */
export const apiClient = createClient();
`,
    // A document with several services is the client's own `services` plugin:
    // `apiClient.service("files").get(…)`. The names and base URLs are
    // `services.ts`'s, which the run keeps in step with the document.
    withServices: `import { createClient } from "@mrzr/api-client";
import { services } from "@mrzr/api-client/services";
import { API_SERVICE_BASE_URLS } from "./services";

/**
 * The client every generated call goes through. This file is yours: give it the
 * tokens and plugins it needs. It finds its base URL in the environment itself
 * (VITE_API_URL, ...). Each backend service of the document is a service of this client.
 */
export const apiClient = createClient({
  plugins: [services(API_SERVICE_BASE_URLS)],
});
`,
    packages: ["@mrzr/api-client"],
  },
  angular: {
    file: ({ main, env }) =>
      main
        ? `/**
 * Where every generated call starts: the routes are written without the API's
 * prefix, which this base URL carries (${env}=https://host/api/v1).
 * HttpClient itself is injected into the services, so its interceptors apply.
 * This file is yours.
 */
export const baseUrl: string = import.meta.env.${env} ?? "";
`
        : null,
    packages: ["@angular/common", "@angular/core", "rxjs"],
  },
};

export const HTTP_CLIENTS = Object.keys(TRANSPORTS) as HttpClientName[];

/** The packages the generated code of this client imports. */
export const httpPackages = (http: HttpClientName): string[] =>
  TRANSPORTS[http].packages;

/** The `client.ts` to write, or `null` when this layer needs none. */
export function clientSource(
  http: HttpClientName,
  layer: Layer = { services: false, main: true, env: "VITE_API_URL" },
): string | null {
  const { file, withServices } = TRANSPORTS[http];
  const chosen = layer.services && withServices ? withServices : file;
  const text = typeof chosen === "function" ? chosen(layer) : chosen;
  return text === null ? null : `${BANNER}\n${text}`;
}
