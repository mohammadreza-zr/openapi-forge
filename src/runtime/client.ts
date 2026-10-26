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

/** A body read as text: JSON when it is JSON, the text itself otherwise. */
const READ_BODY = `
function readBody(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
`;

const TRANSPORTS: Record<HttpClientName, Transport> = {
  fetch: {
    imports: "",
    packages: [],
    send: `${READ_BODY}
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
    body: readBody(await response.text()),
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
  const response = await settings.instance.request({
    method,
    url,
    headers,
    data: payload,
    signal,
    // The status is judged below, the same way for every HTTP client.
    validateStatus: () => true,
  });
  return {
    status: response.status,
    statusText: response.statusText,
    body: response.data === "" ? null : response.data,
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
    send: `${READ_BODY}
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
          responseType: "text",
        })
        .pipe(takeUntil(aborted)),
    );
    return {
      status: response.status,
      statusText: response.statusText,
      body: readBody(response.body),
    };
  } catch (error) {
    // A status of 0 is no answer at all — the network failed.
    if (error instanceof HttpErrorResponse && error.status !== 0) {
      return {
        status: error.status,
        statusText: error.statusText,
        body: readBody(typeof error.error === "string" ? error.error : null),
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

type Answer = { status: number; statusText: string; body: unknown };

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

function buildUrl(
  route: string,
  config: GeneratedRequestConfig | undefined,
): string {
  let path = route;
  for (const [key, value] of Object.entries(config?.addTemplateToUrl ?? {})) {
    path = path.replaceAll(
      \`{\${key}}\`,
      encodeURIComponent(String(Array.isArray(value) ? value.join(",") : value)),
    );
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(config?.params ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null && item !== "")
        query.append(key, String(item));
    }
  }
  const text = query.toString();
  const base = (config?.baseUrl ?? settings.baseUrl).replace(/\\/$/, "");
  return \`\${base}\${path}\${text ? \`?\${text}\` : ""}\`;
}

/** An answer's payload: the envelope's \`data\` when it is one, else the JSON itself. */
function unwrap<T>(body: unknown, status: number): T {
  const envelope = body as Partial<ApiEnvelope<T>> | null;
  if (envelope && typeof envelope === "object" && "result" in envelope) {
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
  return body as T;
}
${send}
async function request<T>(
  method: string,
  route: string,
  body: unknown,
  config?: GeneratedRequestConfig<T>,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(await settings.headers()),
    ...config?.headers,
  };
  let payload: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (config?.isFormData) {
      const form = new FormData();
      for (const [key, value] of Object.entries(body as object)) {
        if (value === undefined || value === null) continue;
        form.append(key, value instanceof Blob ? value : String(value));
      }
      payload = form;
    } else {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  const answer = await send(
    method,
    buildUrl(route, config),
    headers,
    payload,
    config?.signal,
  );
  if (answer.status < 200 || answer.status > 299) {
    throw new ApiResponseError(answer.statusText || "The request failed.", {
      status: answer.status,
      body: answer.body,
    });
  }
  return unwrap<T>(answer.body, answer.status);
}

export const apiGet = <T>(route: string, config?: GeneratedRequestConfig<T>) =>
  request<T>("GET", route, undefined, config);
export const apiDelete = <T>(
  route: string,
  config?: GeneratedRequestConfig<T>,
) => request<T>("DELETE", route, undefined, config);
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
