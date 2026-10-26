// Merges the OpenAPI documents of several backend services into the one
// document the generator emits from. An operation or component found in one
// service is taken as is; one found in several is merged when every copy is
// the same and needs an owner when they differ. Owners come from the
// committed choices (the decisions file), so a build never guesses.

import type {
  HttpMethod,
  Loose,
  MergeReport,
  OpenApiDocument,
  OperationObject,
  Service,
} from "../types.js";

const HTTP_METHODS: HttpMethod[] = ["get", "put", "post", "patch", "delete"];

interface OperationEntry {
  path: string;
  method: HttpMethod;
  operation: OperationObject;
}

interface ComponentEntry {
  section: string;
  name: string;
  node: Loose;
}

const COMPONENT_REF = /^#\/components\/([^/]+)\/(.+)$/;

function sortedKeys(node: Loose): Loose {
  if (Array.isArray(node)) return node.map(sortedKeys);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.keys(node)
      .sort()
      .map((key) => [key, sortedKeys(node[key])]),
  );
}

// References stay names: a component that differs is a conflict of its own,
// so every operation naming it is not reported again.
const fingerprint = (node: Loose): string => JSON.stringify(sortedKeys(node));

/** Every component `$ref` a node names, directly or through other components. */
function referencedComponents(
  node: Loose,
  doc: OpenApiDocument,
  found = new Set<string>(),
): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((item: Loose) => referencedComponents(item, doc, found));
  } else if (node && typeof node === "object") {
    if (typeof node.$ref === "string" && !found.has(node.$ref)) {
      const match = COMPONENT_REF.exec(node.$ref);
      if (match) {
        found.add(node.$ref);
        referencedComponents(
          doc.components?.[match[1]]?.[match[2]],
          doc,
          found,
        );
      }
    }
    Object.values(node).forEach((value) =>
      referencedComponents(value, doc, found),
    );
  }
  return found;
}

function operationsOf(doc: OpenApiDocument): Map<string, OperationEntry> {
  const operations = new Map<string, OperationEntry>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (!item?.[method]) continue;
      const operation = {
        ...item[method],
        parameters: [
          ...(item.parameters ?? []),
          ...(item[method].parameters ?? []),
        ],
      };
      operations.set(`${method.toUpperCase()} ${path}`, {
        path,
        method,
        operation,
      });
    }
  }
  return operations;
}

function componentsOf(doc: OpenApiDocument): Map<string, ComponentEntry> {
  const components = new Map<string, ComponentEntry>();
  for (const [section, entries] of Object.entries(doc.components ?? {})) {
    for (const [name, node] of Object.entries<Loose>(entries ?? {})) {
      components.set(`#/components/${section}/${name}`, {
        section,
        name,
        node,
      });
    }
  }
  return components;
}

/**
 * Picks one copy per key. `entriesByService` maps a service to its
 * key → entry map; `nodeOf` reads what gets compared.
 */
function reconcile<T extends object>(
  services: Service[],
  entriesByService: Map<string, Map<string, T>>,
  nodeOf: (entry: T) => unknown,
  choices: Record<string, string>,
  report: MergeReport,
): Map<string, T & { service: string }> {
  const picked = new Map<string, T & { service: string }>();
  const keys = new Set(
    services.flatMap(({ name }) => [...entriesByService.get(name)!.keys()]),
  );

  for (const key of [...keys].sort()) {
    const holders = services.filter(({ name }) =>
      entriesByService.get(name)!.has(key),
    );
    const entry = (service: Service): T =>
      entriesByService.get(service.name)!.get(key)!;
    if (holders.length === 1) {
      picked.set(key, { service: holders[0].name, ...entry(holders[0]) });
      continue;
    }

    const prints = new Set(
      holders.map((service) => fingerprint(nodeOf(entry(service)))),
    );
    const names = holders.map((service) => service.name);
    if (prints.size === 1) {
      report.identical.push({ key, services: names });
      picked.set(key, { service: holders[0].name, ...entry(holders[0]) });
      continue;
    }

    const owner = choices[key];
    if (!owner || !names.includes(owner)) {
      report.undecided.push({ key, services: names });
      continue;
    }
    report.chosen.push({ key, services: names, owner });
    const holder = holders.find((service) => service.name === owner)!;
    picked.set(key, { service: owner, ...entry(holder) });
  }

  return picked;
}

/**
 * @param {{ name: string, doc: object }[]} services  in priority order; the
 *   first is the main service, whose `info` the merged document keeps.
 * @param {Record<string, string>} choices  key → owning service, where a key
 *   is `"POST /api/v1/cameras"` or `"#/components/schemas/VehicleGroup"`.
 */
export function mergeSpecs(
  services: Service[],
  choices: Record<string, string> = {},
): { doc: OpenApiDocument; report: MergeReport } {
  const report: MergeReport = { identical: [], chosen: [], undecided: [], crossRefs: [] };

  const operations = reconcile(
    services,
    new Map(services.map(({ name, doc }) => [name, operationsOf(doc)])),
    (entry) => entry.operation,
    choices,
    report,
  );
  const components = reconcile(
    services,
    new Map(services.map(({ name, doc }) => [name, componentsOf(doc)])),
    (entry) => entry.node,
    choices,
    report,
  );

  // Only a component the services disagree on can reach an operation in a
  // shape its own service does not send.
  const contested = new Map(
    report.chosen
      .filter(({ key }) => key.startsWith("#/"))
      .map(({ key, owner }) => [key, owner]),
  );

  const doc: Loose = {
    openapi: services[0].doc.openapi,
    info: services[0].doc.info,
    tags: [],
    paths: {},
    components: {},
  };

  const tagNames = new Set();
  for (const { doc: source } of services) {
    for (const tag of source.tags ?? []) {
      if (!tagNames.has(tag.name)) {
        tagNames.add(tag.name);
        doc.tags.push(tag);
      }
    }
  }

  for (const [key, { service, path, method, operation }] of operations) {
    doc.paths[path] ??= {};
    doc.paths[path][method] = { ...operation, "x-service": service };

    const source = services.find(({ name }) => name === service)!.doc;
    for (const ref of referencedComponents(operation, source)) {
      const owner = contested.get(ref);
      if (owner && owner !== service) {
        report.crossRefs.push({ key, service, ref, owner });
      }
    }
  }

  for (const { section, name, node } of components.values()) {
    doc.components[section] ??= {};
    doc.components[section][name] = node;
  }

  return { doc, report };
}
