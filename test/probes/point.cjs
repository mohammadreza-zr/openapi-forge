/** `client.ts` compiled: `fetch` and Angular's `HttpClient` have no such file. */
function clientOf(req, file) {
  return require("node:fs").existsSync(file) ? req(file) : undefined;
}

// Points a compiled client at a server, the way each HTTP client takes its
// base URL and default headers: axios and @mrzr/api-client on the instance they
// are given (`client.ts` is the project's file; the harness added a setter),
// `fetch` on the platform's function, Angular in an interceptor.
function pointClient(http, client, req, base, headers = {}) {
  if (http === "axios") {
    client.setClientForTests(
      req("axios").create({ baseURL: base, headers }),
    );
  } else if (http === "api-client") {
    client.setClientForTests(
      req("@mrzr/api-client").createClient({ baseUrl: base, headers }),
    );
  } else if (http === "fetch") {
    pointFetch(base, headers);
  }
  // Angular's HttpClient has no base URL: the probes put it in an interceptor.
}

/**
 * `fetch` is the platform's function and the generated code calls it with a
 * route, so the test points it at the server: the base goes in front of a route
 * and the default headers go with every call. The answer is the real `Response`;
 * the test also reads its body once, eagerly, and keeps it as `response.payload`
 * (JSON parsed, text as it is, anything else a Blob, an empty body `null`), so a
 * hook's `data` can be compared without waiting on a stream.
 */
function pointFetch(base, headers = {}) {
  const real = (globalThis.__realFetch ??= globalThis.fetch);
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" && input.startsWith("/") ? base + input : input;
    const merged = new Headers(headers);
    for (const [name, value] of new Headers(init.headers)) merged.set(name, value);
    const response = await real(url, { ...init, headers: merged });
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    const copy = response.clone();
    let payload;
    if (type && !type.includes("json") && !type.startsWith("text/")) {
      payload = await copy.blob();
    } else {
      const text = await copy.text();
      payload = !text ? null : type.includes("json") ? JSON.parse(text) : text;
    }
    Object.defineProperty(response, "payload", { value: payload });
    return response;
  };
}

/**
 * What a generated call resolves to, as the answer's payload: @mrzr/api-client
 * and axios hand over their own answer (the payload is `.data`), `fetch` its
 * `Response` (see `pointFetch`), Angular's `HttpClient` the body itself.
 */
function payloadOf(http, answer) {
  if (http === "api-client" || http === "axios") return answer?.data;
  if (http === "fetch") return answer?.payload;
  return answer;
}

/** A multipart body: every built-in client takes the FormData it is given. */
function multipart(http, fields) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields))
    for (const item of Array.isArray(value) ? value : [value])
      form.append(name, typeof item === "object" && !(item instanceof Blob) ? JSON.stringify(item) : item);
  return form;
}

/** The same for application/x-www-form-urlencoded: a URLSearchParams. */
function urlencoded(http, fields) {
  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(fields))
    for (const item of Array.isArray(value) ? value : [value]) form.append(name, item);
  return form;
}

module.exports = { clientOf, multipart, payloadOf, pointClient, urlencoded };
