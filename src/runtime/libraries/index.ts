// The data-fetching libraries the generated hooks can wrap. A library decides
// three things about the emitted code — how a hook is named, whether its
// arguments may be refs / signals / getters — and, for the built-in runtime,
// what `hooks.ts` and the option types of `types.ts` look like.
import type { LibraryName } from "../../types.js";
import { angularQuery } from "./angular-query.js";
import { reactQuery } from "./react-query.js";
import { solidQuery } from "./solid-query.js";
import { svelteQuery } from "./svelte-query.js";
import { swr } from "./swr.js";
import { vueQuery } from "./vue-query.js";

export interface Library {
  /** Hook names: `use…Query`, `create…Query` or `inject…Query`. */
  prefix: "use" | "create" | "inject";
  /**
   * Arguments are taken as `MaybeGetter<T>` and read where the request is
   * made, so a ref, a signal or a getter keeps the query in step.
   */
  reactive: boolean;
  /** Packages the written runtime imports (`doctor` looks for them). */
  packages: string[];
  /** Imports and option types added to `types.ts`. */
  types: (infinite: boolean) => { imports: string; body: string };
  /** The whole of `hooks.ts`. */
  hooks: (infinite: boolean) => string;
}

export const LIBRARIES: Record<LibraryName, Library> = {
  "react-query": reactQuery,
  "vue-query": vueQuery,
  "svelte-query": svelteQuery,
  "solid-query": solidQuery,
  "angular-query": angularQuery,
  swr,
};

export const LIBRARY_NAMES = Object.keys(LIBRARIES) as LibraryName[];
