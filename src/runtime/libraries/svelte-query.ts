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
        imports: 'import { onDestroy } from "svelte";',
        // `onDestroy` throws outside a component; there is then nothing to tear down.
        teardown: `try {
    onDestroy(abortAll);
  } catch {
    // not in a component
  }`,
      },
      infinite,
    ),
};
