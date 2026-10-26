import { BANNER } from "../base.js";
import type { Library } from "./index.js";

export const swr: Library = {
  prefix: "use",
  reactive: false,
  packages: ["swr", "react"],
  types: (infinite) => ({
    imports: `
import type { Key, SWRConfiguration } from "swr";
${infinite ? 'import type { SWRInfiniteConfiguration } from "swr/infinite";' : ""}
import type { SWRMutationConfiguration } from "swr/mutation";
`,
    body: `
/**
 * What a generated query hook takes beside its arguments. The key type is
 * there because the generated hooks name it; SWR's options do not use it.
 */
export type ApiQueryOptions<TData, _TKey = Key> = SWRConfiguration<
  TData,
  Error
> & {
  /** \`false\` waits: the request is not made while it is. */
  enabled?: boolean;
};

/** What a generated mutation hook takes beside its variables. */
export type ApiMutationOptions<TData, TVariables> =
  SWRMutationConfiguration<TData, Error, Key, TVariables>;
${
  infinite
    ? `
/** What a generated infinite-list hook takes beside its query. */
export type ApiInfiniteQueryOptions<
  TItem,
  _TKey = Key,
> = SWRInfiniteConfiguration<ApiListData<TItem>, Error> & {
  pageSize?: number;
  enabled?: boolean;
};
`
    : ""
}`,
  }),
  hooks: (infinite) => `${BANNER}
import { useEffect, useRef } from "react";
import useSWR, { type Key } from "swr";
${infinite ? 'import useSWRInfinite from "swr/infinite";' : ""}
import useSWRMutation from "swr/mutation";

import type {
  ${infinite ? "ApiInfiniteQueryOptions,\n  ApiListData," : ""}
  ApiMutationOptions,
  ApiQueryOptions,
} from "./types";

// SWR cannot cancel a request, so the signal a fetcher gets never fires.
const never = new AbortController().signal;

export function useApiQuery<TData, TKey extends Key>(
  key: TKey,
  fetcher: (signal: AbortSignal) => Promise<TData>,
  options?: ApiQueryOptions<TData, TKey>,
) {
  const { enabled = true, ...config } = options ?? {};
  return useSWR<TData, Error>(enabled ? key : null, () => fetcher(never), config);
}

export function useApiMutation<TData, TVariables>(
  key: Key,
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

  return useSWRMutation<TData, Error, Key, TVariables>(
    key,
    async (_key: Key, { arg }: { arg: TVariables }) => {
      const controller = new AbortController();
      pending.current.add(controller);
      try {
        return await mutate(arg, controller.signal);
      } finally {
        pending.current.delete(controller);
      }
    },
    options,
  );
}
${
  infinite
    ? `
/** A list read page by page: page \`n\` starts at \`n * pageSize\`. */
export function useApiInfiniteQuery<TItem, TKey extends Key>(
  key: TKey,
  fetcher: (
    page: { start: number; size: number },
    signal: AbortSignal,
  ) => Promise<ApiListData<TItem>>,
  { pageSize = 20, enabled = true, ...config }: ApiInfiniteQueryOptions<TItem, TKey> = {},
) {
  return useSWRInfinite<ApiListData<TItem>, Error>(
    (index, previous) =>
      !enabled || (previous && (!previous.list.length || index * pageSize >= previous.count))
        ? null
        : ([key, index] as const),
    ([, index]: readonly [TKey, number]) =>
      fetcher({ start: index * pageSize, size: pageSize }, never),
    config,
  );
}
`
    : ""
}`,
};
