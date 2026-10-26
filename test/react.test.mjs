// The React hooks (React Query and SWR), rendered for real in jsdom against a
// local server: data arrives, a changed argument moves the query, a missing
// id waits, a mutation sends its variables, and an infinite list pages.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><div id=root></div>", {
  pretendToBeVisual: true,
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});

import { generate } from "../dist/generate.js";
import { CLIENTS_FIXTURE, options } from "./helpers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function load(library) {
  const dir = join(root, ".conformance", "runtime", library);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const source = join(dir, "ts");
  const { log, warn } = console;
  console.log = console.warn = () => {};
  try {
    await generate(
      options({ input: CLIENTS_FIXTURE, out: source, library, infinite: true }),
      { cwd: root },
    );
  } finally {
    Object.assign(console, { log, warn });
  }
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "--ignoreConfig",
      "--strict",
      "--skipLibCheck",
      "--target",
      "es2022",
      "--module",
      "commonjs",
      "--jsx",
      "react",
      "--lib",
      "es2023,dom",
      "--outDir",
      join(dir, "js"),
      ...readdirSync(source)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => join(source, name)),
    ],
    { stdio: "pipe" },
  );
  writeFileSync(join(dir, "js/package.json"), '{ "type": "commonjs" }');
  return { require: createRequire(join(dir, "load.cjs")), dir };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the React hooks", () => {
  let server;
  let asked;
  const React = createRequire(import.meta.url)("react");
  const { act } = React;
  const { createRoot } = createRequire(import.meta.url)("react-dom/client");
  const html = React.createElement;

  before(async () => {
    asked = [];
    server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      asked.push(`${request.method} ${request.url}`);
      const url = new URL(request.url, "http://x");
      let data;
      if (request.method === "POST")
        data = { id: "new", ...JSON.parse(Buffer.concat(chunks).toString()) };
      else if (url.pathname.endsWith("/visits")) data = { count: 0, list: [] };
      else if (url.pathname === "/api/v1/pets") {
        const start = Number(url.searchParams.get("start") ?? 0);
        const size = Number(url.searchParams.get("offset") ?? 20);
        data = {
          count: 5,
          list: Array.from(
            { length: Math.max(0, Math.min(size, 5 - start)) },
            (_, i) => ({
              id: String(start + i),
              name: `pet ${start + i}`,
            }),
          ),
        };
      } else data = { id: url.pathname.split("/")[4], name: "pet" };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ result: true, data }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  after(async () => {
    dom.window.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  // The hooks' results are spread inside the probes: SWR (like React Query's
  // tracked results) re-renders only for the fields a component has read.

  /** Renders `Probe` with `props`. */
  async function mount(wrap, Probe) {
    const container = document.createElement("div");
    const reactRoot = createRoot(container);
    const render = (props) =>
      act(async () => {
        reactRoot.render(wrap(html(Probe, props)));
      });
    return { render, unmount: () => act(async () => reactRoot.unmount()) };
  }
  /** Lets React and the network work until `check` holds. */
  async function eventually(check, what) {
    for (let waited = 0; waited < 3000; waited += 20) {
      await act(async () => sleep(20));
      if (check()) return;
    }
    assert.fail(`timed out waiting for ${what}`);
  }

  for (const library of ["react-query", "swr"]) {
    describe(library, () => {
      let api;
      let wrap;
      let cleanup;

      before(async () => {
        const { require, dir } = await load(library);
        api = require(join(dir, "js/pets.js"));
        require(join(dir, "js/client.js")).configureClient({
          baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
        });
        if (library === "react-query") {
          const {
            QueryClient,
            QueryClientProvider,
          } = require("@tanstack/react-query");
          const client = new QueryClient({
            defaultOptions: {
              queries: { retry: false, gcTime: 0 },
              mutations: { gcTime: 0 },
            },
          });
          wrap = (child) => html(QueryClientProvider, { client }, child);
          cleanup = () => client.clear();
        } else {
          const { SWRConfig } = require("swr");
          wrap = (child) =>
            html(
              SWRConfig,
              { value: { provider: () => new Map(), dedupingInterval: 0 } },
              child,
            );
          cleanup = () => {};
        }
      });
      after(() => cleanup());

      test("data arrives, and a changed argument moves the query", async () => {
        let latest;
        const Probe = ({ id }) => {
          latest = { ...api.useGetPetQuery(id) };
          return null;
        };
        const view = await mount(wrap, Probe);
        await view.render({ id: "1" });
        await eventually(() => latest.data?.id === "1", "pet 1");
        await view.render({ id: "2" });
        await eventually(() => latest.data?.id === "2", "pet 2");
        assert.ok(
          asked.includes("GET /api/v1/pets/1") &&
            asked.includes("GET /api/v1/pets/2"),
        );
        await view.unmount();
      });

      test("a missing id waits instead of asking for /pets/undefined", async () => {
        let latest;
        const Probe = ({ id }) => {
          latest = { ...api.useGetPetQuery(id) };
          return null;
        };
        const view = await mount(wrap, Probe);
        const before = asked.length;
        await view.render({ id: undefined });
        await act(async () => sleep(100));
        assert.equal(asked.length, before);
        assert.equal(latest.data, undefined);
        await view.render({ id: "5" });
        await eventually(() => latest.data?.id === "5", "pet 5");
        await view.unmount();
      });

      test("a path id and a query are both sent", async () => {
        const Probe = () => {
          api.useListVisitsQuery("9", { since: "monday" });
          return null;
        };
        const view = await mount(wrap, Probe);
        await view.render({});
        await eventually(
          () => asked.includes("GET /api/v1/pets/9/visits?since=monday"),
          "the visits",
        );
        await view.unmount();
      });

      test("a mutation sends its variables", async () => {
        let mutation;
        const Probe = () => {
          mutation = { ...api.useCreatePetMutation() };
          return null;
        };
        const view = await mount(wrap, Probe);
        await view.render({});
        let created;
        await act(async () => {
          created = await (mutation.mutateAsync ?? mutation.trigger)({
            body: { name: "Rex" },
          });
        });
        assert.deepEqual(created, { id: "new", name: "Rex" });
        assert.ok(asked.includes("POST /api/v1/pets"));
        await view.unmount();
      });

      test("an infinite list pages from where the loaded pages end", async () => {
        let latest;
        const Probe = () => {
          latest = {
            ...api.useListPetsInfiniteQuery({ kind: "cat" }, { pageSize: 2 }),
          };
          return null;
        };
        const view = await mount(wrap, Probe);
        await view.render({});
        const pages = () =>
          ((library === "swr" ? latest.data : latest.data?.pages) ?? []).map(
            (page) => page.list.map((pet) => pet.id).join(),
          );
        await eventually(() => pages().length === 1, "the first page");
        assert.deepEqual(pages(), ["0,1"]);
        await act(async () => {
          if (library === "swr") await latest.setSize((size) => size + 1);
          else await latest.fetchNextPage();
        });
        await eventually(() => pages().length === 2, "the second page");
        assert.deepEqual(pages(), ["0,1", "2,3"]);
        assert.ok(
          asked.includes("GET /api/v1/pets?kind=cat&start=2&offset=2"),
          asked.join("\n"),
        );
        await view.unmount();
      });
    });
  }
});
