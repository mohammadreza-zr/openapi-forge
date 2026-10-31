// `client.ts` of the built-in runtime. The generated code decides what to send
// (the route, the query, the headers and the body the document asks for); each
// file below only hands that to its HTTP client and returns what the client
// returns. Nothing is parsed, unwrapped or re-thrown on the way: an axios call
// answers like axios, an Angular call like `HttpClient`, an `@mrzr/api-client`
// call like `@mrzr/api-client`.
import type { HttpClientName } from "../types.js";
import { BANNER } from "./base.js";

interface Transport {
  /** Import lines of the written file. */
  imports: string;
  /** Packages those imports need (`doctor` looks for them). */
  packages: string[];
  /** Everything after the imports: settings, the helpers it uses and the verbs. */
  source: string;
}

// The pieces below are written into `client.ts`, so they hold no backtick and
// no `${`: they are plain strings of the emitted file.

/** How a path parameter is written, and the route with its `{name}` filled in. */
const PATH = `
/** How a path parameter is written: "a,b" for a list, "name,value,name,value" for an object. */
function pathText(value: unknown): string {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value).flat().join(",")
    : String(value);
}
`;

const FILL_PATH = `
/** The route with its {name} filled in. */
function fillPath(route: string, values: Record<string, unknown> = {}): string {
  let path = route;
  for (const [key, value] of Object.entries(values)) {
    path = path.replaceAll("{" + key + "}", encodeURIComponent(pathText(value)));
  }
  return path;
}
`;

/** The headers, the query string and the body, written as the document asks. */
const WIRE = `
/** Header values are text on the wire; undefined and null leave a header out. */
function textHeaders(headers: Record<string, unknown> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) out[name] = String(value);
  }
  return out;
}

/** The Content-Type the call names, lower-cased; empty when it names none. */
const contentTypeOf = (headers: Record<string, string>) =>
  (
    Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? ""
  ).toLowerCase();

/** "a=1&a=2" for a list, "a[b]=1" for an object; undefined, null and "" are left out. */
function appendParam(query: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) appendParam(query, key, item);
  } else if (typeof value === "object") {
    for (const [name, item] of Object.entries(value)) {
      appendParam(query, key + "[" + name + "]", item);
    }
  } else {
    query.append(key, String(value));
  }
}

/**
 * The body in the form its media type asks for: multipart for an upload (a file
 * as it is, a list as a part per item, an object as JSON), a form for
 * application/x-www-form-urlencoded. Anything else — a JSON value, text, bytes —
 * is handed to the client as it is.
 */
function shapeBody(
  body: unknown,
  headers: Record<string, string>,
  isFormData: boolean | undefined,
): unknown {
  if (body === undefined || body === null) return undefined;
  if (isFormData) {
    const form = new FormData();
    for (const [name, value] of Object.entries(body)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item === undefined || item === null) continue;
        form.append(
          name,
          item instanceof Blob
            ? item
            : typeof item === "object"
              ? JSON.stringify(item)
              : String(item),
        );
      }
    }
    return form;
  }
  if (contentTypeOf(headers).startsWith("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(body)) {
      appendParam(form, name, value);
    }
    return form;
  }
  return body;
}
`;

/** The query string, for the clients that take it ready (@mrzr/api-client writes its own). */
const QUERY = `
function queryOf(params: Record<string, unknown> = {}): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    appendParam(query, key, value);
  }
  return query;
}
`;

/** The verbs every client exports, over its own `request`. */
const VERBS = `
export const apiGet = <T>(route: string, config?: GeneratedRequestConfig<T>) =>
  request<T>("GET", route, undefined, config);
export const apiDelete = <T>(
  route: string,
  config?: GeneratedRequestConfig<T>,
) => request<T>("DELETE", route, config?.body, config);
export const apiPost = <T>(
  route: string,
  body: unknown,
  config?: GeneratedRequestConfig<T>,
) => request<T>("POST", route, body, config);
export const apiPut = <T>(
  route: string,
  body: unknown,
  config?: GeneratedRequestConfig<T>,
) => request<T>("PUT", route, body, config);
export const apiPatch = <T>(
  route: string,
  body: unknown,
  config?: GeneratedRequestConfig<T>,
) => request<T>("PATCH", route, body, config);
`;

const TRANSPORTS: Record<HttpClientName, Transport> = {
  fetch: {
    imports: 'import { ApiResponseError, type GeneratedRequestConfig } from "./types";',
    packages: [],
    source: `
/**
 * Where requests go when a call names no baseUrl, and the headers every request
 * carries. Set them once at start-up:
 * configureClient({ baseUrl: "https://api.example.com/v1" }).
 */
const settings: {
  baseUrl: string;
  headers: () => Record<string, string> | Promise<Record<string, string>>;
} = { baseUrl: "", headers: () => ({}) };

export function configureClient(next: Partial<typeof settings>) {
  Object.assign(settings, next);
}
${PATH}${FILL_PATH}${WIRE}${QUERY}
/** The answer by its Content-Type: JSON parsed, text as it is, anything else a Blob; an empty answer is null. */
async function readBody(response: Response): Promise<unknown> {
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const isJson = type.includes("json");
  if (type && !isJson && !type.startsWith("text/")) return response.blob();
  const text = await response.text();
  if (!text) return null;
  if (type.startsWith("text/") && !isJson) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(
  method: string,
  route: string,
  body: unknown,
  config?: GeneratedRequestConfig<T>,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    ...(await settings.headers()),
    ...textHeaders(config?.headers),
  };
  let payload = shapeBody(body, headers, config?.isFormData);
  const type = contentTypeOf(headers);
  // fetch sends text, bytes and forms as they are; a JSON value is written out here.
  if (
    payload !== undefined &&
    !(payload instanceof FormData) &&
    !(payload instanceof URLSearchParams) &&
    (!type || type.includes("json"))
  ) {
    if (!type) headers["Content-Type"] = "application/json";
    payload = JSON.stringify(payload);
  }
  const query = queryOf(config?.params).toString();
  const base = (config?.baseUrl ?? settings.baseUrl).replace(/\\/$/, "");
  const response = await fetch(
    base + fillPath(route, config?.addTemplateToUrl) + (query ? "?" + query : ""),
    { method, headers, body: payload as BodyInit | undefined, signal: config?.signal },
  );
  const answer = await readBody(response);
  // fetch resolves on any status; a failed one rejects here, as the other clients do natively.
  if (!response.ok) {
    throw new ApiResponseError(response.statusText || "The request failed.", {
      status: response.status,
      body: answer,
    });
  }
  return answer as T;
}
${VERBS}`,
  },
  axios: {
    imports: `import axios, { type AxiosInstance } from "axios";
import type { GeneratedRequestConfig } from "./types";`,
    packages: ["axios"],
    source: `
/**
 * Interceptors, adapters, base URL and defaults live on the instance — replace
 * it to bring your own: configureClient({ instance }).
 */
const settings: { instance: AxiosInstance } = { instance: axios.create() };

export function configureClient(next: Partial<typeof settings>) {
  Object.assign(settings, next);
}
${PATH}${FILL_PATH}${WIRE}${QUERY}
/** The answer is axios's own: its parsing, its interceptors, and an AxiosError on a failed status. */
async function request<T>(
  method: string,
  route: string,
  body: unknown,
  config?: GeneratedRequestConfig<T>,
): Promise<T> {
  const headers = textHeaders(config?.headers);
  const response = await settings.instance.request<T>({
    method,
    url: fillPath(route, config?.addTemplateToUrl),
    baseURL: config?.baseUrl,
    params: queryOf(config?.params),
    headers,
    data: shapeBody(body, headers, config?.isFormData),
    responseType: config?.responseType,
    signal: config?.signal,
  });
  return response.data;
}
${VERBS}`,
  },
  "api-client": {
    imports: 'import { createClient } from "@mrzr/api-client";',
    packages: ["@mrzr/api-client"],
    // The generated functions call the client themselves, with its own config,
    // and return its own answer: there is no wrapper and nothing to configure
    // here but the client itself, in the file the project owns.
    source: `
/**
 * The client every generated call goes through. This file is yours: give it the
 * base URL, tokens and plugins it needs, e.g. createClient({ baseUrl: "https://api.example.com/v1" }).
 */
export const apiClient = createClient();
`,
  },
  angular: {
    imports: `import { HttpClient } from "@angular/common/http";
import { EmptyError, Observable, firstValueFrom, takeUntil } from "rxjs";
import type { GeneratedRequestConfig } from "./types";`,
    packages: ["@angular/common", "rxjs"],
    source: `
/**
 * Angular's HttpClient, so its interceptors apply: configureClient({ instance:
 * inject(HttpClient) }) at start-up. HttpClient has no base URL of its own: put
 * the API's in an interceptor, as any Angular app does.
 */
const settings: { instance?: HttpClient } = {};

export function configureClient(next: Partial<typeof settings>) {
  Object.assign(settings, next);
}
${PATH}${FILL_PATH}${WIRE}${QUERY}
/** The answer is HttpClient's own: its parsing, its interceptors, and an HttpErrorResponse on a failed status. */
async function request<T>(
  method: string,
  route: string,
  body: unknown,
  config?: GeneratedRequestConfig<T>,
): Promise<T> {
  const http = settings.instance;
  if (!http) {
    throw new Error(
      "configureClient({ instance: inject(HttpClient) }) must run before the first request.",
    );
  }
  const headers = textHeaders(config?.headers);
  const params: Record<string, string[]> = {};
  for (const [key, value] of queryOf(config?.params)) (params[key] ??= []).push(value);
  const signal = config?.signal;
  // HttpClient takes no AbortSignal; unsubscribing from the request cancels it.
  const aborted = new Observable<void>((subscriber) => {
    if (signal?.aborted) subscriber.next();
    signal?.addEventListener("abort", () => subscriber.next(), { once: true });
  });
  // Only a call that names its own base URL (a service of its own) gets one here.
  const base = (config?.baseUrl ?? "").replace(/\\/$/, "");
  try {
    return await firstValueFrom(
      http
        .request<T>(method, base + fillPath(route, config?.addTemplateToUrl), {
          headers,
          params,
          body: shapeBody(body, headers, config?.isFormData),
          // HttpClient reads the answer as it is told to; the kind is typed per overload.
          responseType: (config?.responseType ?? "json") as "json",
        })
        .pipe(takeUntil(aborted)),
    );
  } catch (error) {
    // takeUntil ended the stream with nothing in it: that is the abort.
    if (error instanceof EmptyError && signal?.aborted) {
      throw (
        signal.reason ?? new DOMException("This operation was aborted", "AbortError")
      );
    }
    throw error;
  }
}
${VERBS}`,
  },
};

export const HTTP_CLIENTS = Object.keys(TRANSPORTS) as HttpClientName[];

/** The packages the written `client.ts` imports. */
export const httpPackages = (http: HttpClientName): string[] =>
  TRANSPORTS[http].packages;

export function clientSource(http: HttpClientName): string {
  const { imports, source } = TRANSPORTS[http];
  return `${BANNER}\n${imports}\n${source}`;
}
