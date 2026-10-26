// The part of the built-in runtime every library shares: the banner and the
// types of `types.ts` that do not name a data-fetching library.
export const BANNER =
  "/* Written once by openapi-forge. Edit freely — it is never overwritten. */";

export const TYPES_BASE = `
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

/** Thrown when the API answers \`result: false\` or a non-2xx status. */
export class ApiResponseError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly body?: unknown;

  constructor(
    message: string,
    options: { status: number; code?: number; body?: unknown },
  ) {
    super(message);
    this.name = "ApiResponseError";
    this.status = options.status;
    this.code = options.code;
    this.body = options.body;
  }
}

/** What a generated request function takes beside its own arguments. */
export type GeneratedRequestConfig<T = unknown> = {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** The query string. Arrays repeat the key; \`undefined\` and \`null\` are left out. */
  params?: Record<string, unknown>;
  /** Fills \`{name}\` in the route. */
  addTemplateToUrl?: Record<string, unknown>;
  /** Send the body as multipart form data. */
  isFormData?: boolean;
  /** Prepended to the route; falls back to the client's default. */
  baseUrl?: string;
  /** Type-only: the payload this request resolves to. */
  readonly __payload?: T;
};
`;
