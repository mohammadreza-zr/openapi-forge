import { BANNER } from "../base.js";
import { NEXT_PAGE, ownOptions, tanstackTypes } from "./tanstack.js";
import type { Library } from "./index.js";

const shape = ownOptions("@tanstack/react-query", "Use");

export const reactQuery: Library = {
  prefix: "use",
  reactive: false,
  packages: ["@tanstack/react-query"],
  types: (infinite) => tanstackTypes(shape, infinite),
  hooks: (infinite) => `${BANNER}
import {
  type MutationKey,
  type QueryKey,
  ${infinite ? "useInfiniteQuery," : ""}
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type {
  ${infinite ? "ApiInfiniteQueryOptions,\n  ApiListData," : ""}
  ApiMutationOptions,
  ApiQueryOptions,
} from "./types";

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
${
  infinite
    ? `
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
    getNextPageParam: ${NEXT_PAGE},
  });
}
`
    : ""
}`,
};
