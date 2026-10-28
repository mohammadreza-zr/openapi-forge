// The React hooks (React Query and SWR), rendered for real in jsdom against a
// local server: data arrives, a changed argument moves the query, a missing
// id waits, a mutation sends its variables, an infinite list pages, and
// leaving the screen aborts a mutation still in flight.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

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

import { compileCjs, generateTo, sleep } from "./harness.mjs";
import { EDGES_FIXTURE } from "./helpers.mjs";
import { pagesApi, petApi, serve } from "./server.mjs";

describe("the React hooks", () => {
  let server;
  const require = createRequire(import.meta.url);
  const React = require("react");
  const { act } = React;
  const { createRoot } = require("react-dom/client");
  const html = React.createElement;

  before(async () => {
    server = await serve((request) =>
      request.url.startsWith("/api/v1/pages") ? pagesApi(request) : petApi(request),
    );
  });
  after(async () => {
    dom.window.close();
    await server.close();
  });

  // The hooks' results are spread inside the probes: SWR (like React Query's
  // tracked results) re-renders only for the fields a component has read.

  /** Renders `Probe` with `props`. */
  function mount(wrap, Probe) {
    const reactRoot = createRoot(document.createElement("div"));
    return {
      render: (props) =>
        act(async () => {
          reactRoot.render(wrap(html(Probe, props)));
        }),
      unmount: () => act(async () => reactRoot.unmount()),
    };
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
      let edges;
      let wrap;
      let cleanup;

      before(async () => {
        const dir = await generateTo(library, { library, infinite: true });
        const js = compileCjs(dir);
        const load = createRequire(join(dir, "load.cjs"));
        api = load(join(js, "pets.js"));
        load(join(js, "client.js")).configureClient({ baseUrl: server.base });
        const edgesDir = await generateTo(`${library}-edges`, {
          library,
          infinite: true,
          input: EDGES_FIXTURE,
        });
        const edgesJs = compileCjs(edgesDir);
        const loadEdges = createRequire(join(edgesDir, "load.cjs"));
        edges = loadEdges(join(edgesJs, "edges.js"));
        loadEdges(join(edgesJs, "client.js")).configureClient({
          baseUrl: server.base,
        });
        if (library === "react-query") {
          const { QueryClient, QueryClientProvider } = load(
            "@tanstack/react-query",
          );
          const client = new QueryClient({
            defaultOptions: {
              queries: { retry: false, gcTime: 0 },
              mutations: { gcTime: 0 },
            },
          });
          wrap = (child) => html(QueryClientProvider, { client }, child);
          cleanup = () => client.clear();
        } else {
          const { SWRConfig } = load("swr");
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
        const view = mount(wrap, Probe);
        await view.render({ id: "1" });
        await eventually(() => latest.data?.id === "1", "pet 1");
        await view.render({ id: "2" });
        await eventually(() => latest.data?.id === "2", "pet 2");
        assert.ok(
          server.asked().includes("GET /api/v1/pets/1") &&
            server.asked().includes("GET /api/v1/pets/2"),
        );
        await view.unmount();
      });

      test("a missing id waits instead of asking for /pets/undefined", async () => {
        let latest;
        const Probe = ({ id }) => {
          latest = { ...api.useGetPetQuery(id) };
          return null;
        };
        const view = mount(wrap, Probe);
        const before = server.seen.length;
        await view.render({ id: undefined });
        await act(async () => sleep(100));
        assert.equal(server.seen.length, before);
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
        const view = mount(wrap, Probe);
        await view.render({});
        await eventually(
          () =>
            server.asked().includes("GET /api/v1/pets/9/visits?since=monday"),
          "the visits",
        );
        await view.unmount();
      });

      const send = (mutation, variables) =>
        (mutation.mutateAsync ?? mutation.trigger)(variables);

      test("a mutation sends its variables", async () => {
        let mutation;
        const Probe = () => {
          mutation = { ...api.useCreatePetMutation() };
          return null;
        };
        const view = mount(wrap, Probe);
        await view.render({});
        let created;
        await act(async () => {
          created = await send(mutation, { body: { name: "Rex" } });
        });
        assert.deepEqual(created, { id: "new", name: "Rex" });
        assert.ok(server.asked().includes("POST /api/v1/pets"));
        await view.unmount();
      });

      test("leaving the screen aborts a mutation still in flight", async () => {
        let mutation;
        const Probe = () => {
          mutation = { ...api.useCreatePetMutation() };
          return null;
        };
        const view = mount(wrap, Probe);
        await view.render({});
        const pending = send(mutation, { body: { name: "slow" } });
        const settled = assert.rejects(pending, /abort/i);
        await act(async () => sleep(50));
        await view.unmount();
        await settled;
      });

      test("an infinite list pages from where the loaded pages end", async () => {
        let latest;
        const Probe = () => {
          latest = {
            ...api.useListPetsInfiniteQuery({ kind: "cat" }, { pageSize: 2 }),
          };
          return null;
        };
        const view = mount(wrap, Probe);
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
          server.asked().includes("GET /api/v1/pets?kind=cat&start=2&offset=2"),
          server.asked().join("\n"),
        );
        await view.unmount();
      });

      test("a header argument is sent, and a changed one moves the query", async () => {
        const Probe = ({ tenant }) => {
          edges.useGetTenantQuery({}, { "X-Tenant-Id": tenant });
          return null;
        };
        const view = mount(wrap, Probe);
        const sentBy = (tenant) =>
          server.seen.some(
            (item) =>
              item.url.startsWith("/api/v1/tenant") &&
              item.headers["x-tenant-id"] === tenant,
          );
        await view.render({ tenant: "a" });
        await eventually(() => sentBy("a"), "a request for tenant a");
        await view.render({ tenant: "b" });
        await eventually(() => sentBy("b"), "a request for tenant b");
        await view.unmount();
      });

      test("an infinite list sends its header with every page", async () => {
        let latest;
        const Probe = () => {
          latest = {
            ...edges.useListPagesInfiniteQuery(
              {},
              { "X-Tenant-Id": "t9" },
              { pageSize: 2 },
            ),
          };
          return null;
        };
        const view = mount(wrap, Probe);
        await view.render({});
        const pages = () =>
          ((library === "swr" ? latest.data : latest.data?.pages) ?? []).map(
            (page) => page.list.join(),
          );
        await eventually(() => pages().length === 1, "the first page");
        await act(async () => {
          if (library === "swr") await latest.setSize((size) => size + 1);
          else await latest.fetchNextPage();
        });
        await eventually(() => pages().length === 2, "the second page");
        assert.deepEqual(pages(), ["0,1", "2,3"]);
        const asked = server.seen.filter((item) =>
          item.url.startsWith("/api/v1/pages"),
        );
        assert.ok(asked.length >= 2);
        assert.ok(asked.every((item) => item.headers["x-tenant-id"] === "t9"));
        await view.unmount();
      });
    });
  }
});
