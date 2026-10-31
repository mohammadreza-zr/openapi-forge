// `client.ts` of the built-in runtime. The generated code decides what to send
// (the route, the query, the headers and the body the document asks for) and
// calls the client itself, with the client's own config, returning the client's
// own answer: nothing is parsed, unwrapped or re-thrown on the way.
//
// Where the API lives is read from the environment by every client.
// @mrzr/api-client finds its own base URL; axios, `fetch` and Angular's
// `HttpClient` cannot, so their `client.ts` reads it the same way (below).
import type { HttpClientName } from "../types.js";
import { BANNER } from "./base.js";

interface Transport {
  /** The written `client.ts`. */
  file: string;
  /** The same for a document with several backend services, when the client has a way to name them. */
  withServices?: string;
  /** Packages the written code imports (`doctor` looks for them). */
  packages: string[];
}

/**
 * The base URL, read from the environment the way @mrzr/api-client reads its
 * own: the same variable names, `import.meta.env` (Vite and the like) and
 * `process.env`, and `window.__API_BASE_URL__` to override. A framework that only
 * replaces literal `process.env.NAME` reads needs the name written out here.
 * (A plain string of the written file: no backtick, no dollar-brace.)
 */
const BASE_URL_FROM_ENV = `
const BASE_URL_KEYS = [
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_API_BASE_URL",
  "NEXT_PUBLIC_BASE_URL",
  "VITE_API_URL",
  "VITE_API_BASE_URL",
  "VITE_BASE_URL",
  "NUXT_PUBLIC_API_URL",
  "REACT_APP_API_URL",
  "EXPO_PUBLIC_API_URL",
  "PUBLIC_API_URL",
  "PUBLIC_API_BASE_URL",
  "API_URL",
  "API_BASE_URL",
];

/** The API base URL from the environment; empty when none is set. */
function baseUrlFromEnv(): string {
  const bags: Record<string, unknown>[] = [];
  try {
    const bag = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    if (bag) bags.push(bag);
  } catch {
    // not a module that has import.meta
  }
  const processEnv = (globalThis as { process?: { env?: Record<string, unknown> } }).process?.env;
  if (processEnv) bags.push(processEnv);
  const override = (globalThis as { __API_BASE_URL__?: unknown }).__API_BASE_URL__;
  if (typeof override === "string" && override) return override;
  for (const key of BASE_URL_KEYS) {
    for (const bag of bags) {
      const value = bag[key];
      if (typeof value === "string" && value) return value;
    }
  }
  return "";
}
`;

const TRANSPORTS: Record<HttpClientName, Transport> = {
  fetch: {
    file: `${BASE_URL_FROM_ENV}
/**
 * Where every generated call starts: the routes are written without the API's
 * prefix, which this base URL carries. This file is yours; set the variable
 * (VITE_API_URL, ...) or write the URL here.
 */
export const baseUrl = baseUrlFromEnv();
`,
    packages: [],
  },
  axios: {
    file: `import axios from "axios";
${BASE_URL_FROM_ENV}
/**
 * The instance every generated call goes through. This file is yours: base URL,
 * interceptors, adapters and defaults belong here. The base URL is read from the
 * environment (VITE_API_URL, ...); the routes are written without the API's prefix.
 */
export const http = axios.create({ baseURL: baseUrlFromEnv() });
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
    file: `${BASE_URL_FROM_ENV}
/**
 * Where every generated call starts: the routes are written without the API's
 * prefix, which this base URL carries. HttpClient itself is injected into the
 * services, so its interceptors apply. This file is yours.
 */
export const baseUrl = baseUrlFromEnv();
`,
    packages: ["@angular/common", "@angular/core", "rxjs"],
  },
};

export const HTTP_CLIENTS = Object.keys(TRANSPORTS) as HttpClientName[];

/** The packages the generated code of this client imports. */
export const httpPackages = (http: HttpClientName): string[] =>
  TRANSPORTS[http].packages;

/** The `client.ts` to write, or `null` when the client needs none. */
export function clientSource(http: HttpClientName, services = false): string {
  const { file, withServices } = TRANSPORTS[http];
  return `${BANNER}\n${services && withServices ? withServices : file}`;
}
