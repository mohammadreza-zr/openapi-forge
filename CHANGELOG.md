# Changelog

## Unreleased

- Clients: `library` picks the hooks — `react-query` (default), `vue-query`, `svelte-query`, `solid-query`, `angular-query`, `swr` — and `http` picks what the built-in runtime sends with — `fetch` (default) or `axios`. The reactive libraries read each hook argument where the request is made, so a ref, a signal or a getter keeps the query in step.
- `--library` and `--http`; `doctor` looks for the packages the chosen client imports; `diff` and `pull` name hooks the way the library does.
- `npm run conformance` is a client × document matrix (7 × 61); the `fetch` / axios clients and the React Query, SWR, Vue Query and Solid Query hooks are run against a local server in `npm test`.
- Rewritten in strict TypeScript: the package ships `dist/` with `.d.ts` files, and `run`, `emit`, `generate`, `defineConfig` and the config types are typed.

## 0.2.0

- Swagger 2.0 input (converted to OpenAPI 3.0) and OpenAPI 3.1 spellings.
- `openapi-forge diff` and a change report on `pull`: breaking / risky / safe, by hook name.
- `zod: true` writes `schemas.ts`; `infinite: true` adds infinite-list hooks.
- `--watch`, `doctor`.
- Same-shaped query and variable types are written once (aliases, or `Omit<…> & {…}` when close).
- A per-call `baseUrl` now wins over the service's default.
- An incomplete document no longer produces broken output: unknown spots are typed `unknown` and listed.
- Fixes found by the conformance corpus: schema names normalised and kept clear of global types, empty `models.ts`, array and object path parameters, `GET` with a body, `$ref`s into `paths`, imports of union text.
- Found on two live backends (NestJS and FastAPI): an inline object no longer takes the name of a component or of another inline object; `type: null`, `additionalProperties: true` and `prefixItems` (tuples) are understood.
- `npm run conformance`: 60 public documents generated and type-checked.

## 0.1.0

- First release: models, request functions, key factories and React Query hooks; multi-service merge; `pull`; `--check`.
