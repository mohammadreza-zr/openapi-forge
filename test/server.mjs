// A real HTTP server for the runtime tests: it records every request and
// answers from `reply`; `petApi` is the answer most tests want.
import { createServer } from "node:http";

/**
 * @param reply (request) => { status?, body, type? } — may be async. `body` is
 * sent as JSON unless it is a string or bytes; `type` is its content type
 * (JSON by default). GET /asked lists "METHOD url" of what was seen, and
 * GET /seen the same with headers and body, for a probe in another process.
 */
export async function serve(reply) {
  const seen = [];
  // A browser (or jsdom) asks first, with OPTIONS, before it sends a request
  // with headers of its own: answer as a real API would, and keep it out of `seen`.
  const cors = { "access-control-allow-origin": "*" };
  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...cors,
        "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE",
        "access-control-allow-headers":
          request.headers["access-control-request-headers"] ?? "*",
      });
      return response.end();
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.url === "/asked") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(
        JSON.stringify(seen.map((item) => `${item.method} ${item.url}`)),
      );
    }
    if (request.url === "/seen") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify(seen));
    }
    const entry = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };
    seen.push(entry);
    const { status = 200, body, type = "application/json" } = await reply(entry);
    response.writeHead(status, { ...cors, "content-type": type });
    response.end(
      typeof body === "string" || Buffer.isBuffer(body)
        ? body
        : JSON.stringify(body),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    seen,
    port,
    base: `http://127.0.0.1:${port}/api/v1`,
    /** "METHOD url" of every request so far. */
    asked: () => seen.map((item) => `${item.method} ${item.url}`),
    close: () => {
      server.closeAllConnections();
      return new Promise((done) => server.close(done));
    },
  };
}

// Plain payloads: the built-in clients return what the server sent, so a test
// that wants an envelope on the wire writes one itself.
const ok = (data) => ({ body: data });
export { ok };

/** The clients fixture's API: pets by id, a paged list of five, visits, create. */
export async function petApi(request) {
  const url = new URL(request.url, "http://x");
  if (request.method === "POST") {
    const sent = JSON.parse(request.body || "{}");
    // A pet named "slow" is created slowly, so a test can cancel it on the way.
    if (sent.name === "slow")
      await new Promise((resolve) => setTimeout(resolve, 600));
    return ok({ id: "new", ...sent });
  }
  if (url.pathname.endsWith("/visits")) return ok({ count: 0, list: [] });
  if (url.pathname === "/api/v1/pets") {
    const start = Number(url.searchParams.get("start") ?? 0);
    const size = Number(url.searchParams.get("offset") ?? 20);
    return ok({
      count: 5,
      list: Array.from(
        { length: Math.max(0, Math.min(size, 5 - start)) },
        (_, index) => ({
          id: String(start + index),
          name: `pet ${start + index}`,
        }),
      ),
    });
  }
  return ok({ id: url.pathname.split("/")[4], name: "pet" });
}

/** The edges fixture's paged read: five strings, from `start`, `offset` at a time. */
export function pagesApi(request) {
  const url = new URL(request.url, "http://x");
  const start = Number(url.searchParams.get("start") ?? 0);
  const size = Number(url.searchParams.get("offset") ?? 20);
  return {
    body: {
      count: 5,
      list: Array.from(
        { length: Math.max(0, Math.min(size, 5 - start)) },
        (_, index) => String(start + index),
      ),
    },
  };
}

/** The edges fixture's API: the paged read, and `{}` for everything else. */
export const edgesApi = (request) =>
  request.url.startsWith("/api/v1/pages") ? pagesApi(request) : { body: {} };
