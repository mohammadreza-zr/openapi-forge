// The runtime `client: "builtin"` writes beside the generated API layer: a
// fetch-based transport, the hooks over it, and the types both share. They
// are plain files in the project — edit them freely, they are written once
// and never overwritten (pass --force-runtime to reset them).

export const TYPES_TS = `/* Written once by openapi-forge. Edit freely — it is never overwritten. */

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

/** Appended to \`types.ts\` when the hooks are generated too. */
export const OPTION_TYPES_IMPORT = `
import type {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
} from "@tanstack/react-query";
`;

export const OPTION_TYPES_TS = `
/** What a generated query hook takes beside its arguments. */
export type ApiQueryOptions<
  TData,
  TKey extends QueryKey = QueryKey,
> = Omit<UseQueryOptions<TData, Error, TData, TKey>, "queryKey" | "queryFn">;

/** What a generated mutation hook takes beside its variables. */
export type ApiMutationOptions<TData, TVariables> = Omit<
  UseMutationOptions<TData, Error, TVariables>,
  "mutationFn"
>;
`;

export const CLIENT_TS = `/* Written once by openapi-forge. Edit freely — it is never overwritten. */
import {
  type ApiEnvelope,
  ApiResponseError,
  type GeneratedRequestConfig,
} from "./types";

/**
 * Where requests go when a call names no \`baseUrl\`. Set it once at start-up:
 * \`configureClient({ baseUrl: "https://api.example.com/v1" })\`.
 */
const settings: {
  baseUrl: string;
  headers: () => Record<string, string> | Promise<Record<string, string>>;
} = { baseUrl: "", headers: () => ({}) };

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
  const response = await fetch(buildUrl(route, config), {
    method,
    headers,
    body: payload,
    signal: config?.signal,
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    throw new ApiResponseError(response.statusText || "The request failed.", {
      status: response.status,
      body: parsed,
    });
  }
  return unwrap<T>(parsed, response.status);
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

export const HOOKS_TS = `/* Written once by openapi-forge. Edit freely — it is never overwritten. */
import {
  type MutationKey,
  type QueryKey,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { ApiMutationOptions, ApiQueryOptions } from "./types";

export function useApiQuery<TData, TKey extends QueryKey>(
  key: TKey,
  fetcher: (signal: AbortSignal) => Promise<TData>,
  options?: ApiQueryOptions<TData, TKey>,
) {
  return useQuery<TData, Error, TData, TKey>({
    ...options,
    queryKey: key,
    queryFn: ({ signal }) => fetcher(signal),
  });
}

export function useApiMutation<TData, TVariables>(
  key: MutationKey,
  mutate: (variables: TVariables, signal: AbortSignal) => Promise<TData>,
  options?: ApiMutationOptions<TData, TVariables>,
) {
  // Every call gets a signal; leaving the screen aborts what is still in flight.
  const pending = useRef(new Set<AbortController>());
  useEffect(() => {
    const controllers = pending.current;
    return () => {
      for (const controller of controllers) controller.abort();
    };
  }, []);

  return useMutation<TData, Error, TVariables>({
    ...options,
    mutationKey: key,
    mutationFn: async (variables) => {
      const controller = new AbortController();
      pending.current.add(controller);
      try {
        return await mutate(variables, controller.signal);
      } finally {
        pending.current.delete(controller);
      }
    },
  });
}
`;

/** Added to `types.ts` and `hooks.ts` when `infinite` is on. */
export const INFINITE_TYPES_TS = `
/** What a generated infinite-list hook takes beside its query. */
export type ApiInfiniteQueryOptions<
  TItem,
  TKey extends QueryKey = QueryKey,
> = Omit<
  UseInfiniteQueryOptions<
    ApiListData<TItem>,
    Error,
    InfiniteData<ApiListData<TItem>>,
    TKey,
    number
  >,
  "queryKey" | "queryFn" | "initialPageParam" | "getNextPageParam"
> & { pageSize?: number };
`;

export const INFINITE_HOOK_TS = `
/** A list read page by page: each page starts where the loaded ones end. */
export function useApiInfiniteQuery<TItem, TKey extends QueryKey>(
  key: TKey,
  fetcher: (
    page: { start: number; size: number },
    signal: AbortSignal,
  ) => Promise<ApiListData<TItem>>,
  { pageSize = 20, ...options }: ApiInfiniteQueryOptions<TItem, TKey> = {},
) {
  return useInfiniteQuery({
    ...options,
    queryKey: key,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetcher({ start: pageParam, size: pageSize }, signal),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.list.length, 0);
      return last.list.length && loaded < last.count ? loaded : undefined;
    },
  });
}
`;
