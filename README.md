# @mrzr/openapi-forge

Generate a typed TypeScript API layer from OpenAPI / Swagger documents:

- **models** — one `type` per schema (inline objects named, `allOf` / `oneOf` / `nullable`, enums, `Blob` for uploads)
- **request functions** — one per operation, with typed path / query / body arguments
- **route + query-key factories** — each URL is written once; keys point at it
- **React Query hooks** — `useXQuery` for reads, `useXMutation` for writes (optional)
- **several services, one layer** — merge many documents; conflicts are decided once and committed
- **a runtime of its own, or yours** — a small fetch client is written for you, or the code imports your transport

Output is deterministic and prettier-formatted, so `--check` can fail CI when the committed layer is stale.

## Quick start

```bash
npm i -D @mrzr/openapi-forge
npx openapi-forge init                       # writes openapi-forge.config.mjs
npx openapi-forge --input swagger.json --out src/api/generated --api-prefix /api/v1
```

With the default `client: "builtin"` three small files are written **once** next to the layer
(`client.ts`, `hooks.ts`, `types.ts`). They are yours to edit and are never overwritten
(`--force-runtime` resets them). The hooks need `@tanstack/react-query` v5.

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

## Commands

| command | does |
| --- | --- |
| `openapi-forge [generate]` | write the layer |
| `openapi-forge pull` | fetch the documents in `sources` into `specsDir`, then generate |
| `openapi-forge diff <old> <new>` | report breaking / risky / safe changes between two documents (`--format`, `--fail-on`) |
| `openapi-forge doctor` | check the config, input, output, packages and runtime modules |
| `openapi-forge init` | write a starter `openapi-forge.config.mjs` |

Flags: `--config`, `--input`, `--out`, `--api-prefix`, `--tags a,b`, `--exclude-tags a,b`,
`--target hooks|requests`, `--client builtin|custom`, `--headers "K: v;K2: v"`, `--insecure`,
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
    hooks: { module: "../hooks", query: "useApiQuery", mutation: "useApiMutation" },
    types: { module: "../types", request: "GeneratedRequestConfig", query: "ApiQueryOptions", mutation: "ApiMutationOptions" },
    list: { name: "ApiListData", module: "@/types", count: "count", items: "list" },   // or false
    envelope: { name: "ApiEnvelope", module: "../../types/api", result: "result", data: "data", keys: ["result", "code", "message", "data"] }, // or false
    requestKeys: { query: "params", pathParams: "addTemplateToUrl", formData: "isFormData", baseUrl: "baseUrl", signal: "signal" },
    services: { module: "@/config/api", fn: "serviceBaseUrl" },   // or { baseUrls: { users: "https://…" } }
  },
});
```

Module paths are written as-is into the generated files, so paths relative to the output folder
must be relative to it.

The transport contract is `apiGet<T>(route, config)`, `apiPost<T>(route, body, config)` (also put /
patch), `apiDelete<T>(route, config)`, where `config` carries `signal`, `params` (query),
`addTemplateToUrl` (`{pet_id: "1"}` for `/pets/{pet_id}`), `isFormData` and `baseUrl`. Each resolves
to the unwrapped payload.

### The envelope

If every answer is `{ result, code, message, data }`, the generated types and calls speak only of
`data`: `allOf: [EnvelopeBase, { data: T }]` becomes `ApiEnvelope<T>` in `models.ts`, and a
`{ count, list }` payload becomes `ApiListData<T>`. Set `runtime.envelope: false` / `runtime.list: false`
for an API with neither.

## Opt-in extras

Off by default, so the default output stays small.

```js
export default defineConfig({
  zod: true,       // schemas.ts: a Zod validator per model, typed as `z.ZodType<Model>`
  infinite: true,  // use<Op>InfiniteQuery for every paged read with `start` + `offset`
  // infinite: { start: "page", size: "limit" },   // other paging parameter names
});
```

`zod` needs the `zod` package. `infinite` needs `useApiInfiniteQuery` and `ApiInfiniteQueryOptions` in a custom runtime (the built-in one writes them).

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

```js
import { run, emit, mergeSpecs, defineConfig } from "@mrzr/openapi-forge";

await run({ input: "swagger.json", out: "src/api" });                 // like the CLI
const { files } = emit(doc, resolvedOptions, "swagger.json");          // name → source, no disk
```

## Notes

- Names come from `operationId` (or `method + path`), collisions get the method appended.
- A `DELETE` that takes a body is skipped with a warning — the request functions cannot send one.
- A schema named like a Go package (`handler.LoginBody`) becomes `HandlerLoginBody`, and every `$ref` follows.
- Prettier is optional: the project's own is used when installed (with its config); otherwise output is raw.
- Tests: `npm test`.

MIT
