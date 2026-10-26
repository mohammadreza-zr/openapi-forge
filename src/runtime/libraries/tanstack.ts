// What the TanStack Query adapters have in common: the option types, and —
// for the libraries whose factories take a function returning the options
// (Svelte, Solid, Angular) — the hooks themselves.
import { BANNER } from "../base.js";

/** How a TanStack package spells its option types — they differ per framework. */
export interface TanstackShape {
  pkg: string;
  /** Type names to import from the package, beside \`QueryKey\`; the second list is for \`infinite\`. */
  imports: string[];
  infiniteImports: string[];
  /** Further type imports, and the definition of \`MaybeGetter\` for a reactive library. */
  extra?: string;
  maybeGetter?: string;
  /** The options of a query, a mutation and an infinite query, written as types. */
  query: string;
  mutation: string;
  infinite: string;
}

/** The ordinary form: the package's own \`<Prefix>QueryOptions\` family. */
export const ownOptions = (pkg: string, prefix: "Use" | "Create") => ({
  pkg,
  imports: [`${prefix}QueryOptions`, `${prefix}MutationOptions`],
  infiniteImports: [`${prefix}InfiniteQueryOptions`],
  query: `${prefix}QueryOptions<TData, Error, TData, TKey>`,
  mutation: `${prefix}MutationOptions<TData, Error, TVariables>`,
  infinite: `${prefix}InfiniteQueryOptions<ApiListData<TItem>, Error, InfiniteData<ApiListData<TItem>>, TKey, number>`,
});

/** \`ApiQueryOptions\` and friends: a library's own options minus what the generated hook sets. */
export function tanstackTypes(shape: TanstackShape, infinite: boolean) {
  const names = [
    ...(infinite ? ["InfiniteData", ...shape.infiniteImports] : []),
    "QueryKey",
    ...shape.imports,
  ];
  const imports = `${shape.extra ?? ""}
import type {
  ${names.join(",\n  ")},
} from "${shape.pkg}";
`;
  const body = `
${shape.maybeGetter ?? ""}
/** What a generated query hook takes beside its arguments. */
export type ApiQueryOptions<
  TData,
  TKey extends QueryKey = QueryKey,
> = Omit<${shape.query}, "queryKey" | "queryFn">;

/** What a generated mutation hook takes beside its variables. */
export type ApiMutationOptions<TData, TVariables> = Omit<
  ${shape.mutation},
  "mutationFn"
>;
${
  infinite
    ? `
/** What a generated infinite-list hook takes beside its query. */
export type ApiInfiniteQueryOptions<
  TItem,
  TKey extends QueryKey = QueryKey,
> = Omit<
  ${shape.infinite},
  "queryKey" | "queryFn" | "initialPageParam" | "getNextPageParam"
> & { pageSize?: number };
`
    : ""
}`;
  return { imports, body };
}

/** The next page starts where the loaded ones end. */
export const NEXT_PAGE = `(last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.list.length, 0);
      return last.list.length && loaded < last.count ? loaded : undefined;
    }`;

/** `MaybeGetter` for the libraries whose arguments are plain values or getters. */
export const GETTER_TYPE = `
/** An argument given as a value, or as a function that reads it when needed. */
export type MaybeGetter<T> = T | (() => T);
`;

export const GETTER_TO_VALUE = `
export const toValue = <T>(value: MaybeGetter<T>): T =>
  typeof value === "function" ? (value as () => T)() : value;
`;

interface ThunkLibrary {
  pkg: string;
  prefix: string;
  /** The factories of the package. */
  createQuery: string;
  createMutation: string;
  createInfinite: string;
  /** Imports of the teardown below. */
  imports?: string;
  /**
   * Runs when the mutation hook is called; `abortAll` cancels the requests
   * still in flight, and belongs to whatever tears the caller down.
   */
  teardown?: string;
}

/** `hooks.ts` for a library whose factories take `() => options`. */
export function thunkHooks(lib: ThunkLibrary, infinite: boolean): string {
  const { prefix } = lib;
  return `${BANNER}
import {
  type MutationKey,
  type QueryKey,
  ${lib.createInfinite && infinite ? `${lib.createInfinite},` : ""}
  ${lib.createMutation},
  ${lib.createQuery},
} from "${lib.pkg}";
${lib.imports ?? ""}
import type {
  ${infinite ? "ApiInfiniteQueryOptions,\n  ApiListData," : ""}
  ApiMutationOptions,
  ApiQueryOptions,
  MaybeGetter,
} from "./types";
${GETTER_TO_VALUE}
/**
 * The key and the guard are functions: they are read again whenever an
 * argument they depend on changes.
 */
export function ${prefix}ApiQuery<TData, TKey extends QueryKey>(
  key: () => TKey,
  fetcher: (signal: AbortSignal) => Promise<TData>,
  options?: ApiQueryOptions<TData, TKey>,
  enabled: () => boolean = () => true,
) {
  return ${lib.createQuery}<TData, Error, TData, TKey>(() => ({
    ...options,
    queryKey: key(),
    queryFn: ({ signal }) => fetcher(signal),
    enabled: options?.enabled ?? enabled(),
  }));
}

export function ${prefix}ApiMutation<TData, TVariables>(
  key: MutationKey,
  mutate: (variables: TVariables, signal: AbortSignal) => Promise<TData>,
  options?: ApiMutationOptions<TData, TVariables>,
) {
  const pending = new Set<AbortController>();
  ${
    lib.teardown
      ? `// Every call gets a signal; tearing the caller down aborts what is still in flight.
  const abortAll = () => {
    for (const controller of pending) controller.abort();
  };
  ${lib.teardown}
`
      : ""
  }
  return ${lib.createMutation}<TData, Error, TVariables>(() => ({
    ...options,
    mutationKey: key,
    mutationFn: async (variables) => {
      const controller = new AbortController();
      pending.add(controller);
      try {
        return await mutate(variables, controller.signal);
      } finally {
        pending.delete(controller);
      }
    },
  }));
}
${
  infinite
    ? `
/** A list read page by page: each page starts where the loaded ones end. */
export function ${prefix}ApiInfiniteQuery<TItem, TKey extends QueryKey>(
  key: () => TKey,
  fetcher: (
    page: { start: number; size: number },
    signal: AbortSignal,
  ) => Promise<ApiListData<TItem>>,
  { pageSize = 20, ...options }: ApiInfiniteQueryOptions<TItem, TKey> = {},
) {
  return ${lib.createInfinite}(() => ({
    ...options,
    queryKey: key(),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetcher({ start: pageParam, size: pageSize }, signal),
    getNextPageParam: ${NEXT_PAGE},
  }));
}
`
    : ""
}`;
}
