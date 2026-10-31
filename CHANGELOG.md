# Changelog

## 0.3.0

**Breaking — the built-in clients are thin.** The package generates code; it no longer decides how a client behaves. Each `client.ts` hands the request the document describes to the client you chose and returns what that client returns.

- **No more shared behaviour.** axios and Angular used to be told to return raw bytes and to accept every status, so their interceptors saw an `ArrayBuffer` and a failed call was an `ApiResponseError`; `@mrzr/api-client` was made to resolve instead of throw and to give back bytes. Now an axios call answers like axios (`response.data`, `AxiosError`), an Angular call like `HttpClient` (the body, `HttpErrorResponse`), an `@mrzr/api-client` call like `@mrzr/api-client` (`response.data`, `ApiError`, its own cancel behaviour). `ApiResponseError` is written only for `http: "fetch"`, which has no errors of its own.
- **No envelope unwrapping at run time.** `isEnvelope` is gone from the built-in clients and `result: false` is no longer an error. With `@mrzr/api-client`, which takes the `data` of a `{ data }` answer itself, the types still speak of `data`; with `fetch`, axios and Angular the answer is typed whole (`runtime.envelope` can still describe a custom transport).
- **`@mrzr/api-client` is called as it is.** There is no `request` wrapper any more: every generated function calls `apiClient.get(…)` / `.post(…)` with api-client's own `RequestConfig` (`params`, `addTemplateToUrl`, `headers`, `signal`, `baseUrl`, `responseType`) and returns its `IRes<T>`, so a hook's `data` is the `IRes` (`data.data` is the payload). `client.ts` is one line, `export const apiClient = createClient();`, in the file the project owns — there is no `configureClient` for it — and it has the client's own defaults (it used to turn the worker off). A multipart body is typed `FormData` and a urlencoded body `URLSearchParams` (what api-client sends as it is), so `client.ts` holds no body helpers. An infinite hook reads `count` and `list` from `response.data`, because paging has to.
- With `@mrzr/api-client` a header parameter is no longer an argument of the function, of the hook or of its query key: headers are the client's own (`createClient({ headers })`, or `headers` in the config of a call). The generated code no longer sets `isFormData` (the client sees the `FormData`) or a `Content-Type` for a form body (the client sets it); it names one only for a text body, which the client would label JSON.
- **`configureClient`:** `fetch` keeps `{ baseUrl, headers }`; axios takes `{ instance }` only (put the base URL and default headers on the instance); `api-client` has no `configureClient`; Angular takes `{ instance }` and gets its base URL from an interceptor, as any Angular app does.
- **The document decides the request.** Query lists repeat their key, objects are `a[b]=1`, multipart and urlencoded bodies are built from the schema, and a non-JSON answer (`text/*`, or anything else as a `Blob`) is asked for with the new `responseType` key of the call — `requestKeys.responseType` for a custom transport.
- An `infinite: true` read whose answer is not `{ count, list }` (an envelope with a client that does not unwrap it) gets no infinite hook, and the run now says so.
- **A detail query takes its id as it is.** `useGetPetQuery(petId: string)` no longer accepts `undefined`, waits for it, or guards with `enabled`; pass `enabled` in the hook options to hold a query back.
- **Query keys are short.** A key is the tag, the operation's name and the arguments its answer depends on — `[...petsKeys.all, "getPet", petId]` — instead of the tag, a `list` / `detail` layer, the route and the arguments. The name tells two reads of one tag apart, so the route is no longer spelled into a key and `lists()` / `details()` are gone (invalidate `<tag>Keys.all`, or a prefix such as `[...petsKeys.all, "listPets"]`). Anything that built a key by hand must follow.
- **Which identical models become one is decided by identity, not by name.** A schema the document names is a contract of its own and never becomes an alias of another (a request body is not the entity it resembles). An inline object the generator named joins an identical one only when its shape says something of its own — it names another model, or has three fields; a bare `{ id, name }` or `{ file }` stays what it is. Before, two models merged when one name contained the other.

## 0.2.2

- **Valid code for awkward names.** An `operationId` or path parameter that is a reserved word (`delete`, `default`, `in`, `for`, …) or starts with a digit (`2fa`) used to be written as it was, which does not compile; it now takes the same fallback name an empty one does. A schema that starts with a digit (`2FA`) becomes `_2FA`, and its Zod validator `_2FASchema`.
- **Swagger 2.0 query lists.** `collectionFormat` is now carried over (`csv` is the default there, `ssv`, `pipes` and `multi` too), so a list the client would send as repeated keys instead of one line is reported, not changed in silence.
- **`pull` compares Swagger 2.0 documents correctly.** The documents are converted before they are compared, as `diff` always did; before, a changed response or definition of a Swagger 2.0 service showed no change at all. A service that moves between JSON and YAML no longer leaves its old document in `specsDir`.
- **`diff` names a parameter with a colon whole** (`filter:status`), not the part before the colon.
- **A tag the document drops no longer leaves its module behind.** The run removes generated files it no longer writes (only those that still carry the generated banner) and `--check` reports them as stale; before, the old module stayed, referred to models that were gone and `--check` said the output was up to date.
- **`--ca` adds to the public CAs** instead of replacing them, so a run that reads a private host and a public one verifies both; the headers of a document request are not sent on to another origin when `--ca` / `--insecure` reads it and the server redirects.
- `runtime.requestKeys.body: false` is accepted with `http: "api-client"` (it only threw for a real key); `--interval` must be a positive number; `--watch` no longer says it watches the config (it never did); `doctor`'s duplicate-`operationId` hint names the method suffix.

## 0.2.1

- A repeated `operationId` is named with the method appended (`getUserGet`), as the README says; before, the first repeat was already numbered (`getUserGet2`). A number is added only when the name with the method is taken too.
- Releases are cut from a `v*` tag (`npm version patch && git push --follow-tags`): the tag must match `package.json`, three Node versions verify, then npm trusted publishing and a GitHub Release.

## 0.2.0

- **The default `http` is `"api-client"`** (it was going to be `fetch`): a project that does not name one now gets a client over [`@mrzr/api-client`](https://www.npmjs.com/package/@mrzr/api-client) and needs that package. `http: "fetch"` is still there and needs nothing; the three runtime files are written once, so a layer already generated keeps its `client.ts`. A `DELETE` operation with a body is left out under the default (see below), where `fetch` sends it.
- `http: "api-client"` (`--http api-client`): the built-in runtime sends with [`@mrzr/api-client`](https://www.npmjs.com/package/@mrzr/api-client), so its token refresh, tab sync and plugins apply — `configureClient({ instance: createClient({ … }) })`, the way axios and Angular take theirs. Bodies and answers are handled by the same code as in the other clients. Its `delete` takes no body, so a `DELETE` operation with one is left out and reported. This replaces the adapter the 0.1.0 README showed for a custom transport.
- `doctor` looks for `@mrzr/api-client` when it is the chosen client; the conformance matrix is 9 clients × 62 documents, and every hook library is run over it.

## 0.1.0

First release.

- Generates models, request functions, route and query-key factories and hooks from OpenAPI 3.0 / 3.1 and Swagger 2.0 documents (JSON or YAML; a file, a folder of files or a URL).
- Clients: `library` picks the hooks — `react-query` (default), `vue-query`, `svelte-query`, `solid-query`, `angular-query`, `swr` — and `http` picks what the built-in runtime sends with — `fetch` (default), `axios` or Angular's `HttpClient` (`angular`, interceptors apply). The reactive libraries read each hook argument where the request is made, so a ref, a signal or a getter keeps the query in step. `client: "custom"` imports your own transport instead.
- Several services in one layer: documents are merged, conflicts are decided once and committed.
- `openapi-forge pull`, `--check` (fails CI when the committed layer is stale), `--watch`, `doctor`, `init`.
- `openapi-forge diff` and a change report on `pull`: breaking / risky / safe, by hook name.
- `zod: true` writes `schemas.ts`; `infinite: true` adds infinite-list hooks.
- Same-shaped query and variable types are written once (aliases, or `Omit<…> & {…}` when close).
- An incomplete document never produces broken output: unknown spots are typed `unknown` and listed with the operation and the part. What the client cannot do as the document asks (a cookie parameter, a query written on one line) is listed the same way, not sent differently in silence.
- The types are true of what is sent and received: only an operation whose response schema is an envelope is unwrapped (`isEnvelope`), `ApiListData` needs `count` and `list` to be `required`, header parameters are arguments (also of infinite-list hooks), a `DELETE` sends its body, `runtime.list.assumeRequired` takes `count` and `list` as always there, bodies go out as their media type (multipart with lists and objects, urlencoded, text, bytes), an answer is read by its `Content-Type` (JSON, text or `Blob`), and an object in a query is `a[b]=1`.
- `@mrzr/api-client` works as a custom transport: the README has the adapter, and `npm test` compiles and runs it against the real package. A header that is not text (a number, a flag) is written with `String()` in the generated code, so a transport that types its headers `Record<string, string>` takes it as it is.
- Written in strict TypeScript; the package ships `dist/` with `.d.ts` files.
- `npm run conformance` is a client × document matrix (8 × 61: 60 public documents of `@readme/oas-examples` plus the client-test fixture), generated and type-checked with `tsc --strict`. `npm test` runs the three HTTP clients and all six hook libraries — each over `fetch` and axios, Angular Query also over Angular's `HttpClient` — against a local server (data, reactive arguments, header arguments, a missing id, mutations, infinite lists, abort on teardown).
- Checked against two live backends (NestJS and FastAPI).
