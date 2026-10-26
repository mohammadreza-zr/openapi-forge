# Changelog

## 0.2.0

- Swagger 2.0 input (converted to OpenAPI 3.0) and OpenAPI 3.1 spellings.
- `openapi-forge diff` and a change report on `pull`: breaking / risky / safe, by hook name.
- `zod: true` writes `schemas.ts`; `infinite: true` adds infinite-list hooks.
- `--watch`, `doctor`.
- Same-shaped query and variable types are written once (aliases, or `Omit<…> & {…}` when close).
- A per-call `baseUrl` now wins over the service's default.
- An incomplete document no longer produces broken output: unknown spots are typed `unknown` and listed.
- Fixes found by the conformance corpus: schema names normalised and kept clear of global types, empty `models.ts`, array and object path parameters, `GET` with a body, `$ref`s into `paths`, imports of union text.
- `npm run conformance`: 60 public documents generated and type-checked.

## 0.1.0

- First release: models, request functions, key factories and React Query hooks; multi-service merge; `pull`; `--check`.
