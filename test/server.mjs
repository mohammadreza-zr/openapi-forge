// A real HTTP server for the runtime tests: it records every request and
// answers from `reply`; `petApi` is the answer most tests want.
import { createServer } from "node:http";

/**
 * @param reply (request) => { status?, body } — may be async. `body` is sent as
 * JSON unless it is a string. GET /asked lists "METHOD url" of what was seen.
 */
export async function serve(reply) {
  const seen = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.url === "/asked") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(
        JSON.stringify(seen.map((item) => `${item.method} ${item.url}`)),
      );
    }
    const entry = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };
    seen.push(entry);
    const { status = 200, body } = await reply(entry);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
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

const ok = (data) => ({ body: { result: true, code: 0, data } });
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
