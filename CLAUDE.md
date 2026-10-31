# CLAUDE.md

## Rule: never change how a client is used

`@mrzr/openapi-forge` generates code. It must **never** change how the chosen HTTP client
(`axios`, Angular `HttpClient`, `@mrzr/api-client`, `fetch`) is used or how it behaves.
Whatever the client is given or returns passes through untouched.

- Do not force options that alter behaviour (`responseType: "arraybuffer"`, `validateStatus`,
  `throwError`, `stringifyBody`, `fullData`, …), and do not parse, unwrap, re-encode or
  re-throw answers or errors.
- Do not make one client behave like another, even to be uniform. An axios user gets axios's
  answers, `AxiosError` and interceptors; an Angular user gets `HttpClient`'s; and so on.
- The generator decides only what the OpenAPI document says: the route, the query, the
  headers, the body shape, and `responseType` for a non-JSON answer. Types follow what the
  client really returns.
- `configureClient` takes the client's own object (`{ instance }`); do not add settings that
  change its behaviour.

Check any change to `src/runtime/client.ts` against this rule.
