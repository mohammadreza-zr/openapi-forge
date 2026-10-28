# @mrzr/openapi-forge

Generate a typed TypeScript API layer from OpenAPI / Swagger documents:

- **models** — one `type` per schema (inline objects named, `allOf` / `oneOf` / `nullable`, enums, `Blob` for uploads)
- **request functions** — one per operation, with typed path / query / body arguments
- **route + query-key factories** — each URL is written once; keys point at it
- **hooks for the library you use** — React, Vue, Svelte, Solid or Angular Query, or SWR: a query hook per read, a mutation hook per write (optional)
- **several services, one layer** — merge many documents; conflicts are decided once and committed
- **a runtime of its own, or yours** — a small `fetch`, axios, Angular `HttpClient` or [`@mrzr/api-client`](https://www.npmjs.com/package/@mrzr/api-client) client is written for you, or the code imports your transport

Output is deterministic and prettier-formatted, so `--check` can fail CI when the committed layer is stale.

## Quick start

```bash
npm i -D @mrzr/openapi-forge
npx openapi-forge init                       # writes openapi-forge.config.mjs
npx openapi-forge --input swagger.json --out src/api/generated --api-prefix /api/v1
```

With the default `client: "builtin"` three small files are written **once** next to the layer
(`client.ts`, `hooks.ts`, `types.ts`). They are yours to edit and are never overwritten
(`--force-runtime` resets them). The hooks need the package of the library they wrap — `@tanstack/react-query` v5 by default, see [Clients](#clients).

```ts
import { configureClient } from "./api/generated/client";
import { useListPetsQuery, useCreatePetMutation } from "./api/generated";

configureClient({
  baseUrl: "https://api.example.com/v1",
  headers: () => ({ Authorization: `Bearer ${token()}` }),
});

const pets = useListPetsQuery({ kind: "cat" });
const create = useCreatePetMutation();
create.mutate({ body: { name: "Tom" } });
```

## Clients

Two independent choices. `library` is what the hooks wrap; `http` is what the built-in runtime sends requests with.

```js
export default defineConfig({
  library: "vue-query",   // see the table
  http: "axios",          // "fetch" (default) | "axios" | "angular" | "api-client"
  target: "hooks",        // "requests" stops at plain request functions
});
```

| `library` | hooks | arguments | packages the runtime imports |
| --- | --- | --- | --- |
| `react-query` (default) | `useXQuery`, `useXMutation` | plain values | `@tanstack/react-query` |
| `vue-query` | `useXQuery`, `useXMutation` | a value, a ref or a getter | `@tanstack/vue-query`, `vue` |
| `svelte-query` | `createXQuery`, `createXMutation` | a value or a getter | `@tanstack/svelte-query` (v6, Svelte 5) |
| `solid-query` | `createXQuery`, `createXMutation` | a value or an accessor | `@tanstack/solid-query`, `solid-js` |
| `angular-query` | `injectXQuery`, `injectXMutation` | a value or a getter (a signal read) | `@tanstack/angular-query-experimental`, `@angular/core` |
| `swr` | `useXQuery`, `useXMutation` | plain values | `swr`, `react` |

In the four reactive libraries an argument is read where the request is made, not once when the hook is called, so the query follows whatever it was given:

```ts
const id = ref("1");
const pet = useGetPetQuery(id);          // Vue: refetches when `id.value` changes
const pet = createGetPetQuery(() => id()); // Solid / Svelte / Angular: a getter
```

A path id that is still `undefined` makes the query wait instead of asking for `/pets/undefined`. Mutations take their variables when `mutate` is called, so they are the same in every library.

| `http` | sends with | needs |
| --- | --- | --- |
| `fetch` (default) | the platform's `fetch` | nothing |
| `axios` | an axios instance, `configureClient({ instance })` | `axios` |
| `angular` | Angular's `HttpClient`, so its interceptors apply; `configureClient({ instance: inject(HttpClient) })` at start-up | `@angular/common`, `rxjs` |
| `api-client` | [`@mrzr/api-client`](https://www.npmjs.com/package/@mrzr/api-client): token refresh, tab sync, plugins; `configureClient({ instance: createClient({ … }) })` | `@mrzr/api-client` |

Coming from Orval, its `client` values map like this: `react-query`, `vue-query`, `svelte-query`, `solid-query`, `angular-query` and `swr` are the `library` values above; `fetch`, `axios` and `angular` are `http` values (with `target: "requests"` for plain functions); `zod` is `zod: true`.

Left out on purpose: `hono` and `mcp` generate server handlers and tools, not a client; MSW / Faker mocks do not belong in a data layer (and a project that forbids mocks cannot use them); Suspense variants would double every hook. The `angular` client is promise-based over `HttpClient`, not the Observable-returning services Orval writes — with `angular-query` on top it covers an Angular application, and the interceptors keep working.

Notes that follow from what each library offers:

- **SWR** cannot cancel a request, so the `signal` a fetcher gets never fires; an infinite list asks for page `n` at `n * pageSize`.
- **Solid**: the hook options leave out `initialData` — `createQuery` has one overload for options that set it and one for options that do not, and options that may do either match neither.
- **Angular**: `inject…` functions need an injection context — a constructor, a field initialiser, a service, `runInInjectionContext`.
- **axios**, **angular** and **api-client**: the instance is `configureClient({ instance })`; interceptors, plugins, tokens and defaults live there. The URL, the body and the answer are handled by the same code as the `fetch` client, so the three behave alike. An aborted request rejects in every client, but with the client's own error: `AbortError` for `fetch`, `CanceledError` for axios (`axios.isCancel`).

## Commands

| command | does |
| --- | --- |
| `openapi-forge [generate]` | write the layer |
| `openapi-forge pull` | fetch the documents in `sources` into `specsDir`, then generate |
| `openapi-forge diff <old> <new>` | report breaking / risky / safe changes between two documents (`--format`, `--fail-on`) |
| `openapi-forge doctor` | check the config, input, output, packages and runtime modules |
| `openapi-forge init` | write a starter `openapi-forge.config.mjs` |

Flags: `--config`, `--input`, `--out`, `--api-prefix`, `--tags a,b`, `--exclude-tags a,b`,
`--target hooks|requests`, `--library <name>`, `--http fetch|axios|angular|api-client`, `--client builtin|custom`, `--headers "K: v;K2: v"`, `--insecure`,
`--ca <pem>`, `--check`, `--raw`, `--force-runtime`, `--no-pull`, `--verbose`, `--watch`, `--interval <s>`, `--format text|markdown|json`, `--fail-on breaking|risky|safe`.
Environment: `OPENAPI_FORGE_INPUT`, `OPENAPI_FORGE_HEADERS`, `OPENAPI_FORGE_INSECURE`,
`OPENAPI_FORGE_CA`, `OPENAPI_FORGE_SOURCES` (`name=url;name2=url2`).
The command line wins over the config file, which wins over the defaults.

## Config

`openapi-forge.config.{mjs,js,cjs,json}` — all keys optional:

```js
import { defineConfig } from "@mrzr/openapi-forge";

export default defineConfig({
  input: "openapi.json",          // file | URL | folder of documents | { service: fileOrUrl }
  out: "src/api/generated",
  apiPrefix: "/api/v1",           // stripped from every route
  client: "builtin",              // "builtin" | "custom"
  target: "hooks",                // "hooks" | "requests"
  library: "react-query",         // "vue-query" | "svelte-query" | "solid-query" | "angular-query" | "swr"
  http: "fetch",                  // "axios" | "angular" | "api-client" — for the built-in runtime
  tags: { include: [], exclude: [] },
  headers: { Authorization: "Bearer …" },   // for a URL input
  tls: { insecure: false, ca: "internal-ca.pem" },
  format: "prettier",             // or false
  sources: { users: "https://host/users/openapi.yaml" },  // for `pull`
  specsDir: "openapi-specs",
  decisionsFile: "openapi-forge.decisions.json",
  generatorName: "openapi-forge", // the banner of every file

  runtime: { /* see below */ },

  transform: {
    queryParam: (name, { service, operation, path }) => name,
    operationName: (operation) => undefined,   // return a new name to rename
    fileName: (tag) => tag,                    // module file per tag
    operation: (operation) => operation,       // change one, or return null to drop it
  },
});
```

### Using your own transport (`client: "custom"`)

Everything the emitted code imports and calls is configurable. Defaults are the built-in runtime;
override what differs:

```js
export default defineConfig({
  client: "custom",
  runtime: {
    callers: { module: "@/lib/http", get: "apiGet", post: "apiPost", put: "apiPut", patch: "apiPatch", delete: "apiDelete" },
    hooks: { module: "../hooks", query: "useApiQuery", mutation: "useApiMutation", toValue: "toValue" },
    types: { module: "../types", request: "GeneratedRequestConfig", query: "ApiQueryOptions", mutation: "ApiMutationOptions", maybeGetter: "MaybeGetter" },
    list: { name: "ApiListData", module: "@/types", count: "count", items: "list" },   // or false
    envelope: { name: "ApiEnvelope", module: "../../types/api", result: "result", data: "data", keys: ["result", "code", "message", "data"] }, // or false
    requestKeys: { query: "params", pathParams: "addTemplateToUrl", formData: "isFormData", baseUrl: "baseUrl", signal: "signal", headers: "headers", envelope: "isEnvelope", body: "body" },
    services: { module: "@/config/api", fn: "serviceBaseUrl" },   // or { baseUrls: { users: "https://…" } }
  },
});
```

Module paths are written as-is into the generated files, so paths relative to the output folder
must be relative to it. `library` still decides how the generated hooks are named (`use…`, `create…`,
`inject…`) and whether they read their arguments through `toValue` / `MaybeGetter` (the reactive
libraries) — a custom runtime has to export those two names then, and its wrappers are named
`<prefix>ApiQuery` by default.

The transport contract is `apiGet<T>(route, config)`, `apiPost<T>(route, body, config)` (also put /
patch), `apiDelete<T>(route, config)`, where `config` carries `signal`, `params` (query),
`addTemplateToUrl` (`{pet_id: "1"}` for `/pets/{pet_id}`), `isFormData` and `baseUrl`. Each resolves
to the unwrapped payload. `headers` (declared header parameters, and the `Content-Type` of a body that
is not JSON) and `isEnvelope` are written only for the built-in runtime, and so is `body`, the key a `DELETE`'s body
rides in (`apiDelete(route, config)` takes none of its own); a custom transport gets them when
`requestKeys.headers` / `requestKeys.envelope` / `requestKeys.body` name a key, and until then a header
parameter is reported instead of being sent and a `DELETE` with a body is skipped with a warning.

### The envelope

If an answer is `{ result, code, message, data }`, the generated types and calls speak only of
`data`: `allOf: [EnvelopeBase, { data: T }]` becomes `ApiEnvelope<T>` in `models.ts`. The decision is
made per operation, from its response schema (it has `result` and `data`), and the request function says
so with `isEnvelope: true` — the built-in client unwraps only those, so a payload that merely has a
`result` field is returned as it is. A `{ count, list }` payload becomes `ApiListData<T>` only when
the document marks both fields `required`; otherwise it keeps its own type, with optional fields, because
`ApiListData` promises both are there. An API that always sends both can say so with
`runtime: { list: { assumeRequired: true } }`. Set `runtime.envelope: false` / `runtime.list: false` for an API
with neither.

### What goes over the wire

The built-in client writes what the document asks for, and reports (never silently changes) what it cannot:

| the document says | the client |
| --- | --- |
| a `header` parameter | an argument (`headers`) of the request function, a hook argument and part of the query key; `Accept`, `Content-Type` and `Authorization` are the transport's, as OpenAPI says |
| a `cookie` parameter | reported — a browser attaches cookies itself |
| a query list | repeated keys, `a=1&a=2`; `explode: false` and `pipeDelimited` / `spaceDelimited` are reported |
| a query object | `a[b]=1` (deepObject); another style is reported |
| a path list or object | `a,b` / `name,value,name,value` |
| a body on `DELETE` | sent, from `config.body` |
| `multipart/form-data` | one part per list item, a JSON part per object, a file as it is |
| `application/x-www-form-urlencoded` | a form; a list repeats its key |
| `text/plain`, `application/octet-stream`, other non-JSON bodies | sent as they are, with that `Content-Type` |
| an answer | read by its `Content-Type`: JSON parsed, `text/*` as a string, anything else a `Blob`; an empty answer is `null` |

With the axios, Angular and api-client clients the answer reaches interceptors as bytes (an `ArrayBuffer`), because it is read by content type afterwards, the same way for every client.

## Input it understands

Swagger 2.0, OpenAPI 3.0 and 3.1, as JSON or YAML, from a file, a folder of files (one per service) or a URL. A 2.0 document is converted to 3.0 first (`definitions`, `in: body` / `formData`, `consumes` / `produces`, `x-nullable`); the 3.1 spellings (`type: [x, "null"]`, `const`) are folded into their 3.0 equivalents. Local `$ref`s that point outside `components` are inlined.

What a document leaves out never breaks the output: that spot is typed `unknown`, and the run lists every one of them with the operation and the part (`response`, `request body`, `parameter x`, `schema Y`) so it can be fixed at the source.

## Tested against real documents

`npm run conformance` generates the layer (with `zod` and `infinite` on) for every document of the public [`@readme/oas-examples`](https://www.npmjs.com/package/@readme/oas-examples) corpus — 60 Swagger 2.0 / OpenAPI 3.0 / 3.1 documents covering circular references, polymorphism, discriminators, uploads, parameter styles and more — plus the fixture of the client tests, once for every client, and type-checks the output with `tsc --strict --noUnusedLocals --noUnusedParameters` against the real types of each library. All 9 clients × 62 documents pass.

The behaviour is run too, not only compiled (`npm test`): the `fetch`, axios, Angular `HttpClient` and `@mrzr/api-client` clients are called against a local HTTP server (query strings, path encoding, JSON, multipart and form bodies, headers, a per-call `baseUrl`, `result: false`, failing statuses, abort, bytes and text answers, a payload with a `result` field — and an interceptor, for Angular). Every hook library is executed (over `fetch`, axios and `@mrzr/api-client`, and Angular Query also over `HttpClient`) against the same kind of server: React Query and SWR rendered in jsdom, Vue Query inside an app, Solid Query under its browser build, Svelte Query as a component compiled with the Svelte compiler, Angular Query in Angular's test bed. In each, data arrives, a changed argument (ref, signal, getter, state) moves the query, a missing id waits, a mutation sends its variables, and tearing down the owner aborts a mutation still in flight; a header argument (a ref, a getter, a signal, state) is sent and moves the query, and an infinite list pages and sends its header with every page. A custom transport is compiled with its own config type and called with only the keys it has.

## How it compares

Measured, not claimed: the same 60 documents through Orval 8.45 (`--client react-query --mode tags-split`, default options) and type-checked the same way gave 56 clean outputs; the four failures were duplicate identifiers, a type mismatch on an optional body, and overload mismatches, and one document with only webhooks produced no files. Two honest caveats: this package was fixed against that corpus, Orval was not tuned for it, and Orval with a hand-written config may do better.

| | openapi-forge | Orval |
| --- | --- | --- |
| Clients | `fetch`, axios, Angular `HttpClient` or `@mrzr/api-client`, or your own transport; React, Vue, Svelte, Solid and Angular Query, SWR | the same, plus Angular `HttpClient` services, Hono, MCP |
| Mocks (MSW), Faker | no, by design | yes |
| What changed in the new spec | `pull` and `diff` report breaking / risky / safe changes by hook name | not built in |
| Several backend services in one layer | merged; conflicts decided once and committed | a separate output per spec |
| Same-shaped query and variable types | written once, the rest alias or derive from it | repeated per operation |
| Incomplete spec | valid output + a located report of every gap | not compared |
| Stale-output check for CI | `--check` | via re-run and `git diff` |
| Setup check | `doctor` | not built in |

Orval is the broader tool — Angular `HttpClient` services, server targets, mocks, a large plugin ecosystem. This one stays with the data layer of an application: typed models, request functions and hooks you can read, review and keep in sync with several services.

## Opt-in extras

Off by default, so the default output stays small.

```js
export default defineConfig({
  zod: true,       // schemas.ts: a Zod validator per model, typed as `z.ZodType<Model>`
  infinite: true,  // use<Op>InfiniteQuery for every paged read with `start` + `offset`
  // infinite: { start: "page", size: "limit" },   // other paging parameter names
});
```

`zod` needs the `zod` package. `infinite` needs `useApiInfiniteQuery` and `ApiInfiniteQueryOptions` in a custom runtime (the built-in one writes them). It applies to reads that answer `ApiListData` (so `count` and `list` must be `required`, see [the envelope](#the-envelope)) and take no path id; header parameters are arguments of the hook, as in any other read.

```bash
openapi-forge --watch            # rebuild when a local document changes (a URL is polled: --interval 30)
openapi-forge doctor             # config, input, output, installed packages, runtime modules
```

## Know what a new spec breaks

`pull` prints what changed in every document it updates, in the terms of the code you consume — the operation, its generated hook, the schema and property:

```
sightings: 5 breaking, 0 risky, 34 safe

breaking
  ✖ GET /sightings (listSightings · useListSightingsQuery)
      query parameter `plate` removed
```

Compare any two documents (files or URLs) yourself, for a PR comment or a CI gate:

```bash
openapi-forge diff old.yaml https://host/openapi.json --format markdown
openapi-forge diff old.yaml new.yaml --fail-on breaking   # exit 1 on a breaking change
```

Severity: **breaking** (removed or retyped operation, parameter, property, response; a new required parameter), **risky** (a new required property, an enum value removed, a deprecation), **safe** (additions).

## Several services

Give `input` a folder of documents (named after their files) or `{ name: fileOrUrl }`. Operations
and components found in one service are kept; ones found in several are merged when identical and
need an **owner** when they differ. Run in a terminal once to answer the questions — the answers
(`main` service, `owners`) are written to `decisionsFile` and commit with the code. `--check` and CI
never ask; they fail listing what is still undecided. Operations carry `x-service`, and
`services.ts` exports `API_SERVICE_BASE_URLS` for the per-service base URL.

## Programmatic use

The package is written in strict TypeScript and ships its own declarations (Node ≥ 20).

```ts
import { run, emit, mergeSpecs, defineConfig } from "@mrzr/openapi-forge";

await run({ input: "swagger.json", out: "src/api" });                 // like the CLI
const { files } = emit(doc, resolvedOptions, "swagger.json");          // name → source, no disk
```

## Notes

- Names come from `operationId` (or `method + path`), collisions get the method appended.
- A `DELETE` that takes a body sends it; a `GET` that declares one cannot, so the body is left out with a warning.
- A schema named like a Go package (`handler.LoginBody`) becomes `HandlerLoginBody`, and every `$ref` follows.
- Prettier is optional: the project's own is used when installed (with its config); otherwise output is raw.
- Tests: `npm test` (builds, then runs the suite on Node 20, 22 and 24 alike); `npm run typecheck` checks the types only.

MIT
