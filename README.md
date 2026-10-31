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
- **Routes** — `<tag>Endpoints`, the one place each URL is written; the request functions read their route from it, so a path changes in a single line.
- **Request functions** — one per operation, with typed path, query, header and body arguments, a `config` argument for `signal`, `baseUrl` and the like, and a JSDoc block (summary, description, `METHOD /route`, `@deprecated`).
- **Query-key factories** — `<tag>Keys` with `all` and one key per read: the tag, the operation's route (read from `<tag>Endpoints`) and the arguments its answer depends on (`["Pets", "/pets/{pet_id}", "7"]`), so invalidating "everything of this tag" is one line and a path still changes in one place.
- **Hooks** for **React Query, Vue Query, Svelte Query, Solid Query, Angular Query or SWR**: a query hook per read, a mutation hook per write (or only plain request functions with `target: "requests"`).
- **Reactive arguments** — in Vue, Svelte, Solid and Angular a hook argument may be a ref, a getter or a signal, and the query follows it.
- **Zod validators** (`zod: true`) — `schemas.ts`, one validator per model, typed `z.ZodType<Model>` so the two cannot drift apart.
- **Infinite-list hooks** (`infinite: true`) for paged reads.
- **Shared types** — query and variable types with the same shape are written once (aliased, or `Omit<…> & { … }` when close); an inline object that repeats a named model reuses it.

**Transport**

- **Four built-in HTTP clients** — [`@mrzr/api-client`](https://www.npmjs.com/package/@mrzr/api-client) (default), `fetch`, axios and Angular's `HttpClient`. **Each one is called as itself, in its own way** — `apiClient.get(…)`, `http.get(…)` on an axios instance, `fetch(…)`, an injectable Angular service over `HttpClient`: the answer, the errors and the interceptors are the client's own, and the generator only gives it the request the document describes.
- **Or your own** — `client: "custom"` imports your transport; every name and module path is configurable.
- **The request the document describes** — the route, the query, header parameters, `multipart/form-data`, `application/x-www-form-urlencoded`, text and binary bodies, bodies on `DELETE`, and how a non-JSON answer should be read (`text` or `blob`). What a client cannot write is listed, not sent differently in silence.
- **Types that match the client** — the type of an answer is what the chosen client returns. `@mrzr/api-client` is called straight and answers with its own `IRes<T>`, whose `data` is the payload (it takes the `data` of a `{ data }` answer itself, so a `{ result, data }` envelope is typed as its `data`); axios answers an `AxiosResponse<T>`, `fetch` a `Response`, Angular an `Observable<T>`. `{ count, list }` becomes `ApiListData<T>`.
- **Cancellation** — queries, mutations and infinite lists pass an `AbortSignal` to the request (SWR cannot cancel, see below); what an aborted call does is the client's own.

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

With the default `client: "builtin"` small files are written **once** next to the layer
(`hooks.ts`, `types.ts`, and `client.ts` for the clients that have an instance — api-client and axios). They are yours to edit and are never overwritten
(`--force-runtime` resets them). The hooks need the package of the library they wrap —
`@tanstack/react-query` v5 by default, see [Hook libraries](#hook-libraries).

```ts
// src/api/generated/client.ts — written once, yours to edit. The default client is @mrzr/api-client:
// give it the base URL, the tokens and the plugins it needs.
export const apiClient = createClient({ baseUrl: "https://api.example.com/v1" });
```

```ts
import { useListPetsQuery, useCreatePetMutation } from "./api/generated";

const pets = useListPetsQuery({ kind: "cat" });   // pets.data is api-client's own answer: pets.data?.data is the list
const create = useCreatePetMutation();
create.mutate({ body: { name: "Tom" } });
```

Without `@mrzr/api-client`, pick another client with `http`: `"axios"`, `"fetch"` (nothing to install) or `"angular"` (an injectable service over `HttpClient`). Each is called as itself — see [HTTP clients](#http-clients).

## What is generated

```
src/api/generated/
├── models.ts      every schema as a type
├── pets.ts        one module per tag: endpoints, keys, types, request functions, hooks
├── owners.ts
├── schemas.ts     Zod validators                  (zod: true)
├── services.ts    API_SERVICE_BASE_URLS           (per-service base URLs)
├── index.ts       re-exports everything
├── client.ts      ┐ the built-in runtime, written once, yours to edit
├── hooks.ts       │ (client.ts only for api-client and axios;
└── types.ts       ┘  fetch and Angular's HttpClient need none)
```

A module (trimmed) looks like this:

```ts
export const petsEndpoints = {
  listPets: "/pets",
  getPet: "/pets/{pet_id}",
} as const;

export const petsKeys = {
  all: ["Pets"] as const,
  listPets: (params: ListPetsQuery) => [...petsKeys.all, petsEndpoints.listPets, params] as const,
  getPet: (petId: string) => [...petsKeys.all, petsEndpoints.getPet, petId] as const,
} as const;

export type ListPetsQuery = { start?: number; kind?: "cat" | "dog"; ids?: string[] };

/** List the pets — `GET /pets` */
export function listPets(config?: RequestConfig<ApiListData<Pet>>) { … }   // api-client: the query is `params` in its own config
listPets({ params: { kind: "cat" } });
getPet({ addTemplateToUrl: { pet_id: "7" } });   // the path values are in the config too

export function useListPetsQuery(params: ListPetsQuery = {}, options?: ApiQueryOptions<…>) { … }
export function useGetPetQuery(petId: string, options?: ApiQueryOptions<…>) { … }
export function useCreatePetMutation(options?: ApiMutationOptions<Pet, CreatePetVariables>) { … }
```

- A write takes **one variables object** (`{ petId, params, headers, body }` — only the parts it has), named `<Operation>Variables`.
- Query and header parameters get `<Operation>Query` / `<Operation>Headers` types. The query is called `params`, as every built-in client calls it (`runtime.requestKeys.query` names it for a custom transport). With `@mrzr/api-client` a request function takes only its body and the client's own `config`: the query is `params` and the path values are `addTemplateToUrl` in that config (`listPets({ params: { kind: "cat" } })`, `getPet({ addTemplateToUrl: { pet_id: "7" } })`), and it goes to the client as it is. axios does the same for the query. The hooks keep everything typed (`useListPetsQuery({ kind: "cat" })`, `useGetPetQuery("7")`). `fetch` and Angular's service take the path values and `params` as arguments, since neither has a config to carry them; path arguments keep the document's names.
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

A query takes its path id as it is, a plain `string`. To hold a query back until you have the id, set `enabled` in the hook options. Mutations take their variables when `mutate` is called, so they are the same in every library.

Notes that follow from what each library offers:

- **SWR** cannot cancel a request, so the `signal` a fetcher gets never fires; an infinite list asks for page `n` at `n * pageSize`.
- **Solid**: the hook options leave out `initialData` — `createQuery` has one overload for options that set it and one for options that do not, and options that may do either match neither.
- **Angular**: `inject…` functions need an injection context — a constructor, a field initialiser, a service, `runInInjectionContext`.

## HTTP clients

Four clients, four different worlds. The generator does not put one behind another: every generated function calls the client it was made for, with that client's own types, and returns what that client returns. Nothing is parsed, unwrapped, retried or re-thrown on the way, and no setting of the client is changed.

| `http` | what a generated function is | returns | `client.ts` | needs |
| --- | --- | --- | --- | --- |
| `api-client` (default) | `apiClient.get(…)` with api-client's own `RequestConfig` | api-client's `IRes<T>` (`data`, `statusCode`, `message`, …) | `export const apiClient = createClient();` | [`@mrzr/api-client`](https://www.npmjs.com/package/@mrzr/api-client) |
| `axios` | `http.get<T>(url, config)` on your instance, with an `AxiosRequestConfig` | `AxiosResponse<T>`; a failed status is an `AxiosError` | `export const http = axios.create();` | `axios` |
| `fetch` | `fetch(url, init)` with a `RequestInit` | the platform's `Response`; a failed status resolves, as `fetch` does | none | nothing |
| `angular` | a method of an `@Injectable` service per tag, over the injected `HttpClient` | an `Observable<T>`; a failed status is an `HttpErrorResponse` | none | `@angular/common`, `@angular/core`, `rxjs` |

`client.ts` (axios and api-client) is yours: base URL, interceptors, tokens and plugins go on the instance there. `fetch` is a function of the platform and Angular injects its `HttpClient`, so neither writes a `client.ts`; Angular's base URL is an interceptor, as in any Angular app.

- **api-client**: an operation of a backend service is `apiClient.service("files").get(…)` through api-client's `services` plugin (`client.ts` is written with `services(API_SERVICE_BASE_URLS)` when the document has services; add it by hand to a `client.ts` that exists). A header parameter is not an argument of these functions — headers are api-client's own (`createClient({ headers })`, or `headers` in the config of one call). `delete` takes no body, so a `DELETE` operation with one is left out and listed.
- **axios**: the call's config is the second-to-last argument of a body-less call, spread into the request; a query list is written the way axios writes it (`ids[]=a`) unless the instance has a `paramsSerializer`; the run lists each such parameter.
- **fetch**: the query string is built in the function from the document's parameters (`URLSearchParams`), a JSON body is `JSON.stringify`-ed with its `Content-Type`, and reading the answer (`response.json()`) is yours.
- **Angular**: hooks are Angular Query's (`library: "angular-query"`), and a hook injects the tag's service (`inject(PetsService)`). `HttpClient` takes no `AbortSignal`; cancel by unsubscribing from the `Observable`.

A multipart body is typed `FormData`; a form body is `URLSearchParams` (`HttpParams` for Angular) — the bodies each client sends as they are — so you build them yourself.

What the generator does decide, from the document, is the request: the route (filled in), the query, the headers it declares, the body's shape and `Content-Type` where the client would otherwise label it wrongly, and `responseType` (`text` or `blob`) for an answer that is not JSON.

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
    requestKeys: { query: "params", pathParams: "addTemplateToUrl", formData: "isFormData", baseUrl: "baseUrl", signal: "signal", headers: "headers", envelope: "isEnvelope", body: "body", responseType: "responseType" },
    services: { module: "@/config/api", fn: "serviceBaseUrl" },   // or { baseUrls: { users: "https://…" } }
  },
});
```

Module paths are written as-is into the generated files, so paths relative to the output folder must be relative to it. `library` still decides how the generated hooks are named (`use…`, `create…`, `inject…`) and whether they read their arguments through `toValue` / `MaybeGetter` (the reactive libraries) — a custom runtime has to export those two names then, and its wrappers are named `<prefix>ApiQuery` by default.

The transport contract is `apiGet<T>(route, config)`, `apiPost<T>(route, body, config)` (also put / patch), `apiDelete<T>(route, config)`, where `config` carries `signal`, `params` (query), `addTemplateToUrl` (`{pet_id: "1"}` for `/pets/{pet_id}`), `isFormData` and `baseUrl`. Each resolves to the payload — whatever your transport makes of the answer.

`headers` (declared header parameters, and the `Content-Type` of a body that is not JSON), `body` (the key a `DELETE`'s body rides in), `responseType` (`"text"` or `"blob"` for a non-JSON answer) and `isEnvelope` are written only when the config names the key (`requestKeys.headers`, `.body`, `.responseType`, `.envelope`). Until then a header parameter is reported instead of being sent and a `DELETE` with a body is skipped with a warning. The built-in clients never use `isEnvelope`.

`openapi-forge doctor` checks that the modules the config names can be found.

## What goes over the wire

The generated code asks the client for what the document describes, and reports (never silently changes) what the client cannot do:

| the document says | the client |
| --- | --- |
| a `header` parameter | an argument (`headers`) of the request function, a hook argument and part of the query key; `Accept`, `Content-Type` and `Authorization` are the transport's, as OpenAPI says. With `@mrzr/api-client` it is not an argument: headers are the client's own (`createClient({ headers })`, or `headers` in the config of a call) |
| a `cookie` parameter | reported — a browser attaches cookies itself |
| a query list | repeated keys, `a=1&a=2`; `explode: false` and `pipeDelimited` / `spaceDelimited` are reported |
| a query object | `a[b]=1` (deepObject), as `fetch` and axios write it; another style is reported. `HttpClient` takes no object in `params` |
| a path parameter | `encodeURIComponent` of the value in its place in the route (a list is `a,b`) |
| a body on `DELETE` | sent (`data` in axios, `body` in `fetch` and `HttpClient`) — except by `api-client`, whose `delete` takes none: the operation is left out and listed |
| a body on `GET` | cannot be sent: left out with a warning |
| `multipart/form-data` | a `FormData` you build; the client sets the `Content-Type` and boundary |
| `application/x-www-form-urlencoded` | a `URLSearchParams` (`HttpParams` for Angular) you build; the client sets the `Content-Type` |
| `text/plain`, `application/octet-stream`, other non-JSON bodies | sent as they are, with that `Content-Type` |
| a non-JSON answer | the call says `responseType: "text"` (for `text/*`) or `"blob"` (anything else); the client reads it its own way. `fetch` returns the `Response` for you to read |
| a JSON answer | the client's own parsing; nothing is unwrapped or judged by the generated code |

Query values and the writing of an empty or `undefined` one are the client's own. A header value that is not text (a number, a flag) is written with `String()` for `fetch` and `HttpClient`, which take text.

A Swagger 2.0 query list is comma separated unless its `collectionFormat` says otherwise (`csv` is the default there), so such a list is **reported** — the client repeats the key — instead of being sent differently without a word. `collectionFormat: multi` is the repeated form and needs no report.

## Answers, envelopes and errors

Nothing the generated code runs touches an answer, so the types say what the client returns:

- **Envelope.** If the document's answer is `{ result, code, message, data }` and the client is `@mrzr/api-client`, which takes the `data` of such an answer itself, the types and calls speak only of `data`: `allOf: [EnvelopeBase, { data: T }]` becomes `ApiEnvelope<T>` in `models.ts`. With axios or Angular the answer is delivered whole, so its type is the whole schema (an envelope is an ordinary model there); with `fetch` you read the `Response` yourself. A `result: false` is the client's to judge — a `200` with `result: false` is returned as it is. For a custom transport that unwraps on its own, `runtime.envelope` describes the shape (`false` for none).
- **Paged lists.** A `{ count, list }` payload becomes `ApiListData<T>` only when the document marks both fields `required`; otherwise it keeps its own type with optional fields, because `ApiListData` promises both are there. An API that always sends both can say so with `runtime: { list: { assumeRequired: true } }`; `runtime.list: false` turns it off.
- **Errors.** A failed status is the client's own: an `AxiosError`, an `HttpErrorResponse`, an `ApiError`. `fetch` resolves on any status, so a failed one is a `Response` with `ok: false`.
- **Infinite lists** are written for a paged read whose answer *is* `{ count, list }`. When the answer is wrapped (an envelope with a client that does not unwrap it) the hook cannot be typed, so none is written and the run says so.

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
- Operations carry `x-service`, and `services.ts` exports `API_SERVICE_BASE_URLS` for the per-service base URL (a literal map, or a function of yours with `runtime.services.fn`). With `@mrzr/api-client` that map is handed to its `services` plugin and a call is `apiClient.service(name)`; axios gets `baseURL`, `fetch` and Angular the URL in front of the route.
- The run prints what was merged, which owner was chosen, which operations use a component owned by another service, and which saved choices no longer apply. `--verbose` lists the identical duplicates a merge folded together.

## Types and naming

- Names come from `operationId` (or `method + path`). A name already taken — the same `operationId` in two services — gets the method appended (`getUser` → `getUserGet`), and a number only if that is taken too (`getUserGet2`).
- An `operationId` that is not a usable function name (`delete`, `default`, `2fa`) falls back to a name built from the method and position; the same goes for a path argument called `in` or `delete`.
- A schema named like a Go package (`handler.LoginBody`) becomes `HandlerLoginBody`, and every `$ref` follows. A schema named like a global type the generated code uses (`Date`, `Record`, …) gets a `Model` suffix; one that starts with a digit (`2FA`) gets a leading `_`.
- Identical types are written once, without mixing what is different. Query / variable types of a tag are shared when their shapes match, and a close one is derived with `Omit<…> & { … }`. Of the models, a schema the document names is a contract and never becomes an alias of another; an inline object the generator named reuses an identical model when its shape says something of its own (it names another model, or has three fields) — a bare `{ id, name }` stays separate.
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

The behaviour is run too, not only compiled (`npm test`): the `fetch`, axios, Angular `HttpClient` and `@mrzr/api-client` clients are called against a local HTTP server (query strings, path encoding, JSON, multipart and form bodies, headers, a per-call `baseUrl`, a `result: false` answer handed over as it is, each client's own error on a failing status, abort, bytes and text answers — and the interceptors of axios and Angular, which see the answer the way the client reads it). Every hook library is executed (over `fetch`, axios and `@mrzr/api-client`, and Angular Query also over `HttpClient`): React Query and SWR rendered in jsdom, Vue Query inside an app, Solid Query under its browser build, Svelte Query as a component compiled with the Svelte compiler, Angular Query in Angular's test bed. In each, data arrives, a changed argument moves the query, a mutation sends its variables, tearing down the owner aborts a mutation still in flight, a header argument is sent and moves the query, and an infinite list pages and sends its header with every page. A custom transport is compiled with its own config type and called with only the keys it has.

`npm test` builds and runs the suite (Node 20, 22 and 24 alike); `npm run typecheck` checks the types only.

## Coming from Orval

Orval's `client` values map like this: `react-query`, `vue-query`, `svelte-query`, `solid-query`, `angular-query` and `swr` are the `library` values above; `fetch`, `axios` and `angular` are `http` values (with `target: "requests"` for plain functions); `zod` is `zod: true`.

Left out on purpose: `hono` and `mcp` generate server handlers and tools, not a client; MSW / Faker mocks do not belong in a data layer; Suspense variants would double every hook. The `angular` client is promise-based over `HttpClient`, not the Observable-returning services Orval writes — with `angular-query` on top it covers an Angular application, and the interceptors keep working.

## Requirements

Node ≥ 20. Prettier (≥ 3) is optional: the project's own is used when installed (with its config); otherwise the output is raw and a warning says so.

## License

MIT
