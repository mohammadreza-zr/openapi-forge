// Several backend services, one generated API layer: read each service's
// document, merge them, and keep the decisions that belong to a person — which
// service is the main one, and which owns an operation or component the
// services define differently. They are asked in the terminal once and kept
// in the decisions file, so a later build — and the CI check, which never
// asks — gives the same result.
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import type {
  ForgeOptions,
  Input,
  Loose,
  MergeReport,
  OpenApiDocument,
  Service,
} from "../types.js";
import { mergeSpecs } from "./merge.js";
import { isUrl, parseDocument, readDocument } from "./source.js";

const SPEC_FILE = /\.(ya?ml|json)$/;
const TAG = "openapi-forge";

/** The choices kept in the decisions file. */
interface Decisions {
  main?: string;
  owners: Record<string, string>;
}

type Readline = ReturnType<typeof createInterface>;

/** The documents of a folder, named after their files. */
export async function readSpecDir(
  dir: string,
): Promise<(Service & { file: string })[]> {
  const files = (await readdir(dir)).filter((file) => SPEC_FILE.test(file));
  return Promise.all(
    files.sort().map(async (file) => ({
      name: basename(file, extname(file)),
      file,
      doc: parseDocument(await readFile(join(dir, file), "utf8"), file),
    })),
  );
}

/** What `input` holds: one document, or the services to merge. */
export async function classifyInput(
  input: Input,
  cwd: string,
): Promise<
  | { kind: "services"; entries: [string, string][] }
  | { kind: "document"; location: string }
  | { kind: "dir"; path: string }
> {
  if (input && typeof input === "object") {
    return { kind: "services", entries: Object.entries(input) };
  }
  if (isUrl(input)) return { kind: "document", location: input };
  const path = resolve(cwd, input);
  const info = await stat(path).catch(() => null);
  if (!info) {
    throw new Error(
      `${TAG}: input not found — ${path}. Set \`input\` in the config or pass --input.`,
    );
  }
  return info.isDirectory()
    ? { kind: "dir", path }
    : { kind: "document", location: input };
}

async function readDecisions(file: string): Promise<Decisions> {
  const text = await readFile(file, "utf8").catch(() => null);
  const config = text ? JSON.parse(text) : {};
  return { main: config.main, owners: config.owners ?? {} };
}

async function writeDecisions(file: string, config: Decisions): Promise<void> {
  const owners = Object.fromEntries(
    Object.entries(config.owners).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(
    file,
    `${JSON.stringify({ ...config, owners }, null, 2)}\n`,
    "utf8",
  );
}

/** Main service first, the rest by name: the merge's priority order. */
export function orderServices(specs: Service[], main?: string): Service[] {
  return [...specs].sort((a, b) =>
    a.name === main ? -1 : b.name === main ? 1 : a.name.localeCompare(b.name),
  );
}

function differingFields(copies: Loose[]): string[] {
  const fields = new Set(copies.flatMap((copy) => Object.keys(copy ?? {})));
  return [...fields].filter(
    (field) =>
      new Set(copies.map((copy) => JSON.stringify(copy?.[field]))).size > 1,
  );
}

function copyOf(spec: Service, key: string): Loose {
  if (key.startsWith("#/")) {
    const [, , section, name] = key.split("/");
    return spec.doc.components?.[section]?.[name];
  }
  const [method, path] = key.split(" ");
  return spec.doc.paths?.[path]?.[method.toLowerCase()];
}

/** The open questions as plain text, for a run that cannot ask them. */
export function pendingDecisions(
  specs: Service[],
  config: Decisions,
  undecided: MergeReport["undecided"],
): string[] {
  const pending: string[] = [];
  if (!config.main || !specs.some(({ name }) => name === config.main)) {
    pending.push(
      `the main service (one of ${specs.map(({ name }) => name).join(", ")})`,
    );
  }
  for (const { key, services } of undecided) {
    pending.push(`the owner of ${key} (${services.join(" or ")})`);
  }
  return pending;
}

async function choose(
  rl: Readline,
  question: string,
  options: string[],
): Promise<string> {
  const listing = options
    .map((option, i) => `    ${i + 1}) ${option}`)
    .join("\n");
  for (;;) {
    const answer = (await rl.question(`${question}\n${listing}\n  > `)).trim();
    const picked = options[Number(answer) - 1];
    if (picked) return picked;
  }
}

async function askMainService(specs: Service[], config: Decisions): Promise<Decisions> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    config.main = await choose(
      rl,
      `${TAG}: which service is the main one (its info and tags come first)?`,
      specs.map(({ name }) => name),
    );
    return config;
  } finally {
    rl.close();
  }
}

async function askOwners(
  specs: Service[],
  config: Decisions,
  undecided: MergeReport["undecided"],
): Promise<Decisions> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const { key, services } of undecided) {
      const copies = services.map((name) =>
        copyOf(
          specs.find((spec) => spec.name === name)!,
          key,
        ),
      );
      const fields = differingFields(copies);
      config.owners[key] = await choose(
        rl,
        `${TAG}: ${key} differs between ${services.join(" and ")}` +
          (fields.length ? ` (in ${fields.join(", ")})` : "") +
          ". Which one is right?",
        services,
      );
    }
    return config;
  } finally {
    rl.close();
  }
}

function printReport(
  services: Service[],
  report: MergeReport,
  config: Decisions,
  verbose: boolean | undefined,
  decisionsFile: string,
): void {
  const count = (items: { key: string }[], isComponent: boolean): number =>
    items.filter(({ key }) => key.startsWith("#/") === isComponent).length;
  const summary = (items: { key: string }[]): string =>
    `${count(items, false)} operations, ${count(items, true)} components`;
  const sizes = services.map(
    ({ name, doc }) =>
      `${name} (${Object.values(doc.paths ?? {}).reduce(
        (total, item) => total + Object.keys(item ?? {}).length,
        0,
      )} operations)`,
  );

  const lines = [`${TAG}: services ${sizes.join(", ")}`];
  const duplicates = [...report.identical, ...report.chosen];
  if (duplicates.length) {
    lines.push(`  in more than one service: ${summary(duplicates)}`);
    lines.push(`    identical, merged: ${summary(report.identical)}`);
    if (verbose) {
      for (const { key, services: owners } of report.identical) {
        lines.push(`      ${key} (${owners.join(", ")})`);
      }
    }
    lines.push(`    different, owner chosen: ${summary(report.chosen)}`);
    for (const { key, services: owners, owner } of report.chosen) {
      const others = owners.filter((name) => name !== owner);
      lines.push(`      ${key} → ${owner} (also in ${others.join(", ")})`);
    }
  }
  // Not `Map.groupBy`: it needs Node 21, and this package supports 20.
  const crossRefs = new Map<string, MergeReport["crossRefs"]>();
  for (const use of report.crossRefs) {
    const label = `${use.ref} → ${use.owner}, used by ${use.service}`;
    crossRefs.set(label, [...(crossRefs.get(label) ?? []), use]);
  }
  for (const [label, uses] of crossRefs) {
    lines.push(`  note: ${label} in ${uses.length} operations`);
    if (verbose) {
      for (const { key } of uses) lines.push(`      ${key}`);
    }
  }
  const chosenKeys = new Set(report.chosen.map(({ key }) => key));
  for (const key of Object.keys(config.owners)) {
    if (!chosenKeys.has(key)) {
      lines.push(`  unused choice in ${decisionsFile}: ${key} no longer conflicts`);
    }
  }
  console.log(lines.join("\n"));
}

/**
 * The merged document of several services, asking for whatever is still
 * undecided when `interactive`, and failing with the list of open questions
 * when it is not. A single service needs no merge and no questions.
 */
export async function loadMergedSpec(
  specs: Service[],
  {
    decisionsFile,
    interactive,
    verbose,
  }: { decisionsFile: string; interactive: boolean; verbose?: boolean },
): Promise<{ doc: OpenApiDocument }> {
  if (specs.length === 1) return { doc: specs[0].doc };

  const config = await readDecisions(decisionsFile);
  let asked = false;

  if (interactive && pendingDecisions(specs, config, []).length) {
    await askMainService(specs, config);
    asked = true;
  }
  const ordered = orderServices(specs, config.main);
  let merged = mergeSpecs(ordered, config.owners);
  if (interactive && merged.report.undecided.length) {
    await askOwners(ordered, config, merged.report.undecided);
    merged = mergeSpecs(ordered, config.owners);
    asked = true;
  }
  if (asked) await writeDecisions(decisionsFile, config);

  const pending = pendingDecisions(ordered, config, merged.report.undecided);
  if (pending.length) {
    throw new Error(
      `${TAG}: these need a decision before the API can be built:\n` +
        pending.map((item) => `  - ${item}`).join("\n") +
        `\n  Run \`openapi-forge\` in a terminal to answer them, or set them in ${decisionsFile}.`,
    );
  }

  printReport(ordered, merged.report, config, verbose, decisionsFile);
  return { doc: merged.doc };
}

/**
 * The one document a run emits from, for whatever `input` is: a file or URL
 * is taken as it is, a folder or a `{ name: location }` map is a set of
 * services and is merged.
 */
export async function loadInput(
  options: ForgeOptions,
  { cwd, interactive }: { cwd: string; interactive: boolean },
): Promise<{ doc: OpenApiDocument; source: string; merged?: boolean }> {
  const found = await classifyInput(options.input, cwd);
  const read = { headers: options.headers, tls: options.tls, cwd };

  if (found.kind === "document") {
    return {
      doc: await readDocument(found.location, read),
      source: String(found.location),
    };
  }

  const specs =
    found.kind === "dir"
      ? await readSpecDir(found.path)
      : await Promise.all(
          found.entries.map(async ([name, location]) => ({
            name,
            doc: await readDocument(location, read),
          })),
        );
  if (!specs.length) {
    throw new Error(`${TAG}: no OpenAPI documents found in the input.`);
  }

  const { doc } = await loadMergedSpec(specs, {
    decisionsFile: resolve(cwd, options.decisionsFile),
    interactive,
    verbose: options.verbose,
  });
  return {
    doc,
    source:
      found.kind === "dir"
        ? String(options.input)
        : specs.map(({ name }) => name).join(", "),
    merged: specs.length > 1,
  };
}
