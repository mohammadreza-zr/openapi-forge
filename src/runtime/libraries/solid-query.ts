import { GETTER_TYPE, tanstackTypes, thunkHooks } from "./tanstack.js";
import type { Library } from "./index.js";

// Solid's own `CreateQueryOptions` are accessors (`() => options`), so the
// aliases are written over the options the core defines. `initialData` is left
// out: `createQuery` has one overload for options that set it and another for
// options that do not, and options that may do either match neither.
const shape = {
  pkg: "@tanstack/solid-query",
  imports: ["QueryObserverOptions", "MutationOptions"],
  infiniteImports: ["InfiniteQueryObserverOptions"],
  maybeGetter: GETTER_TYPE,
  query:
    'Omit<QueryObserverOptions<TData, Error, TData, TData, TKey>, "initialData">',
  mutation: "MutationOptions<TData, Error, TVariables>",
  infinite:
    'Omit<InfiniteQueryObserverOptions<ApiListData<TItem>, Error, InfiniteData<ApiListData<TItem>>, TKey, number>, "initialData">',
};

export const solidQuery: Library = {
  prefix: "create",
  reactive: true,
  packages: ["@tanstack/solid-query", "solid-js"],
  types: (infinite) => tanstackTypes(shape, infinite),
  hooks: (infinite) =>
    thunkHooks(
      {
        pkg: shape.pkg,
        prefix: "create",
        createQuery: "createQuery",
        createMutation: "createMutation",
        createInfinite: "createInfiniteQuery",
        imports: 'import { getOwner, onCleanup } from "solid-js";',
        teardown: "if (getOwner()) onCleanup(abortAll);",
      },
      infinite,
    ),
};
