import {
  GETTER_TYPE,
  ownOptions,
  tanstackTypes,
  thunkHooks,
} from "./tanstack.js";
import type { Library } from "./index.js";

const shape = {
  ...ownOptions("@tanstack/angular-query-experimental", "Create"),
  maybeGetter: GETTER_TYPE,
};

// `inject…` functions must run in an injection context — a component's
// constructor or field initialiser, a service, `runInInjectionContext`.
export const angularQuery: Library = {
  prefix: "inject",
  reactive: true,
  packages: ["@tanstack/angular-query-experimental", "@angular/core"],
  types: (infinite) => tanstackTypes(shape, infinite),
  hooks: (infinite) =>
    thunkHooks(
      {
        pkg: shape.pkg,
        prefix: "inject",
        createQuery: "injectQuery",
        createMutation: "injectMutation",
        createInfinite: "injectInfiniteQuery",
        imports: 'import { DestroyRef, inject } from "@angular/core";',
        teardown: "inject(DestroyRef).onDestroy(abortAll);",
      },
      infinite,
    ),
};
