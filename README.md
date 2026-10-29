# @mrzr/openapi-forge

Generate a typed TypeScript API layer — models, request functions, query keys and data-fetching hooks — from OpenAPI / Swagger documents.

```bash
npm i -D @mrzr/openapi-forge
npx openapi-forge --input swagger.json --out src/api/generated
```

The output is plain, readable TypeScript that is formatted with your own Prettier and is **deterministic**, so `--check` can fail CI when the committed layer is stale.

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [What is generated](#what-is-generated)
- [Hook libraries](#hook-libraries)
- [HTTP clients](#http-clients)
- [Your own transport](#your-own-transport)
- [What goes over the wire](#what-goes-over-the-wire)
- [Answers, envelopes and errors](#answers-envelopes-and-errors)
- [Input](#input)
- [Several services](#several-services)
- [Types and naming](#types-and-naming)
- [Opt-in extras](#opt-in-extras)
- [Commands and flags](#commands-and-flags)
- [Config reference](#config-reference)
- [Keeping up with a changing spec](#keeping-up-with-a-changing-spec)
- [Use in CI](#use-in-ci)
- [Programmatic use](#programmatic-use)
- [How it is tested](#how-it-is-tested)
- [Coming from Orval](#coming-from-orval)

## Features

**Generated code**

- **Models** — one `type` per schema: inline objects get names, `allOf` / `oneOf` / `anyOf`, `nullable`, enums, tuples (`prefixItems`), records (`additionalProperties`), `Blob` for uploads, circular references.
- **Request functions** — one per operation, with typed path, query, header and body arguments, a `config` argument for `signal`, `baseUrl` and the like, and a JSDoc block (summary, description, `METHOD /route`, `@deprecated`).
- **Routes written once** — a `<tag>Endpoints` map holds every URL; the request functions and the query keys both read it.
- **Query-key factories** — `<tag>Keys` with `all`, `lists()`, `details()` and one key per read, so invalidating "everything of this tag" is one line.
- **Hooks** for **React Query, Vue Query, Svelte Query, Solid Query, Angular Query or SWR**: a query hook per read, a mutation hook per write (or only plain request functions with `target: "requests"`).
- **Reactive arguments** — in Vue, Svelte, Solid and Angular a hook argument may be a ref, a getter or a signal, and the query follows it.
- **Safe detail reads** — a query whose path id is still `undefined` waits instead of asking for `/pets/undefined`.
- **Zod validators** (`zod: true`) — `schemas.ts`, one validator per model, typed `z.ZodType<Model>` so the two cannot drift apart.
- **Infinite-list hooks** (`infinite: true`) for paged reads.
- **Shared types** — query and variable types with the same shape are written once (aliased, or `Omit<…> & { … }` when close); so are identical models with related names.

**Transport**

- **Four built-in HTTP clients** — [`@mrzr/api-client`](https://www.npmjs.com/package/@mrzr/api-client) (default), `fetch`, axios and Angular's `HttpClient` (interceptors keep working).
- **Or your own** — `client: "custom"` imports your transport; every name and module path is configurable.
- **Faithful encoding** — header parameters, repeated / bracketed query keys, path lists and objects, JSON, `multipart/form-data`, `application/x-www-form-urlencoded`, text and binary bodies, bodies on `DELETE`, answers read by `Content-Type` (JSON, text or `Blob`).
- **Envelope handling** — `{ result, code, message, data }` answers are unwrapped per operation, `{ count, list }` becomes `ApiListData<T>`, failures throw an `ApiResponseError` with `status`, `code` and `body`.
- **Cancellation** — queries, mutations and infinite lists pass an `AbortSignal` to the request (SWR cannot cancel, see below); an aborted request rejects.

**Input**

- Swagger 2.0, OpenAPI 3.0 and 3.1, as JSON or YAML, from a file, a **folder of files** or a **URL**.
- Request headers for protected URLs; `--insecure` and `--ca` for private / self-signed certificates.
- **Several backend services in one layer** — merged, with conflicts decided once and committed to `openapi-forge.decisions.json`; per-service base URLs.
- An incomplete document never breaks the output: gaps are typed `unknown` and **listed with the operation and the part** to fix.

**Workflow**

- `generate`, `pull`, `diff`, `doctor`, `init` commands; `--watch`; `--check`.
- **Change reports** — what a new spec breaks, in terms of your code (operation, hook, schema, property): *breaking / risky / safe*, as text, Markdown or JSON, with `--fail-on` for CI.
- **Hooks into naming** — rename operations, query parameters and files, or drop an operation, with the `transform` option.
- **Tag filters**, an `apiPrefix` stripped from every route, a custom banner (`generatorName`).
- Strict TypeScript, ships its own `.d.ts`, Node ≥ 20, one runtime dependency (`yaml`).

## Quick start

```bash
npm i -D @mrzr/openapi-forge
npx openapi-forge init                       # writes openapi-forge.config.mjs
npx openapi-forge --input swagger.json --out src/api/generated --api-prefix /api/v1
```

With the default `client: "builtin"` three small files are written **once** next to the layer
(`client.ts`, `hooks.ts`, `types.ts`). They are yours to edit and are never overwritten
(`--force-runtime` resets them). The hooks need the package of the library they wrap —
`@tanstack/react-query` v5 by default, see [Hook libraries](#hook-libraries).

```ts
import { createClient } from "@mrzr/api-client";
import { configureClient } from "./api/generated/client";
import { useListPetsQuery, useCreatePetMutation } from "./api/generated";

// The default client sends with @mrzr/api-client: the instance holds the base URL, the tokens and the plugins.
configureClient({ instance: createClient({ baseUrl: "https://api.example.com/v1" }) });

const pets = useListPetsQuery({ kind: "cat" });
const create = useCreatePetMutation();
create.mutate({ body: { name: "Tom" } });
```

Without `@mrzr/api-client`, pick another client (`http: "fetch"` needs nothing installed) and configure it with
`configureClient({ baseUrl, headers: () => ({ Authorization: … }) })`.

## What is generated

```
src/api/generated/
├── models.ts      every schema as a type
├── pets.ts        one module per tag: endpoints, keys, types, request functions, hooks
├── owners.ts
├── schemas.ts     Zod validators                  (zod: true)
├── services.ts    API_SERVICE_BASE_URLS           (per-service base URLs)
├── index.ts       re-exports everything
├── client.ts      ┐
├── hooks.ts       ├ the built-in runtime, written once, yours to edit
└── types.ts       ┘
```

A module (trimmed) looks like this:

```ts
export const petsEndpoints = { listPets: "/pets", getPet: "/pets/{pet_id}" } as const;

export const petsKeys = {
  all: ["Pets"] as const,
  lists: () => [...petsKeys.all, "list"] as const,
  details: () => [...petsKeys.all, "detail"] as const,
  listPets: (params: ListPetsQuery) => [...petsKeys.lists(), petsEndpoints.listPets, params] as const,
  getPet: (petId: string) => [...petsKeys.details(), petsEndpoints.getPet, petId] as const,
} as const;

export type ListPetsQuery = { start?: number; kind?: "cat" | "dog"; ids?: string[] };

/** List the pets — `GET /pets` */
export function listPets(query: ListPetsQuery = {}, config?: GeneratedRequestConfig<ApiListData<Pet>>) { … }

export function useListPetsQuery(query: ListPetsQuery = {}, options?: ApiQueryOptions<…>) { … }
export function useGetPetQuery(petId: string | undefined, options?: ApiQueryOptions<…>) { … }
export function useCreatePetMutation(options?: ApiMutationOptions<Pet, CreatePetVariables>) { … }
```

- A write takes **one variables object** (`{ petId, query, headers, body }` — only the parts it has), named `<Operation>Variables`.
- Query and header parameters get `<Operation>Query` / `<Operation>Headers` types.
- An operation with no tag goes to the `default` module.

## Hook libraries

Two independent choices: `library` is what the hooks wrap; `http` is what the built-in runtime sends requests with.

```js
export default defineConfig({
  library: "vue-query",   // see the table
  http: "axios",          // "api-client" (default) | "fetch" | "axios" | "angular"
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
const pet = useGetPetQuery(id);            // Vue: refetches when `id.value` changes
const pet = createGetPetQuery(() => id()); // Solid / Svelte / Angular: a getter
```

A path id that is still `undefined` makes the query wait instead of asking for `/pets/undefined`. Mutations take their variables when `mutate` is called, so they are the same in every library.

Notes that follow from what each library offers:

- **SWR** cannot cancel a request, so the `signal` a fetcher gets never fires; an infinite list asks for page `n` at `n * pageSize`.
- **Solid**: the hook options leave out `initialData` — `createQuery` has one overload for options that set it and one for options that do not, and options that may do either match neither.
- **Angular**: `inject…` functions need an injection context — a constructor, a field initialiser, a service, `runInInjectionContext`.

## HTTP clients

| `http` | sends with | needs |
| --- | --- | --- |
| `api-client` (default) | [`@mrzr/api-client`](https://www.npmjs.com/package/@mrzr/api-client): token refresh, tab sync, plugins; `configureClient({ instance: createClient({ … }) })` | `@mrzr/api-client` |
| `fetch` | the platform's `fetch` | nothing |
| `axios` | an axios instance, `configureClient({ instance })` | `axios` |
| `angular` | Angular's `HttpClient`, so its interceptors apply; `configureClient({ instance: inject(HttpClient) })` at start-up | `@angular/common`, `rxjs` |

- With `axios`, `angular` and `api-client` the instance is `configureClient({ instance })`; interceptors, plugins, tokens and defaults live there. The URL, the body and the answer are handled by the same code as the `fetch` client, so all four behave alike.
- An aborted request rejects in every client, but with the client's own error: `AbortError` for `fetch`, `CanceledError` for axios (`axios.isCancel`).
- With the axios, Angular and api-client clients the answer reaches interceptors as bytes (an `ArrayBuffer`), because it is read by content type afterwards, the same way for every client.
- `configureClient({ baseUrl, headers })` — a default base URL and a function that returns headers (sync or async), for every client. A single call may override `baseUrl` through its `config` argument.

## Your own transport

`client: "custom"` writes no runtime; the generated code imports yours. Everything it imports and calls is configurable — defaults are the built-in runtime, override what differs:

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

Module paths are written as-is into the generated files, so paths relative to the output folder must be relative to it. `library` still decides how the generated hooks are named (`use…`, `create…`, `inject…`) and whether they read their arguments through `toValue` / `MaybeGetter` (the reactive libraries) — a custom runtime has to export those two names then, and its wrappers are named `<prefix>ApiQuery` by default.

The transport contract is `apiGet<T>(route, config)`, `apiPost<T>(route, body, config)` (also put / patch), `apiDelete<T>(route, config)`, where `config` carries `signal`, `params` (query), `addTemplateToUrl` (`{pet_id: "1"}` for `/pets/{pet_id}`), `isFormData` and `baseUrl`. Each resolves to the unwrapped payload.

`headers` (declared header parameters, and the `Content-Type` of a body that is not JSON), `isEnvelope` and `body` (the key a `DELETE`'s body rides in) are written only for the built-in runtime. A custom transport gets them when `requestKeys.headers` / `requestKeys.envelope` / `requestKeys.body` name a key; until then a header parameter is reported instead of being sent and a `DELETE` with a body is skipped with a warning.

`openapi-forge doctor` checks that the modules the config names can be found.

## What goes over the wire

The built-in client writes what the document asks for, and reports (never silently changes) what it cannot:

| the document says | the client |
| --- | --- |
| a `header` parameter | an argument (`headers`) of the request function, a hook argument and part of the query key; `Accept`, `Content-Type` and `Authorization` are the transport's, as OpenAPI says |
| a `cookie` parameter | reported — a browser attaches cookies itself |
| a query list | repeated keys, `a=1&a=2`; `explode: false` and `pipeDelimited` / `spaceDelimited` are reported |
| a query object | `a[b]=1` (deepObject); another style is reported |
| a path list or object | `a,b` / `name,value,name,value` |
| a body on `DELETE` | sent, from `config.body` — except by `api-client`, whose `delete` takes none: the operation is left out and listed |
| a body on `GET` | cannot be sent: left out with a warning |
| `multipart/form-data` | one part per list item, a JSON part per object, a file as it is |
| `application/x-www-form-urlencoded` | a form; a list repeats its key |
| `text/plain`, `application/octet-stream`, other non-JSON bodies | sent as they are, with that `Content-Type` |
| an answer | read by its `Content-Type`: JSON parsed, `text/*` as a string, anything else a `Blob`; an empty answer is `null` |

`undefined`, `null` and `""` are left out of a query string. A header value that is not text (a number, a flag) is written with `String()`.

A Swagger 2.0 query list is comma separated unless its `collectionFormat` says otherwise (`csv` is the default there), so such a list is **reported** — the client repeats the key — instead of being sent differently without a word. `collectionFormat: multi` is the repeated form and needs no report.

## Answers, envelopes and errors

- **Envelope.** If an answer is `{ result, code, message, data }`, the generated types and calls speak only of `data`: `allOf: [EnvelopeBase, { data: T }]` becomes `ApiEnvelope<T>` in `models.ts`. The decision is made **per operation**, from its response schema (it has `result` and `data`), and the request function says so with `isEnvelope: true` — the built-in client unwraps only those, so a payload that merely has a `result` field is returned as it is. `result: false` throws.
- **Paged lists.** A `{ count, list }` payload becomes `ApiListData<T>` only when the document marks both fields `required`; otherwise it keeps its own type with optional fields, because `ApiListData` promises both are there. An API that always sends both can say so with `runtime: { list: { assumeRequired: true } }`.
- Set `runtime.envelope: false` / `runtime.list: false` for an API with neither.
- **Errors.** A non-2xx status or `result: false` throws `ApiResponseError` (exported from `types.ts`) with `status`, `code` and the parsed `body`.

## Input

- **Formats** — Swagger 2.0, OpenAPI 3.0 and 3.1, JSON or YAML. A 2.0 document is converted to 3.0 first (`definitions`, `in: body` / `formData`, `consumes` / `produces`, `x-nullable`, `collectionFormat`); the 3.1 spellings (`type: [x, "null"]`, `const`) are folded into their 3.0 equivalents. Local `$ref`s that point outside `components` are inlined.
- **Where from** — a file, a folder of files (one per service) or a URL, or a map `{ service: fileOrUrl }`.
- **Protected URLs** — `headers` (`--headers "Authorization: Bearer …"`, `OPENAPI_FORGE_HEADERS`).
- **TLS** — `tls: { ca: "internal-ca.pem" }` (`--ca`) trusts a private CA **in addition to** the public ones; `tls: { insecure: true }` (`--insecure`) skips verification (local development only, never in CI). `NODE_EXTRA_CA_CERTS` works too, and a TLS failure names these options.
- **Gaps** — what a document leaves out never breaks the output: that spot is typed `unknown`, and the run lists every one of them with the operation and the part (`response`, `request body`, `parameter x`, `schema Y`) so it can be fixed at the source. `--verbose` lists all of them.

## Several services

Give `input` a folder of documents (named after their files) or `{ name: fileOrUrl }`. Operations and components found in one service are kept; ones found in several are merged when identical and need an **owner** when they differ.

- Run in a terminal once to answer the questions — the answers (`main` service, `owners`) are written to `decisionsFile` and commit with the code.
- `--check` and CI never ask; they fail listing what is still undecided.
- Operations carry `x-service`, and `services.ts` exports `API_SERVICE_BASE_URLS` for the per-service base URL (a literal map, or a function of yours with `runtime.services.fn`).
- The run prints what was merged, which owner was chosen, which operations use a component owned by another service, and which saved choices no longer apply. `--verbose` lists the identical duplicates a merge folded together.

## Types and naming

- Names come from `operationId` (or `method + path`). A name already taken — the same `operationId` in two services — gets the method appended (`getUser` → `getUserGet`), and a number only if that is taken too (`getUserGet2`).
- An `operationId` that is not a usable function name (`delete`, `default`, `2fa`) falls back to a name built from the method and position; the same goes for a path argument called `in` or `delete`.
- A schema named like a Go package (`handler.LoginBody`) becomes `HandlerLoginBody`, and every `$ref` follows. A schema named like a global type the generated code uses (`Date`, `Record`, …) gets a `Model` suffix; one that starts with a digit (`2FA`) gets a leading `_`.
- Identical query / variable types (and models with related names) are written once; a query / variable type that is close to an earlier one is derived from it with `Omit<…> & { … }`.
- Only the imports a module uses are written, so a project may compile with `noUnusedLocals`.
- Property names that are not identifiers are quoted; doc comments from the document's `description`s are kept (and defused if they contain `*/`).

## Opt-in extras

Off by default, so the default output stays small.

```js
export default defineConfig({
  zod: true,       // schemas.ts: a Zod validator per model, typed as `z.ZodType<Model>`
  infinite: true,  // use<Op>InfiniteQuery for every paged read with `start` + `offset`
  // infinite: { start: "page", size: "limit" },   // other paging parameter names
});
```

`zod` needs the `zod` package. `infinite` needs `useApiInfiniteQuery` and `ApiInfiniteQueryOptions` in a custom runtime (the built-in one writes them). It applies to reads that answer `ApiListData` (so `count` and `list` must be `required`, see [Answers](#answers-envelopes-and-errors)) and take no path id; header parameters are arguments of the hook, as in any other read.

`transform` changes names and operations for what a document gets wrong:

```js
transform: {
  queryParam: (name, { service, operation, path }) => name,   // a query parameter's name on the wire
  operationName: (operation) => undefined,                    // return a new name to rename
  fileName: (tag) => tag,                                     // module file per tag
  operation: (operation) => operation,                        // change one, or return null to drop it
},
```

## Commands and flags

| command | does |
| --- | --- |
| `openapi-forge [generate]` | write the layer |
| `openapi-forge pull` | fetch the documents in `sources` into `specsDir`, report what changed, then generate |
| `openapi-forge diff <old> <new>` | report breaking / risky / safe changes between two documents (files or URLs) |
| `openapi-forge doctor` | check the config, input, output, installed packages and runtime modules |
| `openapi-forge init` | write a starter `openapi-forge.config.mjs` |

Flags: `--config`, `--input`, `--out`, `--api-prefix`, `--tags a,b`, `--exclude-tags a,b`,
`--target hooks|requests`, `--library <name>`, `--http api-client|fetch|axios|angular`, `--client builtin|custom`,
`--zod`, `--infinite`, `--headers "K: v;K2: v"`, `--insecure`, `--ca <pem>`, `--check`, `--raw`, `--force-runtime`,
`--no-pull`, `--verbose`, `--watch`, `--interval <s>`, `--format text|markdown|json`, `--fail-on breaking|risky|safe`,
`-h`, `-v`.

Environment: `OPENAPI_FORGE_INPUT`, `OPENAPI_FORGE_HEADERS`, `OPENAPI_FORGE_INSECURE`, `OPENAPI_FORGE_CA`, `OPENAPI_FORGE_SOURCES` (`name=url;name2=url2`).
The command line wins over the config file, which wins over the defaults.

- `--watch` rebuilds when a local input document changes; a URL input is polled (`--interval 30`).
- `--check` writes nothing and exits 1 when the committed output differs from what a run would write, or when a generated file is left over.
- `--raw` skips Prettier.
- A run removes the module of a tag the document no longer has — only files that still carry the generated banner, never your own files and never the runtime.

## Config reference

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
  http: "api-client",             // "fetch" | "axios" | "angular" — for the built-in runtime
  tags: { include: [], exclude: [] },
  zod: false,
  infinite: false,
  headers: { Authorization: "Bearer …" },   // for a URL input
  tls: { insecure: false, ca: "internal-ca.pem" },
  format: "prettier",             // or false
  sources: { users: "https://host/users/openapi.yaml" },  // for `pull`
  specsDir: "openapi-specs",
  decisionsFile: "openapi-forge.decisions.json",
  generatorName: "openapi-forge", // the banner of every file
  verbose: false,

  runtime: { /* see "Your own transport" */ },
  transform: { /* see "Opt-in extras" */ },
});
```

The config may also export a function (sync or async) that returns the object.

## Keeping up with a changing spec

`pull` fetches every document in `sources` into `specsDir` exactly as served, and prints what changed in each one in the terms of the code you consume — the operation, its generated hook, the schema and property. Every document is fetched before any is written, so a failed pull leaves the folder as it was.

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

Severity: **breaking** (removed or retyped operation, parameter, property, response; a new required parameter), **risky** (a new required property, an enum value removed, a deprecation), **safe** (additions). Swagger 2.0 documents are compared after the same conversion a run reads them with.

## Use in CI

```bash
npx openapi-forge --check                       # fails when the committed layer is stale
npx openapi-forge diff main.yaml pr.yaml --fail-on breaking
npx openapi-forge doctor                        # fails on a missing package or input
```

`--check` never asks questions; with several services it fails listing the decisions that are still open.

## Programmatic use

```ts
import { run, emit, mergeSpecs, diffDocuments, defineConfig } from "@mrzr/openapi-forge";

await run({ input: "swagger.json", out: "src/api" });                 // like the CLI
const { files } = emit(doc, resolvedOptions, "swagger.json");          // name → source, no disk
```

Also exported: `generate`, `pull`, `doctor`, `watchRun`, `renderReport`, `summarize`, `exceeds`, `resolveOptions`, `loadConfigFile`, `DEFAULTS`, `camelCase`, `pascalCase` and the types `ForgeConfig`, `ForgeOptions`, `RuntimeConfig`, `OperationInfo`, `Finding`, `Check`, `EmitResult`, `RunResult`, `Transform`.

## How it is tested

`npm run conformance` generates the layer (with `zod` and `infinite` on) for every document of the public [`@readme/oas-examples`](https://www.npmjs.com/package/@readme/oas-examples) corpus — 60 Swagger 2.0 / OpenAPI 3.0 / 3.1 documents covering circular references, polymorphism, discriminators, uploads, parameter styles and more — plus the fixture of the client tests, once for every client, and type-checks the output with `tsc --strict --noUnusedLocals --noUnusedParameters` against the real types of each library. All 9 clients × 62 documents pass.

The behaviour is run too, not only compiled (`npm test`): the `fetch`, axios, Angular `HttpClient` and `@mrzr/api-client` clients are called against a local HTTP server (query strings, path encoding, JSON, multipart and form bodies, headers, a per-call `baseUrl`, `result: false`, failing statuses, abort, bytes and text answers, a payload with a `result` field — and an interceptor, for Angular). Every hook library is executed (over `fetch`, axios and `@mrzr/api-client`, and Angular Query also over `HttpClient`): React Query and SWR rendered in jsdom, Vue Query inside an app, Solid Query under its browser build, Svelte Query as a component compiled with the Svelte compiler, Angular Query in Angular's test bed. In each, data arrives, a changed argument moves the query, a missing id waits, a mutation sends its variables, tearing down the owner aborts a mutation still in flight, a header argument is sent and moves the query, and an infinite list pages and sends its header with every page. A custom transport is compiled with its own config type and called with only the keys it has.

`npm test` builds and runs the suite (Node 20, 22 and 24 alike); `npm run typecheck` checks the types only.

## Coming from Orval

Orval's `client` values map like this: `react-query`, `vue-query`, `svelte-query`, `solid-query`, `angular-query` and `swr` are the `library` values above; `fetch`, `axios` and `angular` are `http` values (with `target: "requests"` for plain functions); `zod` is `zod: true`.

Left out on purpose: `hono` and `mcp` generate server handlers and tools, not a client; MSW / Faker mocks do not belong in a data layer; Suspense variants would double every hook. The `angular` client is promise-based over `HttpClient`, not the Observable-returning services Orval writes — with `angular-query` on top it covers an Angular application, and the interceptors keep working.

## Requirements

Node ≥ 20. Prettier (≥ 3) is optional: the project's own is used when installed (with its config); otherwise the output is raw and a warning says so.

## License

MIT
