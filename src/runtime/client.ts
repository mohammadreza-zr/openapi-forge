// `client.ts` of the built-in runtime, for the clients that have an instance to
// own. The generated code decides what to send (the route, the query, the
// headers and the body the document asks for) and calls the client itself, with
// the client's own config, returning the client's own answer: nothing is
// parsed, unwrapped or re-thrown on the way.
//
// `fetch` has no client to configure (it is a function of the platform) and
// Angular's `HttpClient` is injected into the generated service, so neither
// writes a `client.ts`.
import type { HttpClientName } from "../types.js";
import { BANNER } from "./base.js";

interface Transport {
  /** The written `client.ts`; `null` when the generated code needs none. */
  file: string | null;
  /** The same for a document with several backend services, when the client has a way to name them. */
  withServices?: string;
  /** Packages the written code imports (`doctor` looks for them). */
  packages: string[];
}

const TRANSPORTS: Record<HttpClientName, Transport> = {
  fetch: { file: null, packages: [] },
  axios: {
    file: `import axios from "axios";

/**
 * The instance every generated call goes through. This file is yours: base URL,
 * interceptors, adapters and defaults belong here,
 * e.g. axios.create({ baseURL: "https://api.example.com/v1" }).
 */
export const http = axios.create();
`,
    packages: ["axios"],
  },
  "api-client": {
    file: `import { createClient } from "@mrzr/api-client";

/**
 * The client every generated call goes through. This file is yours: give it the
 * base URL, tokens and plugins it needs, e.g. createClient({ baseUrl: "https://api.example.com/v1" }).
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
 * base URL, tokens and plugins it needs, e.g. createClient({ baseUrl: "https://api.example.com/v1", plugins: [services(API_SERVICE_BASE_URLS)] }).
 * Each backend service of the document is a service of this client.
 */
export const apiClient = createClient({
  plugins: [services(API_SERVICE_BASE_URLS)],
});
`,
    packages: ["@mrzr/api-client"],
  },
  angular: {
    file: null,
    packages: ["@angular/common", "@angular/core", "rxjs"],
  },
};

export const HTTP_CLIENTS = Object.keys(TRANSPORTS) as HttpClientName[];

/** The packages the generated code of this client imports. */
export const httpPackages = (http: HttpClientName): string[] =>
  TRANSPORTS[http].packages;

/** The `client.ts` to write, or `null` when the client needs none. */
export function clientSource(http: HttpClientName, services = false): string | null {
  const { file, withServices } = TRANSPORTS[http];
  const text = services && withServices ? withServices : file;
  return text === null ? null : `${BANNER}\n${text}`;
}
