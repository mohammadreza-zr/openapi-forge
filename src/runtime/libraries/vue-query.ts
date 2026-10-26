import { BANNER } from "../base.js";
import { NEXT_PAGE, ownOptions, tanstackTypes } from "./tanstack.js";
import type { Library } from "./index.js";

const shape = {
  ...ownOptions("@tanstack/vue-query", "Use"),
  // Vue's option types are \`T | Ref<T>\`; the aliases want the plain object.
  extra: 'import type { MaybeRefOrGetter, Ref } from "vue";',
  maybeGetter: `
/** An argument given as a value, a ref or a getter. */
export type MaybeGetter<T> = MaybeRefOrGetter<T>;

/** The options themselves, without the ref that may hold them. */
type Plain<T> = Exclude<T, Ref<any>>;
`,
  query: "Plain<UseQueryOptions<TData, Error, TData, TData, TKey>>",
  mutation: "Plain<UseMutationOptions<TData, Error, TVariables>>",
  infinite:
    "Plain<UseInfiniteQueryOptions<ApiListData<TItem>, Error, InfiniteData<ApiListData<TItem>>, TKey, number>>",
};

export const vueQuery: Library = {
  prefix: "use",
  reactive: true,
  packages: ["@tanstack/vue-query", "vue"],
  types: (infinite) => tanstackTypes(shape, infinite),
  hooks: (infinite) => `${BANNER}
import {
  type InfiniteData,
  type MutationKey,
  type QueryKey,
  ${infinite ? "useInfiniteQuery," : ""}
  useMutation,
  useQuery,
} from "@tanstack/vue-query";
import { computed, getCurrentScope, onScopeDispose } from "vue";

import type {
  ${infinite ? "ApiInfiniteQueryOptions,\n  ApiListData," : ""}
  ApiMutationOptions,
  ApiQueryOptions,
} from "./types";

export { toValue } from "vue";

/**
 * The key and the guard are functions: they are read again whenever a ref or
 * getter they depend on changes.
 */
export function useApiQuery<TData, TKey extends QueryKey>(
  key: () => TKey,
  fetcher: (signal: AbortSignal) => Promise<TData>,
  options?: ApiQueryOptions<TData, TKey>,
  enabled: () => boolean = () => true,
) {
  return useQuery<TData, Error, TData, TKey>({
    ...options,
    // vue-query unwraps the refs of a key; a generic key cannot be shown to survive that.
    queryKey: computed(key) as never,
    queryFn: ({ signal }) => fetcher(signal),
    enabled: options?.enabled ?? computed(enabled),
  });
}

export function useApiMutation<TData, TVariables>(
  key: MutationKey,
  mutate: (variables: TVariables, signal: AbortSignal) => Promise<TData>,
  options?: ApiMutationOptions<TData, TVariables>,
) {
  // Every call gets a signal; stopping the scope aborts what is still in flight.
  const pending = new Set<AbortController>();
  if (getCurrentScope()) {
    onScopeDispose(() => {
      for (const controller of pending) controller.abort();
    });
  }

  return useMutation<TData, Error, TVariables>({
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
  });
}
${
  infinite
    ? `
/** A list read page by page: each page starts where the loaded ones end. */
export function useApiInfiniteQuery<TItem, TKey extends QueryKey>(
  key: () => TKey,
  fetcher: (
    page: { start: number; size: number },
    signal: AbortSignal,
  ) => Promise<ApiListData<TItem>>,
  { pageSize = 20, ...options }: ApiInfiniteQueryOptions<TItem, TKey> = {},
) {
  return useInfiniteQuery<
    ApiListData<TItem>,
    Error,
    InfiniteData<ApiListData<TItem>>,
    TKey,
    number
  >({
    ...options,
    queryKey: computed(key) as never,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetcher({ start: pageParam, size: pageSize }, signal),
    getNextPageParam: ${NEXT_PAGE},
  });
}
`
    : ""
}`,
};
