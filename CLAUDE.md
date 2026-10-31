# CLAUDE.md

## Rule: never change how a client is used

`@mrzr/openapi-forge` generates code. It must **never** change how the chosen HTTP client
(`axios`, Angular `HttpClient`, `@mrzr/api-client`, `fetch`) is used or how it behaves.
Whatever the client is given or returns passes through untouched.

- Do not force options that alter behaviour (`responseType: "arraybuffer"`, `validateStatus`,
  `throwError`, `stringifyBody`, `fullData`, `paramsSerializer`, …), and do not parse, unwrap,
  re-encode or re-throw answers or errors.
- Do not make one client behave like another, even to be uniform. Each generated function
  calls its own client in that client's own way (`apiClient.get`, `http.get`, `fetch`, an
  Angular service over `HttpClient`) and uses the names the client gives (`params`,
  `addTemplateToUrl`, `headers`, `config`). There is no shared wrapper or helper.
- Anything the client's own config already carries (path values, query, headers) is not
  repeated as an argument: the caller's config goes to the client as it is.
- The generator decides only what the OpenAPI document says: the route, the query, the
  headers, the body shape, and `responseType` for a non-JSON answer. Types follow what the
  client really returns.
- `client.ts` holds the client's own instance and nothing that changes its behaviour.

Check any change to `src/runtime/client.ts` and to the request blocks of `src/emit.ts`
against this rule.

## Rule: never invent names

A name in the generated code comes from the document (schema, `operationId`, tag, parameter)
or from the client — never from position or structure (`Part0`, `Option1`). A part of an
`allOf`/`oneOf`/`anyOf` that is an inline object is written where it stands.

## Rule: generated code never depends on the project that uses it

The generated layer imports only the chosen client, the library it wraps and its own files.
Project code (a `serviceBaseUrl` function, an alias like `@core/...`) is imported only when
the project names it in the config (`runtime.services.fn`), never by default.

Where the API lives is read from the environment: `@mrzr/api-client` finds its own base URL
and gets nothing written; the other clients read `import.meta.env.<baseUrlEnv>`
(default `VITE_API_URL`), and nothing is written that no call uses.

## Before a release

The layer must work as generated, with no edit: call every operation of a real document
with each client against a mock server and check the verb, the route, the body and the
`Content-Type` (see `npm test` and `npm run conformance`).
