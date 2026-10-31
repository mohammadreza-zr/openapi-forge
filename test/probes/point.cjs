// Points a compiled client at a server, the way each HTTP client takes its
// base URL and default headers: fetch in `configureClient`, axios and
// @mrzr/api-client on the instance they are given, Angular in an interceptor.
function pointClient(http, client, req, base, headers = {}) {
  if (http === "axios") {
    client.configureClient({
      instance: req("axios").create({ baseURL: base, headers }),
    });
  } else if (http === "api-client") {
    // `client.ts` is the project's to edit; the harness added a setter for tests.
    client.setClientForTests(
      req("@mrzr/api-client").createClient({ baseUrl: base, headers }),
    );
  } else if (http === "fetch") {
    client.configureClient({ baseUrl: base, headers: () => headers });
  }
  // Angular's HttpClient has no base URL: the probes put it in an interceptor.
}

/**
 * What a generated call resolves to, as the answer's payload: @mrzr/api-client
 * hands over its own `IRes` (the payload is `.data`), the other clients the
 * payload itself.
 */
function payloadOf(http, answer) {
  return http === "api-client" ? answer?.data : answer;
}

/**
 * A multipart body for the client: @mrzr/api-client takes the FormData itself,
 * the other built-in clients build it from the object the function is given.
 */
function multipart(http, fields) {
  if (http !== "api-client") return fields;
  const form = new FormData();
  for (const [name, value] of Object.entries(fields))
    for (const item of Array.isArray(value) ? value : [value])
      form.append(name, typeof item === "object" && !(item instanceof Blob) ? JSON.stringify(item) : item);
  return form;
}

/** The same for application/x-www-form-urlencoded: a URLSearchParams for api-client. */
function urlencoded(http, fields) {
  if (http !== "api-client") return fields;
  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(fields))
    for (const item of Array.isArray(value) ? value : [value]) form.append(name, item);
  return form;
}

module.exports = { multipart, payloadOf, pointClient, urlencoded };
