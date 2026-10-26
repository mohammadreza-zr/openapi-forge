import {
  GETTER_TYPE,
  ownOptions,
  tanstackTypes,
  thunkHooks,
} from "./tanstack.js";
import type { Library } from "./index.js";

const shape = {
  ...ownOptions("@tanstack/svelte-query", "Create"),
  maybeGetter: GETTER_TYPE,
};

// Svelte offers no way to ask "is there a component to clean up with?", so a
// mutation's requests are not aborted when the component goes.
export const svelteQuery: Library = {
  prefix: "create",
  reactive: true,
  packages: ["@tanstack/svelte-query", "svelte"],
  types: (infinite) => tanstackTypes(shape, infinite),
  hooks: (infinite) =>
    thunkHooks(
      {
        pkg: shape.pkg,
        prefix: "create",
        createQuery: "createQuery",
        createMutation: "createMutation",
        createInfinite: "createInfiniteQuery",
      },
      infinite,
    ),
};
