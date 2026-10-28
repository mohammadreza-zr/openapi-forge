// `client.ts` of the built-in runtime. Everything but one function is the same
// for every HTTP client: building the URL, the body and the headers, and
// judging the answer. `send` is what differs — it hands one prepared request
// to `fetch`, to an axios instance or to Angular's `HttpClient` and reports the
// status and the body.
import type { HttpClientName } from "../types.js";
import { BANNER } from "./base.js";

interface Transport {
  /** Import lines of the written file. */
  imports: string;
  /** Packages those imports need (`doctor` looks for them). */
  packages: string[];
  /** A line of the `settings` type, and its initial value, if the client has state. */
  setting?: { type: string; initial: string };
  /** The function(s) `send` is made of, and `send` itself. */
  send: string;
}

const TRANSPORTS: Record<HttpClientName, Transport> = {
  fetch: {
    imports: "",
    packages: [],
    send: `
async function send(
  method: string,
  url: string,
  headers: Record<string, string>,
  payload: BodyInit | undefined,
  signal: AbortSignal | undefined,
): Promise<Answer> {
  const response = await fetch(url, { method, headers, body: payload, signal });
  return {
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
    bytes: await response.arrayBuffer(),
  };
}
`,
  },
  axios: {
    imports: 'import axios, { type AxiosInstance } from "axios";',
    packages: ["axios"],
    setting: {
      type: "/** Interceptors, adapters and defaults live on the instance — replace it to bring your own. */\n  instance: AxiosInstance;",
      initial: "instance: axios.create()",
    },
    send: `
async function send(
  method: string,
  url: string,
  headers: Record<string, string>,
  payload: BodyInit | undefined,
  signal: AbortSignal | undefined,
): Promise<Answer> {
  const response = await settings.instance.request<ArrayBuffer>({
    method,
    url,
    headers,
    data: payload,
    signal,
    // The bytes are read below by content type, and the status is judged
    // there too, the same way for every HTTP client.
    responseType: "arraybuffer",
    validateStatus: () => true,
  });
  return {
    status: response.status,
    statusText: response.statusText,
    contentType: String(response.headers["content-type"] ?? "") || null,
    bytes: response.data,
  };
}
`,
  },
  "api-client": {
    imports: 'import { type ApiClient, createClient } from "@mrzr/api-client";',
    packages: ["@mrzr/api-client"],
    setting: {
      type: "/** Tokens, refresh, plugins and defaults live on the client — replace it to bring your own: `configureClient({ instance: createClient({ … }) })`. */\n  instance: ApiClient;",
      initial: 'instance: createClient({ baseUrl: "", worker: false })',
    },
    send: `
async function send(
  method: string,
  url: string,
  headers: Record<string, string>,
  payload: BodyInit | undefined,
  signal: AbortSignal | undefined,
): Promise<Answer> {
  const api = settings.instance;
  const config = {
    headers,
    signal,
    // The bytes are read below by content type, and the status is judged
    // there too, the same way for every HTTP client.
    responseType: "arrayBuffer" as const,
    fullData: true,
    throwError: false,
    // The body is already what goes on the wire: a string, a form, bytes.
    stringifyBody: false,
    isFormData: payload instanceof FormData,
  };
  const response =
    method === "GET"
      ? await api.get<ArrayBuffer>(url, config)
      : method === "DELETE"
        ? await api.delete<ArrayBuffer>(url, config)
        : await api[method.toLowerCase() as "post" | "put" | "patch"]<ArrayBuffer>(
            url,
            payload,
            config,
          );
  // A canceled request resolves with \`canceled\`; here it rejects, as in the others.
  if (response.canceled) {
    throw (
      signal?.reason ?? new DOMException("This operation was aborted", "AbortError")
    );
  }
  // A status of 0 is no answer at all — the network failed.
  if (response.statusCode === 0) {
    throw response.error ?? new Error(response.message);
  }
  // A failed answer with a textual type arrives already parsed (so that its
  // message and errors are filled in); back to bytes, for the one reader.
  const data: unknown = response.data;
  const bytes =
    data instanceof ArrayBuffer
      ? data
      : new TextEncoder().encode(
          data === undefined
            ? ""
            : typeof data === "string"
              ? data
              : JSON.stringify(data),
        );
  return {
    status: response.statusCode,
    statusText: response.message,
    contentType: response.headers?.["content-type"] ?? null,
    bytes,
  };
}
`,
  },
  angular: {
    imports: `import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { EmptyError, Observable, firstValueFrom, takeUntil } from "rxjs";`,
    packages: ["@angular/common", "rxjs"],
    setting: {
      type: "/** Angular's HttpClient, so its interceptors apply: \`configureClient({ instance: inject(HttpClient) })\` at start-up. */\n  instance?: HttpClient;",
      initial: "",
    },
    send: `
async function send(
  method: string,
  url: string,
  headers: Record<string, string>,
  payload: BodyInit | undefined,
  signal: AbortSignal | undefined,
): Promise<Answer> {
  const http = settings.instance;
  if (!http) {
    throw new Error(
      "configureClient({ instance: inject(HttpClient) }) must run before the first request.",
    );
  }
  // HttpClient takes no AbortSignal; unsubscribing from the request cancels it.
  const aborted = new Observable<void>((subscriber) => {
    if (signal?.aborted) subscriber.next();
    signal?.addEventListener("abort", () => subscriber.next(), { once: true });
  });
  try {
    const response = await firstValueFrom(
      http
        .request(method, url, {
          headers,
          body: payload,
          observe: "response",
          responseType: "arraybuffer",
        })
        .pipe(takeUntil(aborted)),
    );
    return {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      bytes: response.body ?? new ArrayBuffer(0),
    };
  } catch (error) {
    // A status of 0 is no answer at all — the network failed.
    if (error instanceof HttpErrorResponse && error.status !== 0) {
      return {
        status: error.status,
        statusText: error.statusText,
        contentType: error.headers.get("content-type"),
        bytes:
          error.error instanceof ArrayBuffer ? error.error : new ArrayBuffer(0),
      };
    }
    if (error instanceof EmptyError && signal?.aborted) {
      throw (
        signal.reason ?? new DOMException("This operation was aborted", "AbortError")
      );
    }
    throw error;
  }
}
`,
  },
};

export const HTTP_CLIENTS = Object.keys(TRANSPORTS) as HttpClientName[];

/** The packages the written `client.ts` imports. */
export const httpPackages = (http: HttpClientName): string[] =>
  TRANSPORTS[http].packages;

export function clientSource(http: HttpClientName): string {
  const { imports, setting, send } = TRANSPORTS[http];
  return `${BANNER}
${imports}
import {
  type ApiEnvelope,
  ApiResponseError,
  type GeneratedRequestConfig,
} from "./types";

/** What a transport hands back: the status and the answer's raw bytes. */
type Answer = {
  status: number;
  statusText: string;
  contentType: string | null;
  bytes: BufferSource;
};

/**
 * Where requests go when a call names no \`baseUrl\`. Set it once at start-up:
 * \`configureClient({ baseUrl: "https://api.example.com/v1" })\`.
 */
const settings: {
  baseUrl: string;
  headers: () => Record<string, string> | Promise<Record<string, string>>;${setting ? `\n  ${setting.type}` : ""}
} = { baseUrl: "", headers: () => ({})${setting?.initial ? `, ${setting.initial}` : ""} };

export function configureClient(next: Partial<typeof settings>) {
  Object.assign(settings, next);
}

/** \`a=1&a=2\` for a list, \`a[b]=1\` for an object; \`undefined\`, \`null\` and \`""\` are left out. */
function appendParam(query: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) appendParam(query, key, item);
  } else if (typeof value === "object") {
    for (const [name, item] of Object.entries(value)) {
      appendParam(query, \`\${key}[\${name}]\`, item);
    }
  } else {
    query.append(key, String(value));
  }
}

function buildUrl(
  route: string,
  config: GeneratedRequestConfig | undefined,
): string {
  let path = route;
  for (const [key, value] of Object.entries(config?.addTemplateToUrl ?? {})) {
    // A list is written \`a,b\`, an object \`name,value,name,value\`.
    const text =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.entries(value).flat().join(",")
        : String(value);
    path = path.replaceAll(\`{\${key}}\`, encodeURIComponent(text));
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(config?.params ?? {})) {
    appendParam(query, key, value);
  }
  const text = query.toString();
  const base = (config?.baseUrl ?? settings.baseUrl).replace(/\\/$/, "");
  return \`\${base}\${path}\${text ? \`?\${text}\` : ""}\`;
}

/** A header's value, whatever its capitals. */
const headerOf = (headers: Record<string, string>, name: string) =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];

/** What the body is sent as: multipart for an upload, the \`Content-Type\` the call names, JSON otherwise. */
function encodeBody(
  body: unknown,
  headers: Record<string, string>,
  isFormData: boolean | undefined,
): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (isFormData) {
    // One part per field: a file as it is, a list as a part per item, an
    // object as JSON, anything else as text.
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
  const type = headerOf(headers, "content-type") ?? "";
  if (type.startsWith("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(body)) {
      appendParam(form, name, value);
    }
    return form;
  }
  // Text and bytes (a \`Content-Type\` that is not JSON) are sent as they are.
  if (type && !type.includes("json")) return body as BodyInit;
  if (!type) headers["Content-Type"] = "application/json";
  return JSON.stringify(body);
}

/** The answer's payload by its content type: JSON parsed, text as it is, anything else a Blob. */
function readBody({ bytes, contentType }: Answer): unknown {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const isJson = type.includes("json");
  const isText = type.startsWith("text/") && !isJson;
  if (type && !isJson && !isText) return new Blob([bytes], { type });
  if (!bytes.byteLength) return null;
  const text = new TextDecoder().decode(bytes);
  if (isText) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The payload of an answer. Only a call marked \`isEnvelope\` is unwrapped — the
 * request function knows from the document that its answer is wrapped — so a
 * payload that merely has a \`result\` field is never mistaken for one.
 */
function unwrap<T>(body: unknown, status: number, isEnvelope?: boolean): T {
  const envelope = body as Partial<ApiEnvelope<T>> | null;
  if (!isEnvelope || !envelope || typeof envelope !== "object") return body as T;
  if (!("result" in envelope)) return body as T;
  if (envelope.result === false) {
    throw new ApiResponseError(
      typeof envelope.message === "string"
        ? envelope.message
        : "The request failed.",
      { status, code: envelope.code, body },
    );
  }
  return envelope.data as T;
}
${send}
async function request<T>(
  method: string,
  route: string,
  body: unknown,
  config?: GeneratedRequestConfig<T>,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    ...(await settings.headers()),
  };
  // A header's value is written with \`String()\`; \`undefined\` and \`null\` leave it out.
  for (const [name, value] of Object.entries(config?.headers ?? {})) {
    if (value !== undefined && value !== null) headers[name] = String(value);
  }
  const payload = encodeBody(body, headers, config?.isFormData);
  const answer = await send(
    method,
    buildUrl(route, config),
    headers,
    payload,
    config?.signal,
  );
  const answerBody = readBody(answer);
  if (answer.status < 200 || answer.status > 299) {
    throw new ApiResponseError(answer.statusText || "The request failed.", {
      status: answer.status,
      body: answerBody,
    });
  }
  return unwrap<T>(answerBody, answer.status, config?.isEnvelope);
}

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
}
