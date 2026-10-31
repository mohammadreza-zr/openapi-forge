import type { HttpClientName } from "../types.js";

// The part of the built-in runtime every library shares: the banner and the
// types of `types.ts` that do not name a data-fetching library.
export const BANNER =
  "/* Written once by openapi-forge. Edit freely — it is never overwritten. */";

/** The error of the `fetch` client, which has none of its own. */
const RESPONSE_ERROR = `
/** Thrown by the \`fetch\` client on a non-2xx status — fetch itself resolves on any status. */
export class ApiResponseError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(message: string, options: { status: number; body?: unknown }) {
    super(message);
    this.name = "ApiResponseError";
    this.status = options.status;
    this.body = options.body;
  }
}
`;

/** The types every library's `types.ts` shares; `http` decides whether it also holds the error class. */
export const typesBase = (http: HttpClientName): string => TYPES_BASE + (http === "fetch" ? RESPONSE_ERROR : "");

const TYPES_BASE = `
/** What every answer of the API is wrapped in. */
export type ApiEnvelope<T> = {
  result: boolean;
  code?: number;
  message?: unknown;
  data: T;
};

/** A paged answer: how many there are, and this page of them. */
export type ApiListData<T> = {
  count: number;
  list: T[];
};

/** What a generated request function takes beside its own arguments. */
export type GeneratedRequestConfig<T = unknown> = {
  signal?: AbortSignal;
  /** Written with \`String()\`; \`undefined\` and \`null\` leave a header out. A \`Content-Type\` that is not JSON sends the body as it is (an object as a form when it is \`application/x-www-form-urlencoded\`). */
  headers?: Record<string, unknown>;
  /** The query string. A list repeats the key (\`a=1&a=2\`), an object is \`a[b]=1\`; \`undefined\`, \`null\` and \`""\` are left out. */
  params?: Record<string, unknown>;
  /** Fills \`{name}\` in the route. */
  addTemplateToUrl?: Record<string, unknown>;
  /** Send the body as multipart form data: a list is a part per item, an object a JSON part. */
  isFormData?: boolean;
  /** How the client should read an answer that is not JSON: as text or as bytes (a Blob). */
  responseType?: "text" | "blob";
  /** The body of a \`DELETE\`, which has no body argument of its own. */
  body?: unknown;
  /** Prepended to the route; falls back to the client's default. */
  baseUrl?: string;
  /** Type-only: the payload this request resolves to. */
  readonly __payload?: T;
};
`;
